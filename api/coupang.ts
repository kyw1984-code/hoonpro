import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

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
//   Vercel 서버리스는 고정 아웃바운드 IP가 없다(Static IPs는 프로젝트당 월 $100).
//   그래서 모든 쿠팡 호출은 고정 IP를 가진 중계 서버를 거칠 수 있게 만들었다.
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
function signedDate(): string {
  // 2026-09-05T12:34:56.789Z → 260905T123456Z
  return new Date().toISOString().slice(2, 19).replace(/[-:]/g, '') + 'Z';
}

function authorization(method: string, path: string, query: string, accessKey: string, secretKey: string): string {
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
}

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
  const auth = authorization(method, path, query, creds.accessKey, creds.secretKey);
  const url = `${COUPANG_HOST}${path}${query ? `?${query}` : ''}`;
  const headers: Record<string, string> = {
    Authorization: auth,
    'Content-Type': 'application/json;charset=UTF-8',
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
      });
    } else {
      res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
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
      // 401/403은 키 문제 또는 IP 미등록 — 사용자가 조치해야 하므로 구분한다.
      const authFailed = res.status === 401 || res.status === 403;
      return {
        ok: false,
        status: res.status,
        authFailed,
        error: parsed?.message || parsed?.error || text.slice(0, 300) || `HTTP ${res.status}`,
      };
    }

    // 쿠팡은 HTTP 200 안에 code/message로 실패를 담아 보내는 경우가 있다.
    if (parsed && typeof parsed.code !== 'undefined' && Number(parsed.code) >= 400) {
      return { ok: false, status: Number(parsed.code), error: parsed.message || '쿠팡 API 오류' };
    }

    return { ok: true, status: res.status, data: parsed as T };
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message || '쿠팡 API 호출 실패' };
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
  ordersheets: (vendorId: string) => `/v2/providers/openapi/apis/api/v4/vendors/${vendorId}/ordersheets`,
  revenueHistory: '/v2/providers/openapi/apis/api/v1/revenue-history',
  settlementHistories: '/v2/providers/marketplace_openapi/apis/api/v1/settlement-histories',
  returnRequests: (v: string, vendorId: string) => `/v2/providers/openapi/apis/api/${v}/vendors/${vendorId}/returnRequests`,
  onlineInquiries: (v: string, vendorId: string) => `/v2/providers/openapi/apis/api/${v}/vendors/${vendorId}/onlineInquiries`,
  inquiryReply: (v: string, vendorId: string, inquiryId: string) =>
    `/v2/providers/openapi/apis/api/${v}/vendors/${vendorId}/onlineInquiries/${inquiryId}/replies`,
};

// 발주서는 상태별로 조회해야 한다. 취소(CANCEL)는 매출이 아니므로 제외한다.
const ORDER_STATUSES = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY'];

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
};

export interface SyncSummary {
  items: number;
  orders: number;
  sales: number;
  settlements: number;
  returns: number;
  inquiries: number;
  errors: string[];
  authFailed: boolean;
}

function emptySummary(): SyncSummary {
  return { items: 0, orders: 0, sales: 0, settlements: 0, returns: 0, inquiries: 0, errors: [], authFailed: false };
}

/** 조회 구간을 chunkDays 단위로 쪼갠다 (쿠팡은 대부분 31일 이내만 허용) */
function dateChunks(from: string, to: string, size = LIMITS.chunkDays): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let cur = from;
  while (daysBetween(cur, to) >= 0) {
    const end = daysBetween(cur, to) > size - 1 ? addDays(cur, size - 1) : to;
    out.push([cur, end]);
    cur = addDays(end, 1);
  }
  return out;
}

/** 대량 upsert — Supabase 요청 크기를 넘기지 않도록 잘라서 넣는다 */
async function upsertChunked(table: string, rows: any[], onConflict: string): Promise<string | null> {
  if (!supabase || rows.length === 0) return null;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) return `${table}: ${error.message}`;
  }
  return null;
}

