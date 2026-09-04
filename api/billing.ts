import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

// 구독 결제 통합 엔드포인트 (서버리스 함수 1개로 통합 — Vercel 함수 한도 대응)
//   subscribe        카드 등록(빌링키 발급) + 첫 결제 → 구독 활성화
//   plans            공개 요금표 (로그인 전 랜딩용)
//   status           내 구독 상태 + 결제 이력
//   coupon-validate  쿠폰 코드 검증 (CI 기준 1인 1회)
//   cancel / resume  기간 만료 해지 예약 / 예약 취소
//   change-card      카드 변경 (정지 상태면 즉시 재결제 시도)
//   refund           환불 — 7일 이내 미사용 전액, 그 외 잔여 기간 일할
//   webhook          토스 결제 상태 변경 수신 (paymentKey 재조회로 검증)
//   charge-due       크론 — 결제일 청구 + D+1/D+3 재시도 + 7일 전 사전 고지
//   admin-*          관리자 — 쿠폰 관리 / 구독 현황

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const TOSS_API = 'https://api.tosspayments.com';
const DEFAULT_PLAN_ID = 'yearly'; // 쿠폰 미리보기 기본값 — 연간 결제 유도
const RETRY_SCHEDULE_DAYS = [1, 2]; // 실패 1회차 → D+1, 2회차 → 추가 2일(D+3)
const MAX_FAIL = 3;

// 청구 주기 — 월간 1개월 / 연간 12개월, 일할 환불 기준일도 주기에 따름
function planMonths(plan: { interval?: string }): number {
  return plan?.interval === 'year' ? 12 : 1;
}
function planBaseDays(plan: { interval?: string }): number {
  return plan?.interval === 'year' ? 365 : 30;
}

// ── 공통 유틸 ─────────────────────────────────────────────

function tossHeaders(): Record<string, string> {
  const secret = process.env.TOSS_SECRET_KEY || '';
  return {
    Authorization: `Basic ${Buffer.from(`${secret}:`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

// 빌링키 암호화 (AES-256-GCM) — 카드번호는 토스가 보관하고 서버에는 빌링키만 암호화 저장
function encKey(): Buffer {
  const secret = process.env.BILLING_ENC_KEY || process.env.JWT_SECRET!;
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptBillingKey(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

function decryptBillingKey(enc: string): string {
  const [ivHex, tagHex, dataHex] = enc.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

// 결제일 계산은 한국 시간 기준
function kstNow(): Date {
  return new Date(Date.now() + 9 * 3600 * 1000);
}

function kstToday(): string {
  return kstNow().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// +N개월 (말일 보정: 1/31 → 2/28)
function addMonths(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

function newOrderId(): string {
  return `hp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function verifyAuth(req: VercelRequest): { userId: string; email: string; name: string; isAdmin: boolean } | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7), process.env.JWT_SECRET!) as any;
  } catch {
    return null;
  }
}

// 브랜드 이메일 템플릿 (api/auth/login.ts · api/auth/signup.ts와 동일 디자인)
function wrapEmail(heading: string, bodyHtml: string): string {
  return `<div style="margin:0;padding:24px 12px;background:#0b1020;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#141b31;border:1px solid #1c2542;border-radius:18px;overflow:hidden;">
    <div style="padding:22px 28px 0;">
      <span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:9px;background:linear-gradient(135deg,#7cf5ff,#8b7bff);color:#0b1020;font-weight:800;font-size:14px;">훈</span>
      <span style="margin-left:9px;font-size:14px;font-weight:600;color:#e8ecf5;vertical-align:middle;">쇼크트리 훈프로 <span style="color:#5a627a;font-weight:500;">AI 자동화</span></span>
    </div>
    <div style="padding:18px 28px 26px;">
      <h1 style="margin:0 0 14px;font-size:19px;line-height:1.4;color:#ffffff;font-weight:700;">${heading}</h1>
      <div style="font-size:14px;line-height:1.75;color:#b9c0d0;">${bodyHtml}</div>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #1c2542;font-size:11.5px;line-height:1.7;color:#5a627a;">
      본 메일은 발신 전용입니다. 결제 관련 문의는 서비스 내 [구독 관리]에서 확인해주세요.<br>
      <a href="https://hoonproai.com" style="color:#7cf5ff;text-decoration:none;">hoonproai.com</a>
    </div>
  </div>
</div>`;
}

// 본문 안에서 쓰는 버튼 (구독 관리로 유도)
function emailButton(label: string, href = 'https://hoonproai.com'): string {
  return `<div style="margin:20px 0 4px;"><a href="${href}" style="display:inline-block;padding:11px 20px;border-radius:10px;background:linear-gradient(135deg,#7cf5ff,#8b7bff);color:#0a0f1f;font-weight:700;font-size:13.5px;text-decoration:none;">${label}</a></div>`;
}

// 이메일 발송 (Resend) — 키가 없으면 조용히 스킵 (개발 환경)
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
    // 이메일 실패가 결제 흐름을 막지 않도록
  }
}

