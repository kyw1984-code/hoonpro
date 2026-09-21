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

/** 광고 보고서 원본 저장 조각 크기 — 서버 한도 4.5MB에 넉넉히 못 미치게 */
const AD_RAW_CHUNK_BYTES = 1_500_000;
/** 원본 읽기 페이지 크기 */
const AD_RAW_PAGE_ROWS = 3000;

/** JSON 크기 기준으로 행을 나눈다. 한 조각이 maxBytes를 넘지 않게, 행 하나는 쪼개지 않는다 */
export function chunkByBytes<T>(rows: T[], maxBytes: number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const r of rows) {
    const n = JSON.stringify(r).length + 1;
    if (cur.length > 0 && size + n > maxBytes) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += n;
  }
  if (cur.length > 0) out.push(cur);
  return out;
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
  /** setting=설정값 × 수량 · exact=주문 할인 합계 그대로 · adjusted=수량 보정이 들어간 추정 */
  couponBasis?: 'setting' | 'exact' | 'adjusted' | null;
  /** 반품 재판매 옵션 — 쿠팡이 새 옵션ID로 반값에 다시 파는 것 */
  resale?: boolean;
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
    sources?: {
      setting: number; order: number; sheet: number; definedOptions: number;
      /** 확인한 주문 합계를 그대로 쓴 옵션 수 / 수량 보정이 들어간 옵션 수 */
      exact?: number; adjusted?: number;
    };
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
    growth: {
      quantity: number; salesAmount: number;
      /** 그로스에서 뺀 취소. 주문 API가 취소를 안 줘 추정(쿠팡 30일 집계 비율) 또는 판매분석 파일로 뺀다 */
      cancel?: { quantity: number; amount: number; estimateQty: number; fileQty: number; fileDays: number };
    };
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
  /** 판매가 출처 — 'detail' 상품 상세, 'sales' 최근 매출의 개당 금액(상세가 0을 준 로켓그로스 옵션) */
  priceSource?: 'detail' | 'sales' | null;
  /** 최근 주문에 실제로 붙은 개당 쿠폰. 판매가에서 이만큼 빼면 손님이 내는 값이다 */
  couponUnit?: number | null;
  stock: number | null;
  status: string;
  /** 'growth'면 로켓그로스 상품이다 — 입출고비 칸이 이 상품에만 뜬다 */
  businessType: string;
  /** 반품 재판매 옵션 — 순이익 계산은 이 줄의 원가를 0으로 본다 */
  resale?: boolean;
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

export interface MonthProfitRow {
  month: string;
  quantity: number;
  salesAmount: number;
  couponDiscount: number;
  commission: number;
  unitCost: number;
  returnCost: number;
  returnAmount: number;
  adCost: number;
  profit: number;
  marginRate: number;
  hasData: boolean;
  prevMonth: string | null;
  salesDelta: number | null;
  profitDelta: number | null;
  marginRateDelta: number | null;
  driver: { key: string; label: string; delta: number } | null;
}

