import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stillDiscounted,
  LIVE_COUPON_STATUSES,
  applyDiscounts,
  couponBenefitLabel,
  couponDiscount,
  referralRewardAmount,
  trialDaysOf,
  MIN_CHARGE,
} from '../src/lib/coupon.ts';
import { referrerIdFromNote, referralNote } from '../src/lib/referral.ts';

// 실제 요금 (공급가액, 부가세 별도)
const MONTHLY = 49800;
const YEARLY = 498000;   // 월간 10개월치 = 2개월 무료

test('amount 쿠폰은 플랜이 달라도 같은 금액만 깎는다', () => {
  const c = { type: 'amount', value: 5000 };
  assert.equal(couponDiscount(c, MONTHLY, 1), 5000);
  assert.equal(couponDiscount(c, YEARLY, 12), 5000);
});

test('amount_monthly 쿠폰은 연간 결제에서 12개월치를 깎는다', () => {
  const c = { type: 'amount_monthly', value: 5000 };
  assert.equal(couponDiscount(c, MONTHLY, 1), 5000);
  assert.equal(couponDiscount(c, YEARLY, 12), 60000);
});

test('percent 쿠폰은 정가 비율로 깎는다', () => {
  assert.equal(couponDiscount({ type: 'percent', value: 10 }, MONTHLY, 1), 4980);
  assert.equal(couponDiscount({ type: 'percent', value: 10 }, YEARLY, 12), 49800);
});

test('free_period 쿠폰은 할인이 아니라 기간으로 준다', () => {
  assert.equal(couponDiscount({ type: 'free_period', value: 30 }, MONTHLY, 1), 0);
});

test('무료 일수는 옛 유형과 새 칸을 모두 읽는다', () => {
  assert.equal(trialDaysOf({ type: 'free_period', value: 30 }), 30);
  assert.equal(trialDaysOf({ type: 'amount_monthly', value: 5000, trial_days: 14 }), 14);
  assert.equal(trialDaysOf({ type: 'percent', value: 10 }), 0);
  assert.equal(trialDaysOf(null), 0);
});

test('무료 일수와 할인은 한 쿠폰에 함께 담긴다', () => {
  // 수강생 쿠폰: 30일 무료 + 이후 매 갱신마다 월 5,000원
  const c = { type: 'amount_monthly', value: 5000, trial_days: 30, duration_cycles: null };
  assert.equal(trialDaysOf(c), 30);
  assert.equal(applyDiscounts(MONTHLY, c, 1).amount, 44800);
  assert.equal(applyDiscounts(YEARLY, c, 12).amount, 438000);
  assert.equal(couponBenefitLabel(c), '30일 무료 + 월 5,000원 할인');
});

test('추천 보상은 추천인의 플랜과 무관하게 월간 정가 기준 금액이다', () => {
  const reward = referralRewardAmount(MONTHLY, 10);
  assert.equal(reward, 4980);
  // 월간 추천인
  assert.equal(applyDiscounts(MONTHLY, null, 1, reward).amount, 44820);
  // 연간 추천인 — 같은 금액만 깎인다 (비율이었다면 49,800원이 나갔다)
  assert.equal(applyDiscounts(YEARLY, null, 12, reward).amount, 493020);
});

test('쿠폰 할인과 추천 보상은 함께 적용된다', () => {
  const c = { type: 'amount_monthly', value: 5000 };
  const r = applyDiscounts(MONTHLY, c, 1, 4980);
  assert.equal(r.fromCoupon, 5000);
  assert.equal(r.fromReward, 4980);
  assert.equal(r.discount, 9980);
  assert.equal(r.amount, MONTHLY - 9980);
});

test('할인 합이 정가를 넘어도 최소 결제 금액은 남긴다', () => {
  const c = { type: 'amount', value: 999999 };
  const r = applyDiscounts(MONTHLY, c, 1, 999999);
  assert.equal(r.amount, MIN_CHARGE);
  // 자를 때는 약속한 쿠폰을 먼저 채운다
  assert.equal(r.fromCoupon, MONTHLY - MIN_CHARGE);
  assert.equal(r.fromReward, 0);
});

test('쿠폰이 정가를 다 채우면 보상은 0으로 밀린다 (음수가 되지 않는다)', () => {
  const c = { type: 'percent', value: 100 };
  const r = applyDiscounts(MONTHLY, c, 1, 4980);
  assert.equal(r.fromReward, 0);
  assert.equal(r.amount, MIN_CHARGE);
});

test('쿠폰이 없으면 정가 그대로다', () => {
  const r = applyDiscounts(MONTHLY, null, 1);
  assert.equal(r.amount, MONTHLY);
  assert.equal(r.discount, 0);
});

test('추천 코드 note에서 발행자를 되찾는다', () => {
  const id = '994d7d30-ef09-45f2-8411-683e481befcd';
  assert.equal(referrerIdFromNote(referralNote(id)), id);
  // 운영자가 만든 일반 쿠폰은 추천 코드가 아니다
  assert.equal(referrerIdFromNote('기존 수강생 전원 무료 1개월'), null);
  assert.equal(referrerIdFromNote(null), null);
  assert.equal(referrerIdFromNote('referral:'), null);
});

// ── 쿠폰 삭제 안전장치 ──
// subscriptions.coupon_id에는 외래키가 없다. 쿠폰을 지워도 DB는 말없이 받아
// 주고, 다음 갱신 때 쿠폰 조회가 빈 값이 되어 조용히 정가로 청구된다.
// "해지할 때까지 할인"이라고 약속하고 받은 사람이 어느 달 갑자기 더 낸다.

test('무제한 할인(회차 null)은 영원히 할인 중이다 — 지우면 안 된다', () => {
  assert.equal(stillDiscounted({ coupon_id: 'c1', coupon_remaining_cycles: null, status: 'active' }), true);
  // 필드가 아예 없어도 무제한으로 본다. 모르면 막는 쪽이 안전하다.
  assert.equal(stillDiscounted({ coupon_id: 'c1', status: 'active' }), true);
});

test('남은 회차가 있으면 아직 할인 중이다', () => {
  assert.equal(stillDiscounted({ coupon_id: 'c1', coupon_remaining_cycles: 2, status: 'active' }), true);
});

test('회차를 다 쓴 구독은 이미 정가다 — 지워도 달라지지 않는다', () => {
  assert.equal(stillDiscounted({ coupon_id: 'c1', coupon_remaining_cycles: 0, status: 'active' }), false);
});

test('무료 이용·재시도 중·정지도 할인이 살아 있다', () => {
  for (const status of LIVE_COUPON_STATUSES) {
    assert.equal(stillDiscounted({ coupon_id: 'c1', coupon_remaining_cycles: null, status }), true, status);
  }
});

test('해지된 구독은 막지 않는다 — 다시 결제될 일이 없다', () => {
  assert.equal(stillDiscounted({ coupon_id: 'c1', coupon_remaining_cycles: null, status: 'canceled' }), false);
});

test('쿠폰 없이 구독한 사람은 애초에 관계없다', () => {
  assert.equal(stillDiscounted({ coupon_id: null, coupon_remaining_cycles: null, status: 'active' }), false);
  assert.equal(stillDiscounted({ status: 'active' }), false);
});
