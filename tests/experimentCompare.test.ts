/**
 * 변경 효과 판정 테스트.
 * 전후 기간 길이가 달라도 하루 평균으로 견주고, 며칠 안 된 결과는 단정하지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pctChange, verdict, type SideMetrics } from '../src/lib/experimentCompare.ts';

const side = (o: Partial<SideMetrics>): SideMetrics => ({ days: 7, quantity: 70, salesAmount: 700000, adCost: 70000, profit: 140000, ...o });

test('기간이 달라도 하루 평균으로 견준다', () => {
  const before = side({ days: 7, quantity: 70 });
  const after = side({ days: 3, quantity: 39 }); // 하루 13개 vs 10개 = +30%
  assert.equal(pctChange(before, after, 'quantity'), 30);
});

test('바꾼 지 3일이 안 되면 판정하지 않는다', () => {
  const v = verdict(side({}), side({ days: 2 }));
  assert.equal(v.tone, 'na');
});

test('판매가 늘어도 순이익이 줄면 나쁜 변경이다', () => {
  const before = side({ profit: 140000, quantity: 70 });
  const after = side({ profit: 100000, quantity: 90 });
  const v = verdict(before, after);
  assert.equal(v.tone, 'bad');
  assert.match(v.headline, /판매 \+29%/);
  assert.match(v.headline, /순이익 -29%/);
});

test('순이익이 5% 이상 늘면 좋은 변경이다', () => {
  const v = verdict(side({ profit: 100000 }), side({ profit: 120000 }));
  assert.equal(v.tone, 'good');
});

test('순이익 기준이 없으면(원가 미입력으로 0) 판매량으로 본다', () => {
  const v = verdict(side({ profit: 0, quantity: 50 }), side({ profit: 0, quantity: 60 }));
  assert.equal(v.tone, 'good');
});

test('순위가 오르면 머리글에 적힌다', () => {
  const v = verdict(side({}), side({}), [{ keyword: '니트티', before: 20, after: 12 }]);
  assert.match(v.headline, /순위 상승/);
});
