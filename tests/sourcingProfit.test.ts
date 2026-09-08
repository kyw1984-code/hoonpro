/**
 * 소싱 손익 계산 테스트.
 *
 * 이 숫자를 보고 공장에 가격을 부른다. 원가 상한이 실제보다 높게 나오면
 * 밑지는 소싱을 하게 되므로, 특히 '높게 나오는 방향'의 실수를 막는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costCeiling, marginAt, type SellerRates } from '../src/lib/sourcingProfit.ts';

const rates: SellerRates = {
  commission: 0.108,
  ad: 0.124,
  returns: 0.021,
  coupon: 0.41,
  basis: { orders: 53, salesAmount: 1929200, from: '2026-08-10', to: '2026-09-08' },
};

test('costCeiling: 쿠폰을 먼저 빼고 나머지를 실매출에 매긴다', () => {
  const c = costCeiling(36400, rates, 0.2);
  // 실매출 = 36,400 × (1 − 0.41)
  assert.equal(c.netPrice, 21476);
  assert.equal(c.commission, Math.round(21476 * 0.108));
  assert.equal(c.adCost, Math.round(21476 * 0.124));
  assert.equal(c.returnLoss, Math.round(21476 * 0.021));
  assert.equal(c.targetProfit, Math.round(21476 * 0.2));
  assert.equal(c.maxCost, c.netPrice - c.commission - c.adCost - c.returnLoss - c.targetProfit);
  assert.equal(c.impossible, false);
});

// 수수료·광고비·반품은 판매가가 아니라 '쿠폰을 뺀 실매출'에 매겨야 한다.
// 쿠팡 수수료는 실제 결제금액 기준이고, 광고비율·반품률도 실매출 대비로 잰 값이다.
// 판매가에 그대로 곱하면 큰 금액에 요율을 매겨 원가 상한이 실제보다 낮게 나오고,
// 팔 수 있는 상품을 못 판다고 판단하게 된다.
test('costCeiling: 요율은 판매가가 아니라 실매출에 매긴다', () => {
  const list = 36400;
  const c = costCeiling(list, rates, 0.2);

  // 실매출 기준으로 매겨졌는지 항목별로 확인한다
  assert.equal(c.commission, Math.round(c.netPrice * rates.commission));
  assert.notEqual(c.commission, Math.round(list * rates.commission));

  // 판매가에 요율을 매기는 계산과 비교하면 상한이 더 높다
  const onListPrice = Math.round(
    list - list * (rates.commission + rates.ad + rates.returns + 0.2) - list * rates.coupon,
  );
  assert.ok(c.maxCost > onListPrice);
});

// 비용률 합이 100%를 넘으면 원가가 0원이어도 목표를 못 맞춘다. 이때 상한을
// 양수로 보여 주면 "싸게만 사면 된다"고 읽혀 위험하다.
test('costCeiling: 목표를 못 맞추는 시장은 impossible로 알린다', () => {
  const heavy: SellerRates = { ...rates, ad: 0.5 };   // 수수료 10.8 + 광고 50 + 반품 2.1 + 목표 40 = 102.9%
  const c = costCeiling(20000, heavy, 0.4);
  assert.ok(c.maxCost <= 0);
  assert.equal(c.impossible, true);

  // 합이 100% 밑이면 상한은 양수다 — 쿠폰이 커도 그 자체로 불가능해지지는 않는다
  const couponHeavy = costCeiling(20000, { ...rates, coupon: 0.6 }, 0.3);
  assert.ok(couponHeavy.maxCost > 0);
  assert.equal(couponHeavy.impossible, false);
});

test('costCeiling: 비율이 비었거나 이상해도 무너지지 않는다', () => {
  const empty: SellerRates = { commission: 0, ad: 0, returns: 0, coupon: 0, basis: rates.basis };
  const c = costCeiling(10000, empty, 0);
  assert.equal(c.netPrice, 10000);
  assert.equal(c.maxCost, 10000);

  // 음수·NaN·1 초과는 잘라 낸다
  const odd: SellerRates = { commission: -1, ad: NaN, returns: 2, coupon: 0.5, basis: rates.basis };
  const c2 = costCeiling(10000, odd, 0);
  assert.equal(c2.netPrice, 5000);
  assert.equal(c2.commission, 0);
  assert.equal(c2.adCost, 0);
  assert.equal(c2.returnLoss, 5000); // 2 → 1로 잘림
});

test('marginAt: 견적 원가를 넣으면 실제 이익률이 나온다', () => {
  const c = costCeiling(36400, rates, 0);
  // 원가를 상한과 같게 넣으면 이익이 0이다
  assert.equal(marginAt(36400, c.maxCost, rates).profit, 0);
  // 상한보다 싸게 사면 그만큼 남는다
  assert.equal(marginAt(36400, c.maxCost - 1000, rates).profit, 1000);
  const m = marginAt(36400, 8000, rates);
  assert.ok(m.rate > 0 && m.rate < 1);
});
