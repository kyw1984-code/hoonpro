/**
 * 내 가게 기준 점수 테스트.
 *
 * 이 점수가 본래 기회점수를 덮으면 "늘 팔던 것과 닮았으면 무조건 좋다"가 되어
 * 이미 하는 것만 계속하게 된다. 반대로 너무 약하면 있으나 마나다. 그 선을 지킨다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSellerProfile, sellerFit, blendScore, looksLikeSet, FIT_MIN_OPTIONS,
  type SellerProfile,
} from '../src/lib/sellerFit.ts';
import { parseSet } from '../src/lib/setProduct.ts';

// 대표님 실제 값에 가깝게: 객단가 19,678~36,400, 그로스 22 / 윙 12, 세트 78%
const sold = [
  ...Array.from({ length: 22 }, (_, i) => ({ unitPrice: 18000 + i * 1000, channel: 'growth' })),
  ...Array.from({ length: 12 }, (_, i) => ({ unitPrice: 12000 + i * 2000, channel: 'marketplace' })),
];
const names = [
  ...Array.from({ length: 29 }, (_, i) => `민채앤코 상품${i} 2종 세트`),
  ...Array.from({ length: 8 }, (_, i) => `민채앤코 단품${i}`),
];

test('프로필: 사분위로 가격대를 잡는다', () => {
  const p = buildSellerProfile(sold, names, 60)!;
  assert.ok(p.priceP25 < p.priceMedian && p.priceMedian < p.priceP75);
  assert.equal(p.basis.soldOptions, 34);
});

// 그로스 22 / 윙 12는 '그로스 위주'가 아니라 '둘 다 쓰는' 가게다. 한쪽이 두 배
// 넘게 많을 때만 주력으로 본다 — 어중간한 차이로 한쪽을 주력이라 하면 반대쪽
// 시장을 부당하게 깎게 된다.
test('프로필: 양쪽을 비슷하게 쓰면 둘 다로 본다', () => {
  const p = buildSellerProfile(sold, names, 60)!;
  assert.equal(p.channel, 'both');
});

test('프로필: 한쪽이 뚜렷할 때만 주력으로 본다', () => {
  const mostlyGrowth = Array.from({ length: 20 }, () => ({ unitPrice: 30000, channel: 'growth' }));
  assert.equal(buildSellerProfile(mostlyGrowth, names, 60)!.channel, 'growth');

  const half = [
    ...Array.from({ length: 10 }, () => ({ unitPrice: 30000, channel: 'growth' })),
    ...Array.from({ length: 10 }, () => ({ unitPrice: 30000, channel: 'marketplace' })),
  ];
  assert.equal(buildSellerProfile(half, names, 60)!.channel, 'both');
});

// 서너 개 팔아 놓고 "이게 내 가게의 성격"이라고 할 수는 없다
test('프로필: 표본이 적으면 만들지 않는다', () => {
  const few = Array.from({ length: FIT_MIN_OPTIONS - 1 }, () => ({ unitPrice: 30000, channel: 'growth' }));
  assert.equal(buildSellerProfile(few, names, 60), null);
});

test('세트 판별', () => {
  assert.equal(looksLikeSet('여성 맨투맨 2종 세트'), true);
  assert.equal(looksLikeSet('나시티 4종세트'), true);
  assert.equal(looksLikeSet('긴팔 티셔츠 1+1'), true);
  assert.equal(looksLikeSet('기본 반팔 티셔츠'), false);
});

// ── 적합도 ──

const profile: SellerProfile = {
  priceP25: 20000, priceMedian: 29000, priceP75: 36000,
  channel: 'growth', setRatio: 0.78, basis: { soldOptions: 34, days: 60 },
};

test('적합도: 늘 팔던 가격대면 높다', () => {
  const r = sellerFit({ productPrice: 29900, deliveryType: 'jet', productName: '여성 니트 2종 세트' }, profile);
  assert.ok(r.score >= 90, String(r.score));
  assert.ok(r.reason.includes('늘 팔던 가격대'));
});

test('적합도: 가격대가 멀면 낮아진다', () => {
  const near = sellerFit({ productPrice: 29900, deliveryType: 'jet', productName: 'A 2종 세트' }, profile);
  const far = sellerFit({ productPrice: 180000, deliveryType: 'jet', productName: 'A 2종 세트' }, profile);
  assert.ok(far.score < near.score);
  assert.ok(far.reason.includes('비싼 가격대'));

  const cheap = sellerFit({ productPrice: 4000, deliveryType: 'jet', productName: 'A 2종 세트' }, profile);
  assert.ok(cheap.reason.includes('싼 가격대'));
});

// 로켓그로스를 쓰는 사람에게 그로스 경쟁은 불리한 게 아니라 익숙한 자리다.
// 기존 점수는 이걸 모르고 무조건 깎았다.
test('적합도: 그로스 판매자에게 그로스 시장은 익숙한 자리다', () => {
  const forGrowth = sellerFit({ productPrice: 29900, deliveryType: 'jet', productName: 'A' }, profile);
  const forWing = sellerFit({ productPrice: 29900, deliveryType: 'jet', productName: 'A' }, { ...profile, channel: 'wing' });
  assert.ok(forGrowth.score > forWing.score);
  assert.ok(forGrowth.reason.includes('익숙한 자리'));
});

test('적합도: 로켓은 누구에게나 어렵다', () => {
  const r = sellerFit({ productPrice: 29900, deliveryType: 'rocket', productName: 'A' }, profile);
  assert.ok(r.reason.includes('직접 경쟁'));
  const jet = sellerFit({ productPrice: 29900, deliveryType: 'jet', productName: 'A' }, profile);
  assert.ok(r.score < jet.score);
});

test('적합도: 세트로 파는 사람에게 세트 시장은 아는 싸움이다', () => {
  const set = sellerFit({ productPrice: 29900, deliveryType: 'jet', productName: '니트 2종 세트' }, profile);
  const single = sellerFit({ productPrice: 29900, deliveryType: 'jet', productName: '니트 단품' }, profile);
  assert.ok(set.score > single.score);
  assert.ok(set.reason.includes('하던 방식'));
});

test('적합도: 단품만 파는 사람에게는 반대로 본다', () => {
  const singleSeller: SellerProfile = { ...profile, setRatio: 0.1 };
  const set = sellerFit({ productPrice: 29900, deliveryType: 'jet', productName: '니트 2종 세트' }, singleSeller);
  const single = sellerFit({ productPrice: 29900, deliveryType: 'jet', productName: '니트 단품' }, singleSeller);
  assert.ok(single.score > set.score);
});

// ── 섞기 ──
// 적합도가 이기면 "늘 팔던 것과 닮았으면 무조건 좋다"가 되어 이미 하는 것만
// 계속하게 된다. 기회점수 쪽이 더 무거워야 한다.

test('섞기: 기회점수가 더 무겁다', () => {
  const goodMarketBadFit = blendScore(90, 20);
  const badMarketGoodFit = blendScore(20, 90);
  assert.ok(goodMarketBadFit > badMarketGoodFit);
});

test('섞기: 적합도가 순위를 뒤집을 만큼은 기운다', () => {
  // 시장 점수가 비슷하면 나에게 맞는 쪽이 이겨야 한다
  assert.ok(blendScore(70, 95) > blendScore(74, 30));
});

test('섞기: 0~100을 벗어나지 않는다', () => {
  assert.equal(blendScore(200, 200), 100);
  assert.equal(blendScore(-50, -50), 0);
});

// '묶음배송 가능'은 배송 안내지 세트가 아니다. 이 문구는 흔해서, 단품만 파는
// 가게의 세트 비중이 0.5 근처로 올라간다. 그 값은 0.6 위도 0.2 아래도 아니라
// 구성 신호가 통째로 죽고, 조금 더 올라가면 뒤집혀서 세트를 한 번도 안 판
// 사람에게 세트 시장을 권하게 된다.
test('세트 판별: 배송 안내 문구를 세트로 읽지 않는다', () => {
  assert.equal(looksLikeSet('화장지 30롤 묶음배송 가능'), false);
  assert.equal(looksLikeSet('여성 니트 묶음배송'), false);
});

// '12종합영양제'의 '12종'이 걸렸다. 자릿수 제한이 없었기 때문이다.
test('세트 판별: 종합·모델명에 낀 숫자를 세트로 읽지 않는다', () => {
  assert.equal(looksLikeSet('비타민 12종합영양제'), false);
  assert.equal(looksLikeSet('모델 2024 티셔츠'), false);
});

// 판별 규칙이 parseSet과 갈라지면 점수와 가격이 서로 다른 말을 한다
test('세트 판별: 낱개 환산과 같은 기준을 쓴다', () => {
  const names = ['여성 맨투맨 2종 세트', '나시티 4종세트', '긴팔 티셔츠 1+1',
                 '기본 반팔 티셔츠', '화장지 30롤 묶음배송 가능', '비타민 12종합영양제'];
  for (const n of names) {
    assert.equal(looksLikeSet(n), parseSet(n, 10000).count > 1, n);
  }
});
