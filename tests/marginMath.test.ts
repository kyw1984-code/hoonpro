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

// ── 옵션별 마진표 ──
import { optionMarginTable } from '../src/lib/marginMath.ts';

const preset = (over: any = {}) => ({
  vendorItemId: '111',
  unitPrice: 36400,
  couponPerUnit: 15982,
  unitCost: 8000,
  fulfillmentCost: 3650,
  returnRate: 0,
  returnShippingCost: 0,
  hasCost: true,
  ...over,
});

test('옵션마다 제 판매가·원가로 마진을 낸다', () => {
  const t = optionMarginTable([
    preset(),
    preset({ vendorItemId: '222', unitPrice: 9900, couponPerUnit: 0, unitCost: 3000, fulfillmentCost: 2000 }),
  ], 11.88);
  assert.equal(t.size, 2);
  assert.equal(t.get('111')!.netUnitPrice, 20418);
  assert.equal(t.get('111')!.netUnitMargin, 6342);
  // 9,900원짜리를 20,418원짜리 마진으로 계산하면 순이익이 통째로 틀린다
  assert.equal(t.get('222')!.netUnitPrice, 9900);
  assert.equal(t.get('222')!.netUnitMargin, 9900 - 3000 - 2000 - 1176);
});

test('원가가 없는 옵션은 표에 넣지 않는다 — 원가 0이면 마진이 판매가만큼 나온다', () => {
  const t = optionMarginTable([
    preset({ vendorItemId: 'A', hasCost: false, unitCost: 0 }),
    preset({ vendorItemId: 'B', hasCost: true, unitCost: 0 }),
    preset({ vendorItemId: 'C' }),
  ], 11.88);
  assert.equal(t.has('A'), false);
  assert.equal(t.has('B'), false);
  assert.equal(t.has('C'), true);
});

test('쿠폰이 판매가를 다 깎아 실결제가가 0이면 넣지 않는다 — 마진율이 무한대가 된다', () => {
  const t = optionMarginTable([preset({ couponPerUnit: 40000 })], 11.88);
  assert.equal(t.size, 0);
});

test('옵션별 반품률도 각자 반영된다', () => {
  const t = optionMarginTable([
    preset({ vendorItemId: '반품없음', returnRate: 0 }),
    preset({ vendorItemId: '반품많음', returnRate: 10, returnShippingCost: 3000 }),
  ], 11.88);
  assert.ok(t.get('반품많음')!.netUnitMargin < t.get('반품없음')!.netUnitMargin);
});

test('마진율은 실결제가 기준이다 — 실측 전환매출에 곱해 순이익을 낸다', () => {
  const t = optionMarginTable([preset()], 11.88);
  const m = t.get('111')!;
  assert.equal(m.netMarginRate, 6342 / 20418);
  // 전환매출 100,000원이면 순이익은 그 비율만큼
  assert.equal(Math.round(100000 * m.netMarginRate), 31061);
});

test('옵션ID가 비었으면 건너뛴다', () => {
  assert.equal(optionMarginTable([preset({ vendorItemId: '' })], 11.88).size, 0);
});
