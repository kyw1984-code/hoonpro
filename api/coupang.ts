import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
// ESM이라 상대 경로 import에는 확장자가 필요하다. 빠지면 함수가 통째로 죽는다.
import { tabDisabledMessage } from '../lib/feature-gate.js';
import * as XLSX from 'xlsx';
import { extractDailyAdCost, extractItemAdCost, rowsFromMatrix } from '../src/lib/adcost.js';

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
  let last: CoupangResult<T> | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(600 * attempt);
    const r = await coupangCallOnce<T>(creds, method, path, query, body);
    if (r.ok || method !== 'GET' || !isTransient(r)) return r;
    last = r;
  }
  return last!;
}

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
  rgChunkDays: 30,         // 로켓그로스는 한 번에 30일까지만 조회된다
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
  errors: string[];
  authFailed: boolean;
  /** 시간 예산에 걸려 중간에 멈췄다. 남은 몫은 다음 회차가 이어받는다. */
  truncated: boolean;
}

function emptySummary(): SyncSummary {
  return {
    items: 0, orders: 0, sales: 0, growth: 0, growthCancelled: 0, growthInventory: 0, settlements: 0, returns: 0, inquiries: 0, couponDefs: 0,
    errors: [], authFailed: false, truncated: false,
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
 * 정렬 키를 주면 커서로 넘기고(중복·누락 없음), 없으면 range로 넘긴다.
 */
export async function selectAll<T = any>(
  build: (from: number, to: number) => any,
  pageSize = 1000,
  maxPages = 60,
): Promise<{ rows: T[]; truncated: boolean }> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await build(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(error.message);
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
 * 쿠폰 설정으로 본 옵션의 개당 쿠폰 할인.
 *
 * 판매자가 쿠폰 관리에 등록한 값 그대로다 — "이 상품은 1건당 11,500원 할인"이면
 * 11,500. 주문에서 역산한 값은 다운로드쿠폰이 섞이거나 쿠폰을 바꾼 날이 끼면
 * 들쭉날쭉해지는데, 설정값은 그럴 일이 없다.
 * - 정액(PRICE·FIXED·FIXED_WITH_QUANTITY)은 금액 그대로
 * - 정률(RATE·PERCENT)은 판매 단가 × 비율, 최대할인이 있으면 거기서 자른다
 * - 기간이 [from, to]와 하나도 안 겹치는 쿠폰과 종료·삭제 상태는 뺀다
 */
export function definitionUnit(defs: CouponDef[], unitPrice: number, from: string, to: string): number {
  let total = 0;
  for (const d of defs) {
    if (d.status && /EXPIRE|DELETE|CANCEL|END|PAUSE|STOP|만료|삭제|중지/i.test(d.status)) continue;
    const start = d.start_at ? String(d.start_at).slice(0, 10) : '';
    const end = d.end_at ? String(d.end_at).slice(0, 10) : '';
    if (start && start > to) continue;
    if (end && end < from) continue;
    const amount = Number(d.discount) || 0;
    if (amount <= 0) continue;
    if (/RATE|PERCENT|정률/i.test(d.coupon_type ?? '')) {
      let v = (unitPrice * amount) / 100;
      const cap = Number(d.max_discount) || 0;
      if (cap > 0) v = Math.min(v, cap);
      total += v;
    } else {
      total += amount;
    }
  }
  return Math.max(0, Math.round(total));
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
      rows.push({
        user_id: userId,
        vendor_item_id: vendorItemId,
        seller_product_id: sp.id,
        product_id: productId || null,
        product_name: sp.name || pickStr(detail, ['sellerProductName', 'displayProductName']),
        option_name: pickStr(it, ['itemName', 'vendorItemName', 'optionName']),
        sale_price: pickNum(it, ['salePrice', 'originalPrice']),
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
  const orderMeta = new Map<string, { date: string; items: Array<{ vendorItemId: string; amount: number; qty: number }> }>();
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
              const meta = orderMeta.get(orderId) ?? { date: orderDate, items: [] };
              meta.items.push({ vendorItemId, amount, qty });
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

  const rows = [...agg.values()].map(r => ({ ...r, updated_at: new Date().toISOString() }));

  // 구간을 통째로 다시 계산했을 때만 기존 구간을 지우고 새로 넣는다.
  // 중간에 한 번이라도 실패했으면 지금 모은 값은 불완전하다. 그걸로 덮으면
  // 멀쩡하던 과거 데이터까지 날아가므로, 실패한 회차에는 지우지 않고 덧쓰기만 한다.
  if (!failedThisRun) {
    await supabase
      .from('coupang_orders_daily')
      .delete()
      .eq('user_id', userId)
      .gte('order_date', from)
      .lte('order_date', to);
  }
  const err = await upsertChunked('coupang_orders_daily', rows, 'user_id,order_date,vendor_item_id');
  if (err) sum.errors.push(err);
  sum.orders = rows.length;

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
  const rows = [...agg.values()].map(r => ({
    ...r,
    settlement_amount: r.settlement_amount || Math.max(0, r.sales_amount - r.commission),
    updated_at: new Date().toISOString(),
  }));

  // 주문과 같은 이유로, 실패한 회차에는 기존 구간을 지우지 않는다
  if (!failedThisRun) {
    await supabase
      .from('coupang_sales_daily')
      .delete()
      .eq('user_id', userId)
      // 채널을 좁히지 않으면 마켓플레이스 재수집이 같은 기간의 그로스 행까지
      // 쓸어버린다. 그로스는 조회 창구가 달라 이 회차에서 다시 채워지지 않는다.
      .eq('channel', 'marketplace')
      .gte('sale_date', from)
      .lte('sale_date', to);
  }
  const err = await upsertChunked('coupang_sales_daily', rows, 'user_id,sale_date,vendor_item_id,channel');
  if (err) sum.errors.push(err);
  sum.sales = rows.length;
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

/**
 * 윙(마켓플레이스) 실적에서 관측된 판매수수료율.
 *
 * 로켓그로스 주문 API는 수수료를 주지 않지만, 판매수수료율 자체는 윙과 같다.
 * 카테고리마다 요율이 다르므로 상품별로 뽑고, 그 상품의 윙 실적이 없으면
 * 이 판매자의 전체 평균을 쓴다. 윙 실적이 하나도 없으면 null을 돌려준다 —
 * 업계 평균 같은 걸 끌어다 쓰면 순이익이 조용히 틀린다.
 */
async function marketplaceCommissionRates(
  userId: string,
): Promise<{ byItem: Map<string, number>; overall: number | null }> {
  const byItem = new Map<string, number>();
  if (!supabase) return { byItem, overall: null };

  const { rows } = await selectAll<{ vendor_item_id: string; sales_amount: number; commission: number }>((f, t) =>
    supabase!
      .from('coupang_sales_daily')
      .select('vendor_item_id, sales_amount, commission')
      .eq('user_id', userId)
      .eq('channel', 'marketplace')
      .order('vendor_item_id').range(f, t));

  const acc = new Map<string, { sales: number; fee: number }>();
  let totalSales = 0;
  let totalFee = 0;
  for (const r of rows) {
    const sales = Number(r.sales_amount) || 0;
    const fee = Number(r.commission) || 0;
    if (sales <= 0) continue;
    const id = String(r.vendor_item_id);
    const cur = acc.get(id) ?? { sales: 0, fee: 0 };
    cur.sales += sales;
    cur.fee += fee;
    acc.set(id, cur);
    totalSales += sales;
    totalFee += fee;
  }
  for (const [id, v] of acc) {
    // 수수료가 0으로만 쌓인 상품은 아직 확정 전이다. 0%로 굳히면 그 상품
    // 그로스 매출이 수수료 없는 매출로 잡힌다.
    if (v.fee > 0) byItem.set(id, v.fee / v.sales);
  }
  const overall = totalSales > 0 && totalFee > 0 ? totalFee / totalSales : null;
  return { byItem, overall };
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
  // 주문별 쿠폰을 물으려면 주문번호와 옵션별 금액이 필요하다
  const orderMeta = new Map<string, { date: string; items: Array<{ vendorItemId: string; amount: number; qty: number }> }>();

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
        if (!firstOrderShape) {
          firstOrderShape = `주문키=${Object.keys(order ?? {}).slice(0, 14).join(',')}` +
            (items[0] ? ` / 항목키=${Object.keys(items[0]).slice(0, 14).join(',')}` : '');
          console.info('coupang rg order shape —', firstOrderShape);
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
    if (failedThisRun) break;
  }

  // 수수료는 이 API로 오지 않는다. 다만 로켓그로스의 판매수수료율은 윙과 같아서,
  // 이미 들어와 있는 윙 실적에서 상품별 실제 요율을 뽑아 그대로 쓸 수 있다.
  // 카테고리마다 요율이 다르므로 상품별 요율이 있으면 그것을, 없으면 이 판매자의
  // 전체 평균을 쓴다. 둘 다 없으면(윙 실적이 아직 없으면) 수수료를 지어내지 않는다.
  // 그로스 주문이 한 건도 없으면 요율을 뽑을 이유가 없다 (매출 테이블 전체 조회다)
  const rate = agg.size > 0
    ? await marketplaceCommissionRates(userId)
    : { byItem: new Map<string, number>(), overall: null as number | null };
  const rows = [...agg.values()].map(r => {
    const pct = rate.byItem.get(String(r.vendor_item_id)) ?? rate.overall;
    const commission = pct === null ? 0 : Math.round(r.sales_amount * pct);
    return {
      ...r,
      commission,
      settlement_amount: Math.max(0, r.sales_amount - commission),
      updated_at: new Date().toISOString(),
    };
  });

  // 실패한 회차에는 기존 구간을 지우지 않는다 — 불완전한 결과로 덮으면 매출이 준다
  if (!failedThisRun) {
    await supabase
      .from('coupang_sales_daily')
      .delete()
      .eq('user_id', userId)
      .eq('channel', 'growth')
      .gte('sale_date', from)
      .lte('sale_date', to);
  }

  const err = await upsertChunked('coupang_sales_daily', rows, 'user_id,sale_date,vendor_item_id,channel');
  if (err) sum.errors.push(err);
  sum.growth = rows.length;
  sum.growthCancelled = cancelled;

  await syncOrderCoupons(userId, creds, orderMeta, 'growth', sum, deadline);
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
  orderMeta: Map<string, { date: string; items: Array<{ vendorItemId: string; amount: number; qty: number }> }>,
  channel: 'growth' | 'marketplace',
  sum: SyncSummary,
  deadline: number,
): Promise<void> {
  if (!supabase || orderMeta.size === 0) return;

  const ids = [...orderMeta.keys()];
  const { rows: done } = await selectAll<{ order_id: string }>((f, t) =>
    supabase!.from('coupang_order_coupons').select('order_id').eq('user_id', userId).in('order_id', ids).range(f, t));
  const seen = new Set(done.map(d => String(d.order_id)));
  // 최근 주문부터 묻는다. 회차 상한에 걸려 일부만 물어도 지금 쓰는 쿠폰이 먼저 잡힌다.
  const todo = ids
    .filter(id => !seen.has(id))
    .sort((a, b) => (orderMeta.get(b)!.date < orderMeta.get(a)!.date ? -1 : orderMeta.get(b)!.date > orderMeta.get(a)!.date ? 1 : 0))
    .slice(0, LIMITS.couponPerRun);
  if (todo.length === 0) return;

  const rows: any[] = [];
  let lastCallAt = 0;
  let typesSeen = new Set<string>();
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
      // 권한이 없거나 API가 닫혀 있으면 그로스 쿠폰은 알 수 없다. 오류 한 번만 남기고 멈춘다.
      sum.errors.push(`${channel === 'growth' ? '그로스' : '윙'} 쿠폰: ${r.error}`);
      break;
    }
    const list = listOf(r.data);
    // 쿠팡 부담으로 표시된 것은 뺀다. 나머지는 판매자 부담으로 본다 — 실매출을
    // 크게 보는 쪽이 작게 보는 쪽보다 나쁘다.
    let discount = 0;
    const types: string[] = [];
    for (const c of list) {
      const type = pickStr(c, ['type', 'couponType', 'discountType']);
      types.push(type);
      typesSeen.add(type);
      if (/COUPANG|쿠팡/i.test(type)) continue;
      discount += pickNum(c, ['discount', 'discountAmount', 'amount'], 0);
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
        fetched_at: new Date().toISOString(),
      });
    });
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
  console.info('coupang coupon list shape —', `응답키=${Object.keys(listPayload ?? {}).slice(0, 10).join(',')} / 쿠폰키=${Object.keys(list[0] ?? {}).slice(0, 20).join(',')} / ${list.length}건`);

  const rows: any[] = [];
  let complete = true;
  let itemShapeLogged = false;
  let itemsFailed = false;
  let lastCallAt = 0;
  const coupons = list.slice(0, LIMITS.couponDefsPerRun);
  if (list.length > coupons.length) complete = false;

  for (const c of coupons) {
    const couponId = pickStr(c, ['couponId', 'id', 'promotionId']);
    if (!couponId) continue;
    const type = pickStr(c, ['type', 'couponType', 'discountType', 'discountMethod']) || null;
    const discount = pickNum(c, ['discount', 'discountPrice', 'discountAmount', 'discountRate', 'discountValue'], 0);
    const maxDiscount = pickNum(c, ['maxDiscountPrice', 'maxDiscount', 'maxDiscountAmount'], 0) || null;
    const name = pickStr(c, ['name', 'couponName', 'title']) || null;
    const status = pickStr(c, ['status', 'couponStatus']) || null;
    const startAt = toIso(pickRaw(c, ['startAt', 'startDate', 'startDateTime', 'validStartAt']));
    const endAt = toIso(pickRaw(c, ['endAt', 'endDate', 'endDateTime', 'validEndAt']));

    let token = '';
    for (let page = 0; page < LIMITS.couponItemPages; page++) {
      if (outOfTime(deadline, sum)) { complete = false; break; }
      const wait = LIMITS.couponGapMs - (Date.now() - lastCallAt);
      if (wait > 0) await sleep(wait);
      lastCallAt = Date.now();

      const r = await coupangCallVersioned(
        creds, 'GET', v => EP.couponItems(creds.vendorId, couponId, v),
        token ? `nextToken=${token}` : '', ['v1', 'v2'], 'couponItems',
      );
      if (!r.ok) {
        // 한 번 거절되면 나머지 쿠폰도 같은 이유로 거절된다. 오류 하나만 남기고 멈춘다.
        sum.errors.push(`쿠폰 옵션 목록: ${r.error}`);
        complete = false;
        itemsFailed = true;
        break;
      }
      const items = listOf(r.data);
      if (!itemShapeLogged && items[0]) {
        itemShapeLogged = true;
        console.info('coupang coupon item shape —', `응답키=${Object.keys(r.data ?? {}).slice(0, 10).join(',')} / 옵션키=${Object.keys(items[0]).slice(0, 20).join(',')}`);
      }
      for (const it of items) {
        const vendorItemId = findVendorItemId(it);
        if (!vendorItemId) continue;
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
      if (!token) break;
    }
    if (itemsFailed || (!complete && outOfTime(deadline, sum))) break;
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
      if (r.status === 403 || r.status === 404) return;
      sum.errors.push(`그로스 재고: ${r.error}`);
      return;
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
  const { rows: existing } = await selectAll<{ vendor_item_id: string }>((f, t) =>
    supabase!.from('coupang_items').select('vendor_item_id').eq('user_id', userId).order('vendor_item_id').range(f, t));
  const have = new Set(existing.map(e => String(e.vendor_item_id)));

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
      const month = pickStr(s, ['recognitionMonth', 'revenueRecognitionDate', 'salesMonth'], date.slice(0, 7)).slice(0, 7);

      const group = `${date}|${type}|${month}`;
      const seq = ordinal.get(group) ?? 0;
      ordinal.set(group, seq + 1);

      rows.push({
        user_id: userId,
        settlement_key: crypto.createHash('md5').update(`${group}|${seq}`).digest('hex'),
        settlement_date: date,
        settlement_type: type,
        recognition_month: month,
        amount: pickNum(s, ['settlementAmount', 'amount', 'finalAmount', 'paymentAmount'], 0),
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
  for (const status of RETURN_STATUSES) {
  // 60일을 한 번에 물으면 'Request timed out'이 난다. 14일씩 나눈다.
  for (const [cFrom, cTo] of dateChunks(from, to, 14)) {
    let nextToken = '';
    for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
      if (outOfTime(deadline, sum)) break;
      const query =
        `createdAtFrom=${cFrom}&createdAtTo=${cTo}&status=${status}&maxPerPage=50` +
        (nextToken ? `&nextToken=${nextToken}` : '');
      const r = await coupangCallVersioned(
        creds, 'GET',
        v => EP.returnRequests(v, creds.vendorId),
        query, ['v5', 'v4'], 'returnRequests',
      );
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
  for (const [cFrom, cTo] of dateChunks(from, to, 7)) {
    if (outOfTime(deadline, sum)) break;
    let nextToken = '';
    for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
      if (outOfTime(deadline, sum)) break;
      const query =
        `createdAtFrom=${cFrom}T00:00:00&createdAtTo=${cTo}T23:59:59&maxPerPage=50` +
        (nextToken ? `&nextToken=${nextToken}` : '');
      const r = await coupangCall(creds, 'GET', EP.exchangeRequests(creds.vendorId), query);
      if (!r.ok) {
        if (r.authFailed) {
          sum.authFailed = true;
          return;
        }
        sum.errors.push(`교환요청: ${r.error}`);
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
async function syncUser(
  userId: string,
  creds: CoupangCreds,
  full: boolean,
  deadline: number = Date.now() + 240_000,
): Promise<SyncSummary> {
  const sum = emptySummary();
  const today = kstToday();

  // 쿠폰 설정을 맨 앞에 둔다. 호출이 몇 건뿐인데 순이익의 쿠폰 금액이 여기에
  // 달려 있다. 상품 상세는 회차당 120건까지 부르므로 중계 서버가 느린 날에는
  // 그 하나가 수동 수집의 90초를 다 쓴다 — 실제로 그렇게 되어 쿠폰 설정이 한 번도
  // 돌지 못했다. 주문·매출·상품은 매시 크론(240초)이 어차피 다시 채운다.
  await syncCouponDefinitions(userId, creds, sum, deadline);
  if (sum.authFailed) return sum;

  await syncItems(userId, creds, sum, deadline);
  if (sum.authFailed) return sum;

  await syncOrders(userId, creds, addDays(today, -(full ? LIMITS.ordersDaysFull : LIMITS.ordersDaysIncr)), today, sum, deadline);
  if (sum.authFailed) return sum;

  // 매출내역은 종료일이 '어제 이하'여야 한다. 오늘을 넣으면 쿠팡이
  // 'To date must be before or equal to yesterday'로 구간 전체를 거절해
  // 그 회차 매출이 통째로 비어 버린다.
  await syncSales(
    userId, creds,
    addDays(today, -(full ? LIMITS.salesDaysFull : LIMITS.salesDaysIncr)),
    addDays(today, -1),
    sum, deadline,
  );
  // 로켓그로스는 별도 창구다. 이걸 안 부르면 그로스 매출이 통째로 빠진다.
  await syncRocketGrowth(
    userId, creds,
    addDays(today, -(full ? LIMITS.rgDaysFull : LIMITS.rgDaysIncr)),
    today,
    sum, deadline,
  );
  if (sum.authFailed) return sum;

  await syncGrowthInventory(userId, creds, sum, deadline);
  if (sum.authFailed) return sum;

  // 상품 상세에 옵션ID가 안 오는 계정이 있다(로켓그로스 전용 상품). 그래도 재고·매출·
  // 주문에는 옵션ID가 다 실려 오므로, 거기서 본 옵션을 상품 목록에 채운다.
  // 원가 입력·가격 관리·재고 예측이 상세 API 하나에 볼모로 잡히지 않게 한다.
  await backfillItemsFromObservations(userId, sum);

  await syncSettlements(userId, creds, sum, deadline);
  if (sum.authFailed) return sum;

  await syncReturns(userId, creds, addDays(today, -(full ? LIMITS.returnsDaysFull : LIMITS.returnsDaysIncr)), today, sum, deadline);
  if (sum.authFailed) return sum;

  await syncInquiries(userId, creds, sum, deadline);
  return sum;
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

async function setAccountStatus(userId: string, status: string, error: string | null): Promise<void> {
  if (!supabase) return;
  const { data: before } = await supabase
    .from('coupang_accounts')
    .select('status, status_notified_at, users(email, name)')
    .eq('user_id', userId)
    .maybeSingle();

  await supabase
    .from('coupang_accounts')
    .update({ status, last_sync_error: error, updated_at: new Date().toISOString() })
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
        `<p>${escapeHtml(String((before as any)?.users?.name ?? ''))}님, 쿠팡 매출·정산 자동 수집이 멈췄습니다.</p>` +
          `<p style="color:#ffb454;">${escapeHtml(error ?? '')}</p>` +
          `<p>윙에서 키와 등록 IP를 확인한 뒤 훈프로의 [쿠팡 매출·정산 → 연동 설정]에서 다시 등록해주세요. ` +
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
function wrapEmail(title: string, bodyHtml: string): string {
  return (
    `<div style="background:#0a0f1f;padding:28px 16px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;">` +
    `<div style="max-width:520px;margin:0 auto;background:#131d36;border:1px solid #23304f;border-radius:14px;padding:26px;">` +
    `<h1 style="margin:0 0 14px;font-size:17px;color:#e8ecf5;">${title}</h1>` +
    `<div style="font-size:13.5px;line-height:1.75;color:#a8b3c9;">${bodyHtml}</div>` +
    `</div></div>`
  );
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'no-reply@hoonpro.app',
        to: [to],
        subject,
        html,
      }),
    });
  } catch {
    /* 이메일 실패가 동기화를 막지 않도록 */
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
    return res.status(200).json({ ok: false, reason: preflight.reason });
  }

  const budgetMs = 240_000; // maxDuration 300초 안에서 여유를 남긴다
  // 한 사용자가 예산 전체를 먹지 않도록 1인당 상한을 따로 둔다. 상품이 많은
  // 판매자의 첫 수집은 몇 회차에 나눠 끝나고, 그동안 다른 사용자도 돈다.
  const perUserMs = 100_000;
  const startedAt = Date.now();
  const staleBefore = new Date(Date.now() - 20 * 3600_000).toISOString();

  const { data: accounts } = await supabase
    .from('coupang_accounts')
    .select('*')
    .eq('status', 'active')
    .or(`last_sync_at.is.null,last_sync_at.lt.${staleBefore}`)
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(50);

  const result = { processed: 0, truncated: 0, skipped: 0, authFailed: 0, errors: [] as string[] };

  for (const acc of (accounts ?? []) as AccountRow[]) {
    const remaining = budgetMs - (Date.now() - startedAt);
    if (remaining <= 10_000) {
      result.skipped++;
      continue;
    }
    try {
      // 백필이 끝나지 않았으면 계속 넓은 구간으로 받는다. '한 번이라도 돌았는지'가
      // 아니라 '전부 받았는지'를 기준으로 삼아야, 중간에 끊긴 첫 수집이 완성된다.
      const needsBackfill = !acc.backfill_done;
      const sum = await syncUser(
        acc.user_id,
        credsOf(acc),
        needsBackfill,
        Date.now() + Math.min(perUserMs, remaining - 5_000),
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
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', acc.user_id);
      if (sum.truncated) result.truncated++;
      else result.processed++;
    } catch (e: any) {
      result.errors.push(`${acc.user_id}: ${e?.message ?? 'sync failed'}`);
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
        await sendEmail(
          email,
          `[훈프로] 쿠팡 API 키가 ${left}일 후 만료됩니다`,
          wrapEmail(
            '쿠팡 API 키 갱신 안내',
            `<p>${name}님, 등록하신 쿠팡 Open API 키가 <b style="color:#e8ecf5;">${left}일 후</b> 만료됩니다.</p>` +
              `<p>만료되면 매출·정산 자동 수집이 멈춥니다. 쿠팡 윙에서 키를 갱신한 뒤 훈프로의 [쿠팡 연동] 화면에서 다시 등록해주세요.</p>` +
              `<p style="color:#ffb454;">이미 다른 주문수집 프로그램을 쓰신다면 키를 새로 발급하지 마시고, 갱신된 같은 키를 그대로 붙여넣어야 그쪽 연동이 끊기지 않습니다.</p>`,
          ),
        );
        await supabase
          .from('coupang_accounts')
          .update({ expiry_notified_at: today })
          .eq('user_id', acc.user_id);
        result.notified++;
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
    const type = String(req.query.type || 'sync');
    if (type === 'daily') return cronDaily(res);
    if (type === 'weekly') return cronWeeklyReport(res);
    return cronSync(res);
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

  // ── 유료화 게이트 (다른 API와 동일 기준) ──
  if (!decoded.isAdmin) {
    const { data: enforcedCfg } = await supabase
      .from('app_config').select('value').eq('key', 'billing_enforced').maybeSingle();
    if (enforcedCfg?.value === 'true') {
      const { data: sub } = await supabase
        .from('subscriptions').select('status').eq('user_id', userId).maybeSingle();
      if (!sub || !['trial', 'active', 'past_due'].includes(sub.status)) {
        return res.status(402).json({
          error: '구독 후 이용할 수 있습니다. [구독 관리] 탭에서 구독을 시작해주세요.',
          subscriptionRequired: true,
        });
      }
    }
  }

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
      case 'costs': return await handleCosts(userId, res);
      case 'cost-save': return await handleCostSave(userId, req, res);
      case 'ad-costs': return await handleAdCosts(userId, req, res);
      case 'ad-cost-save': return await handleAdCostSave(userId, req, res);
      case 'ad-cost-delete': return await handleAdCostDelete(userId, req, res);
      case 'ad-import-url': return await handleAdImportUrl(userId, req, res);
      case 'settlement': return await handleSettlement(userId, res);
      case 'reports': return await handleReports(userId, res);
      case 'inventory': return await handleInventory(userId, req, res);
      case 'returns': return await handleReturns(userId, req, res);
      case 'inquiries': return await handleInquiries(userId, req, res);
      case 'inquiry-draft': return await handleInquiryDraft(userId, req, res);
      case 'inquiry-reply': return await handleInquiryReply(userId, req, res);
      case 'rank-revenue': return await handleRankRevenue(userId, res);
      case 'price-rules': return await handlePriceRules(userId, res);
      case 'price-rule-save': return await handlePriceRuleSave(userId, req, res);
      case 'price-apply': return await handlePriceApply(userId, req, res);
      case 'admin-overview': return await handleAdminOverview(decoded, res);
      case 'admin-vendors': return await handleAdminVendors(decoded, req, res);
      default:
        return res.status(400).json({ error: `알 수 없는 요청입니다: ${action || '(없음)'}` });
    }
  } catch (e: any) {
    console.error('coupang api error:', e);
    return res.status(500).json({ error: e?.message || '처리 중 오류가 발생했습니다.' });
  }
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
  if (error) return res.status(500).json({ error: `저장 실패: ${error.message}` });

  return res.status(200).json({ ok: true, message: '연동됐습니다. 첫 수집은 최대 몇 분 걸릴 수 있습니다.' });
}

async function handleKeyDelete(userId: string, res: VercelResponse) {
  await supabase!.from('coupang_accounts').delete().eq('user_id', userId);
  return res.status(200).json({ ok: true });
}

// ── 수동 동기화 ───────────────────────────────────────────────
async function handleSync(userId: string, req: VercelRequest, res: VercelResponse) {
  const acc = await loadAccount(userId);
  if (!acc) return res.status(400).json({ error: '먼저 쿠팡 API 키를 등록해주세요.' });

  const full = req.body?.full === true || String(req.query.full) === 'true' || !acc.backfill_done;

  // 중계 서버부터 확인한다. 죽어 있으면 모든 호출이 연결 대기에 걸려, 판매자는
  // 90초를 기다린 끝에 '상품 목록: fetch failed' 같은 속뜻 없는 문구를 본다.
  // 원인이 훈프로도 쿠팡 키도 아니라는 것을 그 자리에서 알려준다.
  const relay = await relayPreflight();
  if (!relay.ok) {
    await supabase!
      .from('coupang_accounts')
      .update({ last_sync_error: `중계 서버 점검 실패: ${relay.reason}`, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    return res.status(503).json({
      error: `쿠팡 연결 중계 서버가 응답하지 않아 수집을 시작하지 못했습니다. 잠시 뒤 다시 시도해주세요. (${relay.reason})`,
    });
  }

  // 화면이 기다리는 요청이다. 4분 동안 스피너만 보여주지 않도록 90초에서 끊고,
  // 못 받은 몫은 truncated로 표시해 크론이 이어받게 한다.
  const sum = await syncUser(userId, credsOf(acc), full, Date.now() + 90_000);

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
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  return res.status(200).json({ ok: true, summary: sum });
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
  returnCount: number;
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
 *   상품명·재고와 광고비는 합계에 들어가지 않으므로 조회를 건너뛴다.
 *   켜지 않으면 기간 비교 하나 때문에 한 요청이 조회를 두 배로 하게 된다.
 */
export async function computeProfit(
  userId: string,
  from: string,
  to: string,
  opts: { totalsOnly?: boolean } = {},
) {
  const lite = opts.totalsOnly === true;
  const [salesRes, costRes, itemRes, returnRes, adRes, adItemRes, growthCouponRes, orderRes, couponDefRes] = await Promise.all([
    selectAll((f, t) => supabase!.from('coupang_sales_daily').select('*').eq('user_id', userId)
      .gte('sale_date', from).lte('sale_date', to).order('sale_date').range(f, t)),
    selectAll((f, t) => supabase!.from('coupang_costs').select('*').eq('user_id', userId)
      .order('vendor_item_id').range(f, t)),
    lite ? Promise.resolve({ rows: [] as any[] }) : selectAll((f, t) => supabase!.from('coupang_items')
      .select('vendor_item_id, product_name, option_name, sale_price, stock').eq('user_id', userId)
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
    lite ? Promise.resolve({ rows: [] as any[] }) : selectAll((f, t) => supabase!.from('coupang_ad_costs')
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

  const returnAgg = new Map<string, number>();
  for (const r of returnRes.rows) {
    if (!isActiveReturn(r.status)) continue;
    const id = String(r.vendor_item_id ?? '');
    if (!id) continue;
    returnAgg.set(id, (returnAgg.get(id) ?? 0) + (Number(r.quantity) || 1));
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
        returnCost: 0,
        profit: 0,
        marginRate: 0,
        costEntered: false,
        stock: item?.stock ?? null,
        salePrice: item?.sale_price ?? null,
      } as ProfitRow);
    cur.quantity += Number(s.quantity) || 0;
    cur.salesAmount += Number(s.sales_amount) || 0;
    cur.commission += Number(s.commission) || 0;
    cur.settlementAmount += Number(s.settlement_amount) || 0;
    agg.set(id, cur);
  }

  // 판매는 없었지만 반품만 발생한 옵션도 손실로 잡아야 한다
  for (const [id, count] of returnAgg) {
    if (agg.has(id)) continue;
    const item = items.get(id);
    agg.set(id, {
      vendorItemId: id,
      productName: item?.product_name ?? '(상품명 미확인)',
      optionName: item?.option_name ?? '',
      quantity: 0, salesAmount: 0, commission: 0, settlementAmount: 0, couponDiscount: 0, couponSource: null, adCost: 0, channel: 'marketplace', returnAmount: 0,
      unitCostTotal: 0, returnCount: count, returnCost: 0, profit: 0, marginRate: 0,
      costEntered: false, stock: item?.stock ?? null, salePrice: item?.sale_price ?? null,
    });
  }

  const rows: ProfitRow[] = [];
  for (const row of agg.values()) {
    const c = costs.get(row.vendorItemId);
    const perUnit = c ? (Number(c.unit_cost) || 0) + (Number(c.packaging_cost) || 0) + (Number(c.shipping_cost) || 0) + (Number(c.fulfillment_cost) || 0) : 0;
    row.costEntered = Boolean(c) && perUnit > 0;
    row.unitCostTotal = perUnit * row.quantity;
    row.returnCount = returnAgg.get(row.vendorItemId) ?? 0;
    row.returnCost = row.returnCount * (c ? Number(c.return_shipping_cost) || 0 : 0);
    const rq = rowQty.get(row.vendorItemId) ?? { market: 0, growth: 0 };
    const wing = wingAgg.get(row.vendorItemId);
    // 개당 쿠폰의 출처는 셋이고 앞의 것이 있으면 그것을 쓴다.
    //  1) 쿠폰 관리의 설정값 — 판매자가 아는 바로 그 숫자 (1건당 11,500원)
    //  2) 주문별 쿠폰 조회 — 쿠팡이 "이 주문에 적용된 쿠폰"이라고 알려준 값 ÷ 그 주문들의 수량
    //  3) 발주서 할인 항목 ÷ 주문수량
    const unitPrice = row.quantity > 0 ? row.salesAmount / row.quantity : row.salePrice ?? 0;
    const defUnit = definitionUnit(couponDefs.get(row.vendorItemId) ?? [], unitPrice, from, to);
    let wingUnit = 0;
    let growthUnit = 0;
    if (defUnit > 0) {
      wingUnit = defUnit;
      growthUnit = defUnit;
      row.couponSource = 'setting';
    } else {
      if (wingApiOrders.has(row.vendorItemId)) {
        const q = wingApiQty.get(row.vendorItemId) ?? 0;
        wingUnit = q > 0 ? (wingApiAgg.get(row.vendorItemId) ?? 0) / q : 0;
      } else if (wing && wing.qty > 0) {
        wingUnit = wing.sd / wing.qty;
      }
      const gQty = growthCouponQty.get(row.vendorItemId) ?? 0;
      growthUnit = gQty > 0 ? (growthCouponAgg.get(row.vendorItemId) ?? 0) / gQty : 0;
      row.couponSource = wingApiOrders.has(row.vendorItemId) || growthCouponAgg.has(row.vendorItemId) ? 'order' : wingUnit > 0 ? 'sheet' : null;
    }
    // 쿠폰은 판매가 이하로만 설정된다. 개당 쿠폰이 개당 판매가를 넘으면 계산이
    // 틀린 것이므로 거기서 자른다. 행 합계만 매출로 자르면 "쿠폰 = 매출"이라
    // 실매출이 0으로 보이는 행이 생기는데, 그건 값이 아니라 증상이다.
    if (unitPrice > 0) {
      wingUnit = Math.min(wingUnit, unitPrice);
      growthUnit = Math.min(growthUnit, unitPrice);
    }
    row.couponDiscount = couponForRow(rq.market, rq.growth, wingUnit, growthUnit, row.salesAmount);
    row.channel = rq.growth > 0 && rq.market > 0 ? 'both' : rq.growth > 0 ? 'growth' : 'marketplace';
    // 반품액 = 실판매가 × 반품수량. 이 기간 판매가 없으면 등록 판매가에서 쿠폰 단가를 뺀다.
    const unitNet = row.quantity > 0
      ? (row.salesAmount - row.couponDiscount) / row.quantity
      : Math.max(0, (row.salePrice ?? 0) - Math.max(wingUnit, growthUnit));
    row.returnAmount = Math.round(row.returnCount * unitNet);
    row.adCost = adItemAgg.get(row.vendorItemId) ?? 0;
    // 순이익 = 매출 − 수수료 − 원가·배송 − 반품 − 광고비. 정산예정액이 이미 수수료를
    // 뺀 값이라 거기서 나머지를 뺀다. 광고비는 옵션에 붙은 몫만 — 옵션 없이 캠페인
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
      t.returnCost += r.returnCost;
      t.profit += r.profit;
      t.couponDiscount += r.couponDiscount;
      t.adCost += r.adCost;
      t.returnAmount += r.returnAmount;
      return t;
    },
    { quantity: 0, salesAmount: 0, commission: 0, settlementAmount: 0, unitCostTotal: 0, returnCount: 0, returnCost: 0, profit: 0, couponDiscount: 0, adCost: 0, returnAmount: 0 },
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
  };

  const missingCost = rows.filter(r => r.quantity > 0 && !r.costEntered).length;

  // 윙(마켓플레이스)과 로켓그로스는 회계 기준이 다르다. 합계 하나로 뭉치면
  // 확정 정산과 주문 기준 추정이 소리 없이 섞이므로 따로 낸다.
  const byChannel = { marketplace: { quantity: 0, salesAmount: 0 }, growth: { quantity: 0, salesAmount: 0 } };
  for (const sale of salesRes.rows) {
    const bucket = sale.channel === 'growth' ? byChannel.growth : byChannel.marketplace;
    bucket.quantity += Number(sale.quantity) || 0;
    bucket.salesAmount += Number(sale.sales_amount) || 0;
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
    const perUnit = c ? (Number(c.unit_cost) || 0) + (Number(c.packaging_cost) || 0) + (Number(c.shipping_cost) || 0) + (Number(c.fulfillment_cost) || 0) : 0;
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
    channels: {
      marketplace: {
        quantity: byChannel.marketplace.quantity,
        salesAmount: Math.round(byChannel.marketplace.salesAmount),
      },
      growth: {
        quantity: byChannel.growth.quantity,
        salesAmount: Math.round(byChannel.growth.salesAmount),
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

  return res.status(200).json({
    ...cur,
    previous: {
      from: prevFrom,
      to: prevTo,
      salesAmount: prev.totals.salesAmount,
      quantity: prev.totals.quantity,
      commission: prev.totals.commission,
      profit: prev.totals.profit,
      // 직전 기간에 판매가 아예 없으면 증감률이 무의미하다. 화면이 판단하도록 알린다
      hasData: prev.totals.quantity > 0,
    },
  });
}

// ── 원가 조회·입력 ────────────────────────────────────────────
async function handleCosts(userId: string, res: VercelResponse) {
  const [itemRes, costRes, soldRes] = await Promise.all([
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
  ]);

  const costs = new Map<string, any>();
  for (const c of costRes.rows) costs.set(String(c.vendor_item_id), c);

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
        sale_price: null,
        stock: null,
        status: '',
        business_type: sale.channel === 'growth' ? 'growth' : 'marketplace',
      });
    }
  }

  const rows = [...itemRes.rows, ...fallbackRows].map((it: any) => {
    const c = costs.get(String(it.vendor_item_id));
    return {
      vendorItemId: String(it.vendor_item_id),
      productName: it.product_name ?? '',
      optionName: it.option_name ?? '',
      salePrice: it.sale_price ?? null,
      stock: it.stock ?? null,
      status: it.status ?? '',
      // 로켓그로스 상품에만 입출고비 칸을 띄운다 — 판매자배송 상품에 0을
      // 넣게 만들면 안 넣은 것과 구분이 안 된다.
      businessType: String(it.business_type ?? 'marketplace'),
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
    if (error) return res.status(500).json({ error: `저장 실패: ${error.message}` });
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
  if (error) return res.status(500).json({ error: `삭제 실패: ${error.message}` });
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

async function handleSettlement(userId: string, res: VercelResponse) {
  const today = kstToday();
  const from = addDays(today, -90);
  const to = addDays(today, 90);

  const [setRes, salesRes] = await Promise.all([
    selectAll((f, t) => supabase!
      .from('coupang_settlements')
      .select('settlement_date, settlement_type, recognition_month, amount, status')
      .eq('user_id', userId)
      .gte('settlement_date', from)
      .lte('settlement_date', to)
      .order('settlement_date').range(f, t)),
    // 최근 90일 정산예정액 — 지급 일정이 아직 안 잡힌 몫을 가늠한다
    selectAll((f, t) => supabase!
      .from('coupang_sales_daily')
      .select('sale_date, settlement_amount')
      .eq('user_id', userId)
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
  const salesByMonth = new Map<string, number>();
  for (const s of salesRes.rows) {
    const m = String(s.sale_date).slice(0, 7);
    salesByMonth.set(m, (salesByMonth.get(m) ?? 0) + (Number(s.settlement_amount) || 0));
  }
  const plannedByMonth = new Map<string, number>();
  for (const s of setRes.rows) {
    const m = String(s.recognition_month ?? '').slice(0, 7);
    if (!m) continue;
    plannedByMonth.set(m, (plannedByMonth.get(m) ?? 0) + (Number(s.amount) || 0));
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

  await sendEmail(
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

  await supabase.from('coupang_reports').insert({
    user_id: userId,
    period_start: start,
    period_end: end,
    summary,
  });

  return true;
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
  const sold28 = new Map<string, number>();
  const nameFromSales = new Map<string, string>();
  const since7 = addDays(today, -6);
  for (const o of salesRes.rows) {
    const id = String(o.vendor_item_id);
    const qty = Number(o.quantity) || 0;
    sold28.set(id, (sold28.get(id) ?? 0) + qty);
    if (String(o.sale_date) >= since7) sold7.set(id, (sold7.get(id) ?? 0) + qty);
    if (o.product_name && !nameFromSales.has(id)) nameFromSales.set(id, String(o.product_name));
  }
  const itemById = new Map<string, any>();
  for (const it of itemRes.rows) itemById.set(String(it.vendor_item_id), it);

  const rows: InventoryRow[] = [];
  for (const inv of invRes.rows) {
    const id = String(inv.vendor_item_id);
    const it = itemById.get(id);
    const stock = Number(inv.orderable_qty) || 0;
    const s28 = sold28.get(id) ?? 0;
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
async function consumeQuota(userId: string, feature: string, fallback: number): Promise<{ ok: boolean; remaining: number; limit: number }> {
  if (!supabase) return { ok: true, remaining: -1, limit: 0 };
  let limit = fallback;
  try {
    const { data } = await supabase.from('app_config').select('value').eq('key', 'feature_limits').maybeSingle();
    const parsed = data?.value ? JSON.parse(data.value) : {};
    if (Number.isFinite(Number(parsed?.[feature]))) limit = Math.max(0, Math.round(Number(parsed[feature])));
  } catch {
    /* 설정을 못 읽으면 기본값으로 간다 */
  }
  try {
    const { data, error } = await supabase.rpc('increment_feature_usage', {
      p_user_id: userId, p_date: kstToday(), p_feature: feature, p_limit: limit,
    });
    if (error) return { ok: true, remaining: -1, limit };
    return { ok: !data?.exceeded, remaining: Number(data?.remaining ?? -1), limit };
  } catch {
    return { ok: true, remaining: -1, limit };
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
  if (error) return res.status(500).json({ error: error.message });

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

  const [rankRes, orderRes] = await Promise.all([
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
  ]);

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
  for (const o of orderRes.rows) {
    const d = String(o.order_date);
    if (orderCoverageStart === null || d < orderCoverageStart) orderCoverageStart = d;
  }

  for (const o of orderRes.rows) {
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

const DEFAULT_COMMISSION_RATE = 10.8; // 그 상품의 실적으로 못 구할 때만 쓰는 대략치
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
      .select('vendor_item_id, sales_amount, commission')
      .eq('user_id', userId)
      .gte('sale_date', addDays(today, -30))
      .order('sale_date').range(f, t)),
  ]);

  const costs = new Map<string, any>();
  for (const c of costRes.rows) costs.set(String(c.vendor_item_id), c);
  const rules = new Map<string, any>();
  for (const r of ruleRes.rows) rules.set(String(r.vendor_item_id), r);

  // 상품별 실제 수수료율 — 카테고리마다 달라 고정값을 쓰면 적자가 난다
  const feeAgg = new Map<string, { sales: number; fee: number }>();
  for (const s of salesRes.rows) {
    const id = String(s.vendor_item_id);
    const cur = feeAgg.get(id) ?? { sales: 0, fee: 0 };
    cur.sales += Number(s.sales_amount) || 0;
    cur.fee += Number(s.commission) || 0;
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
      fee && fee.sales > 0 ? Math.min(40, (fee.fee / fee.sales) * 100) : DEFAULT_COMMISSION_RATE;

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
