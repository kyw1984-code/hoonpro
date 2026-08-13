export type ProductScoreInput = {
  searchVolume: number;
  competitionLevel: number;
  avgReview: number;
  growth30d: number;
  expectedMargin: number;
  priceStability: number;
  seasonality: number;
  supplierReliability: number;
};

export type ProductGrade = 'S' | 'A' | 'B' | 'C' | 'D';

export type ProductScoreBreakdown = {
  demand: number;
  competition: number;
  review: number;
  growth: number;
  margin: number;
  priceStability: number;
  seasonality: number;
  supplier: number;
  total: number;
  grade: ProductGrade;
  recommendation: string;
};

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, Math.round(value)));

export function calculateDemandScore(searchVolume: number) {
  if (searchVolume >= 80000) return 20;
  if (searchVolume >= 45000) return 16;
  if (searchVolume >= 20000) return 10;
  if (searchVolume >= 8000) return 5;
  return 2;
}

export function calculateCompetitionScore(competitionLevel: number) {
  if (competitionLevel <= 20) return 20;
  if (competitionLevel <= 40) return 16;
  if (competitionLevel <= 60) return 10;
  if (competitionLevel <= 80) return 5;
  return 0;
}

export function calculateReviewScore(avgReview: number) {
  if (avgReview <= 50) return 15;
  if (avgReview <= 300) return 10;
  if (avgReview <= 1500) return 5;
  return 0;
}

export function calculateGrowthScore(growth30d: number) {
  if (growth30d >= 60) return 15;
  if (growth30d >= 35) return 12;
  if (growth30d >= 15) return 8;
  if (growth30d >= 0) return 4;
  return 0;
}

export function calculateMarginScore(expectedMargin: number) {
  if (expectedMargin >= 40) return 15;
  if (expectedMargin >= 30) return 12;
  if (expectedMargin >= 20) return 8;
  if (expectedMargin >= 10) return 4;
  return 0;
}

export function getGrade(total: number): ProductGrade {
  if (total >= 90) return 'S';
  if (total >= 80) return 'A';
  if (total >= 70) return 'B';
  if (total >= 60) return 'C';
  return 'D';
}

export function getRecommendation(grade: ProductGrade) {
  if (grade === 'S') return '적극 검토';
  if (grade === 'A') return '추천';
  if (grade === 'B') return '검토';
  if (grade === 'C') return '주의';
  return '비추천';
}

export function calculateProductScore(input: ProductScoreInput): ProductScoreBreakdown {
  const demand = calculateDemandScore(input.searchVolume);
  const competition = calculateCompetitionScore(input.competitionLevel);
  const review = calculateReviewScore(input.avgReview);
  const growth = calculateGrowthScore(input.growth30d);
  const margin = calculateMarginScore(input.expectedMargin);
  const priceStability = clamp(input.priceStability, 5);
  const seasonality = clamp(input.seasonality, 5);
  const supplier = clamp(input.supplierReliability, 5);
  const total = demand + competition + review + growth + margin + priceStability + seasonality + supplier;
  const grade = getGrade(total);

  return {
    demand,
    competition,
    review,
    growth,
    margin,
    priceStability,
    seasonality,
    supplier,
    total,
    grade,
    recommendation: getRecommendation(grade),
  };
}
