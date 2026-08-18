/**
 * 실제 수집된 쿠팡 상품 집합(cohort)에서 시장 경쟁도와 상품별 기회점수를 계산합니다.
 *
 * 이전 구현은 기회점수를 `72 - 리뷰/18 + (10 - 순위) * 1.8` 로 계산해서
 * 사실상 "수집 순위가 앞이고 리뷰가 적으면 고득점"이었고, 경쟁 강도를
 * 전혀 반영하지 못했습니다. 게다가 경쟁 지표로 쓰이던 상품 개수는 쿠팡의
 * 실제 등록 상품수가 아니라 우리가 수집해서 중복제거하고 남은 개수라,
 * 수집이 적게 될수록 블루오션처럼 보이는 역효과가 있었습니다.
 *
 * 여기서는 Bright Data가 실제로 주는 신호(가격, 리뷰수, 평점, 배송유형,
 * 브랜드)만 사용하고, 표본이 작으면 신뢰도로 점수를 중립값(50)에 수축시켜
 * 표본 부족이 고득점으로 둔갑하지 않게 합니다.
 */

export type MarketProductInput = {
  reviews: number;
  price: number;
  delivery: '로켓' | '판매자로켓' | '일반';
  brand?: string;
};

export type MarketCohort = {
  /** 수집·중복제거 후 남은 상품 수. 쿠팡 전체 등록 상품수가 아닙니다. */
  sampleSize: number;
  /** 상위 상품 리뷰 중앙값 — 신규 진입의 리뷰 장벽 */
  medianReviews: number;
  /** 로켓/판매자로켓 비율 (0-100) */
  rocketRatio: number;
  /** 최다 브랜드가 차지하는 노출 비율 (0-100) */
  brandConcentration: number;
  /** 상위 3개 상품이 가진 리뷰 비중 (0-100) */
  topConcentration: number;
  /** 종합 경쟁 강도 (0-100, 높을수록 진입이 어려움) */
  competitionLevel: number;
  /** 표본 크기에서 온 신뢰도 (0-1) */
  confidence: number;
  confidenceLabel: string;
};

export type MarketOpportunity = {
  opportunityScore: number;
  /** 신뢰도 수축을 적용하기 전 원점수 — 디버깅·검증용 */
  rawScore: number;
  reviewEdge: number;
  priceEdge: number;
  deliveryEdge: number;
  marketOpenness: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** 리뷰 중앙값이 높을수록 신규 셀러가 상위로 올라가기 어렵습니다. (0-40) */
export const reviewBarrierPoints = (medianReviews: number) => {
  if (medianReviews <= 20) return 0;
  if (medianReviews <= 50) return 6;
  if (medianReviews <= 150) return 14;
  if (medianReviews <= 400) return 24;
  if (medianReviews <= 1000) return 32;
  return 40;
};

/**
 * 표본이 작을수록 시장을 단정할 수 없으므로 점수를 중립값 쪽으로 끌어당깁니다.
 * 작은 표본을 낮은 점수로 처리하지 않는 이유는, 나쁜 시장이라는 근거가 아니라
 * 아직 모른다는 뜻이기 때문입니다.
 */
export const getConfidence = (sampleSize: number) => {
  if (sampleSize >= 40) return 1;
  if (sampleSize >= 25) return 0.9;
  if (sampleSize >= 12) return 0.75;
  if (sampleSize >= 6) return 0.6;
  return 0.45;
};

export const getConfidenceLabel = (sampleSize: number) => {
  if (sampleSize >= 40) return '표본 충분';
  if (sampleSize >= 12) return '표본 보통';
  if (sampleSize >= 6) return '표본 적음';
  return '표본 부족';
};

export function computeMarketCohort(products: MarketProductInput[]): MarketCohort {
  const sampleSize = products.length;
  const confidence = getConfidence(sampleSize);
  const confidenceLabel = getConfidenceLabel(sampleSize);

  if (sampleSize === 0) {
    return {
      sampleSize: 0,
      medianReviews: 0,
      rocketRatio: 0,
      brandConcentration: 0,
      topConcentration: 0,
      competitionLevel: 50,
      confidence,
      confidenceLabel,
    };
  }

  const reviewCounts = products.map((product) => Math.max(0, product.reviews));
  const medianReviews = median(reviewCounts);

  const rocketCount = products.filter((product) => product.delivery !== '일반').length;
  const rocketRatio = Math.round((rocketCount / sampleSize) * 100);

  const brandCounts = new Map<string, number>();
  for (const product of products) {
    const brand = (product.brand || '').trim().toLowerCase();
    if (!brand) continue;
    brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);
  }
  const topBrandCount = Math.max(0, ...brandCounts.values());
  const brandConcentration = Math.round((topBrandCount / sampleSize) * 100);

  // 상위 3개의 리뷰 "비중"을 그대로 쓰면 표본이 커질수록 기계적으로 작아져서
  // 표본 크기에 좌우됩니다. 균등 분포였을 때의 몫과 비교해 정규화하면
  // 표본 크기와 무관하게 쏠림 정도만 남습니다.
  const totalReviews = reviewCounts.reduce((sum, count) => sum + count, 0);
  const top3Reviews = [...reviewCounts].sort((a, b) => b - a).slice(0, 3).reduce((sum, count) => sum + count, 0);
  const evenShare = Math.min(3, sampleSize) / sampleSize;
  const actualShare = totalReviews > 0 ? top3Reviews / totalReviews : evenShare;
  const topConcentration = evenShare >= 1
    ? 0
    : Math.round(clamp((actualShare - evenShare) / (1 - evenShare), 0, 1) * 100);

  const competitionLevel = Math.round(
    clamp(
      reviewBarrierPoints(medianReviews) +
        (rocketRatio / 100) * 25 +
        (brandConcentration / 100) * 20 +
        (topConcentration / 100) * 15,
      0,
      100,
    ),
  );

  return {
    sampleSize,
    medianReviews: Math.round(medianReviews),
    rocketRatio,
    brandConcentration,
    topConcentration,
    competitionLevel,
    confidence,
    confidenceLabel,
  };
}

