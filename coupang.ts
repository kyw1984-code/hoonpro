export interface CoupangProduct {
  productId: string;
  productName: string;
  productPrice: number;
  productImage: string;
  productUrl: string;
  isRocket: boolean;
  rating: number;
  reviewCount: number;
  salesRank?: number;
  category?: string;
}

export interface SearchResult {
  products: CoupangProduct[];
  keyword: string;
  isMock: boolean;
}

export interface PriceRange {
  min: number;
  max: number;
  avg: number;
}

export interface Strategy {
  icon: string;
  title: string;
  desc: string;
  color: string;
}

export interface SummaryMetric {
  label: string;
  value: string;
  sub: string;
  color: string;
}
