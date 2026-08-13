import type { SourcingProduct } from './types';

export type AiStrategyResult = {
  score: number;
  grade: string;
  recommendation: string;
  reason: string;
  targetCustomers: string[];
  risks: string[];
  differentiation: string[];
  recommendedPrice: { min: number; max: number; primary: number };
  keywords: string[];
  productNames: string[];
};

export function buildAiAnalysisPrompt(product: SourcingProduct) {
  return `당신은 대한민국 쿠팡 전문 상품 소싱 분석가입니다.
제공된 데이터만을 이용하여 상품의 시장성과 신규 셀러 진입 가능성을 분석하십시오.
근거 없는 판매량이나 매출 수치는 생성하지 말고, 입력 데이터가 없으면 '데이터 부족'이라고 표시하십시오.

입력 데이터:
${JSON.stringify({
  keyword: product.keyword,
  searchVolume: product.searchVolume,
  growth30d: product.growth30d,
  avgPrice: product.price,
  avgReview: product.avgReview,
  estimatedMonthlySales: product.estimatedSales,
  coupangProductCount: product.coupangProductCount,
  opportunityScore: product.opportunityScore,
  rocketRatio: product.rocketRatio,
  adRatio: product.adRatio,
  estimatedRevenue: product.estimatedRevenue,
  supplierPrice: product.supplierCost,
  aiScore: product.score.total,
  grade: product.grade,
}, null, 2)}

반드시 JSON으로만 답하십시오.`;
}

export function createMockAiStrategy(product: SourcingProduct): AiStrategyResult {
  return {
    score: product.score.total,
    grade: product.grade,
    recommendation: product.recommendation,
    reason: `${product.keyword}는 쿠팡 상품수 추정 ${product.coupangProductCount.toLocaleString('ko-KR')}개 대비 월 판매량 추정 ${product.estimatedSales.toLocaleString('ko-KR')}개로 수요 대비 경쟁이 낮은 키워드입니다. 기회점수 ${product.opportunityScore}점 기준으로 우선 검토 대상이며, 예상값은 mock data 기반 추정으로 표시합니다.`,
    targetCustomers: product.targetCustomers,
    risks: product.risks,
    differentiation: product.differentiation,
    recommendedPrice: {
      min: Math.round(product.price * 0.94 / 100) * 100,
      max: Math.round(product.price * 1.06 / 100) * 100,
      primary: Math.round(product.price * 1.03 / 100) * 100,
    },
    keywords: product.generatedKeywords,
    productNames: product.generatedNames,
  };
}