// ── 상품(옵션) 동기화 ─────────────────────────────────────────
// 목록 조회로 등록상품을 훑고, 상세는 회차당 상한만큼만 가져온다.
// 상세를 오래 못 받은 상품부터 채우므로 몇 회차 안에 전체가 최신화된다.
async function syncItems(userId: string, creds: CoupangCreds, sum: SyncSummary): Promise<void> {
  if (!supabase) return;

  const sellerProductIds: Array<{ id: string; name: string; status: string }> = [];
  let nextToken = '';
  for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
    const query = `vendorId=${creds.vendorId}&maxPerPage=100${nextToken ? `&nextToken=${nextToken}` : ''}`;
    const r = await coupangCall(creds, 'GET', EP.sellerProducts, query);
    if (!r.ok) {
      if (r.authFailed) sum.authFailed = true;
      sum.errors.push(`상품 목록: ${r.error}`);
      return;
    }
    for (const p of listOf(r.data)) {
      const id = pickStr(p, ['sellerProductId', 'sellerProductID']);
      if (!id) continue;
      sellerProductIds.push({
        id,
        name: pickStr(p, ['sellerProductName', 'displayProductName', 'productName']),
        status: pickStr(p, ['statusName', 'status']),
      });
    }
    nextToken = nextTokenOf(r.data);
    if (!nextToken) break;
  }

  // 상세를 가져올 대상 — 아직 한 번도 못 받았거나 가장 오래된 것 우선
  const { data: known } = await supabase
    .from('coupang_items')
    .select('seller_product_id, synced_at')
    .eq('user_id', userId);
  const lastSynced = new Map<string, string>();
  for (const k of known ?? []) lastSynced.set(String(k.seller_product_id), String(k.synced_at ?? ''));

  const ordered = [...sellerProductIds].sort(
    (a, b) => (lastSynced.get(a.id) ?? '').localeCompare(lastSynced.get(b.id) ?? ''),
  );

  const rows: any[] = [];
  for (const sp of ordered.slice(0, LIMITS.itemDetailPerRun)) {
    const r = await coupangCall(creds, 'GET', EP.sellerProduct(sp.id), '');
    if (!r.ok) {
      if (r.authFailed) {
        sum.authFailed = true;
        return;
      }
      continue; // 개별 상품 실패는 건너뛴다 — 다음 회차에 다시 시도된다
    }
    const detail = (r.data as any)?.data ?? r.data;
    const productId = pickStr(detail, ['productId', 'displayProductId']);
    for (const it of Array.isArray(detail?.items) ? detail.items : []) {
      const vendorItemId = pickStr(it, ['vendorItemId', 'vendorItemID']);
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
        synced_at: new Date().toISOString(),
      });
    }
  }

  const err = await upsertChunked('coupang_items', rows, 'user_id,vendor_item_id');
  if (err) sum.errors.push(err);
  sum.items = rows.length;
}

// ── 주문 동기화 (발주서) ──────────────────────────────────────
// 상태별로 나눠 조회하므로 같은 주문이 여러 번 잡힌다. orderId+옵션ID로
// 중복을 걷어낸 뒤 날짜별로 합산하고, 구간 전체를 통째로 덮어써 멱등하게 만든다.
async function syncOrders(userId: string, creds: CoupangCreds, from: string, to: string, sum: SyncSummary): Promise<void> {
  if (!supabase) return;

  const seen = new Set<string>();
  const agg = new Map<string, any>();

  for (const [cFrom, cTo] of dateChunks(from, to)) {
    for (const status of ORDER_STATUSES) {
      let nextToken = '';
      for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
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
            const cur = agg.get(key) ?? {
              user_id: userId,
              order_date: orderDate,
              vendor_item_id: vendorItemId,
              product_id: pickStr(it, ['productId', 'displayProductId']) || null,
              product_name: pickStr(it, ['vendorItemName', 'sellerProductName', 'productName']),
              quantity: 0,
              order_amount: 0,
            };
            cur.quantity += qty;
            cur.order_amount += amount;
            agg.set(key, cur);
          }
        }
        nextToken = nextTokenOf(r.data);
        if (!nextToken) break;
      }
    }
  }

  const rows = [...agg.values()].map(r => ({ ...r, updated_at: new Date().toISOString() }));
  // 구간을 통째로 다시 계산했으므로 기존 구간 데이터를 지우고 새로 넣는다.
  await supabase
    .from('coupang_orders_daily')
    .delete()
    .eq('user_id', userId)
    .gte('order_date', from)
    .lte('order_date', to);
  const err = await upsertChunked('coupang_orders_daily', rows, 'user_id,order_date,vendor_item_id');
  if (err) sum.errors.push(err);
  sum.orders = rows.length;
}

