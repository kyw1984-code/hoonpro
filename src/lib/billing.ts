import { getToken } from './auth';

// 구독 결제 클라이언트 — /api/billing 호출 + 토스 카드등록 위젯 연동

export interface SubscriptionInfo {
  status: 'trial' | 'active' | 'past_due' | 'paused' | 'canceled';
  cardSummary: string | null;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  cancelAtPeriodEnd: boolean;
  failCount: number;
}

export interface PaymentRow {
  order_name: string;
  amount: number;
  discount: number;
  status: string;
  fail_reason: string | null;
  receipt_url: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface BillingStatus {
  billingEnforced: boolean;
  plan: { id: string; name: string; price: number } | null;
  subscription: SubscriptionInfo | null;
  payments: PaymentRow[];
}

export interface CouponPreview {
  valid: boolean;
  type: 'free_period' | 'percent' | 'amount';
  value: number;
  firstAmount: number;
  discount: number;
  description: string;
}

async function call<T>(action: string, body?: Record<string, unknown>): Promise<T> {
  const token = getToken();
  if (!token) throw new Error('로그인이 필요합니다.');
  const res = await fetch(`/api/billing?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '요청에 실패했습니다.');
  return data as T;
}

export const fetchBillingStatus = () => call<BillingStatus>('status');
export const validateCoupon = (code: string) => call<CouponPreview>('coupon-validate', { code });
export const subscribeWithCard = (authKey: string, customerKey: string, couponCode?: string) =>
  call<{ ok: boolean; status: string; nextBillingAt: string }>('subscribe', { authKey, customerKey, couponCode });
export const cancelSubscription = () => call<{ ok: boolean; canceledNow: boolean; usableUntil?: string }>('cancel');
export const resumeSubscription = () => call<{ ok: boolean }>('resume');
export const changeCard = (authKey: string, customerKey: string) =>
  call<{ ok: boolean; reactivated: boolean; cardSummary: string }>('change-card', { authKey, customerKey });
export const requestRefund = () => call<{ ok: boolean; refunded: number; message: string }>('refund');

// ── 토스 카드 등록 (리다이렉트 방식) ──────────────────────
// requestBillingAuth는 토스 카드 등록 페이지로 이동했다가 successUrl로 돌아온다.
// 돌아온 뒤 처리할 정보(모드·쿠폰)는 sessionStorage에 보관한다.

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => {
      requestBillingAuth: (method: '카드', params: Record<string, string>) => Promise<void>;
    };
  }
}

const TOSS_SDK_URL = 'https://js.tosspayments.com/v1/payment';
const PENDING_KEY = 'hoonpro_billing_pending';

let tossSdkPromise: Promise<void> | null = null;

function loadTossSdk(): Promise<void> {
  if (window.TossPayments) return Promise.resolve();
  if (!tossSdkPromise) {
    tossSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TOSS_SDK_URL;
      script.onload = () => resolve();
      script.onerror = () => { tossSdkPromise = null; reject(new Error('결제 모듈을 불러오지 못했습니다.')); };
      document.head.appendChild(script);
    });
  }
  return tossSdkPromise;
}

export function tossConfigured(): boolean {
  return Boolean(import.meta.env.VITE_TOSS_CLIENT_KEY);
}

export async function startCardRegistration(mode: 'subscribe' | 'change-card', couponCode?: string): Promise<void> {
  const clientKey = import.meta.env.VITE_TOSS_CLIENT_KEY;
  if (!clientKey) throw new Error('결제 설정이 완료되지 않았습니다. 관리자에게 문의하세요.');

  await loadTossSdk();
  const customerKey = crypto.randomUUID();
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ mode, couponCode: couponCode || null }));
  } catch {
    // sessionStorage를 못 쓰는 환경이면 기본(subscribe, 쿠폰 없음)으로 처리됨
  }

  const base = `${window.location.origin}${window.location.pathname}`;
  await window.TossPayments!(clientKey).requestBillingAuth('카드', {
    customerKey,
    successUrl: `${base}?billingAuth=success`,
    failUrl: `${base}?billingAuth=fail`,
  });
}

export interface BillingReturn {
  result: 'success' | 'fail' | null;
  authKey?: string;
  customerKey?: string;
  errorMessage?: string;
  mode: 'subscribe' | 'change-card';
  couponCode: string | null;
}

// 토스에서 돌아온 URL 파라미터를 읽고 주소창을 정리한다 (새로고침 시 중복 처리 방지)
export function consumeBillingReturn(): BillingReturn | null {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('billingAuth');
  if (result !== 'success' && result !== 'fail') return null;

  let pending: { mode: 'subscribe' | 'change-card'; couponCode: string | null } = { mode: 'subscribe', couponCode: null };
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (raw) pending = { ...pending, ...JSON.parse(raw) };
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // 기본값 사용
  }

  const ret: BillingReturn = {
    result,
    authKey: params.get('authKey') ?? undefined,
    customerKey: params.get('customerKey') ?? undefined,
    errorMessage: params.get('message') ?? undefined,
    mode: pending.mode,
    couponCode: pending.couponCode,
  };

  window.history.replaceState(null, '', window.location.pathname);
  return ret;
}
