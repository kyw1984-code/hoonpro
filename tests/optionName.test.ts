import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillOptionNames } from '../src/lib/optionName.ts';

test('옵션명이 멀쩡하면 그대로 둔다', () => {
  const out = fillOptionNames([{ productName: '롱원피스 3종세트', optionName: '아이보리, 77' }]);
  assert.deepEqual(out, ['아이보리, 77']);
});

test('쿠팡 표준 표기는 첫 ", " 뒤를 옵션으로 읽는다', () => {
  const out = fillOptionNames([
    { productName: '민채앤코 트레이닝 자켓 2종 세트, 그레이+블랙(2종세트), Size 1 (55-66)', optionName: '' },
  ]);
  assert.deepEqual(out, ['그레이+블랙(2종세트), Size 1 (55-66)']);
});

test('쉼표 없이 이어 붙은 것은 같은 상품의 짧은 줄을 기준으로 뗀다', () => {
  const out = fillOptionNames([
    { productName: '민채앤코 롱원피스 3종세트', optionName: '아이보리, 블랙, 올리브 3종세트 66' },
    { productName: '민채앤코 롱원피스 3종세트 아이보리, 블랙, 올리브 3종세트 77', optionName: '72800678' },
  ]);
  // 첫 쉼표로 잘랐다면 "블랙, 올리브…"가 되어 아이보리가 떨어져 나간다
  assert.equal(out[1], '아이보리, 블랙, 올리브 3종세트 77');
});

test('숫자만 든 옵션명은 이름으로 치지 않는다', () => {
  const out = fillOptionNames([{ productName: '반팔티, 화이트 100', optionName: '74518563' }]);
  assert.deepEqual(out, ['화이트 100']);
});

test('옵션명에 상품명이 통째로 붙어 오면 앞부분을 뗀다', () => {
  const out = fillOptionNames([
    { productName: '나시티 4종세트', optionName: '나시티 4종세트, 블랙+화이트, 100' },
  ]);
  assert.deepEqual(out, ['블랙+화이트, 100']);
});

test('단어 한가운데서는 뗴지 않는다', () => {
  const out = fillOptionNames([
    { productName: '민채앤코 니트', optionName: '' },
    { productName: '민채앤코 니트티 화이트', optionName: '' },
  ]);
  // "민채앤코 니트" 뒤가 "티"라 단어 경계가 아니다 — 잘못 떼면 "티 화이트"가 된다
  assert.equal(out[1], '');
});

test('알아낼 수 없으면 빈 문자열', () => {
  assert.deepEqual(fillOptionNames([{ productName: '단품 상품', optionName: '' }]), ['']);
  assert.deepEqual(fillOptionNames([{ productName: '', optionName: '' }]), ['']);
});
