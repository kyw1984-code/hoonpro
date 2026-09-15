import test from 'node:test';
import assert from 'node:assert/strict';
import { diffSourcing, rankMoveLabel } from '../src/lib/sourcingDiff.ts';

const saved = [
  { productId: 'A', productName: '가 상품', rank: 1, productPrice: 12900, reviewCount: 1200 },
  { productId: 'B', productName: '나 상품', rank: 2, productPrice: 15000, reviewCount: 300 },
  { productId: 'C', productName: '다 상품', rank: 3, productPrice: 9900, reviewCount: 50 },
  { productId: 'D', productName: '라 상품', rank: 4, productPrice: 20000, reviewCount: 10 },
];

test('순위는 숫자가 작을수록 좋다 — 상승·하락을 뒤집어 읽지 않는다', () => {
  const { rows } = diffSourcing(saved, [
    { productId: 'A', rank: 3, reviewCount: 1250, price: 12900 },   // 1위 → 3위
    { productId: 'B', rank: 1, reviewCount: 800, price: 14000 },    // 2위 → 1위
  ]);
  const a = rows.find(r => r.productId === 'A')!;
  const b = rows.find(r => r.productId === 'B')!;
  assert.equal(a.status, 'down');
  assert.equal(a.rankDelta, -2);
  assert.equal(rankMoveLabel(a), '2계단 하락');
  assert.equal(b.status, 'up');
  assert.equal(b.rankDelta, 1);
  assert.equal(rankMoveLabel(b), '1계단 상승');
});

test('1페이지 밖으로 밀린 것과 관측이 없는 것은 다른 이야기다', () => {
  const { rows, summary } = diffSourcing(saved, [
    { productId: 'A', rank: 1, reviewCount: 1200 },
    { productId: 'C', rank: null, reviewCount: 60 },   // 관측은 됐는데 순위 밖
    // D는 아예 관측에 없다
  ]);
  assert.equal(rows.find(r => r.productId === 'C')!.status, 'gone');
  assert.equal(rows.find(r => r.productId === 'D')!.status, 'unknown');
  assert.equal(summary.gone, 1);
  // 모르는 것은 견준 축에 끼지 않는다. 관측에 든 것은 A와 C 둘뿐이다.
  assert.equal(summary.compared, 2);
});

test('리뷰 증가가 그 기간 팔린 양의 대리 지표다', () => {
  const { rows, summary } = diffSourcing(saved, [
    { productId: 'A', rank: 1, reviewCount: 1500 },   // +300
    { productId: 'B', rank: 2, reviewCount: 320 },    // +20
    { productId: 'C', rank: 3, reviewCount: 50 },     // 그대로
  ]);
  assert.equal(rows.find(r => r.productId === 'A')!.reviewDelta, 300);
  assert.equal(summary.totalReviewGain, 320);
  assert.equal(summary.topMover?.productId, 'A');
});

test('리뷰가 줄면 관측이 어긋난 것이다 — 마이너스 판매량을 보여 주지 않는다', () => {
  const { rows } = diffSourcing(saved, [{ productId: 'A', rank: 1, reviewCount: 900 }]);
  assert.equal(rows.find(r => r.productId === 'A')!.reviewDelta, null);
});

test('가격 변화는 방향을 그대로 쓴다 — 음수면 내린 것이다', () => {
  const { rows } = diffSourcing(saved, [{ productId: 'A', rank: 1, price: 11900 }]);
  assert.equal(rows.find(r => r.productId === 'A')!.priceDelta, -1000);
});

test('견줄 관측이 하나도 없으면 전부 모름이고 요약은 0이다', () => {
  const { rows, summary } = diffSourcing(saved, []);
  assert.ok(rows.every(r => r.status === 'unknown'));
  assert.equal(summary.compared, 0);
  assert.equal(summary.up, 0);
  assert.equal(summary.topMover, null);
  assert.equal(summary.totalReviewGain, 0);
});

test('저장본에 순위가 없으면 목록 차례를 순위로 본다', () => {
  const noRank = [{ productId: 'X', productName: 'x' }, { productId: 'Y', productName: 'y' }];
  const { rows } = diffSourcing(noRank, [{ productId: 'Y', rank: 1 }]);
  const y = rows.find(r => r.productId === 'Y')!;
  assert.equal(y.savedRank, 2);
  assert.equal(y.status, 'up');
});

test('리뷰가 안 늘어난 상품은 topMover가 되지 않는다', () => {
  const { summary } = diffSourcing(saved, [
    { productId: 'A', rank: 1, reviewCount: 1200 },
    { productId: 'B', rank: 2, reviewCount: 300 },
  ]);
  assert.equal(summary.topMover, null);
});