/** 경쟁 상품 대비 리뷰가 적을수록 추월 여지가 큽니다. (0-20) */
export const reviewEdgePoints = (reviews: number, medianReviews: number) => {
  const baseline = Math.max(medianReviews, 1);
  const ratio = reviews / baseline;
  if (ratio <= 0.5) return 20;
  if (ratio <= 1) return 14;
  if (ratio <= 2) return 7;
  return 0;
};

/** 쿠팡 수수료·배송비를 감당할 수 있는 가격대인지. (0-15) */
export const priceEdgePoints = (price: number) => {
  if (price >= 15000 && price <= 60000) return 15;
  if ((price >= 8000 && price < 15000) || (price > 60000 && price <= 120000)) return 9;
  return 4;
};

/** 일반배송 상품이 상위에 있다면 로켓 없이도 진입할 수 있다는 신호입니다. (0-15) */
export const deliveryEdgePoints = (delivery: MarketProductInput['delivery']) => {
  if (delivery === '일반') return 15;
  if (delivery === '판매자로켓') return 9;
  return 3;
};

export function scoreProductInMarket(product: MarketProductInput, cohort: MarketCohort): MarketOpportunity {
  const marketOpenness = 100 - cohort.competitionLevel;
  const reviewEdge = reviewEdgePoints(product.reviews, cohort.medianReviews);
  const priceEdge = priceEdgePoints(product.price);
  const deliveryEdge = deliveryEdgePoints(product.delivery);

  const rawScore = clamp(marketOpenness * 0.5 + reviewEdge + priceEdge + deliveryEdge, 0, 100);
  const opportunityScore = Math.round(clamp(50 + (rawScore - 50) * cohort.confidence, 0, 100));

  return {
    opportunityScore,
    rawScore: Math.round(rawScore),
    reviewEdge,
    priceEdge,
    deliveryEdge,
    marketOpenness,
  };
}

/**
 * 실측 가능한 축만으로 AI SCORE를 만듭니다.
 * 성장성/가격안정성/시즌성/공급가능성은 현재 연결된 데이터 소스가 없어
 * 측정하지 않으며, unmeasuredAxes로 명시합니다.
 */
export const UNMEASURED_AXES = ['성장성', '가격안정성', '시즌성', '공급가능성'] as const;

export type MeasuredScore = {
  demand: number;
  competition: number;
  review: number;
  margin: number;
  total: number;
};

/** 리뷰가 쌓였다는 것은 실제 구매가 일어났다는 뜻입니다. (0-20) */
export const demandPoints = (reviews: number) => {
  if (reviews >= 500) return 20;
  if (reviews >= 200) return 16;
  if (reviews >= 80) return 12;
  if (reviews >= 30) return 8;
  if (reviews >= 5) return 5;
  return 2;
};

export function computeMeasuredScore(product: MarketProductInput, cohort: MarketCohort): MeasuredScore {
  const demand = demandPoints(product.reviews);
  const competition = Math.round(clamp(20 - cohort.competitionLevel / 5, 0, 20));
  const review = Math.round((reviewEdgePoints(product.reviews, cohort.medianReviews) / 20) * 15);
  const margin = Math.round((priceEdgePoints(product.price) / 15) * 15);

  const measurableMax = 20 + 20 + 15 + 15;
  const subtotal = demand + competition + review + margin;
  const scaled = (subtotal / measurableMax) * 100;
  const total = Math.round(clamp(50 + (scaled - 50) * cohort.confidence, 0, 100));

  return { demand, competition, review, margin, total };
}
