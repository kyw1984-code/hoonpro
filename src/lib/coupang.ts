import { getToken } from './auth';

// 쿠팡 윙 연동 클라이언트 — /api/coupang 호출부를 한곳에 모은다.

export interface CoupangStatus {
  connected: boolean;
  vendorId?: string;
  accessKeyMasked?: string;
  status?: 'active' | 'invalid' | 'expired';
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  keyIssuedAt?: string | null;
  daysToExpiry?: number | null;
  itemCount?: number;
  salesDays?: number;
  /** 판매자가 윙에 등록해야 할 우리 서버 IP (중계 서버를 쓸 때만 값이 있다) */
  relayIp?: string | null;
}

export interface SyncSummary {
  items: number;
  orders: number;
  sales: number;
  settlements: number;
  returns: number;
  inquiries: number;
  errors: string[];
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
  unitCostTotal: number;
  returnCount: number;
  returnCost: number;
  profit: number;
  marginRate: number;
  costEntered: boolean;
  stock: number | null;
  salePrice: number | null;
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
  };
  missingCost: number;
  costCoverage: number;
  adCostHint: number | null;
  adReportAt: string | null;
}

export interface CostRow {
  vendorItemId: string;
  productName: string;
  optionName: string;
  salePrice: number | null;
  stock: number | null;
  status: string;
  soldLast30: number;
  unitCost: number;
  packagingCost: number;
  shippingCost: number;
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

export const coupangApi = {
  status: () => request<CoupangStatus>('status'),
  saveKey: (body: { vendorId: string; accessKey: string; secretKey: string; keyIssuedAt?: string }) =>
    request<{ ok: true; message: string }>('key-save', { method: 'POST', body }),
  deleteKey: () => request<{ ok: true }>('key-delete', { method: 'POST' }),
  sync: (full = false) => request<{ ok: true; summary: SyncSummary }>('sync', { method: 'POST', body: { full } }),
  profit: (days: number) => request<ProfitResponse>(`profit&days=${days}`),
  costs: () => request<{ rows: CostRow[] }>('costs'),
  saveCosts: (items: Array<Partial<CostRow> & { vendorItemId: string }>) =>
    request<{ ok: true; saved: number }>('cost-save', { method: 'POST', body: { items } }),
  settlement: () => request<SettlementResponse>('settlement'),
  reports: () => request<{ reports: WeeklyReport[] }>('reports'),
  inventory: (leadTime: number, cover: number) =>
    request<InventoryResponse>(`inventory&leadTime=${leadTime}&cover=${cover}`),
  returns: (days: number) => request<ReturnsResponse>(`returns&days=${days}`),
  inquiries: (all = false) => request<{ inquiries: Inquiry[] }>(`inquiries&all=${all}`),
  inquiryDraft: (inquiryId: string) =>
    request<{ ok: true; draft: string; remaining: number }>('inquiry-draft', { method: 'POST', body: { inquiryId } }),
  inquiryReply: (inquiryId: string, content: string) =>
    request<{ ok: true }>('inquiry-reply', { method: 'POST', body: { inquiryId, content } }),
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
