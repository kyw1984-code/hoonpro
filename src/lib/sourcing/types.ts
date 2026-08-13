import type { ProductGrade, ProductScoreBreakdown } from '../scoring/calculateProductScore';

export type Difficulty = '아마추어' | '준프로' | '프로';
export type SourcingStatus = '발견' | '분석중' | '샘플 주문' | '소싱 완료' | '상품 등록' | '판매중' | '보류' | '실패';
export type KeywordType = '블루오션' | '급상승' | '시즌상품' | '신규시장' | '고마진' | '저경쟁' | '리뷰장벽 낮음';

export type CompetitorProduct = {
  rank: number;
  name: string;
  productUrl: string;
  price: number;
  reviews: number;
  estimatedSales: number;
  delivery: '로켓' | '판매자로켓' | '일반';
};

export type SupplierProduct = {
  id: string;
  productName: string;
  supplier: string;
  cost: number;
  shippingCost: number;
  moq: number;
  url: string;
  imageUrl: string;
  textSimilarity: number;
  imageSimilarity: number;
  totalSimilarity: number;
};

export type SeasonalityPoint = {
  month: number;
  value: number;
};

export type SourcingProduct = {
  id: string;
  keyword: string;
  name: string;
  category: string;
  keywordTypes: KeywordType[];
  price: number;
  supplierCost: number;
  shippingCost: number;
  avgReview: number;
  rating: number;
  searchVolume: number;
  growth7d: number;
  growth30d: number;
  growth90d: number;
  estimatedSales: number;
  estimatedRevenue: number;
  competitionLevel: number;
  rocketRatio: number;
  adRatio: number;
  brandRatio: number;
  topConcentration: number;
  moq: number;
  difficulty: Difficulty;
  score: ProductScoreBreakdown;
  status: SourcingStatus;
  competitors: CompetitorProduct[];
  suppliers: SupplierProduct[];
  seasonality: SeasonalityPoint[];
  peakInDays: number;
  targetCustomers: string[];
  competitorWeaknesses: string[];
  strategies: string[];
  generatedNames: string[];
  generatedKeywords: string[];
  differentiation: string[];
  risks: string[];
  grade: ProductGrade;
  recommendation: string;
};

export type SourcingFilters = {
  difficulty: Difficulty;
  category: string;
  minPrice: number;
  maxPrice: number;
  maxReview: number;
  keywordTypes: KeywordType[];
  query: string;
};

export type ProviderStatus = {
  name: string;
  role: string;
  implementation: 'Mock Provider' | 'Supabase Ready' | 'OpenAI Ready' | 'Future API';
  status: '사용중' | '연결 준비' | '추후 연결';
};
