/**
 * 다른 상품군 가려내기 테스트.
 *
 * 실제로 "검정치마"를 분석했더니 밴드 검정치마의 3집 CD가 점수를 받고
 * 순위 추적까지 들어갔다. 이런 상품은 리뷰가 많아 수요 점수가 높고 로켓이
 * 아니라 진입 점수도 높다 — 점수가 잘못된 방향으로 후해진다.
 *
 * 다만 과하게 거르면 멀쩡한 상품이 사라진다. 그 선을 여기서 지킨다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectOffCategory, scoreReasons } from '../src/lib/productRelevance.ts';

test('음반을 가려낸다', () => {
  const hit = detectOffCategory('(CD) 검정치마 (The Black Skirts) - 3집 Team Baby Part.1 (재발매), 단품', '검정치마');
  assert.equal(hit?.category, 'media');
  assert.equal(hit?.label, '음반·영상');
});

test('여러 형태의 음반 표현을 잡는다', () => {
  for (const n of ['아이유 정규 5집 앨범', '영화 OST 블루레이', '한정판 LP 바이닐', '미니앨범 2집']) {
    assert.ok(detectOffCategory(n, '원피스'), n);
  }
});

test('도서·티켓·서비스를 가려낸다', () => {
  assert.equal(detectOffCategory('개정판 수학의 정석 상.하', '정석')?.category, 'book');
  // 키워드에 '이용권'을 넣으면 가드가 걸러내지 않는 게 맞다. 여기선 그게 아니라
  // 엉뚱하게 섞여 든 경우를 본다.
  assert.equal(detectOffCategory('에버랜드 자유이용권 2매', '에버랜드')?.category, 'ticket');
  assert.equal(detectOffCategory('에어컨 출장 설치 시공비', '에어컨')?.category, 'service');
});

// 진짜 옷은 그대로 남아야 한다. 과하게 거르면 결과가 통째로 빈다.
test('멀쩡한 의류는 건드리지 않는다', () => {
  for (const n of [
    '민채앤코 여성 간절기 루즈핏 세미크롭 집업 가을 오버핏 자켓 2종 세트',
    '아크기어 남자 여름 나시티 4종세트 메쉬 냉감',
    '여성 플리츠 검정 치마 롱스커트',
    '남성 헨리넥 긴팔 티셔츠 3종',
  ]) {
    assert.equal(detectOffCategory(n, '검정치마'), null, n);
  }
});

// "CD 케이스"를 찾는 사람에게 CD를 걸러 주면 결과가 통째로 빈다
test('찾는 키워드가 그 상품군이면 거르지 않는다', () => {
  assert.equal(detectOffCategory('아이유 3집 앨범 CD', 'CD 앨범'), null);
  assert.equal(detectOffCategory('공연 입장권', '입장권'), null);
});

test('빈 이름은 판단하지 않는다', () => {
  assert.equal(detectOffCategory('', '치마'), null);
  assert.equal(detectOffCategory(null, '치마'), null);
  assert.equal(detectOffCategory(undefined, '치마'), null);
});

test('무엇을 보고 판단했는지 남긴다', () => {
  const hit = detectOffCategory('(CD) 검정치마 3집', '검정치마');
  assert.ok(hit?.matched && hit.matched.length > 0);
});

// ── 점수 근거 ────────────────────────────────────────────────

const base = { reviewCount: 340, deliveryType: 'general' as const, productPrice: 29900, demandScore: 63, entryEase: 80, priceFit: 100 };

test('점수 근거는 세 축을 한 줄씩 말한다', () => {
  const r = scoreReasons(base);
  assert.equal(r.length, 3);
  assert.ok(r[0].includes('340개'));
  assert.ok(r[1].includes('로켓 아님'));
  assert.ok(r[2].includes('29,900원'));
});

test('리뷰가 너무 많으면 기회가 아니라 포화라고 말한다', () => {
  const r = scoreReasons({ ...base, reviewCount: 5200 });
  assert.ok(r[0].includes('자리 잡음'));
});

test('리뷰가 없으면 수요가 확인 안 됐다고 말한다', () => {
  assert.ok(scoreReasons({ ...base, reviewCount: 0 })[0].includes('알 수 없음'));
  assert.ok(scoreReasons({ ...base, reviewCount: 5 })[0].includes('확인 안 됨'));
});

test('로켓이면 직접 경쟁이라고 말한다', () => {
  assert.ok(scoreReasons({ ...base, deliveryType: 'rocket' })[1].includes('직접 경쟁'));
  assert.ok(scoreReasons({ ...base, deliveryType: 'jet' })[1].includes('그로스'));
});

test('가격이 낮으면 마진을 못 남긴다고 말한다', () => {
  const r = scoreReasons({ ...base, productPrice: 9900, priceFit: 55 });
  assert.ok(r[2].includes('마진 남기기 어려움'));
});

test('가격이 높으면 회전이 느리다고 말한다', () => {
  const r = scoreReasons({ ...base, productPrice: 180000, priceFit: 50 });
  assert.ok(r[2].includes('회전이 느릴'));
});
