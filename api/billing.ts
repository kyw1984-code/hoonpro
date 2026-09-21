import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { isOwnReferral, referralNote, referrerIdFromNote } from '../src/lib/referral.js';
import { applyDiscounts, trialDaysOf, referralRewardAmount, stillDiscounted, LIVE_COUPON_STATUSES } from '../src/lib/coupon.js';
import { parseLimits } from '../src/lib/featureLimits.js';
import { withVat } from '../src/lib/vat.js';
import { runCron } from '../src/lib/cronHeartbeat.js';
import { emailFrom } from '../src/lib/emailFrom.js';
import { wrapEmail as wrapEmailBase } from '../src/lib/emailTemplate.js';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

// 결제 메일은 문의처가 다르다 — 틀은 공용, 바닥글만 바꾼다
const wrapEmail = (heading: string, bodyHtml: string) =>
  wrapEmailBase(heading, bodyHtml, '본 메일은 발신 전용입니다. 결제 관련 문의는 서비스 내 [구독 관리]에서 확인해주세요.');

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

// 해지 사유 — 프론트 선택지와 동일한 값만 저장한다 (자유 입력은 reasonDetail로 분리)
const CANCEL_REASONS = ['price', 'not-using', 'missing-feature', 'quality', 'temporary', 'other'];

// 청구 주기 — 월간 1개월 / 연간 12개월, 일할 환불 기준일도 주기에 따름
/** 친구 추천 보상 — 추천인이 다음 결제에서 받는 할인율 (친구가 받는 것과 같다) */
const REFERRAL_REWARD_PERCENT = 10;

function planMonths(plan: { interval?: string }): number {
  return plan?.interval === 'year' ? 12 : 1;
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
//
// 주의: 이 값이 바뀌면 이미 저장된 결제키를 하나도 못 읽는다. 복구할 방법이
// 없고 구독자가 카드를 다시 등록해야 한다. 실제 결제가 시작된 뒤로는 절대
// 바꾸지 않는다. BILLING_ENC_KEY를 안 정해 두면 JWT_SECRET으로 떨어지는데,
// 그 상태에서 JWT_SECRET을 돌리면 같은 사고가 난다. 결제를 열기 전에
// BILLING_ENC_KEY를 따로 정해 두는 편이 안전하다.
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
  // 형식부터 본다. 예전 평문이 섞여 있으면 split 결과가 모자라 Buffer.from이
  // 알아보기 어려운 TypeError를 던진다. 로그에 그 메시지만 남으면 원인을
  // 찾는 데 한참 걸리므로, 무엇이 잘못됐는지 한국어로 밝힌다.
  // 값 자체는 절대 로그에 남기지 않는다 — 이걸로 결제가 일어난다.
  const parts = String(enc ?? '').split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('저장된 결제키의 형식이 올바르지 않습니다. 카드를 다시 등록해야 합니다.');
  }
  const [ivHex, tagHex, dataHex] = parts;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    // 인증 태그가 안 맞는다 = 암호화 키가 바뀌었거나 값이 손상됐다
    throw new Error('저장된 결제키를 읽지 못했습니다. 암호화 키가 바뀌었을 수 있습니다.');
  }
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

// 본문 안에서 쓰는 버튼 (구독 관리로 유도)
function emailButton(label: string, href = 'https://hoonproai.com'): string {
  return `<div style="margin:20px 0 4px;"><a href="${href}" style="display:inline-block;padding:11px 20px;border-radius:10px;background:linear-gradient(135deg,#7cf5ff,#8b7bff);color:#0a0f1f;font-weight:700;font-size:13.5px;text-decoration:none;">${label}</a></div>`;
}

// 이메일 발송 (Resend) — 키가 없으면 조용히 스킵 (개발 환경)
/** 발송 기록 한 줄. 실패해도 본래 작업을 막지 않는다 */
async function recordEmail(
  row: { userId?: string | null; to: string; kind: string; subject: string; ref?: string | null; ok: boolean; error?: string | null; providerId?: string | null },
): Promise<void> {
  try {
    await supabase.from('email_log').insert({
      user_id: row.userId ?? null,
      to_email: row.to,
      kind: row.kind,
      subject: row.subject.slice(0, 300),
      ref: row.ref ?? null,
      ok: row.ok,
      error: row.error ? String(row.error).slice(0, 500) : null,
      provider_id: row.providerId ?? null,
    });
  } catch { /* 기록 실패가 결제 흐름을 막지 않도록 */ }
}

/**
 * 메일 발송.
 *
 * 예전에는 응답을 보지 않았다. fetch는 400이나 500을 받아도 예외를 던지지
 * 않으므로, 메일 발송사가 거부해도 성공처럼 지나갔다. 게다가 catch가 비어
 * 있어 예외까지 삼켰다. 약관에 "이메일로 고지한다"고 적어 둔 이상 보냈는지
 * 못 보냈는지는 알아야 한다.
 *
 * 보낸 결과를 email_log에 남긴다. 고객이 "고지 못 받았다"고 할 때 확인할
 * 근거이자, 놓친 고지를 다시 보낼 때 중복을 막는 열쇠다.
 */
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  log?: { userId?: string | null; kind?: string; ref?: string | null },
): Promise<boolean> {
  const kind = log?.kind ?? 'etc';
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) {
    const why = !key ? 'RESEND_API_KEY가 없습니다' : '받는 주소가 없습니다';
    await recordEmail({ userId: log?.userId, to: to || '(없음)', kind, subject, ref: log?.ref, ok: false, error: why });
    if (!key) await logSystemError('메일', `메일을 보내지 못했습니다: ${why}`, { severity: 'error' });
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: emailFrom(),
        to: [to],
        subject,
        html,
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const why = `${res.status} ${body?.message ?? body?.name ?? ''}`.trim();
      await recordEmail({ userId: log?.userId, to, kind, subject, ref: log?.ref, ok: false, error: why });
      await logSystemError('메일', `메일 발송이 거부됐습니다 (${kind}): ${why}`, { userId: log?.userId ?? null, severity: 'error' });
      return false;
    }
    await recordEmail({ userId: log?.userId, to, kind, subject, ref: log?.ref, ok: true, providerId: body?.id ?? null });
    return true;
  } catch (e: any) {
    await recordEmail({ userId: log?.userId, to, kind, subject, ref: log?.ref, ok: false, error: e?.message ?? String(e) });
    await logSystemError('메일', `메일 발송 중 오류 (${kind}): ${e?.message ?? e}`, { userId: log?.userId ?? null, severity: 'error' });
    return false;
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
  /** 무료 이용 일수 (0 = 없음). 할인과 함께 줄 수 있다 */
  trial_days?: number | null;
  max_redemptions: number | null;
  redeemed_count: number;
  expires_at: string | null;
  active: boolean;
  /** 추천 코드는 'referral:{발행자 userId}'가 들어 있다. 본인 사용을 막는 데 쓴다 */
  note?: string | null;
}

