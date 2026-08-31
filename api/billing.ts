import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

// 구독 결제 통합 엔드포인트 (서버리스 함수 1개로 통합 — Vercel 함수 한도 대응)
//   subscribe        카드 등록(빌링키 발급) + 첫 결제 → 구독 활성화
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
const PLAN_ID = 'standard';
const RETRY_SCHEDULE_DAYS = [1, 2]; // 실패 1회차 → D+1, 2회차 → 추가 2일(D+3)
const MAX_FAIL = 3;
const REFUND_BASE_DAYS = 30; // 일할 환불 기준: 월요금 ÷ 30

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

// +1개월 (말일 보정: 1/31 → 2/28)
function addMonth(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
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
  let query = supabase.from('coupon_redemptions').select('id').eq('coupon_id', coupon.id);
  query = ci ? query.or(`user_id.eq.${userId},ci.eq.${ci}`) : query.eq('user_id', userId);
  const { data } = await query.limit(1);
  if (data && data.length > 0) return '이미 사용한 쿠폰입니다.';
  return null;
}

function couponPrice(coupon: CouponRow | null, price: number): { amount: number; discount: number } {
  if (!coupon) return { amount: price, discount: 0 };
  if (coupon.type === 'percent') {
    const discount = Math.floor((price * coupon.value) / 100);
    return { amount: price - discount, discount };
  }
  if (coupon.type === 'amount') {
    const discount = Math.min(price, coupon.value);
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
  const orderName = `${plan.name} 월 구독`;

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
    const nextBilling = addMonth(today);
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

    await sendEmail(user.email, `[훈프로] 결제 완료 — ${won(amount)}`,
      `<p>${user.name}님, ${orderName} ${won(amount)} 결제가 완료됐습니다.</p>` +
      `<p>다음 결제 예정일: ${nextBilling}</p>` +
      (result.receiptUrl ? `<p><a href="${result.receiptUrl}">영수증 보기</a></p>` : ''));
    return { ok: true };
  }

  // 실패: D+1 → D+3 재시도, 3회 누적 시 정지 (데이터는 보존)
  const failCount = (sub.fail_count ?? 0) + 1;
  if (failCount >= MAX_FAIL) {
    await supabase.from('subscriptions').update({
      status: 'paused', fail_count: failCount, next_billing_at: null, updated_at: new Date().toISOString(),
    }).eq('id', sub.id);
    await sendEmail(user.email, '[훈프로] 구독이 정지됐습니다',
      `<p>${user.name}님, 결제가 3회 실패해 구독이 정지됐습니다. (사유: ${result.failReason})</p>` +
      `<p>데이터는 그대로 보존됩니다. 마이페이지에서 카드를 다시 등록하면 즉시 복구됩니다.</p>`);
  } else {
    const retryDate = addDays(today, RETRY_SCHEDULE_DAYS[failCount - 1] ?? 2);
    await supabase.from('subscriptions').update({
      status: 'past_due', fail_count: failCount, next_billing_at: retryDate, updated_at: new Date().toISOString(),
    }).eq('id', sub.id);
    await sendEmail(user.email, '[훈프로] 결제 실패 안내',
      `<p>${user.name}님, ${orderName} 결제가 실패했습니다. (사유: ${result.failReason})</p>` +
      `<p>${retryDate}에 다시 시도합니다. 카드 한도·유효기간을 확인하시거나 마이페이지에서 카드를 변경해주세요.</p>`);
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

    // 이하 전부 로그인 필요
    const user = verifyAuth(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });

    if (action === 'status') return await getStatus(user, res);
    if (action === 'coupon-validate') return await couponValidate(user, req, res);
    if (action === 'subscribe') return await subscribe(user, req, res);
    if (action === 'cancel') return await cancelSubscription(user, req, res);
    if (action === 'resume') return await resumeSubscription(user, res);
    if (action === 'change-card') return await changeCard(user, req, res);
    if (action === 'refund') return await refund(user, res);

    // ── 관리자 ──
    if (action.startsWith('admin-')) {
      if (!user.isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
      if (action === 'admin-coupons') return await adminCoupons(res);
      if (action === 'admin-coupon-create') return await adminCouponCreate(req, res);
      if (action === 'admin-coupon-update') return await adminCouponUpdate(req, res);
      if (action === 'admin-subscriptions') return await adminSubscriptions(res);
    }

    return res.status(400).json({ error: '잘못된 요청입니다.' });
  } catch (e: any) {
    console.error('[billing]', action, e);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}

// ── 사용자 액션 ───────────────────────────────────────────

async function getStatus(user: any, res: VercelResponse) {
  const [{ data: sub }, { data: plan }, { data: cfg }] = await Promise.all([
    supabase.from('subscriptions').select('*').eq('user_id', user.userId).maybeSingle(),
    supabase.from('plans').select('*').eq('id', PLAN_ID).maybeSingle(),
    supabase.from('app_config').select('value').eq('key', 'billing_enforced').maybeSingle(),
  ]);

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
    plan: plan ? { id: plan.id, name: plan.name, price: plan.price } : null,
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

  const [{ data: coupon }, { data: userRow }, { data: plan }] = await Promise.all([
    supabase.from('coupons').select('*').eq('code', code).maybeSingle(),
    supabase.from('users').select('ci').eq('id', user.userId).maybeSingle(),
    supabase.from('plans').select('price').eq('id', PLAN_ID).maybeSingle(),
  ]);

  const problem = await checkCoupon(coupon as CouponRow | null, user.userId, userRow?.ci ?? null);
  if (problem) return res.status(400).json({ error: problem });

  const c = coupon as CouponRow;
  const price = plan?.price ?? 0;
  const { amount, discount } = couponPrice(c, price);
  return res.status(200).json({
    valid: true,
    type: c.type,
    value: c.value,
    durationCycles: c.duration_cycles,
    firstAmount: c.type === 'free_period' ? 0 : amount,
    discount,
    description: c.type === 'free_period'
      ? `${c.value}일 무료 이용 후 ${won(price)}/월 자동결제`
      : `첫 ${c.duration_cycles === null ? '매' : c.duration_cycles + '회'} 결제 ${won(amount)} (${won(discount)} 할인)`,
  });
}

async function subscribe(user: any, req: VercelRequest, res: VercelResponse) {
  const { authKey, customerKey, couponCode } = req.body ?? {};
  if (!authKey || !customerKey) return res.status(400).json({ error: '카드 등록 정보가 없습니다.' });
  if (!process.env.TOSS_SECRET_KEY) return res.status(500).json({ error: '결제 설정이 완료되지 않았습니다. 관리자에게 문의하세요.' });

  const [{ data: existing }, { data: userRow }, { data: plan }] = await Promise.all([
    supabase.from('subscriptions').select('*').eq('user_id', user.userId).maybeSingle(),
    supabase.from('users').select('ci, email, name').eq('id', user.userId).maybeSingle(),
    supabase.from('plans').select('*').eq('id', PLAN_ID).maybeSingle(),
  ]);
  if (!plan) return res.status(500).json({ error: '플랜 정보를 찾을 수 없습니다.' });
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
  const periodEnd = isTrial ? addDays(today, coupon!.value) : addMonth(today);
  const { amount, discount } = couponPrice(coupon, plan.price);

  const subFields = {
    user_id: user.userId,
    plan_id: PLAN_ID,
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
    const orderName = `${plan.name} 월 구독`;
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

    await sendEmail(userRow?.email ?? user.email, `[훈프로] 구독 시작 — ${won(amount)} 결제 완료`,
      `<p>${userRow?.name ?? user.name}님, ${orderName} 구독이 시작됐습니다.</p>` +
      `<p>결제 금액: ${won(amount)}${discount > 0 ? ` (쿠폰 할인 ${won(discount)})` : ''} · 다음 결제일: ${periodEnd}</p>` +
      (result.receiptUrl ? `<p><a href="${result.receiptUrl}">영수증 보기</a></p>` : ''));
  } else {
    await sendEmail(userRow?.email ?? user.email, `[훈프로] 무료 이용 시작 (${coupon!.value}일)`,
      `<p>${userRow?.name ?? user.name}님, 무료 이용이 시작됐습니다.</p>` +
      `<p>무료 기간 종료일(${periodEnd})부터 ${won(plan.price)}/월이 등록하신 카드로 자동결제됩니다. 그 전에 언제든 해지할 수 있습니다.</p>`);
  }

  // 쿠폰 사용 기록 (CI 기준 1인 1회 어뷰징 차단)
  if (coupon) {
    await supabase.from('coupon_redemptions').insert({
      coupon_id: coupon.id,
      user_id: user.userId,
      ci: userRow?.ci ?? null,
      subscription_id: subId,
    });
    await supabase.from('coupons').update({ redeemed_count: coupon.redeemed_count + 1 }).eq('id', coupon.id);
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

  const [{ data: sub }, { data: userRow }, { data: plan }] = await Promise.all([
    supabase.from('subscriptions').select('*').eq('user_id', user.userId).maybeSingle(),
    supabase.from('users').select('email, name').eq('id', user.userId).maybeSingle(),
    supabase.from('plans').select('*').eq('id', PLAN_ID).maybeSingle(),
  ]);
  if (!sub || sub.status === 'canceled') return res.status(404).json({ error: '진행 중인 구독이 없습니다.' });

  const { billingKey, cardSummary } = await tossIssueBillingKey(authKey, customerKey);
  await supabase.from('subscriptions').update({
    billing_key_enc: encryptBillingKey(billingKey),
    customer_key: customerKey,
    card_summary: cardSummary,
    updated_at: new Date().toISOString(),
  }).eq('id', sub.id);

  // 결제 실패로 밀려 있거나 정지 상태면 새 카드로 즉시 재결제 → 성공 시 즉시 복구
  if (sub.status === 'past_due' || sub.status === 'paused') {
    const fresh = { ...sub, billing_key_enc: encryptBillingKey(billingKey), customer_key: customerKey, fail_count: sub.status === 'paused' ? 0 : sub.fail_count };
    const result = await chargeSubscription(fresh, plan, userRow ?? user);
    if (!result.ok) return res.status(402).json({ error: `카드는 변경됐지만 결제에 실패했습니다: ${result.failReason}` });
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
  const { count: usedCalls } = await supabase
    .from('api_calls')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.userId)
    .gte('created_at', approvedAt.toISOString());

  let refundAmount: number;
  let reason: string;
  if (within7Days && (usedCalls ?? 0) === 0) {
    refundAmount = payment.amount;
    reason = '7일 이내 미사용 전액 환불';
  } else {
    const periodEnd = new Date(sub.current_period_end);
    const remainingDays = Math.max(0, Math.floor((periodEnd.getTime() - Date.now()) / 86400000));
    refundAmount = Math.floor((payment.amount / REFUND_BASE_DAYS) * remainingDays);
    reason = `잔여 ${remainingDays}일 일할 환불`;
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
  await sendEmail(user.email, '[훈프로] 환불 및 해지 완료',
    `<p>${user.name}님, 구독이 해지됐습니다.</p><p>환불 금액: ${won(refundAmount)} (${reason})</p>`);
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
    await sendEmail(u.email, `[훈프로] ${noticeDate} 정기결제 예정 안내`,
      `<p>${u.name}님, ${noticeDate}에 ${p?.name ?? '훈프로'} 월 구독 요금이 등록하신 카드(${sub.card_summary ?? ''})로 자동결제될 예정입니다.</p>` +
      `<p>결제를 원치 않으시면 그 전에 마이페이지에서 해지해주세요. 해지 시 남은 기간까지는 그대로 이용할 수 있습니다.</p>`);
    summary.notified++;
  }

  // 2) 오늘이 결제일인 구독 청구
  const { data: due } = await supabase
    .from('subscriptions')
    .select('*, users(email, name), plans!inner(id, name, price)')
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

async function adminSubscriptions(res: VercelResponse) {
  const { data } = await supabase
    .from('subscriptions')
    .select('id, status, card_summary, next_billing_at, current_period_end, cancel_at_period_end, fail_count, created_at, users(name, email), coupons(code)')
    .order('created_at', { ascending: false })
    .limit(200);
  const { data: counts } = await supabase.from('subscriptions').select('status');
  const byStatus: Record<string, number> = {};
  for (const row of counts ?? []) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  return res.status(200).json({ subscriptions: data ?? [], byStatus });
}
