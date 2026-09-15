import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMonth, isReserveSettlement, verdictLabel, type MonthFigures } from '../src/lib/settlementCheck.ts';

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
  recognitionComplete: true,
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

// ── 쿠팡 지급내역에는 윙만 들어온다 ──
// 실제 계정에서 확인한 것이다. 2026년 8월 그로스 매출 4,777,988원, 윙
// 973,912원인데 지급내역의 정산대상액은 993,446원이었다. 그로스는 한 건도
// 없다. 이걸 모른 채 윙+그로스를 견주다가 매달 몇 배씩 어긋나 보였다.

test('자동 기준(쿠팡 지급내역)은 윙끼리만 견준다', () => {
  const r = checkMonth({
    ...base,
    marketSettlement: 973_912,
    growthSettlement: 4_777_988,   // 지급내역에 없는 돈
    growthNet: 5_328_895,
    coupangPaid: 993_446,
  });
  assert.equal(r.scope, 'market');
  assert.equal(r.ours, 973_912);            // 그로스를 더하지 않는다
  assert.equal(r.diff, 19_534);
  assert.equal(r.verdict, 'watch');         // 2% — 수집이 며칠 빈 정도
  // 기준에 그로스가 없으므로 그로스 수수료율을 역산해서는 안 된다
  assert.equal(r.impliedGrowthFeeRate, null);
});

test('윙+그로스를 합쳐 견주면 어긋난 것처럼 보인다 — 그래서 합치지 않는다', () => {
  const r = checkMonth({
    ...base,
    marketSettlement: 973_912,
    growthSettlement: 4_777_988,
    growthNet: 5_328_895,
    coupangPaid: 993_446,
  });
  // 합쳤다면 5,751,900 대 993,446으로 83% 어긋난 것으로 나왔을 것이다
  assert.notEqual(r.ours, 973_912 + 4_777_988);
  assert.notEqual(r.verdict, 'off');
});

test('정산서 금액을 적어 넣으면 그때는 전체로 견준다', () => {
  const r = checkMonth({
    ...base,
    marketSettlement: 973_912,
    growthSettlement: 4_777_988,
    growthNet: 5_328_895,
    coupangPaid: 993_446,
    actual: 5_751_900,
  });
  assert.equal(r.scope, 'all');
  assert.equal(r.ours, 5_751_900);
  assert.equal(r.verdict, 'ok');
});

// ── 그로스 수수료율 역산 ──
// 그로스가 대조에 들어간 달, 즉 판매자가 정산서 금액을 적어 넣은 달에만
// 뜻이 있다. 윙만 견준 달에 역산하면 있지도 않은 수수료 문제를 지어낸다.

test('그로스 수수료율을 역산한다 — 쿠폰을 빼지 않던 시절을 잡아낸다', () => {
  // 그로스 실결제액 1,000,000원. 우리는 11.88%로 계산했는데 실제로는 13%가
  // 빠져 870,000원만 들어왔다면, 역산 요율은 13%가 나와야 한다.
  const r = checkMonth({
    ...base,
    marketSettlement: 0,
    growthSettlement: 881_200,
    growthNet: 1_000_000,
    actual: 870_000,
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
    actual: 1_370_000,   // 윙 500,000 + 그로스 870,000
  });
  assert.equal(r.impliedGrowthFeeRate, 13);
});

test('수수료로 설명되지 않는 차이는 역산하지 않는다', () => {
  // 반품 차감이 크게 섞이면 요율이 40%를 넘어간다. 그 숫자를 요율이라고
  // 보여 주면 판매자가 엉뚱한 데를 고치게 된다.
  const big = checkMonth({ ...base, marketSettlement: 0, growthSettlement: 881_200, growthNet: 1_000_000, actual: 300_000 });
  assert.equal(big.impliedGrowthFeeRate, null);
  // 지급이 실결제액보다 많으면 요율이 음수가 된다 — 이것도 요율이 아니다
  const neg = checkMonth({ ...base, marketSettlement: 0, growthSettlement: 881_200, growthNet: 1_000_000, actual: 1_100_000 });
  assert.equal(neg.impliedGrowthFeeRate, null);
});

test('그로스가 없으면 역산할 것도 없다', () => {
  const r = checkMonth({ ...base, actual: 1_400_000 });
  assert.equal(r.growthNet, 0);
  assert.equal(r.impliedGrowthFeeRate, null);
});

test('판정 이름은 한 곳에서만 만든다', () => {
  assert.equal(verdictLabel('ok'), '맞습니다');
  assert.equal(verdictLabel('off'), '어긋났습니다');
  assert.equal(verdictLabel('unknown'), '기준 없음');
});

// ── RESERVE 행 판정 ──
// RESERVE는 그 달 WEEKLY를 통째로 다시 적은 요약 행이다. 정산대상액을 셀 때
// 함께 더하면 딱 두 배가 된다. 판정이 갈리면 대조와 캘린더 중 한쪽만 고쳐진다.

test('RESERVE 행을 알아본다', () => {
  assert.equal(isReserveSettlement('RESERVE'), true);
  assert.equal(isReserveSettlement('reserve'), true);
  assert.equal(isReserveSettlement('WEEKLY'), false);
  assert.equal(isReserveSettlement('MONTHLY'), false);
  // 유형이 비어 오는 행도 있다 — 그건 요약 행이 아니다
  assert.equal(isReserveSettlement(null), false);
  assert.equal(isReserveSettlement(undefined), false);
  assert.equal(isReserveSettlement(''), false);
});

// ── 견줄 수 없는 달은 판정하지 않는다 ──
// 쿠팡이 그 달 인식을 안 끝냈거나 매출 수집이 늦게 시작된 달이 있다.
// 그런 달에 '어긋났습니다'를 띄우면 진짜 어긋난 달이 그 속에 묻힌다.

test('매출 자료가 모자란 달은 집계 중으로 둔다', () => {
  const r = checkMonth({ ...base, coupangPaid: 3_218_552, salesCovered: false });
  assert.equal(r.verdict, 'pending');
  assert.equal(r.diffRate, null);
  assert.equal(verdictLabel('pending'), '집계 중');
});

test('쿠팡이 그 달 인식을 안 끝냈으면 집계 중이다', () => {
  const r = checkMonth({ ...base, coupangPaid: 1_600_000, recognitionComplete: false, pendingLast: 298_033 });
  assert.equal(r.verdict, 'pending');
  // 차이 금액 자체는 보여준다 — 얼마가 남았는지는 알아야 한다
  assert.notEqual(r.diff, null);
  assert.equal(r.pendingLast, 298_033);
});

test('판매자가 정산서를 직접 적었으면 그 제한을 받지 않는다', () => {
  // 정산서에 적힌 금액은 그 자체로 완결이다
  const r = checkMonth({ ...base, actual: 1_598_906, salesCovered: false, recognitionComplete: false });
  assert.equal(r.verdict, 'ok');
  assert.equal(r.referenceSource, 'actual');
});

test('둘 다 갖춰진 달만 실제로 판정한다', () => {
  const ok = checkMonth({ ...base, coupangPaid: 1_600_000, salesCovered: true, recognitionComplete: true });
  assert.equal(ok.verdict, 'ok');
});
