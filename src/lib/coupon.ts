/**
 * 쿠폰 계산 — 서버 한 곳에서만 쓰지만 파일을 따로 둔다.
 *
 * 금액 계산이 api/billing.ts 안에 있으면 테스트를 돌릴 수 없다. 쿠폰은
 * 잘못 계산해도 화면에 오류가 뜨지 않고 그냥 돈이 덜 들어온다. 그런 코드는
 * 테스트가 있어야 한다.
 *
 * 쿠폰 유형
 *   free_period     value = 무료 일수 (할인 없음, 옛 방식)
 *   percent         value = 할인율(%)
 *   amount          value = 할인액(원) — 플랜과 무관하게 고정
 *   amount_monthly  value = 월 기준 할인액(원) — 연간에는 ×12
 *
 * amount_monthly가 있는 이유. 수강생에게 "월 5,000원 할인"을 주려고
 * amount 5,000을 쓰면 연간 결제(498,000원)에서도 5,000원만 깎인다. 월간은
 * 10% 할인인데 연간은 1%다. 같은 혜택을 말한 건데 플랜에 따라 값이
 * 달라지면 안 된다.
 *
 * 무료 기간은 이제 유형이 아니라 칸이다(trial_days). 유형으로 두면 "30일
 * 무료 + 이후 매달 5,000원 할인" 같은 쿠폰을 만들 수 없다. 둘 중 하나만
 * 고르게 되기 때문이다.
 */

export interface CouponLike {
  type: string;
  value: number;
  /** 무료 이용 일수 (0 = 없음). free_period 유형은 value가 이 역할을 한다 */
  trial_days?: number | null;
  duration_cycles?: number | null;
}

/** 토스 최소 결제 금액. 0원으로 떨어뜨릴 거면 할인이 아니라 무료 기간을 준다 */
export const MIN_CHARGE = 100;

/** 이 쿠폰이 주는 무료 이용 일수. 0이면 무료 기간 없이 바로 결제한다 */
export function trialDaysOf(coupon: CouponLike | null | undefined): number {
  if (!coupon) return 0;
  if (coupon.type === 'free_period') return Math.max(0, Math.floor(coupon.value));
  return Math.max(0, Math.floor(coupon.trial_days ?? 0));
}

/** 이 쿠폰이 결제 1회에서 깎는 금액 (공급가 기준, 상한 적용 전) */
export function couponDiscount(
  coupon: CouponLike | null | undefined,
  price: number,
  months: number,
): number {
  if (!coupon) return 0;
  if (coupon.type === 'percent') return Math.floor((price * coupon.value) / 100);
  if (coupon.type === 'amount') return Math.floor(coupon.value);
  if (coupon.type === 'amount_monthly') return Math.floor(coupon.value) * Math.max(1, Math.floor(months));
  return 0; // free_period는 할인이 아니라 기간으로 준다
}

export interface DiscountResult {
  /** 실제로 청구할 공급가액 */
  amount: number;
  /** 총 할인액 (쿠폰 + 추천 보상) */
  discount: number;
  fromCoupon: number;
  fromReward: number;
}

/**
 * 친구 추천 보상액 — 월간 정가의 몇 %인지로 정하고, 금액으로 고정한다.
 *
 * 비율로 두면 연간 구독자를 추천한 사람에게 35,760원이 나간다. 월간
 * 추천인은 3,980원을 받는데 같은 '10%'라는 말로 열 배가 갈린다. 보상은
 * 추천이라는 같은 행동의 대가이므로 플랜과 무관하게 같아야 한다.
 */
export function referralRewardAmount(monthlyPrice: number, percent: number): number {
  return Math.max(0, Math.floor((monthlyPrice * percent) / 100));
}

/**
 * 쿠폰 할인과 친구 추천 보상을 한 번에 반영한다.
 *
 * 둘이 겹칠 수 있으므로 합이 상한(정가 − 100원)을 넘지 않게 자른다. 자를
 * 때는 쿠폰을 먼저 채운다. 쿠폰은 사용자가 코드를 넣어 받은 약속이고,
 * 추천 보상은 우리가 얹어 주는 것이다. 약속한 쪽을 먼저 지킨다.
 *
 * rewardAmount는 공급가 기준 원이다 (비율이 아니다 — 위 함수 참고).
 */
export function applyDiscounts(
  price: number,
  coupon: CouponLike | null | undefined,
  months: number,
  rewardAmount = 0,
): DiscountResult {
  const max = Math.max(0, price - MIN_CHARGE);
  const fromCoupon = Math.min(Math.max(0, couponDiscount(coupon, price, months)), max);
  const fromReward = Math.min(Math.max(0, Math.floor(rewardAmount)), max - fromCoupon);
  const discount = fromCoupon + fromReward;
  return { amount: price - discount, discount, fromCoupon, fromReward };
}

/** 관리자·사용자 화면에 쓰는 혜택 한 줄 설명 */
export function couponBenefitLabel(coupon: CouponLike): string {
  const parts: string[] = [];
  const days = trialDaysOf(coupon);
  if (days > 0) parts.push(`${days}일 무료`);
  if (coupon.type === 'percent') parts.push(`${coupon.value}% 할인`);
  else if (coupon.type === 'amount') parts.push(`${coupon.value.toLocaleString('ko-KR')}원 할인`);
  else if (coupon.type === 'amount_monthly') parts.push(`월 ${coupon.value.toLocaleString('ko-KR')}원 할인`);
  return parts.join(' + ') || '-';
}

/**
 * 이 구독이 아직 쿠폰 할인을 받고 있는가.
 *
 * 쿠폰을 지워도 되는지 판단하는 기준이다. subscriptions.coupon_id에는 외래키가
 * 없어서 쿠폰을 지워도 DB는 말없이 받아 준다. 그러면 다음 갱신 때 쿠폰 조회가
 * 빈 값이 되어 조용히 정가로 청구된다 — "해지할 때까지 할인"이라고 약속하고
 * 받은 사람이 어느 달 갑자기 더 내게 된다.
 *
 * 회차를 다 쓴 구독(remaining이 0)은 이미 정가를 내고 있으므로 지워도 달라질
 * 게 없다. null은 무제한이라 영원히 할인 중이다.
 */
export function stillDiscounted(sub: {
  coupon_id?: string | null;
  coupon_remaining_cycles?: number | null;
  status?: string | null;
}): boolean {
  if (!sub.coupon_id) return false;
  if (!LIVE_COUPON_STATUSES.includes(String(sub.status ?? ''))) return false;
  const remaining = sub.coupon_remaining_cycles;
  return remaining === null || remaining === undefined || remaining > 0;
}

/** 아직 할인이 살아 있을 수 있는 구독 상태. 해지·만료된 구독은 지워도 영향이 없다 */
export const LIVE_COUPON_STATUSES = ['trial', 'active', 'past_due', 'paused'];
