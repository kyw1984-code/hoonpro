import { sourcingProducts } from './mockData';
import type { SourcingFilters, SourcingProduct } from './types';

export interface KeywordProvider {
  searchKeyword(keyword: string): Promise<SourcingProduct[]>;
  getTrend(keyword: string): Promise<{ growth7d: number; growth30d: number; growth90d: number }>;
}

export interface ProductProvider {
  searchProducts(filters: SourcingFilters): Promise<SourcingProduct[]>;
  getProductDetail(productId: string): Promise<SourcingProduct | null>;
}

export interface SupplierProvider {
  getSupplierProducts(productId: string): Promise<SourcingProduct['suppliers']>;
}

export interface TrendProvider {
  getRisingProducts(): Promise<SourcingProduct[]>;
  getSeasonProducts(): Promise<SourcingProduct[]>;
}

const normalize = (value: string) => value.trim().toLowerCase();
const sortByOpportunity = (a: SourcingProduct, b: SourcingProduct) => {
  if (b.opportunityScore !== a.opportunityScore) return b.opportunityScore - a.opportunityScore;
  if (b.estimatedSales !== a.estimatedSales) return b.estimatedSales - a.estimatedSales;
  return a.coupangProductCount - b.coupangProductCount;
};

const coupangCategoryUrls: Record<string, string> = {
  패션: 'https://www.coupang.com/np/categories/525715',
  DIY: 'https://www.coupang.com/np/categories/520663',
};

type CoupangApiProduct = {
  productId: string | number;
  productName: string;
  productPrice: number;
  productUrl?: string;
  rating?: number;
  ratingCount?: number;
  reviewCount?: number;
  rank?: number;
  salesRank?: number;
  sellerName?: string;
  source?: string;
  deliveryType?: 'rocket' | 'jet' | 'general' | string;
  calculated?: {
    saleIndex?: number;
    opportunityScore?: number;
  };
};

const estimateSales = (product: CoupangApiProduct, rank: number) => {
  const reviewCount = Number(product.ratingCount ?? product.reviewCount ?? 0);
  const saleIndex = Number(product.calculated?.saleIndex ?? 0);
  const rankScore = Math.max(80, 1400 - rank * 95);
  return Math.round(Math.max(rankScore, saleIndex * 18, reviewCount * 3.4));
};

const getDeliveryLabel = (deliveryType: CoupangApiProduct['deliveryType']): '로켓' | '판매자로켓' | '일반' => {
  if (deliveryType === 'rocket') return '로켓';
  if (deliveryType === 'jet') return '판매자로켓';
  return '일반';
};

const buildLiveProduct = (seed: SourcingProduct, apiProducts: CoupangApiProduct[], index: number): SourcingProduct => {
  const competitors = apiProducts.slice(0, 10).map((product, rank) => {
    const estimatedSales = estimateSales(product, rank + 1);
    return {
      rank: rank + 1,
      name: product.productName,
      productUrl: product.productUrl,
      price: Number(product.productPrice) || seed.price,
      reviews: Number(product.ratingCount ?? product.reviewCount ?? 0),
      estimatedSales,
      delivery: getDeliveryLabel(product.deliveryType),
    };
  });
  const topProducts = competitors.length > 0 ? competitors : seed.competitors;
  const avgPrice = Math.round(topProducts.reduce((sum, product) => sum + product.price, 0) / topProducts.length / 100) * 100;
  const avgReview = Math.round(topProducts.reduce((sum, product) => sum + product.reviews, 0) / topProducts.length);
  const totalSales = topProducts.reduce((sum, product) => sum + product.estimatedSales, 0);
  const coupangProductCount = Math.max(1, apiProducts.length);
  const opportunityScore = Math.max(
    0,
    Math.min(100, Math.round((totalSales / 180) + Math.max(0, 100 - coupangProductCount) * 0.45 - avgReview / 180)),
  );

  return {
    ...seed,
    id: `live-${seed.id}-${index + 1}`,
    price: avgPrice || seed.price,
    avgReview,
    estimatedSales: Math.round(totalSales / Math.max(1, topProducts.length)),
    estimatedRevenue: avgPrice * Math.round(totalSales / Math.max(1, topProducts.length)),
    coupangProductCount,
    opportunityScore,
    competitors: topProducts,
    recommendation: 'Bright Data Coupang Scraper로 수집한 실제 쿠팡 상품 데이터 기반 결과입니다.',
  };
};

