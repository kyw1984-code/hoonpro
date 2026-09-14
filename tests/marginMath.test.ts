import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMargin, clampReturnRate } from '../src/lib/marginMath.ts';

// 실제 판매 한 건 기준: 주문단가 36,400 · 쿠폰 15,982 → 실결제 20,418
const base = { netUnitPrice: 20418, unitCost: 8000, deliveryFee: 3650, feeRate: 11.88 };

test('수수료는 쿠폰을 뺀 실결제가에 붙는다', () => {
  const m = computeMargin(base);
  assert.equal(m.fee, 2426);
  assert.equal(m.grossMargin, 20418 - 8000 - 3650 - 2426);
});

test('반품이 없으면 반품 손실도 없다', () => {
  const m = computeMargin(base);
  assert.equal(m.returnLoss, 0);
  assert.equal(m.netMargin, m.grossMargin);
});

test('반품률만큼 마진이 줄고 반품 배송비가 더 나간다', () => {
  const m = computeMargin({ ...base, returnRate: 5, returnShippingCost: 3000 });
  // 반품 1건은 그 건의 마진(6,342)을 잃고 배송비 3,000원까지 나간다
  assert.equal(m.grossMargin, 6342);
  assert.equal(m.returnLoss, Math.round(0.05 * (6342 + 3000)));
  assert.equal(m.netMargin, 6342 - 467);
});

test('반품을 빼면 손익분기 ROAS가 올라간다 — 빼먹으면 적자 광고를 흑자로 본다', () => {
  const without = computeMargin(base);
  const withReturns = computeMargin({ ...base, returnRate: 10, returnShippingCost: 3000 });
  assert.ok(withReturns.breakEvenROAS > without.breakEvenROAS);
  assert.equal(Math.round(without.breakEvenROAS), 322);
  assert.equal(Math.round(withReturns.breakEvenROAS), 378);
});

test('마진이 0 이하면 손익분기 ROAS는 0이다 — 어떤 ROAS로도 흑자가 안 된다', () => {
  const m = computeMargin({ ...base, unitCost: 30000 });
  assert.ok(m.netMargin < 0);
  assert.equal(m.breakEvenROAS, 0);
});

test('반품률은 0~90%로 자른다', () => {
  assert.equal(clampReturnRate(-5), 0);
  assert.equal(clampReturnRate(0), 0);
  assert.equal(clampReturnRate(5), 0.05);
  assert.equal(clampReturnRate(120), 0.9);
  assert.equal(clampReturnRate(NaN), 0);
});

test('판매가가 0이면 마진율과 ROAS를 지어내지 않는다', () => {
  const m = computeMargin({ ...base, netUnitPrice: 0 });
  assert.equal(m.marginRate, 0);
  assert.equal(m.breakEvenROAS, 0);
});