// 쿠폰 유효성 검사 — 통과 시 null, 실패 시 사용자에게 보여줄 사유 반환
async function checkCoupon(coupon: CouponRow | null, userId: string, ci: string | null): Promise<string | null> {
  if (!coupon) return '존재하지 않는 쿠폰 코드입니다.';
  // 자기 추천 코드는 자기가 못 쓴다. 추천 코드는 [구독 관리] 화면에 늘 떠 있고
  // 바로 아래가 쿠폰 입력칸이라, 막지 않으면 복사해서 붙여넣는 것으로 끝난다.
  // 연간 결제 기준 1인당 39,336원이고, 매출이 아니라 판촉비로 잡혀 안 보인다.
  if (isOwnReferral(coupon.note, userId)) {
    return '자기 추천 코드는 사용할 수 없습니다. 다른 분께 공유해주세요.';
  }
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

/** 월간 플랜 정가 (공급가). 추천 보상액의 기준이다 */
async function monthlyListPrice(): Promise<number> {
  const { data } = await supabase
    .from('plans').select('price').eq('interval', 'month').eq('active', true)
    .order('price', { ascending: true }).limit(1);
  return data && data.length > 0 ? Number(data[0].price) : 0;
}

/** 이 사람에게 쌓여 있는 추천 보상 중 가장 오래된 것 하나 */
async function pendingReferralReward(userId: string): Promise<{ id: string; amount: number } | null> {
  const { data } = await supabase
    .from('referral_rewards')
    .select('id, amount')
    .eq('referrer_id', userId)
    .is('consumed_at', null)
    .order('granted_at', { ascending: true })
    .limit(1);
  return data && data.length > 0 ? { id: data[0].id, amount: Number(data[0].amount) || 0 } : null;
}

/**
 * 친구가 추천 코드로 결제를 마쳤다 — 추천인에게도 같은 비율의 할인을 얹어 둔다.
 *
 * 여기서 실패해도 친구의 결제를 되돌리지 않는다. 돈은 이미 정상적으로
 * 받았고, 보상을 못 준 것은 사람이 나중에 채워 줄 수 있는 문제다.
 * 대신 조용히 넘어가지 않고 관리자 화면에 남긴다.
 */
async function grantReferralReward(coupon: CouponRow | null, referredUserId: string): Promise<void> {
  const referrerId = referrerIdFromNote(coupon?.note);
  if (!referrerId || !coupon) return;
  if (referrerId === referredUserId) return; // 자기 코드는 checkCoupon이 이미 막지만 한 번 더

  // 보상액은 추천인이 어떤 플랜이든 같다 — 월간 정가의 10%로 고정한다.
  // 비율로 두면 연간 추천인에게 35,760원이 나가고, 같은 '10%'라는 말로
  // 월간 추천인(3,980원)과 열 배가 갈린다.
  const amount = referralRewardAmount(await monthlyListPrice(), REFERRAL_REWARD_PERCENT);
  if (amount <= 0) {
    await logSystemError('친구추천', '월간 플랜 정가를 읽지 못해 추천 보상을 적립하지 못했습니다.', {
      userId: referrerId, severity: 'warn',
    });
    return;
  }

  // unique(referred_user_id)가 재구독으로 보상이 반복 지급되는 것을 막는다
  const { error } = await supabase.from('referral_rewards').insert({
    referrer_id: referrerId,
    referred_user_id: referredUserId,
    amount,
  });
  if (error) {
    if (error.code === '23505') return; // 이미 지급됨
    await logSystemError('친구추천', `추천 보상 적립에 실패했습니다: ${error.message}`, {
      userId: referrerId, severity: 'warn',
    });
    return;
  }

  const { data: referrer } = await supabase
    .from('users').select('email, name').eq('id', referrerId).maybeSingle();
  if (!referrer?.email) return;
  const saving = withVat(amount).total;
  await sendEmail(referrer.email, `[훈프로] 친구 추천 보상이 적립됐습니다`, wrapEmail(
    '추천 보상이 적립됐습니다',
    `<p>${referrer.name ?? ''}님이 공유하신 추천 코드로 새 구독자가 등록했습니다. 감사합니다.</p>` +
    `<p>다음 결제에서 <b style="color:#e8ecf5;">${won(saving)}</b>이 자동으로 할인됩니다. (부가세 포함)</p>` +
    `<p style="color:#b9c2d8;font-size:13px;">여러 명을 추천하셨다면 결제할 때마다 한 건씩 차례로 적용됩니다.</p>` +
    emailButton('구독 관리 열기')),
    { userId: referrerId, kind: 'referral-reward', ref: referredUserId });
}

/** 보상을 썼다고 표시한다. 이미 쓴 줄은 건드리지 않는다 (같은 보상의 중복 사용 방지) */
async function consumeReferralReward(rewardId: string, orderId: string): Promise<void> {
  await supabase
    .from('referral_rewards')
    .update({ consumed_at: new Date().toISOString(), consumed_order_id: orderId })
    .eq('id', rewardId)
    .is('consumed_at', null);
}

// ── 시스템 오류 로그 ──────────────────────────────────────

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

async function tossCancelPayment(
  paymentKey: string, reason: string, cancelAmount?: number, idempotencyKey?: string,
): Promise<{ ok: boolean; message?: string }> {
  // 멱등키를 붙인다. 구독 상태 선점이 1차 방어고 이건 2차다. 토스는 남은
  // 금액이 있는 한 부분 취소를 거듭 받아 주므로, 같은 취소가 두 번 닿으면
  // 두 번 다 빠져나간다. 같은 키로 온 두 번째 요청은 토스가 걸러 준다.
  const res = await fetch(`${TOSS_API}/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
    method: 'POST',
    headers: idempotencyKey ? { ...tossHeaders(), 'Idempotency-Key': idempotencyKey } : tossHeaders(),
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
  // 쌓여 있는 친구 추천 보상이 있으면 이번 결제에 한 건 쓴다. 여러 명을
  // 추천했으면 한 번에 몰아 깎지 않고 결제할 때마다 하나씩 쓴다 — 10%를
  // 세 번 받는 쪽이 30%를 한 번 받는 것보다 오래 남는다.
  const reward = await pendingReferralReward(sub.user_id);
  const { amount: supplyAmount, discount } = applyDiscounts(
    plan.price, coupon, planMonths(plan), reward?.amount ?? 0,
  );
  // 요금표 가격은 공급가액이다. 실제로 카드에 청구되는 금액은 세액을 더한 값이다.
  const { supply, vat, total: amount } = withVat(supplyAmount);
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
    supply_amount: supply,
    vat_amount: vat,
    discount,
    status: result.ok ? 'paid' : 'failed',
    payment_key: result.paymentKey ?? null,
    fail_reason: result.failReason ?? null,
    receipt_url: result.receiptUrl ?? null,
    approved_at: result.approvedAt ?? null,
  });

  if (!result.ok) {
    // 자동결제 실패는 그대로 두면 구독이 조용히 끊긴다. 운영자가 먼저 알아야 한다.
    await logSystemError('자동결제', `정기결제가 실패했습니다: ${result.failReason ?? '사유 불명'}`, {
      userId: sub.user_id, severity: 'warn',
    });
  }

  const today = kstToday();
  if (result.ok) {
    // 결제가 된 뒤에 소진한다. 먼저 지우면 결제가 실패했을 때 보상만 사라진다.
    if (reward) await consumeReferralReward(reward.id, orderId);
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
      `<p style="color:#b9c2d8;font-size:13px;">공급가액 ${won(supply)} + 부가세 ${won(vat)}<br>` +
      `신용카드 매출전표가 부가가치세법상 적격증빙입니다 — 매입세액 공제에 그대로 쓰실 수 있습니다.</p>` +
      `<p>다음 결제 예정일: <b style="color:#e8ecf5;">${nextBilling}</b></p>` +
      (result.receiptUrl ? emailButton('영수증 보기', result.receiptUrl) : emailButton('구독 관리 열기'))),
      { userId: sub.user_id, kind: 'payment-ok', ref: orderId });
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
      emailButton('카드 변경하기')),
      { userId: sub.user_id, kind: 'payment-fail', ref: orderId });
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
    // 실행 기록을 남긴다. 자동결제가 사흘 멈춘 것을 사흘 뒤에 아는 건 너무 늦다.
    if (action === 'charge-due') return await runCron(supabase, 'billing-charge', res, () => chargeDue(req, res));

    // ── 토스 웹훅 (서명 없음 → paymentKey 재조회로 검증) ──
    if (action === 'webhook') return await tossWebhook(req, res);

    // ── 공개 요금표 (로그인 전 랜딩에서 가격을 보여주기 위해 인증 없이 제공) ──
    if (action === 'plans') {
      const { data } = await supabase
        .from('plans').select('id, name, price, interval')
        .eq('active', true).order('price', { ascending: false });
      return res.status(200).json({
        // price는 공급가액, chargedPrice는 실제 카드에 찍히는 금액이다.
        // 화면에서 둘을 함께 보여줘야 "부가세 별도"가 숫자로 확인된다.
        plans: (data ?? []).map(p => ({
          ...p,
          interval: p.interval ?? 'month',
          chargedPrice: withVat(p.price).total,
          vat: withVat(p.price).vat,
        })),
        vatSeparate: true,
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
      if (action === 'admin-revenue') return await adminRevenue(res);
      if (action === 'admin-coupons') return await adminCoupons(res);
      if (action === 'admin-coupon-create') return await adminCouponCreate(req, res);
      if (action === 'admin-coupon-update') return await adminCouponUpdate(req, res);
      if (action === 'admin-coupon-delete') return await adminCouponDelete(req, res);
      if (action === 'admin-subscriptions') return await adminSubscriptions(req, res);
      if (action === 'admin-payments') return await adminPayments(req, res);
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
  const [{ data: sub }, { data: planRows }, { data: cfg }, { data: limitCfg }] = await Promise.all([
    supabase.from('subscriptions').select('*').eq('user_id', user.userId).maybeSingle(),
    supabase.from('plans').select('*').eq('active', true).order('price', { ascending: false }),
    supabase.from('app_config').select('value').eq('key', 'billing_enforced').maybeSingle(),
    // 기능 비교표의 '하루 N회'는 실제 한도를 그대로 보여준다. 화면에 숫자를
    // 따로 적어 두면 관리자가 한도를 바꿔도 안내만 옛날 값으로 남는다.
    supabase.from('app_config').select('value').eq('key', 'feature_limits').maybeSingle(),
  ]);
  const plans = (planRows ?? []).map(p => ({
    id: p.id, name: p.name, price: p.price, interval: p.interval ?? 'month',
    chargedPrice: withVat(p.price).total, vat: withVat(p.price).vat,
  }));
  const plan = plans.find(p => p.id === sub?.plan_id) ?? null;

  const { count: rewardCount } = await supabase
    .from('referral_rewards')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', user.userId)
    .is('consumed_at', null);

  let payments: any[] = [];
  if (sub) {
    const { data } = await supabase
      .from('payments')
      .select('order_name, amount, supply_amount, vat_amount, discount, status, fail_reason, receipt_url, approved_at, created_at')
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
    referralRewards: { pending: rewardCount ?? 0 },
    featureLimits: parseLimits(limitCfg?.value),
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
  const months = plan.interval === 'year' ? 12 : 1;
  const trialDays = trialDaysOf(c);
  const { amount: supplyAmount, discount } = applyDiscounts(plan.price, c, months);
  const charged = withVat(supplyAmount);
  const planCharged = withVat(plan.price);

  // 무료 기간과 할인이 함께 있는 쿠폰이 있다. 한쪽만 적으면 사용자는
  // 무료가 끝난 뒤 정가가 빠지는 줄 알고, 실제로는 할인된 금액이 빠진다.
  const afterTrial = discount > 0
    ? `${won(charged.total)}/${intervalLabel}${c.duration_cycles === null ? '' : ` (첫 ${c.duration_cycles}회)`}`
    : `${won(planCharged.total)}/${intervalLabel}`;
  const description = trialDays > 0
    ? `${trialDays}일 무료 이용 후 ${afterTrial} 자동결제 (부가세 포함)`
    : `${c.duration_cycles === null ? '매' : `첫 ${c.duration_cycles}회`} 결제 ${won(charged.total)} (${won(discount)} 할인 · 부가세 포함)`;

  return res.status(200).json({
    valid: true,
    type: c.type,
    value: c.value,
    durationCycles: c.duration_cycles,
    trialDays,
    // 화면에 보이는 숫자는 실제로 카드에 찍히는 금액이어야 한다
    firstAmount: trialDays > 0 ? 0 : charged.total,
    discount,
    description,
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
  const months = planMonths(plan);
  // 무료 기간은 이제 유형이 아니라 칸이다 — "30일 무료 + 이후 매달 할인"이
  // 한 장의 쿠폰으로 가능하다. 옛 free_period 쿠폰도 같은 함수가 읽는다.
  const trialDays = trialDaysOf(coupon);
  const isTrial = trialDays > 0;
  const periodEnd = isTrial ? addDays(today, trialDays) : addMonths(today, months);

  // 구독 전에 친구를 추천해 둔 사람도 있다. 첫 결제부터 보상을 쓴다.
  const reward = isTrial ? null : await pendingReferralReward(user.userId);
  const { amount: supplyAmount, discount } = applyDiscounts(plan.price, coupon, months, reward?.amount ?? 0);
  const { supply, vat, total: amount } = withVat(supplyAmount);

  const subFields = {
    user_id: user.userId,
    plan_id: plan.id,
    status: isTrial ? 'trial' : 'active',
    billing_key_enc: billingKeyEnc,
    customer_key: customerKey,
    card_summary: cardSummary,
    coupon_id: coupon?.id ?? null,
    // 할인 쿠폰은 결제 1회를 쓴 만큼 회차를 깎는다. 무료 기간으로 시작하면
    // 결제가 없었으므로 깎지 않는다 — 깎으면 "30일 무료 + 3개월 할인" 쿠폰이
    // 무료 기간만으로 한 회차를 잃는다. 할인이 없는 쿠폰은 0으로 둔다.
    coupon_remaining_cycles: coupon && coupon.type !== 'free_period'
      ? (coupon.duration_cycles === null ? null : Math.max(0, coupon.duration_cycles - (isTrial ? 0 : 1)))
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
      supply_amount: supply,
      vat_amount: vat,
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

    if (reward) await consumeReferralReward(reward.id, orderId);
    await grantReferralReward(coupon, user.userId);

    await sendEmail(userRow?.email ?? user.email, `[훈프로] 구독 시작 — ${won(amount)} 결제 완료`, wrapEmail(
      '구독이 시작됐습니다',
      `<p>${userRow?.name ?? user.name}님, ${orderName} 구독이 시작됐습니다. 이제 모든 AI 도구를 이용할 수 있습니다.</p>` +
      `<p>결제 금액: <b style="color:#e8ecf5;">${won(amount)}</b>${discount > 0 ? ` (쿠폰 할인 ${won(discount)})` : ''}<br>다음 결제일: <b style="color:#e8ecf5;">${periodEnd}</b></p>` +
      (result.receiptUrl ? emailButton('영수증 보기', result.receiptUrl) : emailButton('훈프로 열기'))),
      { userId: user.userId, kind: 'subscribe-ok', ref: orderId });
  } else {
    await sendEmail(userRow?.email ?? user.email, `[훈프로] 무료 이용 시작 (${coupon!.value}일)`, wrapEmail(
      '무료 이용이 시작됐습니다',
      `<p>${userRow?.name ?? user.name}님, 지금부터 모든 AI 도구를 무료로 이용할 수 있습니다.</p>` +
      `<p>무료 기간 종료일 <b style="color:#e8ecf5;">${periodEnd}</b>부터 ${won(withVat(supplyAmount).total)}/${plan.interval === 'year' ? '연' : '월'}이 등록하신 카드로 자동결제됩니다.` +
      (discount > 0 ? ` (쿠폰 할인 ${won(withVat(discount).total)} 적용가 · 부가세 포함)` : ' (부가세 포함)') +
      `<br>그 전에 언제든 해지하실 수 있고, 해지하면 결제되지 않습니다.</p>` +
      emailButton('훈프로 열기')),
      // 무료 기간 시작 메일이 곧 그 기간의 사전 고지다. 종료일과 금액을
      // 함께 적었으므로, 크론이 같은 결제일로 또 보내지 않게 같은 열쇠를 쓴다.
      { userId: user.userId, kind: 'billing-notice', ref: periodEnd });
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

  // 환불은 계정당 한 번이다.
  //
  // 막지 않으면 구독 → 며칠 몰아 쓰기 → 환불 → 재구독을 무한히 돌릴 수 있다.
  // 한도가 하루 단위라 그렇게 쓰면 우리가 무는 돈이 받은 돈보다 커지고, 그
  // 부담은 성실하게 쓰는 다른 구독자에게 간다. 마음이 바뀐 사람에게 한 번은
  // 충분하고, 그 뒤로도 해지는 언제든 된다 — 이미 낸 기간은 그대로 쓴다.
  const { data: pastRefund, error: pastErr } = await supabase
    .from('payments')
    .select('id')
    .eq('user_id', user.userId)
    .in('status', ['refunded', 'partial_refund'])
    .limit(1);
  if (pastErr) {
    console.error('[환불] 이전 환불 조회 실패', { code: pastErr.code, detail: pastErr.message });
    return res.status(503).json({ error: '잠시 후 다시 시도해주세요.', retryable: true });
  }
  if ((pastRefund?.length ?? 0) > 0) {
    return res.status(409).json({
      error: '환불은 계정당 한 번만 가능합니다. [해지]를 누르면 이미 결제한 기간까지 이용하고 자동결제가 멈춥니다.',
    });
  }

  // 해지 사유 — 선택 입력. 개선 지점을 찾기 위한 수집이므로 없어도 해지는 진행한다.
  const reason = CANCEL_REASONS.includes(String(req.body?.reason)) ? String(req.body.reason) : null;
  const reasonDetail = String(req.body?.reasonDetail || '').trim().slice(0, 500) || null;

  // 정지 상태는 즉시 종료, 그 외에는 남은 기간까지 이용 후 종료 (자동결제만 중단)
  if (sub.status === 'paused') {
    await supabase.from('subscriptions').update({
      status: 'canceled', canceled_at: new Date().toISOString(), next_billing_at: null, updated_at: new Date().toISOString(),
      cancel_reason: reason, cancel_reason_detail: reasonDetail,
    }).eq('id', sub.id);
    return res.status(200).json({ ok: true, canceledNow: true });
  }

  await supabase.from('subscriptions').update({
    cancel_at_period_end: true, canceled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    cancel_reason: reason, cancel_reason_detail: reasonDetail,
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

  // 자리를 먼저 잡는다. 예전에는 토스에 환불을 부른 뒤에야 상태를 바꿔서,
  // 같은 순간 두 번 누르면 둘 다 검사를 통과하고 둘 다 승인됐다. 토스는
  // 남은 금액이 있는 한 부분 취소를 거듭 받아 주므로, 반달치 환불 요청
  // 두 번이면 한 달치가 통째로 빠져나갔다. 게다가 결제 기록은 마지막에
  // 덮어써져 한 번만 환불한 것으로 남아 장부에서도 보이지 않았다.
  //
  // status가 아직 그대로일 때만 바꾼다. 진 쪽은 0행이 바뀌어 여기서 멈춘다.
  // 환불은 어차피 구독을 끝내므로 'canceled'로 먼저 옮겨 자리를 잡는다.
  // 두 번째 요청은 위의 `sub.status === 'canceled'` 검사에 걸려 멈춘다.
  // 토스 호출이 실패하면 원래 상태로 되돌린다 — 돈은 안 돌려주고 구독만
  // 끊긴 채로 두면 안 된다.
  const prevStatus = sub.status;
  const claim = await supabase
    .from('subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('id', sub.id)
    .eq('status', prevStatus)
    .select('id');
  if (claim.error || (claim.data?.length ?? 0) === 0) {
    return res.status(409).json({ error: '환불 처리가 이미 진행 중입니다. 잠시 후 [구독 관리]에서 확인해주세요.' });
  }
  const releaseClaim = async () => {
    await supabase.from('subscriptions')
      .update({ status: prevStatus, updated_at: new Date().toISOString() })
      .eq('id', sub.id);
  };

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
  //  · api_calls     : 모델 호출 로깅 (원가가 남는 모든 호출)
  //  · feature_usage : 소싱AI·리뷰 분석·순위 추적 등 한도를 세는 기능.
  //                    모델을 안 부르는 것도 있어 api_calls에는 안 남는다.
  //                    여기를 빠뜨리면 원가가 큰 소싱 기능만 일주일 쓰고
  //                    전액 환불받는 우회가 가능하다.
  //
  // 예전에는 api_usage를 봤는데 그 테이블에 쓰는 코드가 하나도 없어 늘 비어
  // 있었다. 두 갈래 중 한쪽이 조용히 죽어 있었던 셈이다.
  //
  // 조회가 실패하면 "사용함"으로 간주해 전액 환불로 흘러가지 않게 한다.
  const usedFrom = approvedAt.toISOString();
  const usedFromDate = usedFrom.slice(0, 10);
  const [callsRes, usageRes] = await Promise.all([
    supabase.from('api_calls')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.userId)
      .gte('created_at', usedFrom),
    supabase.from('feature_usage')
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

    // 월간은 쓰기 시작했으면 환불하지 않는다. 결제한 달 끝까지 그대로 쓰고
    // 다음 결제만 멈춘다 — 넷플릭스·쿠팡와우를 비롯한 구독 서비스의 일반적인
    // 방식이고, 결제한 기간의 서비스를 다 제공하므로 '공급되지 않은 부분'이
    // 없다. 일할 환불을 없애면 구독→몰아쓰기→환불→재구독 경로도 함께 막힌다.
    //
    // 연간은 다르다. 열 달치를 안 돌려주면 계속거래로 다툼의 여지가 있고,
    // 한국의 연간 구독 상품들도 대개 정가 월 환산으로 재정산해 돌려준다.
    if (subPlan?.interval !== 'year') {
      // 자리를 잡아 둔 것을 되돌리고, 기간 만료 해지로 안내한다
      await releaseClaim();
      return res.status(409).json({
        error: '이미 이용하신 기간은 환불되지 않습니다. [해지]를 누르면 결제한 기간까지 그대로 이용하고 다음 결제가 멈춥니다.',
        useCancel: true,
      });
    }

    {
      // 연간 해지: 할인 없는 월간 요금으로 사용 기간을 재정산한 뒤 차액 환불
      // 환불액 = 연간 결제액 − (월간 요금 ÷ 30 × 사용일수, 사용일은 올림)
      const { data: monthlyPlan } = await supabase
        .from('plans').select('price').eq('interval', 'month').eq('active', true).maybeSingle();
      // 결제액(payment.amount)이 세액 포함이므로 차감할 월간 요금도 같은 기준으로 맞춘다.
      // 공급가액으로 빼면 사용료를 실제보다 적게 떼어 환불이 과다해진다.
      const monthlyPrice = withVat(monthlyPlan?.price ?? 49800).total;
      const usedDays = Math.max(1, Math.ceil((Date.now() - approvedAt.getTime()) / 86400000));
      const usedCharge = Math.floor((monthlyPrice / 30) * usedDays);
      refundAmount = Math.max(0, payment.amount - usedCharge);
      reason = `연간 해지 재정산 (사용 ${usedDays}일 × 월간 요금 일할 ${won(usedCharge)} 차감)`;
    }
  }

  if (refundAmount > 0) {
    const cancel = await tossCancelPayment(
      payment.payment_key,
      reason,
      refundAmount === payment.amount ? undefined : refundAmount,
      // 이 결제를 이 금액으로 취소하는 일은 한 번뿐이다
      `refund:${payment.id}:${refundAmount}`,
    );
    if (!cancel.ok) {
      await releaseClaim();
      return res.status(502).json({ error: `환불 처리에 실패했습니다: ${cancel.message}` });
    }
    await supabase.from('payments').update({
      status: refundAmount === payment.amount ? 'refunded' : 'partial_refund',
      refunded_amount: refundAmount,
      refunded_at: new Date().toISOString(),
    }).eq('id', payment.id);
  }

  await supabase.from('subscriptions').update(endNow).eq('id', sub.id);
  await sendEmail(user.email, '[훈프로] 환불 및 해지 완료', wrapEmail(
    '환불 및 해지가 완료됐습니다',
    `<p>${user.name}님, 구독이 해지됐습니다.</p>` +
    `<p>환불 금액: <b style="color:#e8ecf5;">${won(refundAmount)}</b><br><span style="color:#8a92a6;">${reason}</span></p>` +
    `<p style="color:#8a92a6;">카드사 사정에 따라 환불 반영까지 3~7영업일이 소요될 수 있습니다.</p>`),
    { userId: user.userId, kind: 'refund-ok', ref: payment.order_id });
  return res.status(200).json({ ok: true, refunded: refundAmount, message: reason });
}

// ── 웹훅 ─────────────────────────────────────────────────

// 토스 웹훅에는 서명이 없으므로 수신값을 믿지 않고 paymentKey로 결제를 재조회해 반영
async function tossWebhook(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const paymentKey = req.body?.data?.paymentKey || req.body?.paymentKey;

  // 웹훅이 실제로 도착하는지 로그로 남긴다. 주소가 살아 있는 것과 토스가
  // 진짜 보내는 것은 다르고, 이 핸들러는 성공해도 눈에 보이는 흔적이 없어
  // 첫 실거래 때 도착 여부를 확인할 방법이 없었다.
  // 키 값은 남기지 않는다 — 이벤트 종류와 우리 주문번호만 남긴다.
  console.log('[토스 웹훅] 수신', {
    eventType: req.body?.eventType ?? null,
    orderId: req.body?.data?.orderId ?? req.body?.orderId ?? null,
    status: req.body?.data?.status ?? null,
    hasPaymentKey: Boolean(paymentKey),
  });

  if (!paymentKey || !process.env.TOSS_SECRET_KEY) return res.status(200).json({ ok: true });

  const lookup = await fetch(`${TOSS_API}/v1/payments/${encodeURIComponent(paymentKey)}`, { headers: tossHeaders() });
  if (!lookup.ok) {
    console.error('[토스 웹훅] 결제 조회 실패', { status: lookup.status });
    return res.status(200).json({ ok: true });
  }
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
    // 토스 관리자 화면에서 취소하면 앱을 거치지 않으므로 환불액이 남지 않는다.
    // 총액 − 잔액으로 역산해 기록해야 순매출 집계가 맞는다.
    const refundedAmount = Math.max(0, Number(payment.totalAmount ?? 0) - Number(payment.balanceAmount ?? 0));
    const isRefund = mapped === 'refunded' || mapped === 'partial_refund';

    await supabase.from('payments').update({
      status: mapped,
      payment_key: payment.paymentKey,
      receipt_url: payment.receipt?.url ?? null,
      approved_at: payment.approvedAt ?? null,
      ...(isRefund ? { refunded_amount: refundedAmount, refunded_at: new Date().toISOString() } : {}),
    }).eq('order_id', payment.orderId);
    console.log('[토스 웹훅] 반영', { orderId: payment.orderId, status: mapped });

    // 앱이 아닌 토스 관리자 화면에서 전액 취소했거나 카드사 이의제기가 들어온 경우.
    // 결제만 되돌리고 구독을 그대로 두면 환불받은 사용자가 계속 이용하고
    // 다음 달 크론이 또 청구한다. 구독도 함께 종료한다.
    if (mapped === 'refunded') {
      const { data: row } = await supabase
        .from('payments').select('user_id').eq('order_id', payment.orderId).maybeSingle();
      if (row?.user_id) {
        const now = new Date().toISOString();
        await supabase.from('subscriptions').update({
          status: 'canceled',
          canceled_at: now,
          current_period_end: now,
          next_billing_at: null,
          cancel_reason: 'toss-refund',
          updated_at: now,
        }).eq('user_id', row.user_id).neq('status', 'canceled');
      }
    }
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

  // 1) 결제 7일 전 사전 고지 — 놓친 것까지 따라잡는다
  //
  // 예전에는 결제일이 '정확히 7일 뒤'인 구독만 찾았다. 크론이 하루 실패하면
  // 그날 대상자는 영영 고지를 못 받고, 그 사실조차 아무도 몰랐다. 약관에
  // 적어 둔 의무를 하루치 장애로 어기게 된다.
  //
  // 이제 '7일 안에 결제될 구독' 전부를 보고, 그중 아직 안 보낸 것만 보낸다.
  // 중복은 email_log의 (사용자, 종류, 결제일) 유일 색인이 막는다.
  const noticeHorizon = addDays(today, 7);
  const { data: upcoming } = await supabase
    .from('subscriptions')
    .select('*, users(email, name), plans(name, price, interval)')
    .in('status', ['trial', 'active'])
    .gte('next_billing_at', today)
    .lte('next_billing_at', noticeHorizon)
    .eq('cancel_at_period_end', false);

  const pending = upcoming ?? [];
  const alreadySent = new Set<string>();
  if (pending.length > 0) {
    const { data: sentRows } = await supabase
      .from('email_log')
      .select('user_id, ref')
      .eq('kind', 'billing-notice')
      .eq('ok', true)
      .in('ref', [...new Set(pending.map(s => String(s.next_billing_at)))]);
    for (const r of sentRows ?? []) alreadySent.add(`${r.user_id}|${r.ref}`);
  }

  for (const sub of pending) {
    const u = (sub as any).users, p = (sub as any).plans;
    if (!u?.email || !p) continue;
    const billDate = String(sub.next_billing_at);
    if (alreadySent.has(`${sub.user_id}|${billDate}`)) continue;

    // 고지 금액은 실제로 빠질 금액이어야 한다. 요금표 가격은 공급가액이고,
    // 쿠폰과 추천 보상이 붙으면 더 내려간다. 정가를 적어 보내면 카드에
    // 찍히는 금액과 달라져 고지가 제 역할을 못 한다.
    let coupon: CouponRow | null = null;
    if (sub.coupon_id && (sub.coupon_remaining_cycles === null || sub.coupon_remaining_cycles > 0)) {
      const { data } = await supabase.from('coupons').select('*').eq('id', sub.coupon_id).maybeSingle();
      if (data && data.type !== 'free_period') coupon = data as CouponRow;
    }
    const reward = await pendingReferralReward(sub.user_id);
    const { amount: supplyAmount, discount } = applyDiscounts(p.price, coupon, planMonths(p), reward?.amount ?? 0);
    const charged = withVat(supplyAmount);

    await sendEmail(u.email, `[훈프로] ${billDate} 정기결제 예정 안내`, wrapEmail(
      '정기결제 예정 안내',
      `<p>${u.name}님, <b style="color:#e8ecf5;">${billDate}</b>에 ${p.name} 구독 요금 ` +
      `<b style="color:#e8ecf5;">${won(charged.total)}</b>이 등록하신 카드(${sub.card_summary ?? ''})로 자동결제될 예정입니다.</p>` +
      `<p style="color:#b9c2d8;font-size:13px;">공급가액 ${won(charged.supply)} + 부가세 ${won(charged.vat)}` +
      (discount > 0 ? ` · 할인 ${won(withVat(discount).total)} 반영된 금액입니다` : '') + `</p>` +
      `<p>결제를 원치 않으시면 그 전에 해지해주세요. 해지해도 남은 기간까지는 그대로 이용할 수 있습니다.</p>` +
      emailButton('구독 관리 열기')),
      { userId: sub.user_id, kind: 'billing-notice', ref: billDate });
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
    // 한 구독의 실패가 나머지를 멈추면 안 된다. 예전에는 복호화가 안 되는
    // 결제키 하나가 예외를 던져 그 뒤 구독자가 아무도 청구되지 않았고,
    // 오래된 행 정리와 일일 운영 보고 메일까지 함께 건너뛰었다. 다음 날도
    // 같은 자리에서 멈춰 스스로 낫지 않는 종류의 고장이었다.
    try {
      const result = await chargeSubscription(sub, p, u ?? { email: '', name: '' });
      result.ok ? summary.charged++ : summary.failed++;
    } catch (e: any) {
      summary.failed++;
      // 결제키를 못 읽는 구독은 다시 시도해도 같다. 멈춰 두고 사람이 보게 한다.
      // 카드를 다시 등록하면 새 키가 저장되어 풀린다.
      await supabase.from('subscriptions')
        .update({ status: 'paused', next_billing_at: null, updated_at: new Date().toISOString() })
        .eq('id', sub.id);
      await logSystemError('정기결제', '구독 청구 중 예외가 발생해 이 구독을 멈췄습니다', {
        detail: e?.message ?? String(e),
        userId: sub.user_id,
      });
    }
  }

  const cleaned = await cleanupOldRows();
  await sendDailyOpsReport(today, summary);

  return res.status(200).json({ ok: true, date: today, ...summary, cleaned });
}

// ── 오래된 로그 정리 ───────────────────────────────────────
// api_calls는 호출 1건당 1행이라 그대로 두면 무한정 쌓인다.
// 환불 '미사용' 판정이 이 테이블을 보므로 90일치는 반드시 남긴다.
const LOG_RETENTION_DAYS = 90;

async function cleanupOldRows(): Promise<{ apiCalls: number; verifications: number }> {
  const result = { apiCalls: 0, verifications: 0 };
  const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 86400_000).toISOString();

  // count만 받는다. select로 행을 끌어오면 첫 실행에서 대량 전송이 발생한다.
  const { count: calls } = await supabase
    .from('api_calls').delete({ count: 'exact' }).lt('created_at', cutoff);
  result.apiCalls = calls ?? 0;

  // 만료된 인증코드 — 가입을 끝내지 않은 행이 남는다. 하루 지난 것부터 정리.
  const { count: v } = await supabase
    .from('email_verifications').delete({ count: 'exact' })
    .lt('expires_at', new Date(Date.now() - 86400_000).toISOString());
  result.verifications = v ?? 0;

  return result;
}

// ── 운영 일일 요약 메일 ────────────────────────────────────
// 결제가 실패해도 관리자가 알 방법이 없어, 크론이 돈 결과를 매일 보낸다.
async function sendDailyOpsReport(date: string, summary: Record<string, number>) {
  const to = (process.env.ADMIN_EMAIL || '').trim();
  if (!to) return;

  const stats = await collectTodayStats();
  const row = (label: string, value: string | number, warn = false) =>
    `<tr>
       <td style="padding:8px 0;color:#b9c2d8;font-size:14px;">${label}</td>
       <td style="padding:8px 0;text-align:right;font-weight:700;font-size:15px;color:${warn ? '#ff6b6b' : '#f5f8ff'};">${value}</td>
     </tr>`;

  const hasProblem = summary.failed > 0 || stats.pastDue > 0 || stats.paused > 0;

  await sendEmail(to, `[훈프로] ${date} 운영 요약${hasProblem ? ' — 확인 필요' : ''}`, wrapEmail(
    `${date} 운영 요약`,
    `<p>자동결제 크론이 방금 실행됐습니다.</p>
     <table style="width:100%;border-collapse:collapse;margin:16px 0;">
       ${row('결제 성공', `${summary.charged}건`)}
       ${row('결제 실패', `${summary.failed}건`, summary.failed > 0)}
       ${row('기간 종료 해지', `${summary.canceled}건`)}
       ${row('사전 고지 발송', `${summary.notified}건`)}
     </table>
     <p style="margin-top:24px;font-weight:700;">현재 구독 현황</p>
     <table style="width:100%;border-collapse:collapse;margin:16px 0;">
       ${row('이용 중', `${stats.active}명`)}
       ${row('무료 기간', `${stats.trial}명`)}
       ${row('결제 실패 재시도 중', `${stats.pastDue}명`, stats.pastDue > 0)}
       ${row('정지', `${stats.paused}명`, stats.paused > 0)}
       ${row('오늘 신규 구독', `${stats.newToday}명`)}
       ${row('오늘 해지 신청', `${stats.canceledToday}명`)}
     </table>
     ${hasProblem
       ? '<p style="color:#ffb454;">결제 실패나 정지 계정이 있습니다. 관리자 화면에서 확인해주세요.</p>'
       : '<p style="color:#98a3bf;">특이사항 없습니다.</p>'}`
  ));
}

// 오늘/현재 기준 구독 지표 — 요약 메일과 관리자 화면이 함께 쓴다
async function collectTodayStats() {
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const since = new Date(startOfDay.getTime() - 9 * 3600_000).toISOString(); // KST 자정

  const { data: subs } = await supabase
    .from('subscriptions').select('status, created_at, canceled_at, cancel_at_period_end');

  const stats = {
    active: 0, trial: 0, pastDue: 0, paused: 0, canceled: 0,
    newToday: 0, canceledToday: 0, cancelScheduled: 0,
  };
  for (const s of subs ?? []) {
    if (s.status === 'active') stats.active++;
    else if (s.status === 'trial') stats.trial++;
    else if (s.status === 'past_due') stats.pastDue++;
    else if (s.status === 'paused') stats.paused++;
    else if (s.status === 'canceled') stats.canceled++;

    if (s.created_at && s.created_at >= since) stats.newToday++;
    if (s.canceled_at && s.canceled_at >= since) stats.canceledToday++;
    if (s.cancel_at_period_end && s.status !== 'canceled') stats.cancelScheduled++;
  }
  return stats;
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
  const note = referralNote(user.userId);

  // 이 화면은 열 때마다 들어온다. '없으면 만든다'가 조용히 어긋나면 열 때마다
  // 새 코드가 생긴다.
  //
  // maybeSingle()은 행이 둘 이상이면 오류(PGRST116)를 내고 data를 null로 준다.
  // 예전에는 error를 버리고 data만 봐서, 어쩌다 둘이 생긴 사용자는 그 뒤로
  // 화면을 열 때마다 코드가 하나씩 더 쌓이게 돼 있었다. 그래서 오류는 오류로
  // 다루고, 둘이 생기는 것 자체를 DB 유니크 인덱스로 막았다
  // (coupons_referral_note_uniq — note가 'referral:%'인 행에만 걸린다).
  const first = await supabase.from('coupons').select('*').eq('note', note).maybeSingle();
  if (first.error) {
    console.error('[billing] 추천 코드 조회 실패', { userId: user.userId, code: first.error.code });
    return res.status(500).json({ error: '추천 코드를 불러오지 못했습니다.' });
  }
  let existing = first.data;

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
      if (!error) {
        existing = data;
        break;
      }
      if (error.code !== '23505') return res.status(500).json({ error: '추천 코드 생성에 실패했습니다.' });
      // 23505는 두 가지다. 코드가 겹쳤으면 다시 뽑으면 되고, note가 겹쳤으면
      // 다른 요청이 방금 만든 것이므로 그것을 읽어 쓴다. 다시 뽑아 봐야 같은
      // 벽에 부딪힌다.
      const again = await supabase.from('coupons').select('*').eq('note', note).maybeSingle();
      if (again.data) {
        existing = again.data;
        break;
      }
    }
    if (!existing) return res.status(500).json({ error: '추천 코드 생성에 실패했습니다.' });
  }
  const [{ count: pending }, monthly] = await Promise.all([
    supabase.from('referral_rewards')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_id', user.userId)
      .is('consumed_at', null),
    monthlyListPrice(),
  ]);

  return res.status(200).json({
    code: existing.code,
    type: existing.type,
    value: existing.value,
    redeemedCount: existing.redeemed_count ?? 0,
    active: existing.active !== false,
    // 보상은 플랜과 무관하게 같은 금액이다 — 화면에도 금액으로 보여준다
    rewardAmount: withVat(referralRewardAmount(monthly, REFERRAL_REWARD_PERCENT)).total,
    rewardPending: pending ?? 0,
  });
}

// 수익 요약 — 구독자 수(상태별)·MRR 추정·최근 30일 결제액·해지 수
// ── 매출 집계 ──────────────────────────────────────────────
// 순매출 = 결제액 − 환불액. 환불은 결제가 일어난 달이 아니라
// 환불이 일어난 달에서 빼야 그 달의 실제 입금액과 맞는다.
async function adminRevenue(res: VercelResponse) {
  const MONTHS = 12;
  const from = new Date();
  from.setUTCMonth(from.getUTCMonth() - (MONTHS - 1), 1);
  from.setUTCHours(0, 0, 0, 0);

  const [{ data: pays }, { data: planRows }] = await Promise.all([
    supabase
      .from('payments')
      .select('amount, discount, status, refunded_amount, refunded_at, created_at, user_id, subscriptions(plan_id)')
      .in('status', ['paid', 'refunded', 'partial_refund']),
    supabase.from('plans').select('id, name, interval'),
  ]);

  const planMap = new Map((planRows ?? []).map(p => [p.id, p]));
  const monthKey = (iso: string) => {
    const d = new Date(iso);
    // KST 기준으로 월을 가른다 (자정 직후 결제가 전날 달로 잡히지 않게)
    const kst = new Date(d.getTime() + 9 * 3600_000);
    return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
  };

  // 최근 12개월 축 (결제가 없는 달도 빈칸으로 남긴다)
  const months: string[] = [];
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - i, 1);
    const kst = new Date(d.getTime() + 9 * 3600_000);
    months.push(`${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  // 쿠폰이 적용된 결제는 매출에서 빼고 따로 센다. 프로모션으로 받은 돈을
  // 정상 매출에 섞으면 다음 달 예측이 부풀려진다. 다만 실제로 들어온 돈이라
  // 정산 대조가 가능하도록 숨기지 않고 별도 항목으로 돌려준다.
  // (무료 기간 쿠폰은 결제 자체가 없어 payments 행이 생기지 않는다)
  type Bucket = { gross: number; refund: number; count: number; payers: Set<string>;
                  couponNet: number; couponCount: number };
  const buckets = new Map<string, Bucket>(
    months.map(m => [m, { gross: 0, refund: 0, count: 0, payers: new Set<string>(),
                          couponNet: 0, couponCount: 0 }]),
  );

  const totals = { gross: 0, refund: 0, count: 0, couponNet: 0, couponCount: 0 };
  const allPayers = new Set<string>();
  const byPlan = new Map<string, { name: string; interval: string; net: number; count: number }>();

  for (const p of pays ?? []) {
    const amount = Number(p.amount || 0);
    // status가 refunded면 전액 환불이다. refunded_amount는 웹훅이 채우는 값이라
    // 웹훅 등록 전이나 앱 밖에서 취소된 건은 비어 있을 수 있다. 그때 0으로 두면
    // 환불된 돈이 매출로 남으므로 결제액 전체를 환불로 본다.
    const recorded = Number(p.refunded_amount || 0);
    const refunded = p.status === 'refunded' ? Math.max(recorded, amount) : recorded;
    const mk = monthKey(p.created_at);

    // 쿠폰 적용 결제 — 매출 집계에서 제외하고 별도로 센다
    if (Number(p.discount || 0) > 0) {
      totals.couponNet += amount - refunded;
      totals.couponCount += 1;
      const cb = buckets.get(mk);
      if (cb) { cb.couponNet += amount - refunded; cb.couponCount += 1; }
      continue;
    }

    totals.gross += amount;
    totals.refund += refunded;
    totals.count += 1;
    if (p.user_id) allPayers.add(p.user_id);

    const b = buckets.get(mk);
    if (b) {
      b.gross += amount;
      b.count += 1;
      if (p.user_id) b.payers.add(p.user_id);
    }

    // 환불은 환불 시점의 달에서 차감
    if (refunded > 0) {
      const rk = monthKey(p.refunded_at || p.created_at);
      const rb = buckets.get(rk);
      if (rb) rb.refund += refunded;
    }

    const planId = (p as any).subscriptions?.plan_id;
    const plan = planId ? planMap.get(planId) : null;
    const key = plan?.id ?? 'unknown';
    const cur = byPlan.get(key) ?? {
      name: plan?.name ?? '(플랜 정보 없음)',
      interval: plan?.interval ?? 'month',
      net: 0, count: 0,
    };
    cur.net += amount - refunded;
    cur.count += 1;
    byPlan.set(key, cur);
  }

  const monthly = months.map(m => {
    const b = buckets.get(m)!;
    return {
      month: m,
      gross: b.gross,
      refund: b.refund,
      net: b.gross - b.refund,
      count: b.count,
      payers: b.payers.size,
      couponNet: b.couponNet,
      couponCount: b.couponCount,
    };
  });

  const thisMonth = monthly[monthly.length - 1];
  const lastMonth = monthly[monthly.length - 2];

  return res.status(200).json({
    totals: {
      gross: totals.gross,
      refund: totals.refund,
      net: totals.gross - totals.refund,
      count: totals.count,
      payers: allPayers.size,
      couponNet: totals.couponNet,
      couponCount: totals.couponCount,
    },
    thisMonth,
    lastMonth: lastMonth ?? null,
    // 결제자 1명당 이번 달 순매출
    arpu: thisMonth.payers > 0 ? Math.round(thisMonth.net / thisMonth.payers) : 0,
    monthly,
    byPlan: [...byPlan.values()].sort((a, b) => b.net - a.net),
  });
}

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

  // 오늘 지표 — 매일 확인해야 이상을 하루 안에 발견할 수 있다
  const today = await collectTodayStats();
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const sinceKst = new Date(startOfDay.getTime() - 9 * 3600_000).toISOString();
  const todayPays = (pays ?? []).filter(p => p.created_at >= sinceKst);

  // 해지 사유 분포 (최근 30일) — 무엇을 고쳐야 하는지 알려주는 지표
  const { data: reasons } = await supabase
    .from('subscriptions').select('cancel_reason')
    .not('cancel_reason', 'is', null).gte('canceled_at', monthAgo);
  const cancelReasons: Record<string, number> = {};
  for (const r of reasons ?? []) {
    if (r.cancel_reason) cancelReasons[r.cancel_reason] = (cancelReasons[r.cancel_reason] || 0) + 1;
  }

  return res.status(200).json({
    counts,
    totalSubscribers: counts.trial + counts.active + counts.past_due,
    mrr,
    // 해지 예약 — 아직 status가 canceled로 넘어가지 않은 구독.
    // 체험이나 남은 기간이 끝나는 날 크론이 canceled로 바꾼다. 그때까지
    // '최근 30일 해지'에는 안 잡히므로, 오늘 해지한 사람이 0으로 보인다.
    // 카드가 서로 어긋나 보이지 않게 여기서도 함께 내려준다.
    cancelScheduled: today.cancelScheduled,
    revenue30d: paidList.reduce((s, p) => s + Number(p.amount || 0), 0),
    payments30d: paidList.length,
    failed30d: failedList.length,
    canceled30d,
    today: {
      newSubs: today.newToday,
      canceled: today.canceledToday,
      paid: todayPays.filter(p => p.status === 'paid').length,
      failed: todayPays.filter(p => p.status === 'failed').length,
      revenue: todayPays.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount || 0), 0),
      needsAttention: counts.past_due + counts.paused,
      cancelScheduled: today.cancelScheduled,
    },
    cancelReasons,
  });
}

