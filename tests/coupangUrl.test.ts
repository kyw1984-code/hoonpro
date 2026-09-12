import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProductRef, productPageUrl, reviewFragmentUrl } from '../src/lib/coupangUrl.ts';

test('상품번호만 넣어도 받는다', () => {
  assert.deepEqual(parseProductRef('9174862914'), { productId: '9174862914', itemId: '', vendorItemId: '' });
});

test('짧은 주소에서 상품번호를 뽑는다', () => {
  const r = parseProductRef('https://www.coupang.com/vp/products/9174862914');
  assert.equal(r.productId, '9174862914');
  assert.equal(r.itemId, '');
});

test('검색에서 복사한 긴 주소는 옵션 번호까지 살린다', () => {
  const r = parseProductRef(
    'https://www.coupang.com/vp/products/9174862914?itemId=27046349622&vendorItemId=94014776046' +
    '&q=%EC%97%AC%EC%84%B1+%EB%8B%88%ED%8A%B8%ED%8B%B0&searchId=d3caafd04547444&sourceType=search' +
    '&itemsCount=60&searchRank=10&rank=10&traceId=mtxnvhd0',
  );
  assert.deepEqual(r, { productId: '9174862914', itemId: '27046349622', vendorItemId: '94014776046' });
});

test('모바일 주소도 같은 경로를 쓴다', () => {
  assert.equal(parseProductRef('https://m.coupang.com/vp/products/123?itemId=9').productId, '123');
});

test('상품번호가 없으면 빈 값을 준다', () => {
  assert.equal(parseProductRef('https://www.coupang.com/np/search?q=니트').productId, '');
  assert.equal(parseProductRef('').productId, '');
  assert.equal(parseProductRef(undefined).productId, '');
  assert.equal(parseProductRef(12345 as unknown as string).productId, '');
});

test('숫자가 아닌 옵션 번호는 무시한다', () => {
  const r = parseProductRef('https://www.coupang.com/vp/products/123?itemId=abc&vendorItemId=456');
  assert.equal(r.itemId, '');
  assert.equal(r.vendorItemId, '456');
});

test('상품 페이지 주소에 옵션 번호를 붙인다', () => {
  const ref = { productId: '1', itemId: '2', vendorItemId: '3' };
  assert.equal(productPageUrl(ref), 'https://www.coupang.com/vp/products/1?itemId=2&vendorItemId=3');
  assert.equal(productPageUrl({ productId: '1', itemId: '', vendorItemId: '' }), 'https://www.coupang.com/vp/products/1');
});

test('리뷰 조각 주소는 옵션을 넣고 뺄 수 있다', () => {
  const ref = { productId: '1', itemId: '2', vendorItemId: '3' };
  const withItem = reviewFragmentUrl(ref, 30, true);
  assert.ok(withItem.includes('itemId=2') && withItem.includes('vendorItemId=3'));
  const without = reviewFragmentUrl(ref, 30, false);
  assert.ok(!without.includes('itemId='));
  assert.ok(without.includes('productId=1') && without.includes('size=30'));
});
