import test from 'node:test';
import assert from 'node:assert/strict';
import { rollupMonths, driverOf, driverSentence, subjectParticle, type MonthProfit } from '../src/lib/monthlyProfit.ts';

const m = (month: string, over: Partial<MonthProfit> = {}): MonthProfit => ({
  month,
  quantity: 100,
  salesAmount: 10_000_000,
  couponDiscount: 2_000_000,
  commission: 950_000,
  unitCost: 4_000_000,
  returnCost: 100_000,
  returnAmount: 300_000,
  adCost: 1_000_000,
  profit: 1_950_000,
  ...over,
});

test('최근 달이 위로 온다 — 표를 열면 이번 달부터 보인다', () => {
  const rows = rollupMonths([m('2026-06'), m('2026-07'), m('2026-08')]);
  assert.deepEqual(rows.map(r => r.month), ['2026-08', '2026-07', '2026-06']);
});

test('지난달 대비 증감을 낸다', () => {
  const rows = rollupMonths([
    m('2026-07', { salesAmount: 10_000_000, profit: 1_000_000 }),
    m('2026-08', { salesAmount: 12_000_000, profit: 1_500_000 }),
  ]);
  const aug = rows[0];
  assert.equal(aug.prevMonth, '2026-07');
  assert.equal(aug.salesDelta, 2_000_000);
  assert.equal(aug.profitDelta, 500_000);
});

test('지난달에 판매가 없었으면 증감을 내지 않는다 — 쉬었다 돌아온 달이 늘 최고가 된다', () => {
  const rows = rollupMonths([
    m('2026-07', { quantity: 0, salesAmount: 0, profit: 0 }),
    m('2026-08'),
  ]);
  assert.equal(rows[0].prevMonth, null);
  assert.equal(rows[0].profitDelta, null);
  assert.equal(rows[0].driver, null);
});

test('판매가 없는 달도 표에서 빼지 않는다 — 두 달 쉰 것이 안 보이면 안 된다', () => {
  const rows = rollupMonths([m('2026-06'), m('2026-07', { quantity: 0, salesAmount: 0 }), m('2026-08')]);
  assert.equal(rows.length, 3);
  assert.equal(rows.find(r => r.month === '2026-07')!.hasData, false);
});

test('순이익이 줄면 가장 많이 늘어난 비용을 짚는다', () => {
  const prev = m('2026-07', { adCost: 1_000_000, couponDiscount: 2_000_000, profit: 2_000_000 });
  const cur = m('2026-08', { adCost: 1_900_000, couponDiscount: 2_200_000, profit: 900_000 });
  const d = driverOf(cur, prev)!;
  assert.equal(d.label, '광고비');
  assert.equal(d.delta, 900_000);
  assert.equal(driverSentence(d), '광고비가 900,000원 늘었습니다');
});

test('비용이 하나도 안 늘었는데 순이익이 줄었으면 덜 팔린 것이다', () => {
  const prev = m('2026-07', { salesAmount: 10_000_000, profit: 2_000_000 });
  const cur = m('2026-08', {
    salesAmount: 6_000_000, profit: 1_000_000,
    couponDiscount: 1_000_000, commission: 500_000, unitCost: 2_400_000, returnCost: 50_000, adCost: 900_000,
  });
  assert.equal(driverOf(cur, prev)!.label, '매출');
});

test('매출은 그대로인데 순이익이 늘었으면 비용을 줄인 것이다', () => {
  const prev = m('2026-07', { adCost: 2_000_000, profit: 1_000_000 });
  const cur = m('2026-08', { adCost: 500_000, profit: 2_500_000 });
  const d = driverOf(cur, prev)!;
  assert.equal(d.label, '광고비');
  assert.ok(d.delta < 0);
  assert.equal(driverSentence(d), '광고비가 1,500,000원 줄었습니다');
});

test('순이익이 거의 그대로면 원인을 지어내지 않는다', () => {
  const prev = m('2026-07', { profit: 2_000_000 });
  const cur = m('2026-08', { profit: 2_020_000 });   // 1% 차이
  assert.equal(driverOf(cur, prev), null);
  assert.equal(driverSentence(null), null);
});

test('마진율은 주문금액 기준이고, 매출이 0이면 0이다', () => {
  const rows = rollupMonths([
    m('2026-07', { salesAmount: 10_000_000, profit: 1_500_000 }),
    m('2026-08', { quantity: 0, salesAmount: 0, profit: 0 }),
  ]);
  assert.equal(rows.find(r => r.month === '2026-07')!.marginRate, 15);
  assert.equal(rows.find(r => r.month === '2026-08')!.marginRate, 0);
});

test('적자 달의 순이익 증감도 방향이 맞다', () => {
  const rows = rollupMonths([
    m('2026-07', { profit: -500_000 }),
    m('2026-08', { profit: -200_000 }),
  ]);
  assert.equal(rows[0].profitDelta, 300_000);
});

test('조사는 받침을 보고 고른다 — "광고비이(가)"는 기계가 쓴 티가 난다', () => {
  assert.equal(subjectParticle('광고비'), '가');
  assert.equal(subjectParticle('수수료'), '가');
  assert.equal(subjectParticle('쿠폰'), '이');
  assert.equal(subjectParticle('매출'), '이');
  assert.equal(subjectParticle('반품 배송비'), '가');
  // 한글이 아닌 끝글자는 무난한 쪽으로
  assert.equal(subjectParticle('ROAS'), '가');
});