function won(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`;
}

// ── 쿠폰 ─────────────────────────────────────────────────

interface CouponRow {
  id: string;
  code: string;
  type: 'free_period' | 'percent' | 'amount';
  value: number;
  duration_cycles: number | null;
  max_redemptions: number | null;
  redeemed_count: number;
  expires_at: string | null;
  active: boolean;
}

// 쿠폰 유효성 검사 — 통과 시 null, 실패 시 사용자에게 보여줄 사유 반환
async function checkCoupon(coupon: CouponRow | null, userId: string, ci: string | null): Promise<string | null> {
  if (!coupon) return '존재하지 않는 쿠폰 코드입니다.';
  if (!coupon.active) return '사용이 중지된 쿠폰입니다.';
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return '유효기간이 지난 쿠폰입니다.';
  if (coupon.max_redemptions !== null && coupon.redeemed_count >= coupon.max_redemptions) {
    return '쿠폰 사용 한도가 모두 소진됐습니다.';
  }
  // 1인 1회: 같은 계정 또는 같은 CI(본인인증)로 이미 사용했으면 거부
  const { data: byUser } = await supabase
    .from('coupon_redemptions').select('id').eq('coupon_id', coupon.id).eq('user_id', userId).limit(1);
  if (byUser && byUser.length > 0) return '이미 사용한 쿠폰입니다.';
  if (ci) {
    const { data: byCi } = await supabase
      .from('coupon_redemptions').select('id').eq('coupon_id', coupon.id).eq('ci', ci).limit(1);
    if (byCi && byCi.length > 0) return '이미 사용한 쿠폰입니다.';
  }
  return null;
}

function couponPrice(coupon: CouponRow | null, price: number): { amount: number; discount: number } {
  if (!coupon) return { amount: price, discount: 0 };
  // 토스 최소 결제 금액(100원) 밑으로 내려가지 않게 할인 상한을 둔다
  // (0원 시작은 할인 쿠폰이 아니라 무료 기간 쿠폰으로 발급)
  const maxDiscount = Math.max(0, price - 100);
  if (coupon.type === 'percent') {
    const discount = Math.min(maxDiscount, Math.floor((price * coupon.value) / 100));
    return { amount: price - discount, discount };
  }
  if (coupon.type === 'amount') {
    const discount = Math.min(maxDiscount, coupon.value);
    return { amount: price - discount, discount };
  }
  return { amount: price, discount: 0 }; // free_period는 결제 없이 무료 기간 부여
}

// ── 토스 API ──────────────────────────────────────────────

async function tossIssueBillingKey(authKey: string, customerKey: string) {
  const res = await fetch(`${TOSS_API}/v1/billing/authorizations/issue`, {
    method: 'POST',
    headers: tossHeaders(),
    body: JSON.stringify({ authKey, customerKey }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data?.message || '카드 등록에 실패했습니다.');
  const company = data.cardCompany ?? data.card?.company ?? '';
  const number = data.cardNumber ?? data.card?.number ?? '';
  return {
    billingKey: data.billingKey as string,
    cardSummary: `${company} ${number.slice(-8)}`.trim(),
  };
}

interface ChargeResult {
  ok: boolean;
  paymentKey?: string;
  receiptUrl?: string;
  approvedAt?: string;
  failReason?: string;
}

async function tossCharge(
  billingKey: string,
  customerKey: string,
  orderId: string,
  amount: number,
  orderName: string,
  customerEmail: string,
  customerName: string
): Promise<ChargeResult> {
  try {
    const res = await fetch(`${TOSS_API}/v1/billing/${encodeURIComponent(billingKey)}`, {
      method: 'POST',
      headers: { ...tossHeaders(), 'Idempotency-Key': orderId },
      body: JSON.stringify({ customerKey, amount, orderId, orderName, customerEmail, customerName, taxFreeAmount: 0 }),
    });
    const data: any = await res.json();
    if (!res.ok) return { ok: false, failReason: data?.message || `결제 실패 (${data?.code || res.status})` };
    return {
      ok: true,
      paymentKey: data.paymentKey,
      receiptUrl: data.receipt?.url,
      approvedAt: data.approvedAt,
    };
  } catch (e: any) {
    return { ok: false, failReason: e?.message || '결제 요청 중 오류가 발생했습니다.' };
  }
}

async function tossCancelPayment(paymentKey: string, reason: string, cancelAmount?: number): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(`${TOSS_API}/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
    method: 'POST',
    headers: tossHeaders(),
    body: JSON.stringify(cancelAmount ? { cancelReason: reason, cancelAmount } : { cancelReason: reason }),
  });
  const data: any = await res.json();
  if (!res.ok) return { ok: false, message: data?.message || '환불 처리에 실패했습니다.' };
  return { ok: true };
}

