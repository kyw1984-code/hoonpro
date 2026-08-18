import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeMarketCohort,
  computeMeasuredScore,
  deliveryEdgePoints,
  getConfidence,
  priceEdgePoints,
  reviewBarrierPoints,
  reviewEdgePoints,
  scoreProductInMarket,
  type MarketProductInput,
} from './marketScore';

const product = (over: Partial<MarketProductInput> = {}): MarketProductInput => ({
  reviews: 50,
  price: 25000,
  delivery: '일반',
  ...over,
});

test('경쟁도는 리뷰 장벽·로켓 비율·브랜드 집중도를 함께 반영한다', () => {
  const open = computeMarketCohort(
    Array.from({ length: 40 }, (_, index) => product({ reviews: 5, brand: `brand${index}` })),
  );
  const closed = computeMarketCohort(
    Array.from({ length: 40 }, () => product({ reviews: 3000, delivery: '로켓', brand: '지배브랜드' })),
  );

  assert.ok(open.competitionLevel < 25, `개방 시장 경쟁도가 낮아야 함: ${open.competitionLevel}`);
  assert.ok(closed.competitionLevel >= 85, `폐쇄 시장 경쟁도가 높아야 함: ${closed.competitionLevel}`);
  assert.equal(closed.rocketRatio, 100);
  assert.equal(closed.brandConcentration, 100);
  // 리뷰가 완전히 균등하면 쏠림은 0 — 표본 크기가 아니라 분포만 본다는 뜻입니다.
  assert.equal(closed.topConcentration, 0);
});

test('상위 쏠림은 표본 크기가 아니라 분포에서만 나온다', () => {
  const skewed = (size: number) => computeMarketCohort([
    product({ reviews: 9000 }),
    product({ reviews: 9000 }),
    product({ reviews: 9000 }),
    ...Array.from({ length: size - 3 }, () => product({ reviews: 1 })),
  ]);

  assert.ok(skewed(20).topConcentration > 90);
  assert.ok(skewed(60).topConcentration > 90);

  const even = (size: number) => computeMarketCohort(Array.from({ length: size }, () => product({ reviews: 100 })));
  assert.equal(even(20).topConcentration, 0);
  assert.equal(even(60).topConcentration, 0);
});

test('표본이 작으면 점수가 중립값 쪽으로 수축한다', () => {
  // 회귀 테스트: 이전 구현에서는 상품 3개만 수집돼도 기회점수 90점이 나왔습니다.
  const tiny = [product({ reviews: 4 }), product({ reviews: 18 }), product({ reviews: 9 })];
  const cohort = computeMarketCohort(tiny);
  const scored = scoreProductInMarket(tiny[0], cohort);

  assert.equal(cohort.sampleSize, 3);
  assert.equal(cohort.confidenceLabel, '표본 부족');
  assert.ok(scored.rawScore > 80, `원점수는 높을 수 있음: ${scored.rawScore}`);
  assert.ok(scored.opportunityScore < 75, `표본 부족이면 수축되어야 함: ${scored.opportunityScore}`);
});

test('같은 상품이라도 표본이 커지면 점수가 원점수에 가까워진다', () => {
  const target = product({ reviews: 4 });
  const small = computeMarketCohort([target, product({ reviews: 18 }), product({ reviews: 9 })]);
  const large = computeMarketCohort([
    target,
    ...Array.from({ length: 44 }, (_, index) => product({ reviews: 5 + index, brand: `brand${index}` })),
  ]);

  const smallScore = scoreProductInMarket(target, small).opportunityScore;
  const largeScore = scoreProductInMarket(target, large).opportunityScore;

  assert.equal(large.confidenceLabel, '표본 충분');
  assert.ok(largeScore > smallScore, `표본이 크면 점수가 더 살아나야 함: ${largeScore} vs ${smallScore}`);
});

test('수집 개수 자체는 경쟁도를 낮추지 않는다', () => {
  // 이전 구현은 coupangProductCount(수집 개수)를 경쟁 지표로 써서
  // 적게 수집될수록 블루오션처럼 보였습니다.
  const few = computeMarketCohort(Array.from({ length: 5 }, () => product({ reviews: 800, delivery: '로켓' })));
  const many = computeMarketCohort(Array.from({ length: 50 }, () => product({ reviews: 800, delivery: '로켓' })));

  assert.equal(few.competitionLevel, many.competitionLevel);
});

test('구성 점수 임계값', () => {
  assert.equal(reviewBarrierPoints(10), 0);
  assert.equal(reviewBarrierPoints(2000), 40);
  assert.equal(reviewEdgePoints(10, 100), 20);
  assert.equal(reviewEdgePoints(500, 100), 0);
  assert.equal(priceEdgePoints(25000), 15);
  assert.equal(priceEdgePoints(3000), 4);
  assert.equal(deliveryEdgePoints('일반'), 15);
  assert.equal(deliveryEdgePoints('로켓'), 3);
  assert.equal(getConfidence(3), 0.45);
  assert.equal(getConfidence(40), 1);
});

test('빈 수집 결과에서도 안전하게 중립값을 반환한다', () => {
  const cohort = computeMarketCohort([]);
  assert.equal(cohort.sampleSize, 0);
  assert.equal(cohort.competitionLevel, 50);

  const scored = scoreProductInMarket(product(), cohort);
  assert.ok(Number.isFinite(scored.opportunityScore));
});

test('AI SCORE는 측정 가능한 축만 사용한다', () => {
  const cohort = computeMarketCohort(
    Array.from({ length: 40 }, (_, index) => product({ reviews: 40, brand: `brand${index}` })),
  );
  const score = computeMeasuredScore(product({ reviews: 400 }), cohort);

  assert.ok(score.demand > 0 && score.competition > 0);
  assert.ok(score.total > 0 && score.total <= 100);
});
