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
function kstToday(): string {
  return kstNow().toISOString().slice(0, 10);
}
function addDays(dateStr: string, days: number): string {
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

  // 저장공간 관리 — 원본을 오래 들고 있을 이유가 없다
  const { count } = await supabase
    .from('coupang_returns')
    .delete({ count: 'exact' })
    .lt('requested_at', addDays(today, -365));
  result.purged = count ?? 0;
  await supabase.from('coupang_inquiries').delete().eq('answered', true).lt('inquired_at', addDays(today, -90));
  await supabase.from('coupang_price_logs').delete().lt('created_at', addDays(today, -180));

  return res.status(200).json({ ok: true, ...result });
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

// 주간 리포트는 3번 기능에서 구현한다 (아래에서 채운다).
async function cronWeeklyReport(res: VercelResponse) {
  return res.status(200).json({ ok: true, skipped: '주간 리포트는 아직 준비 중입니다.' });
}