async function adminCoupons(res: VercelResponse) {
  const { data } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });

  // 쿠폰마다 '지금 이 할인을 받고 있는 구독'이 몇 건인지 함께 센다.
  // 이 숫자가 없으면 관리자는 지워도 되는 쿠폰인지 알 수 없다.
  const { data: live } = await supabase
    .from('subscriptions')
    .select('coupon_id, coupon_remaining_cycles')
    .in('status', LIVE_COUPON_STATUSES)
    .not('coupon_id', 'is', null);

  const inUse: Record<string, number> = {};
  for (const sub of live ?? []) {
    // 판정은 src/lib/coupon.ts 한 곳에 둔다. 목록의 '할인 중 N명'과 삭제를
    // 막는 기준이 갈라지면, 눌러도 안 되는 버튼이 멀쩡히 활성화된다.
    if (!stillDiscounted({ ...sub, status: 'active' })) continue;
    const id = String(sub.coupon_id);
    inUse[id] = (inUse[id] ?? 0) + 1;
  }

  return res.status(200).json({
    coupons: (data ?? []).map(c => ({ ...c, inUse: inUse[String(c.id)] ?? 0 })),
  });
}


/**
 * 쿠폰 삭제.
 *
 * subscriptions.coupon_id에는 외래키가 걸려 있지 않다. 그래서 쿠폰을 지워도
 * DB는 아무 말 없이 받아 주고, 그 쿠폰으로 구독 중인 사람은 다음 갱신 때
 * 쿠폰 조회가 빈 값이 되어 조용히 정가로 청구된다. "해지할 때까지 할인"이라고
 * 약속하고 받은 사람이 어느 달 갑자기 11,000원을 더 내는 것이다.
 *
 * 그래서 쓰고 있는 사람이 있으면 지우지 않는다. 대신 '중지'를 안내한다 —
 * 중지는 새 사용만 막고 이미 받은 할인은 건드리지 않는다.
 */