// 정기 청구 1건 실행 — payments 기록 + 구독 상태 갱신까지 담당
async function chargeSubscription(sub: any, plan: any, user: any): Promise<{ ok: boolean; failReason?: string }> {
  // 쿠폰 할인 잔여 회차가 있으면 계속 반영
  let coupon: CouponRow | null = null;
  if (sub.coupon_id && (sub.coupon_remaining_cycles === null || sub.coupon_remaining_cycles > 0)) {
    const { data } = await supabase.from('coupons').select('*').eq('id', sub.coupon_id).maybeSingle();
    if (data && data.type !== 'free_period') coupon = data as CouponRow;
  }
  const { amount, discount } = couponPrice(coupon, plan.price);
  const orderId = newOrderId();
  const orderName = `${plan.name} 구독`;

  // 청구 전 선점 — 결제 성공 후 갱신 전에 함수가 중단돼도 다음 실행이 다시 청구하지 않도록
  // next_billing_at을 먼저 미뤄 둔다. (실패 시 아래에서 재시도 일자로 다시 조정)
  const claimDate = addDays(kstToday(), 1);
  const { data: claimed } = await supabase
    .from('subscriptions')
    .update({ next_billing_at: claimDate, updated_at: new Date().toISOString() })
    .eq('id', sub.id)
    .lte('next_billing_at', kstToday())
    .select('id');
  if (!claimed || claimed.length === 0) {
    // 다른 실행이 이미 이 구독을 가져갔다
    return { ok: false, failReason: 'already-claimed' };
  }

  const billingKey = decryptBillingKey(sub.billing_key_enc);
  const result = await tossCharge(billingKey, sub.customer_key, orderId, amount, orderName, user.email, user.name);

  await supabase.from('payments').insert({
    subscription_id: sub.id,
    user_id: sub.user_id,
    order_id: orderId,
    order_name: orderName,
    amount,
    discount,
    status: result.ok ? 'paid' : 'failed',
    payment_key: result.paymentKey ?? null,
    fail_reason: result.failReason ?? null,
    receipt_url: result.receiptUrl ?? null,
    approved_at: result.approvedAt ?? null,
  });

  const today = kstToday();
  if (result.ok) {
    const nextBilling = addMonths(today, planMonths(plan));
    await supabase.from('subscriptions').update({
      status: 'active',
      fail_count: 0,
      current_period_start: new Date().toISOString(),
      current_period_end: `${nextBilling}T00:00:00+09:00`,
      next_billing_at: nextBilling,
      coupon_remaining_cycles: coupon && sub.coupon_remaining_cycles !== null
        ? Math.max(0, sub.coupon_remaining_cycles - 1)
        : sub.coupon_remaining_cycles,
      updated_at: new Date().toISOString(),
    }).eq('id', sub.id);

    await sendEmail(user.email, `[훈프로] 결제 완료 — ${won(amount)}`, wrapEmail(
      `결제가 완료됐습니다`,
      `<p>${user.name}님, ${orderName} <b style="color:#e8ecf5;">${won(amount)}</b> 결제가 완료됐습니다.</p>` +
      `<p>다음 결제 예정일: <b style="color:#e8ecf5;">${nextBilling}</b></p>` +
      (result.receiptUrl ? emailButton('영수증 보기', result.receiptUrl) : emailButton('구독 관리 열기'))));
    return { ok: true };
  }

  // 실패: D+1 → D+3 재시도, 3회 누적 시 정지 (데이터는 보존)
  const failCount = (sub.fail_count ?? 0) + 1;
  if (failCount >= MAX_FAIL) {
    await supabase.from('subscriptions').update({
      status: 'paused', fail_count: failCount, next_billing_at: null, updated_at: new Date().toISOString(),
    }).eq('id', sub.id);
    await sendEmail(user.email, '[훈프로] 구독이 정지됐습니다', wrapEmail(
      '구독이 정지됐습니다',
      `<p>${user.name}님, 결제가 3회 실패해 구독이 정지됐습니다.</p>` +
      `<p style="color:#8a92a6;">사유: ${result.failReason}</p>` +
      `<p>관심 키워드·순위 추적 이력 등 데이터는 그대로 보존됩니다. 카드를 다시 등록하면 즉시 복구됩니다.</p>` +
      emailButton('카드 다시 등록하기')));
  } else {
    const retryDate = addDays(today, RETRY_SCHEDULE_DAYS[failCount - 1] ?? 2);
    await supabase.from('subscriptions').update({
      status: 'past_due', fail_count: failCount, next_billing_at: retryDate, updated_at: new Date().toISOString(),
    }).eq('id', sub.id);
    await sendEmail(user.email, '[훈프로] 결제 실패 안내', wrapEmail(
      '결제가 실패했습니다',
      `<p>${user.name}님, ${orderName} 결제가 실패했습니다.</p>` +
      `<p style="color:#8a92a6;">사유: ${result.failReason}</p>` +
      `<p><b style="color:#e8ecf5;">${retryDate}</b>에 다시 시도합니다. 카드 한도·유효기간을 확인하시거나 카드를 변경해주세요.</p>` +
      emailButton('카드 변경하기')));
  }
  return { ok: false, failReason: result.failReason };
}

// ── 핸들러 ────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = (req.query.action as string) || req.body?.action || '';

  try {
    // ── 크론 (CRON_SECRET 자체 인증) ──
    if (action === 'charge-due') return await chargeDue(req, res);

    // ── 토스 웹훅 (서명 없음 → paymentKey 재조회로 검증) ──
    if (action === 'webhook') return await tossWebhook(req, res);

    // ── 공개 요금표 (로그인 전 랜딩에서 가격을 보여주기 위해 인증 없이 제공) ──
    if (action === 'plans') {
      const { data } = await supabase
        .from('plans').select('id, name, price, interval')
        .eq('active', true).order('price', { ascending: false });
      return res.status(200).json({
        plans: (data ?? []).map(p => ({ ...p, interval: p.interval ?? 'month' })),
      });
    }

    // 이하 전부 로그인 필요
    const user = verifyAuth(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });

    if (action === 'status') return await getStatus(user, res);
    if (action === 'referral') return await getReferralCode(user, res);
    if (action === 'email-pref') return await emailPref(user, req, res);
    if (action === 'coupon-validate') return await couponValidate(user, req, res);
    if (action === 'subscribe') return await subscribe(user, req, res);
    if (action === 'cancel') return await cancelSubscription(user, req, res);
    if (action === 'resume') return await resumeSubscription(user, res);
    if (action === 'change-card') return await changeCard(user, req, res);
    if (action === 'refund') return await refund(user, res);

    // ── 관리자 ──
    if (action.startsWith('admin-')) {
      if (!user.isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
      if (action === 'admin-stats') return await adminStats(res);
      if (action === 'admin-coupons') return await adminCoupons(res);
      if (action === 'admin-coupon-create') return await adminCouponCreate(req, res);
      if (action === 'admin-coupon-update') return await adminCouponUpdate(req, res);
      if (action === 'admin-subscriptions') return await adminSubscriptions(res);
      if (action === 'admin-config') return await adminBillingConfig(req, res);
    }

    return res.status(400).json({ error: '잘못된 요청입니다.' });
  } catch (e: any) {
    console.error('[billing]', action, e);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}

// ── 사용자 액션 ───────────────────────────────────────────

async function getStatus(user: any, res: VercelResponse) {
  const [{ data: sub }, { data: planRows }, { data: cfg }] = await Promise.all([
    supabase.from('subscriptions').select('*').eq('user_id', user.userId).maybeSingle(),
    supabase.from('plans').select('*').eq('active', true).order('price', { ascending: false }),
    supabase.from('app_config').select('value').eq('key', 'billing_enforced').maybeSingle(),
  ]);
  const plans = (planRows ?? []).map(p => ({ id: p.id, name: p.name, price: p.price, interval: p.interval ?? 'month' }));
  const plan = plans.find(p => p.id === sub?.plan_id) ?? null;

  let payments: any[] = [];
  if (sub) {
    const { data } = await supabase
      .from('payments')
      .select('order_name, amount, discount, status, fail_reason, receipt_url, approved_at, created_at')
      .eq('user_id', user.userId)
      .order('created_at', { ascending: false })
      .limit(12);
    payments = data ?? [];
  }

  return res.status(200).json({
    billingEnforced: cfg?.value === 'true',
    plans,
    plan,
    subscription: sub ? {
      status: sub.status,
      cardSummary: sub.card_summary,
      currentPeriodEnd: sub.current_period_end,
      nextBillingAt: sub.next_billing_at,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      failCount: sub.fail_count,
    } : null,
    payments,
  });
}

