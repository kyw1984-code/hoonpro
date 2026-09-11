/**
 * 세트 환산 테스트.
 *
 * 2종 세트 41,200원과 단품 20,000원은 낱개로 보면 거의 같은 값이다. 이 보정이
 * 없으면 세트 시장의 평균가·가격 적합도·내 가게 기준 점수가 통째로 어긋난다.
 *
 * 다만 잘못 나눈 가격은 안 나눈 가격보다 나쁘다 — 틀렸다는 걸 알아챌 방법이
 * 없기 때문이다. 확신이 서는 표현만 잡는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSet, medianUnitPrice } from '../src/lib/setProduct.ts';

test('N종 세트를 낱개로 나눈다', () => {
  const r = parseSet('민채앤코 여성 간절기 루즈핏 세미크롭 집업 2종 세트', 41200);
  assert.equal(r.count, 2);
  assert.equal(r.unitPrice, 20600);
  assert.equal(r.matched, '2종 세트');
});

test('띄어쓰기와 표기가 달라도 잡는다', () => {
  assert.equal(parseSet('아크기어 나시티 4종세트', 40000).count, 4);
  assert.equal(parseSet('여성 티셔츠 3종 SET', 30000).count, 3);
  assert.equal(parseSet('반팔 2개 세트', 20000).count, 2);
  assert.equal(parseSet('수건 5매 세트', 25000).count, 5);
});

test('1+1은 2개, 2+1은 3개', () => {
  assert.equal(parseSet('긴팔 티셔츠 1+1', 30000).count, 2);
  assert.equal(parseSet('양말 2+1 특가', 30000).count, 3);
});

test('단품은 그대로 둔다', () => {
  const r = parseSet('민채앤코 여성 오버핏 순면 반팔 티셔츠', 19900);
  assert.equal(r.count, 1);
  assert.equal(r.unitPrice, 19900);
  assert.equal(r.matched, null);
});

// 1종은 세트가 아니고, 큰 수는 사이즈나 모델명일 가능성이 높다.
// 잘못 나누면 낱개 가격이 터무니없이 낮아져 "싸고 좋은 시장"으로 읽힌다.
test('믿을 수 없는 수는 나누지 않는다', () => {
  assert.equal(parseSet('1종 세트', 20000).count, 1);
  assert.equal(parseSet('부품 50종 세트', 20000).count, 1);
  assert.equal(parseSet('모델 2024 티셔츠', 20000).count, 1);
  assert.equal(parseSet('사이즈 100 반팔', 20000).count, 1);
});

test('빈 이름이나 0원에도 무너지지 않는다', () => {
  assert.equal(parseSet('', 20000).count, 1);
  assert.equal(parseSet(null, 20000).count, 1);
  assert.equal(parseSet('2종 세트', 0).unitPrice, 0);
});

// 세트를 감안하면 "비싼 것과 싼 것"이 아니라 거의 같은 값이다
test('세트와 단품을 낱개로 견주면 가까워진다', () => {
  const set = parseSet('여성 니트 2종 세트', 41200).unitPrice;
  const single = parseSet('여성 니트 단품', 20000).unitPrice;
  assert.ok(Math.abs(set - single) < 1000, `${set} vs ${single}`);
});

test('중앙값: 낱개 기준으로 낸다', () => {
  const items = [
    { productName: '니트 2종 세트', productPrice: 40000 },   // 20,000
    { productName: '니트 단품', productPrice: 22000 },       // 22,000
    { productName: '니트 4종세트', productPrice: 72000 },    // 18,000
  ];
  assert.equal(medianUnitPrice(items), 20000);
});

// 평균이면 잘못 읽은 한 개에 끌려간다. 중앙값은 버틴다.
test('중앙값: 하나를 잘못 읽어도 흔들리지 않는다', () => {
  const items = [
    { productName: '니트 단품', productPrice: 20000 },
    { productName: '니트 단품', productPrice: 21000 },
    { productName: '니트 단품', productPrice: 22000 },
    { productName: '부속 12종 세트', productPrice: 12000 },  // 1,000으로 읽힘
  ];
  const m = medianUnitPrice(items);
  assert.ok(m >= 20000 && m <= 21500, String(m));
});

test('중앙값: 빈 목록은 0', () => {
  assert.equal(medianUnitPrice([]), 0);
});

// '1.5 + 1.5kg'의 가운데에서 '5 + 1'이 걸려 6개들이로 읽혔다. 45,000원짜리가
// 낱개 7,500원이 되고, 그 값이 가격 적합도·시장 평균가·내 가게 기준 점수로
// 그대로 흘러간다. 틀렸다는 걸 알아챌 방법이 없다.
test('소수점이 낀 무게 표기를 세트로 읽지 않는다', () => {
  assert.equal(parseSet('제주 흑돼지 오겹살 1.5 + 1.5kg', 45000).count, 1);
  assert.equal(parseSet('제주 흑돼지 오겹살 1.5 + 1.5kg', 45000).unitPrice, 45000);
  assert.equal(parseSet('냉동 삼겹살 2.5 + 2.5 kg', 45000).count, 1);
  assert.equal(parseSet('USB 허브 3.0 + 2.0 멀티', 45000).count, 1);
});

// 진짜 덤 표기는 계속 잡아야 한다
test('덤 표기는 그대로 잡는다', () => {
  assert.equal(parseSet('긴팔 티셔츠 1+1', 30000).count, 2);
  assert.equal(parseSet('양말 2+1 특가', 30000).count, 3);
  assert.equal(parseSet('마스크 1 + 1 행사', 30000).count, 2);
});