async function adminCouponDelete(req: VercelRequest, res: VercelResponse) {
  const id = String(req.body?.id ?? '').trim();
  if (!id) return res.status(400).json({ error: '쿠폰을 지정해주세요.' });

  const { data: coupon } = await supabase
    .from('coupons').select('id, code').eq('id', id).maybeSingle();
  if (!coupon) return res.status(404).json({ error: '이미 삭제된 쿠폰입니다.' });

  const { data: live } = await supabase
    .from('subscriptions')
    .select('id, status, coupon_remaining_cycles')
    .eq('coupon_id', id)
    .in('status', LIVE_COUPON_STATUSES);

  const discountedCount = (live ?? []).filter(
    s => stillDiscounted({ ...s, coupon_id: id, status: s.status }),
  ).length;

  if (discountedCount > 0) {
    return res.status(409).json({
      error:
        `이 쿠폰으로 할인받는 구독이 ${discountedCount}건 있어 삭제할 수 없습니다. ` +
        `지우면 그분들이 다음 결제부터 말없이 정가로 청구됩니다. ` +
        `새로 쓰는 것만 막으려면 [중지]를 눌러주세요 — 이미 받은 할인은 그대로 유지됩니다.`,
      inUse: discountedCount,
    });
  }

  // 사용 기록(coupon_redemptions)은 외래키가 CASCADE라 함께 지워진다.
  const { error } = await supabase.from('coupons').delete().eq('id', id);
  if (error) return res.status(500).json({ error: '쿠폰을 삭제하지 못했습니다.' });
  return res.status(200).json({ ok: true, code: coupon.code });
}