async function couponValidate(user: any, req: VercelRequest, res: VercelResponse) {
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: '쿠폰 코드를 입력해주세요.' });
  const planId = String(req.body?.planId || DEFAULT_PLAN_ID);

  const [{ data: coupon }, { data: userRow }, { data: plan }] = await Promise.all([
    supabase.from('coupons').select('*').eq('code', code).maybeSingle(),
    supabase.from('users').select('ci').eq('id', user.userId).maybeSingle(),
    supabase.from('plans').select('price, interval').eq('id', planId).eq('active', true).maybeSingle(),
  ]);
  if (!plan) return res.status(400).json({ error: '플랜을 찾을 수 없습니다.' });

  const problem = await checkCoupon(coupon as CouponRow | null, user.userId, userRow?.ci ?? null);
  if (problem) return res.status(400).json({ error: problem });

  const c = coupon as CouponRow;
  const intervalLabel = plan.interval === 'year' ? '연' : '월';
  const { amount, discount } = couponPrice(c, plan.price);
  return res.status(200).json({
    valid: true,
    type: c.type,
    value: c.value,
    durationCycles: c.duration_cycles,
    firstAmount: c.type === 'free_period' ? 0 : amount,
    discount,
    description: c.type === 'free_period'
      ? `${c.value}일 무료 이용 후 ${won(plan.price)}/${intervalLabel} 자동결제`
      : `첫 ${c.duration_cycles === null ? '매' : c.duration_cycles + '회'} 결제 ${won(amount)} (${won(discount)} 할인)`,
  });
}

async function subscribe(user: any, req: VercelRequest, res: VercelResponse) {
  const { authKey, customerKey, couponCode } = req.body ?? {};
  const planId = String(req.body?.planId || DEFAULT_PLAN_ID);
  if (!authKey || !customerKey) return res.status(400).json({ error: '카드 등록 정보가 없습니다.' });
  if (!process.env.TOSS_SECRET_KEY) return res.status(500).json({ error: '결제 설정이 완료되지 않았습니다. 관리자에게 문의하세요.' });

  const [{ data: existing }, { data: userRow }, { data: plan }] = await Promise.all([
    supabase.from('subscriptions').select('*').eq('user_id', user.userId).maybeSingle(),
    supabase.from('users').select('ci, email, name').eq('id', user.userId).maybeSingle(),
    supabase.from('plans').select('*').eq('id', planId).eq('active', true).maybeSingle(),
  ]);
  if (!plan) return res.status(400).json({ error: '플랜 정보를 찾을 수 없습니다.' });
  if (existing && ['trial', 'active', 'past_due'].includes(existing.status)) {
    return res.status(409).json({ error: '이미 구독 중입니다. 카드 변경은 마이페이지에서 해주세요.' });
  }

  // 쿠폰 검증
  let coupon: CouponRow | null = null;
  if (couponCode) {
    const { data } = await supabase.from('coupons').select('*').eq('code', String(couponCode).trim().toUpperCase()).maybeSingle();
    const problem = await checkCoupon(data as CouponRow | null, user.userId, userRow?.ci ?? null);
    if (problem) return res.status(400).json({ error: problem });
    coupon = data as CouponRow;
  }

  // 빌링키 발급 (카드번호는 토스 보관, 우리는 암호화된 빌링키만 저장)
  const { billingKey, cardSummary } = await tossIssueBillingKey(authKey, customerKey);
  const billingKeyEnc = encryptBillingKey(billingKey);

  const today = kstToday();
  const isTrial = coupon?.type === 'free_period';
  const periodEnd = isTrial ? addDays(today, coupon!.value) : addMonths(today, planMonths(plan));
  const { amount, discount } = couponPrice(coupon, plan.price);

  const subFields = {
    user_id: user.userId,
    plan_id: plan.id,
    status: isTrial ? 'trial' : 'active',
    billing_key_enc: billingKeyEnc,
    customer_key: customerKey,
    card_summary: cardSummary,
    coupon_id: coupon?.id ?? null,
    // 무료 기간 쿠폰은 여기서 소진 / 할인 쿠폰은 첫 결제에 1회 적용 후 잔여 회차 기록
    coupon_remaining_cycles: coupon && !isTrial
      ? (coupon.duration_cycles === null ? null : Math.max(0, coupon.duration_cycles - 1))
      : 0,
    current_period_start: new Date().toISOString(),
    current_period_end: `${periodEnd}T00:00:00+09:00`,
    next_billing_at: periodEnd,
    fail_count: 0,
    cancel_at_period_end: false,
    canceled_at: null,
    updated_at: new Date().toISOString(),
  };

  let subId: string;
  if (existing) {
    const { error } = await supabase.from('subscriptions').update(subFields).eq('id', existing.id);
    if (error) return res.status(500).json({ error: '구독 정보를 저장하지 못했습니다.' });
    subId = existing.id;
  } else {
    const { data, error } = await supabase.from('subscriptions').insert(subFields).select('id').single();
    if (error || !data) return res.status(500).json({ error: '구독 정보를 저장하지 못했습니다.' });
    subId = data.id;
  }

  // 첫 결제 (무료 기간 쿠폰이면 0원 — 결제 없이 시작)
  if (!isTrial) {
    const orderId = newOrderId();
    const orderName = `${plan.name} 구독`;
    const result = await tossCharge(billingKey, customerKey, orderId, amount, orderName, userRow?.email ?? user.email, userRow?.name ?? user.name);

    await supabase.from('payments').insert({
      subscription_id: subId,
      user_id: user.userId,
      order_id: orderId,
      order_name: orderName,
      amount,
      discount,
      status: result.ok ? 'paid' : 'failed',
      payment_key: result.paymentKey ?? null,
      fail_reason: result.failReason ?? null,
      receipt_url: result.receiptUrl ?? null,
      approved_at: result.approvedAt ?? null,
    });

    if (!result.ok) {
      // 첫 결제 실패 → 구독을 시작하지 않음
      await supabase.from('subscriptions').update({ status: 'canceled', canceled_at: new Date().toISOString() }).eq('id', subId);
      return res.status(402).json({ error: `결제에 실패했습니다: ${result.failReason}` });
    }

    await sendEmail(userRow?.email ?? user.email, `[훈프로] 구독 시작 — ${won(amount)} 결제 완료`, wrapEmail(
      '구독이 시작됐습니다',
      `<p>${userRow?.name ?? user.name}님, ${orderName} 구독이 시작됐습니다. 이제 모든 AI 도구를 이용할 수 있습니다.</p>` +
      `<p>결제 금액: <b style="color:#e8ecf5;">${won(amount)}</b>${discount > 0 ? ` (쿠폰 할인 ${won(discount)})` : ''}<br>다음 결제일: <b style="color:#e8ecf5;">${periodEnd}</b></p>` +
      (result.receiptUrl ? emailButton('영수증 보기', result.receiptUrl) : emailButton('훈프로 열기'))));
  } else {
    await sendEmail(userRow?.email ?? user.email, `[훈프로] 무료 이용 시작 (${coupon!.value}일)`, wrapEmail(
      '무료 이용이 시작됐습니다',
      `<p>${userRow?.name ?? user.name}님, 지금부터 모든 AI 도구를 무료로 이용할 수 있습니다.</p>` +
      `<p>무료 기간 종료일 <b style="color:#e8ecf5;">${periodEnd}</b>부터 ${won(plan.price)}/${plan.interval === 'year' ? '연' : '월'}이 등록하신 카드로 자동결제됩니다.<br>그 전에 언제든 해지하실 수 있고, 해지하면 결제되지 않습니다.</p>` +
      emailButton('훈프로 열기')));
  }

  // 쿠폰 사용 기록 (CI 기준 1인 1회 어뷰징 차단)
  if (coupon) {
    // unique 제약(coupon_id+user_id, coupon_id+ci)이 동시 요청의 중복 사용을 막는다.
    // 삽입이 실패하면 이미 사용한 쿠폰이므로 사용 횟수를 올리지 않는다.
    const { error: redeemError } = await supabase.from('coupon_redemptions').insert({
      coupon_id: coupon.id,
      user_id: user.userId,
      ci: userRow?.ci ?? null,
      subscription_id: subId,
    });
    if (!redeemError) {
      await supabase.rpc('increment_coupon_redeemed', { p_coupon_id: coupon.id })
        .then(async ({ error }) => {
          // RPC가 없는 환경(마이그레이션 전)에서는 기존 방식으로 보정
          if (error) await supabase.from('coupons').update({ redeemed_count: coupon.redeemed_count + 1 }).eq('id', coupon.id);
        });
    } else {
      console.warn('[billing] coupon redemption already recorded', coupon.id, user.userId);
    }
  }

  return res.status(200).json({ ok: true, status: isTrial ? 'trial' : 'active', nextBillingAt: periodEnd });
}

