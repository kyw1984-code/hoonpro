/**
 * 옵션 → 상품 묶기 테스트. 등록상품ID로 묶고, ID 없는 재판매 줄은 이름 접두어로 붙인다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupProducts } from '../src/lib/productGroup.ts';

test('등록상품ID가 같으면 한 상품', () => {
  const g = groupProducts([
    { vendorItemId: '1', productName: '롱원피스 3종세트', sellerProductId: 'A' },
    { vendorItemId: '2', productName: '롱원피스 3종세트', sellerProductId: 'A' },
    { vendorItemId: '3', productName: '맨투맨', sellerProductId: 'B' },
  ]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].rows.map(r => r.vendorItemId), ['1', '2']);
});

test('ID 없는 재판매 줄은 상품명이 접두어인 상품에 붙는다', () => {
  const g = groupProducts([
    { vendorItemId: '1', productName: '롱원피스 3종세트', sellerProductId: 'A' },
    { vendorItemId: '9', productName: '롱원피스 3종세트 아이보리, 블랙 55', sellerProductId: null },
    { vendorItemId: '8', productName: '전혀 다른 상품', sellerProductId: null },
  ]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].rows.map(r => r.vendorItemId), ['1', '9']);
  assert.equal(g[1].name, '전혀 다른 상품');
});

test('접두어가 여럿 맞으면 가장 긴 상품명에 붙는다', () => {
  const g = groupProducts([
    { vendorItemId: '1', productName: '나시티', sellerProductId: 'A' },
    { vendorItemId: '2', productName: '나시티 4종세트', sellerProductId: 'B' },
    { vendorItemId: '9', productName: '나시티 4종세트 블랙 105', sellerProductId: null },
  ]);
  assert.equal(g.find(x => x.key === 'sp:B')!.rows.length, 2);
});

test('같은 상품의 이름이 여럿이면 짧은 이름을 쓴다', () => {
  const g = groupProducts([
    { vendorItemId: '1', productName: '롱원피스 3종세트 55', sellerProductId: 'A' },
    { vendorItemId: '2', productName: '롱원피스 3종세트', sellerProductId: 'A' },
  ]);
  assert.equal(g[0].name, '롱원피스 3종세트');
});
