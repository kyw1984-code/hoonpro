import { getToken } from './auth';

// 쿠팡 윙 연동 클라이언트 — /api/coupang 호출부를 한곳에 모은다.

export interface CoupangStatus {
  connected: boolean;
  vendorId?: string;
  accessKeyMasked?: string;
  status?: 'active' | 'invalid' | 'expired';
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  keyExpiresAt?: string | null;
  daysToExpiry?: number | null;
  itemCount?: number;
  salesDays?: number;
  /** 판매자가 윙에 등록해야 할 우리 서버 IP (중계 서버를 쓸 때만 값이 있다) */
  relayIp?: string | null;
  /** 주문수집 업체별 IP — 기존 프로그램과 함께 쓰려면 이 IP도 같이 등록해야 한다 */
  vendors?: { id: string; name: string; ips: string[] }[];
}

export interface CoupangVendor {
  id: string;
  name: string;
  ips: string[];
}

export interface SyncSummary {
  items: number;
  orders: number;
  sales: number;
  growth?: number;
  growthCancelled?: number;
  growthInventory?: number;
  /** 쿠폰 관리에서 받아 온 쿠폰-옵션 조합 수 */
  couponDefs?: number;
  settlements: number;
  returns: number;
  inquiries: number;
  errors: string[];
  truncated?: boolean;
}