async function cancelSubscription(user: any, req: VercelRequest, res: VercelResponse) {
  const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', user.userId).maybeSingle();
  if (!sub || sub.status === 'canceled') return res.status(404).json({ error: '진행 중인 구독이 없습니다.' });

  // 정지 상태는 즉시 종료, 그 외에는 남은 기간까지 이용 후 종료 (자동결제만 중단)
  if (sub.status === 'paused') {
    await supabase.from('subscriptions').update({
      status: 'canceled', canceled_at: new Date().toISOString(), next_billing_at: null, updated_at: new Date().toISOString(),
    }).eq('id', sub.id);
    return res.status(200).json({ ok: true, canceledNow: true });
  }

  await supabase.from('subscriptions').update({
    cancel_at_period_end: true, canceled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', sub.id);
  return res.status(200).json({ ok: true, canceledNow: false, usableUntil: sub.current_period_end });
}

async function resumeSubscription(user: any, res: VercelResponse) {
  const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', user.userId).maybeSingle();
  if (!sub || !sub.cancel_at_period_end || sub.status === 'canceled') {
    return res.status(400).json({ error: '해지 예약 상태가 아닙니다.' });
  }
  await supabase.from('subscriptions').update({
    cancel_at_period_end: false, canceled_at: null, updated_at: new Date().toISOString(),
  }).eq('id', sub.id);
  return res.status(200).json({ ok: true });
}

async function changeCard(user: any, req: VercelRequest, res: VercelResponse) {
  const { authKey, customerKey } = req.body ?? {};
  if (!authKey || !customerKey) return res.status(400).json({ error: '카드 등록 정보가 없습니다.' });

  const [{ data: sub }, { data: userRow }] = await Promise.all([
    supabase.from('subscriptions').select('*').eq('user_id', user.userId).maybeSingle(),
    supabase.from('users').select('email, name').eq('id', user.userId).maybeSingle(),
  ]);
  if (!sub || sub.status === 'canceled') return res.status(404).json({ error: '진행 중인 구독이 없습니다.' });
  const { data: plan } = await supabase.from('plans').select('*').eq('id', sub.plan_id).maybeSingle();

  const { billingKey, cardSummary } = await tossIssueBillingKey(authKey, customerKey);
  await supabase.from('subscriptions').update({
    billing_key_enc: encryptBillingKey(billingKey),
    customer_key: customerKey,
    card_summary: cardSummary,
    updated_at: new Date().toISOString(),
  }).eq('id', sub.id);

  // 결제 실패로 밀려 있거나 정지 상태면 새 카드로 즉시 재결제 → 성공 시 즉시 복구
  if (sub.status === 'past_due' || sub.status === 'paused') {
    // fail_count는 유지한 채 청구한다. 리셋하면 정지 계정이 실패해도 past_due(이용 허용)로
    // 되살아나 카드 변경만 반복해 무료로 쓸 수 있다. 성공 시에는 chargeSubscription이 0으로 되돌린다.
    const fresh = {
      ...sub,
      billing_key_enc: encryptBillingKey(billingKey),
      customer_key: customerKey,
      // 즉시 청구를 시도해야 하므로 선점 조건(next_billing_at <= 오늘)을 만족시킨다
      next_billing_at: kstToday(),
    };
    await supabase.from('subscriptions').update({ next_billing_at: kstToday() }).eq('id', sub.id);
    const result = await chargeSubscription(fresh, plan, userRow ?? user);
    if (!result.ok) {
      // 실패했으면 정지 상태를 유지한다 (이용 재개 금지)
      if (sub.status === 'paused') {
        await supabase.from('subscriptions')
          .update({ status: 'paused', next_billing_at: null, updated_at: new Date().toISOString() })
          .eq('id', sub.id);
      }
      return res.status(402).json({ error: `카드는 변경됐지만 결제에 실패했습니다: ${result.failReason}` });
    }
    return res.status(200).json({ ok: true, reactivated: true, cardSummary });
  }

  return res.status(200).json({ ok: true, reactivated: false, cardSummary });
}

// 환불(확정 정책): 결제 후 7일 이내 + 사용 이력 없음 → 전액 / 그 외 → 잔여 기간 일할 (월요금÷30, 원단위 절사)
async function refund(user: any, res: VercelResponse) {
  const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', user.userId).maybeSingle();
  if (!sub || sub.status === 'canceled') return res.status(404).json({ error: '진행 중인 구독이 없습니다.' });

  const endNow = {
    status: 'canceled',
    canceled_at: new Date().toISOString(),
    current_period_end: new Date().toISOString(),
    next_billing_at: null,
    cancel_at_period_end: false,
    updated_at: new Date().toISOString(),
  };

  // 무료 기간 중이거나 결제 이력이 없으면 환불 금액 없이 즉시 종료
  const { data: payment } = await supabase
    .from('payments')
    .select('*')
    .eq('subscription_id', sub.id)
    .eq('status', 'paid')
    .gt('amount', 0)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sub.status === 'trial' || !payment?.payment_key) {
    await supabase.from('subscriptions').update(endNow).eq('id', sub.id);
    return res.status(200).json({ ok: true, refunded: 0, message: '결제 이력이 없어 즉시 해지 처리됐습니다.' });
  }

  const approvedAt = new Date(payment.approved_at ?? payment.created_at);
  const within7Days = Date.now() - approvedAt.getTime() <= 7 * 86400000;

  // 사용 이력 판정 — 과금되는 모든 기능을 포함해야 한다.
  //  · api_calls  : 썸네일·상세페이지·이미지 분석·QA (모델 호출 로깅)
  //  · api_usage  : 소싱AI·리뷰 분석·순위 추적 (increment_usage만 호출하고
  //                 api_calls에는 남기지 않는다 — 여기를 빠뜨리면 원가가 큰
  //                 소싱 기능만 일주일 쓰고 전액 환불받는 우회가 가능하다)
  // 조회가 실패하면 "사용함"으로 간주해 전액 환불로 흘러가지 않게 한다.
  const usedFrom = approvedAt.toISOString();
  const usedFromDate = usedFrom.slice(0, 10);
  const [callsRes, usageRes] = await Promise.all([
    supabase.from('api_calls')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.userId)
      .gte('created_at', usedFrom),
    supabase.from('api_usage')
      .select('call_count')
      .eq('user_id', user.userId)
      .gte('date', usedFromDate)
      .gt('call_count', 0)
      .limit(1),
  ]);
  const unusedConfirmed =
    !callsRes.error && (callsRes.count ?? 0) === 0 &&
    !usageRes.error && (usageRes.data?.length ?? 0) === 0;

  let refundAmount: number;
  let reason: string;
  if (within7Days && unusedConfirmed) {
    refundAmount = payment.amount;
    reason = '7일 이내 미사용 전액 환불';
  } else {
    const { data: subPlan } = await supabase.from('plans').select('interval').eq('id', sub.plan_id).maybeSingle();

    if (subPlan?.interval === 'year') {
      // 연간 해지: 할인 없는 월간 요금으로 사용 기간을 재정산한 뒤 차액 환불
      // 환불액 = 연간 결제액 − (월간 요금 ÷ 30 × 사용일수, 사용일은 올림)
      const { data: monthlyPlan } = await supabase
        .from('plans').select('price').eq('interval', 'month').eq('active', true).maybeSingle();
      const monthlyPrice = monthlyPlan?.price ?? 39800;
      const usedDays = Math.max(1, Math.ceil((Date.now() - approvedAt.getTime()) / 86400000));
      const usedCharge = Math.floor((monthlyPrice / 30) * usedDays);
      refundAmount = Math.max(0, payment.amount - usedCharge);
      reason = `연간 해지 재정산 (사용 ${usedDays}일 × 월간 요금 일할 ${won(usedCharge)} 차감)`;
    } else {
      // 월간 해지: 잔여 기간 일할 환불 (÷30)
      const periodEnd = new Date(sub.current_period_end);
      const remainingDays = Math.max(0, Math.floor((periodEnd.getTime() - Date.now()) / 86400000));
      refundAmount = Math.floor((payment.amount / planBaseDays(subPlan ?? {})) * remainingDays);
      reason = `잔여 ${remainingDays}일 일할 환불`;
    }
  }

  if (refundAmount > 0) {
    const cancel = await tossCancelPayment(
      payment.payment_key,
      reason,
      refundAmount === payment.amount ? undefined : refundAmount
    );
    if (!cancel.ok) return res.status(502).json({ error: `환불 처리에 실패했습니다: ${cancel.message}` });
    await supabase.from('payments').update({
      status: refundAmount === payment.amount ? 'refunded' : 'partial_refund',
    }).eq('id', payment.id);
  }

  await supabase.from('subscriptions').update(endNow).eq('id', sub.id);
  await sendEmail(user.email, '[훈프로] 환불 및 해지 완료', wrapEmail(
    '환불 및 해지가 완료됐습니다',
    `<p>${user.name}님, 구독이 해지됐습니다.</p>` +
    `<p>환불 금액: <b style="color:#e8ecf5;">${won(refundAmount)}</b><br><span style="color:#8a92a6;">${reason}</span></p>` +
    `<p style="color:#8a92a6;">카드사 사정에 따라 환불 반영까지 3~7영업일이 소요될 수 있습니다.</p>`));
  return res.status(200).json({ ok: true, refunded: refundAmount, message: reason });
}

