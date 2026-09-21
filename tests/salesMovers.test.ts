/**
 * 매출 급감·급증 판정 테스트.
 *
 * 너무 예민하면 매일 다른 목록이 떠서 안 읽히고, 너무 둔하면 진짜 빠진 걸
 * 놓친다. 표본 최소치와 비율 기준이 그 선이다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMovers, type MoverInput } from '../src/lib/salesMovers.ts';

const row = (o: Partial<MoverInput>): MoverInput => ({
  vendorItemId: '1', productName: '상품', optionName: '옵션', channel: 'growth',
  recentQty: 0, prevQty: 0, recentAmount: 0, prevAmount: 0, stock: null, ...o,
});

test('전주 10개 → 이번 주 5개는 급감(-50%)', () => {
  const { drops, rises } = pickMovers([row({ prevQty: 10, recentQty: 5, prevAmount: 100000, recentAmount: 50000 })]);
  assert.equal(drops.length, 1);
  assert.equal(drops[0].pct, -50);
  assert.equal(rises.length, 0);
});

test('전주 10개 → 8개는 흔들림으로 보고 넘긴다', () => {
  const { drops, rises } = pickMovers([row({ prevQty: 10, recentQty: 8 })]);
  assert.equal(drops.length + rises.length, 0);
});

test('표본이 작으면(합 6개 미만) 두 배가 돼도 뺀다', () => {
  const { rises } = pickMovers([row({ prevQty: 2, recentQty: 3 })]);
  assert.equal(rises.length, 0);
});

test('지난주 0개 → 이번 주 6개는 신규·재개 급증', () => {
  const { rises } = pickMovers([row({ prevQty: 0, recentQty: 6 })]);
  assert.equal(rises.length, 1);
  assert.equal(rises[0].pct, null);
  assert.ok(rises[0].hints.some(h => h.includes('신규')));
});

test('급감인데 재고가 0이면 재고를 원인 후보로 적는다', () => {
  const { drops } = pickMovers([row({ prevQty: 10, recentQty: 2, stock: 0 })]);
  assert.ok(drops[0].hints.some(h => h.includes('재고')));
});

test('급감인데 재고가 있으면 노출·가격을 보라고 한다', () => {
  const { drops } = pickMovers([row({ prevQty: 10, recentQty: 2, stock: 50 })]);
  assert.ok(drops[0].hints.some(h => h.includes('노출')));
});

test('금액이 큰 변화가 먼저 온다', () => {
  const { drops } = pickMovers([
    row({ vendorItemId: 'a', prevQty: 10, recentQty: 2, prevAmount: 50000, recentAmount: 10000 }),
    row({ vendorItemId: 'b', prevQty: 10, recentQty: 2, prevAmount: 500000, recentAmount: 100000 }),
  ]);
  assert.equal(drops[0].vendorItemId, 'b');
});