async function request<T>(action: string, init?: { method?: 'GET' | 'POST'; body?: Record<string, unknown> }): Promise<T> {
  const token = getToken();
  if (!token) throw new Error('로그인이 필요합니다.');
  const method = init?.method ?? 'GET';
  const res = await fetch(`/api/coupang?action=${action}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: method === 'POST' ? JSON.stringify(init?.body ?? {}) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 402) {
      window.dispatchEvent(new CustomEvent('subscription-required', { detail: { message: data.error } }));
    }
    throw new Error(data.error ?? '요청에 실패했습니다.');
  }
  return data as T;
}

export interface ProfitRow {
  vendorItemId: string;
  productName: string;
  optionName: string;
  quantity: number;
  salesAmount: number;
  commission: number;
  settlementAmount: number;
  /** 같은 기간 주문에서 판매자가 부담한 쿠폰 할인 (즉시할인·다운로드쿠폰) */
  couponDiscount: number;
  /** 쿠폰 단가의 출처. setting=쿠폰 관리 설정값, order=주문별 쿠폰 조회, sheet=발주서 할인 항목 */
  couponSource?: 'setting' | 'order' | 'sheet' | null;
  /** 이 옵션에 붙은 광고비. 순이익(profit)에서 이미 뺀 값이다 */
  adCost: number;
  /** 이 행의 판매가 난 채널. 둘 다면 'both' */
  channel: 'marketplace' | 'growth' | 'both';
  /** 반품된 물건의 값(실판매가 × 반품수량). 매출에 애초에 안 잡힌 것이라 순이익에서 또 빼지 않는다 */
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

export interface ProfitDay {
  date: string;
  quantity: number;
  salesAmount: number;
  commission: number;
  /** 광고비를 빼기 전 순이익 (광고비는 날짜별로 상품에 나눌 수 없다) */
  profit: number;
}

export interface ProfitResponse {
  from: string;
  to: string;
  rows: ProfitRow[];
  totals: {
    quantity: number;
    salesAmount: number;
    commission: number;
    settlementAmount: number;
    unitCostTotal: number;
    returnCount: number;
    returnCost: number;
    profit: number;
    marginRate: number;
    couponDiscount: number;
    /** 옵션에 붙은 광고비 합. 일자별 합계(adCost.total)보다 작을 수 있다 */
    adCost: number;
    returnAmount: number;
  };
  /**
   * 판매가 기준 주문금액과 쿠폰. 판매가 39,800원에 쿠폰 10,000원이면 실제 판매가는
   * 29,800원인데, 매출내역만 봐서는 그게 안 보인다. 실매출 = orderAmount − sellerDiscount.
   */
  coupon?: {
    orderAmount: number;
    sellerDiscount: number;
    coupangDiscount: number;
    orderQuantity: number;
    /** 쿠폰 단가를 어디서 가져왔는지 — 옵션 수 */
    sources?: { setting: number; order: number; sheet: number; definedOptions: number };
  };
  missingCost: number;
  costCoverage: number;
  /** 판매자가 발행한 쿠폰 목록. 화면 숫자와 대조할 근거다 */
  couponList?: Array<{
    couponId: string;
    name: string;
    type: string;
    status: string;
    discount: number;
    startAt: string | null;
    endAt: string | null;
  }>;
  /**
   * 채널별 매출. 윙(마켓플레이스)은 매출인식일·정산예정액 기준이고,
   * 로켓그로스는 주문(결제일) 기준이라 성격이 달라 나눠 보여준다.
   */
  channels?: {
    marketplace: { quantity: number; salesAmount: number };
    growth: { quantity: number; salesAmount: number };
  };
  /** 기간 안의 모든 날짜. 판매가 없던 날도 0으로 채워져 있다 */
  daily: ProfitDay[];
  // 광고 보고서에서 받아 둔 이 기간 광고비. 하루도 없으면 null이다
  // (0으로 주면 '안 올린 것'과 '정말 0원'이 구분되지 않는다).
  adCostHint: number | null;
  adCost?: {
    total: number;
    coveredDays: number;
    spanDays: number;
    estimatedDays: number;
  };
  // 같은 길이의 직전 기간. hasData가 false면 그때 판매가 없어 증감률이 무의미하다.
  previous?: {
    from: string;
    to: string;
    salesAmount: number;
    quantity: number;
    commission: number;
    profit: number;
    hasData: boolean;
  };
}

export interface AdCostsResponse {
  from: string;
  to: string;
  days: { date: string; cost: number; source: string }[];
  total: number;
  spanDays: number;
}

export interface CostRow {
  vendorItemId: string;
  productName: string;
  optionName: string;
  salePrice: number | null;
  stock: number | null;
  status: string;
  /** 'growth'면 로켓그로스 상품이다 — 입출고비 칸이 이 상품에만 뜬다 */
  businessType: string;
  soldLast30: number;
  unitCost: number;
  packagingCost: number;
  shippingCost: number;
  /** 로켓그로스 입출고비 (개당). 판매자배송 상품에는 없는 비용이다. */
  fulfillmentCost: number;
  returnShippingCost: number;
  memo: string;
}

export interface SettlementDay {
  date: string;
  amount: number;
  items: Array<{ type: string; amount: number; status: string }>;
}

export interface SettlementResponse {
  today: string;
  days: SettlementDay[];
  totals: {
    paid: number;
    upcoming: number;
    in7: number;
    in30: number;
    unscheduled: number;
    weeklyAverage: number;
    weeksObserved: number;
  };
  weekly: Array<{ weekStart: string; amount: number }>;
}

export interface WeeklyReport {
  period_start: string;
  period_end: string;
  sent_at: string;
  summary: {
    quantity: number;
    salesAmount: number;
    profit: number;
    marginRate: number;
    returnCount: number;
    prevSalesAmount: number;
    prevProfit: number;
    // 그 주에 등록된 광고비. 예전 리포트에는 없어 옵셔널이다.
    adCost?: number;
    incoming: number;
    missingCost: number;
  };
}

export type StockRisk = 'out' | 'urgent' | 'watch' | 'ok' | 'idle' | 'excess';

export interface InventoryRow {
  vendorItemId: string;
  productName: string;
  optionName: string;
  stock: number;
  sold7: number;
  sold28: number;
  velocity: number;
  daysLeft: number | null;
  reorderQty: number;
  risk: StockRisk;
  /** 쿠팡이 집계한 최근 30일 판매수. 없으면 null */
  coupangSold30: number | null;
  /** 최근 14일 판매수 — 시즌이 끝났는지는 28일 평균보다 이쪽이 먼저 말해준다 */
  sold14: number;
  /** 발주 규칙: 자동 판단 / 항상 제외 / 항상 포함 */
  reorderMode: 'auto' | 'exclude' | 'always';
}

export interface InventoryResponse {
  rows: InventoryRow[];
  counts: Partial<Record<StockRisk, number>>;
  leadTimeDays: number;
  coverDays: number;
}

export interface ReturnRow {
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
  costEntered: boolean;
}

export interface ReturnsResponse {
  from: string;
  to: string;
  rows: ReturnRow[];
  reasons: Array<{ reason: string; count: number; share: number }>;
  totals: {
    count: number;
    quantity: number;
    soldQuantity: number;
    returnRate: number;
    shippingLoss: number;
    sellerFaultCount: number;
    exchangeCount: number;
    cancelledCount: number;
  };
  missingReturnCost: number;
}

export interface Inquiry {
  inquiryId: string;
  vendorItemId: string | null;
  productName: string;
  content: string;
  customerName: string;
  inquiredAt: string | null;
  answered: boolean;
  draft: string | null;
  draftAt: string | null;
  repliedAt: string | null;
}

export interface RankSeriesPoint {
  date: string;
  rank: number | null;
  quantity: number;
  amount: number;
}

export interface RankRevenueItem {
  keyword: string;
  productId: string;
  productName: string;
  status: 'ok' | 'few-days' | 'flat-rank' | 'no-orders';
  days: number;
  correlation: number | null;
  perStepQty: number | null;
  weeklyRevenuePerStep: number | null;
  avgPrice: number;
  latestRank: number | null;
  series: RankSeriesPoint[];
}

export interface PriceRow {
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

export interface PriceLog {
  vendor_item_id: string;
  old_price: number | null;
  new_price: number | null;
  reason: string | null;
  applied: boolean;
  error: string | null;
  created_at: string;
}

export const coupangApi = {
  status: () => request<CoupangStatus>('status'),
  adminVendors: () => request<{ vendors: CoupangVendor[] }>('admin-vendors'),
  adminVendorsSave: (vendors: CoupangVendor[]) =>
    request<{ ok: true; vendors: CoupangVendor[] }>('admin-vendors', { method: 'POST', body: { vendors } }),
  saveKey: (body: { vendorId: string; accessKey: string; secretKey: string; keyExpiresAt?: string }) =>
    request<{ ok: true; message: string }>('key-save', { method: 'POST', body }),
  deleteKey: () => request<{ ok: true }>('key-delete', { method: 'POST' }),
  sync: (full = false) => request<{ ok: true; summary: SyncSummary }>('sync', { method: 'POST', body: { full } }),
  profit: (days: number) => request<ProfitResponse>(`profit&days=${days}`),
  /** 날짜를 직접 골라 보는 순이익. from·to는 YYYY-MM-DD */
  profitRange: (from: string, to: string) => request<ProfitResponse>(`profit&from=${from}&to=${to}`),
  costs: () => request<{ rows: CostRow[] }>('costs'),
  adCosts: (days: number) => request<AdCostsResponse>(`ad-costs&days=${days}`),
  adCostSave: (body: {
    from: string; to: string; daily?: { date: string; cost: number }[]; total?: number; source?: 'report' | 'manual';
    /** 옵션별 광고비 — 보고서에 광고집행 옵션ID가 있을 때 */
    items?: { date: string; vendorItemId: string; cost: number }[];
    /** 진단용 — 보고서의 열 이름과 단위. 값은 보내지 않는다 */
    columns?: string[];
    dateGroup?: string;
  }) =>
    request<{ ok: true; from: string; to: string; days: number; source: string; total: number; attributed?: number }>('ad-cost-save', { method: 'POST', body }),
  /** 광고센터가 준 파일 주소(S3 등)를 서버가 대신 받아 광고비를 저장한다 — 브라우저는 다른 도메인이라 못 읽는다 */
  adImportUrl: (url: string, from: string, to: string) =>
    request<{ ok: true; from: string; to: string; days: number; source: string; total: number }>('ad-import-url', {
      method: 'POST', body: { url, from, to },
    }),
  adCostDelete: (from: string, to: string) =>
    request<{ ok: true }>('ad-cost-delete', { method: 'POST', body: { from, to } }),
  saveCosts: (items: Array<Partial<CostRow> & { vendorItemId: string }>) =>
    request<{ ok: true; saved: number }>('cost-save', { method: 'POST', body: { items } }),
  settlement: () => request<SettlementResponse>('settlement'),
  reports: () => request<{ reports: WeeklyReport[] }>('reports'),
  inventory: (leadTime: number, cover: number) =>
    request<InventoryResponse>(`inventory&leadTime=${leadTime}&cover=${cover}`),
  /** 발주 알림에서 이 옵션을 빼거나(exclude) 항상 넣거나(always) 자동으로 되돌린다(auto) */
  reorderRule: (vendorItemId: string, mode: 'auto' | 'exclude' | 'always') =>
    request<{ ok: true; vendorItemId: string; mode: string }>('reorder-rule', {
      method: 'POST', body: { vendorItemId, mode },
    }),
  returns: (days: number) => request<ReturnsResponse>(`returns&days=${days}`),
  inquiries: (all = false) => request<{ inquiries: Inquiry[] }>(`inquiries&all=${all}`),
  inquiryDraft: (inquiryId: string) =>
    request<{ ok: true; draft: string; remaining: number }>('inquiry-draft', { method: 'POST', body: { inquiryId } }),
  inquiryReply: (inquiryId: string, content: string) =>
    request<{ ok: true }>('inquiry-reply', { method: 'POST', body: { inquiryId, content } }),
  rankRevenue: () =>
    request<{ items: RankRevenueItem[]; minPairs: number; hint?: string }>('rank-revenue'),
  priceRules: () =>
    request<{ rows: PriceRow[]; logs: PriceLog[]; autoApplyMaxChangePct: number }>('price-rules'),
  savePriceRules: (items: Array<Partial<PriceRow> & { vendorItemId: string }>) =>
    request<{ ok: true; saved: number }>('price-rule-save', { method: 'POST', body: { items } }),
  applyPrice: (vendorItemId: string, price: number, expectedCurrentPrice: number | null) =>
    request<{ ok: true }>('price-apply', {
      method: 'POST',
      body: { vendorItemId, price, expectedCurrentPrice: expectedCurrentPrice ?? undefined },
    }),
};

// ── 표시 헬퍼 ─────────────────────────────────────────────────
export function won(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return `${n.toFixed(digits)}%`;
}

export function sinceText(iso: string | null | undefined): string {
  if (!iso) return '없음';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}