// ── 웹훅 ─────────────────────────────────────────────────

// 토스 웹훅에는 서명이 없으므로 수신값을 믿지 않고 paymentKey로 결제를 재조회해 반영
async function tossWebhook(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const paymentKey = req.body?.data?.paymentKey || req.body?.paymentKey;
  if (!paymentKey || !process.env.TOSS_SECRET_KEY) return res.status(200).json({ ok: true });

  const lookup = await fetch(`${TOSS_API}/v1/payments/${encodeURIComponent(paymentKey)}`, { headers: tossHeaders() });
  if (!lookup.ok) return res.status(200).json({ ok: true });
  const payment: any = await lookup.json();

  const statusMap: Record<string, string> = {
    DONE: 'paid',
    CANCELED: 'refunded',
    PARTIAL_CANCELED: 'partial_refund',
    ABORTED: 'failed',
    EXPIRED: 'failed',
  };
  const mapped = statusMap[payment.status];
  if (mapped && payment.orderId) {
    await supabase.from('payments').update({
      status: mapped,
      payment_key: payment.paymentKey,
      receipt_url: payment.receipt?.url ?? null,
      approved_at: payment.approvedAt ?? null,
    }).eq('order_id', payment.orderId);
  }
  return res.status(200).json({ ok: true });
}