export interface SettlementCheckRow {
  month: string;
  marketSettlement: number;
  growthSettlement: number;
  growthNet: number;
  coupangPaid: number | null;
  actual: number | null;
  returnQuantity: number;
  ours: number;
  reference: number | null;
  referenceSource: 'actual' | 'coupang' | null;
  diff: number | null;
  diffRate: number | null;
  impliedGrowthFeeRate: number | null;
  verdict: 'ok' | 'watch' | 'off' | 'pending' | 'unknown';
  /** 무엇끼리 견줬나 — market(윙만) / all(윙+그로스) */
  scope: 'market' | 'all';
  salesCovered: boolean;
  recognitionComplete: boolean;
  /** 아직 안 들어온 최종액(30%) */
  pendingLast: number;
  note: string | null;
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

/** 그로스 재고 대조 — 판매자가 적은 사입 주문·입고 한 건 */
export interface InboundRecord {
  id: string;
  /** baseline: 대조를 시작한 날의 재고 / inbound: 사입 주문 → 입고 */
  kind: 'inbound' | 'baseline';
  orderedAt: string | null;
  orderedQty: number;
  receivedAt: string | null;
  receivedQty: number | null;
  memo: string;
}

export type ReconcileStatus = 'match' | 'short' | 'over' | 'nobase';

export interface ReconcileRow {
  vendorItemId: string;
  productName: string;
  optionName: string;
  /** 쿠팡 로켓창고 판매가능 재고. 재고 응답에 없는 옵션이면 null */
  stock: number | null;
  stockSyncedAt: string | null;
  coupangSold30: number | null;
  hasBaseline: boolean;
  baselineQty: number | null;
  /** 셈을 시작하는 날 — 기준 재고일 또는 첫 입고 기록일 */
  startDate: string | null;
  orderedTotal: number;
  receivedTotal: number;
  /** 주문했는데 입고 기록이 없는 수량 */
  pendingQty: number;
  receivedAfter: number;
  soldAfter: number;
  expected: number | null;
  /** 쿠팡 재고 − 예상 재고. 음수면 보낸 것보다 적다 */
  diff: number | null;
  status: ReconcileStatus;
  records: InboundRecord[];
  snapshots: Array<{ date: string; qty: number }>;
}

export interface ReconcileResponse {
  rows: ReconcileRow[];
  counts: { tracked: number; short: number; over: number; pendingQty: number };
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

export interface SalesMoverRow {
  vendorItemId: string; productName: string; optionName: string; channel: 'wing' | 'growth';
  recentQty: number; prevQty: number; recentAmount: number; prevAmount: number; stock: number | null;
  pct: number | null; hints: string[];
}
export interface SalesMoversResponse { from: string; to: string; prevFrom: string; prevTo: string; drops: SalesMoverRow[]; rises: SalesMoverRow[] }

export type HealthKind = 'cost-missing' | 'thin-margin' | 'stock-low' | 'return-high' | 'idle' | 'stopped';
export interface HealthItem {
  kind: HealthKind; severity: 'high' | 'mid' | 'low';
  vendorItemId: string; productName: string; optionName: string; channel: 'growth' | 'marketplace'; detail: string;
}
export interface HealthReport { checkedAt: string; optionsChecked: number; counts: Record<HealthKind, number>; items: HealthItem[] }

export const coupangApi = {
  /** 훈프로 상품 진단 카드 — 옵션별 손볼 것 */
  healthCheck: () => request<HealthReport>('health-check'),
  /** 최근 7일 vs 그 전 7일 — 눈에 띄게 빠지거나 뛴 옵션 */
  salesMovers: () => request<SalesMoversResponse>('sales-movers'),

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
  /** 그로스 재고 대조 — 사입·입고 기록 대비 쿠팡 재고 */
  growthReconcile: () => request<ReconcileResponse>('growth-reconcile'),
  growthInboundSave: (body: {
    id?: string; vendorItemId: string; kind: 'inbound' | 'baseline';
    orderedAt?: string | null; orderedQty?: number; receivedAt?: string | null; receivedQty?: number | null; memo?: string;
  }) => request<{ ok: true; id: string }>('growth-inbound-save', { method: 'POST', body }),
  growthInboundDelete: (id: string) => request<{ ok: true }>('growth-inbound-delete', { method: 'POST', body: { id } }),
  /** 윙 즐겨찾기가 기록한 페이지 요청 경로(값 없음) — 서버 로그에만 남긴다 */
  wingCapture: (body: { page: string; ok: boolean; requests: unknown[] }) =>
    request<{ ok: true }>('wing-capture', { method: 'POST', body }),
  /** 쿠팡 판매분석 파일(옵션별)의 그로스 취소를 그 날짜 매출에 반영 */
  growthCancelUpload: (body: { date: string; rows: Array<{ vendorItemId: string; cancelQty: number; cancelAmount: number; grossQty?: number; grossAmount?: number }> }) =>
    request<{ ok: true; date: string; options: number; matched: number; cancelQty: number; cancelAmount: number; fileGross: number; ourGross: number }>('growth-cancel-upload', { method: 'POST', body }),
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

  /**
   * 광고 보고서 원본을 그대로 저장한다 — 광고분석AI가 파일 없이 읽는다.
   * 광고비만 뽑아 두던 것과 별개다. 키워드·노출·클릭·전환이 여기 남는다.
   */
  //
  // 서버는 요청·응답을 4.5MB에서 자른다(413). 한 달치 키워드 보고서는 그보다
  // 크므로 저장은 조각으로 보내고, 읽기는 페이지로 받아 이어 붙인다.
  adReportRawSave: async (body: { from: string; to: string; columns: string[]; rows: any[] }) => {
    const { rows, ...meta } = body;
    const chunks = chunkByBytes(rows, AD_RAW_CHUNK_BYTES);
    let last: { ok: true; rowCount: number; truncated: boolean; complete?: boolean } = { ok: true, rowCount: 0, truncated: false };
    for (let part = 0; part < chunks.length; part++) {
      // 조각 하나라도 실패하면 여기서 던진다. 서버는 마지막 조각을 받기 전까지
      // 보고서를 '미완성'으로 두므로 앞 조각만 남아 읽히는 일은 없다.
      last = await request<{ ok: true; rowCount: number; truncated: boolean; complete?: boolean }>('ad-report-raw-save', {
        method: 'POST',
        body: { ...meta, rows: chunks[part], part, parts: chunks.length },
      });
      if (last.truncated) break;
    }
    return last;
  },

  adReportRaw: async () => {
    type Page = { report: null | { from: string; to: string; columns: string[]; rows: any[]; rowCount: number; offset: number; hasMore: boolean; truncated: boolean; savedAt: string } };
    const first = await request<Page>(`ad-report-raw&offset=0&limit=${AD_RAW_PAGE_ROWS}`);
    if (!first.report) return { report: null };
    const rows = [...first.report.rows];
    let more = first.report.hasMore;
    while (more && rows.length < first.report.rowCount) {
      const page = await request<Page>(`ad-report-raw&offset=${rows.length}&limit=${AD_RAW_PAGE_ROWS}`);
      if (!page.report || page.report.rows.length === 0) break;
      rows.push(...page.report.rows);
      more = page.report.hasMore;
    }
    return { report: { ...first.report, rows } };
  },

  /** 옵션별 판매가·원가·입출고비 — 마진 계산 칸을 손으로 채우지 않게 */
  marginPreset: (days = 30) =>
    request<{
      from: string; to: string; days: number;
      items: { vendorItemId: string; productName: string; optionName: string; channel: string; quantity: number; unitPrice: number; couponPerUnit: number; unitCost: number; fulfillmentCost: number; returnRate: number; returnShippingCost: number; hasCost: boolean }[];
    }>(`margin-preset&days=${days}`),
  /** 광고센터가 준 파일 주소(S3 등)를 서버가 대신 받아 광고비를 저장한다 — 브라우저는 다른 도메인이라 못 읽는다 */
  adImportUrl: (url: string, from: string, to: string) =>
    request<{ ok: true; from: string; to: string; days: number; source: string; total: number }>('ad-import-url', {
      method: 'POST', body: { url, from, to },
    }),
  adCostDelete: (from: string, to: string) =>
    request<{ ok: true }>('ad-cost-delete', { method: 'POST', body: { from, to } }),
  saveCosts: (items: Array<Partial<CostRow> & { vendorItemId: string }>) =>
    request<{ ok: true; saved: number }>('cost-save', { method: 'POST', body: { items } }),
  /** 월별 순이익 리포트 — 지난달 대비 증감과 '왜 그랬는지' 한 줄 */
  profitMonthly: (months = 6) =>
    request<{ rows: MonthProfitRow[]; thisMonth: string; today: string }>(`profit-monthly&months=${months}`),
  settlement: () => request<SettlementResponse>('settlement'),
  /** 정산서 대조 — 우리 계산과 실제 지급액을 인식월끼리 맞춘 결과 */
  settlementCheck: (months = 6) =>
    request<{ rows: SettlementCheckRow[]; feeRate: number }>(`settlement-check&months=${months}`),
  /** 정산서에 적힌 실지급액을 옮겨 적는다. 0을 보내면 지운다 */
  settlementCheckSave: (month: string, actualAmount: number, note?: string) =>
    request<{ ok: true; month: string; actualAmount: number }>('settlement-check-save', {
      method: 'POST', body: { month, actualAmount, note },
    }),
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

/**
 * 이미 퍼센트인 값을 적는다. 12.5 → "12.5%"
 *
 * 비율(0.125)을 넘기면 조용히 100배 작게 나온다. 비율에는 ratioPct를 쓴다.
 * 이름이 같은 함수가 화면마다 따로 있었고 계약이 서로 반대여서, 한 줄을
 * 옮겨 붙이는 것만으로 숫자가 100배 어긋났다. 반품 화면 안에서 두 형제
 * 컴포넌트가 실제로 그 상태였다.
 */
export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return `${n.toFixed(digits)}%`;
}

/** 비율을 퍼센트로 적는다. 0.125 → "12.5%" */
export function ratioPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return `${(n * 100).toFixed(digits)}%`;
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