async function adminCouponCreate(req: VercelRequest, res: VercelResponse) {
  const { code, type, value, durationCycles, maxRedemptions, expiresAt, note, trialDays } = req.body ?? {};
  if (!code || !type || !value) return res.status(400).json({ error: '코드·유형·값은 필수입니다.' });
  if (!['free_period', 'percent', 'amount', 'amount_monthly'].includes(type)) {
    return res.status(400).json({ error: '잘못된 쿠폰 유형입니다.' });
  }
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0 || (type === 'percent' && v > 100)) {
    return res.status(400).json({ error: '쿠폰 값이 올바르지 않습니다.' });
  }
  const days = trialDays === null || trialDays === undefined || trialDays === '' ? 0 : Number(trialDays);
  if (!Number.isFinite(days) || days < 0 || days > 3650) {
    return res.status(400).json({ error: '무료 일수가 올바르지 않습니다.' });
  }

  const { data, error } = await supabase.from('coupons').insert({
    code: String(code).trim().toUpperCase(),
    type,
    value: v,
    // 무료 기간만 주는 옛 유형은 회차가 1로 고정이다 (할인이 없어 쓸 자리가 없다)
    duration_cycles: type === 'free_period' ? 1 : (durationCycles === null || durationCycles === '' ? null : Number(durationCycles) || 1),
    trial_days: type === 'free_period' ? 0 : Math.floor(days),
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

/**
 * 결제 내역 — 누가 언제 얼마를 냈나.
 *
 * '결제 성공 0건' 같은 숫자만으로는 무엇을 확인할 수가 없다. 고객이 "돈이
 * 나갔는데요" 하고 물어올 때 답할 수 있어야 한다.
 *
 * payments.user_id는 회원 삭제 시 SET NULL이다(결제 기록은 법정 5년 보존).
 * 그래서 회원이 사라진 결제도 남아 있고, 그때는 이름 없이 주문번호로만
 * 보여준다 — 기록이 있는데 목록에서 사라지는 것보다 낫다.
 */
async function adminPayments(req: VercelRequest, res: VercelResponse) {
  const from = String(req.body?.from ?? req.query.from ?? '').trim();
  const to = String(req.body?.to ?? req.query.to ?? '').trim();
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

  let q = supabase
    .from('payments')
    .select('id, order_id, order_name, amount, discount, status, fail_reason, receipt_url, approved_at, created_at, refunded_amount, refunded_at, supply_amount, vat_amount, users(name, email)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (isDate(from)) q = q.gte('created_at', `${from}T00:00:00+09:00`);
  if (isDate(to)) q = q.lte('created_at', `${to}T23:59:59+09:00`);

  const { data, error } = await q;
  if (error) {
    await logSystemError('결제 내역', `결제 내역을 불러오지 못했습니다: ${error.message}`, { severity: 'error' });
    return res.status(500).json({ error: `결제 내역 조회 실패: ${error.message}` });
  }

  const rows = data ?? [];
  // 합계는 이 기간의 것이다. 환불은 결제액에서 빼지 않고 따로 센다 —
  // 섞으면 '얼마 들어왔나'와 '얼마 돌려줬나'를 둘 다 잃는다.
  const paid = rows.filter((r: any) => r.status === 'paid');
  const refunded = rows.filter((r: any) => (Number(r.refunded_amount) || 0) > 0);
  return res.status(200).json({
    payments: rows,
    totals: {
      paidCount: paid.length,
      paidAmount: paid.reduce((n: number, r: any) => n + (Number(r.amount) || 0), 0),
      failedCount: rows.filter((r: any) => r.status === 'failed').length,
      refundedCount: refunded.length,
      refundedAmount: refunded.reduce((n: number, r: any) => n + (Number(r.refunded_amount) || 0), 0),
    },
    range: { from: isDate(from) ? from : null, to: isDate(to) ? to : null },
  });
}

async function adminSubscriptions(req: VercelRequest, res: VercelResponse) {
  // 기간. 안 주면 전체(누적)다 — '오늘'만 보이던 화면에서 되짚어 보려면
  // 기간을 고를 수 있어야 한다.
  const from = String(req.body?.from ?? req.query.from ?? '').trim();
  const to = String(req.body?.to ?? req.query.to ?? '').trim();
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

  let q = supabase
    .from('subscriptions')
    .select('id, status, card_summary, next_billing_at, current_period_end, cancel_at_period_end, canceled_at, cancel_reason, fail_count, created_at, users(name, email), coupons(code), plans(name)')
    .order('created_at', { ascending: false })
    .limit(200);
  // 시작일 기준으로 거른다. 해지 시점은 표에서 따로 보여준다.
  if (isDate(from)) q = q.gte('created_at', `${from}T00:00:00+09:00`);
  if (isDate(to)) q = q.lte('created_at', `${to}T23:59:59+09:00`);

  const { data, error } = await q;
  // error를 버리면 안 된다. 예전에는 조인 하나가 깨졌을 때 빈 배열이 나가서
  // 화면이 "아직 구독이 없습니다"로만 보였다 — 칩의 숫자는 조인 없는 별도
  // 쿼리라 멀쩡히 4가 뜨고. 어디가 고장 났는지 알 방법이 없었다.
  if (error) {
    await logSystemError('구독 목록', `구독 목록을 불러오지 못했습니다: ${error.message}`, { severity: 'error' });
    return res.status(500).json({ error: `구독 목록 조회 실패: ${error.message}` });
  }

  // 칩의 숫자는 늘 전체 기준이다. 기간을 좁혔다고 '해지 0'이 되면
  // 이 사람이 해지를 한 적이 없는 건지 그 기간에만 없는 건지 알 수 없다.
  const { data: counts } = await supabase.from('subscriptions').select('status');
  const byStatus: Record<string, number> = {};
  for (const row of counts ?? []) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;

  return res.status(200).json({
    subscriptions: data ?? [],
    byStatus,
    range: { from: isDate(from) ? from : null, to: isDate(to) ? to : null },
  });
}