// ── 크론: 결제일 청구 + 사전 고지 ─────────────────────────

async function chargeDue(req: VercelRequest, res: VercelResponse) {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const bearer = req.headers.authorization;
  const admin = verifyAuth(req);
  if (!(cronSecret && bearer === `Bearer ${cronSecret}`) && !admin?.isAdmin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const today = kstToday();
  const summary = { charged: 0, failed: 0, canceled: 0, notified: 0 };

  // 1) 결제 7일 전 사전 고지 (여신전문금융업법 의무)
  const noticeDate = addDays(today, 7);
  const { data: upcoming } = await supabase
    .from('subscriptions')
    .select('*, users(email, name), plans(name, price)')
    .in('status', ['trial', 'active'])
    .eq('next_billing_at', noticeDate)
    .eq('cancel_at_period_end', false);

  for (const sub of upcoming ?? []) {
    const u = (sub as any).users, p = (sub as any).plans;
    if (!u?.email) continue;
    await sendEmail(u.email, `[훈프로] ${noticeDate} 정기결제 예정 안내`, wrapEmail(
      '정기결제 예정 안내',
      `<p>${u.name}님, <b style="color:#e8ecf5;">${noticeDate}</b>에 ${p?.name ?? '훈프로'} 구독 요금 <b style="color:#e8ecf5;">${won(p?.price ?? 0)}</b>이 등록하신 카드(${sub.card_summary ?? ''})로 자동결제될 예정입니다.</p>` +
      `<p>결제를 원치 않으시면 그 전에 해지해주세요. 해지해도 남은 기간까지는 그대로 이용할 수 있습니다.</p>` +
      emailButton('구독 관리 열기')));
    summary.notified++;
  }

  // 2) 오늘이 결제일인 구독 청구
  const { data: due } = await supabase
    .from('subscriptions')
    .select('*, users(email, name), plans!inner(id, name, price, interval)')
    .in('status', ['trial', 'active', 'past_due'])
    .lte('next_billing_at', today);

  for (const sub of due ?? []) {
    const u = (sub as any).users, p = (sub as any).plans;

    // 해지 예약된 구독은 기간 종료와 함께 종료 (청구 없음)
    if (sub.cancel_at_period_end) {
      await supabase.from('subscriptions').update({
        status: 'canceled', next_billing_at: null, updated_at: new Date().toISOString(),
      }).eq('id', sub.id);
      summary.canceled++;
      continue;
    }
    if (!sub.billing_key_enc) {
      await supabase.from('subscriptions').update({ status: 'paused', next_billing_at: null }).eq('id', sub.id);
      continue;
    }
    const result = await chargeSubscription(sub, p, u ?? { email: '', name: '' });
    result.ok ? summary.charged++ : summary.failed++;
  }

  return res.status(200).json({ ok: true, date: today, ...summary });
}

// ── 관리자 ────────────────────────────────────────────────

// 알림 이메일 수신 설정 — 순위·주간 리포트 메일에만 적용 (결제 메일은 항상 발송)
async function emailPref(user: { userId: string }, req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    const optOut = req.body?.optOut === true;
    const { error } = await supabase.from('users').update({ email_opt_out: optOut }).eq('id', user.userId);
    if (error) return res.status(500).json({ error: '설정 저장에 실패했습니다. (users 테이블에 email_opt_out 컬럼이 있는지 확인)' });
    return res.status(200).json({ optOut });
  }
  const { data } = await supabase.from('users').select('email_opt_out').eq('id', user.userId).maybeSingle();
  return res.status(200).json({ optOut: data?.email_opt_out === true });
}

