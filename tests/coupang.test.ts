/**
 * 쿠팡 연동의 순수 계산 함수 테스트.
 * 실행: npm test
 *
 * 하한가 역산·상관·날짜 분할·시각 정규화는 돈과 직결되는데 눈으로 다시 확인하기
 * 어렵다. 회귀를 자동으로 잡기 위해 고정한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  authorization,
  dateChunks,
  floorPriceFor,
  isActiveReturn,
  lastWeekRange,
  median,
  pearson,
  signedDate,
  slope,
  toIso,
} from '../api/coupang';

test('signedDate: yyMMddTHHmmssZ 형식', () => {
  const s = signedDate();
  assert.match(s, /^\d{6}T\d{6}Z$/);
});

test('authorization: 헤더 형식과 hex 서명', () => {
  const h = authorization('GET', '/v2/x', 'a=1', 'AK', 'SK');
  assert.match(h, /^CEA algorithm=HmacSHA256, access-key=AK, signed-date=\d{6}T\d{6}Z, signature=[0-9a-f]{64}$/);
});

test('floorPriceFor: 목표 이익률을 실제로 만족한다', () => {
  const p = floorPriceFor(10_000, 10.8, 10)!;
  const margin = ((p - p * 0.108 - 10_000) / p) * 100;
  assert.ok(margin >= 10, `이익률 ${margin.toFixed(3)}%`);
  assert.equal(floorPriceFor(10_000, 60, 45), null, '수수료+목표가 100%를 넘으면 성립하지 않는다');
});

test('dateChunks: 빈틈·중복 없이 구간을 덮는다', () => {
  const c = dateChunks('2026-01-15', '2026-03-20', 30);
  assert.equal(c[0][0], '2026-01-15');
  assert.equal(c[c.length - 1][1], '2026-03-20');
  for (let i = 1; i < c.length; i++) assert.equal(addDays(c[i - 1][1], 1), c[i][0]);
  assert.deepEqual(dateChunks('2026-05-01', '2026-05-01', 30), [['2026-05-01', '2026-05-01']]);
});

test('toIso: 시간대 없는 값은 한국 시각으로 읽는다', () => {
  assert.equal(toIso('2026-09-05 14:00:00'), '2026-09-05T05:00:00.000Z');
  assert.equal(toIso('2026-09-05T14:00:00'), '2026-09-05T05:00:00.000Z');
  assert.equal(toIso('2026-09-05T14:00:00Z'), '2026-09-05T14:00:00.000Z');
  assert.equal(toIso('2026-09-05'), '2026-09-04T15:00:00.000Z');
  assert.equal(toIso(''), null);
  assert.equal(toIso('garbage'), null);
});

test('lastWeekRange: 월요일 아침 기준 지난주 월~일', () => {
  assert.deepEqual(lastWeekRange('2026-09-07'), { start: '2026-08-31', end: '2026-09-06' }); // 월
  assert.deepEqual(lastWeekRange('2026-09-09'), { start: '2026-08-31', end: '2026-09-06' }); // 수
});

test('pearson·slope: 순위가 낮을수록 많이 팔리면 음의 관계', () => {
  const ranks = [30, 25, 20, 15, 10, 5];
  const qty = [1, 2, 3, 4, 5, 6];
  const r = pearson(ranks, qty)!;
  assert.ok(r < -0.99);
  assert.ok(slope(ranks, qty)! < 0);
  assert.equal(pearson([5, 5, 5], [1, 2, 3]), null, '순위가 안 변하면 계산하지 않는다');
});

test('median: 짝수·홀수·빈 배열', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3);
  assert.equal(median([]), null);
  assert.equal(median([0, -1]), null, '0 이하는 가격이 아니다');
});

test('isActiveReturn: 취소·철회는 손실이 아니다', () => {
  assert.equal(isActiveReturn('RETURNS_COMPLETED'), true);
  assert.equal(isActiveReturn('CANCEL'), false);
  assert.equal(isActiveReturn('반품 철회'), false);
  assert.equal(isActiveReturn(null), true);
});
