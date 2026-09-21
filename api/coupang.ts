import type { VercelRequest, VercelResponse } from '@vercel/node';
import { COUPANG_FEE_RATE_PCT, growthSettlement } from '../src/lib/coupangFee.js';
import { checkMonth, isReserveSettlement, type MonthCheck } from '../src/lib/settlementCheck.js';
import { rollupMonths, type MonthProfit } from '../src/lib/monthlyProfit.js';
import { runCron } from '../src/lib/cronHeartbeat.js';
import { emailFrom } from '../src/lib/emailFrom.js';
import { wrapEmail } from '../src/lib/emailTemplate.js';
import { pickMovers, type MoverInput, type SalesMovers } from '../src/lib/salesMovers.js';
import { adCostGap, type AdGap } from '../src/lib/adCostGap.js';
import { summarizeReturnReasons } from '../src/lib/returnReasons.js';
import { decideQuota, isDisabled, parseLimits, type QuotaDecision } from '../src/lib/featureLimits.js';
import { createClient } from '@supabase/supabase-js';
import { isTransientDbError } from '../src/lib/dbRetry.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
// ESM이라 상대 경로 import에는 확장자가 필요하다. 빠지면 함수가 통째로 죽는다.
import { tabDisabledMessage } from '../lib/feature-gate.js';
import * as XLSX from 'xlsx';
import { extractDailyAdCost, extractItemAdCost, rowsFromMatrix } from '../src/lib/adcost.js';
import { checkAccess } from '../src/lib/accessGate.js';

export const config = { maxDuration: 300 };

// ═══════════════════════════════════════════════════════════════════════════════
// 쿠팡 윙 Open API 연동
//
// 무엇을 하나
//   판매자가 자기 윙 계정에서 발급한 Open API 키를 등록하면, 매일 새벽 크론이
//   상품·주문·매출·정산·반품·문의를 수집해 Supabase에 쌓는다. 화면은 DB만
//   읽으므로 쿠팡 호출량이 사용자 조작과 무관하게 일정하다.
//
// 왜 사용자별 키인가
//   쿠팡 호출 한도는 업체코드 단위로 적용된다. 사용자가 자기 키를 쓰면 한도가
//   서로 잠식하지 않고, 한 사람의 키가 죽어도 다른 사람 동기화는 계속된다.
//   판매자 로그인 정보를 대신 보관하지 않으므로 약관·보안 측면도 깔끔하다.
//
// ⚠ IP 화이트리스트 (설계상 가장 중요한 제약)
//   쿠팡은 '자체개발(직접입력)' 연동에 등록된 IP에서만 호출을 허용한다.
//   Vercel 서버리스는 고정 아웃바운드 IP가 없다. Vercel의 Static IPs 기능은
//   프로젝트당 월 $100라 쓰지 않고, 월 몇 천원짜리 VPS에 중계 서버를 띄워
//   모든 쿠팡 호출이 그 고정 IP를 거치게 했다.
//     · COUPANG_RELAY_URL  이 설정되면 그 중계 서버로 요청을 넘긴다
//     · 미설정이면 Vercel에서 직접 호출한다 (개발·테스트용)
//   중계 서버 구현은 scripts/coupang-relay.mjs 에 있다. 아무 VPS에나 띄우고
//   그 서버의 IP 하나만 판매자들이 윙에 등록하면 된다.
//
// ⚠ 키는 업체코드당 1개뿐이다
//   이미 주문수집 솔루션을 쓰는 판매자는 '재발급'을 하면 그쪽 연동이 끊긴다.
//   그래서 온보딩은 '기존 키를 그대로 붙여넣기'를 기본으로 안내한다.
// ═══════════════════════════════════════════════════════════════════════════════

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

const COUPANG_HOST = 'https://api-gateway.coupang.com';
const RELAY_URL = (process.env.COUPANG_RELAY_URL || '').trim();
const RELAY_SECRET = (process.env.COUPANG_RELAY_SECRET || '').trim();

// ── 시간 (한국 기준) ──────────────────────────────────────────
function kstNow(): Date {
  return new Date(Date.now() + 9 * 3600_000);
}
export function kstToday(): string {
  return kstNow().toISOString().slice(0, 10);
}
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** 그 달의 마지막 날 (YYYY-MM-DD). 다음 달 1일에서 하루 빼면 윤년도 알아서 맞는다. */
export function monthEnd(yearMonth: string): string {
  const y = Number(yearMonth.slice(0, 4));
  const m = Number(yearMonth.slice(5, 7));
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return addDays(`${nextY}-${String(nextM).padStart(2, '0')}-01`, -1);
}

/** YYYY-MM 목록. 지급내역 API가 월 단위로만 조회되기 때문에 필요하다. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endKey = to.slice(0, 7);
  // 상한을 둔다. 잘못된 입력으로 무한 루프가 돌면 함수가 타임아웃까지 매달린다.
  for (let i = 0; i < 60; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= endKey) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// ── Secret Key 암호화 (빌링키와 동일한 AES-256-GCM) ───────────
function encKey(): Buffer {
  const secret = process.env.BILLING_ENC_KEY || process.env.JWT_SECRET!;
  return crypto.createHash('sha256').update(secret).digest();
}
function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}
function decryptSecret(enc: string): string {
  const [ivHex, tagHex, dataHex] = enc.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

// ═══════════════════════════════════════════════════════════════
// 쿠팡 HMAC 서명
//   message   = signed-date + method + path + query   (query는 '?' 제외)
//   signature = HMAC-SHA256(secretKey, message) 를 hex로
//   signed-date 형식은 yyMMdd'T'HHmmss'Z' (UTC)
// ═══════════════════════════════════════════════════════════════
export function signedDate(): string {
  // 2026-09-05T12:34:56.789Z → 260905T123456Z
  return new Date().toISOString().slice(2, 19).replace(/[-:]/g, '') + 'Z';
}

export function authorization(method: string, path: string, query: string, accessKey: string, secretKey: string): string {
  const datetime = signedDate();
  const message = datetime + method + path + query;
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}

export interface CoupangCreds {
  vendorId: string;
  accessKey: string;
  secretKey: string;
}

export interface CoupangResult<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  /** 키 자체가 거부됐다 — 만료·오타·IP 미등록. 계정 상태를 invalid로 내린다. */
  authFailed?: boolean;
  /** 쿠팡이 아니라 중계 서버가 낸 오류다. 판매자 키와 무관하므로 계정을 건드리면 안 된다. */
  relayError?: boolean;
  /** 시간 상한에 걸려 끊었다. 이미 그만큼 시간을 썼으므로 다시 부르지 않는다. */
  timedOut?: boolean;
}

// 호출 1건의 시간 상한. 중계 서버가 응답을 안 주면 fetch는 몇 분이고 매달려 있고,
// 그동안 이 회차의 나머지 수집이 통째로 굶는다. 실제로 수동 수집(90초)이 상품
// 목록 하나에 다 잡아먹혀 주문·쿠폰이 한 번도 돌지 못했다.
const CALL_TIMEOUT_MS = 20_000;

/**
 * 쿠팡 API 호출 1건.
 * query는 이미 정렬·인코딩된 문자열이어야 한다 (서명 대상이 문자열 그대로이기 때문).
 */
async function coupangCall<T = any>(
  creds: CoupangCreds,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  query = '',
  body?: any,
): Promise<CoupangResult<T>> {
  // 중계 서버나 망이 잠깐 끊기면 'fetch failed'로 떨어진다. 한 번 그러면 그 회차의
  // 발주서·상품 목록이 통째로 비고, 뒤따르는 쿠폰 조회까지 건너뛴다. 조회(GET)는
  // 다시 불러도 해가 없으니 짧게 쉬고 두 번 더 시도한다. 쿠팡이 4xx로 거절한 것은
  // 다시 물어도 같으므로 그대로 돌려준다.
  //
  // 단, 시간 상한에 걸려 끊은 호출은 다시 부르지 않는다. 이미 20초를 썼는데 세 번
  // 시도하면 1분이고, 수동 수집의 90초 예산이 첫 단계 하나에 다 들어간다.
  //
  // 429(호출 한도)도 조회라면 한 번 쉬었다 다시 부른다. 지급내역·매출내역·반품·
  // 교환 조회가 저마다 구간을 쪼개 연달아 부르다 걸렸고, 한 번 걸리면 그 구간이
  // 통째로 빠졌다. 단계마다 따로 손보는 대신 여기서 받는다 — 쿠팡은 'Try after
  // 3 seconds'라고 하므로 3초를 두 번까지 기다린다.
  let last: CoupangResult<T> | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(last?.status === 429 ? RATE_LIMIT_WAIT_MS : 600 * attempt);
    const r = await coupangCallOnce<T>(creds, method, path, query, body);
    if (r.ok || method !== 'GET' || !(isTransient(r) || r.status === 429)) return r;
    last = r;
  }
  return last!;
}

/** 429를 받았을 때 쉬는 시간. 쿠팡 응답 문구('Try after 3 seconds')에 맞춘다 */
const RATE_LIMIT_WAIT_MS = 3_000;

/**
 * 다시 불러 볼 만한 실패인가.
 * 곧바로 떨어진 망 오류와 중계 서버의 5xx만 그렇다. 시간 상한에 걸린 호출은
 * 이미 예산을 썼으므로 제외한다 — 다시 걸리면 그만큼 또 기다린다.
 */
export function isTransient(r: { ok: boolean; status: number; relayError?: boolean; authFailed?: boolean; timedOut?: boolean }): boolean {
  if (r.ok || r.authFailed || r.timedOut) return false;
  if (r.status === 0) return true;
  return Boolean(r.relayError) && r.status >= 500;
}

async function coupangCallOnce<T = any>(
  creds: CoupangCreds,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  query = '',
  body?: any,
): Promise<CoupangResult<T>> {
  const auth = authorization(method, path, query, creds.accessKey, creds.secretKey);
  const url = `${COUPANG_HOST}${path}${query ? `?${query}` : ''}`;
  const headers: Record<string, string> = {
    Authorization: auth,
    'Content-Type': 'application/json;charset=UTF-8',
    // 로켓그로스(rg_open_api)는 이 헤더가 없으면 거절한다. 다른 계열은 무시하므로
    // 공통으로 붙여 둔다.
    'X-MARKET': 'KR',
  };

  try {
    let res: Response;
    if (RELAY_URL) {
      // 고정 IP 중계 서버 경유 — 서명은 이미 끝났으므로 중계는 그대로 전달만 한다.
      res = await fetch(RELAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(RELAY_SECRET ? { 'X-Relay-Secret': RELAY_SECRET } : {}),
        },
        body: JSON.stringify({ method, url, headers, body: body ?? null }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } else {
      res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    }

    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      // 중계 서버 자체가 만든 오류(비밀키 불일치, 쿠팡 미도달)는 X-Relay-Error를
      // 달고 온다. 이걸 키 거부로 읽으면 운영자가 비밀키 하나 바꾼 날 판매자
      // 계정이 무더기로 무효화된다. 401·403은 쿠팡이 직접 보낸 것일 때만 키 문제다.
      const fromRelay = res.headers.get('x-relay-error') === '1';
      const authFailed = !fromRelay && (res.status === 401 || res.status === 403);
      // 키 거부는 계정을 invalid로 내리고 판매자에게 메일까지 가는 일이다. 무엇이
      // 어떻게 거부됐는지 남기지 않으면 오판이었는지 확인할 길이 없다. 키 값은
      // 헤더에만 있고 여기엔 안 찍힌다.
      if (authFailed) {
        console.warn('coupang auth rejected —', { path, status: res.status, body: text.slice(0, 200) });
      }
      return {
        ok: false,
        status: res.status,
        authFailed,
        relayError: fromRelay,
        error: (fromRelay ? '중계 서버: ' : '') + (parsed?.message || parsed?.error || text.slice(0, 300) || `HTTP ${res.status}`),
      };
    }

    // 쿠팡은 HTTP 200 안에 code/message로 실패를 담아 보내는 경우가 있다.
    if (parsed && typeof parsed.code !== 'undefined' && Number(parsed.code) >= 400) {
      return { ok: false, status: Number(parsed.code), error: parsed.message || '쿠팡 API 오류' };
    }

    return { ok: true, status: res.status, data: parsed as T };
  } catch (e: any) {
    // AbortSignal.timeout은 TimeoutError로 떨어진다. 이 둘을 구분해야 재시도를
    // 걸지 말지 정할 수 있다.
    const timedOut = e?.name === 'TimeoutError' || /aborted|timeout/i.test(String(e?.message ?? ''));
    return {
      ok: false,
      status: 0,
      timedOut,
      error: timedOut ? `응답이 ${CALL_TIMEOUT_MS / 1000}초 안에 오지 않았습니다` : e?.message || '쿠팡 API 호출 실패',
    };
  }
}

/**
 * 경로 버전이 확실하지 않은 엔드포인트를 위해 여러 버전을 차례로 시도한다.
 * 성공한 버전은 프로세스 메모리에 기억해 다음 호출부터 바로 쓴다.
 * (쿠팡은 반품·문의 API를 v4에서 v5로 옮겨가는 중이라 계정마다 다를 수 있다)
 */
const versionCache = new Map<string, string>();

async function coupangCallVersioned<T = any>(
  creds: CoupangCreds,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  buildPath: (version: string) => string,
  query = '',
  versions: string[] = ['v5', 'v4'],
  cacheKey = '',
  body?: any,
): Promise<CoupangResult<T>> {
  const key = cacheKey || buildPath('*');
  const known = versionCache.get(key);
  const order = known ? [known, ...versions.filter(v => v !== known)] : versions;

  let last: CoupangResult<T> | null = null;
  for (const v of order) {
    const r = await coupangCall<T>(creds, method, buildPath(v), query, body);
    if (r.ok) {
      versionCache.set(key, v);
      return r;
    }
    // 404/400(경로 없음)만 다음 버전으로 넘어간다. 인증 실패는 버전 문제가 아니다.
    if (r.authFailed || (r.status !== 404 && r.status !== 400)) return r;
    last = r;
  }
  return last ?? { ok: false, status: 0, error: '호출 실패' };
}

// ═══════════════════════════════════════════════════════════════
// 응답 필드 정규화
//   쿠팡 응답은 엔드포인트·버전마다 필드명이 조금씩 다르다. 후보 이름을
//   순서대로 훑어 첫 값을 쓰고, 못 찾으면 기본값으로 떨어뜨린다.
//   덕분에 필드명이 하나 달라도 전체 동기화가 무너지지 않는다.
// ═══════════════════════════════════════════════════════════════
function pickRaw(obj: any, keys: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}
function pickStr(obj: any, keys: string[], fallback = ''): string {
  const v = pickRaw(obj, keys);
  return v === undefined ? fallback : String(v);
}
function pickNum(obj: any, keys: string[], fallback = 0): number {
  const v = pickRaw(obj, keys);
  if (v === undefined) return fallback;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}
/**
 * 중첩 객체 안에서 처음 만나는 양수 값 (깊이 3까지). 로켓그로스 상품 상세는
 * items[].salePrice를 0으로 주고 값은 안쪽 객체에 둘 수 있어, 위에서 못 찾으면
 * 한 겹씩 들어가 본다.
 */
function deepPickNum(obj: any, keys: string[], depth = 3): number {
  if (!obj || typeof obj !== 'object' || depth < 0) return 0;
  const direct = pickNum(obj, keys, 0);
  if (direct > 0) return direct;
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const n = deepPickNum(v, keys, depth - 1);
      if (n > 0) return n;
    }
  }
  return 0;
}
function pickDate(obj: any, keys: string[]): string | null {
  const v = pickRaw(obj, keys);
  if (!v) return null;
  const s = String(v);
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}
/**
 * 타임스탬프 정규화.
 * 쿠팡은 엔드포인트마다 날짜 형식이 달라 "2026-09-05 14:00:00"처럼 오기도 한다.
 * 그대로 timestamptz 컬럼에 넣었다가 파싱이 안 되면 그 배치 전체가 실패한다.
 * 해석이 되면 ISO로 통일하고, 안 되면 null로 떨어뜨려 나머지 값이라도 저장한다.
 */
export function toIso(v: any): string | null {
  if (!v) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  // 공백으로 날짜와 시각을 나눈 형식을 ISO로 맞춘다
  let normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw) ? raw.replace(' ', 'T') : raw;
  // 날짜만 온 값은 Date.parse가 UTC 자정으로 읽어 버린다. 한국 자정으로 못 박는다.
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T00:00:00';
  // 시간대 표기가 없으면 한국 시각이다. 그대로 두면 서버(UTC)가 9시간 뒤로 해석해
  // 오후 2시 문의가 오후 11시로 보이고, 저녁 반품이 다음 날로 넘어간다.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized) && !/(Z|[+-]\d{2}:?\d{2})$/.test(normalized)) {
    normalized += '+09:00';
  }
  const t = Date.parse(normalized);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  // 날짜만 온 경우
  const m = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (m) {
    const t2 = Date.parse(`${m[0]}T00:00:00+09:00`);
    if (Number.isFinite(t2)) return new Date(t2).toISOString();
  }
  return null;
}

/** 응답 본문에서 목록을 꺼낸다 — data / data.content / 배열 그 자체 모두 대응 */
/**
 * 응답 속살의 '모양'만 한 줄로. 값은 남기지 않는다.
 * 봉투(code·message·data)까지만 찍으면 정작 data 안이 배열인지 객체인지 몰라
 * "비어 있다"와 "우리가 못 읽는다"를 구분할 수 없다.
 */
function describePayload(v: any, depth = 0): string {
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return `배열(${v.length})${v.length && depth < 2 ? `<${describePayload(v[0], depth + 1)}>` : ''}`;
  if (typeof v === 'object') {
    const keys = Object.keys(v).slice(0, 12);
    return depth < 2 ? `{${keys.map(k => `${k}:${describePayload(v[k], depth + 1)}`).join(',')}}` : `{${keys.join(',')}}`;
  }
  return typeof v;
}

function listOf(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  const d = payload?.data;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.content)) return d.content;
  if (Array.isArray(payload?.content)) return payload.content;
  return [];
}
/** 다음 페이지 토큰 */
function nextTokenOf(payload: any): string {
  const t = payload?.nextToken ?? payload?.data?.nextToken ?? payload?.token ?? payload?.data?.token;
  const s = t === undefined || t === null ? '' : String(t);
  return s && s !== '0' ? s : '';
}

// ═══════════════════════════════════════════════════════════════
// 엔드포인트
//   경로는 한곳에 모아 둔다. 쿠팡이 버전을 올리면 여기만 고치면 된다.
// ═══════════════════════════════════════════════════════════════
const EP = {
  sellerProducts: '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products',
  sellerProduct: (id: string) => `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${id}`,
  vendorItemPrice: (vendorItemId: string, price: number) =>
    `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/prices/${price}`,
  vendorItemInventory: (vendorItemId: string) =>
    `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/inventories`,
  // 교환요청은 v4만 있다. v1로 부르면 'No exactly matching API specification'으로 거절된다.
  exchangeRequests: (vendorId: string) => `/v2/providers/openapi/apis/api/v4/vendors/${vendorId}/exchangeRequests`,
  ordersheets: (vendorId: string) => `/v2/providers/openapi/apis/api/v4/vendors/${vendorId}/ordersheets`,
  revenueHistory: '/v2/providers/openapi/apis/api/v1/revenue-history',
  // 로켓그로스는 완전히 다른 창구다. 마켓플레이스 매출내역에는 한 건도 안 온다.
  rgOrders: (vendorId: string) => `/v2/providers/rg_open_api/apis/api/v1/vendors/${vendorId}/rg/orders`,
  // 로켓창고 재고 — 옵션별 판매가능수량과 쿠팡 자체 집계 30일 판매수
  rgInventory: (vendorId: string) => `/v2/providers/rg_open_api/apis/api/v1/vendors/${vendorId}/rg/inventory/summaries`,
  // 주문에 적용된 쿠폰. 그로스 주문에는 할인 항목이 없어 이걸로 묻는다.
  orderCoupons: (vendorId: string, orderId: string) =>
    `/v2/providers/fms/apis/api/v2/vendors/${vendorId}/${encodeURIComponent(orderId)}/coupons`,
  // 쿠폰 관리에 등록된 쿠폰 자체(즉시할인 정액·정률)와 그 쿠폰이 붙은 옵션들.
  // 목록은 v2, 옵션 목록은 v1이다. 버전이 갈려 있어 v1으로 목록을 부르면
  // 'Endpoint not found'로 떨어진다 — 권한 문제로 오해하기 쉽다.
  coupons: (vendorId: string, v = 'v2') => `/v2/providers/fms/apis/api/${v}/vendors/${vendorId}/coupons`,
  couponItems: (vendorId: string, couponId: string, v = 'v1') =>
    `/v2/providers/fms/apis/api/${v}/vendors/${vendorId}/coupons/${encodeURIComponent(couponId)}/items`,
  settlementHistories: '/v2/providers/marketplace_openapi/apis/api/v1/settlement-histories',
  returnRequests: (v: string, vendorId: string) => `/v2/providers/openapi/apis/api/${v}/vendors/${vendorId}/returnRequests`,
  onlineInquiries: (v: string, vendorId: string) => `/v2/providers/openapi/apis/api/${v}/vendors/${vendorId}/onlineInquiries`,
  inquiryReply: (v: string, vendorId: string, inquiryId: string) =>
    `/v2/providers/openapi/apis/api/${v}/vendors/${vendorId}/onlineInquiries/${inquiryId}/replies`,
};

// 발주서는 상태별로 조회해야 한다. 취소(CANCEL)는 매출이 아니므로 제외한다.
const ORDER_STATUSES = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY'];
// 반품요청도 상태별로만 조회된다. RU 출고중지요청 · UC 반품접수 · CC 반품완료 · PR 쿠팡확인요청
const RETURN_STATUSES = ['RU', 'UC', 'CC', 'PR'];

// 한 번의 동기화가 무한정 길어지지 않도록 상한을 둔다.
const LIMITS = {
  itemDetailPerRun: 120,   // 상품 상세는 건당 1호출이라 회차당 상한을 둔다
  pagesPerQuery: 40,       // 페이지네이션 폭주 방지
  ordersDaysFull: 30,
  ordersDaysIncr: 14,
  salesDaysFull: 60,
  salesDaysIncr: 45,
  returnsDaysFull: 60,
  returnsDaysIncr: 30,
  inquiryDays: 7,          // 문의 조회는 최대 7일 구간
  chunkDays: 30,           // 조회 구간 분할 단위
  rgDaysFull: 60,
  rgDaysIncr: 30,
  // 로켓그로스는 한 번에 30일까지 조회되지만, 하루 100건 파는 계정은 30일치가
  // 페이지 상한(40)을 넘겨 최근 며칠이 통째로 빠졌다. 7일씩 끊으면 구간당
  // 페이지가 넉넉하고, 잘려도 그 주만 다음 회차가 이어받는다.
  rgChunkDays: 7,
  rgGapMs: 1300,           // 분당 50회 한도. 1300ms면 약 46회/분으로 아래를 유지한다
  couponGapMs: 250,        // 주문별 쿠폰 조회 간격
  couponPerRun: 80,        // 회차당 쿠폰을 물을 주문 수. 나머지는 다음 회차가 이어받는다
  couponDefsPerRun: 40,    // 회차당 옵션 목록을 물을 쿠폰 수
  couponItemPages: 10,     // 쿠폰 하나의 옵션 목록 페이지 상한
};

export interface SyncSummary {
  items: number;
  orders: number;
  sales: number;
  /** 로켓그로스 매출 — 창구가 달라 마켓플레이스 매출과 따로 센다 */
  growth: number;
  /** 그로스 주문 중 취소라서 뺀 건수 */
  growthCancelled: number;
  /** 로켓창고 재고 행 수 */
  growthInventory: number;
  settlements: number;
  returns: number;
  inquiries: number;
  /** 쿠폰 관리에서 받아 온 쿠폰-옵션 조합 수 */
  couponDefs: number;
  /** 시간에 잘렸을 때 멈춘 단계(SYNC_STEPS 인덱스). 안 잘렸으면 null */
  stoppedAt: number | null;
  errors: string[];
  authFailed: boolean;
  /** 시간 예산에 걸려 중간에 멈췄다. 남은 몫은 다음 회차가 이어받는다. */
  truncated: boolean;
}

function emptySummary(): SyncSummary {
  return {
    items: 0, orders: 0, sales: 0, growth: 0, growthCancelled: 0, growthInventory: 0, settlements: 0, returns: 0, inquiries: 0, couponDefs: 0,
    errors: [], authFailed: false, truncated: false, stoppedAt: null,
  };
}

/** 남은 시간이 없으면 true. 각 수집 단계와 페이지 루프가 이 값을 본다. */
function outOfTime(deadline: number, sum: SyncSummary): boolean {
  if (Date.now() < deadline) return false;
  sum.truncated = true;
  return true;
}

/** 조회 구간을 chunkDays 단위로 쪼갠다 (쿠팡은 대부분 31일 이내만 허용) */
export function dateChunks(from: string, to: string, size = LIMITS.chunkDays): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let cur = from;
  while (daysBetween(cur, to) >= 0) {
    const end = daysBetween(cur, to) > size - 1 ? addDays(cur, size - 1) : to;
    out.push([cur, end]);
    cur = addDays(end, 1);
  }
  return out;
}

/**
 * 상한 없이 전부 읽는다.
 *
 * PostgREST는 한 요청에 기본 1000행까지만 돌려준다. 쿠팡 데이터는 날짜 × 옵션이라
 * 옵션 30개짜리 판매자도 한 달이면 그 벽에 닿는다. 상한에 걸린 걸 알려주지도
 * 않으므로, 순이익·재고·상관이 조용히 일부 데이터로만 계산되고 숫자가 어느
 * 시점부터 안 늘어나는 형태로 나타난다.
 *
 * 넘기는 방식은 range(OFFSET)이다. 예전 주석에는 "정렬 키를 주면 커서로
 * 넘긴다"고 적혀 있었는데 그런 코드는 없었다. 읽는 쪽이 그 말을 믿으면
 * 안 되므로 바로잡아 둔다.
 *
 * OFFSET은 읽는 도중 앞쪽 줄이 지워지면 뒤 페이지가 밀려 몇 줄을 건너뛴다.
 * 그 위험은 수집 쪽에서 없앴다 — 예전에는 구간을 통째로 지운 뒤 다시 넣어서
 * 그 사이에 읽으면 아예 비어 보였는데, 지금은 먼저 덮어쓰고 남은 것만 치운다.
 * 읽는 중에 줄이 사라지지 않으므로 페이지가 밀리지 않는다.
 *
 * 그래도 상한(maxPages × pageSize)에 닿으면 truncated로 알린다. 부르는 쪽이
 * 그걸 무시하면 조용히 일부만 계산된다.
 */
export async function selectAll<T = any>(
  build: (from: number, to: number) => any,
  pageSize = 1000,
  maxPages = 60,
): Promise<{ rows: T[]; truncated: boolean }> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    let res = await build(page * pageSize, (page + 1) * pageSize - 1);
    // 게이트웨이가 잠깐 늦어서 나는 타임아웃은 한 번 더 부르면 대개 지나간다.
    // 여기서 그냥 던지면 그 사용자의 그 회차 수집이 통째로 죽고, 다음 시간까지
    // 숫자가 한 시간 낡은 채로 남는다. 한 번만 다시 본다.
    if (res?.error && isTransientDbError(res.error)) {
      await new Promise(r => setTimeout(r, 1200));
      res = await build(page * pageSize, (page + 1) * pageSize - 1);
    }
    const { data, error } = res;
    // 어느 단계에서 났는지 밝힌다. 예전에는 "Gateway Timeout" 한 마디만 남아서,
    // 관리자 화면에 '쿠팡 수집' 딱지를 달고 뜨면 쿠팡이 늦은 것처럼 읽혔다.
    // 실제로는 우리 DB 조회가 늦은 것이다.
    if (error) throw new Error(`DB 조회 실패 (${page + 1}쪽${error.code ? `, ${error.code}` : ''}): ${error.message}`);
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < pageSize) return { rows: out, truncated: false };
  }
  // 상한까지 갔다면 더 있을 수 있다. 호출부가 판단하도록 알린다.
  return { rows: out, truncated: true };
}

/**
 * 대량 upsert — Supabase 요청 크기를 넘기지 않도록 잘라서 넣는다.
 *
 * 넣기 전에 기본키로 중복을 걷어낸다. Postgres는 한 번의 upsert 안에 같은 키가
 * 두 번 들어오면 "cannot affect row a second time"으로 그 배치 전체를 거부한다.
 * 쿠팡 응답은 조회 구간이 겹치거나 페이지가 되풀이될 때 같은 건이 두 번 오므로
 * 이 방어가 없으면 수집이 통째로 실패한다. 뒤에 온 값을 남긴다(더 최신).
 */
async function upsertChunked(table: string, rows: any[], onConflict: string): Promise<string | null> {
  if (!supabase || rows.length === 0) return null;

  const keyCols = onConflict.split(',').map(c => c.trim()).filter(Boolean);
  const deduped = new Map<string, any>();
  for (const row of rows) {
    deduped.set(keyCols.map(c => String(row[c] ?? '')).join('\u0000'), row);
  }
  const unique = [...deduped.values()];

  for (let i = 0; i < unique.length; i += 500) {
    const { error } = await supabase.from(table).upsert(unique.slice(i, i + 500), { onConflict });
    if (error) return `${table}: ${error.message}`;
  }
  return null;
}

// ── 상품(옵션) 동기화 ─────────────────────────────────────────
// 목록 조회로 등록상품을 훑고, 상세는 회차당 상한만큼만 가져온다.
// 상세를 오래 못 받은 상품부터 채우므로 몇 회차 안에 전체가 최신화된다.
/**
 * 발주서 한 품목의 쿠폰 할인.
 *
 * 판매가 39,800원에 즉시할인쿠폰 10,000원이면 실제로 받는 돈은 29,800원이다.
 * 발주서는 할인을 부담 주체별로 나눠 준다:
 *   discountPrice(총) = instantCouponDiscount + downloadableCouponDiscount + coupangDiscount
 * 앞 둘은 판매자 부담이라 매출에서 빠지고, coupangDiscount는 쿠팡이 메워 주므로 안 빠진다.
 * 부담 항목이 없고 총액만 있으면 전부 판매자 부담으로 본다 — 실매출을 크게 보는 쪽이
 * 작게 보는 쪽보다 나쁘다.
 * 금액이 { units, nanos } 객체로 오는 버전(v5)도 있어 둘 다 읽는다.
 */
export function sellerDiscountOf(item: any): { seller: number; coupang: number } {
  const money = (v: any): number => {
    if (v && typeof v === 'object' && 'units' in v) return Number(v.units) || 0;
    const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const instant = money(item?.instantCouponDiscount);
  const download = money(item?.downloadableCouponDiscount);
  const coupang = money(item?.coupangDiscount);
  const total = money(item?.discountPrice);
  let seller = instant + download;
  if (seller === 0 && coupang === 0 && total > 0) seller = total;
  return { seller: Math.max(0, seller), coupang: Math.max(0, coupang) };
}

/**
 * 한 상품 행의 쿠폰 할인 = 쿠폰 단가 × 그 행의 판매수량.
 *
 * 판매수량(매출인식일 기준)과 쿠폰(주문일 기준)은 같은 기간이라도 건수가 다르다.
 * 주문 기준 쿠폰 합계를 그대로 붙이면 7개 팔린 행에 37개 주문의 쿠폰이 붙어
 * 쿠폰이 매출을 넘는 숫자가 나온다. 쿠폰은 판매가 이하로만 설정되니 그럴 수 없다.
 * 주문에서는 단가(할인 ÷ 주문수량)만 뽑고, 그 행의 실제 판매수량에 곱한다.
 * 채널별로 단가가 다르므로 윙 수량에는 윙 단가를, 그로스 수량에는 그로스 단가를 쓴다.
 * 어떤 경우에도 매출을 넘지 않게 자른다.
 */
export function couponForRow(
  qtyMarket: number,
  qtyGrowth: number,
  wingUnit: number,
  growthUnit: number,
  cap: number,
): number {
  const raw = Math.round(qtyMarket * Math.max(0, wingUnit) + qtyGrowth * Math.max(0, growthUnit));
  return Math.max(0, Math.min(raw, Math.max(0, cap)));
}

/**
 * 주문에서 확인한 쿠폰으로 한 채널의 쿠폰 할인을 낸다.
 *
 * 예전에는 개당 평균(할인 합 ÷ 주문수량)을 내서 판매수량에 곱했다. 쿠폰을
 * 며칠마다 바꾸는 판매자는 평균이 16,024.34원 같은 소수가 되고, 거기에
 * 판매수량을 곱하니 총액이 921,002원처럼 2원 단위로 떨어졌다. 쿠폰은 10,000원·
 * 14,000원처럼 100원 단위로 발행되므로 그런 숫자는 나올 수 없고, 보는 사람은
 * 계산이 틀렸다고 읽는다.
 *
 * 확인한 주문의 할인 합은 쿠팡이 알려준 그대로라 정확하다. 그것을 그대로 쓰고,
 * 판매수량과 주문수량이 어긋나는 몫만 개당 값으로 보정한다. 보정에 쓰는 개당
 * 값은 100원 단위로 반올림한다 — 발행 단위가 그렇다.
 *
 *   주문수량 = 판매수량 → 합계 그대로 (정확)
 *   주문수량 < 판매수량 → 합계 + 개당 × 모자란 수량 (아직 안 물어본 주문 몫)
 *   주문수량 > 판매수량 → 합계 − 개당 × 남는 수량 (매출인식이 아직 안 된 주문 몫)
 *
 * @returns amount 이 채널의 쿠폰 할인, exact 보정 없이 합계를 그대로 썼는지
 */
/**
 * 반품 재판매 옵션인가.
 *
 * 로켓그로스는 반품된 물건을 새 옵션ID로 다시 판다. 판매자 상품 목록에는 없고
 * (그래서 status가 observed다), 옵션명 자리에는 쿠팡 내부 재판매 번호
 * (73074131 같은 8자리 숫자)만 오며, 값은 정가의 반 정도다. 판매자배송에는
 * 재판매가 없으므로 그로스만 본다.
 *
 * 화면에 '재판매'라고 적어 주지 않으면 "나시원피스 3종세트 / 73074131"로 떠서
 * 왜 이 줄만 단가가 반값인지 알 수 없다.
 */
export function isResaleOption(item: { status?: string | null; business_type?: string | null; option_name?: string | null } | null | undefined): boolean {
  if (!item) return false;
  if (item.status !== 'observed') return false;
  if (item.business_type !== 'growth') return false;
  return /^\d{6,}$/.test(String(item.option_name ?? '').trim());
}

export function couponFromCoverage(
  coveredDiscount: number,
  coveredQty: number,
  salesQty: number,
): { amount: number; exact: boolean } {
  const disc = Math.max(0, coveredDiscount);
  const cq = Math.max(0, coveredQty);
  const sq = Math.max(0, salesQty);
  if (sq === 0) return { amount: 0, exact: true };
  if (cq === 0) return { amount: 0, exact: false };
  if (cq === sq) return { amount: Math.round(disc), exact: true };
  const unit = Math.round(disc / cq / 100) * 100;
  return { amount: Math.max(0, Math.round(disc + unit * (sq - cq))), exact: false };
}

/** 쿠폰 관리에서 받아 둔 쿠폰-옵션 한 줄 */
export interface CouponDef {
  coupon_type: string | null;
  discount: number;
  max_discount: number | null;
  status: string | null;
  start_at: string | null;
  end_at: string | null;
}

/**
 * 쿠폰 설정으로 본 옵션의 개당 쿠폰 할인 — 이 기간의 하루 평균.
 *
 * 판매자가 쿠폰 관리에 등록한 값을 쓴다. 주문에서 역산한 값은 다운로드쿠폰이
 * 섞이거나 쿠폰을 바꾼 날이 끼면 들쭉날쭉해지는데, 설정값은 그럴 일이 없다.
 * - 정액(PRICE·FIXED·FIXED_WITH_QUANTITY)은 금액 그대로
 * - 정률(RATE·PERCENT)은 판매 단가 × 비율, 최대할인이 있으면 거기서 자른다
 * - 종료·삭제 상태는 뺀다
 *
 * 돌려주는 값은 [from, to] 하루하루의 평균이다. 부르는 쪽(couponForRow)이 이
 * 값에 기간 전체 판매수량을 곱하므로, 8일 중 2일만 걸려 있던 5,000원짜리는
 * 5,000이 아니라 1,250이어야 총 할인액이 맞는다. 8일 내내 5,000원이면 그대로
 * 5,000이다. 같은 날 두 쿠폰이 겹쳐 있으면 실제로 겹쳐 적용되므로 그날은 더한다.
 */
export function definitionUnit(defs: CouponDef[], unitPrice: number, from: string, to: string): number {
  if (!from || !to || from > to) return 0;

  // 날짜별로 가중해 평균을 낸다.
  //
  // 예전에는 기간에 걸치기만 하면 전부 더했다. 10일간 10,000원짜리를 걸고
  // 그다음 20일간 8,000원짜리를 건 옵션은 한 달 화면에서 18,000원으로 잡혔다.
  // 판매가가 39,800원이면 실매출이 절반으로 꺾이고, 정의가 셋이면 할인액이
  // 판매가를 넘어 실매출이 0원으로 보였다.
  //
  // 같은 날 두 쿠폰이 함께 걸려 있으면 실제로 겹쳐 적용되므로 그날은 더한다.
  // 더하는 것은 '같은 날'까지고, 서로 다른 시기는 평균으로 묶는다. 이 값에
  // 기간 전체 판매수량을 곱하므로, 날짜별 평균이 총 할인액에 가장 가깝다.
  const perDay = (day: string): number => {
    let sum = 0;
    for (const d of defs) {
      if (d.status && /EXPIRE|DELETE|CANCEL|END|PAUSE|STOP|만료|삭제|중지/i.test(d.status)) continue;
      const start = d.start_at ? String(d.start_at).slice(0, 10) : '';
      const end = d.end_at ? String(d.end_at).slice(0, 10) : '';
      // 시작일이 없으면 예전부터, 종료일이 없으면 앞으로도 계속 걸려 있는 것으로 본다
      if (start && start > day) continue;
      if (end && end < day) continue;
      const amount = Number(d.discount) || 0;
      if (amount <= 0) continue;
      if (/RATE|PERCENT|정률/i.test(d.coupon_type ?? '')) {
        let v = (unitPrice * amount) / 100;
        const cap = Number(d.max_discount) || 0;
        if (cap > 0) v = Math.min(v, cap);
        sum += v;
      } else {
        sum += amount;
      }
    }
    return sum;
  };

  let total = 0;
  let days = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    total += perDay(day);
    days += 1;
    if (days > 400) break; // 기간은 최대 365일이다. 무한 루프 방지용 빗장
  }
  if (days === 0) return 0;
  // 할인액이 판매가를 넘을 수는 없다. 넘으면 정의를 잘못 읽은 것이다.
  const avg = total / days;
  return Math.max(0, Math.min(Math.round(avg), Math.max(0, Math.round(unitPrice))));
}

/**
 * 옵션ID를 찾는다. 보통은 items[].vendorItemId 인데, 로켓그로스 상품은 그 자리가
 * 비어 있고 안쪽 객체에 들어 있을 수 있다. 한 단계 안쪽까지 이름에 vendorItemId가
 * 들어간 키를 찾는다. 값이 없으면 빈 문자열이다.
 */
export function findVendorItemId(item: any): string {
  if (!item || typeof item !== 'object') return '';
  const direct = pickStr(item, ['vendorItemId', 'vendorItemID']);
  if (direct) return direct;
  for (const [k, v] of Object.entries(item)) {
    if (/vendorItemId/i.test(k) && v !== null && v !== undefined && v !== '') return String(v);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = pickStr(v, ['vendorItemId', 'vendorItemID']);
      if (inner) return inner;
    }
  }
  return '';
}

/**
 * 등록상품 목록 질의문.
 *
 * nextToken은 값이 비어도 반드시 보낸다. 빼면 쿠팡이 오류 없이 빈 목록을 돌려줘
 * '상품 0건인데 오류도 없음'이 되고, 원가·재고·반품·가격 화면이 통째로 빈다.
 * 매출내역의 token과 같은 함정이다.
 */
export function sellerProductsQuery(vendorId: string, nextToken: string, businessTypes = ''): string {
  return (
    `vendorId=${vendorId}&nextToken=${nextToken}&maxPerPage=100` +
    (businessTypes ? `&businessTypes=${businessTypes}` : '')
  );
}

async function syncItems(userId: string, creds: CoupangCreds, sum: SyncSummary, deadline: number): Promise<void> {
  if (!supabase) return;

  const sellerProductIds: Array<{ id: string; name: string; status: string; businessType: string }> = [];
  const seenProductId = new Set<string>();
  let listingComplete = false;

  // 등록상품 목록을 한 바퀴 읽는다. businessTypes를 주면 그 판매방식만 온다.
  const listPage = async (
    businessTypes: string,
    businessType: string,
  ): Promise<{ ok: boolean; complete: boolean; error?: string }> => {
    let nextToken = '';
    for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
      if (outOfTime(deadline, sum)) return { ok: true, complete: false };
      // nextToken은 값이 비어도 반드시 보낸다. 빼면 쿠팡이 오류 없이 빈 목록을
      // 돌려줘 "상품 0건인데 오류도 없음"이 된다 — 매출내역의 token과 같은 함정이다.
      const query = sellerProductsQuery(creds.vendorId, nextToken, businessTypes);
      const r = await coupangCall(creds, 'GET', EP.sellerProducts, query);
      if (!r.ok) {
        if (r.authFailed) sum.authFailed = true;
        return { ok: false, complete: false, error: r.error };
      }
      for (const p of listOf(r.data)) {
        const id = pickStr(p, ['sellerProductId', 'sellerProductID']);
        if (!id || seenProductId.has(id)) continue;
        seenProductId.add(id);
        sellerProductIds.push({
          id,
          name: pickStr(p, ['sellerProductName', 'displayProductName', 'productName']),
          status: pickStr(p, ['statusName', 'status']),
          businessType,
        });
      }
      nextToken = nextTokenOf(r.data);
      if (!nextToken) return { ok: true, complete: true };
    }
    return { ok: true, complete: false };
  };

  // 로켓그로스를 먼저 훑는다. 순서가 뒤바뀌면 그로스 상품이 기본 목록에서
  // 먼저 잡혀 'marketplace'로 표시되고, 원가 입력에 입출고비 칸이 안 뜬다.
  // 이 조회가 실패해도 마켓플레이스 상품까지 버릴 이유는 없어 조용히 넘어가되,
  // 목록이 불완전해졌으니 아래 '사라진 상품 정리'는 하지 않는다.
  const growth = await listPage('rocketGrowth', 'growth');
  if (sum.authFailed) return;

  const base = await listPage('', 'marketplace');
  if (!base.ok) {
    sum.errors.push(`상품 목록: ${base.error}`);
    return;
  }
  listingComplete = base.complete && growth.ok && growth.complete;

  // 상세를 가져올 대상 — 아직 한 번도 못 받았거나 가장 오래된 것 우선
  const { rows: known } = await selectAll<{ seller_product_id: string | null; synced_at: string | null }>((f, t) =>
    supabase
      .from('coupang_items')
      .select('seller_product_id, synced_at')
      .eq('user_id', userId)
      .order('vendor_item_id').range(f, t));
  const lastSynced = new Map<string, string>();
  for (const k of known) lastSynced.set(String(k.seller_product_id), String(k.synced_at ?? ''));

  const ordered = [...sellerProductIds].sort(
    (a, b) => (lastSynced.get(a.id) ?? '').localeCompare(lastSynced.get(b.id) ?? ''),
  );

  const rows: any[] = [];
  let detailFailed = 0;
  let detailError = '';
  let firstDetailShape = '';
  let growthNoPriceLogged = false;
  for (const sp of ordered.slice(0, LIMITS.itemDetailPerRun)) {
    // 상세는 건당 1호출이라 여기서 시간이 가장 많이 든다. 예산이 끝나면
    // 지금까지 받은 것만 저장하고 나머지는 다음 회차가 이어받는다.
    if (Date.now() >= deadline) {
      sum.truncated = true;
      break;
    }
    const r = await coupangCall(creds, 'GET', EP.sellerProduct(sp.id), '');
    if (!r.ok) {
      if (r.authFailed) {
        sum.authFailed = true;
        return;
      }
      // 개별 상품 실패는 건너뛰고 다음 회차에 다시 시도한다. 다만 조용히 넘기면
      // 전부 실패했을 때 '상품 0건, 오류 없음'이 되어 원인을 알 수 없다.
      detailFailed += 1;
      if (!detailError) detailError = r.error ?? `HTTP ${r.status}`;
      continue;
    }
    const detail = (r.data as any)?.data ?? r.data;
    const productId = pickStr(detail, ['productId', 'displayProductId']);
    if (!firstDetailShape) {
      // 값은 남기지 않는다. 키 이름만 있어도 어디서 어긋났는지 보인다. 앞에서 잘라 버리면
      // 정작 찾는 키가 뒤에 있는지 없는지를 알 수 없다.
      const items = Array.isArray(detail?.items) ? detail.items : null;
      firstDetailShape =
        `키=${Object.keys(detail ?? {}).join(',')}` +
        ` / items=${items ? `${items.length}건` : '없음'}` +
        (items && items[0] ? ` / item키=${Object.keys(items[0]).join(',')}` : '');
    }
    for (const it of Array.isArray(detail?.items) ? detail.items : []) {
      const vendorItemId = findVendorItemId(it);
      if (!vendorItemId) continue;
      // 로켓그로스 상품은 여기 salePrice가 0으로 온다 (한 계정의 그로스 옵션 40개가
      // 전부 0이었다). 안쪽 객체에 있으면 거기서 찾고, 그래도 없으면 나중에
      // 최근 매출의 개당 금액으로 채운다 (backfillItemsFromObservations).
      let salePrice = pickNum(it, ['salePrice', 'originalPrice']);
      if (!(salePrice > 0) && sp.businessType === 'growth') {
        salePrice = deepPickNum(it, ['salePrice', 'originalPrice', 'rocketGrowthSalePrice']);
        if (!(salePrice > 0) && !growthNoPriceLogged) {
          growthNoPriceLogged = true;
          const nested = Object.entries(it ?? {})
            .filter(([, v]) => v && typeof v === 'object')
            .map(([k, v]) => `${k}{${Object.keys(v as object).join(',')}}`)
            .join(' ');
          console.info('coupang growth item without price —', `키=${Object.keys(it ?? {}).join(',')} / 안쪽=${nested || '없음'}`);
        }
      }
      rows.push({
        user_id: userId,
        vendor_item_id: vendorItemId,
        seller_product_id: sp.id,
        product_id: productId || null,
        product_name: sp.name || pickStr(detail, ['sellerProductName', 'displayProductName']),
        option_name: pickStr(it, ['itemName', 'vendorItemName', 'optionName']),
        sale_price: salePrice,
        stock: pickNum(it, ['maximumBuyCount', 'stockQuantity', 'quantity']),
        status: pickStr(it, ['saleStatus', 'itemStatus'], sp.status),
        business_type: sp.businessType,
        synced_at: new Date().toISOString(),
      });
    }
  }

  const err = await upsertChunked('coupang_items', rows, 'user_id,vendor_item_id');
  if (err) sum.errors.push(err);
  sum.items = rows.length;

  // 목록은 받았는데 상세가 전부 막혔다면 그건 넘어갈 일이 아니다. 원가·재고·
  // 반품·가격 화면이 통째로 비는데 화면에는 아무 이유도 안 뜬다.
  if (detailFailed > 0 && rows.length === 0) {
    sum.errors.push(`상품 상세: ${detailError} (${detailFailed}건 실패)`);
  } else if (rows.length === 0 && sellerProductIds.length > 0) {
    // 목록도 받고 상세도 받았는데 옵션ID가 하나도 없다. 응답 모양이 예상과
    // 다른 것이므로, 그 모양을 그대로 남겨 다음 수정의 단서로 삼는다.
    const growthCount = sellerProductIds.filter(sp => sp.businessType === 'growth').length;
    const shape = `목록 ${sellerProductIds.length}건(그로스 ${growthCount}) / 상세 ${firstDetailShape || '응답 없음'}`;
    console.warn('coupang items: no vendor items parsed —', shape);
    sum.errors.push(`상품 상세: 옵션ID를 하나도 찾지 못했습니다 [${shape}]`);
  }
  if (sellerProductIds.length === 0) {
    sum.errors.push('상품 목록: 쿠팡이 등록상품을 한 건도 주지 않았습니다. 윙에 판매중인 상품이 있는지 확인해주세요.');
  }

  // 목록에서 사라진 등록상품은 삭제됐거나 단종된 것이다. 남겨 두면 재고 화면과
  // 가격 규칙에 계속 등장하고, 자동 반영이 없는 상품에 매일 가격을 넣으려다
  // 실패 로그를 쌓는다. 목록을 끝까지 받은 회차에만 정리한다 — 중간에 끊긴
  // 목록으로 지우면 멀쩡한 상품이 사라진다.
  if (listingComplete && sellerProductIds.length > 0) {
    const keep = new Set(sellerProductIds.map(sp => sp.id));
    const { rows: existing } = await selectAll<{ vendor_item_id: string; seller_product_id: string | null }>((f, t) =>
      supabase
        .from('coupang_items')
        .select('vendor_item_id, seller_product_id')
        .eq('user_id', userId)
        .order('vendor_item_id').range(f, t));
    const gone = existing
      .filter(e => e.seller_product_id && !keep.has(String(e.seller_product_id)))
      .map(e => String(e.vendor_item_id));
    for (let i = 0; i < gone.length; i += 200) {
      const slice = gone.slice(i, i + 200);
      await supabase.from('coupang_items').delete().eq('user_id', userId).in('vendor_item_id', slice);
      await supabase.from('coupang_price_rules').delete().eq('user_id', userId).in('vendor_item_id', slice);
    }
  }
}

// ── 주문 동기화 (발주서) ──────────────────────────────────────
// 상태별로 나눠 조회하므로 같은 주문이 여러 번 잡힌다. orderId+옵션ID로
// 중복을 걷어낸 뒤 날짜별로 합산하고, 구간 전체를 통째로 덮어써 멱등하게 만든다.
async function syncOrders(userId: string, creds: CoupangCreds, from: string, to: string, sum: SyncSummary, deadline: number): Promise<void> {
  if (!supabase) return;

  const seen = new Set<string>();
  const agg = new Map<string, any>();
  let failedThisRun = false;
  // 발주서의 할인 항목은 의미가 애매하다(같은 상품인데 주문마다 개당 9천~1만9천원).
  // 쿠팡이 "이 주문에 적용된 쿠폰"을 직접 알려주는 주문별 쿠폰 조회를 윙에도 쓴다.
  const orderMeta = new Map<string, { date: string; status?: string; items: Array<{ vendorItemId: string; amount: number; qty: number; sheetDiscount?: number }> }>();
  let sampleLogged = false;

  for (const [cFrom, cTo] of dateChunks(from, to)) {
    for (const status of ORDER_STATUSES) {
      let nextToken = '';
      for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
        if (outOfTime(deadline, sum)) {
          failedThisRun = true; // 불완전한 결과로 구간을 덮어쓰지 않는다
          break;
        }
        const query =
          `createdAtFrom=${cFrom}&createdAtTo=${cTo}&status=${status}&maxPerPage=50` +
          (nextToken ? `&nextToken=${nextToken}` : '');
        const r = await coupangCall(creds, 'GET', EP.ordersheets(creds.vendorId), query);
        if (!r.ok) {
          if (r.authFailed) {
            sum.authFailed = true;
            return;
          }
          sum.errors.push(`발주서(${status}): ${r.error}`);
          failedThisRun = true;
          break;
        }
        for (const sheet of listOf(r.data)) {
          const orderId = pickStr(sheet, ['orderId', 'orderID']);
          const orderDate = pickDate(sheet, ['orderedAt', 'paidAt', 'createdAt']);
          if (!orderDate) continue;
          for (const it of Array.isArray(sheet?.orderItems) ? sheet.orderItems : []) {
            const vendorItemId = pickStr(it, ['vendorItemId', 'vendorItemID']);
            if (!vendorItemId) continue;
            const dedupe = `${orderId}:${vendorItemId}`;
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);

            const key = `${orderDate}:${vendorItemId}`;
            const qty = pickNum(it, ['shippingCount', 'quantity'], 1);
            const amount = pickNum(it, ['orderPrice', 'salesPrice', 'unitPrice']) || 0;
            const discount = sellerDiscountOf(it);
            const cur = agg.get(key) ?? {
              user_id: userId,
              order_date: orderDate,
              vendor_item_id: vendorItemId,
              product_id: pickStr(it, ['productId', 'displayProductId']) || null,
              product_name: pickStr(it, ['vendorItemName', 'sellerProductName', 'productName']),
              quantity: 0,
              order_amount: 0,
              seller_discount: 0,
              coupang_discount: 0,
            };
            cur.quantity += qty;
            cur.order_amount += amount;
            cur.seller_discount += discount.seller;
            cur.coupang_discount += discount.coupang;

            if (orderId) {
              // 발주서 상태(결제완료·상품준비중…)를 같이 둔다. 쿠폰 조회가 500으로
              // 막힐 때 어느 상태의 주문이 그러는지 로그에서 보기 위해서다.
              const meta = orderMeta.get(orderId) ?? { date: orderDate, status, items: [] };
              // 발주서가 말한 판매자 쿠폰. 주문별 쿠폰 조회가 500으로 막힐 때 이 값으로 대신한다.
              meta.items.push({ vendorItemId, amount, qty, sheetDiscount: discount.seller });
              orderMeta.set(orderId, meta);
            }
            // 발주서 할인 항목의 실제 모양을 한 번만 남긴다 (금액만, 개인정보 없음)
            if (!sampleLogged && discount.seller > 0) {
              sampleLogged = true;
              console.info('coupang ordersheet discount sample —', JSON.stringify({
                qty, orderPrice: it?.orderPrice, salesPrice: it?.salesPrice, discountPrice: it?.discountPrice,
                instantCouponDiscount: it?.instantCouponDiscount, downloadableCouponDiscount: it?.downloadableCouponDiscount,
                coupangDiscount: it?.coupangDiscount,
              }));
            }
            agg.set(key, cur);
          }
        }
        nextToken = nextTokenOf(r.data);
        if (!nextToken) break;
      }
    }
  }

  // 이 회차의 도장. 새로 넣는 줄에 전부 같은 값을 찍고, 나중에 이 값보다
  // 오래된 줄만 치운다. '지우고 다시 넣기'가 아니라 '덮어쓰고 남은 것 치우기'다.
  const batchAt = new Date().toISOString();
  const rows = [...agg.values()].map(r => ({ ...r, updated_at: batchAt }));

  // 순서가 중요하다. 예전에는 구간을 통째로 지운 뒤 넣었는데, 그 사이에 화면을
  // 열면 그 기간 매출이 0원으로 보였다. 수집은 20시간마다 돌고 몇 초 걸리므로
  // 자주는 아니지만, 하필 그때 본 사람에게는 장부가 비어 있다. 먼저 덮어쓰면
  // 어느 순간에도 줄이 사라지지 않는다.
  const err = await upsertChunked('coupang_orders_daily', rows, 'user_id,order_date,vendor_item_id');
  if (err) sum.errors.push(err);
  sum.orders = rows.length;

  // 쿠팡에서 사라진 줄만 치운다. 중간에 한 번이라도 실패했으면 지금 모은 값이
  // 불완전하므로 치우지 않는다 — 멀쩡하던 과거 데이터가 날아간다.
  if (!failedThisRun && !err) {
    await supabase
      .from('coupang_orders_daily')
      .delete()
      .eq('user_id', userId)
      .gte('order_date', from)
      .lte('order_date', to)
      .lt('updated_at', batchAt);
  }

  // 윙 주문도 쿠팡의 주문별 쿠폰 조회로 확인한다. 발주서 할인 항목보다 이쪽이 명확하다.
  await syncOrderCoupons(userId, creds, orderMeta, 'marketplace', sum, deadline);
}

// ── 매출 동기화 (매출내역) ────────────────────────────────────
// 매출인식일(구매확정 또는 배송완료+3일) 기준이라 주문일보다 늦다.
// 수수료·정산예정액이 여기에만 있어 순이익 계산의 근거가 된다.
/**
 * 매출내역 조회 질의문.
 *
 * token은 값이 비어도 반드시 보내야 한다. 빼면 쿠팡이 'token cannot be null'로
 * 거절해 매출이 한 건도 안 들어온다. 주문은 멀쩡히 들어오므로 "일부만 안 되네"로
 * 보이지 원인이 드러나지 않는다.
 * 쿠팡 공식 예시도 첫 조회에 token= 을 빈 값으로 붙인다:
 *   ...?vendorId=A00012345&recognitionDateFrom=...&recognitionDateTo=...&token=&maxPerPage=
 */
export function revenueHistoryQuery(vendorId: string, from: string, to: string, token: string): string {
  return `vendorId=${vendorId}&recognitionDateFrom=${from}&recognitionDateTo=${to}&token=${token}&maxPerPage=100`;
}

async function syncSales(userId: string, creds: CoupangCreds, from: string, to: string, sum: SyncSummary, deadline: number): Promise<void> {
  if (!supabase) return;

  const agg = new Map<string, any>();
  let failedThisRun = false;

  for (const [cFrom, cTo] of dateChunks(from, to)) {
    let token = '';
    for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
      if (outOfTime(deadline, sum)) {
        failedThisRun = true; // 불완전한 결과로 구간을 덮어쓰지 않는다
        break;
      }
      const query = revenueHistoryQuery(creds.vendorId, cFrom, cTo, token);
      const r = await coupangCall(creds, 'GET', EP.revenueHistory, query);
      if (!r.ok) {
        if (r.authFailed) {
          sum.authFailed = true;
          return;
        }
        sum.errors.push(`매출내역: ${r.error}`);
        failedThisRun = true;
        break;
      }
      for (const entry of listOf(r.data)) {
        const saleDate = pickDate(entry, ['recognitionDate', 'saleDate', 'salesDate']);
        // 매출내역은 건별 항목이 items 배열에 들어오거나, 평평하게 오기도 한다.
        const items = Array.isArray(entry?.items) ? entry.items : [entry];
        for (const it of items) {
          const vendorItemId = pickStr(it, ['vendorItemId', 'vendorItemID']);
          const date = pickDate(it, ['recognitionDate', 'saleDate', 'salesDate']) || saleDate;
          if (!vendorItemId || !date) continue;

          const key = `${date}:${vendorItemId}`;
          const cur = agg.get(key) ?? {
            user_id: userId,
            sale_date: date,
            vendor_item_id: vendorItemId,
            product_name: pickStr(it, ['vendorItemName', 'productName', 'sellerProductName']),
            channel: 'marketplace',
            quantity: 0,
            sales_amount: 0,
            commission: 0,
            settlement_amount: 0,
          };
          cur.quantity += pickNum(it, ['quantity', 'saleCount', 'shippingCount'], 0);
          // saleAmount(금액)가 있으면 그것, 없으면 단가 × 수량. 단가를 먼저 집으면
          // 한 행에 수량이 2 이상일 때 매출이 그만큼 덜 잡힌다.
          cur.sales_amount +=
            pickNum(it, ['saleAmount', 'totalSalePrice', 'settlementTargetAmount'], 0) ||
            pickNum(it, ['salePrice'], 0) * (pickNum(it, ['quantity', 'saleCount', 'shippingCount'], 0) || 1);
          // 수수료는 음수로 오는 경우가 있어 절대값으로 통일한다.
          cur.commission += Math.abs(pickNum(it, ['serviceFee', 'commission', 'saleCommission', 'coupangCommission'], 0));
          cur.settlement_amount += pickNum(it, ['settlementAmount', 'settleAmount', 'payoutAmount'], 0);
          agg.set(key, cur);
        }
      }
      token = nextTokenOf(r.data);
      if (!token) break;
    }
  }

  // 정산예정액이 응답에 없으면 판매금액 − 수수료로 채운다.
  const batchAt = new Date().toISOString();
  const rows = [...agg.values()].map(r => ({
    ...r,
    settlement_amount: r.settlement_amount || Math.max(0, r.sales_amount - r.commission),
    updated_at: batchAt,
  }));

  // 주문과 같은 이유로 먼저 덮어쓰고 나중에 치운다 — 지운 뒤 넣으면 그 사이에
  // 화면을 연 사람에게 그 기간 매출이 0원으로 보인다.
  const err = await upsertChunked('coupang_sales_daily', rows, 'user_id,sale_date,vendor_item_id,channel');
  if (err) sum.errors.push(err);
  sum.sales = rows.length;

  // 쿠팡에서 사라진 줄만 치운다. 실패한 회차에는 치우지 않는다.
  if (!failedThisRun && !err) {
    await supabase
      .from('coupang_sales_daily')
      .delete()
      .eq('user_id', userId)
      // 채널을 좁히지 않으면 마켓플레이스 재수집이 같은 기간의 그로스 행까지
      // 쓸어버린다. 그로스는 조회 창구가 달라 이 회차에서 다시 채워지지 않는다.
      .eq('channel', 'marketplace')
      .gte('sale_date', from)
      .lte('sale_date', to)
      .lt('updated_at', batchAt);
  }
}

// ── 로켓그로스 매출 동기화 ────────────────────────────────────
//
// 로켓그로스는 rg_open_api라는 별도 창구로만 조회된다. 마켓플레이스 매출내역
// (revenue-history)에는 한 건도 들어오지 않아, 그로스 매출이 통째로 빠져 있었다.
//
// 회계 기준이 마켓플레이스와 다르다는 점이 중요하다.
//   마켓플레이스 — 매출인식일 기준, 정산예정액이 확정값으로 온다
//   로켓그로스   — 주문만 조회되므로 결제일 기준이고, 수수료·물류비는 오지 않는다
// 그래서 channel을 나눠 저장하고 화면에서도 따로 보여준다. 한 통에 부으면
// 성격이 다른 숫자가 소리 없이 섞인다.
//
// 이 API의 규칙 (실제 호출로 확인된 것들)
//   · 날짜는 하이픈 없는 yyyyMMdd다. 2026-08-10처럼 보내면 Bad Request다
//   · 파라미터는 paidDateFrom / paidDateTo이고 maxPerPage는 받지 않는다
//   · paidDateTo는 사실상 포함되지 않아, from == to로 하루만 조회하면 항상 빈
//     결과가 온다. 그래서 구간을 하루 넉넉히 잡고 응답의 paidAt으로 날짜를 가른다
//   · 분당 50회, 한 번에 30일까지
//   · X-MARKET 헤더 필수 (coupangCall에 공통으로 넣어 뒀다)

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 2026-08-10 → 20260810. 이 API만 하이픈 없는 형식을 받는다. */
export function rgDate(iso: string): string {
  return iso.replace(/-/g, '');
}

/**
 * 로켓그로스 주문 질의문.
 *
 * 날짜는 하이픈 없는 yyyyMMdd이고, 파라미터는 paidDateFrom/paidDateTo다.
 * maxPerPage는 받지 않는다 — 붙이면 Bad Request로 거절당한다.
 */
export function rgOrdersQuery(from: string, to: string, token: string): string {
  return `paidDateFrom=${rgDate(from)}&paidDateTo=${rgDate(to)}` + (token ? `&nextToken=${token}` : '');
}

/** epoch millis(또는 날짜 문자열) → 한국 날짜 YYYY-MM-DD */
function kstDateOf(value: unknown): string | null {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,}$/.test(value))) {
    const ms = Number(value);
    if (!Number.isFinite(ms)) return null;
    // 초 단위로 오는 경우도 방어한다
    const t = ms < 1e12 ? ms * 1000 : ms;
    return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
  // 문자열로 오는 경우 — pickDate가 이미 한국 날짜 문자열을 그대로 뽑아 준다
  return pickDate({ v: value }, ['v']);
}


async function syncRocketGrowth(
  userId: string,
  creds: CoupangCreds,
  from: string,
  to: string,
  sum: SyncSummary,
  deadline: number,
): Promise<void> {
  if (!supabase) return;

  const agg = new Map<string, any>();
  let failedThisRun = false;
  let lastCallAt = 0;
  let cancelled = 0;
  let firstOrderShape = '';
  const hourHist: Record<number, number> = {};
  const orderKeyUnion = new Set<string>();
  const itemKeyUnion = new Set<string>();
  // 주문별 쿠폰을 물으려면 주문번호와 옵션별 금액이 필요하다
  const orderMeta = new Map<string, { date: string; status?: string; items: Array<{ vendorItemId: string; amount: number; qty: number; sheetDiscount?: number }> }>();

  const call = async (cFrom: string, cTo: string, token: string) => {
    // 분당 50회 한도를 지킨다. 몰아 치면 429가 나고, 그 회차 그로스 매출이 빈다.
    const wait = LIMITS.rgGapMs - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    return coupangCall(creds, 'GET', EP.rgOrders(creds.vendorId), rgOrdersQuery(cFrom, cTo, token));
  };

  for (const [cFrom, cTo] of dateChunks(from, to, LIMITS.rgChunkDays)) {
    // 종료일이 포함되지 않으므로 하루 더 요청하고, 넘어온 건은 아래에서 걸러낸다
    const queryTo = addDays(cTo, 1);
    let token = '';
    for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
      if (outOfTime(deadline, sum)) {
        failedThisRun = true;
        break;
      }

      const r = await call(cFrom, queryTo, token);
      if (!r.ok) {
        if (r.authFailed) {
          sum.authFailed = true;
          return;
        }
        // 로켓그로스를 안 쓰는 판매자는 권한이 없어 실패한다. 이건 고장이 아니라
        // 해당 없음이므로 오류 목록에 올려 불안하게 만들지 않는다.
        if (r.status === 403 || r.status === 404) return;
        sum.errors.push(`그로스 매출: ${r.error}`);
        failedThisRun = true;
        break;
      }

      for (const order of listOf(r.data)) {
        // 취소된 주문은 매출이 아니다. 윙 판매자센터의 매출은 취소를 뺀 숫자라,
        // 여기서 안 빼면 우리 숫자가 항상 더 크게 나온다.
        const orderStatus = pickStr(order, ['orderStatus', 'status', 'receiptStatus', 'cancelStatus']);
        if (/CANCEL|취소|REFUND|환불/i.test(orderStatus)) {
          cancelled += 1;
          continue;
        }
        const orderDate = kstDateOf(order?.paidAt ?? order?.paidDate ?? order?.orderedAt ?? order?.createdAt);
        const items = Array.isArray(order?.orderItems)
          ? order.orderItems
          : Array.isArray(order?.items) ? order.items : [order];
        for (const k of Object.keys(order ?? {})) orderKeyUnion.add(k);
        for (const it of items) for (const k of Object.keys(it ?? {})) itemKeyUnion.add(k);
        if (!firstOrderShape) {
          // 키를 전부 남긴다 — 취소 여부를 담은 키가 있는지 봐야 한다. 한 계정의
          // 그로스 판매수가 쿠팡 자체 30일 집계보다 30% 많았는데, 주문 응답에
          // 상태 키가 안 보여 취소 주문을 못 거른 것이 첫 번째 의심이다.
          // paidAt은 값의 형태(epoch인지 문자열인지)와 그걸 한국 날짜로 바꾼 결과를
          // 같이 남긴다. 시간대를 잘못 읽으면 저녁 주문이 다음 날로 넘어간다.
          const paidRaw = order?.paidAt ?? order?.paidDate;
          firstOrderShape = `주문키=${Object.keys(order ?? {}).join(',')}` +
            (items[0] ? ` / 항목키=${Object.keys(items[0]).join(',')}` : '') +
            ` / paidAt=${typeof paidRaw}:${String(paidRaw).slice(0, 40)}→${kstDateOf(paidRaw)}`;
          console.info('coupang rg order shape —', firstOrderShape);
        }
        {
          // 결제 시각의 한국 시간대 분포. 손님은 낮에 주문하는데 새벽에 몰려 있으면
          // 시간대를 잘못 읽은 것이다.
          const raw = order?.paidAt ?? order?.paidDate;
          const ms = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\d{10,}$/.test(raw) ? Number(raw) : NaN);
          if (Number.isFinite(ms)) {
            const h = new Date((ms < 1e12 ? ms * 1000 : ms) + 9 * 3600 * 1000).getUTCHours();
            hourHist[h] = (hourHist[h] ?? 0) + 1;
          }
        }
        for (const it of items) {
          const vendorItemId = pickStr(it, ['vendorItemId', 'vendorItemID']);
          const date = kstDateOf(it?.paidAt) || orderDate;
          // 종료일을 하루 넘겨 요청했으니 이 구간 밖은 버린다. 전체 기간이 아니라
          // 구간 경계로 걸러야 한다 — 다음 구간의 첫날이 두 번 집계된다.
          if (!vendorItemId || !date || date < cFrom || date > cTo) continue;

          const key = `${date}:${vendorItemId}`;
          const cur = agg.get(key) ?? {
            user_id: userId,
            sale_date: date,
            vendor_item_id: vendorItemId,
            product_name: pickStr(it, ['productName', 'vendorItemName', 'sellerProductName']),
            channel: 'growth',
            quantity: 0,
            sales_amount: 0,
            commission: 0,
            settlement_amount: 0,
          };
          // 수량 × 개당 판매가. unitSalesPrice는 "4900.0" 같은 문자열로 온다.
          const qty = pickNum(it, ['salesQuantity', 'shippingCount', 'quantity'], 0);
          const unit = pickNum(it, ['unitSalesPrice', 'salePrice', 'unitPrice'], 0);
          const lineAmount = pickNum(it, ['orderPrice', 'totalSalePrice'], 0) || qty * unit;
          cur.quantity += qty;
          cur.sales_amount += lineAmount;
          agg.set(key, cur);

          const orderId = pickStr(order, ['orderId', 'orderID']);
          if (orderId) {
            const meta = orderMeta.get(orderId) ?? { date, items: [] };
            meta.items.push({ vendorItemId, amount: lineAmount, qty });
            orderMeta.set(orderId, meta);
          }
        }
      }

      token = nextTokenOf(r.data);
      if (!token) break;
    }
    // 페이지 상한에 걸려 이 구간을 다 못 받았다. 불완전한 결과로 덮어쓰고 지우면
    // 멀쩡하던 최근 며칠 매출이 사라진다 — 실제로 한 계정의 그로스 매출이 특정
    // 날짜 이후 통째로 비었다. 잘린 것으로 기록해 정리 단계를 건너뛰고, 다음
    // 회차가 이어받게 한다.
    if (token && !failedThisRun) {
      failedThisRun = true;
      const msg = '그로스 매출: 주문이 많아 이번 회차에 다 받지 못했습니다 (다음 회차 이어받음)';
      if (!sum.errors.includes(msg)) sum.errors.push(msg);
    }
    if (failedThisRun) break;
  }

  if (Object.keys(hourHist).length > 0) {
    // 첫 주문의 키만 보면 취소 주문에만 붙는 키를 놓친다. 전체 합집합을 남긴다.
    console.info('coupang rg order keys(all) —', `주문=${[...orderKeyUnion].join(',')} / 항목=${[...itemKeyUnion].join(',')}`);
    console.info('coupang rg order hours(KST) —', Object.entries(hourHist).sort((a, b) => Number(a[0]) - Number(b[0])).map(([h, n]) => `${h}시:${n}`).join(' '), `/ 취소로 뺀 주문 ${cancelled}건`);
  }

  // [임시] 취소 정보를 주는 그로스 API를 찾는다. 문서가 이 망에서 막혀 있어
  // 후보 경로를 직접 두드려 본다. app_config.rg_cancel_probe가 있을 때 한 번만
  // 돌고 스스로 지운다. 값은 남기지 않고 상태·문구·키만 남긴다.
  await rgCancelProbe(creds, orderMeta, to, deadline);

  // 쿠폰을 먼저 채운다. 수수료가 쿠폰을 뺀 실결제액에 붙기 때문이다.
  // 예전에는 매출을 먼저 쓰고 쿠폰을 나중에 채워서, 수수료를 계산할 때 이번
  // 회차의 쿠폰을 알 수 없었다.
  await syncOrderCoupons(userId, creds, orderMeta, 'growth', sum, deadline);

  // 수수료와 정산예정액은 이 API로 오지 않아 우리가 만든다.
  //
  // 예전에는 윙 실적에서 뽑은 요율을 주문금액에 그대로 곱했다. 두 군데가
  // 틀렸다. ① 쿠팡 수수료는 쿠폰을 뺀 실결제액에 붙는데 분모가 주문금액이라
  // 요율이 절반으로 보였다. ② 쿠폰이 아예 빠지지 않아 정산예정액이 부풀었다.
  // 쿠폰을 많이 쓰는 판매자일수록 순이익이 크게 어긋났다.
  const { rows: couponRows } = await selectAll<{ sale_date: string; vendor_item_id: string; discount: number }>((f, t) =>
    supabase!
      .from('coupang_order_coupons')
      .select('sale_date, vendor_item_id, discount')
      .eq('user_id', userId)
      .eq('channel', 'growth')
      .gte('sale_date', from)
      .lte('sale_date', to)
      .order('sale_date').range(f, t));

  const couponByKey = new Map<string, number>();
  for (const c of couponRows) {
    const key = `${String(c.sale_date).slice(0, 10)}:${c.vendor_item_id}`;
    couponByKey.set(key, (couponByKey.get(key) ?? 0) + (Number(c.discount) || 0));
  }

  const batchAt = new Date().toISOString();
  // 취소를 뺀다. 주문 API가 취소를 안 주므로 판매분석 파일이 있는 날은 그 값으로,
  // 없는 날은 쿠팡 30일 집계에서 나온 옵션별 취소율로 추정한다.
  const cancels = await loadGrowthCancelBasis(userId, from, to);
  const rows = [...agg.values()].map(r => {
    const coupon = couponByKey.get(`${r.sale_date}:${r.vendor_item_id}`) ?? 0;
    return { ...applyGrowthCancel(r, coupon, cancels), updated_at: batchAt };
  });

  // 윙과 같은 이유로 먼저 덮어쓰고 나중에 치운다. 이 판매자는 매출의 여덟 할이
  // 그로스라, 지운 뒤 넣는 사이에 화면을 열면 장부가 거의 비어 보인다.
  const err = await upsertChunked('coupang_sales_daily', rows, 'user_id,sale_date,vendor_item_id,channel');
  if (err) sum.errors.push(err);
  sum.growth = rows.length;

  // 쿠팡에서 사라진 줄만 치운다. 실패한 회차에는 치우지 않는다 —
  // 불완전한 결과로 덮으면 매출이 준다.
  if (!failedThisRun && !err) {
    await supabase
      .from('coupang_sales_daily')
      .delete()
      .eq('user_id', userId)
      .eq('channel', 'growth')
      .gte('sale_date', from)
      .lte('sale_date', to)
      .lt('updated_at', batchAt);
  }
  sum.growthCancelled = cancelled;
}

// ── 그로스 취소 반영 ──────────────────────────────────────────
//
// 로켓그로스 주문 API는 결제된 주문만 주고 취소 여부는 주지 않는다 (응답 키가
// vendorId·orderId·paidAt·orderItems 네 개뿐이고, 취소 조회 API는 판매자배송만
// 돌려준다 — 후보 경로를 전부 두드려 확인했다). 그래서 우리 숫자는 쿠팡 판매
// 분석의 '총 매출·총 판매수'(취소 전)와 같고, 화면의 '매출'(취소 뺀 값)보다 크다.
//
// 두 가지로 뺀다.
//   1) 판매분석 파일: 옵션별 '총 취소된 상품수·취소 금액'을 그 날짜에 그대로 적용 (정확)
//   2) 추정: 재고 API가 주는 옵션별 '최근 30일 판매수'(취소 뺀 값)와 우리 30일
//      결제 수량의 비율을 취소율로 잡는다 (날짜별로는 어긋날 수 있다)
// quantity·sales_amount는 취소를 뺀 값이고 원래 값은 gross_*에 남긴다. 순이익·
// 추이·리포트가 전부 quantity를 읽으므로 여기서 한 번 빼면 어디서나 반영된다.

interface GrowthCancelBasis {
  /** 파일로 올린 정확한 취소 — key: date:vendorItemId */
  file: Map<string, { qty: number; amount: number }>;
  /** 옵션별 추정 취소율 (0~0.9) */
  ratio: Map<string, number>;
  /** 옵션별 30일 표본이 작을 때 쓰는 계정 전체 취소율 */
  overallRatio: number;
}

async function loadGrowthCancelBasis(userId: string, from: string, to: string): Promise<GrowthCancelBasis> {
  const empty: GrowthCancelBasis = { file: new Map(), ratio: new Map(), overallRatio: 0 };
  if (!supabase) return empty;
  const today = kstToday();
  const [fileRes, invRes, salesRes] = await Promise.all([
    selectAll<any>((f, t) => supabase!.from('coupang_growth_cancels_daily')
      .select('sale_date, vendor_item_id, cancel_qty, cancel_amount')
      .eq('user_id', userId).gte('sale_date', from).lte('sale_date', to).order('sale_date').range(f, t)),
    selectAll<any>((f, t) => supabase!.from('coupang_growth_inventory')
      .select('vendor_item_id, sales_30d, synced_at').eq('user_id', userId).order('vendor_item_id').range(f, t)),
    // 쿠팡 30일 집계와 같은 창: 재고를 받은 날의 전날부터 30일
    selectAll<any>((f, t) => supabase!.from('coupang_sales_daily')
      .select('vendor_item_id, sale_date, quantity, gross_quantity')
      .eq('user_id', userId).eq('channel', 'growth')
      .gte('sale_date', addDays(today, -31)).lte('sale_date', addDays(today, -1))
      .order('sale_date').range(f, t)),
  ]);
  for (const r of fileRes.rows) {
    empty.file.set(`${String(r.sale_date).slice(0, 10)}:${r.vendor_item_id}`, {
      qty: Number(r.cancel_qty) || 0, amount: Number(r.cancel_amount) || 0,
    });
  }
  const gross30 = new Map<string, number>();
  for (const r of salesRes.rows) {
    const id = String(r.vendor_item_id);
    // gross_quantity가 없는 옛 행은 quantity가 곧 총 수량이다
    const g = r.gross_quantity === null || r.gross_quantity === undefined ? Number(r.quantity) || 0 : Number(r.gross_quantity) || 0;
    gross30.set(id, (gross30.get(id) ?? 0) + g);
  }
  let netAll = 0;
  let grossAll = 0;
  for (const inv of invRes.rows) {
    const id = String(inv.vendor_item_id);
    const net = inv.sales_30d === null || inv.sales_30d === undefined ? null : Number(inv.sales_30d) || 0;
    const gross = gross30.get(id) ?? 0;
    if (net === null || gross <= 0) continue;
    netAll += Math.min(net, gross);
    grossAll += gross;
    // 표본이 열 개는 넘어야 옵션별 비율을 믿는다. 그 아래는 계정 전체 비율을 쓴다.
    if (gross >= 10) empty.ratio.set(id, Math.min(0.9, Math.max(0, 1 - net / gross)));
  }
  empty.overallRatio = grossAll > 0 ? Math.min(0.9, Math.max(0, 1 - netAll / grossAll)) : 0;
  return empty;
}

/** 그로스 매출 행 하나에 취소를 적용한다. r은 취소 전(gross) 값이어야 한다 */
function applyGrowthCancel(
  r: { sale_date: string; vendor_item_id: string; quantity: number; sales_amount: number; [k: string]: any },
  coupon: number,
  basis: GrowthCancelBasis,
) {
  const grossQty = Math.max(0, Number(r.quantity) || 0);
  const grossAmt = Math.max(0, Number(r.sales_amount) || 0);
  const file = basis.file.get(`${r.sale_date}:${r.vendor_item_id}`);
  let cancelQty = 0;
  let cancelAmt = 0;
  let source: string | null = null;
  if (file) {
    cancelQty = Math.min(grossQty, file.qty);
    cancelAmt = Math.min(grossAmt, file.amount);
    source = 'file';
  } else {
    const ratio = basis.ratio.get(String(r.vendor_item_id)) ?? basis.overallRatio;
    if (ratio > 0 && grossQty > 0) {
      cancelQty = Math.min(grossQty, Math.round(grossQty * ratio));
      cancelAmt = Math.round(grossAmt * (cancelQty / grossQty));
      source = 'estimate';
    }
  }
  const netQty = grossQty - cancelQty;
  const netAmt = grossAmt - cancelAmt;
  // 취소된 주문의 쿠폰도 같이 빠진다. 주문별로는 모르니 비율로 줄인다.
  const netCoupon = grossQty > 0 ? Math.round(coupon * (netQty / grossQty)) : coupon;
  const { commission, settlement } = growthSettlement(netAmt, netCoupon);
  return {
    ...r,
    quantity: netQty, sales_amount: netAmt,
    gross_quantity: grossQty, gross_amount: grossAmt,
    cancel_quantity: cancelQty, cancel_amount: cancelAmt, cancel_source: source,
    commission, settlement_amount: settlement,
  };
}

/**
 * 판매분석 파일(옵션별)로 올린 취소를 저장하고 그 날짜의 그로스 매출에 바로 적용한다.
 * body: { date, rows: [{ vendorItemId, cancelQty, cancelAmount, grossQty, grossAmount }] }
 */
async function handleGrowthCancelUpload(userId: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const date = String(req.body?.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '날짜가 필요합니다.' });
  const input = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (input.length === 0) return res.status(400).json({ error: '로켓그로스 줄이 없습니다.' });
  if (input.length > 2000) return res.status(400).json({ error: '한 번에 2000줄까지 올릴 수 있습니다.' });
  const n = (v: any) => Math.max(0, Math.round(Math.abs(Number(v) || 0)));
  const rows = input
    .map((r: any) => ({
      user_id: userId, sale_date: date, vendor_item_id: String(r.vendorItemId ?? '').trim(),
      cancel_qty: n(r.cancelQty), cancel_amount: n(r.cancelAmount),
      gross_qty: r.grossQty === undefined ? null : n(r.grossQty), gross_amount: r.grossAmount === undefined ? null : n(r.grossAmount),
      uploaded_at: new Date().toISOString(),
    }))
    .filter((r: any) => r.vendor_item_id);
  const err = await upsertChunked('coupang_growth_cancels_daily', rows, 'user_id,sale_date,vendor_item_id');
  if (err) return res.status(500).json({ error: `저장하지 못했습니다: ${err}` });

  // 그 날짜의 그로스 매출 행에 바로 적용한다. 다음 수집을 기다리지 않는다.
  const { rows: sales } = await selectAll<any>((f, t) => supabase!.from('coupang_sales_daily')
    .select('*').eq('user_id', userId).eq('channel', 'growth').eq('sale_date', date).order('vendor_item_id').range(f, t));
  const { rows: couponRows } = await selectAll<any>((f, t) => supabase!.from('coupang_order_coupons')
    .select('vendor_item_id, discount').eq('user_id', userId).eq('channel', 'growth').eq('sale_date', date)
    .order('vendor_item_id').range(f, t));
  const couponBy = new Map<string, number>();
  for (const c of couponRows) couponBy.set(String(c.vendor_item_id), (couponBy.get(String(c.vendor_item_id)) ?? 0) + (Number(c.discount) || 0));
  const basis = await loadGrowthCancelBasis(userId, date, date);
  const updated = sales.map((s: any) => {
    const gross = {
      ...s,
      quantity: s.gross_quantity ?? s.quantity,
      sales_amount: s.gross_amount ?? s.sales_amount,
    };
    return { ...applyGrowthCancel(gross, couponBy.get(String(s.vendor_item_id)) ?? 0, basis), updated_at: new Date().toISOString() };
  });
  if (updated.length > 0) {
    const uErr = await upsertChunked('coupang_sales_daily', updated, 'user_id,sale_date,vendor_item_id,channel');
    if (uErr) return res.status(500).json({ error: `매출에 반영하지 못했습니다: ${uErr}` });
  }
  // 파일의 총 판매수와 우리 결제 수량이 맞는지 — 날짜를 잘못 골랐으면 여기서 드러난다
  const ourGross = updated.reduce((acc: number, r: any) => acc + (Number(r.gross_quantity) || 0), 0);
  const fileGross = rows.reduce((acc: number, r: any) => acc + (Number(r.gross_qty) || 0), 0);
  const applied = updated.reduce((acc: number, r: any) => acc + (r.cancel_source === 'file' ? Number(r.cancel_quantity) || 0 : 0), 0);
  const appliedAmount = updated.reduce((acc: number, r: any) => acc + (r.cancel_source === 'file' ? Number(r.cancel_amount) || 0 : 0), 0);
  return res.status(200).json({
    ok: true, date, options: rows.length, matched: updated.filter((r: any) => r.cancel_source === 'file').length,
    cancelQty: applied, cancelAmount: appliedAmount, fileGross, ourGross,
  });
}

// ── 그로스 주문별 쿠폰 ────────────────────────────────────────
//
// 그로스 주문 API에는 할인 항목이 없다(실측: vendorItemId·productName·salesQuantity·
// unitSalesPrice·currency 뿐). 쿠팡에 "이 주문에 적용된 쿠폰"을 주문번호로 묻는
// API가 따로 있어 그걸 쓴다. 한 번 물은 주문은 다시 묻지 않고, 회차당 상한을 두어
// 시간 예산 안에 끝낸다 — 나머지는 다음 회차가 이어받는다.
async function syncOrderCoupons(
  userId: string,
  creds: CoupangCreds,
  orderMeta: Map<string, { date: string; status?: string; items: Array<{ vendorItemId: string; amount: number; qty: number; sheetDiscount?: number }> }>,
  channel: 'growth' | 'marketplace',
  sum: SyncSummary,
  deadline: number,
): Promise<void> {
  if (!supabase || orderMeta.size === 0) return;

  const ids = [...orderMeta.keys()];

  // 주문번호를 나눠서 묻는다.
  //
  // PostgREST의 .in()은 값을 전부 주소(질의 문자열)에 이어 붙인다. 첫 수집은
  // 그로스 60일치를 한꺼번에 들고 오므로 주문번호가 수천 개가 되고, 주소가
  // 게이트웨이 상한을 넘어 요청이 통째로 거부된다. PostgREST까지 닿지도
  // 못하므로 오류 코드 없이 'Bad Request' 한 마디만 온다 — 실제로 새로
  // 연동한 계정 하나가 이것 때문에 매시 수집이 죽어 last_sync_at이 영영
  // null이었다. 아래 아래쪽 상한(couponPerRun)은 쿠팡에 물을 건수만 줄일 뿐
  // 이 조회에는 적용되지 않아 아무 도움이 안 됐다.
  //
  // 한 주문에 옵션 수만큼 행이 있으므로 조각마다 페이지네이션은 그대로 둔다.
  // 조각만 나누고 끝내면 옵션이 많은 판매자는 한도에 잘려 이미 물어본 주문을
  // 다시 묻게 된다.
  const seen = new Set<string>();
  // 500으로 막혀 발주서 할인으로 적어 둔 주문은 사흘 지나면 다시 물어본다.
  // 쿠팡이 나중에 답하기 시작하면 실제 쿠폰으로 덮인다. 회차당 20건까지만 —
  // 새 주문을 굶기면 안 된다.
  const retryBefore = new Date(Date.now() - 3 * 86400_000).toISOString();
  const retry = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { rows } = await selectAll<{ order_id: string; coupon_types: string | null; fetched_at: string | null }>((f, t) =>
      supabase!.from('coupang_order_coupons').select('order_id, coupon_types, fetched_at')
        .eq('user_id', userId).in('order_id', slice)
        // 정렬이 없으면 페이지 사이에 순서가 보장되지 않아 몇 줄이 빠진다.
        .order('order_id').range(f, t));
    for (const r of rows) {
      const id = String(r.order_id);
      if (r.coupon_types === 'ERR500' && String(r.fetched_at ?? '') < retryBefore && retry.size < 20 && !seen.has(id)) {
        retry.add(id);
        continue;
      }
      seen.add(id);
      retry.delete(id);
    }
  }
  // 최근 주문부터 묻는다. 회차 상한에 걸려 일부만 물어도 지금 쓰는 쿠폰이 먼저 잡힌다.
  const todo = ids
    .filter(id => !seen.has(id))
    .sort((a, b) => (orderMeta.get(b)!.date < orderMeta.get(a)!.date ? -1 : orderMeta.get(b)!.date > orderMeta.get(a)!.date ? 1 : 0))
    .slice(0, LIMITS.couponPerRun);
  if (todo.length === 0) return;

  const rows: any[] = [];
  let lastCallAt = 0;
  let typesSeen = new Set<string>();
  let multiTypeLogged = false;
  let failedInARow = 0;
  let failedTotal = 0;
  let settledByFallback = 0;
  let firstErrorIdx = -1;
  for (const orderId of todo) {
    if (outOfTime(deadline, sum)) break;
    const wait = LIMITS.couponGapMs - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();

    const r = await coupangCall(creds, 'GET', EP.orderCoupons(creds.vendorId, orderId), '');
    if (!r.ok) {
      if (r.authFailed) {
        sum.authFailed = true;
        return;
      }
      // 주문 하나가 쿠팡 쪽 500으로 막혔다고 나머지를 다 건너뛰면 안 된다.
      // 예전에는 첫 오류에서 멈췄는데, 같은 주문이 매번 500을 내면 그 뒤 주문의
      // 쿠폰은 영영 못 묻는다 — 실제로 '윙 쿠폰: Internal Server Error' 한 건이
      // 회차마다 같은 자리에서 걸렸다. 그 주문은 건너뛰고(저장하지 않으므로
      // 다음 회차에 다시 묻는다) 다음으로 간다. 다만 연속으로 계속 실패하면
      // API 자체가 닫힌 것이라 더 두드리지 않는다.
      failedTotal++;
      // 어느 주문이 왜 막히는지 남긴다. 문구('Internal Server Error')만으로는
      // 쿠팡 쪽 장애인지, 특정 주문(취소·구주문·분할)만 그런 건지 알 수 없다.
      const meta = orderMeta.get(orderId);
      console.warn('coupang order coupon failed —', {
        channel, orderId, status: r.status, error: String(r.error).slice(0, 200),
        orderDate: meta?.date, orderStatus: meta?.status ?? null,
        items: meta?.items.length, qty: meta?.items.reduce((n, it) => n + (it.qty || 0), 0),
      });
      if (firstErrorIdx < 0) {
        firstErrorIdx = sum.errors.length;
        sum.errors.push(`${channel === 'growth' ? '그로스' : '윙'} 쿠폰: ${r.error}`);
      }
      // 쿠팡이 특정 주문에만 500을 낸다. 배송완료된 나흘 전 주문도 그랬으니 '아직
      // 확정 전'이라서가 아니다. 저장하지 않으면 매 회차 같은 주문을 다시 묻고,
      // 그 주문들이 맨 앞(최신순)에 몰려 있으면 연속 실패로 끊겨 그 뒤 주문은 영영
      // 못 묻는다. 이틀 지난 주문은 발주서가 말한 판매자 쿠폰(윙) 또는 0(그로스)으로
      // 적어 두고 넘어간다. 갓 들어온 주문은 다음 회차에 한 번 더 묻는다.
      if (r.status === 500 && meta) {
        if (daysBetween(meta.date, kstToday()) >= 2) {
          for (const it of meta.items) {
            rows.push({
              user_id: userId, order_id: orderId, vendor_item_id: it.vendorItemId, channel,
              sale_date: meta.date, discount: Math.max(0, Math.round(it.sheetDiscount ?? 0)),
              quantity: Math.max(0, it.qty || 0),
              coupon_types: 'ERR500', discount_by_type: null,
              fetched_at: new Date().toISOString(),
            });
          }
          settledByFallback++;
        }
        continue;
      }
      failedInARow++;
      if (failedInARow >= 3) break;
      continue;
    }
    failedInARow = 0;
    const list = listOf(r.data);
    // 쿠팡 부담으로 표시된 것은 뺀다. 나머지는 판매자 부담으로 본다 — 실매출을
    // 크게 보는 쪽이 작게 보는 쪽보다 나쁘다.
    let discount = 0;
    const types: string[] = [];
    // 유형별 원금액. 한 주문에 PRICE와 FIXED_WITH_QUANTITY가 겹쳐 13,999원이
    // 됐을 때, 합계만 있으면 무엇이 얼마인지 영영 모른다. 주문 단위 그대로
    // 남긴다 (옵션별로 나누지 않는다 — 나누면 또 합계가 된다).
    const byType: Record<string, number> = {};
    for (const c of list) {
      const type = pickStr(c, ['type', 'couponType', 'discountType']);
      types.push(type);
      typesSeen.add(type);
      const amount = pickNum(c, ['discount', 'discountAmount', 'amount'], 0);
      const key = type || 'UNKNOWN';
      byType[key] = (byType[key] ?? 0) + amount;
      if (/COUPANG|쿠팡/i.test(type)) continue;
      // 금액을 안 알려주는 쿠폰은 -1로 온다 ("오늘만 쿠폰 할인" 같은 PRICE형).
      // 그대로 더하면 5,100원 쿠폰이 5,099원이 되고, 그런 옵션이 쌓여 2원 단위
      // 합계가 나온다 — 실제로 그렇게 됐다. 모르는 금액은 0으로 본다.
      if (amount < 0) continue;
      discount += amount;
    }
    // 유형이 둘 이상 겹친 주문은 회차마다 한 번 원문을 남긴다. PRICE가 무엇인지는
    // 문서가 아니라 이 응답에만 적혀 있다. 키 값은 없는 응답이다.
    if (list.length > 1 && !multiTypeLogged) {
      multiTypeLogged = true;
      console.info('coupang order coupon multi-type sample —', JSON.stringify(list).slice(0, 800));
    }
    const meta = orderMeta.get(orderId)!;
    const totalAmount = meta.items.reduce((n, it) => n + it.amount, 0);
    // 한 주문에 옵션이 여럿이면 금액 비율로 나눈다. 마지막 옵션이 나머지를 가져가
    // 합계가 정확히 맞는다.
    let allocated = 0;
    meta.items.forEach((it, i) => {
      const share = i === meta.items.length - 1
        ? discount - allocated
        : totalAmount > 0 ? Math.round((discount * it.amount) / totalAmount) : 0;
      allocated += share;
      rows.push({
        user_id: userId, order_id: orderId, vendor_item_id: it.vendorItemId, channel,
        sale_date: meta.date, discount: Math.max(0, share), quantity: Math.max(0, it.qty || 0),
        coupon_types: types.join(',') || null,
        discount_by_type: Object.keys(byType).length ? byType : null,
        fetched_at: new Date().toISOString(),
      });
    });
  }
  // 몇 건이 막혔는지 문구에 붙인다. 한 건이면 그 주문 하나의 문제고, 수십 건이면
  // 쿠팡 쪽 장애다 — 다음 회차에 다시 묻는다는 사실도 함께 적는다.
  if (firstErrorIdx >= 0) {
    const retry = failedTotal - settledByFallback;
    const parts = [
      settledByFallback > 0 ? `${settledByFallback}건은 발주서 할인으로 기록` : '',
      retry > 0 ? `${retry}건 다음 회차 재시도` : '',
    ].filter(Boolean).join(', ');
    sum.errors[firstErrorIdx] = `${sum.errors[firstErrorIdx]} (${failedTotal}건 — ${parts})`;
  }
  if (rows.length === 0) return;
  const err = await upsertChunked('coupang_order_coupons', rows, 'user_id,order_id,vendor_item_id');
  if (err) sum.errors.push(err);
  if (typesSeen.size > 0) console.info('coupang order coupon types —', [...typesSeen].join(','));
}

// ── 쿠폰 설정 동기화 (쿠폰 관리) ──────────────────────────────
//
// 순이익의 쿠폰은 "판매자가 설정한 개당 할인 × 판매수량"이어야 판매자가 아는
// 숫자와 맞는다(1건당 11,500원이면 2건에 23,000원). 주문에서 역산하면 다운로드
// 쿠폰이 섞이거나 쿠폰을 바꾼 날이 끼어 개당 값이 흔들린다. 그래서 쿠폰 관리에
// 등록된 쿠폰과 그 쿠폰이 붙은 옵션 목록을 그대로 받아 둔다. 윙·그로스 모두
// 같은 방식으로 옵션ID를 붙여 발행하므로 채널 구분 없이 옵션 단위로 쓴다.
async function syncCouponDefinitions(userId: string, creds: CoupangCreds, sum: SyncSummary, deadline: number): Promise<void> {
  if (!supabase) return;

  // 목록 질의 형식이 계정마다 다를 수 있어 차례로 시도한다. 첫 성공을 쓴다.
  // 쿠팡 예시는 status·page·size·sort를 함께 받는다. 계정에 따라 필수 여부가
  // 달라 넉넉한 쪽부터 시도한다.
  const queries = ['page=1&size=100&sort=desc&status=APPLIED', 'page=1&size=100&status=APPLIED', 'status=APPLIED'];
  let list: any[] | null = null;
  let listPayload: any = null;
  let lastErr = '';
  for (const q of queries) {
    if (outOfTime(deadline, sum)) {
      // 조용히 0건으로 끝나면 "권한이 없나?"와 구분이 안 된다
      sum.errors.push('쿠폰 설정: 이번 회차 시간이 부족해 건너뛰었습니다 (다음 회차가 이어받습니다)');
      return;
    }
    // 문서와 계정에 따라 목록이 v2이기도 v1이기도 하다. 한쪽이 404면 다른 쪽을
    // 바로 시도한다 — 판매자가 수집을 다시 누르게 만들지 않는다.
    const r = await coupangCallVersioned(creds, 'GET', v => EP.coupons(creds.vendorId, v), q, ['v2', 'v1'], 'coupons');
    if (r.ok) {
      list = listOf(r.data);
      listPayload = r.data;
      break;
    }
    // 이 API는 오픈API 권한 항목이 따로 있다. 거절돼도 판매자 키가 잘못된 것은
    // 아니므로 계정을 건드리지 않고 안내만 남긴다.
    if (r.status === 401 || r.status === 403) {
      sum.errors.push(`쿠폰 설정: ${r.error} — 윙 > 판매자 정보 > 추가판매정보 > 오픈API에서 쿠폰 조회 권한을 확인해주세요`);
      return;
    }
    // 경로가 없다는 응답에 권한 안내를 붙이면 엉뚱한 곳을 보게 된다. 다음 질의 형식으로 넘어간다.
    if (r.status === 404) {
      lastErr = r.error || 'HTTP 404';
      continue;
    }
    lastErr = r.error || `HTTP ${r.status}`;
    if (r.status !== 400) break;
  }
  if (!list) {
    // 어느 경로·질의로도 안 되면 마지막 응답을 그대로 남긴다. 문구를 다듬으면
    // 원인을 못 찾는다 — 오늘 'Endpoint not found'에 권한 안내를 붙였다가
    // 엉뚱한 곳을 보게 만들었다.
    if (lastErr) sum.errors.push(`쿠폰 설정: ${lastErr}`);
    return;
  }
  if (list.length === 0) {
    // 적용 중인 쿠폰이 없다. 예전에 받아 둔 것도 이제 유효하지 않으니 지운다.
    await supabase.from('coupang_coupon_items').delete().eq('user_id', userId);
    sum.couponDefs = 0;
    return;
  }
  console.info('coupang coupon list shape —', `${list.length}건 / 모양=${describePayload(listPayload)}`);

  const rows: any[] = [];
  // 쿠폰 목록 자체도 남긴다. 옵션이 안 붙는 쿠폰(계약 단위·와우 전용 등)이라도
  // 판매자는 "내 쿠폰이 무엇이고 얼마짜리인지"를 봐야 화면 숫자와 대조할 수 있다.
  const couponRows: any[] = [];
  let complete = true;
  let itemShapeLogged = false;
  let itemsFailed = false;
  // 통하는 페이지 질의 형식을 한 번 찾으면 나머지 쿠폰에도 그대로 쓴다
  let itemQueryStyle: number | null = null;
  let lastCallAt = 0;
  const coupons = list.slice(0, LIMITS.couponDefsPerRun);
  if (list.length > coupons.length) complete = false;

  for (const c of coupons) {
    const couponId = pickStr(c, ['couponId', 'id', 'promotionId']);
    if (!couponId) continue;
    const type = pickStr(c, ['type', 'couponType', 'discountType', 'discountMethod']) || null;
    const discount = pickNum(c, ['discount', 'discountPrice', 'discountAmount', 'discountRate', 'discountValue'], 0);
    const maxDiscount = pickNum(c, ['maxDiscountPrice', 'maxDiscount', 'maxDiscountAmount'], 0) || null;
    const name = pickStr(c, ['promotionName', 'name', 'couponName', 'title']) || null;
    const status = pickStr(c, ['status', 'couponStatus']) || null;
    const startAt = toIso(pickRaw(c, ['startAt', 'startDate', 'startDateTime', 'validStartAt']));
    const endAt = toIso(pickRaw(c, ['endAt', 'endDate', 'endDateTime', 'validEndAt']));
    const couponRow = {
      user_id: userId, coupon_id: couponId, promotion_name: name, coupon_type: type,
      status, discount, max_discount: maxDiscount,
      wow_exclusive: c?.wowExclusive === true, contract_id: pickStr(c, ['contractId', 'vendorContractId']) || null,
      start_at: startAt, end_at: endAt, item_count: 0, fetched_at: new Date().toISOString(),
    };
    couponRows.push(couponRow);

    // 옵션 목록의 페이지 질의 형식은 계정·버전에 따라 다르다. 아무 질의 없이
    // 불렀더니 쿠폰 8개가 전부 빈 배열로 왔다 — 오류가 아니라 그냥 비어 있어서
    // "쿠폰이 없다"와 구분이 안 됐다. 형식을 차례로 시도하고, 한 번 통한 형식은
    // 나머지 쿠폰에도 그대로 쓴다.
    const pageQueries: Array<(n: number, t: string) => string> = [
      (n) => `status=APPLIED&page=${n}&size=100`,
      (n) => `page=${n}&size=100`,
      (_n, t) => (t ? `nextToken=${t}` : ''),
      () => '',
    ];
    const styleOrder = itemQueryStyle === null ? pageQueries.map((_, i) => i) : [itemQueryStyle];

    let token = '';
    let got = 0;
    for (const style of styleOrder) {
      token = '';
      got = 0;
      for (let page = 1; page <= LIMITS.couponItemPages; page++) {
        if (outOfTime(deadline, sum)) { complete = false; break; }
        const wait = LIMITS.couponGapMs - (Date.now() - lastCallAt);
        if (wait > 0) await sleep(wait);
        lastCallAt = Date.now();

        const r = await coupangCallVersioned(
          creds, 'GET', v => EP.couponItems(creds.vendorId, couponId, v),
          pageQueries[style](page, token), ['v1', 'v2'], 'couponItems',
        );
        if (!r.ok) {
          sum.errors.push(`쿠폰 옵션 목록: ${r.error}`);
          complete = false;
          itemsFailed = true;
          break;
        }
        const items = listOf(r.data);
        // 비어 있을 때도 한 번은 모양을 남긴다. 이게 없으면 "옵션이 없다"와
        // "우리가 못 읽는다"를 구분할 수 없다.
        if (!itemShapeLogged) {
          itemShapeLogged = true;
          console.info('coupang coupon item shape —',
            `질의=${pageQueries[style](page, token) || '(없음)'} / ${items.length}건 / 모양=${describePayload(r.data)}`);
        }
        for (const it of items) {
          const vendorItemId = findVendorItemId(it);
          if (!vendorItemId) continue;
          got++;
          // 옵션마다 다른 할인이 실려 오면 그것을 우선한다
          const itemDiscount = pickNum(it, ['discount', 'discountPrice', 'discountAmount'], 0);
          rows.push({
            user_id: userId, coupon_id: couponId, vendor_item_id: vendorItemId,
            coupon_name: name, coupon_type: type, discount: itemDiscount > 0 ? itemDiscount : discount,
            max_discount: maxDiscount, status, start_at: startAt, end_at: endAt,
            fetched_at: new Date().toISOString(),
          });
        }
        token = nextTokenOf(r.data);
        // page/size 형식은 받은 게 한 페이지보다 적으면 끝이다
        if (style === 0 ? items.length < 100 : !token) break;
      }
      if (itemsFailed || got > 0) {
        if (got > 0) itemQueryStyle = style;
        break;
      }
    }
    couponRow.item_count = got;

    if (itemsFailed || (!complete && outOfTime(deadline, sum))) break;
  }

  // 쿠폰은 있는데 옵션이 하나도 안 붙는 경우가 있다. 계약 단위로 건 쿠폰이
  // 그렇고, 그건 고장이 아니라 정상이다.
  //
  // 예전에는 이걸 sum.errors에 넣었다. 그 목록이 화면에서 "일부 실패"로
  // 표시되는 곳이라, 판매자에게는 수집이 잘못된 것처럼 보였다. 실제로는
  // 아무 문제가 없는데 매번 빨간 문구를 보게 되니, 진짜 실패가 섞여 들어와도
  // 구분이 안 된다.
  //
  // 진단 가치는 서버 로그로 남기고 화면에서는 뺀다.
  if (rows.length === 0 && coupons.length > 0 && !itemsFailed) {
    console.info('[쿠팡] 쿠폰에 옵션이 붙지 않았다', { userId, coupons: coupons.length });
  }

  if (couponRows.length > 0) {
    const cErr = await upsertChunked('coupang_coupons', couponRows, 'user_id,coupon_id');
    if (cErr) sum.errors.push(cErr);
  }

  // 전부 받았을 때만 이전 것을 지운다. 일부만 받고 지우면 멀쩡하던 옵션의 쿠폰이 빠진다.
  if (complete) await supabase.from('coupang_coupon_items').delete().eq('user_id', userId);
  if (rows.length > 0) {
    const err = await upsertChunked('coupang_coupon_items', rows, 'user_id,coupon_id,vendor_item_id');
    if (err) sum.errors.push(err);
  }
  sum.couponDefs = rows.length;
}

// ── 로켓창고 재고 동기화 ──────────────────────────────────────
//
// 그로스 재고 예측은 로켓창고에 실제로 있는 수량으로 해야 한다. 등록상품의
// 재고 수치는 판매자 창고 기준이라 그로스에선 의미가 없다. 이 API는 옵션별
// 판매가능수량(totalOrderableQuantity)과 쿠팡 자체 집계 30일 판매수를 준다.
// 같은 rg_open_api 계열이라 분당 50회 한도를 함께 지킨다.
async function syncGrowthInventory(userId: string, creds: CoupangCreds, sum: SyncSummary, deadline: number): Promise<void> {
  if (!supabase) return;

  const rows: any[] = [];
  let token = '';
  let lastCallAt = 0;
  let complete = false;
  for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
    if (outOfTime(deadline, sum)) break;
    const wait = LIMITS.rgGapMs - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();

    const r = await coupangCall(creds, 'GET', EP.rgInventory(creds.vendorId), token ? `nextToken=${token}` : '');
    if (!r.ok) {
      if (r.authFailed) {
        sum.authFailed = true;
        return;
      }
      // 그로스를 안 쓰는 판매자는 권한이 없다. 고장이 아니라 해당 없음이다.
      // 다만 그로스 매출이 있는 계정이 여기서 빈손이면 그건 해당 없음이 아니라
      // 고장이므로, 조용히 넘기지 않고 상태를 남긴다.
      if (r.status === 403 || r.status === 404) {
        console.info('coupang rg inventory skipped —', { userId, status: r.status });
        return;
      }
      sum.errors.push(`그로스 재고: ${r.error}`);
      return;
    }
    if (page === 0) {
      const first = listOf(r.data)[0];
      // inventoryDetails 안에 판매가능 말고도 입고중·불량 같은 수량이 있는지 보려고
      // 안쪽 키까지 남긴다. 값은 안 남긴다.
      const details = first?.inventoryDetails && typeof first.inventoryDetails === 'object' ? Object.keys(first.inventoryDetails).join(',') : '없음';
      console.info('coupang rg inventory shape —', `${listOf(r.data).length}건 / 키=${first ? Object.keys(first).join(',') : '없음'} / details=${details}`);
    }
    for (const inv of listOf(r.data)) {
      const vendorItemId = pickStr(inv, ['vendorItemId', 'vendorItemID']);
      if (!vendorItemId) continue;
      const details = inv?.inventoryDetails ?? inv;
      const salesMap = inv?.salesCountMap ?? {};
      rows.push({
        user_id: userId,
        vendor_item_id: vendorItemId,
        product_name: pickStr(inv, ['vendorItemName', 'productName', 'itemName']) || null,
        external_sku: pickStr(inv, ['externalSkuId', 'externalSku']) || null,
        orderable_qty: pickNum(details, ['totalOrderableQuantity', 'orderableQuantity'], 0),
        sales_30d: salesMap?.SALES_COUNT_LAST_THIRTY_DAYS != null ? pickNum(salesMap, ['SALES_COUNT_LAST_THIRTY_DAYS'], 0) : null,
        synced_at: new Date().toISOString(),
      });
    }
    token = nextTokenOf(r.data);
    if (!token) {
      complete = true;
      break;
    }
  }

  // 목록을 끝까지 받았을 때만 통째로 바꾼다. 중간에 끊긴 목록으로 지우면
  // 멀쩡한 재고 행이 사라져 '품절'로 보인다. 끊겼으면 받은 만큼만 덮어쓴다.
  if (complete) await supabase.from('coupang_growth_inventory').delete().eq('user_id', userId);
  const err = await upsertChunked('coupang_growth_inventory', rows, 'user_id,vendor_item_id');
  if (err) sum.errors.push(err);
  sum.growthInventory = rows.length;

  // 오늘 자 스냅샷. 하루에 여러 번 돌면 마지막 값이 남는다. 재고 대조 화면이
  // "언제부터 어긋났는지"를 이걸로 본다.
  if (rows.length > 0) {
    const snapDate = kstToday();
    const snaps = rows.map(r => ({
      user_id: userId, vendor_item_id: r.vendor_item_id, snap_date: snapDate,
      orderable_qty: r.orderable_qty, sales_30d: r.sales_30d,
    }));
    const snapErr = await upsertChunked('coupang_growth_inventory_daily', snaps, 'user_id,vendor_item_id,snap_date');
    if (snapErr) console.warn('growth inventory snapshot failed —', snapErr);
  }
}


// ── 관측 데이터로 상품 목록 채우기 ─────────────────────────────
//
// 등록상품 상세에 옵션ID가 없으면 coupang_items가 비고, 원가 입력·가격 관리·재고
// 예측이 통째로 빈다. 그런데 옵션ID는 로켓창고 재고·매출·주문에 전부 실려 온다.
// 거기서 본 옵션을 상품 목록에 넣되, 상세에서 제대로 받은 행은 건드리지 않는다
// (같은 옵션이면 상세가 이긴다). 이렇게 넣은 행은 seller_product_id가 없어
// '목록에서 사라진 상품 정리'에 걸리지 않는다.
async function backfillItemsFromObservations(userId: string, sum: SyncSummary): Promise<void> {
  if (!supabase) return;
  const { rows: existing } = await selectAll<{ vendor_item_id: string; sale_price: number | null }>((f, t) =>
    supabase!.from('coupang_items').select('vendor_item_id, sale_price').eq('user_id', userId).order('vendor_item_id').range(f, t));
  const have = new Set(existing.map(e => String(e.vendor_item_id)));
  // 상세가 판매가를 0으로 준 옵션 — 로켓그로스 상품이 그렇다
  const priceless = existing.filter(e => !(Number(e.sale_price) > 0)).map(e => String(e.vendor_item_id));

  const today = kstToday();
  const [invRes, salesRes] = await Promise.all([
    selectAll<any>((f, t) => supabase!.from('coupang_growth_inventory')
      .select('vendor_item_id, product_name, external_sku, orderable_qty').eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
    selectAll<any>((f, t) => supabase!.from('coupang_sales_daily')
      .select('vendor_item_id, product_name, channel, quantity, sales_amount, sale_date').eq('user_id', userId)
      .gte('sale_date', addDays(today, -90)).order('sale_date', { ascending: false }).range(f, t)),
  ]);

  // 매출에서 본 이름·평균 판매가(최근 것 우선)
  const seen = new Map<string, { name: string; price: number | null; channel: string }>();
  for (const s of salesRes.rows) {
    const id = String(s.vendor_item_id);
    if (seen.has(id)) continue;
    const qty = Number(s.quantity) || 0;
    const amt = Number(s.sales_amount) || 0;
    seen.set(id, {
      name: String(s.product_name ?? ''),
      price: qty > 0 ? Math.round(amt / qty) : null,
      channel: String(s.channel ?? 'marketplace'),
    });
  }

  // 판매가가 비어 있는 옵션은 최근 매출의 개당 금액으로 채운다. 원가 입력 화면의
  // '개당 남는 돈'과 순이익 표의 판매가가 이 값을 본다. 상세에서 값이 오면 다음
  // 상품 수집이 덮어쓴다.
  let filled = 0;
  for (const id of priceless) {
    const s = seen.get(id);
    if (!s?.price) continue;
    await supabase.from('coupang_items').update({ sale_price: s.price }).eq('user_id', userId).eq('vendor_item_id', id);
    if (++filled >= 150) break;
  }

  const rows: any[] = [];
  const now = new Date().toISOString();
  for (const inv of invRes.rows) {
    const id = String(inv.vendor_item_id);
    if (have.has(id)) continue;
    have.add(id);
    const s = seen.get(id);
    rows.push({
      user_id: userId, vendor_item_id: id, seller_product_id: null, product_id: null,
      product_name: inv.product_name || s?.name || `옵션 ${id}`,
      option_name: inv.external_sku || '',
      sale_price: s?.price ?? null,
      stock: Number(inv.orderable_qty) || 0,
      status: 'observed', business_type: 'growth', synced_at: now,
    });
  }
  for (const [id, s] of seen) {
    if (have.has(id)) continue;
    have.add(id);
    rows.push({
      user_id: userId, vendor_item_id: id, seller_product_id: null, product_id: null,
      product_name: s.name || `옵션 ${id}`, option_name: '',
      sale_price: s.price, stock: null,
      status: 'observed', business_type: s.channel === 'growth' ? 'growth' : 'marketplace', synced_at: now,
    });
  }
  if (rows.length === 0) return;
  const err = await upsertChunked('coupang_items', rows, 'user_id,vendor_item_id');
  if (err) sum.errors.push(`상품 목록 보완: ${err}`);
  else sum.items += rows.length;
}

// ── 지급내역 동기화 (캐시플로) ────────────────────────────────
async function syncSettlements(userId: string, creds: CoupangCreds, sum: SyncSummary, deadline: number): Promise<void> {
  if (!supabase) return;

  const today = kstToday();
  const from = addDays(today, -120);
  // 지급내역은 매출인식월 기준이라 '이번 달'까지만 조회할 수 있다. 앞선 달을
  // 넣으면 400 '해당월까지만 조회할 수 있습니다'로 거절당한다. 아직 오지 않은
  // 달에는 인식된 매출 자체가 없으니 잃는 것도 없다. 지급 예정분은 이미
  // 인식된 매출의 예정일로 함께 내려온다.
  const to = monthEnd(today.slice(0, 7));

  // 지급내역은 revenueRecognitionYearMonth(YYYY-MM) 하나만 받는다. 날짜 범위를
  // 보내면 'MISSING_PARAMETER: revenueRecognitionYearMonth ... is not present'로
  // 거절당해 정산 캘린더가 영영 비어 있게 된다.
  const months = monthsBetween(from, to);

  const rows: any[] = [];
  // 같은 (지급일·유형·인식월)로 여러 건이 지급되는 일이 흔하므로 조회 순서를
  // 키에 섞는다. 원본 내용을 키에 넣으면 안 된다. 지급 상태가 '예정'에서
  // '지급완료'로 바뀌는 순간 키가 달라져 같은 지급이 두 행이 되고, 캐시플로
  // 금액이 영구히 두 배로 잡힌다.
  const ordinal = new Map<string, number>();
  let failedThisRun = false;

  for (const month of months) {
    if (outOfTime(deadline, sum)) {
      failedThisRun = true;
      break;
    }
    const query = `vendorId=${creds.vendorId}&revenueRecognitionYearMonth=${month}`;
    const r = await coupangCall(creds, 'GET', EP.settlementHistories, query);
    if (!r.ok) {
      if (r.authFailed) {
        sum.authFailed = true;
        return;
      }
      sum.errors.push(`지급내역: ${r.error}`);
      failedThisRun = true;
      continue;
    }
    for (const s of listOf(r.data)) {
      const date = pickDate(s, ['settlementDate', 'paymentDate', 'expectedSettlementDate', 'settlementCompleteDate']);
      if (!date) continue;
      const type = pickStr(s, ['settlementType', 'settlementTypeName', 'paymentType'], '정산');
      // 쿠팡이 주는 이름은 revenueRecognitionYearMonth 다. 예전에는
      // recognitionMonth·revenueRecognitionDate·salesMonth 를 찾고 있었고
      // 셋 다 없어서 매번 폴백이 걸렸다 — '지급일이 속한 달'이 인식월로
      // 저장됐고, 10월 1일에 들어온 8월 매출분이 '2026-10 인식'이 됐다.
      // 그래서 정산서 대조가 매달 엉뚱한 달끼리 견주고 있었다.
      const month = pickStr(s, ['revenueRecognitionYearMonth', 'recognitionMonth', 'salesMonth'], date.slice(0, 7)).slice(0, 7);

      const group = `${date}|${type}|${month}`;
      const seq = ordinal.get(group) ?? 0;
      ordinal.set(group, seq + 1);

      rows.push({
        user_id: userId,
        settlement_key: crypto.createHash('md5').update(`${group}|${seq}`).digest('hex'),
        settlement_date: date,
        settlement_type: type,
        recognition_month: month,
        // RESERVE 행은 그 달 WEEKLY를 통째로 다시 적은 요약이라 settlementAmount가
        // '이미 지급된 70% 합'이다. 그 날 통장에 실제로 들어오는 돈은 최종액
        // (lastAmount)뿐이다. 그대로 쓰면 캘린더에서 같은 돈이 두 번 잡힌다.
        amount: isReserveSettlement(type)
          ? pickNum(s, ['lastAmount'], 0)
          : pickNum(s, ['settlementAmount', 'amount', 'finalAmount', 'paymentAmount'], 0),
        // 매출 인식 기간 — 이 지급이 어느 기간 매출에 대한 것인가
        recognition_from: pickDate(s, ['revenueRecognitionDateFrom']),
        recognition_to: pickDate(s, ['revenueRecognitionDateTo']),
        // 주정산은 정산대상액(수수료 뺀 금액)의 70%를 먼저 주고, 나머지
        // 30%(최종액)를 익익월 1일에 RESERVE로 준다. 우리 계산과 맞춰야 할
        // 값은 그때그때 들어온 '지급액'이 아니라 '정산대상액'이다.
        target_amount: pickNum(s, ['settlementTargetAmount'], 0),
        last_amount: pickNum(s, ['lastAmount'], 0),
        status: pickStr(s, ['settlementStatus', 'status', 'statusName']),
        raw: s,
        updated_at: new Date().toISOString(),
      });
    }
  }

  // 주문·매출과 같은 방식으로 구간을 통째로 다시 쓴다. 순번 기반 키는 조회
  // 결과가 줄었을 때 꼬리 행이 남을 수 있어 덧쓰기만으로는 정합이 깨진다.
  if (!failedThisRun) {
    await supabase
      .from('coupang_settlements')
      .delete()
      .eq('user_id', userId)
      // 조회 단위가 월이므로 지우는 범위도 월 경계에 맞춘다. 날짜로 자르면
      // 첫 달·마지막 달의 바깥 날짜가 지워지지 않고 남는다.
      .gte('settlement_date', `${months[0]}-01`)
      // 지급일은 매출인식월보다 뒤다. 인식월 경계에서 끊으면 이번 달 매출의
      // 다음 달 지급 예정 행이 지워지지 않고 남아 캐시플로가 두 배로 잡힌다.
      .lte('settlement_date', addDays(monthEnd(months[months.length - 1]), 120));
  }

  const err = await upsertChunked('coupang_settlements', rows, 'user_id,settlement_key');
  if (err) sum.errors.push(err);
  sum.settlements = rows.length;
}

/** 취소·철회된 접수는 손실로 세지 않는다. 상태 원문은 엔드포인트마다 달라 부분 일치로 본다. */
export function isActiveReturn(status: any): boolean {
  const s = String(status ?? '').toUpperCase();
  return !(s.includes('CANCEL') || s.includes('WITHDRAW') || s.includes('취소') || s.includes('철회'));
}

// ── 반품·교환 동기화 ──────────────────────────────────────────
async function syncReturns(userId: string, creds: CoupangCreds, from: string, to: string, sum: SyncSummary, deadline: number): Promise<void> {
  if (!supabase) return;

  const rows: any[] = [];
  // 반품요청 조회는 주문번호가 없으면 status가 필수다. 빼면 "OrderId can't be null,
  // if doesn't pass the parameter status"로 거절된다. 상태별로 한 번씩 돌고
  // 접수번호로 합친다 — 같은 접수가 상태를 옮겨 가며 두 번 잡히면 안 된다.
  const seenReceipt = new Set<string>();
  let returnErrorLogged = false;
  // 상태 4가지 × 14일 구간을 쉬지 않고 연달아 부르면 429가 난다 (60일이면 20번
  // 연속). 한 번 걸리면 그 상태·구간의 반품이 통째로 빠지므로 호출 사이를 띄우고,
  // 429는 잠깐 쉬었다 한 번 더 묻는다. 교환요청 조회와 같은 처방이다.
  let lastReturnCallAt = 0;
  const callReturns = async (query: string) => {
    const gap = LIMITS.rgGapMs - (Date.now() - lastReturnCallAt);
    if (gap > 0) await sleep(gap);
    lastReturnCallAt = Date.now();
    return coupangCallVersioned(
      creds, 'GET',
      v => EP.returnRequests(v, creds.vendorId),
      query, ['v5', 'v4'], 'returnRequests',
    );
  };
  for (const status of RETURN_STATUSES) {
  // 60일을 한 번에 물으면 'Request timed out'이 난다. 14일씩 나눈다.
  for (const [cFrom, cTo] of dateChunks(from, to, 14)) {
    let nextToken = '';
    for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
      if (outOfTime(deadline, sum)) break;
      const query =
        `createdAtFrom=${cFrom}&createdAtTo=${cTo}&status=${status}&maxPerPage=50` +
        (nextToken ? `&nextToken=${nextToken}` : '');
      let r = await callReturns(query);
      if (!r.ok && r.status === 429 && !outOfTime(deadline, sum)) {
        await sleep(3_000);
        r = await callReturns(query);
      }
      if (!r.ok) {
        if (r.authFailed) {
          sum.authFailed = true;
          return;
        }
        // 상태 하나가 거절돼도 나머지 상태는 계속 받는다. 같은 오류를 상태마다
        // 네 번 쌓으면 화면이 그 문구로만 가득 찬다.
        if (!returnErrorLogged) sum.errors.push(`반품요청(${status}): ${r.error}`);
        returnErrorLogged = true;
        break;
      }
      for (const rr of listOf(r.data)) {
        const receiptId = pickStr(rr, ['receiptId', 'returnDeliveryId', 'cancelId']);
        if (!receiptId || seenReceipt.has(receiptId)) continue;
        seenReceipt.add(receiptId);
        const items = Array.isArray(rr?.returnItems) ? rr.returnItems : [rr];
        const first = items[0] ?? {};
        rows.push({
          user_id: userId,
          receipt_id: receiptId,
          kind: 'return',
          vendor_item_id: pickStr(first, ['vendorItemId', 'vendorItemID']) || null,
          product_name: pickStr(first, ['vendorItemName', 'sellerProductName', 'productName']),
          quantity: items.reduce((n: number, it: any) => n + pickNum(it, ['purchaseCount', 'quantity'], 1), 0),
          reason: pickStr(rr, ['reasonCodeText', 'cancelReason', 'returnReason', 'reason']),
          fault: pickStr(rr, ['faultByType', 'returnShippingChargeType', 'faultBy']),
          status: pickStr(rr, ['receiptStatus', 'status', 'receiptStatusName']),
          requested_at: toIso(pickRaw(rr, ['createdAt', 'receiptInsertDate', 'requestedAt'])),
          raw: rr,
          updated_at: new Date().toISOString(),
        });
      }
      nextToken = nextTokenOf(r.data);
      if (!nextToken) break;
    }
  }
  }

  // 교환 — 판매자 귀책이면 반품과 마찬가지로 왕복 배송비가 나간다.
  // 이 API는 한 번에 7일까지, 날짜는 시각까지 붙인 형식만 받는다.
  // 7일 구간을 쉬지 않고 연달아 부르면 429가 난다 (60일이면 9번 연속). 한 번
  // 걸리면 그 구간의 교환이 통째로 빠지므로 호출 사이를 띄우고, 429는 잠깐 쉬었다
  // 한 번 더 묻는다.
  let lastExchangeCallAt = 0;
  for (const [cFrom, cTo] of dateChunks(from, to, 7)) {
    if (outOfTime(deadline, sum)) break;
    let nextToken = '';
    for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
      if (outOfTime(deadline, sum)) break;
      const query =
        `createdAtFrom=${cFrom}T00:00:00&createdAtTo=${cTo}T23:59:59&maxPerPage=50` +
        (nextToken ? `&nextToken=${nextToken}` : '');
      const gap = LIMITS.rgGapMs - (Date.now() - lastExchangeCallAt);
      if (gap > 0) await sleep(gap);
      lastExchangeCallAt = Date.now();
      let r = await coupangCall(creds, 'GET', EP.exchangeRequests(creds.vendorId), query);
      if (!r.ok && r.status === 429 && !outOfTime(deadline, sum)) {
        await sleep(3_000);
        lastExchangeCallAt = Date.now();
        r = await coupangCall(creds, 'GET', EP.exchangeRequests(creds.vendorId), query);
      }
      if (!r.ok) {
        if (r.authFailed) {
          sum.authFailed = true;
          return;
        }
        const msg = `교환요청: ${r.error}`;
        if (!sum.errors.includes(msg)) sum.errors.push(msg);
        break;
      }
      for (const ex of listOf(r.data)) {
        const exchangeId = pickStr(ex, ['exchangeId', 'exchangeID', 'receiptId']);
        if (!exchangeId) continue;
        const items = Array.isArray(ex?.exchangeItemDtoV1s) ? ex.exchangeItemDtoV1s
          : Array.isArray(ex?.exchangeItems) ? ex.exchangeItems : [ex];
        const first = items[0] ?? {};
        rows.push({
          user_id: userId,
          receipt_id: `X${exchangeId}`, // 반품 접수번호와 겹치지 않게 접두어를 붙인다
          kind: 'exchange',
          vendor_item_id: pickStr(first, ['vendorItemId', 'vendorItemID']) || null,
          product_name: pickStr(first, ['vendorItemName', 'sellerProductName', 'productName']),
          quantity: items.reduce((n: number, it: any) => n + pickNum(it, ['quantity', 'exchangeQuantity'], 1), 0),
          reason: pickStr(ex, ['reasonCodeText', 'exchangeReason', 'reason']),
          fault: pickStr(ex, ['faultByType', 'faultBy']),
          status: pickStr(ex, ['exchangeStatus', 'status', 'statusName']),
          requested_at: toIso(pickRaw(ex, ['createdAt', 'requestedAt'])),
          raw: ex,
          updated_at: new Date().toISOString(),
        });
      }
      nextToken = nextTokenOf(r.data);
      if (!nextToken) break;
    }
  }

  const err = await upsertChunked('coupang_returns', rows, 'user_id,receipt_id');
  if (err) sum.errors.push(err);
  sum.returns = rows.length;

  // 결제완료 단계 취소. 같은 API에 status 없이 cancelType=CANCEL로 물으면 온다
  // (쿠팡 FAQ). 로켓그로스 주문 API는 취소 여부를 안 주므로 — 응답 키가
  // vendorId·orderId·paidAt·orderItems 네 개뿐이다 — 그로스 판매수가 쿠팡 자체
  // 30일 집계보다 20~40% 많았다. 여기서 잡히는 주문번호가 그로스 주문과 겹치면
  // 그게 답이다. 반품 표와 섞지 않고 따로 둔다 — 반품 분석 화면이 취소를 반품으로
  // 세면 안 된다.
  const cancelRows: any[] = [];
  let cancelShapeLogged = false;
  for (const [cFrom, cTo] of dateChunks(from, to, 14)) {
    if (outOfTime(deadline, sum)) break;
    let nextToken = '';
    for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
      if (outOfTime(deadline, sum)) break;
      const query =
        `createdAtFrom=${cFrom}&createdAtTo=${cTo}&cancelType=CANCEL&maxPerPage=50` +
        (nextToken ? `&nextToken=${nextToken}` : '');
      let r = await callReturns(query);
      if (!r.ok && r.status === 429 && !outOfTime(deadline, sum)) {
        await sleep(3_000);
        r = await callReturns(query);
      }
      if (!r.ok) {
        if (r.authFailed) {
          sum.authFailed = true;
          return;
        }
        const msg = `취소 조회: ${r.error}`;
        if (!sum.errors.includes(msg)) sum.errors.push(msg);
        break;
      }
      const list = listOf(r.data);
      if (!cancelShapeLogged && list[0]) {
        cancelShapeLogged = true;
        const first = list[0];
        const items = Array.isArray(first?.returnItems) ? first.returnItems : [];
        console.info('coupang cancel shape —', `${list.length}건 / 키=${Object.keys(first).join(',')}` +
          (items[0] ? ` / 항목키=${Object.keys(items[0]).join(',')}` : ''));
      }
      for (const c of list) {
        const receiptId = pickStr(c, ['receiptId', 'cancelId', 'returnDeliveryId']);
        if (!receiptId) continue;
        const items = Array.isArray(c?.returnItems) ? c.returnItems : [c];
        const first = items[0] ?? {};
        cancelRows.push({
          user_id: userId,
          receipt_id: `C${receiptId}`,
          order_id: pickStr(c, ['orderId', 'orderID']) || null,
          vendor_item_id: pickStr(first, ['vendorItemId', 'vendorItemID']) || null,
          quantity: items.reduce((n: number, it: any) => n + pickNum(it, ['cancelCount', 'purchaseCount', 'quantity'], 1), 0),
          cancel_type: pickStr(c, ['cancelType', 'receiptType']) || null,
          status: pickStr(c, ['receiptStatus', 'status', 'receiptStatusName']) || null,
          requested_at: toIso(pickRaw(c, ['createdAt', 'receiptInsertDate', 'requestedAt'])),
          raw: c,
          updated_at: new Date().toISOString(),
        });
      }
      nextToken = nextTokenOf(r.data);
      if (!nextToken) break;
    }
  }
  if (cancelRows.length > 0) {
    const cErr = await upsertChunked('coupang_order_cancels', cancelRows, 'user_id,receipt_id');
    if (cErr) sum.errors.push(`취소 저장: ${cErr}`);
    console.info('coupang cancels —', `${cancelRows.length}건 (${from}~${to})`);
  }
}

// ── 고객문의 동기화 ───────────────────────────────────────────
// 조회 구간이 최대 7일이라 짧게 끊어 돈다. 미답변만 받아 온다.
async function syncInquiries(userId: string, creds: CoupangCreds, sum: SyncSummary, deadline: number): Promise<void> {
  if (!supabase) return;

  const today = kstToday();
  const from = addDays(today, -LIMITS.inquiryDays + 1);
  const rows: any[] = [];
  // 목록을 끝까지 받았는지. 정합은 '이 구간의 미답변 전체'를 안다는 전제 위에서만
  // 안전하다. 페이지 상한에 걸리거나 중간에 끊기면 못 받은 문의가 '답변됨'으로
  // 뒤집히므로, 완주했을 때만 정합한다.
  let inquiriesComplete = false;

  for (let pageNum = 1; pageNum <= 40; pageNum++) {
    if (outOfTime(deadline, sum)) break;
    const query =
      `vendorId=${creds.vendorId}&inquiryStartAt=${from}&inquiryEndAt=${today}` +
      `&answeredType=NOANSWER&pageNum=${pageNum}&pageSize=50`;
    const r = await coupangCallVersioned(
      creds, 'GET',
      v => EP.onlineInquiries(v, creds.vendorId),
      query, ['v5', 'v4'], 'onlineInquiries',
    );
    if (!r.ok) {
      if (r.authFailed) {
        sum.authFailed = true;
        return;
      }
      sum.errors.push(`고객문의: ${r.error}`);
      break;
    }
    const list = listOf(r.data);
    // 페이지 크기를 쿠팡이 그대로 지킨다는 보장이 없어, 빈 페이지를 만날 때까지 돈다
    if (list.length === 0) {
      inquiriesComplete = true;
      break;
    }
    for (const q of list) {
      const inquiryId = pickStr(q, ['inquiryId', 'inquiryID', 'id']);
      if (!inquiryId) continue;
      rows.push({
        user_id: userId,
        inquiry_id: inquiryId,
        source: 'product',
        vendor_item_id: pickStr(q, ['vendorItemId', 'vendorItemID']) || null,
        product_name: pickStr(q, ['sellerProductName', 'vendorItemName', 'productName']),
        content: pickStr(q, ['content', 'inquiryContent', 'question']),
        customer_name: pickStr(q, ['buyerName', 'customerName', 'memberId']),
        inquired_at: toIso(pickRaw(q, ['inquiryAt', 'createdAt', 'inquiryDate'])),
        answered: false,
        raw: q,
        updated_at: new Date().toISOString(),
      });
    }
  }

  const err = await upsertChunked('coupang_inquiries', rows, 'user_id,inquiry_id');
  if (err) sum.errors.push(err);
  sum.inquiries = rows.length;

  // 정합: 이번 조회 구간 안에 있는데 미답변 목록에 없는 문의는 윙에서 직접
  // 답변된 것이다. 그대로 두면 영원히 미답변으로 남아 건수가 틀리고, 이미 답한
  // 문의에 초안을 만들어 한도를 쓰거나 두 번째 답변을 보내는 일이 생긴다.
  // 구간 조회가 끊기거나 실패했으면 목록이 불완전하므로 정합을 건너뛴다.
  if (!err && inquiriesComplete && !sum.truncated && !sum.errors.some(e => e.startsWith('고객문의'))) {
    const stillOpen = new Set(rows.map(r => String(r.inquiry_id)));
    const { rows: local } = await selectAll<{ inquiry_id: string }>((f, t) => supabase
      .from('coupang_inquiries')
      .select('inquiry_id')
      .eq('user_id', userId)
      .eq('answered', false)
      .gte('inquired_at', `${from}T00:00:00+09:00`)
      .order('inquiry_id').range(f, t));
    const answeredElsewhere = local.map(l => String(l.inquiry_id)).filter(id => !stillOpen.has(id));
    for (let i = 0; i < answeredElsewhere.length; i += 200) {
      await supabase
        .from('coupang_inquiries')
        .update({ answered: true, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .in('inquiry_id', answeredElsewhere.slice(i, i + 200));
    }
  }
}

/**
 * 사용자 1명 전체 동기화.
 *
 * deadline을 단계마다 확인한다. 상품이 많은 판매자는 첫 수집이 함수 제한
 * 시간을 넘길 수 있는데, 그때 아무것도 기록하지 않고 죽으면 매 시간 처음부터
 * 다시 시작하면서 다른 사용자의 수집까지 굶긴다. 예산이 끝나면 지금까지 받은
 * 것을 저장하고 truncated로 표시해 다음 회차가 이어받게 한다.
 */
/**
 * 첫 수집(백필)이 시간 상한에 잘렸을 때 어느 단계에서 멈췄는지를 남기고,
 * 다음 회차는 거기서부터 이어받는다.
 *
 * 예전에는 매 회차 처음부터 다시 돌았다. 60일치 그로스 주문이 1인당 100초를
 * 다 먹으면 그 뒤 단계(그로스 재고·정산·반품·문의)는 회차마다 같은 자리에서
 * 잘려 영영 못 갔다 — 실제로 한 계정이 세 번을 돌고도 그로스 재고가 0이었다.
 *
 * 앞 단계는 그 전 회차에서 이미 끝났으므로 건너뛴다. 잘린 단계 자체는 다시
 * 돈다 (저장은 덮어쓰기라 두 번 돌아도 해가 없다). 백필이 끝나면(startStep과
 * 무관하게 끝까지 잘리지 않고 돌면) 0으로 되돌아가 평소처럼 전부 돈다.
 */
const SYNC_STEPS = ['couponDefs', 'items', 'orders', 'sales', 'rocketGrowth', 'growthInventory', 'observedItems', 'settlements', 'returns', 'inquiries'] as const;

async function syncUser(
  userId: string,
  creds: CoupangCreds,
  full: boolean,
  deadline: number = Date.now() + 240_000,
  startStep = 0,
): Promise<SyncSummary> {
  const sum = emptySummary();
  const today = kstToday();
  // 백필 중일 때만 이어받는다. 평소 수집은 늘 처음부터다.
  const from = full ? Math.max(0, Math.min(startStep, SYNC_STEPS.length - 1)) : 0;

  // 단계 하나를 돌리고, 시간에 잘렸으면 그 단계를 기록한다. 이미 잘린 뒤의
  // 단계들은 outOfTime이 바로 true라 사실상 빈손으로 지나간다 — 그래서 첫
  // 잘린 단계만 남긴다.
  let stepsDone = 0;
  const step = async (i: number, run: () => Promise<void>) => {
    if (i < from) return;
    if (sum.authFailed) return;
    if (sum.truncated) {
      if (sum.stoppedAt === null) sum.stoppedAt = i;
      return;
    }
    await run();
    // 앞 단계들이 같은 키로 멀쩡히 통과한 뒤에 401·403이 오면 키 문제가 아니다.
    // 실제로 쿠폰 설정을 받은 직후 상품 목록에서 403이 와서 계정이 invalid로
    // 내려가고 판매자에게 '수집이 멈췄습니다' 메일까지 갔다 — 10분 전 회차는
    // 정상이었다. 키 거부는 첫 단계부터 거부될 때만 그렇게 본다. 그 밖에는
    // 이 회차를 여기서 멈추고(잘린 것으로 기록) 다음 회차에 다시 간다.
    if (sum.authFailed && stepsDone > 0) {
      sum.authFailed = false;
      sum.truncated = true;
      sum.errors.push(`${SYNC_STEPS[i]}: 쿠팡이 호출을 거부했습니다(401/403). 앞 단계는 정상이라 키 문제로 보지 않습니다 — 다음 회차 재시도`);
    }
    if (sum.truncated && sum.stoppedAt === null) sum.stoppedAt = i;
    if (!sum.authFailed && !sum.truncated) stepsDone++;
  };

  // 쿠폰 설정을 맨 앞에 둔다. 호출이 몇 건뿐인데 순이익의 쿠폰 금액이 여기에
  // 달려 있다. 상품 상세는 회차당 120건까지 부르므로 중계 서버가 느린 날에는
  // 그 하나가 수동 수집의 90초를 다 쓴다 — 실제로 그렇게 되어 쿠폰 설정이 한 번도
  // 돌지 못했다. 주문·매출·상품은 매시 크론(240초)이 어차피 다시 채운다.
  await step(0, () => syncCouponDefinitions(userId, creds, sum, deadline));
  await step(1, () => syncItems(userId, creds, sum, deadline));
  await step(2, () => syncOrders(userId, creds, addDays(today, -(full ? LIMITS.ordersDaysFull : LIMITS.ordersDaysIncr)), today, sum, deadline));
  // 매출내역은 종료일이 '어제 이하'여야 한다. 오늘을 넣으면 쿠팡이
  // 'To date must be before or equal to yesterday'로 구간 전체를 거절해
  // 그 회차 매출이 통째로 비어 버린다.
  await step(3, () => syncSales(
    userId, creds,
    addDays(today, -(full ? LIMITS.salesDaysFull : LIMITS.salesDaysIncr)),
    addDays(today, -1),
    sum, deadline,
  ));
  // 로켓그로스는 별도 창구다. 이걸 안 부르면 그로스 매출이 통째로 빠진다.
  await step(4, () => syncRocketGrowth(
    userId, creds,
    addDays(today, -(full ? LIMITS.rgDaysFull : LIMITS.rgDaysIncr)),
    today,
    sum, deadline,
  ));
  await step(5, () => syncGrowthInventory(userId, creds, sum, deadline));
  // 상품 상세에 옵션ID가 안 오는 계정이 있다(로켓그로스 전용 상품). 그래도 재고·매출·
  // 주문에는 옵션ID가 다 실려 오므로, 거기서 본 옵션을 상품 목록에 채운다.
  // 원가 입력·가격 관리·재고 예측이 상세 API 하나에 볼모로 잡히지 않게 한다.
  await step(6, () => backfillItemsFromObservations(userId, sum));
  await step(7, () => syncSettlements(userId, creds, sum, deadline));
  await step(8, () => syncReturns(userId, creds, addDays(today, -(full ? LIMITS.returnsDaysFull : LIMITS.returnsDaysIncr)), today, sum, deadline));
  await step(9, () => syncInquiries(userId, creds, sum, deadline));
  return sum;
}

/**
 * [임시] 그로스 취소를 알려주는 API 후보를 두드려 본다.
 * 쿠팡 개발자센터가 이 망에서 막혀 있어 명세를 못 읽는다. 결과는 로그에만
 * 남기고(상태·문구·키·건수), 한 번 돌면 app_config 키를 지워 다시 돌지 않는다.
 */
async function rgCancelProbe(
  creds: CoupangCreds,
  orderMeta: Map<string, { date: string; items: Array<{ vendorItemId: string; amount: number; qty: number }> }>,
  today: string,
  deadline: number,
): Promise<void> {
  if (!supabase) return;
  const { data: flag } = await supabase.from('app_config').select('value').eq('key', 'rg_cancel_probe').maybeSingle();
  if (!flag?.value) return;
  let orderIds: string[] = [];
  try {
    const parsed = JSON.parse(String(flag.value));
    if (Array.isArray(parsed)) orderIds = parsed.map(String);
  } catch { /* 'on' 같은 단순 값 */ }
  if (orderIds.length === 0) orderIds = [...orderMeta.keys()].slice(-2);
  const base = `/v2/providers/rg_open_api/apis/api/v1/vendors/${creds.vendorId}`;
  const from = rgDate(addDays(today, -7));
  const to = rgDate(addDays(today, 1));
  const tries: Array<[string, string, string]> = [
    ...orderIds.slice(0, 2).map(id => [`단건 rg/orders/{id}`, `${base}/rg/orders/${id}`, ''] as [string, string, string]),
    ['목록+status', `${base}/rg/orders`, `paidDateFrom=${from}&paidDateTo=${to}&status=CANCELED`],
    ['목록+orderStatus', `${base}/rg/orders`, `paidDateFrom=${from}&paidDateTo=${to}&orderStatus=CANCELED`],
    ['rg/returns', `${base}/rg/returns`, `paidDateFrom=${from}&paidDateTo=${to}`],
    ['rg/returns(빈질의)', `${base}/rg/returns`, ''],
    ['rg/cancels', `${base}/rg/cancels`, `paidDateFrom=${from}&paidDateTo=${to}`],
    ['rg/orders/cancels', `${base}/rg/orders/cancels`, `paidDateFrom=${from}&paidDateTo=${to}`],
    ['rg/order-cancellations', `${base}/rg/order-cancellations`, `paidDateFrom=${from}&paidDateTo=${to}`],
  ];
  const describe = (v: any, depth = 0): string => {
    if (v === null || v === undefined) return String(v);
    if (Array.isArray(v)) return `배열(${v.length})${v[0] !== undefined && depth < 3 ? `[${describe(v[0], depth + 1)}]` : ''}`;
    if (typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => (x && typeof x === 'object' && depth < 3 ? `${k}:${describe(x, depth + 1)}` : k)).join(',')}}`;
    return typeof v;
  };
  for (const [label, path, query] of tries) {
    if (Date.now() >= deadline - 5_000) break;
    await sleep(LIMITS.rgGapMs);
    const r = await coupangCallOnce(creds, 'GET', path, query);
    // 응답 값은 남기지 않는다. 상태·오류 문구·구조(키)만.
    console.info('rg cancel probe —', label, `status=${r.status}`, r.ok ? `모양=${describe(r.data)}` : `error=${String(r.error).slice(0, 300)}`);
  }
  await supabase.from('app_config').delete().eq('key', 'rg_cancel_probe');
}

/** 다음 회차가 이어받을 단계. 잘리지 않았으면 처음(0)으로 되돌린다 */
export function nextBackfillStep(sum: { truncated: boolean; stoppedAt: number | null }): number {
  if (!sum.truncated) return 0;
  return Math.max(0, sum.stoppedAt ?? 0);
}

// ═══════════════════════════════════════════════════════════════
// 계정(키) 관리
// ═══════════════════════════════════════════════════════════════

interface AccountRow {
  user_id: string;
  vendor_id: string;
  access_key: string;
  secret_key_enc: string;
  status: string;
  key_expires_at: string | null;
  expiry_notified_at: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  backfill_done: boolean;
  /** 백필이 잘렸을 때 다음 회차가 이어받을 단계. 0이면 처음부터 */
  backfill_step?: number | null;
  /** 지금 돌고 있는 수집이 시작된 시각. 같은 계정을 겹쳐 돌리지 않기 위한 잠금 */
  sync_started_at?: string | null;
}

/** 수집이 이 시간보다 오래 '진행 중'이면 죽은 잠금으로 보고 무시한다 (함수 상한 300초) */
const SYNC_LOCK_MS = 5 * 60_000;

function syncInProgress(acc: { sync_started_at?: string | null }): boolean {
  const t = acc.sync_started_at ? Date.parse(acc.sync_started_at) : NaN;
  return Number.isFinite(t) && Date.now() - t < SYNC_LOCK_MS;
}

async function loadAccount(userId: string): Promise<AccountRow | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('coupang_accounts').select('*').eq('user_id', userId).maybeSingle();
  return (data as AccountRow) ?? null;
}

function credsOf(acc: AccountRow): CoupangCreds {
  return { vendorId: acc.vendor_id, accessKey: acc.access_key, secretKey: decryptSecret(acc.secret_key_enc) };
}

/** 키가 실제로 동작하는지 가벼운 조회 1건으로 확인한다 */
async function verifyCreds(creds: CoupangCreds): Promise<{ ok: boolean; error?: string }> {
  const r = await coupangCall(creds, 'GET', EP.sellerProducts, `vendorId=${creds.vendorId}&maxPerPage=1`);
  if (r.ok) return { ok: true };
  // 화면에는 원인 후보를 다 적어 보내지만, 어느 쪽인지는 쿠팡이 돌려준 원문에만
  // 있다. IP 미등록인지 키 오타인지 24시간 미경과인지 로그에서 가려낼 수 있게
  // 남긴다. (키 값 자체는 찍지 않는다)
  // 'Invalid signature.'는 IP 문제가 아니라 서명이 안 맞는다는 뜻이다. 서명식은
  // 쿠팡 명세와 같으므로 대개 입력값 문제(두 키를 바꿔 넣었거나, 복사가 잘렸거나,
  // 보이지 않는 문자가 섞였거나)다. 그걸 가려낼 수 있게 값이 아니라 '형태'만 남긴다.
  const shape = (v: string) => ({
    len: v.length,
    // 쿠팡 Access Key는 하이픈이 섞인 36자 안팎, Secret Key는 하이픈 없는 영숫자다
    hasHyphen: v.includes('-'),
    // 눈에 안 보이는 문자가 섞이면 서명이 조용히 깨진다
    nonAscii: /[^\x21-\x7e]/.test(v),
  });
  console.error('[coupang] 키 확인 실패', {
    status: r.status,
    relayError: r.relayError ?? false,
    relayConfigured: Boolean(RELAY_URL),
    vendorId: creds.vendorId,
    accessKey: shape(creds.accessKey),
    secretKey: shape(creds.secretKey),
    coupangMessage: (r.error || '').slice(0, 300),
  });

  // 쿠팡은 IP 차단일 때 막힌 IP를 원문에 담아 준다. 이건 키 문제가 아니므로
  // '키를 확인하세요'로 뭉뚱그리면 사용자가 멀쩡한 키만 계속 다시 넣게 된다.
  const blockedIp = (r.error || '').match(/ip address ([\d.]+) is not allowed/i)?.[1];
  if (blockedIp) {
    return {
      ok: false,
      error: RELAY_URL
        // 윙에 IP를 넣어도 쿠팡 쪽 반영에 5~30분이 걸린다. 이 말을 안 해두면
        // 방금 등록한 사람이 "잘못 넣었나" 하고 IP를 지웠다 넣기를 반복한다.
        // 연동 정보 수정은 주 10회 제한이라 그 시행착오가 곧 한도 소진이다.
        ? `쿠팡이 IP ${blockedIp}를 막았습니다. 윙 [연동 정보]에 이 IP가 등록돼 있는지 확인해주세요. ` +
          '방금 등록하셨다면 쿠팡에 반영되기까지 5~30분 걸립니다 — 이 경우 IP를 다시 손대지 마시고 잠시 뒤 [연동하기]만 다시 눌러주세요.'
        : `키는 정상입니다. 다만 쿠팡이 호출 IP(${blockedIp})를 막았습니다. ` +
          '쿠팡은 윙에 등록된 IP에서 온 요청만 받는데, 지금은 고정 IP 없이 호출하고 있어 ' +
          '매번 IP가 바뀝니다. 관리자에게 고정 IP 중계 서버 설정을 요청해주세요.',
    };
  }

  if (r.status === 401 || r.status === 403) {
    // Access Key는 하이픈이 섞인 36자, Secret Key는 하이픈 없는 40자다.
    // 실제로 두 칸을 바꿔 넣어 'Invalid signature'만 반복된 사례가 있었다.
    const looksSwapped = creds.secretKey.includes('-') && !creds.accessKey.includes('-');
    if (looksSwapped || creds.accessKey === creds.secretKey) {
      return {
        ok: false,
        error:
          'Access Key와 Secret Key가 뒤바뀐 것 같습니다. ' +
          'Access Key는 하이픈이 들어간 36자, Secret Key는 하이픈 없는 40자입니다. ' +
          '윙에서 두 값을 각각 다시 복사해 넣어주세요.',
      };
    }
    return {
      ok: false,
      error:
        '쿠팡이 키를 거부했습니다. ①Access Key·Secret Key·업체코드에 공백이나 오타가 없는지 ' +
        '②발급 직후라면 권한이 열리기까지 최대 24시간이 걸릴 수 있다는 점 ' +
        '③윙에서 연동방식을 자체개발(직접입력)로 두고 안내된 IP를 등록했는지 확인해주세요.',
    };
  }
  return { ok: false, error: r.error || '키 확인에 실패했습니다.' };
}

/**
 * 서버 오류를 관리자 화면에 남긴다.
 *
 * Vercel 로그에만 남기면 운영자는 볼 이유가 없어 알아채지 못한다. 실제로 중계
 * 서버가 90분 죽어 있는 동안 아무도 몰랐다. 같은 오류가 반복되면 행을 늘리지
 * 않고 횟수만 올린다 — 같은 줄 100개는 목록을 못 쓰게 만든다.
 *
 * 기록 자체가 실패해도 본래 작업을 막지 않는다. 오류를 남기려다 오류를 내는 건
 * 최악이다.
 */
async function logSystemError(
  area: string,
  message: string,
  opts: { detail?: string; userId?: string | null; severity?: 'error' | 'warn' } = {},
): Promise<void> {
  if (!supabase) return;
  try {
    const msg = String(message).slice(0, 500);
    const { data: existing } = await supabase
      .from('system_errors')
      .select('id, count')
      .eq('area', area)
      .eq('message', msg)
      .is('resolved_at', null)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('system_errors')
        .update({ count: (existing.count ?? 1) + 1, last_seen_at: new Date().toISOString(), detail: opts.detail?.slice(0, 2000) ?? null })
        .eq('id', existing.id);
      return;
    }
    await supabase.from('system_errors').insert({
      area,
      message: msg,
      detail: opts.detail?.slice(0, 2000) ?? null,
      user_id: opts.userId ?? null,
      severity: opts.severity ?? 'error',
    });
  } catch {
    /* 기록 실패는 삼킨다 */
  }
}

async function setAccountStatus(userId: string, status: string, error: string | null): Promise<void> {
  if (!supabase) return;
  const { data: before } = await supabase
    .from('coupang_accounts')
    .select('status, status_notified_at, users(email, name)')
    .eq('user_id', userId)
    .maybeSingle();

  await supabase
    .from('coupang_accounts')
    .update({ status, last_sync_error: error, sync_started_at: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  // 수집이 멈춘 걸 사용자가 탭을 열어야 안다면 그동안 데이터가 비고 이유도 모른다.
  // 정상에서 거부·만료로 바뀌는 순간 한 번만 알린다.
  const broke = (status === 'invalid' || status === 'expired') && before?.status === 'active';
  const email = (before as any)?.users?.email;
  if (broke && email && !before?.status_notified_at) {
    await sendEmail(
      email,
      status === 'expired' ? '[훈프로] 쿠팡 API 키가 만료됐습니다' : '[훈프로] 쿠팡 수집이 멈췄습니다',
      wrapEmail(
        status === 'expired' ? '쿠팡 API 키 만료' : '쿠팡 연동 확인 필요',
        `<p>${escapeHtml(String((before as any)?.users?.name ?? ''))}님, 정산AI 자동 수집이 멈췄습니다.</p>` +
          `<p style="color:#ffb454;">${escapeHtml(error ?? '')}</p>` +
          `<p>윙에서 키와 등록 IP를 확인한 뒤 [정산AI → 연동 설정]에서 다시 등록해주세요. ` +
          `이미 다른 주문수집 프로그램을 쓰신다면 키를 새로 발급하지 말고 기존 키를 그대로 넣어야 그쪽 연동이 끊기지 않습니다.</p>` +
          emailButtonLink('연동 설정 열기'),
      ),
    );
    await supabase
      .from('coupang_accounts')
      .update({ status_notified_at: new Date().toISOString() })
      .eq('user_id', userId);
  }
}

/** 키 만료(발급 후 6개월)까지 남은 일수 — 발급일을 모르면 null */
// 윙은 발급일이 아니라 '유효 기간'(만료 시각)을 보여준다. 발급일을 받아
// 180일을 더해 추정하면 하루 이틀씩 어긋나므로, 만료일을 그대로 받는다.
function daysToExpiry(keyExpiresAt: string | null): number | null {
  if (!keyExpiresAt) return null;
  return daysBetween(kstToday(), keyExpiresAt.slice(0, 10));
}

// ── 이메일 (billing.ts와 같은 Resend 경로) ────────────────────

/**
 * 메일 한 통. 보냈는지 아닌지를 정직하게 돌려준다.
 *
 * 예전에는 응답 상태를 보지 않았다. 레이즌드는 실패를 예외가 아니라 상태
 * 코드로 알린다 — 도메인 미인증이면 422, 한도 초과면 429, 주소가 잘못되면
 * 400이다. 그 모두가 보이지 않게 지나갔다.
 *
 * 그런데 부르는 쪽은 보냈다고 치고 발송 기록을 남겼다. 그 날짜는 영구히
 * '보냄'이 되어 다시 시도되지 않는다. 키 만료 경고가 특히 나빴다 — 한 번
 * 놓치면 여섯 달 뒤 수집이 말없이 멈추고 아무도 이유를 모른다.
 */
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: emailFrom(),
        to: [to],
        subject,
        html,
      }),
    });
    if (!r.ok) {
      // 본문에 받는 사람 주소가 섞여 올 수 있어 상태 코드만 남긴다
      console.error('[메일] 발송 실패', { status: r.status, subject });
      return false;
    }
    return true;
  } catch (e: any) {
    console.error('[메일] 발송 예외', { subject, detail: e?.message });
    return false;
  }
}

function won(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

// ═══════════════════════════════════════════════════════════════
// 크론
// ═══════════════════════════════════════════════════════════════

/**
 * 동기화 크론 — 매시간 돌면서 '20시간 넘게 안 돈 계정'만 처리한다.
 * 시간 예산을 두고 남은 계정은 다음 시간대가 이어받으므로, 사용자가 늘어도
 * 한 번의 실행이 타임아웃에 걸리지 않는다.
 */
/**
 * 중계 서버 사전 점검. 비밀키가 어긋났거나 서버가 죽었으면 수집을 아예
 * 시작하지 않는다. 그 상태로 돌면 모든 호출이 실패하고, 실패 원인을 잘못
 * 읽으면 판매자 계정까지 무효화된다.
 */
async function relayPreflight(attempts = 2): Promise<{ ok: boolean; reason?: string }> {
  if (!RELAY_URL) return { ok: true };
  let last: { ok: boolean; reason?: string } = { ok: false, reason: '중계 서버 점검을 하지 못했습니다' };
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(1_000);
    last = await relayPreflightOnce();
    if (last.ok) return last;
  }
  return last;
}

async function relayPreflightOnce(): Promise<{ ok: boolean; reason?: string }> {
  try {
    // 주소 끝의 /relay만 잘라내면 'https://host/' 형태에서 '//health'가 되어
    // 중계 서버가 경로를 못 알아본다. 실제 호출은 되는데 점검만 실패해 매시
    // 수집이 통째로 중단된다. URL 기준으로 경로를 갈아 끼운다.
    const r = await fetch(new URL('/health', RELAY_URL).toString(), {
      headers: RELAY_SECRET ? { 'X-Relay-Secret': RELAY_SECRET } : {},
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return { ok: false, reason: `중계 서버 응답 ${r.status}` };
    const data: any = await r.json().catch(() => ({}));
    if (data?.auth === false) return { ok: false, reason: '중계 서버 비밀키가 일치하지 않습니다 (COUPANG_RELAY_SECRET 확인)' };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: `중계 서버에 닿지 못했습니다: ${e?.message ?? e}` };
  }
}

/**
 * 중계 서버가 멈춘 것을 운영자에게 알린다.
 *
 * 이 서버 하나가 죽으면 모든 판매자의 수집이 멈춘다. 그런데 크론은 로그에만
 * 남기고 조용히 끝나서, 누가 화면을 열어 보기 전까지 아무도 모른다. 실제로
 * 한 시간 반 동안 아무 데이터도 안 들어오는 걸 뒤늦게 알아챘다.
 *
 * 매시 메일이 오면 그것대로 못 쓰게 되므로, 멈춘 순간과 돌아온 순간에만 보낸다.
 * 상태는 app_config에 남긴다 — 이 하나 때문에 표를 새로 만들 이유는 없다.
 */
async function notifyRelayState(down: boolean, reason: string): Promise<void> {
  const to = (process.env.ADMIN_EMAIL || '').trim();
  if (!supabase) return;

  const { data } = await supabase.from('app_config').select('value').eq('key', 'relay_down_since').maybeSingle();
  const downSince = (data?.value ?? '').trim();

  // 상태가 그대로면 아무것도 하지 않는다
  if (down === Boolean(downSince)) return;

  const now = new Date().toISOString();
  await supabase.from('app_config').upsert(
    { key: 'relay_down_since', value: down ? now : '', updated_at: now },
    { onConflict: 'key' },
  );
  if (!to) return;

  if (down) {
    await sendEmail(to, '[훈프로] 쿠팡 중계 서버가 응답하지 않습니다', wrapEmail(
      '쿠팡 중계 서버 점검 필요',
      `<p>고정 IP 중계 서버에 닿지 못해 <b>모든 판매자의 쿠팡 수집이 멈췄습니다.</b></p>` +
        `<p style="color:#ffb454;">${escapeHtml(reason)}</p>` +
        `<p>서버가 켜져 있어도 중계 프로그램이나 HTTPS가 죽어 있을 수 있습니다. ` +
        `<code>/health</code> 주소를 열어 <code>{"ok":true}</code>가 나오는지 먼저 확인해주세요.</p>`,
    ));
  } else {
    const minutes = downSince ? Math.round((Date.now() - Date.parse(downSince)) / 60000) : 0;
    await sendEmail(to, '[훈프로] 쿠팡 중계 서버가 복구됐습니다', wrapEmail(
      '쿠팡 중계 서버 복구',
      `<p>중계 서버가 다시 응답합니다. 수집이 이어서 돕니다.</p>` +
        (minutes > 0 ? `<p>멈춰 있던 시간: 약 ${minutes}분</p>` : ''),
    ));
  }
}

async function cronSync(res: VercelResponse) {
  if (!supabase) return res.status(200).json({ ok: false, reason: 'supabase 미설정' });

  const preflight = await relayPreflight();
  await notifyRelayState(!preflight.ok, preflight.reason ?? '');
  if (!preflight.ok) {
    console.error('coupang cron aborted:', preflight.reason);
    await logSystemError('중계 서버', '중계 서버에 닿지 못해 전체 수집이 중단됐습니다', {
      detail: preflight.reason,
    });
    return res.status(200).json({ ok: false, reason: preflight.reason });
  }

  const budgetMs = 240_000; // maxDuration 300초 안에서 여유를 남긴다
  // 한 사용자가 예산 전체를 먹지 않도록 1인당 상한을 따로 둔다. 상품이 많은
  // 판매자의 첫 수집은 몇 회차에 나눠 끝나고, 그동안 다른 사용자도 돈다.
  const perUserMs = 100_000;
  const startedAt = Date.now();
  const staleBefore = new Date(Date.now() - 20 * 3600_000).toISOString();

  // 첫 수집(백필)이 시간 상한에 잘린 계정은 매 회차 이어받는다. 20시간을
  // 기다리게 하면 새로 연동한 판매자가 60일치를 다 받는 데 며칠이 걸린다 —
  // 실제로 한 계정이 첫 회차에 100초를 다 쓰고 그로스 재고·정산은 손도 못 댔다.
  // 1인당 100초·회차당 240초 상한은 그대로라 다른 계정을 굶기지는 않는다.
  const { data: accounts } = await supabase
    .from('coupang_accounts')
    .select('*')
    .eq('status', 'active')
    .or(`last_sync_at.is.null,backfill_done.eq.false,last_sync_at.lt.${staleBefore}`)
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(50);

  const result = { processed: 0, truncated: 0, skipped: 0, authFailed: 0, errors: [] as string[] };

  for (const acc of (accounts ?? []) as AccountRow[]) {
    const remaining = budgetMs - (Date.now() - startedAt);
    if (remaining <= 10_000) {
      result.skipped++;
      continue;
    }
    // 수동 수집이 돌고 있는 계정은 건너뛴다. 같은 키로 두 번 돌면 쿠팡 한도(429)에
    // 걸려 두 쪽 다 빈손이 된다.
    if (syncInProgress(acc)) {
      result.skipped++;
      continue;
    }
    await supabase.from('coupang_accounts').update({ sync_started_at: new Date().toISOString() }).eq('user_id', acc.user_id);
    try {
      // 백필이 끝나지 않았으면 계속 넓은 구간으로 받는다. '한 번이라도 돌았는지'가
      // 아니라 '전부 받았는지'를 기준으로 삼아야, 중간에 끊긴 첫 수집이 완성된다.
      const needsBackfill = !acc.backfill_done;
      const sum = await syncUser(
        acc.user_id,
        credsOf(acc),
        needsBackfill,
        Date.now() + Math.min(perUserMs, remaining - 5_000),
        // 지난 회차에 잘린 단계부터 이어받는다. 매번 처음부터면 같은 자리에서 또 잘린다.
        needsBackfill ? Number(acc.backfill_step) || 0 : 0,
      );
      if (sum.authFailed) {
        await setAccountStatus(acc.user_id, 'invalid', '쿠팡이 키를 거부했습니다. 키 또는 등록 IP를 확인해주세요.');
        result.authFailed++;
        continue;
      }
      // 중간에 끊겼어도 last_sync_at은 갱신한다. 그래야 이 계정이 대기열 맨 앞에
      // 계속 머물며 다른 사용자를 막지 않는다.
      await supabase
        .from('coupang_accounts')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_error: sum.errors.length ? sum.errors.slice(0, 3).join(' / ') : null,
          backfill_done: acc.backfill_done || (needsBackfill && !sum.truncated),
          backfill_step: needsBackfill ? nextBackfillStep(sum) : 0,
          sync_started_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', acc.user_id);
      if (sum.truncated) result.truncated++;
      else result.processed++;
    } catch (e: any) {
      const detail = e?.message ?? String(e);
      result.errors.push(`${acc.user_id}: ${detail}`);
      await logSystemError('쿠팡 수집', '수집 중 예외가 발생했습니다', {
        detail, userId: acc.user_id,
      });
      // 계정 행에도 남긴다. 예외로 빠지면 last_sync_at을 안 건드리므로 이
      // 계정은 대기열 맨 앞에 머물며 매시 같은 자리에서 죽는다. 그런데 사유가
      // 시스템 오류 목록에만 있어서, [쿠팡 현황]에서는 '아직 한 번도 수집 안 됨'
      // 으로만 보였다. 왜 안 되는지는 그 화면에서 바로 보여야 한다.
      await supabase
        .from('coupang_accounts')
        .update({ last_sync_error: detail.slice(0, 300), sync_started_at: null, updated_at: new Date().toISOString() })
        .eq('user_id', acc.user_id);
    }
  }

  return res.status(200).json({ ok: true, ...result });
}

/**
 * 하루 1회 점검 — 키 만료 임박 알림과 오래된 데이터 정리.
 * 쿠팡 키는 6개월마다 갱신해야 하는데, 방치하면 어느 날 조용히 동기화가
 * 멈추고 사용자는 숫자가 안 늘어나는 것만 본다. 미리 알린다.
 */
async function cronDaily(res: VercelResponse) {
  if (!supabase) return res.status(200).json({ ok: false, reason: 'supabase 미설정' });

  const today = kstToday();
  const result = { notified: 0, expired: 0, purged: 0 };

  const { data: accounts } = await supabase
    .from('coupang_accounts')
    .select('*, users(email, name)')
    .not('key_expires_at', 'is', null);

  for (const acc of (accounts ?? []) as any[]) {
    const left = daysToExpiry(acc.key_expires_at);
    if (left === null) continue;

    if (left <= 0 && acc.status === 'active') {
      await setAccountStatus(acc.user_id, 'expired', '쿠팡 API 키 유효기간(6개월)이 지났습니다. 윙에서 갱신 후 다시 등록해주세요.');
      result.expired++;
    }

    // 14일 전에 한 번, 3일 전에 한 번만 보낸다.
    // 이전 조건은 '오늘 보낸 적 없으면 보낸다'였는데, 크론이 하루 한 번 도니까
    // 조건이 늘 참이 되어 14일 내내 매일 메일이 나갔다.
    // expiry_notified_at은 키를 새로 저장할 때 비워지므로 발급 주기마다 초기화된다.
    const notifiedAt = acc.expiry_notified_at ? String(acc.expiry_notified_at).slice(0, 10) : null;
    const daysSinceNotice = notifiedAt ? daysBetween(notifiedAt, today) : null;
    const firstNotice = notifiedAt === null && left <= 14;
    const finalNotice = notifiedAt !== null && left <= 3 && (daysSinceNotice ?? 0) >= 7;

    if (left > 0 && (firstNotice || finalNotice)) {
      const email = acc.users?.email;
      const name = acc.users?.name ?? '';
      if (email) {
        const notified = await sendEmail(
          email,
          `[훈프로] 쿠팡 API 키가 ${left}일 후 만료됩니다`,
          wrapEmail(
            '쿠팡 API 키 갱신 안내',
            `<p>${name}님, 등록하신 쿠팡 Open API 키가 <b style="color:#e8ecf5;">${left}일 후</b> 만료됩니다.</p>` +
              `<p>만료되면 매출·정산 자동 수집이 멈춥니다. 쿠팡 윙에서 키를 갱신한 뒤 훈프로의 [쿠팡 연동] 화면에서 다시 등록해주세요.</p>` +
              `<p style="color:#ffb454;">이미 다른 주문수집 프로그램을 쓰신다면 키를 새로 발급하지 마시고, 갱신된 같은 키를 그대로 붙여넣어야 그쪽 연동이 끊기지 않습니다.</p>`,
          ),
        );
        // 못 보냈으면 알림 날짜를 찍지 않는다. 찍으면 이 키는 다시 경고받지
        // 못하고, 여섯 달 뒤 수집이 말없이 멈춘다.
        if (notified) {
          await supabase
            .from('coupang_accounts')
            .update({ expiry_notified_at: today })
            .eq('user_id', acc.user_id);
          result.notified++;
        }
      }
    }
  }

  // 자동 가격 반영 — 옵션별로 따로 켠 것만 움직인다.
  // 사용자 수에 비례해 길어지므로 시간 예산을 두고, 남은 사용자는 내일 이어받는다.
  // (반영을 못 한 것은 손해가 아니지만 함수가 타임아웃되면 뒤의 정리까지 못 돈다)
  const priceStartedAt = Date.now();
  const priceBudgetMs = 180_000;
  const { data: autoAccounts } = await supabase
    .from('coupang_accounts')
    .select('*')
    .eq('status', 'active');
  let priceApplied = 0;
  for (const acc of (autoAccounts ?? []) as AccountRow[]) {
    if (Date.now() - priceStartedAt > priceBudgetMs) break;
    try {
      const r = await runAutoPricing(acc.user_id, credsOf(acc));
      priceApplied += r.applied;
    } catch {
      /* 한 사용자의 실패가 나머지를 막지 않게 */
    }
  }

  // 저장공간 관리 — 원본을 오래 들고 있을 이유가 없다
  const { count } = await supabase
    .from('coupang_returns')
    .delete({ count: 'exact' })
    .lt('requested_at', addDays(today, -365));
  result.purged = count ?? 0;
  await supabase.from('coupang_inquiries').delete().lt('inquired_at', addDays(today, -90));
  await supabase.from('coupang_price_logs').delete().lt('created_at', addDays(today, -180));

  return res.status(200).json({ ok: true, ...result, priceApplied });
}

// ═══════════════════════════════════════════════════════════════
// 메인 핸들러
// ═══════════════════════════════════════════════════════════════
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = String(req.query.action || req.body?.action || '');

  // ── 크론 (CRON_SECRET 자체 인증) ──
  if (action === 'cron') {
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    // 실행 기록을 남긴다. 크론이 멈춰도 화면은 어제 숫자를 그대로 보여 줘서
    // 아무 일도 없어 보인다 — 관리자 [시스템 상태]에서 확인한다.
    const type = String(req.query.type || 'sync');
    if (type === 'daily') return await runCron(supabase, 'coupang-daily', res, () => cronDaily(res));
    if (type === 'weekly') return await runCron(supabase, 'coupang-weekly', res, () => cronWeeklyReport(res));
    if (type === 'brief') return await runCron(supabase, 'coupang-brief', res, () => cronMorningBrief(res));
    return await runCron(supabase, 'coupang-sync', res, () => cronSync(res));
  }

  if (!supabase) return res.status(500).json({ error: 'Supabase가 설정되지 않았습니다.' });

  // ── 사용자 인증 ──
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: '인증이 필요합니다.' });
  let decoded: any;
  try {
    decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET!);
  } catch {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다. 다시 로그인해주세요.' });
  }
  const userId: string = decoded.userId;

  // 접근 게이트 — 아직 우리 회원인가, 유료화가 켜졌다면 구독이 있는가.
  // 판정은 src/lib/accessGate.ts 한 곳에 있다. 예전에는 이 검사가 파일
  // 여섯 곳에 복사돼 있었고, 회원 상태는 아예 보지 않아 탈퇴·거절된
  // 사람이 토큰이 만료되는 7일까지 계속 쓸 수 있었다.
  const denied = await checkAccess(supabase, decoded.userId, decoded.isAdmin === true);
  if (denied) return res.status(denied.status).json(denied.body);

  // 관리자가 끈 화면은 서버에서도 막는다
  const tabBlocked = await tabDisabledMessage(supabase, 'coupang', decoded.isAdmin === true);
  if (tabBlocked) return res.status(403).json({ error: tabBlocked });

  try {
    switch (action) {
      case 'status': return await handleStatus(userId, res);
      case 'key-save': return await handleKeySave(userId, req, res);
      case 'key-delete': return await handleKeyDelete(userId, res);
      case 'sync': return await handleSync(userId, req, res);
      case 'profit': return await handleProfit(userId, req, res);
      case 'profit-monthly': return await handleProfitMonthly(userId, req, res);
      case 'sales-movers': return await handleSalesMovers(userId, res);
      case 'costs': return await handleCosts(userId, res);
      case 'cost-save': return await handleCostSave(userId, req, res);
      case 'ad-costs': return await handleAdCosts(userId, req, res);
      case 'ad-cost-save': return await handleAdCostSave(userId, req, res);
      case 'ad-cost-delete': return await handleAdCostDelete(userId, req, res);
      case 'ad-import-url': return await handleAdImportUrl(userId, req, res);
      case 'ad-report-raw': return await handleAdReportRaw(userId, req, res);
      case 'ad-report-raw-save': return await handleAdReportRawSave(userId, req, res);
      case 'margin-preset': return await handleMarginPreset(userId, req, res);
      case 'settlement': return await handleSettlement(userId, res);
      case 'settlement-check': return await handleSettlementCheck(userId, req, res);
      case 'settlement-check-save': return await handleSettlementCheckSave(userId, req, res);
      case 'reports': return await handleReports(userId, res);
      case 'brief-settings': return await handleBriefSettings(userId, req, res);
      case 'reorder-rule': return await handleReorderRule(userId, req, res);
      case 'inventory': return await handleInventory(userId, req, res);
      case 'growth-reconcile': return await handleGrowthReconcile(userId, res);
      case 'growth-cancel-upload': return await handleGrowthCancelUpload(userId, req, res);
      case 'wing-capture': {
        // 윙 즐겨찾기가 기록한 요청 경로·상태(값 없음). 판매분석 다운로드가 어느
        // 주소로 가는지 알아내 다음 판에는 클릭 없이 바로 부르기 위한 단서다.
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const list = Array.isArray(req.body?.requests) ? req.body.requests.slice(0, 80) : [];
        console.info('wing capture —', JSON.stringify({ userId, page: String(req.body?.page ?? '').slice(0, 120), ok: Boolean(req.body?.ok), requests: list }).slice(0, 8000));
        return res.status(200).json({ ok: true });
      }
      case 'growth-inbound-save': return await handleGrowthInboundSave(userId, req, res);
      case 'growth-inbound-delete': return await handleGrowthInboundDelete(userId, req, res);
      case 'returns': return await handleReturns(userId, req, res);
      case 'return-reasons': return await handleReturnReasons(userId, req, res);
      case 'coupon-effect': return await handleCouponEffect(userId, req, res);
      case 'inquiries': return await handleInquiries(userId, req, res);
      case 'inquiry-draft': return await handleInquiryDraft(userId, req, res);
      case 'inquiry-reply': return await handleInquiryReply(userId, req, res);
      case 'rank-revenue': return await handleRankRevenue(userId, res);
      case 'my-rates': return await handleMyRates(userId, req, res);
      case 'my-products': return await handleMyProducts(userId, req, res);
      case 'price-rules': return await handlePriceRules(userId, res);
      case 'price-rule-save': return await handlePriceRuleSave(userId, req, res);
      case 'price-apply': return await handlePriceApply(userId, req, res);
      case 'admin-overview': return await handleAdminOverview(decoded, res);
      case 'admin-vendors': return await handleAdminVendors(decoded, req, res);
      case 'admin-sync': return await handleAdminSync(decoded, req, res);
      default:
        return res.status(400).json({ error: `알 수 없는 요청입니다: ${action || '(없음)'}` });
    }
  } catch (e: any) {
    console.error('coupang api error:', e);
    return res.status(500).json({ error: e?.message || '처리 중 오류가 발생했습니다.' });
  }
}

/**
 * 관리자: 특정 회원의 계정을 지금 수집한다.
 *
 * [지금 수집]은 판매자 본인 화면에만 있었다. 관리자는 문의가 왔을 때 "다음
 * 정시 크론까지 기다리세요"밖에 할 말이 없었고, 고친 코드가 실제로 도는지
 * 확인하려면 한 시간을 기다려야 했다. 크론이 도는 것과 같은 경로(handleSync)를
 * 그 회원 id로 부른다 — 별도 로직이 아니라 같은 코드라 결과도 같다.
 */
async function handleAdminSync(decoded: any, req: VercelRequest, res: VercelResponse) {
  if (!decoded?.isAdmin) return res.status(403).json({ error: '관리자만 쓸 수 있습니다.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const target = String(req.body?.userId ?? '').trim();
  if (!target) return res.status(400).json({ error: '어느 회원인지 지정해주세요.' });
  // 누가 언제 남의 계정 수집을 눌렀는지는 남긴다. 키 값은 찍지 않는다.
  console.info('[coupang] 관리자 수동 수집', { by: decoded.userId, target });
  // 판매자 본인 버튼은 90초로 끊는다 — 화면 앞에서 기다리는 사람이 있다.
  // 관리자는 백필을 끝내려고 누르는 것이라 함수 상한(300초) 안에서 넉넉히 준다.
  return await handleSync(target, req, res, 240_000);
}

// ── 주문수집 업체 IP 목록 ─────────────────────────────────────
// 자체개발 모드에서는 업체를 하나 고르는 게 아니라 IP를 여러 개 등록한다.
// 그래서 기존 프로그램의 IP를 훈프로 IP와 함께 넣으면 둘 다 돈다.
// 판매자가 업체에 일일이 전화하지 않도록 우리가 목록을 갖고 있는다.
// (app_config.coupang_vendors에서 관리자가 편집한다)

interface VendorEntry {
  id: string;
  name: string;
  ips: string[];
}

const DEFAULT_VENDORS: VendorEntry[] = [
  // 토글 고객센터가 안내한 주문 수집 필수 IP
  {
    id: 'togle',
    name: '토글 (토글랩스)',
    ips: ['61.251.171.79', '61.251.171.82', '61.251.171.84', '61.251.171.86', '61.251.171.88', '61.251.171.133'],
  },
];

function sanitizeVendors(raw: unknown): VendorEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: VendorEntry[] = [];
  for (const v of raw.slice(0, 40)) {
    const name = String((v as any)?.name ?? '').trim().slice(0, 40);
    if (!name) continue;
    const ips = Array.isArray((v as any)?.ips)
      ? (v as any).ips
          .map((ip: unknown) => String(ip).trim())
          // 윙이 받는 것은 IPv4뿐이다. 형식이 어긋난 값은 넣어봐야 등록이 안 된다.
          .filter((ip: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(n => Number(n) <= 255))
          .slice(0, 10)
      : [];
    out.push({ id: String((v as any)?.id ?? name).trim().slice(0, 40) || name, name, ips });
  }
  return out;
}

async function loadVendors(): Promise<VendorEntry[]> {
  if (!supabase) return DEFAULT_VENDORS;
  try {
    const { data } = await supabase
      .from('app_config').select('value').eq('key', 'coupang_vendors').maybeSingle();
    if (!data?.value) return DEFAULT_VENDORS;
    const parsed = sanitizeVendors(JSON.parse(data.value));
    return parsed.length > 0 ? parsed : DEFAULT_VENDORS;
  } catch {
    return DEFAULT_VENDORS;
  }
}

// 관리자: 업체·IP 목록 조회/저장
async function handleAdminVendors(decoded: any, req: VercelRequest, res: VercelResponse) {
  if (!decoded?.isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });

  if (req.method === 'POST') {
    const cleaned = sanitizeVendors(req.body?.vendors);
    const { error } = await supabase!.from('app_config').upsert({
      key: 'coupang_vendors',
      value: JSON.stringify(cleaned),
      updated_at: new Date().toISOString(),
    });
    if (error) return res.status(500).json({ error: '저장에 실패했습니다.' });
    return res.status(200).json({ ok: true, vendors: cleaned });
  }

  return res.status(200).json({ vendors: await loadVendors() });
}

// ── 연동 상태 ─────────────────────────────────────────────────
async function handleStatus(userId: string, res: VercelResponse) {
  const acc = await loadAccount(userId);
  if (!acc) {
    // 아직 연동 전이면 온보딩 화면이 업체별 IP 목록을 그려야 한다
    return res.status(200).json({
      connected: false,
      relayIp: process.env.COUPANG_RELAY_IP || null,
      vendors: await loadVendors(),
    });
  }

  const [{ count: itemCount }, salesDates] = await Promise.all([
    supabase!.from('coupang_items').select('vendor_item_id', { count: 'exact', head: true }).eq('user_id', userId),
    // 행 수는 날짜 × 옵션이라 '일치'가 아니다. 날짜를 세야 한다.
    // 1000행 상한에 걸리면 며칠치인지가 어느 순간부터 안 늘어나므로 끝까지 읽는다.
    selectAll<{ sale_date: string }>((f, t) =>
      supabase!.from('coupang_sales_daily').select('sale_date').eq('user_id', userId)
        .order('sale_date').range(f, t)),
  ]);
  const salesDays = new Set(salesDates.rows.map(r => String(r.sale_date))).size;

  return res.status(200).json({
    connected: true,
    vendorId: acc.vendor_id,
    accessKeyMasked: `${acc.access_key.slice(0, 6)}${'*'.repeat(Math.max(0, acc.access_key.length - 10))}${acc.access_key.slice(-4)}`,
    status: acc.status,
    lastSyncAt: acc.last_sync_at,
    lastSyncError: acc.last_sync_error,
    keyExpiresAt: acc.key_expires_at,
    daysToExpiry: daysToExpiry(acc.key_expires_at),
    itemCount: itemCount ?? 0,
    salesDays,
    relayIp: process.env.COUPANG_RELAY_IP || null,
  });
}

// ── 키 등록 ───────────────────────────────────────────────────
async function handleKeySave(userId: string, req: VercelRequest, res: VercelResponse) {
  const vendorId = String(req.body?.vendorId ?? '').trim();
  const accessKey = String(req.body?.accessKey ?? '').trim();
  const secretKey = String(req.body?.secretKey ?? '').trim();
  const keyExpiresAt = String(req.body?.keyExpiresAt ?? '').trim() || null;

  if (!vendorId || !accessKey || !secretKey) {
    return res.status(400).json({ error: '업체코드, Access Key, Secret Key를 모두 입력해주세요.' });
  }
  if (!/^A?\d{6,}$/i.test(vendorId.replace(/^A/i, 'A'))) {
    return res.status(400).json({
      error: '업체코드 형식이 올바르지 않습니다. 윙에서 확인한 A로 시작하는 업체코드(예: A00123456)를 입력해주세요.',
    });
  }

  // 저장 전에 실제로 동작하는지 확인한다. 오타·권한 대기를 그 자리에서 잡는다.
  const check = await verifyCreds({ vendorId, accessKey, secretKey });
  if (!check.ok) return res.status(400).json({ error: check.error });

  const { error } = await supabase!.from('coupang_accounts').upsert(
    {
      user_id: userId,
      vendor_id: vendorId,
      access_key: accessKey,
      secret_key_enc: encryptSecret(secretKey),
      status: 'active',
      key_expires_at: keyExpiresAt,
      expiry_notified_at: null,
      last_verified_at: new Date().toISOString(),
      last_sync_error: null,
      backfill_done: false,
      status_notified_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) { console.error('[쿠팡] 저장 실패', { detail: error.message }); return res.status(500).json({ error: '저장하지 못했습니다. 잠시 후 다시 시도해주세요.' }); }

  return res.status(200).json({ ok: true, message: '연동됐습니다. 첫 수집은 최대 몇 분 걸릴 수 있습니다.' });
}

async function handleKeyDelete(userId: string, res: VercelResponse) {
  await supabase!.from('coupang_accounts').delete().eq('user_id', userId);
  return res.status(200).json({ ok: true });
}

// ── 수동 동기화 ───────────────────────────────────────────────
async function handleSync(userId: string, req: VercelRequest, res: VercelResponse, budgetMs = 90_000) {
  const acc = await loadAccount(userId);
  if (!acc) return res.status(400).json({ error: '먼저 쿠팡 API 키를 등록해주세요.' });

  const full = req.body?.full === true || String(req.query.full) === 'true' || !acc.backfill_done;

  // 같은 계정이 이미 돌고 있으면 겹쳐 돌리지 않는다. 화면을 새로고침하고 다시
  // 누르면 두 회차가 같은 키로 쿠팡을 두드려 429가 나고, 두 쪽 다 그로스
  // 매출·쿠폰을 빈손으로 끝낸다 — 실제로 그렇게 됐다.
  if (syncInProgress(acc)) {
    const since = Math.round((Date.now() - Date.parse(acc.sync_started_at!)) / 1000);
    return res.status(409).json({
      error: `이 계정의 수집이 이미 진행 중입니다 (${since}초 전 시작). 끝날 때까지 기다렸다가 새로고침해주세요.`,
    });
  }

  // 중계 서버부터 확인한다. 죽어 있으면 모든 호출이 연결 대기에 걸려, 판매자는
  // 90초를 기다린 끝에 '상품 목록: fetch failed' 같은 속뜻 없는 문구를 본다.
  // 원인이 훈프로도 쿠팡 키도 아니라는 것을 그 자리에서 알려준다.
  const relay = await relayPreflight();
  if (!relay.ok) {
    await logSystemError('중계 서버', '중계 서버에 닿지 못해 수집을 시작하지 못했습니다', {
      detail: relay.reason, userId,
    });
    await supabase!
      .from('coupang_accounts')
      .update({ last_sync_error: `중계 서버 점검 실패: ${relay.reason}`, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    return res.status(503).json({
      error: `쿠팡 연결 중계 서버가 응답하지 않아 수집을 시작하지 못했습니다. 잠시 뒤 다시 시도해주세요. (${relay.reason})`,
    });
  }

  // 화면이 기다리는 요청이다. 4분 동안 스피너만 보여주지 않도록 90초에서 끊고
  // (관리자의 [지금 수집]은 240초), 못 받은 몫은 truncated로 표시해 다음 회차가
  // 잘린 단계부터 이어받게 한다.
  await supabase!.from('coupang_accounts').update({ sync_started_at: new Date().toISOString() }).eq('user_id', userId);
  let sum: SyncSummary;
  try {
    sum = await syncUser(
      userId, credsOf(acc), full, Date.now() + budgetMs,
      full ? Number(acc.backfill_step) || 0 : 0,
    );
  } catch (e) {
    await supabase!.from('coupang_accounts').update({ sync_started_at: null }).eq('user_id', userId);
    throw e;
  }
  // 계정 행의 last_sync_error는 세 건까지만 남는다. 네 번째부터는 여기에만 있다.
  console.info('[coupang] 수집 결과', {
    userId, full, truncated: sum.truncated,
    stoppedAt: sum.stoppedAt === null ? null : SYNC_STEPS[sum.stoppedAt],
    errors: sum.errors,
  });

  if (sum.authFailed) {
    await setAccountStatus(userId, 'invalid', '쿠팡이 키를 거부했습니다. 키 또는 등록 IP를 확인해주세요.');
    return res.status(400).json({
      error: '쿠팡이 키를 거부했습니다. 키가 만료됐거나, 호출 IP가 윙에 등록되지 않았을 수 있습니다.',
    });
  }

  await supabase!
    .from('coupang_accounts')
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_error: sum.errors.length ? sum.errors.slice(0, 3).join(' / ') : null,
      backfill_done: acc.backfill_done || (full && !sum.truncated),
      backfill_step: full && !acc.backfill_done ? nextBackfillStep(sum) : 0,
      sync_started_at: null,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  return res.status(200).json({
    ok: true,
    summary: sum,
    // 화면이 "어디까지 갔고 다음에 어디서 이어받는지"를 말할 수 있게
    stoppedAt: sum.stoppedAt === null ? null : SYNC_STEPS[sum.stoppedAt] ?? null,
  });
}



// ═══════════════════════════════════════════════════════════════
// [1] 상품별 순이익 대시보드
//
// 순이익 = 정산예정액 − (매입원가 + 부자재 + 출고배송비) × 판매수량 − 반품 배송비
// 정산예정액은 이미 쿠팡 수수료가 빠진 금액이라 수수료를 또 빼면 안 된다.
//
// 광고비는 상품 단위로 가져올 방법이 없다. 쿠팡 광고 데이터는 윙 API가 아니라
// 광고센터에 있고 일반 셀러에게 열려 있지 않다. 그래서 광고비는 기간 총액으로만
// 반영하고, 저장된 광고 보고서가 있으면 그 값을 기본값으로 제안한다.
// ═══════════════════════════════════════════════════════════════

interface ProfitRow {
  vendorItemId: string;
  productName: string;
  optionName: string;
  quantity: number;
  salesAmount: number;
  commission: number;
  settlementAmount: number;
  /** 같은 기간 주문에서 판매자가 부담한 쿠폰 할인. 판매가와 실제 판매가의 차이다 */
  couponDiscount: number;
  /** 쿠폰 단가의 출처. setting=쿠폰 관리 설정값, order=주문별 쿠폰 조회, sheet=발주서 할인 항목 */
  couponSource?: 'setting' | 'order' | 'sheet' | null;
  /**
   * 이 행의 쿠폰이 얼마나 믿을 만한가.
   *   setting  — 쿠폰 관리 설정값 × 판매수량
   *   exact    — 확인한 주문의 할인 합계 그대로 (주문수량 = 판매수량)
   *   adjusted — 합계에 어긋나는 수량만큼 개당(100원 단위) 보정을 더한 추정
   */
  couponBasis?: 'setting' | 'exact' | 'adjusted' | null;
  /** 반품 재판매 옵션 — 쿠팡이 새 옵션ID로 반값에 다시 파는 것. isResaleOption 참고 */
  resale?: boolean;
  /** 이 옵션에 붙은 광고비 (보고서의 광고집행 옵션ID 기준) */
  adCost: number;
  /** 이 행의 판매가 어느 채널에서 났는지. 둘 다면 'both' */
  channel: 'marketplace' | 'growth' | 'both';
  /**
   * 반품된 물건의 값 — 실판매가(판매가 − 쿠폰) × 반품수량. 매출내역에는 반품이
   * 애초에 잡히지 않으므로(구매확정 뒤에만 매출이 되고 반품은 대부분 그 전이다)
   * 순이익에서 다시 빼지 않는다. 얼마어치가 돌아왔는지 보여주는 값이다.
   */
  returnAmount: number;
  unitCostTotal: number;
  /** 반품 건수 — 배송비는 상자 하나에 한 번 나가므로 이 값으로 곱한다 */
  returnCount: number;
  /** 반품된 개수 — 얼마어치가 돌아왔는지는 이 값으로 센다 */
  returnQuantity: number;
  returnCost: number;
  profit: number;
  marginRate: number;
  costEntered: boolean;
  stock: number | null;
  salePrice: number | null;
}

function rangeFromQuery(req: VercelRequest): { from: string; to: string } {
  const today = kstToday();
  const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30) || 30));
  const from = String(req.query.from ?? '') || addDays(today, -(days - 1));
  const to = String(req.query.to ?? '') || today;
  return { from, to };
}

/** 순이익 계산 — 화면(1번)과 주간 리포트(3번)가 같은 숫자를 쓰도록 한곳에 둔다 */
/**
 * @param opts.totalsOnly 합계만 쓰는 호출(직전 기간 비교 등)에서 켠다.
 *   상품명·재고와 옵션별 광고비 분해는 합계에 들어가지 않으므로 건너뛴다.
 *   켜지 않으면 기간 비교 하나 때문에 한 요청이 조회를 두 배로 하게 된다.
 *
 *   다만 날짜별 광고비 합계는 건너뛰지 않는다. 예전에는 이것까지 건너뛰어
 *   adCostHint가 항상 null이 됐고, 직전 기간만 광고비가 안 빠진 채 이번 기간과
 *   견주어졌다. 광고비를 매주 같은 액수로 쓰는 판매자에게는 실적이 같은 주에도
 *   하락으로 나갔다. 하루 한 줄짜리 작은 표라 건너뛸 이유도 없었다.
 */
export async function computeProfit(
  userId: string,
  from: string,
  to: string,
  opts: { totalsOnly?: boolean } = {},
) {
  const lite = opts.totalsOnly === true;
  const [salesRes, costRes, itemRes, returnRes, adRes, adItemRes, growthCouponRes, orderRes, couponDefRes, couponListRes] = await Promise.all([
    selectAll((f, t) => supabase!.from('coupang_sales_daily').select('*').eq('user_id', userId)
      .gte('sale_date', from).lte('sale_date', to).order('sale_date').range(f, t)),
    selectAll((f, t) => supabase!.from('coupang_costs').select('*').eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
    // status·business_type은 재판매 판정(isResaleOption)에 쓴다. 빼먹으면
    // 판정이 조용히 전부 false가 된다. 합계만 볼 때(lite)도 이 둘은 있어야
    // 월별 리포트·전기 비교·주간 메일의 원가가 순이익 화면과 같아진다.
    selectAll((f, t) => supabase!.from('coupang_items')
      .select(lite ? 'vendor_item_id, option_name, status, business_type' : 'vendor_item_id, product_name, option_name, sale_price, stock, status, business_type')
      .eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
    // 저장된 시각은 한국 시각을 UTC로 옮긴 값이다. 경계도 한국 시각으로 잡아야
    // 새벽에 접수된 반품이 앞뒤 날짜로 밀리지 않는다.
    selectAll((f, t) => supabase!
      .from('coupang_returns')
      .select('vendor_item_id, quantity, requested_at, status')
      .eq('user_id', userId)
      .gte('requested_at', `${from}T00:00:00+09:00`)
      .lte('requested_at', `${to}T23:59:59+09:00`)
      .order('requested_at').range(f, t)),
    // 이 기간에 걸친 일자별 광고비. 쿠팡 Open API에 광고 엔드포인트가 없어
    // 보고서 파일로 받아 둔 값이다(coupang_ad_costs 참고).
    selectAll((f, t) => supabase!.from('coupang_ad_costs')
      .select('ad_date, cost, source').eq('user_id', userId)
      .gte('ad_date', from).lte('ad_date', to).order('ad_date').range(f, t)),
    // 옵션별 광고비 — 상품별 순이익에서 광고비를 빼기 위한 것
    lite ? Promise.resolve({ rows: [] as any[] }) : selectAll((f, t) => supabase!.from('coupang_ad_costs_items')
      .select('vendor_item_id, cost').eq('user_id', userId)
      .gte('ad_date', from).lte('ad_date', to).order('ad_date').range(f, t)),
    // 그로스 주문별 쿠폰 (윙은 발주서에서, 그로스는 주문별 쿠폰 조회에서 온다)
    selectAll((f, t) => supabase!.from('coupang_order_coupons')
      .select('vendor_item_id, channel, discount, quantity').eq('user_id', userId)
      .gte('sale_date', from).lte('sale_date', to).order('sale_date').range(f, t)),
    // 같은 기간 주문의 쿠폰 할인. 매출내역(인식일)과 주문(주문일)은 기준이 달라
    // 상품별로는 근사지만, 판매자가 "실제로 얼마에 팔렸나"를 보는 데는 이 값이 답이다.
    selectAll((f, t) => supabase!.from('coupang_orders_daily')
      .select('vendor_item_id, quantity, order_amount, seller_discount, coupang_discount').eq('user_id', userId)
      .gte('order_date', from).lte('order_date', to).order('order_date').range(f, t)),
    // 쿠폰 관리에 등록된 쿠폰 설정(옵션별 개당 할인). 있으면 이게 쿠폰의 기준이다.
    selectAll((f, t) => supabase!.from('coupang_coupon_items')
      .select('vendor_item_id, coupon_type, discount, max_discount, status, start_at, end_at').eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
    // 판매자가 발행한 쿠폰 목록. 화면 숫자와 대조할 근거라 계산에는 쓰지 않고 그대로 보여준다.
    lite ? Promise.resolve({ rows: [] as any[] }) : selectAll((f, t) => supabase!.from('coupang_coupons')
      .select('coupon_id, promotion_name, coupon_type, status, discount, start_at, end_at').eq('user_id', userId)
      .order('end_at', { ascending: false }).range(f, t)),
  ]);

  const couponDefs = new Map<string, CouponDef[]>();
  for (const d of couponDefRes.rows) {
    const id = String(d.vendor_item_id ?? '');
    if (!id) continue;
    const arr = couponDefs.get(id) ?? [];
    arr.push(d as CouponDef);
    couponDefs.set(id, arr);
  }

  const costs = new Map<string, any>();
  for (const c of costRes.rows) costs.set(String(c.vendor_item_id), c);

  const items = new Map<string, any>();
  for (const it of itemRes.rows) items.set(String(it.vendor_item_id), it);

  const adItemAgg = new Map<string, number>();
  for (const a of adItemRes.rows) {
    const id = String(a.vendor_item_id ?? '');
    adItemAgg.set(id, (adItemAgg.get(id) ?? 0) + (Number(a.cost) || 0));
  }

  // 쿠폰은 주문 기준이라 판매수량(매출인식 기준)과 건수가 다르다. 주문에서는
  // 채널별 단가(할인 ÷ 주문수량)만 뽑고, 아래에서 각 행의 판매수량에 곱한다.
  const wingAgg = new Map<string, { sd: number; qty: number }>();
  const coupon = { orderAmount: 0, sellerDiscount: 0, coupangDiscount: 0, orderQuantity: 0 };
  for (const o of orderRes.rows) {
    const id = String(o.vendor_item_id ?? '');
    const seller = Number(o.seller_discount) || 0;
    const cur = wingAgg.get(id) ?? { sd: 0, qty: 0 };
    cur.sd += seller;
    cur.qty += Number(o.quantity) || 0;
    wingAgg.set(id, cur);
    coupon.orderAmount += Number(o.order_amount) || 0;
    coupon.coupangDiscount += Number(o.coupang_discount) || 0;
    coupon.orderQuantity += Number(o.quantity) || 0;
  }
  // 주문별 쿠폰 조회 결과. 윙은 이게 있으면 발주서 할인 항목 대신 쓴다 —
  // 쿠팡이 "이 주문에 적용된 쿠폰"이라고 직접 알려준 값이라 더 믿을 만하다.
  // 개당 쿠폰 = 할인 ÷ 수량. 이때 할인과 수량은 반드시 '같은 행'에서 나와야 한다.
  // 수량을 저장하기 전에 받아 둔 행이 섞여 있으면, 분자는 전체 행에서 오고 분모는
  // 수량이 있는 행에서만 와서 개당 쿠폰이 부풀려진다. 실제로 그로스에서 160행 중
  // 80행에만 수량이 있어, 3만6천원짜리 옵션의 쿠폰이 6만3천원으로 잡혔다.
  // 수량이 없는 행은 짝이 없으므로 양쪽 모두에서 뺀다.
  const growthCouponAgg = new Map<string, number>();
  const growthCouponQty = new Map<string, number>();
  const wingApiAgg = new Map<string, number>();
  const wingApiQty = new Map<string, number>();
  const wingApiOrders = new Set<string>();
  for (const g of growthCouponRes.rows) {
    const id = String(g.vendor_item_id ?? '');
    const d = Number(g.discount) || 0;
    if (g.quantity === null || g.quantity === undefined) continue;
    const q = Number(g.quantity) || 0;
    if (q <= 0) continue;
    if (g.channel === 'marketplace') {
      wingApiAgg.set(id, (wingApiAgg.get(id) ?? 0) + d);
      wingApiQty.set(id, (wingApiQty.get(id) ?? 0) + q);
      wingApiOrders.add(id);
    } else {
      growthCouponAgg.set(id, (growthCouponAgg.get(id) ?? 0) + d);
      growthCouponQty.set(id, (growthCouponQty.get(id) ?? 0) + q);
    }
  }
  // 그로스 주문수량 — 쿠폰과 같은 결제일 기준이라 매출 행의 그로스 수량이 곧 주문수량이다
  const growthQtyAgg = new Map<string, number>();
  const rowQty = new Map<string, { market: number; growth: number }>();
  for (const sale of salesRes.rows) {
    const id = String(sale.vendor_item_id);
    const q = Number(sale.quantity) || 0;
    const rq = rowQty.get(id) ?? { market: 0, growth: 0 };
    if (sale.channel === 'growth') {
      rq.growth += q;
      growthQtyAgg.set(id, (growthQtyAgg.get(id) ?? 0) + q);
    } else {
      rq.market += q;
    }
    rowQty.set(id, rq);
  }

  // 건수와 수량을 나눠 센다. 반품 배송비는 상자 하나에 한 번 나가므로 건수로
  // 곱해야 한다. 수량으로 곱하면 3개짜리 반품 한 건에 배송비를 세 번 물린다.
  // 반품 탭(handleReturns)이 이미 건수로 계산하므로, 수량으로 두면 같은 기간
  // 같은 상품이 두 화면에서 다른 손실로 보인다.
  const returnAgg = new Map<string, { count: number; quantity: number }>();
  for (const r of returnRes.rows) {
    if (!isActiveReturn(r.status)) continue;
    const id = String(r.vendor_item_id ?? '');
    if (!id) continue;
    const cur = returnAgg.get(id) ?? { count: 0, quantity: 0 };
    cur.count += 1;
    cur.quantity += Number(r.quantity) || 1;
    returnAgg.set(id, cur);
  }

  const agg = new Map<string, ProfitRow>();
  for (const s of salesRes.rows) {
    const id = String(s.vendor_item_id);
    const item = items.get(id);
    const cur =
      agg.get(id) ??
      ({
        vendorItemId: id,
        productName: s.product_name || item?.product_name || '(상품명 미확인)',
        optionName: item?.option_name ?? '',
        quantity: 0,
        salesAmount: 0,
        commission: 0,
        settlementAmount: 0,
        couponDiscount: 0,
        couponSource: null,
        adCost: 0,
        channel: 'marketplace',
        returnAmount: 0,
        unitCostTotal: 0,
        returnCount: 0,
        returnQuantity: 0,
        returnCost: 0,
        profit: 0,
        marginRate: 0,
        costEntered: false,
        stock: item?.stock ?? null,
        salePrice: item?.sale_price ?? null,
        resale: isResaleOption(item),
      } as ProfitRow);
    cur.quantity += Number(s.quantity) || 0;
    cur.salesAmount += Number(s.sales_amount) || 0;
    cur.commission += Number(s.commission) || 0;
    cur.settlementAmount += Number(s.settlement_amount) || 0;
    agg.set(id, cur);
  }

  // 판매는 없었지만 반품만 발생한 옵션도 손실로 잡아야 한다
  for (const [id, ret] of returnAgg) {
    if (agg.has(id)) continue;
    const item = items.get(id);
    agg.set(id, {
      vendorItemId: id,
      productName: item?.product_name ?? '(상품명 미확인)',
      optionName: item?.option_name ?? '',
      quantity: 0, salesAmount: 0, commission: 0, settlementAmount: 0, couponDiscount: 0, couponSource: null, adCost: 0, channel: 'marketplace', returnAmount: 0,
      unitCostTotal: 0, returnCount: ret.count, returnQuantity: ret.quantity, returnCost: 0, profit: 0, marginRate: 0,
      costEntered: false, stock: item?.stock ?? null, salePrice: item?.sale_price ?? null,
      resale: isResaleOption(item),
    });
  }

  const rows: ProfitRow[] = [];
  for (const row of agg.values()) {
    const c = costs.get(row.vendorItemId);
    // 재판매 옵션은 원가를 0으로 본다. 반품된 물건을 쿠팡이 새 옵션ID로 다시
    // 파는 것이라 매입비는 첫 판매 때 이미 나갔다. 원가 화면에 값이 들어 있어도
    // 여기서 또 빼면 같은 돈이 두 번 빠진다. 원가 미입력으로도 세지 않는다.
    const perUnit = row.resale ? 0 : c ? (Number(c.unit_cost) || 0) + (Number(c.packaging_cost) || 0) + (Number(c.shipping_cost) || 0) + (Number(c.fulfillment_cost) || 0) : 0;
    row.costEntered = row.resale ? true : Boolean(c) && perUnit > 0;
    row.unitCostTotal = perUnit * row.quantity;
    const ret = returnAgg.get(row.vendorItemId) ?? { count: 0, quantity: 0 };
    row.returnCount = ret.count;
    row.returnQuantity = ret.quantity;
    // 배송비는 건수로 곱한다. 3개짜리 반품 한 건에 배송비가 세 번 나가지 않는다.
    row.returnCost = row.returnCount * (c ? Number(c.return_shipping_cost) || 0 : 0);
    const rq = rowQty.get(row.vendorItemId) ?? { market: 0, growth: 0 };
    const wing = wingAgg.get(row.vendorItemId);
    // 개당 쿠폰의 출처는 셋이고 앞의 것이 있으면 그것을 쓴다.
    //  1) 쿠폰 관리의 설정값 — 판매자가 아는 바로 그 숫자 (1건당 11,500원)
    //  2) 주문별 쿠폰 조회 — 쿠팡이 "이 주문에 적용된 쿠폰"이라고 알려준 값 ÷ 그 주문들의 수량
    //  3) 발주서 할인 항목 ÷ 주문수량
    const unitPrice = row.quantity > 0 ? row.salesAmount / row.quantity : row.salePrice ?? 0;
    const defUnit = definitionUnit(couponDefs.get(row.vendorItemId) ?? [], unitPrice, from, to);
    // 반품액 계산(아래)에 쓰는 개당 쿠폰. 설정값이면 그 값, 아니면 주문에서 본
    // 개당 값을 100원 단위로 반올림한 것이다.
    let wingUnit = 0;
    let growthUnit = 0;
    if (defUnit > 0) {
      wingUnit = Math.min(defUnit, unitPrice > 0 ? unitPrice : defUnit);
      growthUnit = wingUnit;
      row.couponSource = 'setting';
      row.couponBasis = 'setting';
      row.couponDiscount = couponForRow(rq.market, rq.growth, wingUnit, growthUnit, row.salesAmount);
    } else {
      // 주문에서 확인한 할인 합계와 그 주문수량. 윙은 주문별 쿠폰 조회가 있으면
      // 그것을, 없으면 발주서 할인 항목을 쓴다. 그로스는 주문별 쿠폰 조회뿐이다.
      let wingDisc = 0;
      let wingQty = 0;
      if (wingApiOrders.has(row.vendorItemId)) {
        wingDisc = wingApiAgg.get(row.vendorItemId) ?? 0;
        wingQty = wingApiQty.get(row.vendorItemId) ?? 0;
      } else if (wing && wing.qty > 0) {
        wingDisc = wing.sd;
        wingQty = wing.qty;
      }
      const growthDisc = growthCouponAgg.get(row.vendorItemId) ?? 0;
      const growthQty = growthCouponQty.get(row.vendorItemId) ?? 0;

      // 개당 평균을 판매수량에 곱하지 않는다. 확인한 합계를 그대로 쓰고 어긋나는
      // 수량만 보정한다 — 평균을 곱하면 2원 단위 숫자가 나온다. couponFromCoverage 참고.
      const w = couponFromCoverage(wingDisc, wingQty, rq.market);
      const g = couponFromCoverage(growthDisc, growthQty, rq.growth);
      // 쿠폰은 판매가 이하로만 설정된다. 채널 몫이 그 채널 판매가 합을 넘으면
      // 계산이 틀린 것이므로 거기서 자른다. 행 합계만 매출로 자르면 "쿠폰 = 매출"
      // 이라 실매출이 0으로 보이는 행이 생기는데, 그건 값이 아니라 증상이다.
      const wAmt = unitPrice > 0 ? Math.min(w.amount, Math.round(unitPrice * rq.market)) : w.amount;
      const gAmt = unitPrice > 0 ? Math.min(g.amount, Math.round(unitPrice * rq.growth)) : g.amount;
      row.couponDiscount = Math.max(0, Math.min(wAmt + gAmt, Math.max(0, row.salesAmount)));

      wingUnit = wingQty > 0 ? Math.round(wingDisc / wingQty / 100) * 100 : 0;
      growthUnit = growthQty > 0 ? Math.round(growthDisc / growthQty / 100) * 100 : 0;
      const hasOrder = wingApiOrders.has(row.vendorItemId) || growthCouponAgg.has(row.vendorItemId);
      row.couponSource = hasOrder ? 'order' : wingQty > 0 ? 'sheet' : null;
      // 어느 채널이든 보정이 들어갔으면 이 행은 추정이다. 둘 다 합계 그대로면 정확.
      const covered = wingQty > 0 || growthQty > 0;
      row.couponBasis = !covered ? null
        : (rq.market > 0 && !w.exact) || (rq.growth > 0 && !g.exact) ? 'adjusted' : 'exact';
    }
    row.channel = rq.growth > 0 && rq.market > 0 ? 'both' : rq.growth > 0 ? 'growth' : 'marketplace';

    // 반품액 = 실판매가 × 반품수량. 이 기간 판매가 없으면 등록 판매가에서 쿠폰 단가를 뺀다.
    const unitNet = row.quantity > 0
      ? (row.salesAmount - row.couponDiscount) / row.quantity
      : Math.max(0, (row.salePrice ?? 0) - Math.max(wingUnit, growthUnit));
    row.returnAmount = Math.round(row.returnQuantity * unitNet);
    row.adCost = adItemAgg.get(row.vendorItemId) ?? 0;
    // 순이익 = 매출 − 쿠폰 − 수수료 − 원가·배송 − 반품 − 광고비.
    // 정산예정액이 이미 쿠폰과 수수료를 뺀 값이라 거기서 나머지를 뺀다.
    // (윙은 쿠팡이 준 값, 그로스는 동기화가 같은 기준으로 만들어 둔 값이다) 광고비는 옵션에 붙은 몫만 — 옵션 없이 캠페인
    // 단위로만 잡힌 광고비는 합계 카드에서만 빠지고, 그 차이를 화면에 밝힌다.
    row.profit = row.settlementAmount - row.unitCostTotal - row.returnCost - row.adCost;
    row.marginRate = row.salesAmount > 0 ? (row.profit / row.salesAmount) * 100 : 0;
    rows.push(row);
  }

  rows.sort((a, b) => b.profit - a.profit);

  const totals = rows.reduce(
    (t, r) => {
      t.quantity += r.quantity;
      t.salesAmount += r.salesAmount;
      t.commission += r.commission;
      t.settlementAmount += r.settlementAmount;
      t.unitCostTotal += r.unitCostTotal;
      t.returnCount += r.returnCount;
      t.returnQuantity += r.returnQuantity;
      t.returnCost += r.returnCost;
      t.profit += r.profit;
      t.couponDiscount += r.couponDiscount;
      t.adCost += r.adCost;
      t.returnAmount += r.returnAmount;
      return t;
    },
    { quantity: 0, salesAmount: 0, commission: 0, settlementAmount: 0, unitCostTotal: 0, returnCount: 0, returnQuantity: 0, returnCost: 0, profit: 0, couponDiscount: 0, adCost: 0, returnAmount: 0 },
  );

  // 카드의 쿠폰 합계도 행과 같은 기준(단가 × 판매수량)이어야 실매출이 매출과 같은 기준이 된다
  coupon.sellerDiscount = totals.couponDiscount;
  // 쿠폰의 출처를 화면에 밝힌다. 설정값으로 계산된 옵션이 몇 개인지 알아야
  // "왜 이 상품만 다르게 나오나"에 답할 수 있다.
  const couponSources = {
    setting: rows.filter(r => r.couponSource === 'setting').length,
    order: rows.filter(r => r.couponSource === 'order').length,
    sheet: rows.filter(r => r.couponSource === 'sheet').length,
    definedOptions: couponDefs.size,
    // 화면은 이 둘로 "정확 N · 추정 M"을 적는다. 추정이 섞여 있으면 그렇다고
    // 밝혀야 끝자리가 안 맞을 때 계산 오류로 읽히지 않는다.
    exact: rows.filter(r => r.couponBasis === 'exact').length,
    adjusted: rows.filter(r => r.couponBasis === 'adjusted').length,
  };

  const missingCost = rows.filter(r => r.quantity > 0 && !r.costEntered).length;

  // 윙(마켓플레이스)과 로켓그로스는 회계 기준이 다르다. 합계 하나로 뭉치면
  // 확정 정산과 주문 기준 추정이 소리 없이 섞이므로 따로 낸다.
  const byChannel = { marketplace: { quantity: 0, salesAmount: 0 }, growth: { quantity: 0, salesAmount: 0 } };
  // 그로스에서 뺀 취소. 화면이 "총 N개 중 취소 M개(추정 a·파일 b)"라고 밝힌다.
  const growthCancel = { quantity: 0, amount: 0, estimateQty: 0, fileQty: 0, fileDays: new Set<string>() };
  for (const sale of salesRes.rows) {
    const bucket = sale.channel === 'growth' ? byChannel.growth : byChannel.marketplace;
    bucket.quantity += Number(sale.quantity) || 0;
    bucket.salesAmount += Number(sale.sales_amount) || 0;
    if (sale.channel === 'growth' && sale.cancel_quantity) {
      const cq = Number(sale.cancel_quantity) || 0;
      growthCancel.quantity += cq;
      growthCancel.amount += Number(sale.cancel_amount) || 0;
      if (sale.cancel_source === 'file') {
        growthCancel.fileQty += cq;
        growthCancel.fileDays.add(String(sale.sale_date).slice(0, 10));
      } else growthCancel.estimateQty += cq;
    }
  }

  // ── 일별 추이 ──
  // 합계 하나로는 "지금 오르는 중인지 꺾이는 중인지"를 알 수 없다. 같은 300만원도
  // 우상향이면 재고를 늘려야 하고 우하향이면 원인을 찾아야 한다.
  // 원가는 옵션별 단가를 그날 판매수량에 곱해 그날로 귀속시킨다.
  const dailyMap = new Map<string, { date: string; quantity: number; salesAmount: number; commission: number; profit: number }>();
  const buildDaily = !lite;
  const dayOf = (d: string) => {
    let cur = dailyMap.get(d);
    if (!cur) { cur = { date: d, quantity: 0, salesAmount: 0, commission: 0, profit: 0 }; dailyMap.set(d, cur); }
    return cur;
  };
  for (const sale of buildDaily ? salesRes.rows : []) {
    const d = String(sale.sale_date ?? '').slice(0, 10);
    if (!d) continue;
    const c = costs.get(String(sale.vendor_item_id));
    // 위 옵션별 계산과 같은 규칙 — 재판매는 원가 0
    const perUnit = isResaleOption(items.get(String(sale.vendor_item_id))) ? 0
      : c ? (Number(c.unit_cost) || 0) + (Number(c.packaging_cost) || 0) + (Number(c.shipping_cost) || 0) + (Number(c.fulfillment_cost) || 0) : 0;
    const qty = Number(sale.quantity) || 0;
    const cur = dayOf(d);
    cur.quantity += qty;
    cur.salesAmount += Number(sale.sales_amount) || 0;
    cur.commission += Number(sale.commission) || 0;
    cur.profit += (Number(sale.settlement_amount) || 0) - perUnit * qty;
  }
  // 반품 배송비는 접수일에 귀속시킨다. 판매일에 붙이면 손실이 난 날이 어긋난다.
  // requested_at은 정상 UTC 시각이므로 한국 날짜로 옮겨야 한다. 그냥 앞 10글자를
  // 자르면 새벽 2시 반품이 전날로 밀린다.
  for (const r of buildDaily ? returnRes.rows : []) {
    if (!isActiveReturn(r.status)) continue;
    const t = Date.parse(String(r.requested_at ?? ''));
    if (!Number.isFinite(t)) continue;
    const d = new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
    if (d < from || d > to) continue;
    const c = costs.get(String(r.vendor_item_id ?? ''));
    if (!c) continue;
    dayOf(d).profit -= (Number(r.quantity) || 1) * (Number(c.return_shipping_cost) || 0);
  }
  // 판매가 없던 날도 0으로 채운다. 빠뜨리면 선이 이어져 없던 날이 사라진다.
  const daily: Array<{ date: string; quantity: number; salesAmount: number; commission: number; profit: number }> = [];
  if (buildDaily) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      daily.push(dailyMap.get(d) ?? { date: d, quantity: 0, salesAmount: 0, commission: 0, profit: 0 });
      if (daily.length > 400) break;
    }
  }

  // 광고비는 기간에 겹치는 날짜만 더한다. 예전에는 '가장 최근 보고서의 총액'을
  // 기간과 무관하게 그대로 썼는데, 하루치 보고서를 올려두고 30일을 보면
  // 광고비가 하루치만 빠져 순이익이 부풀려 보였다.
  let adCostTotal = 0;
  let adCostDays = 0;
  let adCostSpread = 0;
  for (const a of adRes.rows) {
    adCostTotal += Number(a.cost) || 0;
    adCostDays += 1;
    if (a.source === 'spread') adCostSpread += 1;
  }
  const spanDays = daysBetween(from, to) + 1;

  return {
    from,
    to,
    rows,
    totals: {
      ...totals,
      marginRate: totals.salesAmount > 0 ? (totals.profit / totals.salesAmount) * 100 : 0,
    },
    missingCost,
    daily,
    // 판매가 기준 주문금액과 판매자 부담 쿠폰. 실매출 = orderAmount − sellerDiscount.
    coupon: { ...coupon, sources: couponSources },
    // 발행한 쿠폰 그대로. 기간이 지난 쿠폰도 준다 — 지난 기간을 볼 때 그때 걸려
    // 있던 쿠폰이 무엇인지가 곧 그 시기 쿠폰 금액의 근거다.
    couponList: couponListRes.rows.map((c: any) => ({
      couponId: String(c.coupon_id),
      name: c.promotion_name ?? '(이름 없음)',
      type: c.coupon_type ?? '',
      status: c.status ?? '',
      discount: Number(c.discount) || 0,
      startAt: c.start_at ? String(c.start_at).slice(0, 10) : null,
      endAt: c.end_at ? String(c.end_at).slice(0, 10) : null,
    })),
    channels: {
      marketplace: {
        quantity: byChannel.marketplace.quantity,
        salesAmount: Math.round(byChannel.marketplace.salesAmount),
      },
      growth: {
        quantity: byChannel.growth.quantity,
        salesAmount: Math.round(byChannel.growth.salesAmount),
        cancel: {
          quantity: growthCancel.quantity,
          amount: Math.round(growthCancel.amount),
          estimateQty: growthCancel.estimateQty,
          fileQty: growthCancel.fileQty,
          fileDays: growthCancel.fileDays.size,
        },
      },
    },
    // 원가를 하나도 안 넣었으면 순이익이 매출과 같아 보여 오해를 부른다. 화면에서 경고한다.
    costCoverage: rows.length > 0 ? ((rows.length - missingCost) / rows.length) * 100 : 0,
    // 데이터가 하루도 없으면 0이 아니라 null이다. 0을 주면 화면이
    // '광고비 0원'으로 확정해 버려, 안 올린 것과 정말 안 쓴 것이 구분되지 않는다.
    adCostHint: adCostDays > 0 ? Math.round(adCostTotal) : null,
    adCost: {
      total: Math.round(adCostTotal),
      // 이 기간 며칠치가 채워졌는지. 30일 중 7일만 있으면 화면이 그렇게 알린다.
      coveredDays: adCostDays,
      spanDays,
      // 기간 총액을 일수로 나눠 넣은 날. 정확한 값이 아니라고 표시해야 한다.
      estimatedDays: adCostSpread,
    },
  };
}

/**
 * 월별 순이익 리포트.
 *
 * 순이익 화면은 기간을 골라 보는 곳이라 '지난달보다 나아졌나'에 답하지 못한다.
 * 정산서 대조도 월 단위라 같은 눈금을 쓰면 두 화면이 맞물린다.
 *
 * 계산은 computeProfit을 달마다 부르는 방식이다. 월별로 다시 짜면 순이익
 * 공식이 두 벌이 되고, 언젠가 한쪽만 고쳐져 같은 사람의 두 화면이 다른
 * 순이익을 보여 준다. 이미 한 번 겪은 일이다.
 */
async function handleProfitMonthly(userId: string, req: VercelRequest, res: VercelResponse) {
  const want = Math.min(12, Math.max(2, Number(req.query.months) || 6));
  const today = kstToday();
  // 이번 달도 넣는다. 아직 안 끝난 달이라는 것은 화면에서 밝힌다 —
  // 빼 두면 '이번 달은 왜 없나'를 매번 묻게 된다.
  const thisMonth = today.slice(0, 7);
  const months = monthsBetween(addDays(`${thisMonth}-01`, -31 * (want - 1)), `${thisMonth}-01`).slice(-want);

  const results = await Promise.all(
    months.map(async (month): Promise<MonthProfit> => {
      const from = `${month}-01`;
      // 이번 달은 오늘까지만. 월말까지 잡으면 아직 오지 않은 날이 섞인다.
      const to = month === thisMonth ? today : monthEnd(month);
      const p = await computeProfit(userId, from, to, { totalsOnly: true });
      const t = p.totals;
      // totalsOnly는 옵션별 광고비를 뽑지 않아 totals.adCost가 0이다.
      // 일자별 합계(adCostHint)가 이 달의 광고비 전부다.
      const adCost = p.adCostHint ?? 0;
      return {
        month,
        quantity: t.quantity,
        salesAmount: Math.round(t.salesAmount),
        couponDiscount: Math.round(t.couponDiscount),
        commission: Math.round(t.commission),
        unitCost: Math.round(t.unitCostTotal),
        returnCost: Math.round(t.returnCost),
        returnAmount: Math.round(t.returnAmount),
        adCost: Math.round(adCost),
        // 상품에 붙은 광고비는 이미 빠져 있다. 옵션에 못 붙은 몫만 더 뺀다.
        profit: Math.round(t.profit - Math.max(0, adCost - (t.adCost ?? 0))),
      };
    }),
  );

  return res.status(200).json({
    rows: rollupMonths(results),
    thisMonth,
    today,
  });
}

async function handleProfit(userId: string, req: VercelRequest, res: VercelResponse) {
  const { from, to } = rangeFromQuery(req);

  // 같은 길이의 직전 기간을 함께 계산해 "지난 기간 대비"를 보여준다.
  // 숫자 하나만 보면 3,240,000원이 좋은 건지 나쁜 건지 알 수 없다.
  const span = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(span - 1));

  const [cur, prev] = await Promise.all([
    computeProfit(userId, from, to),
    computeProfit(userId, prevFrom, prevTo, { totalsOnly: true }),
  ]);

  // 두 기간을 같은 잣대로 세운다. 이번 기간의 totals.profit에는 옵션에 붙은
  // 광고비만 빠져 있고, 직전 기간은 옵션별을 안 뽑아 하나도 안 빠져 있다.
  // 그대로 견주면 광고를 쓸수록 "지난 기간보다 나빠졌다"가 된다.
  // 양쪽 모두 광고비를 끝까지 뺀 값으로 맞춘다.
  const prevNetProfit =
    prev.totals.profit - Math.max(0, (prev.adCostHint ?? 0) - (prev.totals.adCost ?? 0));

  return res.status(200).json({
    ...cur,
    previous: {
      from: prevFrom,
      to: prevTo,
      salesAmount: prev.totals.salesAmount,
      quantity: prev.totals.quantity,
      commission: prev.totals.commission,
      /** 광고비까지 뺀 값. 화면의 순이익 카드도 같은 기준으로 견준다 */
      profit: prevNetProfit,
      adCost: prev.adCostHint ?? 0,
      // 직전 기간에 판매가 아예 없으면 증감률이 무의미하다. 화면이 판단하도록 알린다
      hasData: prev.totals.quantity > 0,
    },
  });
}

// ── 원가 조회·입력 ────────────────────────────────────────────
async function handleCosts(userId: string, res: VercelResponse) {
  const [itemRes, costRes, soldRes, unitRes, couponRes, couponDefRes] = await Promise.all([
    selectAll((f, t) => supabase!.from('coupang_items').select('*').eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
    selectAll((f, t) => supabase!.from('coupang_costs').select('*').eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
    // 최근 30일 판매수량 — 원가를 어디부터 채워야 효과가 큰지 보여준다
    selectAll((f, t) => supabase!
      .from('coupang_sales_daily')
      .select('vendor_item_id, quantity')
      .eq('user_id', userId)
      .gte('sale_date', addDays(kstToday(), -30))
      .order('sale_date').range(f, t)),
    // 최근 90일 매출의 개당 금액 — 상세가 판매가를 0으로 주는 로켓그로스 옵션의 판매가
    selectAll((f, t) => supabase!
      .from('coupang_sales_daily')
      .select('vendor_item_id, quantity, sales_amount, sale_date')
      .eq('user_id', userId)
      .gte('sale_date', addDays(kstToday(), -90))
      .gt('quantity', 0)
      .order('sale_date', { ascending: false }).range(f, t)),
    // 최근 30일 주문에 실제로 붙은 쿠폰 — 판매가에서 이걸 빼야 손님이 내는 값이다
    selectAll((f, t) => supabase!
      .from('coupang_order_coupons')
      .select('vendor_item_id, sale_date, discount, quantity')
      .eq('user_id', userId)
      .gte('sale_date', addDays(kstToday(), -30))
      .gt('quantity', 0)
      .order('sale_date', { ascending: false }).range(f, t)),
    // 지금 적용 중인 쿠폰의 금액들. 옵션에 어느 쿠폰이 붙었는지는 쿠팡이 안
    // 알려주므로(쿠폰-옵션 목록 API가 빈 배열), 주문에서 본 금액이 이 중 하나와
    // 같으면 그 쿠폰이 아직 그 옵션에 붙어 있다고 본다.
    selectAll((f, t) => supabase!
      .from('coupang_coupons')
      .select('discount, end_at')
      .eq('user_id', userId)
      .eq('status', 'APPLIED')
      .gt('discount', 0)
      .order('coupon_id').range(f, t)),
  ]);

  const costs = new Map<string, any>();
  for (const c of costRes.rows) costs.set(String(c.vendor_item_id), c);

  // 옵션별 최근 판매일의 개당 금액 (가장 최근 날짜 하나만 본다)
  const unitPrice = new Map<string, number>();
  for (const s of unitRes.rows as any[]) {
    const id = String(s.vendor_item_id);
    if (unitPrice.has(id)) continue;
    const q = Number(s.quantity) || 0;
    const amt = Number(s.sales_amount) || 0;
    if (q > 0 && amt > 0) unitPrice.set(id, Math.round(amt / q));
  }
  const nowIso = new Date().toISOString();
  const activeAmounts = new Set<number>();
  for (const d of couponDefRes.rows as any[]) {
    if (d.end_at && String(d.end_at) < nowIso) continue;
    activeAmounts.add(Math.round(Number(d.discount) || 0));
  }

  // 옵션별 개당 쿠폰. 쿠폰은 며칠마다 바뀌므로 평균이 아니라 최근 것을 쓴다.
  //   1) 마지막 주문일에 쿠폰이 붙었으면 그 값
  //   2) 마지막 주문에 쿠폰이 없었어도(손님이 안 썼거나 조회가 비었거나), 30일 안
  //      주문에서 본 개당 금액이 지금 적용 중인 쿠폰 금액과 같으면 그 값 — 쿠폰은
  //      그대로 붙어 있는데 그 주문만 비었던 것이다. 실제로 6,100원 쿠폰이 붙은
  //      옵션의 마지막 주문 하나가 0으로 와서 쿠폰가가 사라진 일이 있었다.
  const byDate = new Map<string, Map<string, { discount: number; qty: number }>>();
  for (const c of couponRes.rows as any[]) {
    const id = String(c.vendor_item_id);
    const date = String(c.sale_date);
    const days = byDate.get(id) ?? new Map<string, { discount: number; qty: number }>();
    const cur = days.get(date) ?? { discount: 0, qty: 0 };
    cur.discount += Number(c.discount) || 0;
    cur.qty += Number(c.quantity) || 0;
    days.set(date, cur);
    byDate.set(id, days);
  }
  const couponUnit = new Map<string, number>();
  for (const [id, days] of byDate) {
    // 조회가 최근 날짜순이라 Map 삽입 순서가 곧 최근순이다
    let first = true;
    for (const d of days.values()) {
      const unit = d.qty > 0 ? Math.round(d.discount / d.qty) : 0;
      if (unit > 0 && (first || activeAmounts.has(unit))) {
        couponUnit.set(id, unit);
        break;
      }
      first = false;
    }
  }

  const sold = new Map<string, number>();
  for (const s of soldRes.rows) {
    const id = String(s.vendor_item_id);
    sold.set(id, (sold.get(id) ?? 0) + (Number(s.quantity) || 0));
  }

  // 등록상품 목록이 비어 있어도(상품 수집이 막혔거나 아직 안 돌았거나) 매출·주문에
  // 이미 나온 옵션은 원가를 넣을 수 있어야 한다. 수강생이 상품 수집이 풀릴 때까지
  // 기다릴 이유가 없다. 이름·채널은 매출 행에서, 판매가는 모른다.
  const seenItem = new Set(itemRes.rows.map((it: any) => String(it.vendor_item_id)));
  const fallbackRows: any[] = [];
  {
    const { rows: salesItems } = await selectAll<{ vendor_item_id: string; product_name: string | null; channel: string }>((f, t) =>
      supabase!
        .from('coupang_sales_daily')
        .select('vendor_item_id, product_name, channel')
        .eq('user_id', userId)
        .gte('sale_date', addDays(kstToday(), -90))
        .order('vendor_item_id').range(f, t));
    const seenFallback = new Set<string>();
    for (const sale of salesItems) {
      const id = String(sale.vendor_item_id);
      if (seenItem.has(id) || seenFallback.has(id)) continue;
      seenFallback.add(id);
      fallbackRows.push({
        vendor_item_id: id,
        product_name: sale.product_name ?? `옵션 ${id}`,
        option_name: '',
        sale_price: unitPrice.get(id) ?? null,
        stock: null,
        status: '',
        business_type: sale.channel === 'growth' ? 'growth' : 'marketplace',
      });
    }
  }

  const rows = [...itemRes.rows, ...fallbackRows].map((it: any) => {
    const id = String(it.vendor_item_id);
    const c = costs.get(id);
    const detailPrice = Number(it.sale_price) > 0 ? Number(it.sale_price) : null;
    const salePrice = detailPrice ?? unitPrice.get(id) ?? null;
    return {
      vendorItemId: id,
      productName: it.product_name ?? '',
      optionName: it.option_name ?? '',
      salePrice,
      // 어디서 온 판매가인지. 'sales'면 상세엔 없어 최근 매출의 개당 금액을 쓴 것이다
      priceSource: detailPrice !== null ? 'detail' : salePrice !== null ? 'sales' : null,
      // 최근 주문에 붙은 개당 쿠폰. 판매가 − 이 값이 손님이 내는 값이다
      couponUnit: couponUnit.get(id) ?? null,
      stock: it.stock ?? null,
      status: it.status ?? '',
      // 로켓그로스 상품에만 입출고비 칸을 띄운다 — 판매자배송 상품에 0을
      // 넣게 만들면 안 넣은 것과 구분이 안 된다.
      businessType: String(it.business_type ?? 'marketplace'),
      // 재판매 옵션 — 순이익 계산은 이 줄의 원가를 0으로 본다 (isResaleOption 참고)
      resale: isResaleOption(it),
      soldLast30: sold.get(String(it.vendor_item_id)) ?? 0,
      unitCost: c?.unit_cost ?? 0,
      packagingCost: c?.packaging_cost ?? 0,
      shippingCost: c?.shipping_cost ?? 0,
      fulfillmentCost: c?.fulfillment_cost ?? 0,
      returnShippingCost: c?.return_shipping_cost ?? 0,
      memo: c?.memo ?? '',
    };
  });

  // 많이 팔리는데 원가가 비어 있는 것부터 위로 올린다
  rows.sort((a, b) => {
    const aMissing = a.unitCost === 0 ? 1 : 0;
    const bMissing = b.unitCost === 0 ? 1 : 0;
    if (aMissing !== bMissing) return bMissing - aMissing;
    return b.soldLast30 - a.soldLast30;
  });

  return res.status(200).json({ rows });
}

async function handleCostSave(userId: string, req: VercelRequest, res: VercelResponse) {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: '저장할 원가가 없습니다.' });
  if (items.length > 1000) return res.status(400).json({ error: '한 번에 1000건까지 저장할 수 있습니다.' });

  const clamp = (v: any) => Math.max(0, Math.min(100_000_000, Math.round(Number(v) || 0)));

  // 보내지 않은 항목은 건드리지 않는다. 엑셀로 매입원가 열만 채워 올렸을 때
  // 이미 넣어둔 부자재·배송비가 0으로 덮이면 순이익과 반품 손실이 조용히 바뀐다.
  const keyed = new Map<string, any>();
  for (const it of items) {
    if (!it?.vendorItemId) continue;
    const id = String(it.vendorItemId);
    const row: any = { user_id: userId, vendor_item_id: id, updated_at: new Date().toISOString() };
    if (it.unitCost !== undefined) row.unit_cost = clamp(it.unitCost);
    if (it.packagingCost !== undefined) row.packaging_cost = clamp(it.packagingCost);
    if (it.shippingCost !== undefined) row.shipping_cost = clamp(it.shippingCost);
    if (it.fulfillmentCost !== undefined) row.fulfillment_cost = clamp(it.fulfillmentCost);
    if (it.returnShippingCost !== undefined) row.return_shipping_cost = clamp(it.returnShippingCost);
    if (typeof it.memo === 'string') row.memo = it.memo.slice(0, 200);
    keyed.set(id, row);
  }
  const rows = [...keyed.values()];
  if (rows.length === 0) return res.status(400).json({ error: '저장할 원가가 없습니다.' });

  // upsert는 빠진 칼럼을 기본값으로 채우므로, 이미 있는 행은 update로 부분만 바꾼다
  const { rows: existing } = await selectAll<{ vendor_item_id: string }>((f, t) =>
    supabase!.from('coupang_costs').select('vendor_item_id').eq('user_id', userId)
      .order('vendor_item_id').range(f, t));
  const known = new Set(existing.map(e => String(e.vendor_item_id)));

  const err = await upsertChunked('coupang_costs', rows.filter(r => !known.has(r.vendor_item_id)), 'user_id,vendor_item_id');
  if (err) return res.status(500).json({ error: `저장 실패: ${err}` });

  for (const r of rows.filter(r => known.has(r.vendor_item_id))) {
    const { vendor_item_id, user_id, ...patch } = r;
    const { error } = await supabase!
      .from('coupang_costs').update(patch)
      .eq('user_id', userId).eq('vendor_item_id', vendor_item_id);
    if (error) { console.error('[쿠팡] 저장 실패', { detail: error.message }); return res.status(500).json({ error: '저장하지 못했습니다. 잠시 후 다시 시도해주세요.' }); }
  }

  return res.status(200).json({ ok: true, saved: rows.length });
}

// ── 광고비 (일자별) ───────────────────────────────────────────
// 쿠팡 Open API에는 광고 엔드포인트가 없다. 광고 데이터는 광고센터라는
// 별도 시스템에만 있고 판매자용 공개 API가 없어서, 광고 보고서 파일을
// 받아 올리는 것 말고는 방법이 없다. 대신 한 번 올린 값을 일자별로 쪼개
// 두면 이후에는 어떤 기간을 보든 광고비가 자동으로 맞는다.

const AD_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function handleAdCosts(userId: string, req: VercelRequest, res: VercelResponse) {
  const { from, to } = rangeFromQuery(req);
  const { rows } = await selectAll<{ ad_date: string; cost: number; source: string }>((f, t) =>
    supabase!.from('coupang_ad_costs').select('ad_date, cost, source')
      .eq('user_id', userId).gte('ad_date', from).lte('ad_date', to)
      .order('ad_date').range(f, t));

  return res.status(200).json({
    from, to,
    days: rows.map(r => ({ date: r.ad_date, cost: Math.round(Number(r.cost) || 0), source: r.source })),
    total: Math.round(rows.reduce((a, r) => a + (Number(r.cost) || 0), 0)),
    spanDays: daysBetween(from, to) + 1,
  });
}

/**
 * 광고비 저장.
 *   daily가 있으면  — 보고서에 일자 컬럼이 있었던 경우. 그날 값을 그대로 쓴다.
 *   total만 있으면  — 기간 총액만 아는 경우. 일수로 나눠 넣고 source='spread'로
 *                     표시해, 화면이 "추정치"라고 밝힐 수 있게 한다.
 *
 * 같은 기간을 다시 올리면 그 구간을 통째로 지우고 새로 넣는다. 덧쓰기만 하면
 * 지난번에 있던 날짜가 남아 광고비가 이중으로 잡힌다.
 */
async function handleAdCostSave(userId: string, req: VercelRequest, res: VercelResponse) {
  const body = req.body ?? {};
  const out = await persistAdCosts(userId, body);
  return res.status(out.status).json(out.body);
}

/** 광고비 저장 본체. 화면 업로드·북마클릿·서버 대리 수신이 모두 이 길로 온다. */
async function persistAdCosts(
  userId: string,
  body: any,
): Promise<{ status: number; body: any }> {
  const from = String(body.from ?? '');
  const to = String(body.to ?? '');
  const res = {
    status: (code: number) => ({ json: (b: any) => ({ status: code, body: b }) }),
  };
  if (!AD_DATE_RE.test(from) || !AD_DATE_RE.test(to)) {
    return res.status(400).json({ error: '기간을 YYYY-MM-DD 형식으로 보내주세요.' });
  }
  const span = daysBetween(from, to) + 1;
  if (span < 1) return res.status(400).json({ error: '시작일이 종료일보다 뒤입니다.' });
  if (span > 400) return res.status(400).json({ error: '한 번에 400일까지 저장할 수 있습니다.' });

  const clamp = (v: any) => Math.max(0, Math.min(1_000_000_000, Math.round(Number(v) || 0)));
  const daily = Array.isArray(body.daily) ? body.daily : null;

  const byDate = new Map<string, number>();
  let source: 'report' | 'spread' | 'manual' = 'report';

  if (daily && daily.length > 0) {
    for (const d of daily) {
      const date = String(d?.date ?? '');
      // 기간 밖 날짜는 버린다. 보고서에 다른 달이 섞여 들어오면 지우는 구간과
      // 넣는 구간이 어긋나 남은 행이 생긴다.
      if (!AD_DATE_RE.test(date) || date < from || date > to) continue;
      byDate.set(date, (byDate.get(date) ?? 0) + clamp(d?.cost));
    }
    if (byDate.size === 0) return res.status(400).json({ error: '기간 안에 들어오는 날짜가 없습니다.' });
    source = body.source === 'manual' ? 'manual' : 'report';
  } else {
    const total = clamp(body.total);
    if (total <= 0) return res.status(400).json({ error: '광고비 총액이 없습니다.' });
    // 나머지가 버려지지 않게 마지막 날에 몰아준다. 합계는 총액과 정확히 같아야 한다.
    const per = Math.floor(total / span);
    for (let i = 0; i < span; i++) {
      byDate.set(addDays(from, i), i === span - 1 ? total - per * (span - 1) : per);
    }
    source = 'spread';
  }

  // 어떤 열이 왔고 어떤 단위였는지 남긴다. '추정'으로 떨어진 이유를 화면 캡처 없이
  // 알 수 있어야 한다. 값은 남기지 않는다.
  if (Array.isArray(body.columns) && body.columns.length > 0) {
    const note = `${new Date().toISOString().slice(0, 16)} ${source} unit=${String(body.dateGroup ?? '')} cols=${body.columns.slice(0, 40).map((c: any) => String(c)).join('|')}`;
    await supabase!.from('coupang_accounts').update({ last_ad_report_note: note.slice(0, 2000) }).eq('user_id', userId);
  }

  const batchId = crypto.randomBytes(8).toString('hex');
  const rows = [...byDate.entries()].map(([ad_date, cost]) => ({
    user_id: userId, ad_date, cost, source, batch_id: batchId,
    updated_at: new Date().toISOString(),
  }));

  // 넣고 나서 지운다. 반대로 하면 저장이 중간에 실패했을 때 이미 지운 기간의
  // 광고비가 통째로 사라지고, 사용자는 "저장 실패"만 보고 손실을 알지 못한다.
  const err = await upsertChunked('coupang_ad_costs', rows, 'user_id,ad_date');
  if (err) return res.status(500).json({ error: `저장 실패: ${err}` });

  // 이번 배치에 없는 같은 기간의 옛 행만 지운다. 남겨두면 지난번에 더 넓게
  // 올린 날짜가 살아남아 광고비가 이중으로 잡힌다.
  const { error: delErr } = await supabase!
    .from('coupang_ad_costs').delete()
    .eq('user_id', userId).gte('ad_date', from).lte('ad_date', to)
    .neq('batch_id', batchId);
  if (delErr) return res.status(500).json({ error: `정리 실패: ${delErr.message}` });

  // 옵션별 광고비. 상품별 순이익에 붙이려면 옵션 단위가 필요하다. 보고서에 옵션ID
  // 열이 있을 때만 오고, 같은 기간의 옛 옵션 행은 일자별과 같은 방식으로 정리한다.
  const items = Array.isArray(body.items) ? body.items : [];
  let attributed = 0;
  if (items.length > 0) {
    const itemRows = items
      .map((it: any) => ({
        user_id: userId,
        ad_date: String(it?.date ?? ''),
        vendor_item_id: String(it?.vendorItemId ?? '').trim(),
        cost: clamp(it?.cost),
        batch_id: batchId,
        updated_at: new Date().toISOString(),
      }))
      .filter((r: any) => AD_DATE_RE.test(r.ad_date) && r.ad_date >= from && r.ad_date <= to && /^\d+$/.test(r.vendor_item_id));
    if (itemRows.length > 0) {
      const e2 = await upsertChunked('coupang_ad_costs_items', itemRows, 'user_id,ad_date,vendor_item_id');
      if (e2) return res.status(500).json({ error: `옵션별 광고비 저장 실패: ${e2}` });
      attributed = itemRows.reduce((a: number, r: any) => a + r.cost, 0);
    }
    await supabase!
      .from('coupang_ad_costs_items').delete()
      .eq('user_id', userId).gte('ad_date', from).lte('ad_date', to)
      .neq('batch_id', batchId);
  }

  return res.status(200).json({
    ok: true, from, to, days: rows.length, source,
    total: rows.reduce((a, r) => a + r.cost, 0),
    attributed,
  });
}

/**
 * 광고센터가 준 파일 주소를 허용된 곳에서만 받는다. 사용자가 보낸 주소를 서버가
 * 그대로 열면 내부망·메타데이터 주소를 찌르는 통로가 된다.
 */
export function isAllowedReportHost(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return (
    h === 'coupang.com' || h.endsWith('.coupang.com') ||
    h.endsWith('.coupangcdn.com') ||
    h.endsWith('.amazonaws.com')
  );
}

const AD_IMPORT_MAX_BYTES = 25 * 1024 * 1024;

async function handleAdImportUrl(userId: string, req: VercelRequest, res: VercelResponse) {
  const url = String(req.body?.url ?? '');
  const from = String(req.body?.from ?? '');
  const to = String(req.body?.to ?? '');
  if (!isAllowedReportHost(url)) {
    return res.status(400).json({ error: '허용되지 않은 파일 주소입니다. (쿠팡 또는 쿠팡이 쓰는 저장소 주소만 받습니다)' });
  }
  if (!AD_DATE_RE.test(from) || !AD_DATE_RE.test(to)) {
    return res.status(400).json({ error: '기간을 YYYY-MM-DD 형식으로 보내주세요.' });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  let buf: Buffer;
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) return res.status(502).json({ error: `파일 주소에서 받지 못했습니다 (HTTP ${r.status}). 주소가 만료됐을 수 있으니 다시 눌러주세요.` });
    const len = Number(r.headers.get('content-length') || 0);
    if (len > AD_IMPORT_MAX_BYTES) return res.status(413).json({ error: '보고서 파일이 너무 큽니다 (25MB 초과).' });
    buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > AD_IMPORT_MAX_BYTES) return res.status(413).json({ error: '보고서 파일이 너무 큽니다 (25MB 초과).' });
  } catch (e: any) {
    return res.status(502).json({ error: `파일을 받는 중 실패했습니다: ${e?.name === 'AbortError' ? '시간 초과' : e?.message ?? e}` });
  } finally {
    clearTimeout(timer);
  }

  // xlsx 는 엑셀·CSV 를 모두 읽는다. cellDates 가 없으면 날짜가 45000 같은 시리얼 숫자로
  // 들어와 일자별 광고비를 못 뽑는다.
  let rows: any[];
  try {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, codepage: 949 });
    const ws = wb.Sheets[wb.SheetNames[0]];
    // 제목 줄이 헤더 위에 올 수 있어 헤더 없이 읽고 '광고비' 줄을 찾는다
    rows = rowsFromMatrix(XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][]);
  } catch (e: any) {
    return res.status(400).json({ error: `보고서를 읽지 못했습니다: ${e?.message ?? e}` });
  }
  if (rows.length === 0) return res.status(400).json({ error: '보고서가 비어 있습니다. 이 기간에 광고 집행이 없었을 수 있습니다.' });

  const daily = extractDailyAdCost(rows);
  let out;
  if (daily) {
    out = await persistAdCosts(userId, { from, to, daily: daily.days, source: 'report', items: extractItemAdCost(rows) ?? [] });
  } else {
    const cols = Object.keys(rows[0] ?? {});
    const costCol = cols.find(c => String(c).trim() === '광고비');
    if (!costCol) return res.status(400).json({ error: `보고서에 '광고비' 열이 없습니다. (열: ${cols.slice(0, 8).join(', ')})` });
    const total = rows.reduce((n, r) => n + (Number(String(r[costCol] ?? '').replace(/[^0-9.-]/g, '')) || 0), 0);
    out = await persistAdCosts(userId, { from, to, total: Math.round(total) });
  }
  return res.status(out.status).json(out.body);
}

async function handleAdCostDelete(userId: string, req: VercelRequest, res: VercelResponse) {
  const from = String(req.body?.from ?? '');
  const to = String(req.body?.to ?? '');
  if (!AD_DATE_RE.test(from) || !AD_DATE_RE.test(to)) {
    return res.status(400).json({ error: '기간을 YYYY-MM-DD 형식으로 보내주세요.' });
  }
  const { error } = await supabase!
    .from('coupang_ad_costs').delete()
    .eq('user_id', userId).gte('ad_date', from).lte('ad_date', to);
  if (error) { console.error('[쿠팡] 삭제 실패', { detail: error.message }); return res.status(500).json({ error: '삭제하지 못했습니다. 잠시 후 다시 시도해주세요.' }); }
  return res.status(200).json({ ok: true });
}

// ═══════════════════════════════════════════════════════════════
// [2] 정산 캐시플로 캘린더
//
// 소상공인이 가장 불안해하는 질문은 "언제 얼마가 들어오나"다.
// 지급내역 API가 주는 확정·예정 금액을 날짜에 붙이고, 아직 지급일이 잡히지
// 않은 매출은 '미배정'으로 따로 보여준다. 둘을 섞으면 실제 입금일이 없는
// 돈까지 캘린더에 찍혀 계획을 그르친다.
// ═══════════════════════════════════════════════════════════════

// ── 광고 보고서 원본 (광고분석AI가 그대로 읽는다) ────────────────
//
// 보고서는 키워드×일자 단위라 한 달치가 수만 줄, JSON으로 수 MB다. Vercel은
// 요청·응답 본문을 4.5MB에서 자르므로(413) 한 번에 보내면 함수에 닿지도 못하고
// 로그도 안 남는다 — 실제로 그렇게 조용히 비어 있었다. 그래서 줄은 별도 표에
// 한 줄씩 두고, 저장은 조각으로 받고 읽기는 페이지로 준다.

/** 한 번에 담을 수 있는 최대 행 수. 넘으면 잘라 두고 잘렸다고 알린다 */
const AD_RAW_MAX_ROWS = 20000;
/** 한 페이지로 돌려주는 최대 행 수 — 응답도 4.5MB 안이어야 한다 */
const AD_RAW_PAGE_MAX = 5000;

async function handleAdReportRaw(userId: string, req: VercelRequest, res: VercelResponse) {
  const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
  const limit = Math.min(AD_RAW_PAGE_MAX, Math.max(1, Math.floor(Number(req.query.limit) || 3000)));
  const { data, error } = await supabase!
    .from('coupang_ad_report_raw')
    .select('date_from, date_to, columns, row_count, truncated, saved_at, complete')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return res.status(200).json({ report: null });
  // 조각 저장이 중간에 끊긴 보고서는 없는 것으로 친다. 앞 조각만으로 키워드
  // 합계를 내면 틀린 숫자가 아무 표시 없이 나간다.
  if (data.complete !== true) return res.status(200).json({ report: null });
  const rowCount = Number(data.row_count) || 0;
  const { data: lines, error: lineErr } = await supabase!
    .from('coupang_ad_report_raw_rows')
    .select('row')
    .eq('user_id', userId)
    .order('idx')
    .range(offset, offset + limit - 1);
  if (lineErr) {
    console.error('[광고보고서] 원본 읽기 실패', { code: lineErr.code, detail: lineErr.message });
    return res.status(500).json({ error: '보고서를 읽지 못했습니다.' });
  }
  const rows = (lines ?? []).map((l: any) => l.row);
  return res.status(200).json({
    report: {
      from: data.date_from,
      to: data.date_to,
      columns: data.columns ?? [],
      rows,
      rowCount,
      offset,
      hasMore: offset + rows.length < rowCount,
      truncated: data.truncated === true,
      savedAt: data.saved_at,
    },
  });
}

/**
 * 조각 저장. part=0이 오면 이전 보고서를 지우고 새로 시작하고, 이후 조각은
 * 뒤에 이어 붙인다. 클라이언트가 순서대로 하나씩 보내므로 겹치지 않는다.
 */
async function handleAdReportRawSave(userId: string, req: VercelRequest, res: VercelResponse) {
  const body: any = req.body ?? {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const part = Math.max(0, Math.floor(Number(body.part) || 0));
  const parts = Math.max(1, Math.floor(Number(body.parts) || 1));
  if (part === 0 && rows.length === 0) return res.status(400).json({ error: '저장할 보고서 행이 없습니다.' });
  if (part >= parts) return res.status(400).json({ error: '조각 번호가 맞지 않습니다.' });

  const fail = (where: string, e: { code?: string; message?: string }) => {
    console.error('[광고보고서] 원본 저장 실패', { where, part, code: e.code, detail: e.message });
    return res.status(500).json({ error: '보고서를 저장하지 못했습니다.' });
  };

  if (part === 0) {
    const columns = Array.isArray(body.columns) && body.columns.length > 0 ? body.columns : Object.keys(rows[0] ?? {});
    const { error: delErr } = await supabase!.from('coupang_ad_report_raw_rows').delete().eq('user_id', userId);
    if (delErr) return fail('clear', delErr);
    const { error: headErr } = await supabase!.from('coupang_ad_report_raw').upsert({
      user_id: userId,
      date_from: body.from || null,
      date_to: body.to || null,
      columns,
      rows: null,
      row_count: 0,
      truncated: false,
      complete: false,
      saved_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (headErr) return fail('head', headErr);
  }

  const { data: head, error: readErr } = await supabase!
    .from('coupang_ad_report_raw').select('row_count, truncated').eq('user_id', userId).maybeSingle();
  if (readErr) return fail('read', readErr);
  if (!head) return res.status(409).json({ error: '보고서 저장을 처음부터 다시 시작해주세요.' });

  const have = Number(head.row_count) || 0;
  const room = Math.max(0, AD_RAW_MAX_ROWS - have);
  const kept = rows.slice(0, room);
  const truncated = head.truncated === true || rows.length > kept.length;

  for (let i = 0; i < kept.length; i += 1000) {
    const batch = kept.slice(i, i + 1000).map((row: unknown, j: number) => ({ user_id: userId, idx: have + i + j, row }));
    const { error: insErr } = await supabase!.from('coupang_ad_report_raw_rows').upsert(batch, { onConflict: 'user_id,idx' });
    if (insErr) return fail('rows', insErr);
  }
  const rowCount = have + kept.length;
  // 마지막 조각이 들어왔거나 상한에 걸려 더 받을 게 없으면 완성이다
  const complete = part === parts - 1 || truncated;
  const { error: updErr } = await supabase!.from('coupang_ad_report_raw')
    .update({ row_count: rowCount, truncated, complete, saved_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (updErr) return fail('count', updErr);
  return res.status(200).json({ ok: true, rowCount, truncated, complete, part });
}

// ── 마진 계산 기본값 (광고분석AI가 손입력 대신 불러온다) ──────────

/**
 * 옵션별 판매가·원가·입출고비를 모아 준다.
 *
 * 판매가는 매출액 ÷ 수량이다. 이 값은 주문금액이라 즉시할인쿠폰이 아직
 * 빠지지 않았다 — 이 판매자는 쿠폰이 주문금액의 절반이라, 쿠폰을 빼지 않으면
 * 개당 마진이 1만 6천원씩 부풀어 보인다. 쿠폰은 따로 내려보내 화면에서 뺀다.
 *
 * 수수료율은 여기서 주지 않는다. 매출내역의 수수료 값이 실제 요율과 맞지
 * 않는 경우가 확인됐고(같은 계정에서 6.9%로 계산되는데 실제는 10.8%),
 * 틀린 요율을 자동으로 넣으면 손익분기 판정이 통째로 어긋난다. 요율은
 * 화면의 기본값(부가세 포함)을 쓰고 사용자가 고친다.
 */
async function handleMarginPreset(userId: string, req: VercelRequest, res: VercelResponse) {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
  const to = kstToday();
  const from = addDays(to, -(days - 1));

  const [salesRes, costRes, couponRes, itemRes, returnRes] = await Promise.all([
    selectAll<{ vendor_item_id: string; product_name: string | null; quantity: number; sales_amount: number; channel: string }>((f, t) =>
      supabase!.from('coupang_sales_daily')
        .select('vendor_item_id, product_name, quantity, sales_amount, channel')
        .eq('user_id', userId)
        .gte('sale_date', from)
        .lte('sale_date', to)
        .order('vendor_item_id').range(f, t)),
    selectAll<any>((f, t) =>
      supabase!.from('coupang_costs').select('*').eq('user_id', userId)
        .order('vendor_item_id').range(f, t)),
    // 즉시할인쿠폰 — 주문금액에서 따로 빠진다
    selectAll<{ vendor_item_id: string; discount: number }>((f, t) =>
      supabase!.from('coupang_order_coupons')
        .select('vendor_item_id, discount')
        .eq('user_id', userId)
        .gte('sale_date', from)
        .lte('sale_date', to)
        .order('vendor_item_id').range(f, t)),
    // 옵션명 — 상품명만 보여주면 같은 상품의 여러 옵션이 전부 같은 줄로 보인다
    selectAll<{ vendor_item_id: string; option_name: string | null }>((f, t) =>
      supabase!.from('coupang_items')
        .select('vendor_item_id, option_name')
        .eq('user_id', userId)
        .order('vendor_item_id').range(f, t)),
    // 반품 — 반품률 5%짜리 상품은 100개를 팔아도 95개치 마진만 남는다.
    // 이걸 빼고 손익분기 ROAS를 잡으면 화면은 흑자인데 통장은 적자다.
    selectAll<{ vendor_item_id: string | null; quantity: number; status: string; requested_at: string }>((f, t) =>
      supabase!.from('coupang_returns')
        .select('vendor_item_id, quantity, status, requested_at')
        .eq('user_id', userId)
        .gte('requested_at', `${from}T00:00:00+09:00`)
        .order('requested_at').range(f, t)),
  ]);

  const costs = new Map<string, any>();
  for (const c of costRes.rows) costs.set(String(c.vendor_item_id), c);

  const coupons = new Map<string, number>();
  for (const c of couponRes.rows) {
    const id = String(c.vendor_item_id);
    coupons.set(id, (coupons.get(id) ?? 0) + (Number(c.discount) || 0));
  }

  const optionNames = new Map<string, string>();
  for (const i of itemRes.rows) optionNames.set(String(i.vendor_item_id), i.option_name ?? '');

  const returnQty = new Map<string, number>();
  for (const r of returnRes.rows) {
    // 취소·철회된 접수는 반품이 아니다. 세면 반품률이 부풀어 마진이 낮게 잡힌다.
    if (!isActiveReturn(r.status) || !r.vendor_item_id) continue;
    const id = String(r.vendor_item_id);
    returnQty.set(id, (returnQty.get(id) ?? 0) + (Number(r.quantity) || 0));
  }

  const agg = new Map<string, { vendorItemId: string; productName: string; quantity: number; salesAmount: number; channel: string }>();
  for (const r of salesRes.rows) {
    const id = String(r.vendor_item_id);
    const cur = agg.get(id) ?? { vendorItemId: id, productName: r.product_name ?? '', quantity: 0, salesAmount: 0, channel: r.channel ?? 'marketplace' };
    cur.quantity += Number(r.quantity) || 0;
    cur.salesAmount += Number(r.sales_amount) || 0;
    if (!cur.productName && r.product_name) cur.productName = r.product_name;
    if (r.channel === 'growth') cur.channel = 'growth';
    agg.set(id, cur);
  }

  const items = [...agg.values()]
    .filter(a => a.quantity > 0)
    .map(a => {
      const c = costs.get(a.vendorItemId);
      return {
        vendorItemId: a.vendorItemId,
        productName: a.productName,
        optionName: optionNames.get(a.vendorItemId) ?? '',
        channel: a.channel,
        quantity: a.quantity,
        // 주문금액 ÷ 수량 — 쿠폰이 아직 빠지지 않은 값이다
        unitPrice: Math.round(a.salesAmount / a.quantity),
        // 개당 즉시할인쿠폰
        couponPerUnit: Math.round((coupons.get(a.vendorItemId) ?? 0) / a.quantity),
        // 매입 + 부자재 + 출고 택배비 = 개당 최종원가
        unitCost: c ? (Number(c.unit_cost) || 0) + (Number(c.packaging_cost) || 0) + (Number(c.shipping_cost) || 0) : 0,
        fulfillmentCost: c ? Number(c.fulfillment_cost) || 0 : 0,
        // 반품률 — 같은 기간의 반품 접수 수량 ÷ 판매 수량. 100%를 넘을 수 있다
        // (지난달 판매분이 이번 달에 반품되는 경우) 90%에서 자른다.
        returnRate: Math.min(90, Math.round(((returnQty.get(a.vendorItemId) ?? 0) / a.quantity) * 1000) / 10),
        returnShippingCost: c ? Number(c.return_shipping_cost) || 0 : 0,
        hasCost: Boolean(c),
      };
    })
    .sort((x, y) => y.quantity * y.unitPrice - x.quantity * x.unitPrice);

  return res.status(200).json({ from, to, days, items });
}

/**
 * 정산서 대조 — 우리가 계산한 정산예정액과 실제 지급액을 인식월끼리 맞춘다.
 *
 * 윙은 쿠팡이 준 정산예정액이라 맞는 게 정상이고, 로켓그로스는 우리가 만든
 * 값이라 틀릴 수 있다. 여기서 매달 확인하지 않으면 순이익이 몇 달 동안 조용히
 * 부풀어 있게 된다 — 즉시할인쿠폰을 빼지 않아 실제로 그랬던 적이 있다.
 */
async function handleSettlementCheck(userId: string, req: VercelRequest, res: VercelResponse) {
  const months = Math.min(12, Math.max(1, Number(req.query.months) || 6));
  const today = kstToday();
  // 이번 달은 아직 지급이 끝나지 않아 늘 어긋나 보인다. 지난달까지만 본다.
  const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  // 31일씩 거슬러 가면 원하는 개월 수보다 한 달 더 잡힐 수 있어 뒤에서 자른다.
  const wanted = monthsBetween(addDays(`${lastMonth}-01`, -31 * months), `${lastMonth}-01`).slice(-months);
  const from = `${wanted[0]}-01`;
  const to = monthEnd(lastMonth);

  const [salesRes, setRes, checkRes, returnRes] = await Promise.all([
    selectAll<{ sale_date: string; channel: string; settlement_amount: number; commission: number }>((f, t) => supabase!
      .from('coupang_sales_daily')
      .select('sale_date, channel, settlement_amount, commission')
      .eq('user_id', userId)
      .gte('sale_date', from).lte('sale_date', to)
      .order('sale_date').range(f, t)),
    selectAll<{ recognition_month: string; settlement_date: string; settlement_type: string | null; recognition_to: string | null; amount: number; target_amount: number | null; last_amount: number | null }>((f, t) => supabase!
      .from('coupang_settlements')
      .select('recognition_month, settlement_date, settlement_type, recognition_to, amount, target_amount, last_amount')
      .eq('user_id', userId)
      .order('settlement_date').range(f, t)),
    selectAll<{ month: string; actual_amount: number; note: string | null }>((f, t) => supabase!
      .from('coupang_settlement_checks')
      .select('month, actual_amount, note')
      .eq('user_id', userId)
      .order('month').range(f, t)),
    selectAll<{ requested_at: string; quantity: number; status: string }>((f, t) => supabase!
      .from('coupang_returns')
      .select('requested_at, quantity, status')
      .eq('user_id', userId)
      .gte('requested_at', `${from}T00:00:00+09:00`)
      .order('requested_at').range(f, t)),
  ]);

  const blank = () => ({ market: 0, growth: 0, growthNet: 0 });
  const byMonth = new Map<string, ReturnType<typeof blank>>();
  for (const s of salesRes.rows) {
    const m = String(s.sale_date).slice(0, 7);
    const cur = byMonth.get(m) ?? blank();
    const settlement = Number(s.settlement_amount) || 0;
    if (s.channel === 'growth') {
      cur.growth += settlement;
      // 실결제액 = 정산예정액 + 수수료. 역산할 때 분모로 쓴다.
      cur.growthNet += settlement + (Number(s.commission) || 0);
    } else {
      cur.market += settlement;
    }
    byMonth.set(m, cur);
  }

  // 쿠팡이 잡은 '정산대상액'(수수료 차감 후)으로 견준다. 통장에 들어온
  // 돈으로 견주면 안 된다 — 주정산은 70%만 먼저 주고 나머지 30%(최종액)를
  // 익익월 1일에 주기 때문에, 매달 30%씩 어긋난 것처럼 보인다.
  //
  // RESERVE 행은 더하지 않는다. 그 달 WEEKLY 행들을 통째로 다시 적은 요약이라
  // settlementTargetAmount가 WEEKLY 합과 정확히 같다. 함께 더하면 정산대상액이
  // 딱 두 배가 된다 — 실제로 8월이 993,446이 아니라 1,986,892로 나오고 있었다.
  const targetByMonth = new Map<string, number>();
  const pendingLastByMonth = new Map<string, number>();
  // 쿠팡이 그 달을 어디까지 인식했나. 말일까지 닿아야 견줄 수 있는 달이다.
  const recognizedToByMonth = new Map<string, string>();
  for (const r of setRes.rows) {
    const m = String(r.recognition_month ?? '').slice(0, 7) || String(r.settlement_date).slice(0, 7);
    const reserve = isReserveSettlement(r.settlement_type);

    const recTo = r.recognition_to ? String(r.recognition_to).slice(0, 10) : null;
    if (recTo && recTo > (recognizedToByMonth.get(m) ?? '')) recognizedToByMonth.set(m, recTo);

    if (reserve) {
      // 최종액(30%)은 RESERVE 행이 그 달 전체를 한 줄로 적어 준다. WEEKLY의
      // last_amount를 같이 더하면 같은 돈을 두 번 세게 된다.
      if (String(r.settlement_date) > today) {
        pendingLastByMonth.set(m, (pendingLastByMonth.get(m) ?? 0) + (Number(r.last_amount) || 0));
      }
      continue;
    }
    // 옛 행은 target_amount가 없다. 그때는 지급액이라도 쓴다.
    const target = Number(r.target_amount) || Number(r.amount) || 0;
    targetByMonth.set(m, (targetByMonth.get(m) ?? 0) + target);
  }

  // 윙 매출 자료가 언제부터 있나. 자동 기준(쿠팡 지급내역)에는 로켓그로스가
  // 한 건도 없어 윙끼리만 견주므로, 여기서 보는 것도 윙 자료의 시작일이다.
  const { rows: firstSale } = await selectAll<{ sale_date: string }>((f, t) => supabase!
    .from('coupang_sales_daily').select('sale_date').eq('user_id', userId)
    .neq('channel', 'growth')
    .order('sale_date').range(f, Math.min(t, 0)));
  const salesFrom = firstSale[0]?.sale_date ? String(firstSale[0].sale_date).slice(0, 10) : null;

  const actualByMonth = new Map<string, { amount: number; note: string | null }>();
  for (const c of checkRes.rows) {
    actualByMonth.set(String(c.month).slice(0, 7), { amount: Number(c.actual_amount) || 0, note: c.note ?? null });
  }

  const returnsByMonth = new Map<string, number>();
  for (const r of returnRes.rows) {
    if (!isActiveReturn(r.status)) continue;
    const m = kstDateOf(r.requested_at)?.slice(0, 7);
    if (!m) continue;
    returnsByMonth.set(m, (returnsByMonth.get(m) ?? 0) + (Number(r.quantity) || 0));
  }

  const rows: Array<MonthCheck & { note: string | null }> = wanted.map(month => {
    const v = byMonth.get(month) ?? blank();
    const manual = actualByMonth.get(month);
    return {
      ...checkMonth({
        month,
        marketSettlement: Math.round(v.market),
        growthSettlement: Math.round(v.growth),
        growthNet: Math.round(v.growthNet),
        // 0원은 '아직 안 들어왔다'는 뜻이라 기준으로 쓰지 않는다
        coupangPaid: targetByMonth.get(month) ? Math.round(targetByMonth.get(month)!) : null,
        actual: manual && manual.amount > 0 ? manual.amount : null,
        returnQuantity: returnsByMonth.get(month) ?? 0,
        // 그 달 1일부터 윙 매출이 있어야 온전한 달이다
        salesCovered: Boolean(salesFrom && salesFrom <= `${month}-01`),
        // 쿠팡이 그 달 말일까지 인식했으면 견줄 수 있다. 달력으로 어림하지
        // 않는다 — 8월 31일에 팔린 것이 9월에 구매확정되면 9월 매출이라,
        // 달이 지났다고 그 달 인식이 끝난 것이 아니다.
        recognitionComplete: (recognizedToByMonth.get(month) ?? '') >= monthEnd(month),
        pendingLast: Math.round(pendingLastByMonth.get(month) ?? 0),
      }),
      note: manual?.note ?? null,
    };
  }).reverse(); // 최근 달이 위로

  return res.status(200).json({ rows, feeRate: COUPANG_FEE_RATE_PCT });
}

/** 정산서에 적힌 실지급액을 옮겨 적는다. 0을 넣으면 지운다 (쿠팡 지급내역으로 되돌아간다) */
async function handleSettlementCheckSave(userId: string, req: VercelRequest, res: VercelResponse) {
  const month = String(req.body?.month ?? '').trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: '월 형식이 올바르지 않습니다. (YYYY-MM)' });

  const raw = Number(req.body?.actualAmount);
  if (!Number.isFinite(raw) || raw < 0) return res.status(400).json({ error: '금액을 확인해주세요.' });
  const amount = Math.round(raw);

  if (amount === 0) {
    await supabase!.from('coupang_settlement_checks').delete().eq('user_id', userId).eq('month', month);
    return res.status(200).json({ ok: true, month, actualAmount: 0 });
  }

  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 300) : null;
  const { error } = await supabase!.from('coupang_settlement_checks').upsert({
    user_id: userId, month, actual_amount: amount, note, updated_at: new Date().toISOString(),
  });
  if (error) return res.status(500).json({ error: '저장하지 못했습니다.' });
  return res.status(200).json({ ok: true, month, actualAmount: amount });
}

async function handleSettlement(userId: string, res: VercelResponse) {
  const today = kstToday();
  const from = addDays(today, -90);
  const to = addDays(today, 90);

  const [setRes, salesRes] = await Promise.all([
    selectAll((f, t) => supabase!
      .from('coupang_settlements')
      .select('settlement_date, settlement_type, recognition_month, amount, target_amount, status')
      .eq('user_id', userId)
      .gte('settlement_date', from)
      .lte('settlement_date', to)
      .order('settlement_date').range(f, t)),
    // 최근 90일 윙 정산예정액 — 지급 일정이 아직 안 잡힌 몫을 가늠한다.
    // 쿠팡 지급내역에 로켓그로스가 한 건도 없으므로 그로스 매출을 여기 넣으면
    // 그로스 전액이 매달 '일정 미배정'으로 잡힌다. 윙끼리만 견준다.
    selectAll((f, t) => supabase!
      .from('coupang_sales_daily')
      .select('sale_date, settlement_amount')
      .eq('user_id', userId)
      .neq('channel', 'growth')
      .gte('sale_date', from)
      .order('sale_date').range(f, t)),
  ]);

  const byDate = new Map<string, { date: string; amount: number; items: Array<{ type: string; amount: number; status: string }> }>();
  let paid = 0;      // 이미 들어온 돈
  let upcoming = 0;  // 앞으로 들어올 돈

  for (const s of setRes.rows) {
    const date = String(s.settlement_date);
    const amount = Number(s.amount) || 0;
    const cur = byDate.get(date) ?? { date, amount: 0, items: [] };
    cur.amount += amount;
    cur.items.push({ type: String(s.settlement_type ?? '정산'), amount, status: String(s.status ?? '') });
    byDate.set(date, cur);
    if (date < today) paid += amount;
    else upcoming += amount;
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  // 앞으로 7일 / 30일 입금 예정
  const in7 = days.filter(d => d.date >= today && d.date <= addDays(today, 7)).reduce((n, d) => n + d.amount, 0);
  const in30 = days.filter(d => d.date >= today && d.date <= addDays(today, 30)).reduce((n, d) => n + d.amount, 0);

  // '일정 미배정' = 매출은 인식됐는데 그 인식월에 대한 지급 일정이 아직 없는 몫.
  // 예전에는 90일 매출 총액에서 ±90일 지급 총액을 뺐는데, 두 구간이 서로 다른
  // 매출을 가리켜 거의 항상 0으로 눌렸다. 인식월끼리 맞춰 비교한다.
  //
  // ⚠ 이 숫자는 어림이다. 우리는 '판매일' 기준으로 세고 쿠팡은 '구매확정일'
  //   기준으로 인식한다. 8월에 팔린 것이 9월에 구매확정되면 쿠팡 장부에서는
  //   9월 매출이라, 최근 달일수록 우리 쪽이 크게 나온다. 화면에 그 뜻을
  //   적어 두고, 여기서는 정확한 척하지 않는다.
  const salesByMonth = new Map<string, number>();
  for (const s of salesRes.rows) {
    const m = String(s.sale_date).slice(0, 7);
    salesByMonth.set(m, (salesByMonth.get(m) ?? 0) + (Number(s.settlement_amount) || 0));
  }
  const plannedByMonth = new Map<string, number>();
  for (const s of setRes.rows) {
    const m = String(s.recognition_month ?? '').slice(0, 7);
    if (!m) continue;
    // RESERVE 행은 그 달 WEEKLY를 다시 적은 요약이라 정산대상액을 두 번 세게
    // 된다. 두 배로 잡히면 '일정 미배정'이 늘 0으로 눌린다.
    if (isReserveSettlement(s.settlement_type)) continue;
    // 지급 일정이 '잡혔는지'를 보는 것이므로 정산대상액을 쓴다. 통장에 들어온
    // 돈(70%)으로 세면 아직 안 들어온 최종액 30%가 매달 '미배정'으로 잡힌다 —
    // 일정은 이미 잡혀 있는데도.
    const planned = Number(s.target_amount) || Number(s.amount) || 0;
    plannedByMonth.set(m, (plannedByMonth.get(m) ?? 0) + planned);
  }
  let unscheduled = 0;
  for (const [m, expected] of salesByMonth) {
    unscheduled += Math.max(0, expected - (plannedByMonth.get(m) ?? 0));
  }

  // 최근 8주 주간 입금 추이 — 다음 주 예상의 근거로 쓴다
  const weekly: Array<{ weekStart: string; amount: number }> = [];
  for (let i = 7; i >= 0; i--) {
    const start = addDays(today, -7 * i - 6);
    const end = addDays(today, -7 * i);
    weekly.push({
      weekStart: start,
      amount: days.filter(d => d.date >= start && d.date <= end).reduce((n, d) => n + d.amount, 0),
    });
  }
  // 입금이 있었던 주로만 나누면 안 된다. 월정산 판매자는 8주 중 두 주만
  // 입금되므로 평균이 네 배로 부풀고, 화면은 그 값을 '다음 주 예상의 근거'로
  // 보여준다. 계좌가 관측된 기간만큼(최대 8주)으로 나눈다.
  const firstSeen = days.length > 0 ? days[0].date : null;
  const weeksObserved = firstSeen
    ? Math.min(weekly.length, Math.max(1, Math.ceil((daysBetween(firstSeen, today) + 1) / 7)))
    : 0;
  const weeklyAverage =
    weeksObserved > 0 ? weekly.reduce((n, w) => n + w.amount, 0) / weeksObserved : 0;

  return res.status(200).json({
    today,
    days,
    totals: { paid, upcoming, in7, in30, unscheduled, weeklyAverage, weeksObserved },
    weekly,
  });
}

// ═══════════════════════════════════════════════════════════════
// [3] 주간 성과 리포트 자동 발송
//
// 대시보드는 사용자가 열어야 보인다. 리포트는 찾아간다. 매주 월요일 아침,
// 지난주 순이익과 눈에 띄는 변화만 골라 이메일로 보낸다.
//
// 숫자는 1번 대시보드와 같은 computeProfit을 쓴다. 화면과 메일의 순이익이
// 다르면 둘 다 못 믿게 되기 때문이다.
// ═══════════════════════════════════════════════════════════════

/** 지난주(월~일) 구간 — 월요일 아침에 실행되는 기준 */
export function lastWeekRange(today: string): { start: string; end: string } {
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=일
  const daysSinceMonday = (dow + 6) % 7;
  const thisMonday = addDays(today, -daysSinceMonday);
  return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) };
}

function deltaText(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '(첫 주)' : '';
  const rate = ((current - previous) / Math.abs(previous)) * 100;
  const sign = rate >= 0 ? '▲' : '▼';
  const color = rate >= 0 ? '#4ade80' : '#f87171';
  return `<span style="color:${color};font-size:12px;">${sign} ${Math.abs(rate).toFixed(0)}%</span>`;
}

function rowsTable(title: string, rows: Array<{ name: string; profit: number; qty: number }>): string {
  if (rows.length === 0) return '';
  const body = rows
    .map(
      r =>
        `<tr><td style="padding:6px 0;color:#a8b3c9;font-size:12.5px;">${escapeHtml(r.name).slice(0, 40)}` +
        `<span style="color:#6b7794;"> · ${r.qty}개</span></td>` +
        `<td style="padding:6px 0;text-align:right;color:${r.profit >= 0 ? '#4ade80' : '#f87171'};font-size:12.5px;font-weight:600;">${won(r.profit)}</td></tr>`,
    )
    .join('');
  return `<p style="margin:18px 0 4px;color:#e8ecf5;font-size:13px;font-weight:600;">${title}</p><table style="width:100%;border-collapse:collapse;">${body}</table>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** 사용자 1명의 주간 리포트를 만들고 보낸다. 보낼 게 없으면 false. */
async function sendWeeklyReport(
  userId: string,
  email: string,
  name: string,
  start: string,
  end: string,
): Promise<boolean> {
  if (!supabase) return false;

  // 같은 주를 두 번 보내지 않는다
  const { data: already } = await supabase
    .from('coupang_reports')
    .select('id')
    .eq('user_id', userId)
    .eq('period_start', start)
    .eq('period_end', end)
    .maybeSingle();
  if (already) return false;

  const prevStart = addDays(start, -7);
  const prevEnd = addDays(end, -7);

  const [cur, prev, settleRes] = await Promise.all([
    computeProfit(userId, start, end),
    computeProfit(userId, prevStart, prevEnd, { totalsOnly: true }),
    selectAll<{ settlement_date: string; amount: number }>((f, t) => supabase
      .from('coupang_settlements')
      .select('settlement_date, amount')
      .eq('user_id', userId)
      .gte('settlement_date', end)
      .lte('settlement_date', addDays(end, 14))
      .order('settlement_date').range(f, t)),
  ]);

  // 팔린 것도 반품도 없으면 보낼 이유가 없다
  if (cur.totals.quantity === 0 && cur.totals.returnCount === 0) return false;

  const sold = cur.rows.filter(r => r.quantity > 0);
  const best = sold.slice(0, 3).map(r => ({ name: r.productName, profit: r.profit, qty: r.quantity }));
  const worst = sold
    .filter(r => r.profit < 0)
    .slice(-3)
    .reverse()
    .map(r => ({ name: r.productName, profit: r.profit, qty: r.quantity }));

  const incoming = settleRes.rows.reduce((n, s) => n + (Number(s.amount) || 0), 0);

  // 품절 임박 — 지난주 성과보다 이게 더 급한 주도 있다
  const { rows: inventory } = await computeInventory(userId);
  const atRisk = inventory.filter(r => r.risk === 'out' || r.risk === 'urgent').slice(0, 5);

  // 광고비까지 뺀 값이 진짜 순이익이다. 광고 보고서를 올려 둔 주에만
  // 값이 있고, 안 올린 주는 0이라 예전과 같은 숫자가 나간다.
  // 상품에 붙은 광고비는 상품별 순이익(totals.profit)에서 이미 빠졌다. 옵션에 못 붙은
  // 나머지만 더 뺀다. 둘 다 빼면 광고비가 두 번 빠진다. 직전 주는 상품별을 안 뽑는
  // 가벼운 계산이라(totalsOnly) 옵션별 광고비가 0이고, 합계를 그대로 뺀다.
  const adCost = cur.adCostHint ?? 0;
  const prevAdCost = prev.adCostHint ?? 0;
  const netProfit = cur.totals.profit - Math.max(0, adCost - (cur.totals.adCost ?? 0));
  const prevNetProfit = prev.totals.profit - Math.max(0, prevAdCost - (prev.totals.adCost ?? 0));
  const netMargin = cur.totals.salesAmount > 0 ? (netProfit / cur.totals.salesAmount) * 100 : 0;

  const summary = {
    quantity: cur.totals.quantity,
    salesAmount: cur.totals.salesAmount,
    profit: netProfit,
    marginRate: netMargin,
    returnCount: cur.totals.returnCount,
    prevSalesAmount: prev.totals.salesAmount,
    prevProfit: prevNetProfit,
    adCost,
    incoming,
    missingCost: cur.missingCost,
    atRiskCount: atRisk.length,
  };

  const warn = (msg: string) =>
    `<p style="margin:16px 0 0;padding:10px 12px;background:#1b2540;border-radius:8px;color:#ffb454;font-size:12px;">${msg}</p>`;

  const costWarning =
    (cur.missingCost > 0
      ? warn(`원가가 비어 있는 상품이 ${cur.missingCost}개 있습니다. 그만큼 순이익이 실제보다 크게 잡힙니다.`)
      : '') +
    (adCost === 0
      ? warn('이번 주 광고비가 등록되어 있지 않아 순이익에서 빠지지 않았습니다. 훈프로 [광고 성과 분석]에서 광고 보고서를 올리면 자동으로 반영됩니다.')
      : '');

  const sentWeekly = await sendEmail(
    email,
    `[훈프로] ${start} ~ ${end} 주간 성과`,
    wrapEmail(
      '지난주 성과 요약',
      `<p>${escapeHtml(name)}님, 지난주 쿠팡 판매 결과입니다.</p>` +
        `<table style="width:100%;border-collapse:collapse;margin-top:14px;">` +
        `<tr><td style="padding:8px 0;color:#a8b3c9;font-size:13px;">매출</td>` +
        `<td style="padding:8px 0;text-align:right;color:#e8ecf5;font-size:14px;font-weight:600;">${won(cur.totals.salesAmount)} ${deltaText(cur.totals.salesAmount, prev.totals.salesAmount)}</td></tr>` +
        (adCost > 0
          ? `<tr><td style="padding:8px 0;color:#a8b3c9;font-size:13px;">광고비</td>` +
            `<td style="padding:8px 0;text-align:right;color:#e8ecf5;font-size:14px;font-weight:600;">− ${won(adCost)}</td></tr>`
          : '') +
        `<tr><td style="padding:8px 0;color:#a8b3c9;font-size:13px;">순이익</td>` +
        `<td style="padding:8px 0;text-align:right;color:${netProfit >= 0 ? '#4ade80' : '#f87171'};font-size:14px;font-weight:600;">${won(netProfit)} ${deltaText(netProfit, prevNetProfit)}</td></tr>` +
        `<tr><td style="padding:8px 0;color:#a8b3c9;font-size:13px;">이익률</td>` +
        `<td style="padding:8px 0;text-align:right;color:#e8ecf5;font-size:14px;font-weight:600;">${netMargin.toFixed(1)}%</td></tr>` +
        `<tr><td style="padding:8px 0;color:#a8b3c9;font-size:13px;">판매 수량</td>` +
        `<td style="padding:8px 0;text-align:right;color:#e8ecf5;font-size:14px;font-weight:600;">${cur.totals.quantity.toLocaleString('ko-KR')}개</td></tr>` +
        `<tr><td style="padding:8px 0;color:#a8b3c9;font-size:13px;">반품</td>` +
        `<td style="padding:8px 0;text-align:right;color:#e8ecf5;font-size:14px;font-weight:600;">${cur.totals.returnCount}건</td></tr>` +
        `<tr><td style="padding:8px 0;color:#a8b3c9;font-size:13px;">2주 내 입금 예정</td>` +
        `<td style="padding:8px 0;text-align:right;color:#e8ecf5;font-size:14px;font-weight:600;">${won(incoming)}</td></tr>` +
        `</table>` +
        rowsTable('많이 남은 상품', best) +
        rowsTable('적자가 난 상품', worst) +
        stockTable(atRisk) +
        costWarning +
        emailButtonLink('훈프로에서 자세히 보기'),
    ),
  );

  // 브리핑과 같은 이유로, 못 보낸 주는 기록하지 않는다
  if (!sentWeekly) return false;

  await supabase.from('coupang_reports').insert({
    user_id: userId,
    period_start: start,
    period_end: end,
    summary,
  });

  return true;
}

// ═══════════════════════════════════════════════════════════════
// 아침 브리핑 — 매일 아침 한 통으로 어제를 정리한다
//
// 기능이 많아도 판매자가 매일 앱을 열 이유는 따로 필요하다. 아침에
// "어제 순이익 47만원, 조거팬츠 재고 6일 남음, 새 문의 2건"이 오면
// 그게 여는 이유가 되고, 여는 사람은 해지하지 않는다.
//
// 어제 실적은 매출인식일이 아니라 주문일 기준이다. 매출인식은 배송완료
// 뒤라 최대 열흘 늦어서, 그 숫자로 '어제'를 말하면 대부분 0이 나온다.
// 대신 주문 기준에는 정산 수수료가 없으므로 이 메일의 금액은 '주문액'이라고
// 분명히 적는다 — 순이익인 척하면 나중에 정산 숫자와 어긋나 신뢰를 잃는다.
// ═══════════════════════════════════════════════════════════════

export interface BriefData {
  orderAmount: number;
  quantity: number;
  prevOrderAmount: number;
  /**
   * 창구별 주문액. 윙과 로켓그로스는 서로 다른 상품이라 합계만 보면 어느 쪽이
   * 움직였는지 알 수 없다. 그로스가 8할인 판매자에게 윙 숫자만 보여 주면
   * 그 메일은 틀린 것이 된다.
   */
  byChannel: { wing: number; growth: number };
  topSellers: { name: string; qty: number; amount: number }[];
  reorder: InventoryRow[];
  newInquiries: number;
  newReturns: number;
  leadTimeDays: number;
  /** 시즌 판단 기준 — 최근 14일 판매가 이만큼도 안 되면 발주 대상에서 뺐다 */
  minSales14: number;
  /** 그렇게 빠진 개수. 숨긴 걸 숨겼다고 말해야 판단 기준을 고칠 수 있다 */
  seasonalSkipped: number;
  /** 광고비가 며칠째 비어 있나 — 비어 있으면 순이익이 그만큼 크게 나온다 */
  adGap: AdGap;
  /** 최근 7일 vs 그 전 7일에서 눈에 띄게 빠지거나 뛴 옵션 */
  movers?: SalesMovers;
}

/**
 * 발주가 필요한 것만.
 *
 * 두 가지를 함께 본다.
 *  · 급한가  — 남은 일수가 리드타임보다 짧으면 지금 넣어야 늦지 않는다
 *  · 채울 값이 있는가 — 시즌이 끝난 상품은 품절이어도 채울 일이 아니다
 *
 * 여름 나시티가 9월에 품절인 건 사고가 아니라 계절이다. 남은 일수만 보면
 * 한 달에 한두 개 팔리는 상품이 매일 목록에 올라오고, 매일 같은 목록이 오면
 * 그 메일은 안 읽힌다. 안 읽히는 메일에는 진짜 급한 품절도 함께 묻힌다.
 *
 * 시즌 종료는 '최근에 아직 팔리는가'로 본다 — 계절이 바뀌면 판매가 먼저 끊긴다.
 * 28일 평균이 아니라 14일을 보는 이유는, 28일에는 지난 시즌의 끝자락이 섞여
 * 있어 이미 끝난 상품이 아직 팔리는 것처럼 보이기 때문이다.
 *
 * 다만 자동 판단은 '곧 시작될 시즌'을 알 수 없다. 겨울 상품은 9월에 안 팔리지만
 * 10월 발주는 해야 한다. 그래서 손으로 고정한 규칙이 자동 판단보다 항상 우선한다.
 */
export function needsReorder(
  rows: InventoryRow[],
  leadTimeDays: number,
  minSales14 = 0,
): InventoryRow[] {
  return rows
    .filter(r => {
      // 손으로 정한 규칙이 먼저다
      if (r.reorderMode === 'exclude') return false;

      const urgent = r.risk === 'out'                    // 이미 품절
        || (r.daysLeft !== null && r.daysLeft <= leadTimeDays);  // 도착 전에 떨어진다
      if (r.reorderMode === 'always') return urgent;

      if (!urgent) return false;
      if (r.daysLeft === null && r.risk !== 'out') return false;  // 안 팔리는 재고
      // 최근에 팔리지 않으면 채울 값이 없다 (minSales14가 0이면 이 판단을 끈다)
      return minSales14 <= 0 || r.sold14 >= minSales14;
    })
    .sort((a, b) => (a.daysLeft ?? -1) - (b.daysLeft ?? -1))
    .slice(0, 8);
}

/** 광고비가 어디까지 들어와 있고, 빈 구간에 얼마를 팔았나 */
async function collectAdGap(userId: string, day: string): Promise<AdGap> {
  const empty = adCostGap({ lastAdDate: null, through: day, salesDatesInGap: [], dailyAverage: 0 });
  if (!supabase) return empty;

  const { data: last } = await supabase
    .from('coupang_ad_costs')
    .select('ad_date')
    .eq('user_id', userId)
    .order('ad_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastAdDate = last?.ad_date ? String(last.ad_date).slice(0, 10) : null;

  // 최근 평균 일 광고비 — 부풀려진 금액을 어림하는 데 쓴다.
  // 마지막 30일이 아니라 '들어와 있는 마지막 날부터 거슬러 30일'이다.
  let dailyAverage = 0;
  if (lastAdDate) {
    const { rows: recent } = await selectAll<{ cost: number }>((f, t) => supabase!
      .from('coupang_ad_costs').select('cost')
      .eq('user_id', userId)
      .gte('ad_date', addDays(lastAdDate, -29)).lte('ad_date', lastAdDate)
      .order('ad_date').range(f, t));
    if (recent.length > 0) {
      dailyAverage = recent.reduce((n, r) => n + (Number(r.cost) || 0), 0) / recent.length;
    }
  }

  // 빈 구간에 매출이 있던 날. 매출이 없던 날은 광고비도 없는 게 맞다.
  const from = lastAdDate ? addDays(lastAdDate, 1) : addDays(day, -29);
  if (from > day) return adCostGap({ lastAdDate, through: day, salesDatesInGap: [], dailyAverage });

  const { rows: sales } = await selectAll<{ sale_date: string }>((f, t) => supabase!
    .from('coupang_sales_daily').select('sale_date')
    .eq('user_id', userId)
    .gte('sale_date', from).lte('sale_date', day)
    .order('sale_date').range(f, t));

  return adCostGap({
    lastAdDate,
    through: day,
    salesDatesInGap: sales.map(r => String(r.sale_date).slice(0, 10)),
    dailyAverage,
  });
}

async function collectBrief(
  userId: string, day: string, leadTimeDays: number, minSales14: number,
): Promise<BriefData> {
  const prevDay = addDays(day, -7);   // 요일 효과가 크므로 어제가 아니라 지난주 같은 요일과 견준다

  // 윙과 그로스는 저장되는 곳이 다르다. 발주서(coupang_orders_daily)에는 윙만
  // 들어오고, 그로스는 매출내역(coupang_sales_daily, channel='growth')에 쌓인다.
  // 두 테이블의 vendor_item_id는 하나도 겹치지 않으므로 그대로 더하면 된다.
  //
  // 같은 테이블의 channel='marketplace'는 더하면 안 된다. 그쪽은 매출인식일
  // 기준이라 주문일 기준인 발주서와 날짜 뜻이 달라 같은 판매가 두 번 잡힌다.
  // 그로스 행의 sale_date는 결제일(paidAt)이라 주문일과 같은 뜻이다.
  const [ordersRes, prevOrdersRes, growthRes, prevGrowthRes, inventory, inquiryRes, returnRes] = await Promise.all([
    selectAll<{ vendor_item_id: string; product_name: string | null; quantity: number; order_amount: number }>(
      (f, t) => supabase!
        .from('coupang_orders_daily')
        .select('vendor_item_id, product_name, quantity, order_amount')
        .eq('user_id', userId).eq('order_date', day).order('vendor_item_id').range(f, t)),
    selectAll<{ quantity: number; order_amount: number }>((f, t) => supabase!
      .from('coupang_orders_daily')
      .select('quantity, order_amount')
      .eq('user_id', userId).eq('order_date', prevDay).order('vendor_item_id').range(f, t)),
    selectAll<{ vendor_item_id: string; product_name: string | null; quantity: number; sales_amount: number }>(
      (f, t) => supabase!
        .from('coupang_sales_daily')
        .select('vendor_item_id, product_name, quantity, sales_amount')
        .eq('user_id', userId).eq('channel', 'growth').eq('sale_date', day)
        .order('vendor_item_id').range(f, t)),
    selectAll<{ sales_amount: number }>((f, t) => supabase!
      .from('coupang_sales_daily')
      .select('sales_amount')
      .eq('user_id', userId).eq('channel', 'growth').eq('sale_date', prevDay)
      .order('vendor_item_id').range(f, t)),
    computeInventory(userId, leadTimeDays),
    supabase!.from('coupang_inquiries')
      .select('inquiry_id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('answered', false)
      .gte('inquired_at', `${day}T00:00:00+09:00`).lte('inquired_at', `${day}T23:59:59+09:00`),
    supabase!.from('coupang_returns')
      .select('receipt_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('requested_at', `${day}T00:00:00+09:00`).lte('requested_at', `${day}T23:59:59+09:00`),
  ]);

  // 상품 단위로 합친다. 옵션 스무 개가 스무 줄로 늘어서면 메일에서 읽을 수 없다.
  const byProduct = new Map<string, { name: string; qty: number; amount: number }>();
  let orderAmount = 0;
  let quantity = 0;
  let wingAmount = 0;
  let growthAmount = 0;
  const addSale = (rawName: unknown, rawQty: unknown, rawAmount: unknown) => {
    const qty = Number(rawQty) || 0;
    const amount = Number(rawAmount) || 0;
    orderAmount += amount;
    quantity += qty;
    const name = String(rawName ?? '이름 없는 상품');
    const cur = byProduct.get(name) ?? { name, qty: 0, amount: 0 };
    cur.qty += qty;
    cur.amount += amount;
    byProduct.set(name, cur);
    return amount;
  };
  for (const o of ordersRes.rows) wingAmount += addSale(o.product_name, o.quantity, o.order_amount);
  for (const g of growthRes.rows) growthAmount += addSale(g.product_name, g.quantity, g.sales_amount);

  const prevOrderAmount =
    prevOrdersRes.rows.reduce((n, o) => n + (Number(o.order_amount) || 0), 0) +
    prevGrowthRes.rows.reduce((n, g) => n + (Number(g.sales_amount) || 0), 0);

  // 광고비는 쿠팡이 API로 주지 않아 판매자가 직접 가져온다. 그 한 번을 잊으면
  // 그날부터 순이익이 광고비만큼 크게 나온다. 며칠째 비었는지 세어 둔다.
  const adGap = await collectAdGap(userId, day);
  const movers = await computeSalesMovers(userId, day);

  const reorder = needsReorder(inventory.rows, leadTimeDays, minSales14);
  // 시즌 판단으로 빠진 개수 — 기준을 끄고 세어 차이를 본다
  const withoutSeason = needsReorder(inventory.rows, leadTimeDays, 0);

  return {
    orderAmount,
    quantity,
    prevOrderAmount,
    byChannel: { wing: wingAmount, growth: growthAmount },
    topSellers: [...byProduct.values()].sort((a, b) => b.amount - a.amount).slice(0, 3),
    reorder,
    newInquiries: inquiryRes.count ?? 0,
    newReturns: returnRes.count ?? 0,
    leadTimeDays,
    minSales14,
    seasonalSkipped: Math.max(0, withoutSeason.length - reorder.length),
    adGap,
    movers,
  };
}

/** 보낼 만한 내용이 있는가 — 아무 일도 없던 날은 메일을 만들지 않는다 */
export function briefWorthSending(d: BriefData): boolean {
  return d.quantity > 0 || d.reorder.length > 0 || d.newInquiries > 0 || d.newReturns > 0
    || d.adGap.shouldWarn || Boolean(d.movers && (d.movers.drops.length > 0 || d.movers.rises.length > 0));
}

// ── 매출 급감·급증 감지 ────────────────────────────────────────
//
// 최근 7일과 그 전 7일을 옵션별로 견준다. 윙은 발주서(주문일), 그로스는
// 매출내역(결제일)에서 온다 — 둘 다 '주문이 들어온 날' 기준이라 같이 놓을 수
// 있다. 판정은 src/lib/salesMovers.ts에 있고 여기서는 자료만 모은다.
async function computeSalesMovers(userId: string, day: string): Promise<SalesMovers> {
  const to = day;
  const from = addDays(day, -6);
  const prevTo = addDays(day, -7);
  const prevFrom = addDays(day, -13);
  const empty: SalesMovers = { from, to, prevFrom, prevTo, drops: [], rises: [] };
  if (!supabase) return empty;
  const [wingRes, growthRes, itemRes, invRes] = await Promise.all([
    selectAll<{ order_date: string; vendor_item_id: string; product_name: string | null; quantity: number; order_amount: number }>((f, t) => supabase!
      .from('coupang_orders_daily')
      .select('order_date, vendor_item_id, product_name, quantity, order_amount')
      .eq('user_id', userId).gte('order_date', prevFrom).lte('order_date', to)
      .order('order_date').range(f, t)),
    selectAll<{ sale_date: string; vendor_item_id: string; product_name: string | null; quantity: number; sales_amount: number }>((f, t) => supabase!
      .from('coupang_sales_daily')
      .select('sale_date, vendor_item_id, product_name, quantity, sales_amount')
      .eq('user_id', userId).eq('channel', 'growth').gte('sale_date', prevFrom).lte('sale_date', to)
      .order('sale_date').range(f, t)),
    selectAll<{ vendor_item_id: string; product_name: string | null; option_name: string | null; stock: number | null; business_type: string | null }>((f, t) => supabase!
      .from('coupang_items')
      .select('vendor_item_id, product_name, option_name, stock, business_type')
      .eq('user_id', userId).order('vendor_item_id').range(f, t)),
    selectAll<{ vendor_item_id: string; orderable_qty: number | null }>((f, t) => supabase!
      .from('coupang_growth_inventory')
      .select('vendor_item_id, orderable_qty')
      .eq('user_id', userId).order('vendor_item_id').range(f, t)),
  ]);
  const items = new Map<string, { product_name: string | null; option_name: string | null; stock: number | null }>();
  for (const it of itemRes.rows) items.set(String(it.vendor_item_id), it);
  const growthStock = new Map<string, number>();
  for (const r of invRes.rows) growthStock.set(String(r.vendor_item_id), Number(r.orderable_qty) || 0);

  const agg = new Map<string, MoverInput>();
  const bump = (id: string, name: string | null, channel: 'wing' | 'growth', date: string, qty: number, amount: number) => {
    const it = items.get(id);
    let cur = agg.get(id);
    if (!cur) {
      const stock = channel === 'growth'
        ? (growthStock.has(id) ? growthStock.get(id)! : null)
        : (it && it.stock !== null && it.stock !== undefined ? Number(it.stock) : null);
      cur = {
        vendorItemId: id,
        productName: String(it?.product_name ?? name ?? '이름 없는 상품'),
        optionName: String(it?.option_name ?? ''),
        channel, recentQty: 0, prevQty: 0, recentAmount: 0, prevAmount: 0, stock,
      };
      agg.set(id, cur);
    }
    if (date >= from) { cur.recentQty += qty; cur.recentAmount += amount; }
    else { cur.prevQty += qty; cur.prevAmount += amount; }
  };
  for (const o of wingRes.rows) bump(String(o.vendor_item_id), o.product_name, 'wing', String(o.order_date).slice(0, 10), Number(o.quantity) || 0, Number(o.order_amount) || 0);
  for (const g of growthRes.rows) bump(String(g.vendor_item_id), g.product_name, 'growth', String(g.sale_date).slice(0, 10), Number(g.quantity) || 0, Number(g.sales_amount) || 0);

  const { drops, rises } = pickMovers([...agg.values()]);
  return { from, to, prevFrom, prevTo, drops, rises };
}

async function handleSalesMovers(userId: string, res: VercelResponse) {
  // 어제까지가 온전한 하루다. 오늘은 아직 쌓이는 중이라 넣으면 급감으로 보인다.
  const day = addDays(kstToday(), -1);
  return res.status(200).json(await computeSalesMovers(userId, day));
}

export function briefHtml(name: string, day: string, d: BriefData): string {
  const diff = d.orderAmount - d.prevOrderAmount;
  const diffPct = d.prevOrderAmount > 0 ? Math.round((diff / d.prevOrderAmount) * 100) : null;
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '–';
  const diffColor = diff > 0 ? '#5fd3a6' : diff < 0 ? '#ff8a8a' : '#a8b3c9';

  const card = (label: string, value: string, sub = '') =>
    `<td style="padding:10px 12px;background:#1b2540;border-radius:9px;vertical-align:top;">` +
    `<div style="font-size:11px;color:#7c88a3;">${label}</div>` +
    `<div style="font-size:17px;font-weight:700;color:#e8ecf5;margin-top:3px;">${value}</div>` +
    (sub ? `<div style="font-size:11px;color:#7c88a3;margin-top:2px;">${sub}</div>` : '') +
    `</td>`;

  let html =
    `<p style="margin:0 0 14px;">${escapeHtml(name)}님, ${day.slice(5).replace('-', '월 ')}일 상황입니다.</p>` +
    `<table style="width:100%;border-collapse:separate;border-spacing:6px 0;"><tr>` +
    card('어제 주문액', won(d.orderAmount), `${d.quantity.toLocaleString('ko-KR')}개`) +
    card(
      '지난주 같은 요일',
      diffPct === null ? '비교 없음' : `<span style="color:${diffColor};">${arrow} ${Math.abs(diffPct)}%</span>`,
      d.prevOrderAmount > 0 ? won(d.prevOrderAmount) : '',
    ) +
    `</tr></table>`;

  // 창구를 나눠 적는다. 윙과 그로스는 다른 상품이라 합계만 보면 어느 쪽이
  // 움직였는지 알 수 없다. 한쪽만 쓰는 판매자에게는 그 줄을 보이지 않는다.
  if (d.byChannel.wing > 0 && d.byChannel.growth > 0) {
    html +=
      `<p style="margin:8px 0 0;font-size:11.5px;color:#7c88a3;">` +
      `로켓그로스 ${won(d.byChannel.growth)} · 윙 ${won(d.byChannel.wing)}</p>`;
  }

  if (d.topSellers.length > 0) {
    html +=
      `<p style="margin:18px 0 6px;font-size:12px;color:#7c88a3;">어제 많이 팔린 상품</p>` +
      d.topSellers
        .map(
          s =>
            `<div style="font-size:12.5px;padding:3px 0;">${escapeHtml(s.name.slice(0, 40))} ` +
            `<span style="color:#7c88a3;">${s.qty}개 · ${won(s.amount)}</span></div>`,
        )
        .join('');
  }

  // 이번 주 눈에 띄는 변화 — 빠진 것부터. 원인 후보를 한 줄 붙여 다음 행동을 잇는다.
  if (d.movers && (d.movers.drops.length > 0 || d.movers.rises.length > 0)) {
    const line = (m: SalesMovers['drops'][number], color: string) => {
      const label = `${m.productName}${m.optionName ? ` / ${m.optionName}` : ''}`.slice(0, 44);
      const pct = m.pct === null ? '신규' : `${m.pct > 0 ? '+' : ''}${m.pct}%`;
      return `<div style="font-size:12.5px;padding:3px 0;">${escapeHtml(label)} ` +
        `<span style="color:${color};font-weight:700;">${pct}</span> ` +
        `<span style="color:#7c88a3;">${m.prevQty}→${m.recentQty}개` +
        (m.hints.length ? ` · ${escapeHtml(m.hints[0])}` : '') + `</span></div>`;
    };
    html += `<p style="margin:18px 0 6px;font-size:12px;color:#7c88a3;">이번 주 눈에 띄는 변화 (최근 7일 vs 그 전 7일)</p>`;
    html += d.movers.drops.slice(0, 3).map(m => line(m, '#ff8a8a')).join('');
    html += d.movers.rises.slice(0, 3).map(m => line(m, '#5fd3a6')).join('');
  }

  // 발주는 가장 급한 항목이라 실적보다 눈에 띄게 둔다. 품절은 매출만 잃는 게
  // 아니라 검색 순위까지 잃고, 되돌리는 데 몇 주가 걸린다.
  if (d.reorder.length > 0) {
    const rows = d.reorder
      .map(r => {
        const left = r.risk === 'out'
          ? `<span style="color:#ff8a8a;font-weight:700;">품절</span>`
          : `<span style="color:${(r.daysLeft ?? 0) <= 3 ? '#ff8a8a' : '#ffb454'};">${r.daysLeft}일</span>`;
        const label = `${r.productName}${r.optionName ? ` / ${r.optionName}` : ''}`;
        return `<div style="font-size:12.5px;padding:4px 0;border-top:1px solid #23304f;">` +
          `${escapeHtml(label.slice(0, 44))} · ${left}` +
          (r.reorderQty > 0 ? ` <span style="color:#7c88a3;">→ ${r.reorderQty.toLocaleString('ko-KR')}개 발주</span>` : '') +
          `</div>`;
      })
      .join('');
    html +=
      `<div style="margin:18px 0 0;padding:12px 14px;background:#2a1f1f;border:1px solid #4a2f2f;border-radius:10px;">` +
      `<div style="font-size:13px;font-weight:700;color:#ffb454;">지금 발주해야 할 것 ${d.reorder.length}개</div>` +
      `<div style="font-size:11px;color:#7c88a3;margin:3px 0 6px;">리드타임 ${d.leadTimeDays}일 기준입니다. 지금 주문해도 도착 전에 떨어지는 것만 골랐습니다.` +
      (d.seasonalSkipped > 0
        ? ` 최근 14일 판매가 ${d.minSales14}개 미만인 ${d.seasonalSkipped}개는 시즌이 지난 것으로 보고 뺐습니다.`
        : '') +
      `</div>` +
      rows +
      `</div>`;
  }

  // 광고비가 비면 이 메일의 다른 숫자까지 틀린 것이 된다. 그래서 할 일보다 위에 둔다.
  if (d.adGap.shouldWarn) {
    const g = d.adGap;
    const what = g.never
      ? '광고비를 아직 한 번도 가져오지 않았습니다.'
      : `광고비가 ${g.lastAdDate} 이후로 비어 있습니다 (판매가 있던 ${g.missingWithSales}일).`;
    const cost = g.overstatedBy > 0
      ? ` 그만큼 순이익이 <b style="color:#e8ecf5;">${won(g.overstatedBy)}쯤 크게</b> 나오고 있습니다.`
      : '';
    html +=
      `<div style="margin:16px 0 0;padding:12px 14px;background:#1b2540;border:1px solid #2f3d5f;border-radius:10px;">` +
      `<div style="font-size:13px;font-weight:700;color:#ffb454;">광고비를 가져와 주세요</div>` +
      `<div style="font-size:12px;color:#a8b3c9;margin-top:4px;line-height:1.65;">${what}${cost}</div>` +
      `<div style="font-size:11px;color:#7c88a3;margin-top:5px;line-height:1.6;">` +
      `쿠팡이 광고비를 API로 주지 않아 이것만 직접 가져와야 합니다. ` +
      `<a href="https://advertising.coupang.com" style="color:#22a3b8;">광고센터</a>에 들어가 즐겨찾기에 넣어 둔 ` +
      `[훈프로 광고비]를 한 번 눌러주시면 지난 30일치가 한꺼번에 채워집니다.</div>` +
      `</div>`;
  }

  const todo: string[] = [];
  if (d.newInquiries > 0) todo.push(`답변 안 한 문의 ${d.newInquiries}건`);
  if (d.newReturns > 0) todo.push(`새 반품 ${d.newReturns}건`);
  if (todo.length > 0) {
    html += `<p style="margin:16px 0 0;font-size:12.5px;color:#a8b3c9;">${todo.join(' · ')}</p>`;
  }

  html +=
    `<p style="margin:14px 0 0;font-size:11px;color:#7c88a3;line-height:1.6;">` +
    `금액은 <b style="color:#a8b3c9;">주문액</b>입니다. 수수료·광고비를 뺀 순이익은 정산이 끝나야 확정되므로 ` +
    `[정산AI]에서 확인하세요. 이 메일은 [연동 설정]에서 끌 수 있습니다.</p>` +
    emailButtonLink('훈프로 열기');

  return html;
}

async function sendDailyBrief(
  userId: string,
  email: string,
  name: string,
  day: string,
  leadTimeDays: number,
  minSales14: number,
): Promise<boolean> {
  if (!supabase) return false;

  // 크론이 재시도되거나 두 번 돌아도 같은 날 두 통이 가지 않는다
  const { data: already } = await supabase
    .from('coupang_daily_briefs')
    .select('user_id')
    .eq('user_id', userId)
    .eq('brief_date', day)
    .maybeSingle();
  if (already) return false;

  const d = await collectBrief(userId, day, leadTimeDays, minSales14);
  if (!briefWorthSending(d)) return false;

  const sent = await sendEmail(
    email,
    `[훈프로] ${day.slice(5).replace('-', '/')} 어제 주문 ${won(d.orderAmount)}` +
      (d.reorder.length > 0 ? ` · 발주 ${d.reorder.length}건` : '') +
      (d.adGap.shouldWarn ? ' · 광고비 확인' : ''),
    wrapEmail('오늘의 훈프로 브리핑', briefHtml(name, day, d)),
  );
  // 못 보냈으면 기록을 남기지 않는다. 남기면 그 날짜는 영구히 '보냄'이 되어
  // 다시 시도되지 않는다. 다음 회차에 한 번 더 시도할 기회를 남긴다.
  if (!sent) return false;

  await supabase.from('coupang_daily_briefs').insert({
    user_id: userId,
    brief_date: day,
    summary: {
      orderAmount: d.orderAmount,
      quantity: d.quantity,
      prevOrderAmount: d.prevOrderAmount,
      reorderCount: d.reorder.length,
      seasonalSkipped: d.seasonalSkipped,
      adMissingDays: d.adGap.missingWithSales,
      adOverstatedBy: d.adGap.overstatedBy,
      newInquiries: d.newInquiries,
      newReturns: d.newReturns,
    },
  });
  return true;
}

async function cronMorningBrief(res: VercelResponse) {
  if (!supabase) return res.status(200).json({ ok: false, reason: 'supabase 미설정' });
  if (!process.env.RESEND_API_KEY) return res.status(200).json({ ok: false, reason: 'RESEND_API_KEY 미설정' });

  const day = addDays(kstToday(), -1);   // 어제
  const budgetMs = 240_000;
  const startedAt = Date.now();

  const { data: accounts } = await supabase
    .from('coupang_accounts')
    .select('user_id, brief_enabled, lead_time_days, reorder_min_sales14, users(email, name)')
    .eq('status', 'active');

  const result = { day, sent: 0, skipped: 0, failed: 0 };

  for (const acc of (accounts ?? []) as any[]) {
    if (Date.now() - startedAt > budgetMs) { result.skipped++; continue; }
    if (acc.brief_enabled === false) { result.skipped++; continue; }
    const email = acc.users?.email;
    if (!email) { result.skipped++; continue; }
    try {
      const sent = await sendDailyBrief(
        acc.user_id, email, acc.users?.name ?? '', day,
        Number(acc.lead_time_days) || 14,
        Number.isFinite(Number(acc.reorder_min_sales14)) ? Number(acc.reorder_min_sales14) : 3,
      );
      if (sent) result.sent++; else result.skipped++;
    } catch {
      result.failed++;
    }
  }

  return res.status(200).json({ ok: true, ...result });
}

/** 브리핑 수신 설정 — 매일 오는 메일은 끌 수 있어야 한다 */
async function handleBriefSettings(userId: string, req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    const patch: Record<string, any> = {};
    if (typeof req.body?.enabled === 'boolean') patch.brief_enabled = req.body.enabled;
    if (req.body?.leadTimeDays !== undefined) {
      const n = Number(req.body.leadTimeDays);
      // 0일이면 '이미 늦은 것'만 알리게 되고, 너무 길면 전부 발주 대상이 된다
      if (Number.isFinite(n)) patch.lead_time_days = Math.min(120, Math.max(1, Math.round(n)));
    }
    if (req.body?.minSales14 !== undefined) {
      const n = Number(req.body.minSales14);
      // 0은 '자동 판단 끔'이라 살려 둔다
      if (Number.isFinite(n)) patch.reorder_min_sales14 = Math.min(999, Math.max(0, Math.round(n)));
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: '변경할 값이 없습니다.' });
    const { error } = await supabase!.from('coupang_accounts').update(patch).eq('user_id', userId);
    if (error) return res.status(500).json({ error: '저장하지 못했습니다.' });
    return res.status(200).json({ ok: true, ...patch });
  }

  const { data } = await supabase!
    .from('coupang_accounts')
    .select('brief_enabled, lead_time_days, reorder_min_sales14')
    .eq('user_id', userId)
    .maybeSingle();
  return res.status(200).json({
    enabled: data?.brief_enabled ?? true,
    leadTimeDays: Number(data?.lead_time_days) || 14,
    minSales14: Number.isFinite(Number(data?.reorder_min_sales14)) ? Number(data!.reorder_min_sales14) : 3,
  });
}

/**
 * 발주 규칙 고정 — 자동 판단이 틀렸을 때 판매자가 직접 정한다.
 *
 * 자동 판단은 '곧 시작될 시즌'을 모른다. 겨울 상품은 9월에 안 팔리지만 10월
 * 발주는 해야 하고, 반대로 단종한 상품은 잘 팔리는 중에도 채울 이유가 없다.
 */
async function handleReorderRule(userId: string, req: VercelRequest, res: VercelResponse) {
  const vendorItemId = String(req.body?.vendorItemId ?? req.query.vendorItemId ?? '').trim();
  if (!vendorItemId) return res.status(400).json({ error: '옵션을 지정해주세요.' });

  const mode = String(req.body?.mode ?? '').trim();
  // 'auto'는 규칙을 지운다는 뜻이다 — 다시 자동 판단에 맡긴다
  if (mode === 'auto' || mode === '') {
    await supabase!.from('coupang_reorder_rules').delete()
      .eq('user_id', userId).eq('vendor_item_id', vendorItemId);
    return res.status(200).json({ ok: true, vendorItemId, mode: 'auto' });
  }
  if (mode !== 'exclude' && mode !== 'always') {
    return res.status(400).json({ error: '알 수 없는 값입니다.' });
  }

  const { error } = await supabase!.from('coupang_reorder_rules').upsert({
    user_id: userId,
    vendor_item_id: vendorItemId,
    mode,
    note: typeof req.body?.note === 'string' ? req.body.note.slice(0, 200) : null,
    updated_at: new Date().toISOString(),
  });
  if (error) return res.status(500).json({ error: '저장하지 못했습니다.' });
  return res.status(200).json({ ok: true, vendorItemId, mode });
}

function emailButtonLink(label: string, href = 'https://hoonproai.com'): string {
  return `<div style="margin:22px 0 4px;"><a href="${href}" style="display:inline-block;padding:11px 20px;border-radius:10px;background:linear-gradient(135deg,#7cf5ff,#8b7bff);color:#0a0f1f;font-weight:700;font-size:13.5px;text-decoration:none;">${label}</a></div>`;
}

async function cronWeeklyReport(res: VercelResponse) {
  if (!supabase) return res.status(200).json({ ok: false, reason: 'supabase 미설정' });
  if (!process.env.RESEND_API_KEY) return res.status(200).json({ ok: false, reason: 'RESEND_API_KEY 미설정' });

  const { start, end } = lastWeekRange(kstToday());
  const budgetMs = 240_000;
  const startedAt = Date.now();

  const { data: accounts } = await supabase
    .from('coupang_accounts')
    .select('user_id, users(email, name)')
    .eq('status', 'active');

  const result = { period: `${start}~${end}`, sent: 0, skipped: 0, failed: 0 };

  for (const acc of (accounts ?? []) as any[]) {
    if (Date.now() - startedAt > budgetMs) {
      result.skipped++;
      continue;
    }
    const email = acc.users?.email;
    if (!email) {
      result.skipped++;
      continue;
    }
    try {
      const sent = await sendWeeklyReport(acc.user_id, email, acc.users?.name ?? '', start, end);
      if (sent) result.sent++;
      else result.skipped++;
    } catch (e) {
      result.failed++;
    }
  }

  return res.status(200).json({ ok: true, ...result });
}

/** 지난 리포트 목록 — 화면에서 주간 추이를 본다 */
async function handleReports(userId: string, res: VercelResponse) {
  const { data } = await supabase!
    .from('coupang_reports')
    .select('period_start, period_end, summary, sent_at')
    .eq('user_id', userId)
    .order('period_start', { ascending: false })
    .limit(12);
  return res.status(200).json({ reports: data ?? [] });
}

// ═══════════════════════════════════════════════════════════════
// [4] 재고 소진 예측과 품절 알림
//
// 품절은 매출을 잃을 뿐 아니라 검색 순위까지 떨어뜨린다. 되돌리는 데
// 몇 주가 걸리므로 '며칠 남았는지'를 미리 아는 것이 중요하다.
//
// 판매 속도는 매출내역이 아니라 주문 기준으로 계산한다. 매출인식일은 배송완료
// 이후라 최대 열흘 늦어, 그 숫자로 재고를 예측하면 이미 품절난 뒤에 알게 된다.
//
// 한계를 분명히 해 둔다. 품절이었던 기간에는 팔리지 않으므로 판매 속도가
// 실제 수요보다 낮게 잡힌다. 즉 이 예측은 보수적이지 않고 낙관적이다.
// ═══════════════════════════════════════════════════════════════

export interface InventoryRow {
  vendorItemId: string;
  productName: string;
  optionName: string;
  stock: number;
  sold7: number;
  sold28: number;
  velocity: number;        // 하루 평균 판매량
  daysLeft: number | null; // 판매가 없으면 null
  reorderQty: number;      // 리드타임 + 목표 커버 기간을 채우는 데 필요한 수량
  risk: 'out' | 'urgent' | 'watch' | 'ok' | 'idle' | 'excess';
  /** 쿠팡이 집계한 최근 30일 판매수 (로켓창고 재고 API). 없으면 null */
  coupangSold30: number | null;
  /** 최근 14일 판매수 — 시즌이 끝났는지는 28일 평균보다 이쪽이 먼저 말해준다 */
  sold14: number;
  /** 판매자가 손으로 고정한 발주 규칙. 없으면 자동 판단 */
  reorderMode: 'auto' | 'exclude' | 'always';
}

const RISK_ORDER: Record<InventoryRow['risk'], number> = {
  out: 0, urgent: 1, watch: 2, excess: 3, ok: 4, idle: 5,
};

export async function computeInventory(
  userId: string,
  leadTimeDays = 14,
  coverDays = 30,
): Promise<{ rows: InventoryRow[]; counts: Record<string, number> }> {
  if (!supabase) return { rows: [], counts: {} };

  // 그로스 재고 예측이다. 재고는 로켓창고의 판매가능수량, 판매 속도는 그로스
  // 주문(결제일 기준)이다. 등록상품의 재고 수치는 판매자 창고 기준이라 그로스에선
  // 팔리는 재고가 아니다. 상품명은 등록상품이 있으면 거기서, 없으면 주문에서 가져온다
  // — 상품 수집이 막혀 있어도 이 화면은 돌아가야 한다.
  const today = kstToday();
  const [invRes, salesRes, itemRes] = await Promise.all([
    selectAll((f, t) => supabase
      .from('coupang_growth_inventory')
      .select('vendor_item_id, product_name, external_sku, orderable_qty, sales_30d')
      .eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
    selectAll((f, t) => supabase
      .from('coupang_sales_daily')
      .select('vendor_item_id, sale_date, quantity, product_name')
      .eq('user_id', userId)
      .eq('channel', 'growth')
      .gte('sale_date', addDays(today, -27))
      .order('sale_date').range(f, t)),
    selectAll((f, t) => supabase.from('coupang_items')
      .select('vendor_item_id, product_name, option_name, status').eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
  ]);

  const sold7 = new Map<string, number>();
  const sold14 = new Map<string, number>();
  const sold28 = new Map<string, number>();
  const nameFromSales = new Map<string, string>();
  const since7 = addDays(today, -6);
  const since14 = addDays(today, -13);
  for (const o of salesRes.rows) {
    const id = String(o.vendor_item_id);
    const qty = Number(o.quantity) || 0;
    sold28.set(id, (sold28.get(id) ?? 0) + qty);
    if (String(o.sale_date) >= since14) sold14.set(id, (sold14.get(id) ?? 0) + qty);
    if (String(o.sale_date) >= since7) sold7.set(id, (sold7.get(id) ?? 0) + qty);
    if (o.product_name && !nameFromSales.has(id)) nameFromSales.set(id, String(o.product_name));
  }

  // 판매자가 손으로 고정한 발주 규칙 (시즌 종료로 빼둔 것, 곧 시즌이 와서 넣어둔 것)
  const ruleById = new Map<string, 'exclude' | 'always'>();
  try {
    const { data: rules } = await supabase
      .from('coupang_reorder_rules').select('vendor_item_id, mode').eq('user_id', userId);
    for (const r of rules ?? []) ruleById.set(String(r.vendor_item_id), r.mode as 'exclude' | 'always');
  } catch { /* 규칙을 못 읽어도 예측 자체는 돌아야 한다 */ }
  const itemById = new Map<string, any>();
  for (const it of itemRes.rows) itemById.set(String(it.vendor_item_id), it);

  const rows: InventoryRow[] = [];
  for (const inv of invRes.rows) {
    const id = String(inv.vendor_item_id);
    const it = itemById.get(id);
    const stock = Number(inv.orderable_qty) || 0;
    const s28 = sold28.get(id) ?? 0;
    const s14 = sold14.get(id) ?? 0;
    const s7 = sold7.get(id) ?? 0;
    const coupang30 = inv.sales_30d === null || inv.sales_30d === undefined ? null : Number(inv.sales_30d) || 0;

    // 로켓창고 목록에는 예전에 보냈다가 지금은 재고도 판매도 없는 옵션이 남아 있다
    // (단종된 사이즈 등). 이걸 '품절'로 세면 화면이 죽은 옵션으로 가득 차서 정작
    // 채워야 할 상품이 묻힌다. 재고가 있거나 최근 한 달 안에 팔린 것만 그로스
    // 상품으로 본다.
    if (stock <= 0 && s28 === 0 && !(coupang30 && coupang30 > 0)) continue;

    // 28일 판매가 없으면 최근 7일로, 그것도 없으면 쿠팡이 집계한 30일 판매수로 본다.
    // 신상품은 28일 평균이 실제보다 낮다.
    const velocity = s28 > 0 ? s28 / 28 : s7 > 0 ? s7 / 7 : coupang30 && coupang30 > 0 ? coupang30 / 30 : 0;
    const daysLeft = velocity > 0 ? stock / velocity : null;

    // 재고 0은 판매 속도와 무관하게 품절이다. 오래 품절된 상품일수록 최근 판매가
    // 없어 속도가 0인데, 그걸 '위험 없음'으로 읽으면 기능이 잡아야 할 것을 숨긴다.
    // 판매자가 스스로 판매를 멈춘 옵션만 따로 뺀다.
    const stopped = /STOP|중지|SUSPEND|종료/i.test(String(it?.status ?? ''));
    let risk: InventoryRow['risk'];
    if (stopped) risk = 'idle';
    else if (stock <= 0) risk = 'out';
    else if (velocity === 0) risk = 'idle';
    else if (daysLeft! <= 7) risk = 'urgent';
    else if (daysLeft! <= 14) risk = 'watch';
    else if (daysLeft! > 90) risk = 'excess';
    else risk = 'ok';

    const reorderQty = velocity > 0 ? Math.max(0, Math.ceil(velocity * (leadTimeDays + coverDays) - stock)) : 0;

    rows.push({
      vendorItemId: id,
      productName: it?.product_name ?? inv.product_name ?? nameFromSales.get(id) ?? (inv.external_sku ? `SKU ${inv.external_sku}` : ''),
      optionName: it?.option_name ?? '',
      stock,
      sold7: s7,
      sold28: s28,
      velocity,
      daysLeft,
      reorderQty,
      risk,
      coupangSold30: coupang30,
      sold14: s14,
      reorderMode: ruleById.get(id) ?? 'auto',
    });
  }

  rows.sort((a, b) => {
    const d = RISK_ORDER[a.risk] - RISK_ORDER[b.risk];
    if (d !== 0) return d;
    return (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999);
  });

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.risk] = (counts[r.risk] ?? 0) + 1;

  return { rows, counts };
}

async function handleInventory(userId: string, req: VercelRequest, res: VercelResponse) {
  const leadTimeDays = Math.min(120, Math.max(0, Number(req.query.leadTime ?? 14) || 14));
  const coverDays = Math.min(180, Math.max(1, Number(req.query.cover ?? 30) || 30));
  const { rows, counts } = await computeInventory(userId, leadTimeDays, coverDays);
  return res.status(200).json({ rows, counts, leadTimeDays, coverDays });
}


// ═══════════════════════════════════════════════════════════════
// [4-2] 그로스 재고 대조
//
// 로켓창고 재고는 쿠팡이 주지만, 그 재고가 "내가 보낸 만큼"인지는 아무도 말해
// 주지 않는다. 사입 주문·입고는 쿠팡에 없는 정보라 판매자가 적고, 판매는
// 그로스 주문에서 자동으로 센다.
//
//   예상 재고 = 기준 재고 + (기준일 뒤 입고) − (기준일 뒤 판매)
//   차이      = 쿠팡 재고 − 예상 재고
//
// 차이가 음수면 보낸 것보다 적다(미입고·분실·불량 반출), 양수면 더 많다(반품
// 재입고 등). 기준 재고가 없으면 첫 입고 기록 날짜부터 0에서 시작한다 — 그
// 전부터 있던 재고는 셈에 안 들어가므로, 화면은 "지금 재고를 기준으로 시작"을
// 먼저 권한다.
// ═══════════════════════════════════════════════════════════════

const INBOUND_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function inboundDateOf(r: any): string {
  // 기록의 대표 날짜 — 입고일이 있으면 입고일, 없으면 주문일
  return String(r.received_at ?? r.ordered_at ?? String(r.created_at ?? '').slice(0, 10));
}

async function handleGrowthReconcile(userId: string, res: VercelResponse) {
  const today = kstToday();
  const [invRes, itemRes, inboundRes, salesRes, snapRes] = await Promise.all([
    selectAll<any>((f, t) => supabase!.from('coupang_growth_inventory')
      .select('vendor_item_id, product_name, external_sku, orderable_qty, sales_30d, synced_at')
      .eq('user_id', userId).order('vendor_item_id').range(f, t)),
    selectAll<any>((f, t) => supabase!.from('coupang_items')
      .select('vendor_item_id, product_name, option_name')
      .eq('user_id', userId).eq('business_type', 'growth').order('vendor_item_id').range(f, t)),
    selectAll<any>((f, t) => supabase!.from('coupang_growth_inbound')
      .select('*').eq('user_id', userId).order('created_at').range(f, t)),
    selectAll<any>((f, t) => supabase!.from('coupang_sales_daily')
      .select('vendor_item_id, sale_date, quantity')
      .eq('user_id', userId).eq('channel', 'growth')
      .gte('sale_date', addDays(today, -365)).order('sale_date').range(f, t)),
    selectAll<any>((f, t) => supabase!.from('coupang_growth_inventory_daily')
      .select('vendor_item_id, snap_date, orderable_qty')
      .eq('user_id', userId).gte('snap_date', addDays(today, -30)).order('snap_date').range(f, t)),
  ]);

  const items = new Map<string, { product_name: string; option_name: string }>();
  for (const it of itemRes.rows) items.set(String(it.vendor_item_id), it);
  const inv = new Map<string, any>();
  for (const r of invRes.rows) inv.set(String(r.vendor_item_id), r);

  const recordsBy = new Map<string, any[]>();
  for (const r of inboundRes.rows) {
    const id = String(r.vendor_item_id);
    const list = recordsBy.get(id) ?? [];
    list.push(r);
    recordsBy.set(id, list);
  }
  const salesBy = new Map<string, Array<{ date: string; qty: number }>>();
  for (const s of salesRes.rows) {
    const id = String(s.vendor_item_id);
    const list = salesBy.get(id) ?? [];
    list.push({ date: String(s.sale_date), qty: Number(s.quantity) || 0 });
    salesBy.set(id, list);
  }
  const snapsBy = new Map<string, Array<{ date: string; qty: number }>>();
  for (const s of snapRes.rows) {
    const id = String(s.vendor_item_id);
    const list = snapsBy.get(id) ?? [];
    list.push({ date: String(s.snap_date), qty: Number(s.orderable_qty) || 0 });
    snapsBy.set(id, list);
  }

  const ids = new Set<string>([...inv.keys(), ...recordsBy.keys()]);
  const rows: any[] = [];
  for (const id of ids) {
    const it = items.get(id);
    const stockRow = inv.get(id);
    const records = (recordsBy.get(id) ?? [])
      .slice()
      .sort((a, b) => inboundDateOf(a).localeCompare(inboundDateOf(b)) || String(a.created_at).localeCompare(String(b.created_at)));

    // 기준 재고 — 여러 개면 가장 최근 것. 그 이전 기록은 셈에서 뺀다.
    const baselines = records.filter(r => r.kind === 'baseline' && r.received_at);
    const baseline = baselines.length ? baselines[baselines.length - 1] : null;
    const inbound = records.filter(r => r.kind === 'inbound');
    const startDate: string | null = baseline
      ? String(baseline.received_at)
      : inbound.length ? inboundDateOf(inbound[0]) : null;

    const orderedTotal = inbound.reduce((n, r) => n + (Number(r.ordered_qty) || 0), 0);
    const receivedTotal = inbound.reduce((n, r) => n + (Number(r.received_qty) || 0), 0);
    // 주문했는데 아직 입고 기록이 없는 수량 — 배 위에 있거나 누락된 것
    const pendingQty = inbound
      .filter(r => r.received_at === null || r.received_at === undefined)
      .reduce((n, r) => n + (Number(r.ordered_qty) || 0), 0);

    // 기준일 뒤의 입고·판매만 센다. 기준 재고는 그날 재고를 통째로 담고 있다.
    const afterStart = (d: string) => (baseline ? d > startDate! : d >= startDate!);
    const receivedAfter = startDate
      ? inbound.filter(r => r.received_at && afterStart(String(r.received_at))).reduce((n, r) => n + (Number(r.received_qty) || 0), 0)
      : 0;
    const soldAfter = startDate
      ? (salesBy.get(id) ?? []).filter(s => afterStart(s.date)).reduce((n, s) => n + s.qty, 0)
      : 0;
    const expected = startDate ? (baseline ? Number(baseline.received_qty) || 0 : 0) + receivedAfter - soldAfter : null;
    const stock = stockRow ? Number(stockRow.orderable_qty) || 0 : null;
    const diff = expected !== null && stock !== null ? stock - expected : null;

    rows.push({
      vendorItemId: id,
      productName: it?.product_name || stockRow?.product_name || `옵션 ${id}`,
      optionName: it?.option_name || stockRow?.external_sku || '',
      stock,
      stockSyncedAt: stockRow?.synced_at ?? null,
      coupangSold30: stockRow?.sales_30d ?? null,
      hasBaseline: Boolean(baseline),
      baselineQty: baseline ? Number(baseline.received_qty) || 0 : null,
      startDate,
      orderedTotal,
      receivedTotal,
      pendingQty,
      receivedAfter,
      soldAfter,
      expected,
      diff,
      status: diff === null ? 'nobase' : diff === 0 ? 'match' : diff < 0 ? 'short' : 'over',
      records: records.map(r => ({
        id: String(r.id), kind: r.kind,
        orderedAt: r.ordered_at ?? null, orderedQty: Number(r.ordered_qty) || 0,
        receivedAt: r.received_at ?? null, receivedQty: r.received_qty === null || r.received_qty === undefined ? null : Number(r.received_qty),
        memo: r.memo ?? '',
      })),
      snapshots: snapsBy.get(id) ?? [],
    });
  }

  // 어긋난 것부터, 같은 상태면 차이가 큰 순. 대조를 시작 안 한 옵션은 뒤로.
  const order = { short: 0, over: 1, match: 2, nobase: 3 } as Record<string, number>;
  rows.sort((a, b) => order[a.status] - order[b.status] || Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0) || (b.stock ?? 0) - (a.stock ?? 0));

  return res.status(200).json({
    rows,
    counts: {
      tracked: rows.filter(r => r.status !== 'nobase').length,
      short: rows.filter(r => r.status === 'short').length,
      over: rows.filter(r => r.status === 'over').length,
      pendingQty: rows.reduce((n, r) => n + r.pendingQty, 0),
    },
  });
}

async function handleGrowthInboundSave(userId: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body ?? {};
  const vendorItemId = String(b.vendorItemId ?? '').trim();
  if (!vendorItemId) return res.status(400).json({ error: '옵션을 지정해주세요.' });
  const kind = b.kind === 'baseline' ? 'baseline' : 'inbound';
  const dateOrNull = (v: any) => (typeof v === 'string' && INBOUND_DATE_RE.test(v) ? v : null);
  const qty = (v: any) => Math.max(0, Math.min(10_000_000, Math.round(Number(v) || 0)));
  const orderedAt = dateOrNull(b.orderedAt);
  const receivedAt = dateOrNull(b.receivedAt);
  const receivedQty = b.receivedQty === null || b.receivedQty === undefined || b.receivedQty === '' ? null : qty(b.receivedQty);

  if (kind === 'baseline') {
    if (!receivedAt || receivedQty === null) return res.status(400).json({ error: '기준일과 그날의 재고 수량이 필요합니다.' });
  } else if (!orderedAt && !receivedAt) {
    return res.status(400).json({ error: '주문일 또는 입고일이 필요합니다.' });
  }

  const row: any = {
    user_id: userId, vendor_item_id: vendorItemId, kind,
    ordered_at: orderedAt, ordered_qty: kind === 'baseline' ? 0 : qty(b.orderedQty),
    received_at: receivedAt, received_qty: receivedQty,
    memo: typeof b.memo === 'string' ? b.memo.slice(0, 200) : null,
    updated_at: new Date().toISOString(),
  };
  const id = typeof b.id === 'string' && b.id ? b.id : null;
  const q = id
    ? supabase!.from('coupang_growth_inbound').update(row).eq('id', id).eq('user_id', userId).select('id').maybeSingle()
    : supabase!.from('coupang_growth_inbound').insert(row).select('id').maybeSingle();
  const { data, error } = await q;
  if (error || !data) return res.status(500).json({ error: '저장하지 못했습니다.' });
  return res.status(200).json({ ok: true, id: String(data.id) });
}

async function handleGrowthInboundDelete(userId: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const id = String(req.body?.id ?? '').trim();
  if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
  const { error } = await supabase!.from('coupang_growth_inbound').delete().eq('id', id).eq('user_id', userId);
  if (error) return res.status(500).json({ error: '지우지 못했습니다.' });
  return res.status(200).json({ ok: true });
}

/** 주간 리포트에 붙일 품절 임박 목록 */
function stockTable(rows: InventoryRow[]): string {
  if (rows.length === 0) return '';
  const body = rows
    .map(r => {
      const left = r.risk === 'out' ? '품절' : `${Math.floor(r.daysLeft ?? 0)}일치`;
      return (
        `<tr><td style="padding:6px 0;color:#a8b3c9;font-size:12.5px;">${escapeHtml(r.productName).slice(0, 40)}</td>` +
        `<td style="padding:6px 0;text-align:right;color:#ffb454;font-size:12.5px;font-weight:600;">` +
        `${left}${r.reorderQty > 0 ? ` · ${r.reorderQty}개 발주 권장` : ''}</td></tr>`
      );
    })
    .join('');
  return `<p style="margin:18px 0 4px;color:#e8ecf5;font-size:13px;font-weight:600;">재고 부족</p><table style="width:100%;border-collapse:collapse;">${body}</table>`;
}

// ═══════════════════════════════════════════════════════════════
// [5] 반품 손실 분석
//
// 반품은 매출에서 빠지는 것으로 끝나지 않는다. 왕복 배송비가 나가고, 재판매가
// 안 되는 물건은 원가까지 통째로 날아간다. 그런데 쿠팡 화면은 반품을 건수로만
// 보여줘서 '얼마를 잃었는지'가 안 보인다.
//
// 반품률은 같은 기간 판매수량으로 나눈다. 건수만 보면 많이 파는 상품이 늘
// 나빠 보인다.
// ═══════════════════════════════════════════════════════════════

async function handleReturns(userId: string, req: VercelRequest, res: VercelResponse) {
  const { from, to } = rangeFromQuery(req);

  const [returnRes, salesRes, costRes, itemRes] = await Promise.all([
    selectAll((f, t) => supabase!
      .from('coupang_returns')
      .select('receipt_id, kind, vendor_item_id, product_name, quantity, reason, fault, status, requested_at')
      .eq('user_id', userId)
      .gte('requested_at', `${from}T00:00:00+09:00`)
      .lte('requested_at', `${to}T23:59:59+09:00`)
      .order('requested_at').range(f, t)),
    selectAll((f, t) => supabase!
      .from('coupang_sales_daily')
      .select('vendor_item_id, quantity, sales_amount')
      .eq('user_id', userId)
      .gte('sale_date', from)
      .lte('sale_date', to)
      .order('sale_date').range(f, t)),
    selectAll((f, t) => supabase!.from('coupang_costs').select('*').eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
    selectAll((f, t) => supabase!.from('coupang_items')
      .select('vendor_item_id, product_name, option_name').eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
  ]);

  const costs = new Map<string, any>();
  for (const c of costRes.rows) costs.set(String(c.vendor_item_id), c);
  const items = new Map<string, any>();
  for (const it of itemRes.rows) items.set(String(it.vendor_item_id), it);

  const soldQty = new Map<string, number>();
  for (const s of salesRes.rows) {
    const id = String(s.vendor_item_id);
    soldQty.set(id, (soldQty.get(id) ?? 0) + (Number(s.quantity) || 0));
  }

  interface ReturnAgg {
    vendorItemId: string;
    productName: string;
    optionName: string;
    count: number;
    quantity: number;
    soldQuantity: number;
    returnRate: number;
    shippingLoss: number;
    sellerFaultCount: number;
    topReason: string;
  }

  const agg = new Map<string, ReturnAgg & { reasons: Map<string, number> }>();
  const reasonTotals = new Map<string, number>();
  let sellerFaultTotal = 0;

  let cancelledCount = 0;
  let exchangeCount = 0;
  for (const r of returnRes.rows) {
    if (!isActiveReturn(r.status)) {
      cancelledCount++;
      continue;
    }
    if (r.kind === 'exchange') exchangeCount++;
    const id = String(r.vendor_item_id ?? '(미확인)');
    const item = items.get(id);
    const cur =
      agg.get(id) ??
      {
        vendorItemId: id,
        productName: r.product_name || item?.product_name || '(상품명 미확인)',
        optionName: item?.option_name ?? '',
        count: 0,
        quantity: 0,
        soldQuantity: soldQty.get(id) ?? 0,
        returnRate: 0,
        shippingLoss: 0,
        sellerFaultCount: 0,
        topReason: '',
        reasons: new Map<string, number>(),
      };

    cur.count += 1;
    cur.quantity += Number(r.quantity) || 1;

    const reason = String(r.reason || '사유 미기재').slice(0, 60);
    cur.reasons.set(reason, (cur.reasons.get(reason) ?? 0) + 1);
    reasonTotals.set(reason, (reasonTotals.get(reason) ?? 0) + 1);

    // 판매자 귀책이면 왕복 배송비를 판매자가 부담한다
    const fault = String(r.fault ?? '').toUpperCase();
    const sellerFault = fault.includes('COMPANY') || fault.includes('VENDOR') || fault.includes('SELLER');
    if (sellerFault) {
      cur.sellerFaultCount += 1;
      sellerFaultTotal += 1;
    }

    agg.set(id, cur);
  }

  const rows = [...agg.values()].map(a => {
    const cost = costs.get(a.vendorItemId);
    const perReturn = cost ? Number(cost.return_shipping_cost) || 0 : 0;
    const shippingLoss = a.count * perReturn;
    const topReason = [...a.reasons.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
    return {
      vendorItemId: a.vendorItemId,
      productName: a.productName,
      optionName: a.optionName,
      count: a.count,
      quantity: a.quantity,
      soldQuantity: a.soldQuantity,
      returnRate: a.soldQuantity > 0 ? (a.quantity / a.soldQuantity) * 100 : 0,
      shippingLoss,
      sellerFaultCount: a.sellerFaultCount,
      topReason,
      costEntered: perReturn > 0,
    };
  });

  // 손실이 큰 순 — 배송비를 안 넣었으면 건수 순으로 떨어진다
  rows.sort((a, b) => b.shippingLoss - a.shippingLoss || b.count - a.count);

  const totalCount = rows.reduce((n, r) => n + r.count, 0);
  const totalQuantity = rows.reduce((n, r) => n + r.quantity, 0);
  const totalLoss = rows.reduce((n, r) => n + r.shippingLoss, 0);
  const totalSold = [...soldQty.values()].reduce((n, q) => n + q, 0);

  const reasons = [...reasonTotals.entries()]
    .map(([reason, count]) => ({ reason, count, share: totalCount > 0 ? (count / totalCount) * 100 : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return res.status(200).json({
    from,
    to,
    rows,
    reasons,
    totals: {
      count: totalCount,
      quantity: totalQuantity,
      soldQuantity: totalSold,
      returnRate: totalSold > 0 ? (totalQuantity / totalSold) * 100 : 0,
      shippingLoss: totalLoss,
      sellerFaultCount: sellerFaultTotal,
      exchangeCount,
      cancelledCount,
    },
    missingReturnCost: rows.filter(r => !r.costEntered).length,
  });
}

// ═══════════════════════════════════════════════════════════════
// 쿠폰 효과 비교 — 어느 쿠폰 금액이 실제로 남았나
//
// 쿠폰 금액을 바꿔 가며 파는 건 그 자체로 실험이다. 그런데 결과가
// 어디에도 안 남아서, 판매자는 "11,500원이 나았던 것 같다"는 느낌만
// 갖고 다음 쿠폰을 정한다.
//
// 쿠폰마다 걸려 있던 기간이 곧 구간이다. 그 구간의 실적을 나란히 놓으면
// 답이 나온다. 다만 구간 길이가 제각각(3일 vs 20일)이라 총액을 그냥
// 비교하면 긴 구간이 무조건 이긴다. 하루 평균으로 환산해 비교한다.
// ═══════════════════════════════════════════════════════════════

/** 한 번에 계산할 구간 수. computeProfit이 구간마다 도니까 무한정 늘릴 수 없다 */
const COUPON_SEGMENT_MAX = 6;

interface CouponSegment {
  couponId: string;
  name: string;
  discount: number;
  type: string;
  start: string;
  end: string;
  days: number;
  quantity: number;
  salesAmount: number;
  profit: number;
  couponDiscount: number;
  /** 하루 평균 — 구간 길이가 달라서 이 값으로 비교해야 공정하다 */
  perDayQuantity: number;
  perDayProfit: number;
  /** 개당 순이익 */
  profitPerUnit: number;
  marginRate: number;
  /** 다른 쿠폰과 기간이 겹치는가 — 겹치면 이 구간의 실적은 그 쿠폰 것이기도 하다 */
  overlapped: boolean;
}

async function handleCouponEffect(userId: string, req: VercelRequest, res: VercelResponse) {
  const { from, to } = rangeFromQuery(req);

  const { rows: coupons } = await selectAll<{
    coupon_id: string; promotion_name: string | null; coupon_type: string | null;
    discount: number | null; start_at: string | null; end_at: string | null;
  }>((f, t) => supabase!
    .from('coupang_coupons')
    .select('coupon_id, promotion_name, coupon_type, discount, start_at, end_at')
    .eq('user_id', userId)
    .order('start_at', { ascending: false })
    .range(f, t));

  // 기간이 없는 쿠폰은 구간을 만들 수 없다. 조회 기간과 안 겹치는 것도 뺀다.
  const clipped = coupons
    .filter(c => c.start_at && c.end_at)
    .map(c => {
      const s = String(c.start_at).slice(0, 10);
      const e = String(c.end_at).slice(0, 10);
      return {
        couponId: String(c.coupon_id),
        name: c.promotion_name ?? '(이름 없는 쿠폰)',
        type: c.coupon_type ?? '',
        discount: Number(c.discount) || 0,
        start: s < from ? from : s,
        // 아직 안 끝난 쿠폰은 오늘까지만 본다. 미래 날짜를 넣으면 '하루 평균'의
        // 분모가 부풀어 성과가 실제보다 나빠 보인다.
        end: e > to ? to : e,
        rawStart: s,
        rawEnd: e,
      };
    })
    .filter(c => c.start <= c.end)
    .sort((a, b) => (a.start < b.start ? 1 : -1))
    .slice(0, COUPON_SEGMENT_MAX);

  if (clipped.length === 0) {
    return res.status(200).json({
      from, to, segments: [], best: null,
      reason: '이 기간에 걸려 있던 쿠폰이 없습니다. 쿠폰을 바꿔 가며 팔면 여기서 금액별 성과를 비교해 드립니다.',
    });
  }

  const segments: CouponSegment[] = [];
  for (const c of clipped) {
    const days = daysBetween(c.start, c.end) + 1;
    const p = await computeProfit(userId, c.start, c.end, { totalsOnly: true });
    const t = p.totals;
    segments.push({
      couponId: c.couponId,
      name: c.name,
      discount: c.discount,
      type: c.type,
      start: c.start,
      end: c.end,
      days,
      quantity: t.quantity,
      salesAmount: t.salesAmount,
      profit: t.profit,
      couponDiscount: t.couponDiscount,
      perDayQuantity: days > 0 ? t.quantity / days : 0,
      perDayProfit: days > 0 ? t.profit / days : 0,
      profitPerUnit: t.quantity > 0 ? t.profit / t.quantity : 0,
      marginRate: t.salesAmount > 0 ? (t.profit / t.salesAmount) * 100 : 0,
      overlapped: false,
    });
  }

  // 기간이 겹친 구간은 실적을 나눠 가진 것이라 단독 성과로 읽으면 안 된다
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[i].start <= segments[j].end && segments[j].start <= segments[i].end) {
        segments[i].overlapped = true;
        segments[j].overlapped = true;
      }
    }
  }

  // 판단 기준은 하루 평균 순이익이다. 총 순이익으로 고르면 오래 걸어 둔 쿠폰이
  // 무조건 이기고, 개당 순이익으로 고르면 쿠폰을 아예 안 준 구간이 이긴다
  // (많이 파는 것보다 비싸게 파는 쪽을 늘 고르게 된다).
  const comparable = segments.filter(s => s.quantity > 0 && !s.overlapped);
  const best = comparable.length >= 2
    ? [...comparable].sort((a, b) => b.perDayProfit - a.perDayProfit)[0]
    : null;

  return res.status(200).json({
    from,
    to,
    segments,
    best: best ? { couponId: best.couponId, name: best.name, discount: best.discount } : null,
    truncated: coupons.filter(c => c.start_at && c.end_at).length > COUPON_SEGMENT_MAX,
    note: comparable.length < 2
      ? '비교하려면 기간이 겹치지 않는 쿠폰 구간이 둘 이상 필요합니다.'
      : null,
  });
}

// ═══════════════════════════════════════════════════════════════
// 반품 사유 분석 — 무엇을 고치면 반품이 줄어드나
//
// 반품 목록은 이미 있지만 한 건씩 흩어져 있어 무엇을 고칠지는 안 보인다.
// 같은 상품에서 사이즈 얘기가 스무 번 나왔다면 그건 취향이 아니라 상세페이지에
// 실측 치수가 없다는 뜻이다.
//
// 분류는 규칙 기반이라 원가가 들지 않는다(src/lib/returnReasons.ts).
// ═══════════════════════════════════════════════════════════════

async function handleReturnReasons(userId: string, req: VercelRequest, res: VercelResponse) {
  const { from, to } = rangeFromQuery(req);

  const [rawReturnRes, salesRes] = await Promise.all([
    selectAll<{
      vendor_item_id: string | null; product_name: string | null;
      quantity: number | null; reason: string | null; fault: string | null;
      status: string | null;
    }>((f, t) => supabase!
      .from('coupang_returns')
      .select('vendor_item_id, product_name, quantity, reason, fault, status')
      .eq('user_id', userId)
      .gte('requested_at', `${from}T00:00:00+09:00`)
      .lte('requested_at', `${to}T23:59:59+09:00`)
      .order('requested_at').range(f, t)),
    selectAll<{ vendor_item_id: string; quantity: number }>((f, t) => supabase!
      .from('coupang_sales_daily')
      .select('vendor_item_id, quantity')
      .eq('user_id', userId)
      .gte('sale_date', from).lte('sale_date', to)
      .order('sale_date').range(f, t)),
  ]);

  // 고객이 철회한 반품은 빼고 센다. 반품 탭과 순이익 계산은 이미 빼고 있어,
  // 여기서만 세면 같은 기간 같은 상품이 두 화면에서 다른 건수로 보인다.
  // 이 숫자를 보고 상세페이지를 고치므로, 부풀려진 사유가 엉뚱한 수정을 부른다.
  const returnRows = rawReturnRes.rows.filter(r => isActiveReturn(r.status));
  const cancelledCount = rawReturnRes.rows.length - returnRows.length;
  const returnRes = { rows: returnRows };

  const overall = summarizeReturnReasons(returnRes.rows);

  // 상품별로 다시 센다. 전체 비율만 보면 "사이즈 30%"까지는 알아도
  // 어느 상품의 상세페이지를 고쳐야 하는지는 모른다.
  const soldByItem = new Map<string, number>();
  for (const s of salesRes.rows) {
    const k = String(s.vendor_item_id);
    soldByItem.set(k, (soldByItem.get(k) ?? 0) + (Number(s.quantity) || 0));
  }

  const byProduct = new Map<string, { name: string; items: Set<string>; rows: typeof returnRes.rows }>();
  for (const r of returnRes.rows) {
    const name = String(r.product_name ?? '이름 없는 상품');
    const cur = byProduct.get(name) ?? { name, items: new Set<string>(), rows: [] };
    if (r.vendor_item_id) cur.items.add(String(r.vendor_item_id));
    cur.rows.push(r);
    byProduct.set(name, cur);
  }

  const products = [...byProduct.values()]
    .map(p => {
      const s = summarizeReturnReasons(p.rows);
      const sold = [...p.items].reduce((n, id) => n + (soldByItem.get(id) ?? 0), 0);
      // 손댈 수 있는 유형 중 가장 많은 것 — 변심이 1위여도 그건 할 일이 아니다
      const top = s.categories.find(c => c.actionable) ?? null;
      return {
        productName: p.name,
        returnCount: s.total,
        returnQuantity: s.totalQuantity,
        sold,
        // 판매 표본이 적으면 비율이 튄다. 10개 팔아 1개 반품이 10%로 보이면
        // 멀쩡한 상품이 문제 상품으로 올라온다.
        returnRate: sold >= 10 ? s.totalQuantity / sold : null,
        sellerFault: s.sellerFault,
        topCategory: top ? { category: top.category, label: top.label, count: top.count, share: top.share, advice: top.advice } : null,
        categories: s.categories,
      };
    })
    .sort((a, b) => b.returnCount - a.returnCount)
    .slice(0, 10);

  const totalSold = [...soldByItem.values()].reduce((a, b) => a + b, 0);

  return res.status(200).json({
    from,
    to,
    total: overall.total,
    totalQuantity: overall.totalQuantity,
    sellerFault: overall.sellerFault,
    totalSold,
    returnRate: totalSold >= 10 ? overall.totalQuantity / totalSold : null,
    categories: overall.categories,
    /** 고객이 철회한 반품 — 빼고 셌다는 것을 화면에서도 밝힌다 */
    cancelledCount,
    products,
  });
}

// ═══════════════════════════════════════════════════════════════
// [6] 고객문의 AI 답변 초안
//
// 쿠팡은 문의 응답 시간을 판매자 점수에 반영한다. 그런데 문의 대부분은
// 배송·사이즈·재입고처럼 답이 정해진 것들이라 매번 처음부터 쓰는 게 낭비다.
//
// 원칙은 하나다 — 모델이 사실을 지어내지 않게 한다. 배송일·재고·정책처럼
// 우리가 모르는 값은 [대괄호] 자리표시자로 남기고 판매자가 채우게 한다.
// 초안은 저장만 하고, 실제 전송은 판매자가 확인한 뒤에만 일어난다.
// ═══════════════════════════════════════════════════════════════

const INQUIRY_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini';

const INQUIRY_SYSTEM_PROMPT = `당신은 쿠팡 판매자의 고객문의 답변을 대신 작성하는 CS 담당자입니다.

작성 규칙
1. 한국어 존댓말. 3~5문장. 인사와 마무리를 포함하되 장황하지 않게.
2. 확인되지 않은 사실을 절대 지어내지 마세요. 배송 예정일, 재고 수량, 교환·환불
   정책, 입고일처럼 주어지지 않은 정보는 [출고 예정일]처럼 대괄호 자리표시자로
   남기세요. 판매자가 채웁니다.
3. 사과가 필요한 상황이면 먼저 사과하고, 다음에 무엇을 할지 한 문장으로 말하세요.
4. 쿠팡 정책상 외부 연락처, 개인정보 요구, 다른 판매 채널 안내는 쓰지 마세요.
5. 답변 본문만 출력하세요. 제목이나 설명, 따옴표를 붙이지 마세요.`;

async function generateInquiryDraft(
  userId: string,
  productName: string,
  content: string,
): Promise<{ ok: boolean; draft?: string; error?: string }> {
  const apiKey = (process.env.OPENAIAPIKEY || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'OPENAIAPIKEY가 설정되지 않았습니다.' };

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: INQUIRY_MODEL,
        messages: [
          { role: 'system', content: INQUIRY_SYSTEM_PROMPT },
          { role: 'user', content: `[상품명]\n${productName || '(상품명 미확인)'}\n\n[고객 문의]\n${content}` },
        ],
        temperature: 0.4,
        max_tokens: 500,
      }),
    });
    const data: any = await r.json();
    if (!r.ok) return { ok: false, error: data?.error?.message || `초안 생성 실패 (HTTP ${r.status})` };

    const draft = String(data?.choices?.[0]?.message?.content ?? '').trim();
    if (!draft) return { ok: false, error: '초안이 비어 있습니다. 다시 시도해주세요.' };

    await logCoupangCost(userId, 'coupang-inquiry-draft', INQUIRY_MODEL, {
      inputTokens: data?.usage?.prompt_tokens,
      outputTokens: data?.usage?.completion_tokens,
    });
    return { ok: true, draft };
  } catch (e: any) {
    return { ok: false, error: e?.message || '초안 생성 실패' };
  }
}

/** AI 호출 원가 기록 — 관리자 비용 현황에 함께 집계된다 */
const INQUIRY_TOKEN_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10.0 },
};

async function logCoupangCost(
  userId: string,
  feature: string,
  model: string,
  opts: { inputTokens?: number; outputTokens?: number },
): Promise<void> {
  if (!supabase) return;
  const price = INQUIRY_TOKEN_PRICING[model];
  const inTok = Math.max(0, Number(opts.inputTokens) || 0);
  const outTok = Math.max(0, Number(opts.outputTokens) || 0);
  const cost = price ? (inTok * price.input + outTok * price.output) / 1_000_000 : 0;
  try {
    await supabase.from('api_calls').insert({
      user_id: userId,
      feature,
      model,
      input_tokens: inTok,
      output_tokens: outTok,
      cost_usd: cost,
    });
  } catch {
    /* 원가 기록 실패가 기능을 막지 않도록 */
  }
}

/** 기능별 일일 한도 — 다른 API와 같은 app_config를 읽는다 */
async function consumeQuota(
  userId: string, feature: string, fallback: number,
): Promise<{ ok: boolean; kind: QuotaDecision['kind']; remaining: number; limit: number }> {
  if (!supabase) return { ok: true, kind: 'ok', remaining: -1, limit: 0 };
  let limit = fallback;
  try {
    const { data } = await supabase.from('app_config').select('value').eq('key', 'feature_limits').maybeSingle();
    // 0은 사용 중지, 음수는 무제한 — 둘 다 살려서 넘긴다
    limit = parseLimits(data?.value)[feature] ?? fallback;
  } catch {
    /* 설정을 못 읽으면 기본값으로 간다 */
  }
  // 셈이 안 되면 내주지 않는다. 예전에는 rpc가 오류를 내면 ok를 돌려줘서,
  // 함수 이름이 바뀌거나 DB가 잠깐 붐비기만 해도 한도가 통째로 풀렸다.
  try {
    const rpc = await supabase.rpc('increment_feature_usage', {
      p_user_id: userId, p_date: kstToday(), p_feature: feature, p_limit: limit,
    });
    const d = decideQuota(limit, rpc);
    if (d.kind === 'error') {
      console.error('[한도] 집계 실패', { feature, userId, rpcError: String((rpc as any)?.error?.message ?? '') });
    }
    return { ok: d.allow, kind: d.kind, remaining: d.remaining ?? -1, limit };
  } catch (e: any) {
    console.error('[한도] 집계 예외', { feature, userId, detail: e?.message });
    return { ok: false, kind: 'error', remaining: -1, limit };
  }
}

// ── 문의 목록 ─────────────────────────────────────────────────
async function handleInquiries(userId: string, req: VercelRequest, res: VercelResponse) {
  const includeAnswered = String(req.query.all ?? '') === 'true';
  let query = supabase!
    .from('coupang_inquiries')
    .select('inquiry_id, vendor_item_id, product_name, content, customer_name, inquired_at, answered, draft, draft_at, replied_at')
    .eq('user_id', userId)
    .order('inquired_at', { ascending: false })
    .limit(200);
  if (!includeAnswered) query = query.eq('answered', false);

  const { data, error } = await query;
  if (error) { console.error('[쿠팡] 문의 조회 실패', { detail: error.message }); return res.status(500).json({ error: '문의를 불러오지 못했습니다.' }); }

  return res.status(200).json({
    inquiries: (data ?? []).map(q => ({
      inquiryId: String(q.inquiry_id),
      vendorItemId: q.vendor_item_id,
      productName: q.product_name ?? '',
      content: q.content ?? '',
      customerName: q.customer_name ?? '',
      inquiredAt: q.inquired_at,
      answered: Boolean(q.answered),
      draft: q.draft ?? null,
      draftAt: q.draft_at,
      repliedAt: q.replied_at,
    })),
  });
}

// ── 초안 생성 ─────────────────────────────────────────────────
async function handleInquiryDraft(userId: string, req: VercelRequest, res: VercelResponse) {
  const inquiryId = String(req.body?.inquiryId ?? '').trim();
  if (!inquiryId) return res.status(400).json({ error: '문의를 선택해주세요.' });

  const { data: q } = await supabase!
    .from('coupang_inquiries')
    .select('inquiry_id, product_name, content, answered')
    .eq('user_id', userId)
    .eq('inquiry_id', inquiryId)
    .maybeSingle();
  if (!q) return res.status(404).json({ error: '문의를 찾을 수 없습니다.' });
  if (q.answered) return res.status(400).json({ error: '이미 답변한 문의입니다.' });

  const quota = await consumeQuota(userId, 'inquiry', 60);
  if (!quota.ok) {
    // 한도 0은 내린 기능이다. "내일 다시" 오라고 하면 거짓말이 된다
    if (quota.kind === 'disabled') {
      return res.status(403).json({ error: '답변 초안은 현재 제공하지 않습니다.', disabled: true });
    }
    // 셈이 안 된 것은 사용자 잘못이 아니다. 그렇게 말해야 다시 눌러 본다.
    if (quota.kind === 'error') {
      return res.status(503).json({ error: '사용량을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.', retryable: true });
    }
    return res.status(429).json({ error: `답변 초안은 하루 ${quota.limit}건까지입니다. 내일 다시 이용해주세요.` });
  }

  const result = await generateInquiryDraft(userId, String(q.product_name ?? ''), String(q.content ?? ''));
  if (!result.ok) return res.status(502).json({ error: result.error });

  await supabase!
    .from('coupang_inquiries')
    .update({ draft: result.draft, draft_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('inquiry_id', inquiryId);

  return res.status(200).json({ ok: true, draft: result.draft, remaining: quota.remaining });
}

// ── 답변 전송 ─────────────────────────────────────────────────
// 판매자가 초안을 확인·수정한 뒤에만 호출된다. 고객에게 나가는 글이라
// AI가 만든 문장을 사람 확인 없이 보내지 않는다.
async function handleInquiryReply(userId: string, req: VercelRequest, res: VercelResponse) {
  const inquiryId = String(req.body?.inquiryId ?? '').trim();
  const content = String(req.body?.content ?? '').trim();
  if (!inquiryId || !content) return res.status(400).json({ error: '문의와 답변 내용이 필요합니다.' });
  if (content.length > 2000) return res.status(400).json({ error: '답변은 2000자까지 보낼 수 있습니다.' });

  const acc = await loadAccount(userId);
  if (!acc) return res.status(400).json({ error: '먼저 쿠팡 API 키를 등록해주세요.' });

  const { data: q } = await supabase!
    .from('coupang_inquiries')
    .select('inquiry_id, answered')
    .eq('user_id', userId)
    .eq('inquiry_id', inquiryId)
    .maybeSingle();
  if (!q) return res.status(404).json({ error: '문의를 찾을 수 없습니다.' });
  if (q.answered) return res.status(400).json({ error: '이미 답변한 문의입니다.' });

  const creds = credsOf(acc);
  const r = await coupangCallVersioned(
    creds,
    'POST',
    v => EP.inquiryReply(v, creds.vendorId, inquiryId),
    '',
    ['v5', 'v4'],
    'inquiryReply',
    { content, vendorId: creds.vendorId, replyBy: creds.vendorId },
  );

  if (!r.ok) {
    if (r.authFailed) await setAccountStatus(userId, 'invalid', '쿠팡이 키를 거부했습니다.');
    return res.status(502).json({ error: `쿠팡에 답변을 보내지 못했습니다: ${r.error}` });
  }

  await supabase!
    .from('coupang_inquiries')
    .update({ answered: true, replied_at: new Date().toISOString(), draft: content, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('inquiry_id', inquiryId);

  return res.status(200).json({ ok: true });
}

// ═══════════════════════════════════════════════════════════════
// [7] 순위와 판매의 상관 분석
//
// 훈프로에는 이미 순위 추적 이력이 쌓여 있고, 이제 실제 판매량도 있다. 둘을
// 붙이면 "이 키워드 순위 한 계단이 내 매출로 얼마인가"라는, 다른 도구가 못 주는
// 답이 나온다. 순위 추적은 노출상품ID 기준이고 주문은 옵션ID 기준이라
// 상품 마스터를 거쳐 연결한다.
//
// 통계를 함부로 말하지 않는다. 겹치는 날이 열흘이 안 되거나 순위가 거의
// 안 변했으면 상관을 계산하지 않고 "아직 판단할 수 없다"고 답한다.
// ═══════════════════════════════════════════════════════════════

const MIN_PAIRS_FOR_CORRELATION = 10;

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** ys = a + b·xs 의 기울기 b */
export function slope(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

// ── 내가 파는 상품 (상품 단위) ────────────────────────────────
//
// 순위는 옵션이 아니라 상품에 매겨진다. 그래서 순위를 보려는 화면은 옵션이 아니라
// 상품 목록이어야 한다. 옵션 20개짜리 상품이 목록에 20줄로 늘어서면 "어느 상품의
// 순위를 볼지" 고르는 일 자체가 어려워진다.
//
// 노출상품ID는 등록상품과 발주서 두 곳에서 모은다 — 상품 상세에 노출상품ID가 안
// 오는 계정이 있어 한쪽만 보면 연결이 끊긴다.
async function handleMyProducts(userId: string, req: VercelRequest, res: VercelResponse) {
  if (!supabase) return res.status(500).json({ error: 'Supabase가 설정되지 않았습니다.' });
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 180);
  const to = kstToday();
  const from = addDays(to, -(days - 1));

  const byProduct = new Map<string, { name: string; vendorItems: Set<string> }>();
  const link = (pid: any, vid: any, name?: any) => {
    const p = String(pid ?? '').trim();
    const v = String(vid ?? '').trim();
    if (!p || !v) return;
    const cur = byProduct.get(p) ?? { name: '', vendorItems: new Set<string>() };
    cur.vendorItems.add(v);
    if (!cur.name && name) cur.name = String(name);
    byProduct.set(p, cur);
  };

  const [itemRes, orderRes] = await Promise.all([
    selectAll<any>((f, t) => supabase!.from('coupang_items')
      .select('vendor_item_id, product_id, product_name').eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
    selectAll<any>((f, t) => supabase!.from('coupang_orders_daily')
      .select('vendor_item_id, product_id, product_name').eq('user_id', userId)
      .gte('order_date', from).order('order_date').range(f, t)),
  ]);
  for (const r of itemRes.rows) link(r.product_id, r.vendor_item_id, r.product_name);
  for (const r of orderRes.rows) link(r.product_id, r.vendor_item_id, r.product_name);

  if (byProduct.size === 0) {
    return res.status(200).json({
      from, to, products: [],
      reason: '노출상품ID를 아직 찾지 못했습니다. 수집이 끝난 뒤 다시 확인해주세요.',
    });
  }

  // 매출은 옵션 단위로 쌓이므로 상품 단위로 되접는다
  const allVids = [...new Set([...byProduct.values()].flatMap(v => [...v.vendorItems]))];
  const salesByVid = new Map<string, { qty: number; amount: number }>();
  const { rows: sales } = await selectAll<any>((f, t) => supabase!.from('coupang_sales_daily')
    .select('vendor_item_id, quantity, sales_amount').eq('user_id', userId)
    .gte('sale_date', from).lte('sale_date', to).order('sale_date').range(f, t));
  for (const r of sales) {
    const v = String(r.vendor_item_id);
    if (!allVids.includes(v)) continue;
    const cur = salesByVid.get(v) ?? { qty: 0, amount: 0 };
    cur.qty += Number(r.quantity) || 0;
    cur.amount += Number(r.sales_amount) || 0;
    salesByVid.set(v, cur);
  }

  const products = [...byProduct.entries()].map(([productId, v]) => {
    let qty = 0;
    let amount = 0;
    for (const vid of v.vendorItems) {
      const s = salesByVid.get(vid);
      if (s) { qty += s.qty; amount += s.amount; }
    }
    return {
      productId,
      productName: v.name || `상품 ${productId}`,
      optionCount: v.vendorItems.size,
      quantity: qty,
      salesAmount: amount,
    };
  });
  // 많이 파는 상품이 위로. 순위를 확인할 이유가 가장 큰 상품이다.
  products.sort((a, b) => b.salesAmount - a.salesAmount);

  return res.status(200).json({ from, to, days, products });
}

// ── 판매자 실측 비율 ──────────────────────────────────────────
//
// 소싱AI가 "이 가격에 팔면 원가가 얼마 이하여야 남나"에 답하려면 이 판매자의
// 수수료율·광고비율·반품률·쿠폰율이 필요하다. 업계 평균이 아니라 실적에서 뽑은
// 값이라야 공장에 부를 가격의 근거가 된다.
//
// 전부 '쿠폰을 뺀 실매출' 대비로 낸다. 쿠폰만 판매가 대비다 — 쿠폰은 판매가에서
// 먼저 빠지는 항목이라 기준이 다르다.
async function handleMyRates(userId: string, req: VercelRequest, res: VercelResponse) {
  const days = Math.min(Math.max(Number(req.query.days) || 60, 7), 180);
  const to = kstToday();
  const from = addDays(to, -(days - 1));

  const profit = await computeProfit(userId, from, to);
  const t = profit.totals;
  const sales = t.salesAmount;

  // 실적이 없으면 비율을 지어내지 않는다. 화면에서 "아직 계산할 수 없다"고 말해야 한다.
  if (sales <= 0) {
    return res.status(200).json({
      hasData: false,
      from, to,
      reason: '이 기간에 매출이 없어 비율을 계산할 수 없습니다. 수집이 끝난 뒤 다시 확인해주세요.',
    });
  }

  const couponTotal = profit.coupon?.sellerDiscount ?? 0;
  const netSales = Math.max(1, sales - couponTotal);

  // 광고비는 옵션에 붙은 몫과 캠페인 단위 몫을 합쳐야 실제 지출이 된다
  const adTotal = Math.max(profit.adCost?.total ?? 0, t.adCost);

  return res.status(200).json({
    hasData: true,
    from, to,
    rates: {
      // 수수료·광고비·반품은 실매출 대비
      commission: t.commission / netSales,
      ad: adTotal / netSales,
      returns: t.returnAmount / netSales,
      // 쿠폰만 판매가 대비 — 판매가에서 먼저 빠지는 항목이다
      coupon: couponTotal / sales,
      basis: {
        orders: t.quantity,
        salesAmount: sales,
        from, to,
      },
    },
    // 화면에서 근거를 밝히는 데 쓴다
    totals: {
      salesAmount: sales,
      netSales,
      commission: t.commission,
      adCost: adTotal,
      returnAmount: t.returnAmount,
      couponDiscount: couponTotal,
      quantity: t.quantity,
    },
  });
}

async function handleRankRevenue(userId: string, res: VercelResponse) {
  const today = kstToday();
  const from = addDays(today, -89);

  const { data: watches } = await supabase!
    .from('sourcing_rank_watch')
    .select('keyword, product_id, product_name')
    .eq('user_id', userId);

  if (!watches || watches.length === 0) {
    return res.status(200).json({ items: [], minPairs: MIN_PAIRS_FOR_CORRELATION, hint: 'no-watch' });
  }

  const productIds = [...new Set(watches.map(w => String(w.product_id)))];

  // 노출상품ID → 옵션ID 묶음 (주문은 옵션 단위로 쌓인다)
  const { rows: items } = await selectAll<{ vendor_item_id: string; product_id: string | null }>((f, t) =>
    supabase!
      .from('coupang_items')
      .select('vendor_item_id, product_id')
      .eq('user_id', userId)
      .in('product_id', productIds)
      .order('vendor_item_id').range(f, t));

  // 상품 상세에 노출상품ID가 없거나 아직 못 받았어도, 발주서에는 주문마다
  // 노출상품ID가 실려 온다. 두 경로를 합쳐야 연결이 끊기지 않는다.
  const { rows: orderLinks } = await selectAll<{ vendor_item_id: string; product_id: string | null }>((f, t) =>
    supabase!
      .from('coupang_orders_daily')
      .select('vendor_item_id, product_id')
      .eq('user_id', userId)
      .in('product_id', productIds)
      .gte('order_date', from)
      .order('order_date').range(f, t));

  const vendorItemsByProduct = new Map<string, string[]>();
  const addLink = (pid: string, vid: string) => {
    if (!pid || !vid) return;
    const list = vendorItemsByProduct.get(pid) ?? [];
    if (!list.includes(vid)) list.push(vid);
    vendorItemsByProduct.set(pid, list);
  };
  for (const it of items) addLink(String(it.product_id ?? ''), String(it.vendor_item_id));
  for (const o of orderLinks) addLink(String(o.product_id ?? ''), String(o.vendor_item_id));

  const allVendorItems = [...vendorItemsByProduct.values()].flat();

  // 순위 추적에는 소싱AI에서 담은 관심 상품이 함께 들어 있다. 이 화면은 "순위
  // 한 계단이 내 매출로 얼마인가"를 답하는 곳이라, 내가 팔지 않는 상품은
  // 답할 수 있는 질문 자체가 없다. 내 상품(등록상품이거나 주문이 있는 것)만 남긴다.
  const mine = watches.filter(w => vendorItemsByProduct.has(String(w.product_id)));
  if (mine.length === 0) {
    return res.status(200).json({ items: [], minPairs: MIN_PAIRS_FOR_CORRELATION, hint: 'no-own-product' });
  }

  // 판매는 두 곳에 나뉘어 있다. 발주서에는 윙만, 로켓그로스는 매출내역에 쌓인다.
  // 그로스만 파는 상품은 발주서에 한 줄도 없어, 발주서만 읽으면 "순위는 올랐는데
  // 하나도 안 팔렸다"는 결론이 나온다. 두 곳을 모두 읽어 같은 모양으로 맞춘다.
  const [rankRes, orderRes, growthRes] = await Promise.all([
    selectAll((f, t) => supabase!
      .from('sourcing_rank_obs')
      .select('keyword, product_id, rank, captured_at')
      .in('product_id', productIds)
      .gte('captured_at', `${from}T00:00:00+09:00`)
      .order('captured_at').range(f, t)),
    allVendorItems.length > 0
      ? selectAll((f, t) => supabase!
          .from('coupang_orders_daily')
          .select('vendor_item_id, order_date, quantity, order_amount')
          .eq('user_id', userId)
          .in('vendor_item_id', allVendorItems)
          .gte('order_date', from)
          .order('order_date').range(f, t))
      : Promise.resolve({ rows: [] as any[], truncated: false }),
    allVendorItems.length > 0
      ? selectAll((f, t) => supabase!
          .from('coupang_sales_daily')
          .select('vendor_item_id, sale_date, quantity, sales_amount')
          .eq('user_id', userId)
          .eq('channel', 'growth')
          .in('vendor_item_id', allVendorItems)
          .gte('sale_date', from)
          .order('sale_date').range(f, t))
      : Promise.resolve({ rows: [] as any[], truncated: false }),
  ]);

  // 발주서와 같은 열 이름으로 바꿔 한 줄기로 흘려보낸다
  const salesRows = [
    ...orderRes.rows,
    ...growthRes.rows.map((g: any) => ({
      vendor_item_id: g.vendor_item_id,
      order_date: g.sale_date,
      quantity: g.quantity,
      order_amount: g.sales_amount,
    })),
  ];

  // 하루에 여러 번 수집될 수 있으므로 날짜별 평균 순위를 쓴다
  const rankByKey = new Map<string, Map<string, { sum: number; n: number }>>();
  for (const o of rankRes.rows) {
    if (o.rank === null || o.rank === undefined) continue; // 60위 밖은 순위값이 없다
    const key = `${o.keyword}::${o.product_id}`;
    const day = String(o.captured_at).slice(0, 10);
    const perDay = rankByKey.get(key) ?? new Map();
    const cur = perDay.get(day) ?? { sum: 0, n: 0 };
    cur.sum += Number(o.rank);
    cur.n += 1;
    perDay.set(day, cur);
    rankByKey.set(key, perDay);
  }

  const ordersByProduct = new Map<string, Map<string, { qty: number; amount: number }>>();
  const productOfVendorItem = new Map<string, string>();
  for (const [pid, vids] of vendorItemsByProduct) for (const v of vids) productOfVendorItem.set(v, pid);

  // 주문 수집이 실제로 닿은 첫날. 순위는 90일치가 있는데 주문은 30일치뿐이라,
  // 그 앞 구간의 '주문 없음'을 판매 0으로 읽으면 상관이 통째로 거짓이 된다.
  // 갓 연동한 사용자일수록 과거 순위가 나빴으므로, 없는 데이터가 "순위가
  // 좋아져서 팔렸다"는 결론을 만들어 낸다. 판매 0으로 셀 수 있는 날은
  // 주문 수집이 닿은 구간 안쪽뿐이다.
  let orderCoverageStart: string | null = null;
  for (const o of salesRows) {
    const d = String(o.order_date);
    if (orderCoverageStart === null || d < orderCoverageStart) orderCoverageStart = d;
  }

  for (const o of salesRows) {
    const pid = productOfVendorItem.get(String(o.vendor_item_id));
    if (!pid) continue;
    const day = String(o.order_date);
    const perDay = ordersByProduct.get(pid) ?? new Map();
    const cur = perDay.get(day) ?? { qty: 0, amount: 0 };
    cur.qty += Number(o.quantity) || 0;
    cur.amount += Number(o.order_amount) || 0;
    perDay.set(day, cur);
    ordersByProduct.set(pid, perDay);
  }

  const results = mine.map(w => {
    const key = `${w.keyword}::${w.product_id}`;
    const rankDays = rankByKey.get(key) ?? new Map();
    const orderDays = ordersByProduct.get(String(w.product_id)) ?? new Map();

    const days = [...new Set([...rankDays.keys(), ...orderDays.keys()])]
      .filter(d => orderCoverageStart === null || d >= orderCoverageStart)
      .sort();
    const series = days.map(d => {
      const r = rankDays.get(d);
      const o = orderDays.get(d);
      return {
        date: d,
        rank: r ? Math.round((r.sum / r.n) * 10) / 10 : null,
        quantity: o?.qty ?? 0,
        amount: o?.amount ?? 0,
      };
    });

    // 상관은 순위가 있고, 주문 수집이 닿은 구간 안쪽인 날만 쓴다
    const paired = series.filter(
      p => p.rank !== null && orderCoverageStart !== null && p.date >= orderCoverageStart,
    );
    const xs = paired.map(p => p.rank as number);
    const ys = paired.map(p => p.quantity);

    const hasOrders = allVendorItems.length > 0 && ordersByProduct.has(String(w.product_id));
    let status: 'ok' | 'few-days' | 'flat-rank' | 'no-orders' = 'ok';
    if (!hasOrders) status = 'no-orders';
    else if (paired.length < MIN_PAIRS_FOR_CORRELATION) status = 'few-days';

    const r = status === 'ok' ? pearson(xs, ys) : null;
    const b = status === 'ok' ? slope(xs, ys) : null;
    if (status === 'ok' && r === null) status = 'flat-rank';

    const totalQty = ys.reduce((a, c) => a + c, 0);
    const totalAmount = paired.reduce((a, c) => a + c.amount, 0);
    const avgPrice = totalQty > 0 ? totalAmount / totalQty : 0;

    // 기울기는 보통 음수다(순위 숫자가 작아질수록 많이 팔린다).
    // 한 계단 '개선' 효과로 뒤집어 보여준다.
    const perStepQty = b === null ? null : -b;
    const weeklyRevenuePerStep = perStepQty === null ? null : perStepQty * 7 * avgPrice;

    return {
      keyword: String(w.keyword),
      productId: String(w.product_id),
      productName: String(w.product_name ?? ''),
      status,
      days: paired.length,
      correlation: r,
      perStepQty,
      weeklyRevenuePerStep,
      avgPrice,
      latestRank: [...rankDays.keys()].sort().slice(-1).map(d => {
        const v = rankDays.get(d)!;
        return Math.round((v.sum / v.n) * 10) / 10;
      })[0] ?? null,
      series,
    };
  });

  // 신호가 뚜렷한 것부터
  results.sort((a, b) => Math.abs(b.correlation ?? 0) - Math.abs(a.correlation ?? 0));

  return res.status(200).json({ items: results, minPairs: MIN_PAIRS_FOR_CORRELATION });
}

// ═══════════════════════════════════════════════════════════════
// [9] 마진 하한 가격 조정
//
// 판매자 돈이 직접 움직이는 기능이라 설계 원칙이 다르다.
//  · 기본은 '제안'이다. 자동 반영은 옵션별로 따로 켜야 한다.
//  · 어떤 경우에도 마진 하한 아래로는 내리지 않는다. 하한은 원가와 그 상품의
//    실제 수수료율에서 역산한다. 고정 수수료율을 가정하면 카테고리에 따라
//    적자를 낸다.
//  · 자동 반영은 하루 변동폭을 제한한다. 잘못된 경쟁가 한 번이 가격을
//    무너뜨리지 않게 하기 위해서다.
//
// 경쟁가는 새로 긁지 않는다. 소싱AI가 이미 모아 둔 관측치(sourcing_product_obs)의
// 중앙값을 쓴다. 여기서 Bright Data를 다시 호출하면 사용자당 월 비용이 붙는다.
// ═══════════════════════════════════════════════════════════════

const DEFAULT_COMMISSION_RATE = COUPANG_FEE_RATE_PCT; // 그 상품의 실적으로 못 구할 때만 쓰는 대략치 (부가세 포함)
const AUTO_APPLY_MAX_CHANGE_PCT = 10;      // 자동 반영 시 하루 변동 한도
const AUTO_APPLY_MAX_WEEKLY_PCT = 20;      // 자동 반영 7일 누적 한도 — 틀린 시장가가 며칠 이어져도 여기서 멈춘다

/** 쿠팡에서 지금 이 순간의 판매가를 읽는다. 로컬 사본은 며칠 묵었을 수 있다. */
async function fetchLivePrice(creds: CoupangCreds, vendorItemId: string): Promise<number | null> {
  const r = await coupangCall(creds, 'GET', EP.vendorItemInventory(vendorItemId), '');
  if (!r.ok) return null;
  const d = (r.data as any)?.data ?? r.data;
  const price = pickNum(d, ['salePrice', 'price'], 0);
  return price > 0 ? price : null;
}

export function median(nums: number[]): number | null {
  const xs = nums.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

/** 원가와 수수료율을 지키면서 목표 이익률을 내는 최저 판매가 */
export function floorPriceFor(unitCost: number, commissionRate: number, targetMarginRate: number): number | null {
  // price × (1 − 수수료율 − 목표이익률) = 원가
  const denom = 1 - commissionRate / 100 - targetMarginRate / 100;
  if (denom <= 0) return null; // 수수료와 목표 이익률만으로 100%를 넘으면 성립하지 않는다
  return Math.ceil(unitCost / denom);
}

interface PriceSuggestion {
  vendorItemId: string;
  productName: string;
  optionName: string;
  currentPrice: number | null;
  unitCost: number;
  commissionRate: number;
  floorPrice: number | null;
  marketPrice: number | null;
  suggestedPrice: number | null;
  reason: string;
  belowFloor: boolean;
  enabled: boolean;
  autoApply: boolean;
  minMarginRate: number;
  minPrice: number | null;
  maxPrice: number | null;
  targetKeyword: string | null;
  costEntered: boolean;
}

async function buildPriceSuggestions(userId: string): Promise<PriceSuggestion[]> {
  if (!supabase) return [];

  const today = kstToday();
  const [itemRes, costRes, ruleRes, salesRes] = await Promise.all([
    selectAll((f, t) => supabase.from('coupang_items')
      .select('vendor_item_id, product_name, option_name, sale_price').eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
    selectAll((f, t) => supabase.from('coupang_costs').select('*').eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
    selectAll((f, t) => supabase.from('coupang_price_rules').select('*').eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
    selectAll((f, t) => supabase
      .from('coupang_sales_daily')
      .select('vendor_item_id, sales_amount, commission, settlement_amount')
      .eq('user_id', userId)
      .gte('sale_date', addDays(today, -30))
      .order('sale_date').range(f, t)),
  ]);

  const costs = new Map<string, any>();
  for (const c of costRes.rows) costs.set(String(c.vendor_item_id), c);
  const rules = new Map<string, any>();
  for (const r of ruleRes.rows) rules.set(String(r.vendor_item_id), r);

  // 상품별 실제 수수료율 — 카테고리마다 달라 고정값을 쓰면 적자가 난다.
  //
  // 분모는 주문금액이 아니라 '쿠폰을 뺀 실결제액'이다. 쿠팡은 쿠폰을 뺀 금액에
  // 수수료를 매기므로, 주문금액으로 나누면 즉시할인쿠폰을 많이 쓰는 상품일수록
  // 수수료율이 실제보다 낮게 나온다(11.88%가 6.96%로 보이던 이유다). 그 낮은
  // 값으로 최저 판매가를 잡으면 그대로 적자가 된다.
  //
  // 실결제액은 정산예정액 + 수수료로 되찾는다. 두 값 모두 쿠폰을 이미 반영한
  // 값이라 윙과 그로스가 같은 식으로 풀린다.
  const feeAgg = new Map<string, { net: number; fee: number }>();
  for (const s of salesRes.rows) {
    const id = String(s.vendor_item_id);
    const fee = Number(s.commission) || 0;
    const settlement = Number(s.settlement_amount) || 0;
    // 정산예정액이 아직 없는 옛 행은 주문금액으로 되돌아간다 — 낮게 나오더라도
    // 0으로 나누는 것보다는 낫다.
    const net = settlement > 0 ? settlement + fee : Number(s.sales_amount) || 0;
    const cur = feeAgg.get(id) ?? { net: 0, fee: 0 };
    cur.net += net;
    cur.fee += fee;
    feeAgg.set(id, cur);
  }

  // 규칙에 걸린 키워드들의 시장가를 한 번에 모은다
  const keywords = [...new Set(ruleRes.rows.map((r: any) => String(r.target_keyword ?? '')).filter(Boolean))];
  const marketByKeyword = new Map<string, number>();
  if (keywords.length > 0) {
    const { rows: obs } = await selectAll<{ keyword: string; price: number }>((f, t) => supabase
      .from('sourcing_product_obs')
      .select('keyword, price')
      .in('keyword', keywords)
      .gte('captured_at', `${addDays(today, -14)}T00:00:00+09:00`)
      .order('captured_at').range(f, t));
    const grouped = new Map<string, number[]>();
    for (const o of obs) {
      const k = String(o.keyword);
      const list = grouped.get(k) ?? [];
      list.push(Number(o.price) || 0);
      grouped.set(k, list);
    }
    for (const [k, prices] of grouped) {
      const m = median(prices);
      if (m !== null) marketByKeyword.set(k, m);
    }
  }

  const out: PriceSuggestion[] = [];
  for (const it of itemRes.rows) {
    const id = String(it.vendor_item_id);
    const rule = rules.get(id);
    const cost = costs.get(id);
    const unitCost =
      (Number(cost?.unit_cost) || 0) + (Number(cost?.packaging_cost) || 0) + (Number(cost?.shipping_cost) || 0)
      + (Number(cost?.fulfillment_cost) || 0);
    const costEntered = unitCost > 0;

    const fee = feeAgg.get(id);
    const commissionRate =
      fee && fee.net > 0 && fee.fee > 0
        ? Math.min(40, (fee.fee / fee.net) * 100)
        : DEFAULT_COMMISSION_RATE;

    const minMarginRate = Number(rule?.min_margin_rate ?? 10);
    const floor = costEntered ? floorPriceFor(unitCost, commissionRate, minMarginRate) : null;
    const currentPrice = it.sale_price === null || it.sale_price === undefined ? null : Number(it.sale_price);
    const keyword = rule?.target_keyword ? String(rule.target_keyword) : null;
    const marketPrice = keyword ? marketByKeyword.get(keyword) ?? null : null;

    const minPrice = rule?.min_price === null || rule?.min_price === undefined ? null : Number(rule.min_price);
    const maxPrice = rule?.max_price === null || rule?.max_price === undefined ? null : Number(rule.max_price);

    let suggested: number | null = null;
    let reason = '';
    const belowFloor = Boolean(floor && currentPrice !== null && currentPrice < floor);

    if (!costEntered) {
      reason = '원가를 입력해야 하한가를 계산할 수 있습니다.';
    } else if (currentPrice === null) {
      reason = '현재 판매가를 아직 수집하지 못했습니다.';
    } else if (belowFloor) {
      suggested = floor;
      reason = `현재가가 마진 하한(${minMarginRate}%)을 못 지킵니다. 지금은 팔수록 손해입니다.`;
    } else if (marketPrice !== null && floor !== null) {
      // 시장가보다 비싸면 시장가까지 내려 보되 하한은 절대 안 넘는다
      const target = Math.max(floor, marketPrice);
      if (currentPrice > marketPrice && target < currentPrice) {
        suggested = target;
        reason = `시장 중앙값(${won(marketPrice)})보다 높습니다. 하한을 지키는 선까지 내릴 수 있습니다.`;
      } else if (currentPrice < marketPrice * 0.9) {
        suggested = Math.min(maxPrice ?? Number.MAX_SAFE_INTEGER, Math.round(marketPrice * 0.95));
        reason = `시장 중앙값(${won(marketPrice)})보다 크게 쌉니다. 올려도 팔릴 여지가 있습니다.`;
      } else {
        reason = '시장가와 하한 사이에 있습니다. 바꿀 이유가 없습니다.';
      }
    } else {
      reason = keyword ? '이 키워드의 시장가 관측치가 아직 없습니다.' : '비교할 키워드를 지정하면 시장가와 견줍니다.';
    }

    // 사용자가 정한 절대 상·하한을 마지막에 다시 씌운다
    if (suggested !== null) {
      if (minPrice !== null) suggested = Math.max(suggested, minPrice);
      if (maxPrice !== null) suggested = Math.min(suggested, maxPrice);
      if (floor !== null) suggested = Math.max(suggested, floor);
      if (suggested === currentPrice) suggested = null;
    }

    out.push({
      vendorItemId: id,
      productName: it.product_name ?? '',
      optionName: it.option_name ?? '',
      currentPrice,
      unitCost,
      commissionRate,
      floorPrice: floor,
      marketPrice,
      suggestedPrice: suggested,
      reason,
      belowFloor,
      enabled: rule ? Boolean(rule.enabled) : true,
      autoApply: Boolean(rule?.auto_apply),
      minMarginRate,
      minPrice,
      maxPrice,
      targetKeyword: keyword,
      costEntered,
    });
  }

  // 적자 판매 중인 것부터, 그다음 제안이 있는 것
  out.sort((a, b) => {
    if (a.belowFloor !== b.belowFloor) return a.belowFloor ? -1 : 1;
    const as = a.suggestedPrice === null ? 1 : 0;
    const bs = b.suggestedPrice === null ? 1 : 0;
    return as - bs;
  });

  return out;
}

async function handlePriceRules(userId: string, res: VercelResponse) {
  const suggestions = await buildPriceSuggestions(userId);
  const { data: logs } = await supabase!
    .from('coupang_price_logs')
    .select('vendor_item_id, old_price, new_price, reason, applied, error, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30);
  return res.status(200).json({
    rows: suggestions,
    logs: logs ?? [],
    autoApplyMaxChangePct: AUTO_APPLY_MAX_CHANGE_PCT,
  });
}

async function handlePriceRuleSave(userId: string, req: VercelRequest, res: VercelResponse) {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: '저장할 규칙이 없습니다.' });
  if (items.length > 1000) return res.status(400).json({ error: '한 번에 1000건까지 저장할 수 있습니다.' });

  const rows = items
    .filter((it: any) => it?.vendorItemId)
    .map((it: any) => ({
      user_id: userId,
      vendor_item_id: String(it.vendorItemId),
      enabled: it.enabled !== false,
      auto_apply: it.autoApply === true,
      min_margin_rate: Math.min(90, Math.max(0, Number(it.minMarginRate) || 0)),
      min_price: it.minPrice === null || it.minPrice === undefined || it.minPrice === '' ? null : Math.max(0, Math.round(Number(it.minPrice) || 0)),
      max_price: it.maxPrice === null || it.maxPrice === undefined || it.maxPrice === '' ? null : Math.max(0, Math.round(Number(it.maxPrice) || 0)),
      target_keyword: typeof it.targetKeyword === 'string' && it.targetKeyword.trim() ? it.targetKeyword.trim().slice(0, 60) : null,
      updated_at: new Date().toISOString(),
    }));

  const err = await upsertChunked('coupang_price_rules', rows, 'user_id,vendor_item_id');
  if (err) return res.status(500).json({ error: `저장 실패: ${err}` });
  return res.status(200).json({ ok: true, saved: rows.length });
}

/** 실제 가격 반영 — 하한을 서버에서 다시 검증한 뒤에만 쿠팡으로 보낸다 */
async function applyPrice(
  userId: string,
  creds: CoupangCreds,
  vendorItemId: string,
  newPrice: number,
  reason: string,
  /** 자동 반영처럼 방금 계산한 제안이 있으면 넘겨 재계산을 피한다.
      수동 경로는 넘기지 않아 서버가 직접 다시 계산·검증한다. */
  precomputed?: PriceSuggestion,
  opts: { auto?: boolean; expectedCurrentPrice?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const target =
    precomputed ?? (await buildPriceSuggestions(userId)).find(s => s.vendorItemId === vendorItemId);
  if (!target) return { ok: false, error: '상품을 찾을 수 없습니다.' };

  // 반영 직전에 쿠팡에서 현재가를 다시 읽는다. 로컬 사본은 상세를 마지막으로
  // 받은 시점의 값이라 며칠 묵었을 수 있고, 그 사이 판매자가 윙에서 직접 올린
  // 가격을 기준으로 '5% 변동'이라 계산해 실제로는 30% 인하를 내보낼 수 있다.
  const livePrice = await fetchLivePrice(creds, vendorItemId);
  if (livePrice === null) {
    return { ok: false, error: '쿠팡에서 현재 판매가를 확인하지 못해 변경하지 않았습니다. 잠시 후 다시 시도해주세요.' };
  }
  if (livePrice !== target.currentPrice) {
    await supabase!
      .from('coupang_items')
      .update({ sale_price: livePrice })
      .eq('user_id', userId)
      .eq('vendor_item_id', vendorItemId);
  }
  // 화면이 알고 있던 현재가와 다르면 사용자가 본 제안이 더는 유효하지 않다
  if (opts.expectedCurrentPrice !== undefined && opts.expectedCurrentPrice !== livePrice) {
    return {
      ok: false,
      error: `현재가가 ${won(livePrice)}로 바뀌어 있습니다. 화면을 새로고침한 뒤 다시 확인해주세요.`,
    };
  }
  const changePct = Math.abs((newPrice - livePrice) / livePrice) * 100;
  if (opts.auto) {
    if (changePct > AUTO_APPLY_MAX_CHANGE_PCT) {
      return { ok: false, error: `하루 변동 한도(${AUTO_APPLY_MAX_CHANGE_PCT}%)를 넘어 자동 반영하지 않았습니다.` };
    }
    // 7일 누적 — 잘못된 시장가 하나가 아니라, 잘못된 시장가가 일주일 이어지는 경우를 막는다
    const { data: recent } = await supabase!
      .from('coupang_price_logs')
      .select('old_price, created_at')
      .eq('user_id', userId)
      .eq('vendor_item_id', vendorItemId)
      .eq('applied', true)
      .like('reason', '자동 반영%')
      .gte('created_at', new Date(Date.now() - 7 * 86400_000).toISOString())
      .order('created_at', { ascending: true })
      .limit(1);
    const base = Number(recent?.[0]?.old_price) || livePrice;
    if (Math.abs((newPrice - base) / base) * 100 > AUTO_APPLY_MAX_WEEKLY_PCT) {
      return { ok: false, error: `7일 누적 변동 한도(${AUTO_APPLY_MAX_WEEKLY_PCT}%)를 넘어 자동 반영하지 않았습니다.` };
    }
  }
  if (newPrice === livePrice) return { ok: true };
  target.currentPrice = livePrice;

  // 화면이 보낸 값을 그대로 믿지 않는다. 하한 검증을 서버에서 다시 한다.
  if (target.floorPrice !== null && newPrice < target.floorPrice) {
    return { ok: false, error: `마진 하한가(${won(target.floorPrice)}) 아래로는 변경할 수 없습니다.` };
  }
  if (target.minPrice !== null && newPrice < target.minPrice) {
    return { ok: false, error: `설정한 하한가(${won(target.minPrice)}) 아래입니다.` };
  }
  if (target.maxPrice !== null && newPrice > target.maxPrice) {
    return { ok: false, error: `설정한 상한가(${won(target.maxPrice)}) 위입니다.` };
  }

  // 쿠팡은 변동 비율이 크면 기본적으로 거부한다. 사람이 확인하고 누른 수동 반영은
  // 강제 플래그를 붙여 통과시키고, 자동 반영은 한도 안에서만 움직이므로 붙이지 않는다.
  const r = await coupangCall(
    creds, 'PUT',
    EP.vendorItemPrice(vendorItemId, Math.round(newPrice)),
    opts.auto ? '' : 'forceSalePriceUpdate=true',
  );

  await supabase!.from('coupang_price_logs').insert({
    user_id: userId,
    vendor_item_id: vendorItemId,
    old_price: target.currentPrice,
    new_price: Math.round(newPrice),
    reason,
    applied: r.ok,
    error: r.ok ? null : String(r.error ?? '').slice(0, 300),
  });

  if (!r.ok) {
    if (r.authFailed) await setAccountStatus(userId, 'invalid', '쿠팡이 키를 거부했습니다.');
    return { ok: false, error: r.error };
  }

  // 화면이 바로 새 가격을 보도록 로컬 값도 갱신한다
  await supabase!
    .from('coupang_items')
    .update({ sale_price: Math.round(newPrice) })
    .eq('user_id', userId)
    .eq('vendor_item_id', vendorItemId);
  await supabase!
    .from('coupang_price_rules')
    .update({ last_applied_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('vendor_item_id', vendorItemId);

  return { ok: true };
}

async function handlePriceApply(userId: string, req: VercelRequest, res: VercelResponse) {
  const vendorItemId = String(req.body?.vendorItemId ?? '').trim();
  const price = Math.round(Number(req.body?.price) || 0);
  if (!vendorItemId || price <= 0) return res.status(400).json({ error: '상품과 가격이 필요합니다.' });

  const acc = await loadAccount(userId);
  if (!acc) return res.status(400).json({ error: '먼저 쿠팡 API 키를 등록해주세요.' });

  const expected = req.body?.expectedCurrentPrice;
  const result = await applyPrice(userId, credsOf(acc), vendorItemId, price, '수동 반영', undefined, {
    expectedCurrentPrice: Number.isFinite(Number(expected)) ? Math.round(Number(expected)) : undefined,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.status(200).json({ ok: true });
}

/**
 * 자동 반영 — 옵션별로 따로 켠 것만, 하루 변동폭 안에서만 움직인다.
 * 잘못된 경쟁가 한 번이 가격을 무너뜨리지 않게 하기 위한 제동장치다.
 */
async function runAutoPricing(userId: string, creds: CoupangCreds): Promise<{ applied: number; skipped: number }> {
  const suggestions = await buildPriceSuggestions(userId);
  let applied = 0;
  let skipped = 0;

  for (const s of suggestions) {
    if (!s.autoApply || !s.enabled || s.suggestedPrice === null || s.currentPrice === null) continue;

    // 변동폭 검사는 applyPrice가 쿠팡에서 읽은 실시간 가격으로 한다
    const r = await applyPrice(userId, creds, s.vendorItemId, s.suggestedPrice, `자동 반영 · ${s.reason}`, s, { auto: true });
    if (r.ok) applied++;
    else skipped++;
  }

  return { applied, skipped };
}

// ═══════════════════════════════════════════════════════════════
// 관리자: 연동 현황
//
// 몇 명이 연결했고 누구 수집이 멈춰 있는지 볼 곳이 없으면 문의가 와야 안다.
// 계정 상태별 인원, 최근 실패, 오래 안 돈 계정을 한 화면에 모은다.
// ═══════════════════════════════════════════════════════════════
async function handleAdminOverview(decoded: any, res: VercelResponse) {
  if (!decoded?.isAdmin) return res.status(403).json({ error: '관리자만 볼 수 있습니다.' });

  const { rows: accounts } = await selectAll<any>((f, t) => supabase!
    .from('coupang_accounts')
    .select('user_id, vendor_id, status, last_sync_at, last_sync_error, backfill_done, key_expires_at, created_at, users(name, email)')
    .order('user_id').range(f, t));

  const rows = accounts;
  const now = Date.now();
  const staleMs = 26 * 3600_000; // 매시 크론이 20시간 기준으로 도니, 26시간 넘게 안 돌았으면 이상하다

  const counts = { total: rows.length, active: 0, invalid: 0, expired: 0, stale: 0, backfilling: 0, expiringSoon: 0 };
  const list = rows.map(a => {
    const lastSync = a.last_sync_at ? new Date(a.last_sync_at).getTime() : null;
    const stale = a.status === 'active' && (lastSync === null || now - lastSync > staleMs);
    const left = daysToExpiry(a.key_expires_at);
    if (a.status === 'active') counts.active++;
    if (a.status === 'invalid') counts.invalid++;
    if (a.status === 'expired') counts.expired++;
    if (stale) counts.stale++;
    if (a.status === 'active' && !a.backfill_done) counts.backfilling++;
    if (left !== null && left <= 14) counts.expiringSoon++;
    return {
      userId: a.user_id,
      name: a.users?.name ?? '',
      email: a.users?.email ?? '',
      vendorId: a.vendor_id,
      status: a.status,
      lastSyncAt: a.last_sync_at,
      lastSyncError: a.last_sync_error,
      backfillDone: Boolean(a.backfill_done),
      daysToExpiry: left,
      stale,
      connectedAt: a.created_at,
    };
  });

  // 문제 있는 계정이 위로 오게
  list.sort((x, y) => {
    const score = (r: typeof x) => (r.status !== 'active' ? 0 : r.stale ? 1 : r.lastSyncError ? 2 : 3);
    return score(x) - score(y);
  });

  return res.status(200).json({
    counts,
    accounts: list,
    relayConfigured: Boolean(RELAY_URL),
    relayIp: process.env.COUPANG_RELAY_IP || null,
  });
}