// ── 매출 동기화 (매출내역) ────────────────────────────────────
// 매출인식일(구매확정 또는 배송완료+3일) 기준이라 주문일보다 늦다.
// 수수료·정산예정액이 여기에만 있어 순이익 계산의 근거가 된다.
async function syncSales(userId: string, creds: CoupangCreds, from: string, to: string, sum: SyncSummary): Promise<void> {
  if (!supabase) return;

  const agg = new Map<string, any>();

  for (const [cFrom, cTo] of dateChunks(from, to)) {
    let token = '';
    for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
      const query =
        `vendorId=${creds.vendorId}&recognitionDateFrom=${cFrom}&recognitionDateTo=${cTo}&maxPerPage=100` +
        (token ? `&token=${token}` : '');
      const r = await coupangCall(creds, 'GET', EP.revenueHistory, query);
      if (!r.ok) {
        if (r.authFailed) {
          sum.authFailed = true;
          return;
        }
        sum.errors.push(`매출내역: ${r.error}`);
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
            quantity: 0,
            sales_amount: 0,
            commission: 0,
            settlement_amount: 0,
          };
          cur.quantity += pickNum(it, ['quantity', 'saleCount', 'shippingCount'], 0);
          cur.sales_amount += pickNum(it, ['salePrice', 'saleAmount', 'totalSalePrice', 'settlementTargetAmount'], 0);
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

  await supabase
    .from('coupang_sales_daily')
    .delete()
    .eq('user_id', userId)
    .gte('sale_date', from)
    .lte('sale_date', to);
  const err = await upsertChunked('coupang_sales_daily', rows, 'user_id,sale_date,vendor_item_id');
  if (err) sum.errors.push(err);
  sum.sales = rows.length;
}

// ── 지급내역 동기화 (캐시플로) ────────────────────────────────
async function syncSettlements(userId: string, creds: CoupangCreds, sum: SyncSummary): Promise<void> {
  if (!supabase) return;

  const today = kstToday();
  const from = addDays(today, -120);
  const to = addDays(today, 60); // 지급 예정분까지 본다

  const rows: any[] = [];
  for (const [cFrom, cTo] of dateChunks(from, to)) {
    const query = `vendorId=${creds.vendorId}&revenueRecognitionDateFrom=${cFrom}&revenueRecognitionDateTo=${cTo}`;
    const r = await coupangCall(creds, 'GET', EP.settlementHistories, query);
    if (!r.ok) {
      if (r.authFailed) {
        sum.authFailed = true;
        return;
      }
      sum.errors.push(`지급내역: ${r.error}`);
      continue;
    }
    for (const s of listOf(r.data)) {
      const date = pickDate(s, ['settlementDate', 'paymentDate', 'expectedSettlementDate', 'settlementCompleteDate']);
      if (!date) continue;
      const type = pickStr(s, ['settlementType', 'settlementTypeName', 'paymentType'], '정산');
      const month = pickStr(s, ['recognitionMonth', 'revenueRecognitionDate', 'salesMonth'], date.slice(0, 7));
      rows.push({
        user_id: userId,
        settlement_key: crypto.createHash('md5').update(`${date}|${type}|${month}`).digest('hex'),
        settlement_date: date,
        settlement_type: type,
        recognition_month: month.slice(0, 7),
        amount: pickNum(s, ['settlementAmount', 'amount', 'finalAmount', 'paymentAmount'], 0),
        status: pickStr(s, ['settlementStatus', 'status', 'statusName']),
        raw: s,
        updated_at: new Date().toISOString(),
      });
    }
  }

  const err = await upsertChunked('coupang_settlements', rows, 'user_id,settlement_key');
  if (err) sum.errors.push(err);
  sum.settlements = rows.length;
}

// ── 반품·교환 동기화 ──────────────────────────────────────────
async function syncReturns(userId: string, creds: CoupangCreds, from: string, to: string, sum: SyncSummary): Promise<void> {
  if (!supabase) return;

  const rows: any[] = [];
  for (const [cFrom, cTo] of dateChunks(from, to)) {
    let nextToken = '';
    for (let page = 0; page < LIMITS.pagesPerQuery; page++) {
      const query =
        `createdAtFrom=${cFrom}&createdAtTo=${cTo}&maxPerPage=50` + (nextToken ? `&nextToken=${nextToken}` : '');
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
        sum.errors.push(`반품요청: ${r.error}`);
        break;
      }
      for (const rr of listOf(r.data)) {
        const receiptId = pickStr(rr, ['receiptId', 'returnDeliveryId', 'cancelId']);
        if (!receiptId) continue;
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
          requested_at: pickRaw(rr, ['createdAt', 'receiptInsertDate', 'requestedAt']) ?? null,
          raw: rr,
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
async function syncInquiries(userId: string, creds: CoupangCreds, sum: SyncSummary): Promise<void> {
  if (!supabase) return;

  const today = kstToday();
  const from = addDays(today, -LIMITS.inquiryDays + 1);
  const rows: any[] = [];

  for (let pageNum = 1; pageNum <= 10; pageNum++) {
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
    if (list.length === 0) break;
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
        inquired_at: pickRaw(q, ['inquiryAt', 'createdAt', 'inquiryDate']) ?? null,
        answered: false,
        raw: q,
        updated_at: new Date().toISOString(),
      });
    }
    if (list.length < 50) break;
  }

  const err = await upsertChunked('coupang_inquiries', rows, 'user_id,inquiry_id');
  if (err) sum.errors.push(err);
  sum.inquiries = rows.length;
}

/** 사용자 1명 전체 동기화 */
async function syncUser(userId: string, creds: CoupangCreds, full: boolean): Promise<SyncSummary> {
  const sum = emptySummary();
  const today = kstToday();

  await syncItems(userId, creds, sum);
  if (sum.authFailed) return sum;

  await syncOrders(userId, creds, addDays(today, -(full ? LIMITS.ordersDaysFull : LIMITS.ordersDaysIncr)), today, sum);
  if (sum.authFailed) return sum;

  await syncSales(userId, creds, addDays(today, -(full ? LIMITS.salesDaysFull : LIMITS.salesDaysIncr)), today, sum);
  if (sum.authFailed) return sum;

  await syncSettlements(userId, creds, sum);
  if (sum.authFailed) return sum;

  await syncReturns(userId, creds, addDays(today, -(full ? LIMITS.returnsDaysFull : LIMITS.returnsDaysIncr)), today, sum);
  if (sum.authFailed) return sum;

  await syncInquiries(userId, creds, sum);
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
  key_issued_at: string | null;
  expiry_notified_at: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
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
  if (r.status === 401 || r.status === 403) {
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
  await supabase
    .from('coupang_accounts')
    .update({ status, last_sync_error: error, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
}

/** 키 만료(발급 후 6개월)까지 남은 일수 — 발급일을 모르면 null */
function daysToExpiry(keyIssuedAt: string | null): number | null {
  if (!keyIssuedAt) return null;
  const expiry = addDays(keyIssuedAt.slice(0, 10), 180);
  return daysBetween(kstToday(), expiry);
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
async function cronSync(res: VercelResponse) {
  if (!supabase) return res.status(200).json({ ok: false, reason: 'supabase 미설정' });

  const budgetMs = 240_000; // maxDuration 300초 안에서 여유를 남긴다
  const startedAt = Date.now();
  const staleBefore = new Date(Date.now() - 20 * 3600_000).toISOString();

  const { data: accounts } = await supabase
    .from('coupang_accounts')
    .select('*')
    .eq('status', 'active')
    .or(`last_sync_at.is.null,last_sync_at.lt.${staleBefore}`)
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(50);

  const result = { processed: 0, skipped: 0, authFailed: 0, errors: [] as string[] };

  for (const acc of (accounts ?? []) as AccountRow[]) {
    if (Date.now() - startedAt > budgetMs) {
      result.skipped++;
      continue;
    }
    try {
      const first = !acc.last_sync_at;
      const sum = await syncUser(acc.user_id, credsOf(acc), first);
      if (sum.authFailed) {
        await setAccountStatus(acc.user_id, 'invalid', '쿠팡이 키를 거부했습니다. 키 또는 등록 IP를 확인해주세요.');
        result.authFailed++;
        continue;
      }
      await supabase
        .from('coupang_accounts')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_error: sum.errors.length ? sum.errors.slice(0, 3).join(' / ') : null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', acc.user_id);
      result.processed++;
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
    .not('key_issued_at', 'is', null);

  for (const acc of (accounts ?? []) as any[]) {
    const left = daysToExpiry(acc.key_issued_at);
    if (left === null) continue;

    if (left <= 0 && acc.status === 'active') {
      await setAccountStatus(acc.user_id, 'expired', '쿠팡 API 키 유효기간(6개월)이 지났습니다. 윙에서 갱신 후 다시 등록해주세요.');
      result.expired++;
    }

    // 14일 전부터 알리되 같은 만료 건으로 두 번 보내지 않는다
    if (left > 0 && left <= 14 && acc.expiry_notified_at !== today) {
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

  // 자동 가격 반영 — 옵션별로 따로 켠 것만 움직인다
  const { data: autoAccounts } = await supabase
    .from('coupang_accounts')
    .select('*')
    .eq('status', 'active');
  let priceApplied = 0;
  for (const acc of (autoAccounts ?? []) as AccountRow[]) {
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
  await supabase.from('coupang_inquiries').delete().eq('answered', true).lt('inquired_at', addDays(today, -90));
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

  try {
    switch (action) {
      case 'status': return await handleStatus(userId, res);
      case 'key-save': return await handleKeySave(userId, req, res);
      case 'key-delete': return await handleKeyDelete(userId, res);
      case 'sync': return await handleSync(userId, req, res);
      case 'profit': return await handleProfit(userId, req, res);
      case 'costs': return await handleCosts(userId, res);
      case 'cost-save': return await handleCostSave(userId, req, res);
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
      default:
        return res.status(400).json({ error: `알 수 없는 요청입니다: ${action || '(없음)'}` });
    }
  } catch (e: any) {
    console.error('coupang api error:', e);
    return res.status(500).json({ error: e?.message || '처리 중 오류가 발생했습니다.' });
  }
}

// ── 연동 상태 ─────────────────────────────────────────────────
async function handleStatus(userId: string, res: VercelResponse) {
  const acc = await loadAccount(userId);
  if (!acc) {
    return res.status(200).json({
      connected: false,
      relayIp: process.env.COUPANG_RELAY_IP || null,
    });
  }

  const [{ count: itemCount }, { count: salesDays }] = await Promise.all([
    supabase!.from('coupang_items').select('vendor_item_id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase!.from('coupang_sales_daily').select('sale_date', { count: 'exact', head: true }).eq('user_id', userId),
  ]);

  return res.status(200).json({
    connected: true,
    vendorId: acc.vendor_id,
    accessKeyMasked: `${acc.access_key.slice(0, 6)}${'*'.repeat(Math.max(0, acc.access_key.length - 10))}${acc.access_key.slice(-4)}`,
    status: acc.status,
    lastSyncAt: acc.last_sync_at,
    lastSyncError: acc.last_sync_error,
    keyIssuedAt: acc.key_issued_at,
    daysToExpiry: daysToExpiry(acc.key_issued_at),
    itemCount: itemCount ?? 0,
    salesDays: salesDays ?? 0,
    relayIp: process.env.COUPANG_RELAY_IP || null,
  });
}

// ── 키 등록 ───────────────────────────────────────────────────
async function handleKeySave(userId: string, req: VercelRequest, res: VercelResponse) {
  const vendorId = String(req.body?.vendorId ?? '').trim();
  const accessKey = String(req.body?.accessKey ?? '').trim();
  const secretKey = String(req.body?.secretKey ?? '').trim();
  const keyIssuedAt = String(req.body?.keyIssuedAt ?? '').trim() || null;

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

  // 크론 분산 슬롯은 사용자 ID를 해시해 고르게 나눈다
  const shard = parseInt(crypto.createHash('md5').update(userId).digest('hex').slice(0, 2), 16) % 10;

  const { error } = await supabase!.from('coupang_accounts').upsert(
    {
      user_id: userId,
      vendor_id: vendorId,
      access_key: accessKey,
      secret_key_enc: encryptSecret(secretKey),
      status: 'active',
      key_issued_at: keyIssuedAt,
      expiry_notified_at: null,
      last_verified_at: new Date().toISOString(),
      last_sync_error: null,
      sync_shard: shard,
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

  const full = req.body?.full === true || String(req.query.full) === 'true' || !acc.last_sync_at;
  const sum = await syncUser(userId, credsOf(acc), full);

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
export async function computeProfit(userId: string, from: string, to: string) {
  const [salesRes, costRes, itemRes, returnRes, adRes] = await Promise.all([
    supabase!.from('coupang_sales_daily').select('*').eq('user_id', userId).gte('sale_date', from).lte('sale_date', to),
    supabase!.from('coupang_costs').select('*').eq('user_id', userId),
    supabase!.from('coupang_items').select('vendor_item_id, product_name, option_name, sale_price, stock').eq('user_id', userId),
    supabase!
      .from('coupang_returns')
      .select('vendor_item_id, quantity, requested_at')
      .eq('user_id', userId)
      .gte('requested_at', `${from}T00:00:00Z`)
      .lte('requested_at', `${to}T23:59:59Z`),
    // 저장된 광고 보고서가 있으면 기간 광고비의 기본값으로 제안한다
    supabase!.from('ad_reports').select('summary, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
  ]);

  const costs = new Map<string, any>();
  for (const c of costRes.data ?? []) costs.set(String(c.vendor_item_id), c);

  const items = new Map<string, any>();
  for (const it of itemRes.data ?? []) items.set(String(it.vendor_item_id), it);

  const returnAgg = new Map<string, number>();
  for (const r of returnRes.data ?? []) {
    const id = String(r.vendor_item_id ?? '');
    if (!id) continue;
    returnAgg.set(id, (returnAgg.get(id) ?? 0) + (Number(r.quantity) || 1));
  }

  const agg = new Map<string, ProfitRow>();
  for (const s of salesRes.data ?? []) {
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
      quantity: 0, salesAmount: 0, commission: 0, settlementAmount: 0,
      unitCostTotal: 0, returnCount: count, returnCost: 0, profit: 0, marginRate: 0,
      costEntered: false, stock: item?.stock ?? null, salePrice: item?.sale_price ?? null,
    });
  }

  const rows: ProfitRow[] = [];
  for (const row of agg.values()) {
    const c = costs.get(row.vendorItemId);
    const perUnit = c ? (Number(c.unit_cost) || 0) + (Number(c.packaging_cost) || 0) + (Number(c.shipping_cost) || 0) : 0;
    row.costEntered = Boolean(c) && perUnit > 0;
    row.unitCostTotal = perUnit * row.quantity;
    row.returnCount = returnAgg.get(row.vendorItemId) ?? 0;
    row.returnCost = row.returnCount * (c ? Number(c.return_shipping_cost) || 0 : 0);
    row.profit = row.settlementAmount - row.unitCostTotal - row.returnCost;
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
      return t;
    },
    { quantity: 0, salesAmount: 0, commission: 0, settlementAmount: 0, unitCostTotal: 0, returnCount: 0, returnCost: 0, profit: 0 },
  );

  const missingCost = rows.filter(r => r.quantity > 0 && !r.costEntered).length;
  const adReport = (adRes.data ?? [])[0];

  return {
    from,
    to,
    rows,
    totals: {
      ...totals,
      marginRate: totals.salesAmount > 0 ? (totals.profit / totals.salesAmount) * 100 : 0,
    },
    missingCost,
    // 원가를 하나도 안 넣었으면 순이익이 매출과 같아 보여 오해를 부른다. 화면에서 경고한다.
    costCoverage: rows.length > 0 ? ((rows.length - missingCost) / rows.length) * 100 : 0,
    adCostHint: (adReport?.summary as any)?.totalCost ?? null,
    adReportAt: adReport?.created_at ?? null,
  };
}

async function handleProfit(userId: string, req: VercelRequest, res: VercelResponse) {
  const { from, to } = rangeFromQuery(req);
  return res.status(200).json(await computeProfit(userId, from, to));
}

// ── 원가 조회·입력 ────────────────────────────────────────────
async function handleCosts(userId: string, res: VercelResponse) {
  const [itemRes, costRes, soldRes] = await Promise.all([
    supabase!.from('coupang_items').select('*').eq('user_id', userId).order('product_name'),
    supabase!.from('coupang_costs').select('*').eq('user_id', userId),
    // 최근 30일 판매수량 — 원가를 어디부터 채워야 효과가 큰지 보여준다
    supabase!
      .from('coupang_sales_daily')
      .select('vendor_item_id, quantity')
      .eq('user_id', userId)
      .gte('sale_date', addDays(kstToday(), -30)),
  ]);

  const costs = new Map<string, any>();
  for (const c of costRes.data ?? []) costs.set(String(c.vendor_item_id), c);

  const sold = new Map<string, number>();
  for (const s of soldRes.data ?? []) {
    const id = String(s.vendor_item_id);
    sold.set(id, (sold.get(id) ?? 0) + (Number(s.quantity) || 0));
  }

  const rows = (itemRes.data ?? []).map((it: any) => {
    const c = costs.get(String(it.vendor_item_id));
    return {
      vendorItemId: String(it.vendor_item_id),
      productName: it.product_name ?? '',
      optionName: it.option_name ?? '',
      salePrice: it.sale_price ?? null,
      stock: it.stock ?? null,
      status: it.status ?? '',
      soldLast30: sold.get(String(it.vendor_item_id)) ?? 0,
      unitCost: c?.unit_cost ?? 0,
      packagingCost: c?.packaging_cost ?? 0,
      shippingCost: c?.shipping_cost ?? 0,
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
  const rows = items
    .filter((it: any) => it?.vendorItemId)
    .map((it: any) => ({
      user_id: userId,
      vendor_item_id: String(it.vendorItemId),
      unit_cost: clamp(it.unitCost),
      packaging_cost: clamp(it.packagingCost),
      shipping_cost: clamp(it.shippingCost),
      return_shipping_cost: clamp(it.returnShippingCost),
      memo: typeof it.memo === 'string' ? it.memo.slice(0, 200) : null,
      updated_at: new Date().toISOString(),
    }));

  const err = await upsertChunked('coupang_costs', rows, 'user_id,vendor_item_id');
  if (err) return res.status(500).json({ error: `저장 실패: ${err}` });
  return res.status(200).json({ ok: true, saved: rows.length });
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
    supabase!
      .from('coupang_settlements')
      .select('settlement_date, settlement_type, recognition_month, amount, status')
      .eq('user_id', userId)
      .gte('settlement_date', from)
      .lte('settlement_date', to)
      .order('settlement_date'),
    // 최근 90일 정산예정액 — 지급 일정이 아직 안 잡힌 몫을 가늠한다
    supabase!
      .from('coupang_sales_daily')
      .select('sale_date, settlement_amount')
      .eq('user_id', userId)
      .gte('sale_date', from),
  ]);

  const byDate = new Map<string, { date: string; amount: number; items: Array<{ type: string; amount: number; status: string }> }>();
  let paid = 0;      // 이미 들어온 돈
  let upcoming = 0;  // 앞으로 들어올 돈

  for (const s of setRes.data ?? []) {
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

  // 지급 일정이 잡힌 총액과 매출 기준 정산예정액의 차이 = 아직 일정 미배정
  const totalSettlementPlanned = (setRes.data ?? []).reduce((n, s) => n + (Number(s.amount) || 0), 0);
  const totalSalesSettlement = (salesRes.data ?? []).reduce((n, s) => n + (Number(s.settlement_amount) || 0), 0);
  const unscheduled = Math.max(0, totalSalesSettlement - totalSettlementPlanned);

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
  const past = weekly.filter(w => w.amount > 0);
  const weeklyAverage = past.length > 0 ? past.reduce((n, w) => n + w.amount, 0) / past.length : 0;

  return res.status(200).json({
    today,
    days,
    totals: { paid, upcoming, in7, in30, unscheduled, weeklyAverage },
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
function lastWeekRange(today: string): { start: string; end: string } {
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
    computeProfit(userId, prevStart, prevEnd),
    supabase
      .from('coupang_settlements')
      .select('settlement_date, amount')
      .eq('user_id', userId)
      .gte('settlement_date', end)
      .lte('settlement_date', addDays(end, 14)),
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

  const incoming = (settleRes.data ?? []).reduce((n, s) => n + (Number(s.amount) || 0), 0);

  // 품절 임박 — 지난주 성과보다 이게 더 급한 주도 있다
  const { rows: inventory } = await computeInventory(userId);
  const atRisk = inventory.filter(r => r.risk === 'out' || r.risk === 'urgent').slice(0, 5);

  const summary = {
    quantity: cur.totals.quantity,
    salesAmount: cur.totals.salesAmount,
    profit: cur.totals.profit,
    marginRate: cur.totals.marginRate,
    returnCount: cur.totals.returnCount,
    prevSalesAmount: prev.totals.salesAmount,
    prevProfit: prev.totals.profit,
    incoming,
    missingCost: cur.missingCost,
    atRiskCount: atRisk.length,
  };

  const costWarning =
    cur.missingCost > 0
      ? `<p style="margin:16px 0 0;padding:10px 12px;background:#1b2540;border-radius:8px;color:#ffb454;font-size:12px;">` +
        `원가가 비어 있는 상품이 ${cur.missingCost}개 있습니다. 그만큼 순이익이 실제보다 크게 잡힙니다.</p>`
      : '';

  await sendEmail(
    email,
    `[훈프로] ${start} ~ ${end} 주간 성과`,
    wrapEmail(
      '지난주 성과 요약',
      `<p>${escapeHtml(name)}님, 지난주 쿠팡 판매 결과입니다.</p>` +
        `<table style="width:100%;border-collapse:collapse;margin-top:14px;">` +
        `<tr><td style="padding:8px 0;color:#a8b3c9;font-size:13px;">매출</td>` +
        `<td style="padding:8px 0;text-align:right;color:#e8ecf5;font-size:14px;font-weight:600;">${won(cur.totals.salesAmount)} ${deltaText(cur.totals.salesAmount, prev.totals.salesAmount)}</td></tr>` +
        `<tr><td style="padding:8px 0;color:#a8b3c9;font-size:13px;">순이익</td>` +
        `<td style="padding:8px 0;text-align:right;color:${cur.totals.profit >= 0 ? '#4ade80' : '#f87171'};font-size:14px;font-weight:600;">${won(cur.totals.profit)} ${deltaText(cur.totals.profit, prev.totals.profit)}</td></tr>` +
        `<tr><td style="padding:8px 0;color:#a8b3c9;font-size:13px;">이익률</td>` +
        `<td style="padding:8px 0;text-align:right;color:#e8ecf5;font-size:14px;font-weight:600;">${cur.totals.marginRate.toFixed(1)}%</td></tr>` +
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

  const today = kstToday();
  const [itemRes, orderRes] = await Promise.all([
    supabase.from('coupang_items').select('vendor_item_id, product_name, option_name, stock, status').eq('user_id', userId),
    supabase
      .from('coupang_orders_daily')
      .select('vendor_item_id, order_date, quantity')
      .eq('user_id', userId)
      .gte('order_date', addDays(today, -27)),
  ]);

  const sold7 = new Map<string, number>();
  const sold28 = new Map<string, number>();
  const since7 = addDays(today, -6);
  for (const o of orderRes.data ?? []) {
    const id = String(o.vendor_item_id);
    const qty = Number(o.quantity) || 0;
    sold28.set(id, (sold28.get(id) ?? 0) + qty);
    if (String(o.order_date) >= since7) sold7.set(id, (sold7.get(id) ?? 0) + qty);
  }

  const rows: InventoryRow[] = [];
  for (const it of itemRes.data ?? []) {
    const id = String(it.vendor_item_id);
    const stock = Number(it.stock) || 0;
    const s28 = sold28.get(id) ?? 0;
    const s7 = sold7.get(id) ?? 0;

    // 28일 판매가 없으면 최근 7일로 본다. 신상품은 28일 평균이 실제보다 낮다.
    const velocity = s28 > 0 ? s28 / 28 : s7 > 0 ? s7 / 7 : 0;
    const daysLeft = velocity > 0 ? stock / velocity : null;

    let risk: InventoryRow['risk'];
    if (velocity === 0) risk = stock > 0 ? 'idle' : 'ok';
    else if (stock <= 0) risk = 'out';
    else if (daysLeft! <= 7) risk = 'urgent';
    else if (daysLeft! <= 14) risk = 'watch';
    else if (daysLeft! > 90) risk = 'excess';
    else risk = 'ok';

    const reorderQty = velocity > 0 ? Math.max(0, Math.ceil(velocity * (leadTimeDays + coverDays) - stock)) : 0;

    rows.push({
      vendorItemId: id,
      productName: it.product_name ?? '',
      optionName: it.option_name ?? '',
      stock,
      sold7: s7,
      sold28: s28,
      velocity,
      daysLeft,
      reorderQty,
      risk,
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
    supabase!
      .from('coupang_returns')
      .select('receipt_id, vendor_item_id, product_name, quantity, reason, fault, status, requested_at')
      .eq('user_id', userId)
      .gte('requested_at', `${from}T00:00:00Z`)
      .lte('requested_at', `${to}T23:59:59Z`),
    supabase!
      .from('coupang_sales_daily')
      .select('vendor_item_id, quantity, sales_amount')
      .eq('user_id', userId)
      .gte('sale_date', from)
      .lte('sale_date', to),
    supabase!.from('coupang_costs').select('*').eq('user_id', userId),
    supabase!.from('coupang_items').select('vendor_item_id, product_name, option_name').eq('user_id', userId),
  ]);

  const costs = new Map<string, any>();
  for (const c of costRes.data ?? []) costs.set(String(c.vendor_item_id), c);
  const items = new Map<string, any>();
  for (const it of itemRes.data ?? []) items.set(String(it.vendor_item_id), it);

  const soldQty = new Map<string, number>();
  for (const s of salesRes.data ?? []) {
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

  for (const r of returnRes.data ?? []) {
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

function pearson(xs: number[], ys: number[]): number | null {
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
function slope(xs: number[], ys: number[]): number | null {
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
    return res.status(200).json({ items: [], hint: 'no-watch' });
  }

  const productIds = [...new Set(watches.map(w => String(w.product_id)))];

  // 노출상품ID → 옵션ID 묶음 (주문은 옵션 단위로 쌓인다)
  const { data: items } = await supabase!
    .from('coupang_items')
    .select('vendor_item_id, product_id')
    .eq('user_id', userId)
    .in('product_id', productIds);

  const vendorItemsByProduct = new Map<string, string[]>();
  for (const it of items ?? []) {
    const pid = String(it.product_id ?? '');
    if (!pid) continue;
    const list = vendorItemsByProduct.get(pid) ?? [];
    list.push(String(it.vendor_item_id));
    vendorItemsByProduct.set(pid, list);
  }

  const allVendorItems = [...vendorItemsByProduct.values()].flat();

  const [rankRes, orderRes] = await Promise.all([
    supabase!
      .from('sourcing_rank_obs')
      .select('keyword, product_id, rank, captured_at')
      .in('product_id', productIds)
      .gte('captured_at', `${from}T00:00:00Z`),
    allVendorItems.length > 0
      ? supabase!
          .from('coupang_orders_daily')
          .select('vendor_item_id, order_date, quantity, order_amount')
          .eq('user_id', userId)
          .in('vendor_item_id', allVendorItems)
          .gte('order_date', from)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  // 하루에 여러 번 수집될 수 있으므로 날짜별 평균 순위를 쓴다
  const rankByKey = new Map<string, Map<string, { sum: number; n: number }>>();
  for (const o of rankRes.data ?? []) {
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

  for (const o of orderRes.data ?? []) {
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

  const results = watches.map(w => {
    const key = `${w.keyword}::${w.product_id}`;
    const rankDays = rankByKey.get(key) ?? new Map();
    const orderDays = ordersByProduct.get(String(w.product_id)) ?? new Map();

    const days = [...new Set([...rankDays.keys(), ...orderDays.keys()])].sort();
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

    // 상관은 순위와 판매가 둘 다 있는 날만 쓴다
    const paired = series.filter(p => p.rank !== null);
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
const AUTO_APPLY_MAX_CHANGE_PCT = 10; // 자동 반영 시 하루 변동 한도

function median(nums: number[]): number | null {
  const xs = nums.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

/** 원가와 수수료율을 지키면서 목표 이익률을 내는 최저 판매가 */
function floorPriceFor(unitCost: number, commissionRate: number, targetMarginRate: number): number | null {
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
    supabase.from('coupang_items').select('vendor_item_id, product_name, option_name, sale_price').eq('user_id', userId),
    supabase.from('coupang_costs').select('*').eq('user_id', userId),
    supabase.from('coupang_price_rules').select('*').eq('user_id', userId),
    supabase
      .from('coupang_sales_daily')
      .select('vendor_item_id, sales_amount, commission')
      .eq('user_id', userId)
      .gte('sale_date', addDays(today, -30)),
  ]);

  const costs = new Map<string, any>();
  for (const c of costRes.data ?? []) costs.set(String(c.vendor_item_id), c);
  const rules = new Map<string, any>();
  for (const r of ruleRes.data ?? []) rules.set(String(r.vendor_item_id), r);

  // 상품별 실제 수수료율 — 카테고리마다 달라 고정값을 쓰면 적자가 난다
  const feeAgg = new Map<string, { sales: number; fee: number }>();
  for (const s of salesRes.data ?? []) {
    const id = String(s.vendor_item_id);
    const cur = feeAgg.get(id) ?? { sales: 0, fee: 0 };
    cur.sales += Number(s.sales_amount) || 0;
    cur.fee += Number(s.commission) || 0;
    feeAgg.set(id, cur);
  }

  // 규칙에 걸린 키워드들의 시장가를 한 번에 모은다
  const keywords = [...new Set((ruleRes.data ?? []).map(r => String(r.target_keyword ?? '')).filter(Boolean))];
  const marketByKeyword = new Map<string, number>();
  if (keywords.length > 0) {
    const { data: obs } = await supabase
      .from('sourcing_product_obs')
      .select('keyword, price')
      .in('keyword', keywords)
      .gte('captured_at', `${addDays(today, -14)}T00:00:00Z`);
    const grouped = new Map<string, number[]>();
    for (const o of obs ?? []) {
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
  for (const it of itemRes.data ?? []) {
    const id = String(it.vendor_item_id);
    const rule = rules.get(id);
    const cost = costs.get(id);
    const unitCost =
      (Number(cost?.unit_cost) || 0) + (Number(cost?.packaging_cost) || 0) + (Number(cost?.shipping_cost) || 0);
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
): Promise<{ ok: boolean; error?: string }> {
  const suggestions = await buildPriceSuggestions(userId);
  const target = suggestions.find(s => s.vendorItemId === vendorItemId);
  if (!target) return { ok: false, error: '상품을 찾을 수 없습니다.' };

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

  const r = await coupangCall(creds, 'PUT', EP.vendorItemPrice(vendorItemId, Math.round(newPrice)), '');

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

  const result = await applyPrice(userId, credsOf(acc), vendorItemId, price, '수동 반영');
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

    const changePct = Math.abs((s.suggestedPrice - s.currentPrice) / s.currentPrice) * 100;
    if (changePct > AUTO_APPLY_MAX_CHANGE_PCT) {
      skipped++;
      continue;
    }
    const r = await applyPrice(userId, creds, s.vendorItemId, s.suggestedPrice, `자동 반영 · ${s.reason}`);
    if (r.ok) applied++;
    else skipped++;
  }

  return { applied, skipped };
}
