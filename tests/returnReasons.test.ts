/**
 * 반품 사유 분류 테스트.
 *
 * 이 분류를 보고 상세페이지를 고친다. 잘못 묶인 숫자는 없느니만 못하므로,
 * 애매한 건 'other'로 두는 쪽이 맞다 — 여기서 그 선을 지킨다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyReturnReason,
  summarizeReturnReasons,
  RETURN_CATEGORIES,
} from '../src/lib/returnReasons.ts';

test('사이즈 관련 표현을 사이즈로 묶는다', () => {
  for (const s of ['사이즈가 작아요', '치수가 안 맞음', '너무 커요', '길이가 짧아서', '허리가 끼네요']) {
    assert.equal(classifyReturnReason(s), 'size', s);
  }
});

test('사진과 다른 경우를 따로 묶는다', () => {
  for (const s of ['색상이 사진과 달라요', '실물이 별로', '재질이 생각과 다름', '상세페이지와 다릅니다']) {
    assert.equal(classifyReturnReason(s), 'mismatch', s);
  }
});

test('불량과 파손을 묶는다', () => {
  for (const s of ['제품 불량', '박스가 파손되어 왔어요', '얼룩이 있음', '지퍼가 고장']) {
    assert.equal(classifyReturnReason(s), 'defect', s);
  }
});

// '다른 상품이 왔다'는 배송 사고다. '다르다'만 보고 사진 불일치로 보내면
// 판매자가 엉뚱하게 상세페이지 사진을 고치게 된다.
test('오배송은 사진 불일치가 아니라 배송으로 간다', () => {
  assert.equal(classifyReturnReason('다른 상품이 배송되었습니다'), 'delivery');
  assert.equal(classifyReturnReason('주문한 것과 다른 제품이 왔어요'), 'delivery');
  assert.equal(classifyReturnReason('배송이 너무 지연돼서'), 'delivery');
});

// '색상이 달라 반품합니다'에는 '반품'도 들어 있지만 답은 색상이다.
test('구체적인 원인이 뭉뚱그린 표현을 이긴다', () => {
  assert.equal(classifyReturnReason('색상이 달라서 반품합니다'), 'mismatch');
  assert.equal(classifyReturnReason('사이즈가 안 맞아 단순변심 처리해주세요'), 'size');
});

test('단순 변심을 잡는다', () => {
  for (const s of ['단순변심', '필요 없어졌어요', '마음에 안 들어요', '다른 곳에서 더 싸게 팔아서']) {
    assert.equal(classifyReturnReason(s), 'changed', s);
  }
});

test('영문 코드로 와도 알아본다', () => {
  assert.equal(classifyReturnReason('CHANGE_MIND'), 'changed');
  assert.equal(classifyReturnReason('WRONG_DELIVERY'), 'delivery');
  assert.equal(classifyReturnReason('PRODUCT_DEFECT'), 'defect');
  assert.equal(classifyReturnReason('SIZE_ISSUE'), 'size');
});

// 모르는 건 억지로 밀어 넣지 않는다. 잘못 분류된 수치가 더 해롭다.
test('알 수 없는 사유는 기타로 둔다', () => {
  assert.equal(classifyReturnReason(''), 'other');
  assert.equal(classifyReturnReason(null), 'other');
  assert.equal(classifyReturnReason(undefined), 'other');
  assert.equal(classifyReturnReason('ㅁㄴㅇㄹ'), 'other');
});

test('집계: 건수와 수량을 따로 센다', () => {
  const s = summarizeReturnReasons([
    { reason: '사이즈가 작아요', quantity: 1 },
    { reason: '사이즈가 커요', quantity: 3 },
    { reason: '단순변심', quantity: 1, fault: 'CUSTOMER' },
    { reason: '불량입니다', quantity: 1, fault: 'COMPANY' },
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.totalQuantity, 6);
  assert.equal(s.sellerFault, 1);

  const size = s.categories.find(c => c.category === 'size')!;
  assert.equal(size.count, 2);
  assert.equal(size.quantity, 4);   // 한 건에 3개를 반품한 것이 수량에 반영된다
  assert.equal(size.share, 0.5);
});

test('집계: 많은 유형이 먼저 나온다', () => {
  const s = summarizeReturnReasons([
    { reason: '단순변심' },
    { reason: '사이즈가 작아요' },
    { reason: '사이즈가 커요' },
    { reason: '치수 안 맞음' },
  ]);
  assert.equal(s.categories[0].category, 'size');
  assert.equal(s.categories[0].count, 3);
});

test('집계: 사유 원문 표본을 최대 3개까지, 중복 없이 남긴다', () => {
  const s = summarizeReturnReasons([
    { reason: '사이즈가 작아요' },
    { reason: '사이즈가 작아요' },
    { reason: '사이즈가 커요' },
    { reason: '치수 안 맞음' },
    { reason: '길이가 짧아요' },
  ]);
  const size = s.categories.find(c => c.category === 'size')!;
  assert.equal(size.samples.length, 3);
  assert.equal(new Set(size.samples).size, 3);
});

test('집계: 반품이 없으면 빈 결과다', () => {
  const s = summarizeReturnReasons([]);
  assert.equal(s.total, 0);
  assert.equal(s.categories.length, 0);
});

// 변심과 주문 실수는 판매자가 손댈 게 없다. 개선 대상과 섞이면
// "반품률을 낮추라"는 잘못된 결론이 나온다.
test('손댈 수 있는 유형과 아닌 유형이 구분돼 있다', () => {
  const byKey = Object.fromEntries(RETURN_CATEGORIES.map(c => [c.key, c]));
  assert.equal(byKey.size.actionable, true);
  assert.equal(byKey.defect.actionable, true);
  assert.equal(byKey.mismatch.actionable, true);
  assert.equal(byKey.changed.actionable, false);
  assert.equal(byKey.duplicate.actionable, false);
});
