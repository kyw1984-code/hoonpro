import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMonth, verdictLabel, type MonthFigures } from '../src/lib/settlementCheck.ts';

const base: MonthFigures = {
  month: '2026-08',
  marketSettlement: 1_598_906,   // 윙 — 쿠팡이 준 값
  growthSettlement: 0,
  growthNet: 0,
  coupangPaid: null,
  actual: null,
  returnQuantity: 0,
  // 기본은 '견줄 수 있는 달'로 둔다. 못 견주는 경우는 아래에서 따로 본다.
  salesCovered: true,
  cycleComplete: true,
  pendingLast: 0,
};

test('기준이 없으면 판정하지 않는다 — 없는 차이를 지어내지 않는다', () => {
  const r = checkMonth(base);
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.diff, null);
  assert.equal(r.reference, null);
  assert.equal(r.impliedGrowthFeeRate, null);
});

test('지급이 0원이면 아직 안 들어온 것이다 — 100% 어긋난 것으로 보지 않는다', () => {
  // handleSettlementCheck가 0을 null로 넘기고, 여기서도 0을 기준으로 쓰지 않는다
  const r = checkMonth({ ...base, coupangPaid: 0 });
  assert.equal(r.verdict, 'unknown');
});

test('정산서에 적어 넣은 값이 쿠팡 지급내역보다 우선한다', () => {
  const r = checkMonth({ ...base, coupangPaid: 1_500_000, actual: 1_598_906 });
  assert.equal(r.referenceSource, 'actual');
  assert.equal(r.diff, 0);
  assert.equal(r.verdict, 'ok');
});

test('1% 안쪽이면 맞은 것으로 본다', () => {
  const r = checkMonth({ ...base, coupangPaid: 1_600_000 });
  assert.equal(r.verdict, 'ok');
  assert.ok(Math.abs(r.diffRate!) < 1);
});

test('5%를 넘으면 어긋난 것이다', () => {
  const r = checkMonth({ ...base, coupangPaid: 1_800_000 });
  assert.equal(r.verdict, 'off');
  assert.equal(r.diff, 201_094);
});

test('그로스 수수료율을 역산한다 — 쿠폰을 빼지 않던 시절을 잡아낸다', () => {
  // 그로스 실결제액 1,000,000원. 우리는 11.88%로 계산해 882,000원(정산 880,000 가정)이라 했는데
  // 실제로는 13%가 빠져 870,000원만 들어왔다면, 역산 요율은 13%가 나와야 한다.
  const r = checkMonth({
    ...base,
    marketSettlement: 0,
    growthSettlement: 881_200,
    growthNet: 1_000_000,
    coupangPaid: 870_000,
  });
  assert.equal(r.impliedGrowthFeeRate, 13);
  // 요율이 1.1%p나 틀렸는데 지급액 차이는 1.29%밖에 안 된다. 차이 %만 보면
  // '한 번 보세요'로 지나간다 — 역산 요율 칸을 따로 둔 이유가 이것이다.
  assert.equal(r.verdict, 'watch');
  assert.equal(r.diffRate, -1.29);
});

test('윙 몫은 맞다고 두고 남는 몫만 그로스로 역산한다', () => {
  const r = checkMonth({
    ...base,
    marketSettlement: 500_000,
    growthSettlement: 881_200,
    growthNet: 1_000_000,
    coupangPaid: 1_370_000,   // 윙 500,000 + 그로스 870,000
  });
  assert.equal(r.impliedGrowthFeeRate, 13);
});

test('수수료로 설명되지 않는 차이는 역산하지 않는다', () => {
  // 반품 차감이 크게 섞이면 요율이 40%를 넘어간다. 그 숫자를 요율이라고
  // 보여 주면 판매자가 엉뚱한 데를 고치게 된다.
  const big = checkMonth({ ...base, marketSettlement: 0, growthSettlement: 881_200, growthNet: 1_000_000, coupangPaid: 300_000 });
  assert.equal(big.impliedGrowthFeeRate, null);
  // 지급이 실결제액보다 많으면 요율이 음수가 된다 — 이것도 요율이 아니다
  const neg = checkMonth({ ...base, marketSettlement: 0, growthSettlement: 881_200, growthNet: 1_000_000, coupangPaid: 1_100_000 });
  assert.equal(neg.impliedGrowthFeeRate, null);
});

test('그로스가 없으면 역산할 것도 없다', () => {
  const r = checkMonth({ ...base, coupangPaid: 1_400_000 });
  assert.equal(r.growthNet, 0);
  assert.equal(r.impliedGrowthFeeRate, null);
});

test('판정 이름은 한 곳에서만 만든다', () => {
  assert.equal(verdictLabel('ok'), '맞습니다');
  assert.equal(verdictLabel('off'), '어긋났습니다');
  assert.equal(verdictLabel('unknown'), '기준 없음');
});

// ── 견줄 수 없는 달은 판정하지 않는다 ──
// 쿠팡 주정산은 정산대상액의 70%를 먼저 주고 나머지 30%(최종액)를 익익월
// 1일에 준다. 매출 수집이 늦게 시작된 달도 있다. 그런 달에 '어긋났습니다'를
// 띄우면 진짜 어긋난 달이 그 속에 묻힌다.

test('매출 자료가 모자란 달은 집계 중으로 둔다', () => {
  const r = checkMonth({ ...base, coupangPaid: 3_218_552, salesCovered: false });
  assert.equal(r.verdict, 'pending');
  assert.equal(r.diffRate, null);
  assert.equal(verdictLabel('pending'), '집계 중');
});

test('최종액이 아직 안 들어온 달도 집계 중이다', () => {
  const r = checkMonth({ ...base, coupangPaid: 1_600_000, cycleComplete: false, pendingLast: 671_850 });
  assert.equal(r.verdict, 'pending');
  // 차이 금액 자체는 보여준다 — 얼마가 남았는지는 알아야 한다
  assert.notEqual(r.diff, null);
  assert.equal(r.pendingLast, 671_850);
});

test('판매자가 정산서를 직접 적었으면 그 제한을 받지 않는다', () => {
  // 정산서에 적힌 금액은 그 자체로 완결이다
  const r = checkMonth({ ...base, actual: 1_598_906, salesCovered: false, cycleComplete: false });
  assert.equal(r.verdict, 'ok');
  assert.equal(r.referenceSource, 'actual');
});

test('둘 다 갖춰진 달만 실제로 판정한다', () => {
  const ok = checkMonth({ ...base, coupangPaid: 1_600_000, salesCovered: true, cycleComplete: true });
  assert.equal(ok.verdict, 'ok');
});