// 친구 추천 — 사용자마다 개인 추천 코드(첫 결제 10% 할인 쿠폰)를 만들어준다.
// 쿠폰 시스템을 그대로 재활용: note='referral:{userId}'로 소유자를 식별하고,
// 사용 횟수는 coupons.redeemed_count로 확인한다 (추천 보상은 관리자가 쿠폰으로 지급).
async function getReferralCode(user: { userId: string }, res: VercelResponse) {
  const note = `referral:${user.userId}`;
  let { data: existing } = await supabase.from('coupons').select('*').eq('note', note).maybeSingle();
  if (!existing) {
    for (let attempt = 0; attempt < 3 && !existing; attempt++) {
      const code = 'HOON-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      const { data, error } = await supabase.from('coupons').insert({
        code,
        type: 'percent',
        value: 10,
        duration_cycles: 1,
        max_redemptions: null,
        expires_at: null,
        note,
      }).select('*').single();
      if (!error) existing = data;
      else if (error.code !== '23505') return res.status(500).json({ error: '추천 코드 생성에 실패했습니다.' });
    }
    if (!existing) return res.status(500).json({ error: '추천 코드 생성에 실패했습니다.' });
  }
  return res.status(200).json({
    code: existing.code,
    type: existing.type,
    value: existing.value,
    redeemedCount: existing.redeemed_count ?? 0,
    active: existing.active !== false,
  });
}

// 수익 요약 — 구독자 수(상태별)·MRR 추정·최근 30일 결제액·해지 수
async function adminStats(res: VercelResponse) {
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: subs }, { data: planRows }, { data: pays }] = await Promise.all([
    supabase.from('subscriptions').select('status, plan_id, canceled_at, updated_at'),
    supabase.from('plans').select('id, price, interval'),
    supabase.from('payments').select('amount, status, created_at').gte('created_at', monthAgo),
  ]);
  const planMap = new Map((planRows ?? []).map(p => [p.id, p]));
  const counts: Record<string, number> = { trial: 0, active: 0, past_due: 0, paused: 0, canceled: 0 };
  let mrr = 0;
  let canceled30d = 0;
  for (const s of subs ?? []) {
    counts[s.status] = (counts[s.status] || 0) + 1;
    if (['active', 'past_due'].includes(s.status)) {
      const p = planMap.get(s.plan_id);
      if (p) mrr += p.interval === 'year' ? Math.round(Number(p.price) / 12) : Number(p.price);
    }
    if (s.status === 'canceled' && s.canceled_at && s.canceled_at >= monthAgo) canceled30d += 1;
  }
  const paidList = (pays ?? []).filter(p => p.status === 'paid');
  const failedList = (pays ?? []).filter(p => p.status === 'failed');
  return res.status(200).json({
    counts,
    totalSubscribers: counts.trial + counts.active + counts.past_due,
    mrr,
    revenue30d: paidList.reduce((s, p) => s + Number(p.amount || 0), 0),
    payments30d: paidList.length,
    failed30d: failedList.length,
    canceled30d,
  });
}

async function adminCoupons(res: VercelResponse) {
  const { data } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
  return res.status(200).json({ coupons: data ?? [] });
}

async function adminCouponCreate(req: VercelRequest, res: VercelResponse) {
  const { code, type, value, durationCycles, maxRedemptions, expiresAt, note } = req.body ?? {};
  if (!code || !type || !value) return res.status(400).json({ error: '코드·유형·값은 필수입니다.' });
  if (!['free_period', 'percent', 'amount'].includes(type)) return res.status(400).json({ error: '잘못된 쿠폰 유형입니다.' });
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0 || (type === 'percent' && v > 100)) {
    return res.status(400).json({ error: '쿠폰 값이 올바르지 않습니다.' });
  }

  const { data, error } = await supabase.from('coupons').insert({
    code: String(code).trim().toUpperCase(),
    type,
    value: v,
    duration_cycles: type === 'free_period' ? 1 : (durationCycles === null || durationCycles === '' ? null : Number(durationCycles) || 1),
    max_redemptions: maxRedemptions ? Number(maxRedemptions) : null,
    expires_at: expiresAt || null,
    note: note || null,
  }).select('*').single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: '이미 존재하는 쿠폰 코드입니다.' });
    return res.status(500).json({ error: '쿠폰 생성에 실패했습니다.' });
  }
  return res.status(200).json({ coupon: data });
}

async function adminCouponUpdate(req: VercelRequest, res: VercelResponse) {
  const { id, active } = req.body ?? {};
  if (!id || typeof active !== 'boolean') return res.status(400).json({ error: '잘못된 요청입니다.' });
  const { error } = await supabase.from('coupons').update({ active }).eq('id', id);
  if (error) return res.status(500).json({ error: '쿠폰 수정에 실패했습니다.' });
  return res.status(200).json({ ok: true });
}

// 유료화 강제 스위치 — 소프트 오픈 시점에 켠다 (켜면 구독 없는 계정의 기능 사용이 차단됨)
async function adminBillingConfig(req: VercelRequest, res: VercelResponse) {
  const { enforce } = req.body ?? {};
  if (typeof enforce === 'boolean') {
    await supabase.from('app_config').upsert({
      key: 'billing_enforced',
      value: enforce ? 'true' : 'false',
      updated_at: new Date().toISOString(),
    });
  }
  const { data } = await supabase.from('app_config').select('value').eq('key', 'billing_enforced').maybeSingle();
  return res.status(200).json({ billingEnforced: data?.value === 'true' });
}

async function adminSubscriptions(res: VercelResponse) {
  const { data } = await supabase
    .from('subscriptions')
    .select('id, status, card_summary, next_billing_at, current_period_end, cancel_at_period_end, fail_count, created_at, users(name, email), coupons(code), plans(name)')
    .order('created_at', { ascending: false })
    .limit(200);
  const { data: counts } = await supabase.from('subscriptions').select('status');
  const byStatus: Record<string, number> = {};
  for (const row of counts ?? []) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  return res.status(200).json({ subscriptions: data ?? [], byStatus });
}