const fetchLiveProducts = async (keyword: string, category: string, filters: SourcingFilters) => {
  const params = new URLSearchParams({
    keyword,
    limit: '10',
    excludeBrands: 'true',
  });
  const categoryUrl = coupangCategoryUrls[category];
  if (categoryUrl) params.set('categoryUrl', categoryUrl);
  const response = await fetch(`/api/shopping-data?${params.toString()}`);
  if (!response.ok) return [];
  const data = await response.json();
  if (data?.pending) return [];
  if (Array.isArray(data?.products)) {
    return (data.products as CoupangApiProduct[]).filter((product) => {
      const price = Number(product.productPrice) || 0;
      return price >= filters.minPrice && price <= filters.maxPrice;
    });
  }
  return [];
};

export class MockSourcingProvider implements KeywordProvider, ProductProvider, SupplierProvider, TrendProvider {
  async searchKeyword(keyword: string) {
    const query = normalize(keyword);
    if (!query) return sourcingProducts;
    return sourcingProducts.filter((product) => normalize(product.name).includes(query) || normalize(product.category).includes(query));
  }

  async getTrend(keyword: string) {
    const product = (await this.searchKeyword(keyword))[0];
    return {
      growth7d: product?.growth7d ?? 0,
      growth30d: product?.growth30d ?? 0,
      growth90d: product?.growth90d ?? 0,
    };
  }

  async searchProducts(filters: SourcingFilters) {
    const query = normalize(filters.query);
    return sourcingProducts
      .filter((product) => product.difficulty === filters.difficulty)
      .filter((product) => filters.category === '기타' || product.category === filters.category || Boolean(query))
      .filter((product) => product.price >= filters.minPrice && product.price <= filters.maxPrice)
      .filter((product) => product.avgReview <= filters.maxReview)
      .filter((product) => filters.keywordTypes.length === 0 || filters.keywordTypes.some((type) => product.keywordTypes.includes(type)))
      .filter((product) => !query || normalize(product.name).includes(query) || normalize(product.category).includes(query))
      .sort(sortByOpportunity);
  }

  async getProductDetail(productId: string) {
    return sourcingProducts.find((product) => product.id === productId) ?? null;
  }

  async getSupplierProducts(productId: string) {
    return (await this.getProductDetail(productId))?.suppliers ?? [];
  }

  async getRisingProducts() {
    return [...sourcingProducts].sort((a, b) => b.growth30d - a.growth30d).slice(0, 12);
  }

  async getSeasonProducts() {
    return sourcingProducts.filter((product) => product.keywordTypes.includes('시즌상품')).sort((a, b) => a.peakInDays - b.peakInDays);
  }
}

export class LiveSourcingProvider extends MockSourcingProvider {
  async searchProducts(filters: SourcingFilters) {
    const baseProducts = await super.searchProducts(filters);
    const candidates = filters.query.trim()
      ? baseProducts.filter((product) => normalize(product.name).includes(normalize(filters.query))).slice(0, 1)
      : baseProducts.slice(0, 6);
    const liveProducts = await Promise.all(candidates.map(async (seed, index) => {
      const keyword = filters.query.trim() || seed.name;
      const apiProducts = await fetchLiveProducts(keyword, seed.category, filters);
      if (apiProducts.length === 0) return null;
      return buildLiveProduct(seed, apiProducts, index);
    }));
    const usableProducts = liveProducts.filter((product): product is SourcingProduct => Boolean(product));
    return usableProducts.length > 0 ? usableProducts.sort(sortByOpportunity) : baseProducts;
  }
}

export const sourcingProvider = new LiveSourcingProvider();
