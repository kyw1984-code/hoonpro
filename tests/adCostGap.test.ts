/**
 * 광고비 공백 판단 테스트.
 *
 * 이 판단이 너무 예민하면 매일 잔소리가 되어 브리핑 전체가 안 읽히고,
 * 너무 둔하면 부풀려진 순이익을 그대로 믿게 된다. 그 선을 여기서 지킨다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adCostGap } from '../src/lib/adCostGap.ts';

const days = (...d: string[]) => d;

test('빈 날이 며칠인지 센다', () => {
  const g = adCostGap({
    lastAdDate: '2026-09-07',
    through: '2026-09-10',
    salesDatesInGap: days('2026-09-08', '2026-09-09', '2026-09-10'),
    dailyAverage: 64662,
  });
  assert.equal(g.missingDays, 3);
  assert.equal(g.missingWithSales, 3);
  assert.equal(g.shouldWarn, true);
});

// 어제 아침에 눌렀으면 그제까지만 들어와 있다. 그걸 매일 잡으면
// 제대로 쓰는 사람에게 매일 잔소리하는 꼴이 된다.
test('어제 하루 비는 건 정상이라 알리지 않는다', () => {
  const g = adCostGap({
    lastAdDate: '2026-09-09',
    through: '2026-09-10',
    salesDatesInGap: days('2026-09-10'),
    dailyAverage: 64662,
  });
  assert.equal(g.missingWithSales, 1);
  assert.equal(g.shouldWarn, false);
});

test('빈 날이 없으면 조용하다', () => {
  const g = adCostGap({
    lastAdDate: '2026-09-10', through: '2026-09-10', salesDatesInGap: [], dailyAverage: 64662,
  });
  assert.equal(g.missingDays, 0);
  assert.equal(g.shouldWarn, false);
});

// 광고를 안 돌린 날이 아니라 아예 판 게 없는 날이다. 쉬는 날까지 세면
// 연휴 뒤에 늘 경고가 뜬다.
test('매출이 없던 날은 빈 것으로 치지 않는다', () => {
  const g = adCostGap({
    lastAdDate: '2026-09-04',
    through: '2026-09-10',
    salesDatesInGap: days('2026-09-10'),   // 엿새 중 하루만 팔렸다
    dailyAverage: 64662,
  });
  assert.equal(g.missingDays, 6);
  assert.equal(g.missingWithSales, 1);
  assert.equal(g.shouldWarn, false);
});

test('부풀려진 금액은 매출 있던 날 수로만 센다', () => {
  const g = adCostGap({
    lastAdDate: '2026-09-07',
    through: '2026-09-10',
    salesDatesInGap: days('2026-09-08', '2026-09-10'),   // 9/9은 판 게 없다
    dailyAverage: 60000,
  });
  assert.equal(g.missingWithSales, 2);
  assert.equal(g.overstatedBy, 120000);
});

test('같은 날짜가 여러 번 와도 한 번만 센다', () => {
  const g = adCostGap({
    lastAdDate: '2026-09-07',
    through: '2026-09-10',
    salesDatesInGap: days('2026-09-08', '2026-09-08', '2026-09-09'),
    dailyAverage: 1000,
  });
  assert.equal(g.missingWithSales, 2);
});

// 호출부가 넓게 긁어 와도 빈 구간 밖의 날짜는 세면 안 된다
test('빈 구간 밖의 날짜는 무시한다', () => {
  const g = adCostGap({
    lastAdDate: '2026-09-07',
    through: '2026-09-10',
    salesDatesInGap: days('2026-08-01', '2026-09-07', '2026-09-09', '2026-09-30'),
    dailyAverage: 1000,
  });
  assert.equal(g.missingWithSales, 1);   // 9/9 하나만
});

test('한 번도 안 가져왔으면 금액을 지어내지 않는다', () => {
  const g = adCostGap({
    lastAdDate: null,
    through: '2026-09-10',
    salesDatesInGap: days('2026-09-08', '2026-09-09', '2026-09-10'),
    dailyAverage: 0,
  });
  assert.equal(g.never, true);
  assert.equal(g.missingWithSales, 3);
  assert.equal(g.overstatedBy, 0);
  assert.equal(g.shouldWarn, true);
});

test('평균이 없거나 이상하면 금액은 0으로 둔다', () => {
  for (const avg of [0, -100, NaN]) {
    const g = adCostGap({
      lastAdDate: '2026-09-07', through: '2026-09-10',
      salesDatesInGap: days('2026-09-08', '2026-09-09'), dailyAverage: avg,
    });
    assert.equal(g.overstatedBy, 0);
    assert.equal(g.shouldWarn, true);   // 금액을 몰라도 비었다는 사실은 알린다
  }
});

// 수집이 앞서 있는 경우(미래 날짜가 들어온 경우) 음수로 새지 않는다
test('광고비가 어제보다 앞서 있어도 음수가 되지 않는다', () => {
  const g = adCostGap({
    lastAdDate: '2026-09-12', through: '2026-09-10', salesDatesInGap: [], dailyAverage: 1000,
  });
  assert.equal(g.missingDays, 0);
  assert.equal(g.shouldWarn, false);
});
