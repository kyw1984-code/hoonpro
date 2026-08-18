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

const coupangCategoryUrls: Record<string, string[]> = {
  패션: ['https://www.coupang.com/np/categories/525715'],
  DIY: [
    'https://www.coupang.com/np/categories/520663',
    'https://www.coupang.com/np/categories/184060',
    'https://www.coupang.com/np/categories/401027',
    'https://www.coupang.com/np/categories/497873',
  ],
};

const liveCategoryPriority: Record<string, number> = {
  DIY: 0,
  패션: 1,
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

type FetchLiveOptions = {
  onProgress?: (progress: number, message: string) => void;
  onSnapshot?: (snapshotId: string, meta?: Record<string, unknown>) => void;
};

export type BrightDataRefreshResult = {
  snapshotId?: string;
  meta?: Record<string, unknown>;
  products?: SourcingProduct[];
};

type BrightDataRawRefreshResult = {
  snapshotId?: string;
  meta?: Record<string, unknown>;
  apiProducts?: CoupangApiProduct[];
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

const normalizeProductFamily = (name: string) => {
  return normalize(name)
    .replace(/\d+(\.\d+)?\s?(cm|mm|m|kg|g|개|p|pcs|호|번|종|세트|set)/gi, ' ')
    .replace(/\b\d{5,}\b/g, ' ')
    .replace(/[,_/()[\]{}+\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 1)
    .slice(0, 5)
    .join(' ');
};

const uniqueApiProducts = (apiProducts: CoupangApiProduct[]) => {
  const seenIds = new Set<string>();
  const familyCounts = new Map<string, number>();
  return apiProducts.filter((product) => {
    const id = String(product.productId || product.productUrl || '').trim();
    if (id && seenIds.has(id)) return false;
    const family = normalizeProductFamily(product.productName);
    const count = familyCounts.get(family) || 0;
    if (family && count >= 1) return false;
    if (id) seenIds.add(id);
    if (family) familyCounts.set(family, count + 1);
    return true;
  });
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

const buildLiveProducts = (seed: SourcingProduct, apiProducts: CoupangApiProduct[]): SourcingProduct[] => {
  const uniqueProducts = uniqueApiProducts(apiProducts);
  const productsForDisplay = uniqueProducts;
  const competitors = productsForDisplay.slice(0, 10).map((product, rank) => ({
    rank: rank + 1,
    name: product.productName,
    productUrl: product.productUrl,
    price: Number(product.productPrice) || seed.price,
    reviews: Number(product.ratingCount ?? product.reviewCount ?? 0),
    estimatedSales: estimateSales(product, rank + 1),
    delivery: getDeliveryLabel(product.deliveryType),
  }));
  const avgReview = Math.round(competitors.reduce((sum, product) => sum + product.reviews, 0) / Math.max(1, competitors.length));

  return productsForDisplay.slice(0, 7).map((product, index) => {
    const price = Number(product.productPrice) || seed.price;
    const reviews = Number(product.ratingCount ?? product.reviewCount ?? 0);
    const estimatedSales = estimateSales(product, index + 1);
    const opportunityScore = Math.max(0, Math.min(100, Math.round(72 - reviews / 18 + Math.max(0, 10 - index) * 1.8)));
    return {
      ...seed,
      id: `live-${String(product.productId || index + 1)}`,
      keyword: product.productName,
      name: product.productName,
      productUrl: product.productUrl,
      price,
      avgReview: reviews,
      estimatedSales,
      estimatedRevenue: price * estimatedSales,
      coupangProductCount: productsForDisplay.length,
      opportunityScore,
      competitors,
      recommendation: 'Bright Data Coupang Scraper 실제 수집 상품입니다.',
      score: {
        ...seed.score,
        demand: Math.max(10, Math.min(20, Math.round(estimatedSales / 90))),
        competition: Math.max(8, Math.min(20, Math.round((100 - reviews / 2) / 5))),
        review: Math.max(6, Math.min(15, Math.round((180 - reviews) / 12))),
        total: Math.max(45, Math.min(95, opportunityScore + 8)),
      },
      grade: opportunityScore >= 80 ? 'S' : opportunityScore >= 65 ? 'A' : opportunityScore >= 52 ? 'B' : 'C',
    };
  });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readLiveProductsResponse = async (params: URLSearchParams) => {
  const response = await fetch(`/api/sourcing?${params.toString()}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Vercel Preview 보호 설정으로 API 응답이 차단되었습니다.');
  }
  const data = await response.json();
  return { response, data };
};

const buildLiveParams = (keyword: string, category: string) => {
  const params = new URLSearchParams({
    keyword,
    limit: '60',
    excludeBrands: 'true',
  });
  const categoryUrls = coupangCategoryUrls[category] || [];
  if (categoryUrls.length > 0) params.set('categoryUrls', categoryUrls.join(','));
  params.set('type', 'shopping-data');
  return params;
};

const filterLiveProductsByPrice = (products: CoupangApiProduct[], filters: SourcingFilters) => {
  return products.filter((product) => {
    const price = Number(product.productPrice) || 0;
    return price >= filters.minPrice && price <= filters.maxPrice;
  });
};

const startLiveRefresh = async (keyword: string, category: string, filters: SourcingFilters, options: FetchLiveOptions = {}): Promise<BrightDataRawRefreshResult> => {
  const params = buildLiveParams(keyword, category);
  const { response, data } = await readLiveProductsResponse(params);
  const snapshotId = data?.snapshotId ? String(data.snapshotId) : '';
  if (snapshotId) options.onSnapshot?.(snapshotId, data?.meta);
  if (response.status === 202 && snapshotId) return { snapshotId, meta: data?.meta };
  if (!response.ok) throw new Error(data?.error || 'Bright Data API 호출에 실패했습니다.');
  if (Array.isArray(data?.products)) {
    return { apiProducts: filterLiveProductsByPrice(data.products as CoupangApiProduct[], filters), meta: data?.meta };
  }
  throw new Error('Bright Data 결과에서 상품 데이터를 찾지 못했습니다.');
};

const fetchLiveProducts = async (keyword: string, category: string, filters: SourcingFilters, options: FetchLiveOptions = {}) => {
  let { response, data } = await readLiveProductsResponse(buildLiveParams(keyword, category));
  let snapshotId = data?.snapshotId ? String(data.snapshotId) : '';
  if (snapshotId) options.onSnapshot?.(snapshotId, data?.meta);
  for (let attempt = 0; response.status === 202 && snapshotId && attempt < 60; attempt += 1) {
    const progress = Math.min(96, 18 + Math.round((attempt / 60) * 78));
    options.onProgress?.(progress, `쿠팡 상품 수집중 · ${attempt + 1}번째 확인`);
    await sleep(8000);
    const retryParams = new URLSearchParams({
      type: 'shopping-data',
      snapshotId,
      limit: '60',
      excludeBrands: 'true',
    });
    ({ response, data } = await readLiveProductsResponse(retryParams));
    snapshotId = data?.snapshotId ? String(data.snapshotId) : snapshotId;
  }

  if (!response.ok) throw new Error(data?.error || 'Bright Data API 호출에 실패했습니다.');
  if (data?.pending) throw new Error('Bright Data 수집이 아직 완료되지 않았습니다. 잠시 후 다시 시도해주세요.');
  if (Array.isArray(data?.products)) {
    return filterLiveProductsByPrice(data.products as CoupangApiProduct[], filters);
  }
  throw new Error('Bright Data 결과에서 상품 데이터를 찾지 못했습니다.');
};

const fetchSnapshotProducts = async (snapshotId: string, filters: SourcingFilters) => {
  const retryParams = new URLSearchParams({
    type: 'shopping-data',
    snapshotId,
    limit: '60',
    excludeBrands: 'true',
  });
  const { response, data } = await readLiveProductsResponse(retryParams);
  if (!response.ok) throw new Error(data?.error || 'Bright Data snapshot 확인에 실패했습니다.');
  if (data?.pending) throw new Error('Bright Data 수집이 아직 완료되지 않았습니다. 잠시 후 다시 완료 확인을 눌러주세요.');
  if (Array.isArray(data?.products)) return filterLiveProductsByPrice(data.products as CoupangApiProduct[], filters);
  throw new Error('Bright Data 결과에서 상품 데이터를 찾지 못했습니다.');
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
  private async getLiveSeed(filters: SourcingFilters) {
    const baseProducts = await super.searchProducts(filters);
    const liveReadyProducts = baseProducts
      .filter((product) => coupangCategoryUrls[product.category])
      .sort((a, b) => (liveCategoryPriority[a.category] ?? 99) - (liveCategoryPriority[b.category] ?? 99));
    const candidates = filters.query.trim()
      ? baseProducts.filter((product) => normalize(product.name).includes(normalize(filters.query))).slice(0, 1)
      : (liveReadyProducts.length > 0 ? liveReadyProducts : baseProducts).slice(0, 1);
    return candidates[0] || baseProducts[0] || sourcingProducts[0];
  }

  async startRefresh(filters: SourcingFilters, options: FetchLiveOptions = {}): Promise<BrightDataRefreshResult> {
    const seed = await this.getLiveSeed(filters);
    const keyword = filters.query.trim() || seed.name;
    options.onProgress?.(18, 'Bright Data 수집 작업 생성중');
    const result = await startLiveRefresh(keyword, seed.category, filters, options);
    if (result.apiProducts && result.apiProducts.length > 0) {
      const products = buildLiveProducts(seed, result.apiProducts).sort(sortByOpportunity);
      return { ...result, products };
    }
    return result;
  }

  async resumeSnapshot(snapshotId: string, filters: SourcingFilters): Promise<SourcingProduct[]> {
    const seed = await this.getLiveSeed(filters);
    const apiProducts = await fetchSnapshotProducts(snapshotId, filters);
    const products = buildLiveProducts(seed, apiProducts).sort(sortByOpportunity);
    if (products.length === 0) throw new Error('완료된 snapshot에서 표시할 대박 상품을 찾지 못했습니다.');
    return products;
  }

  async searchProducts(filters: SourcingFilters, options: FetchLiveOptions = {}) {
    const seed = await this.getLiveSeed(filters);
    const liveProducts = await Promise.all([seed].map(async (seed, index) => {
      const keyword = filters.query.trim() || seed.name;
      options.onProgress?.(18, 'Bright Data 수집 작업 생성중');
      const apiProducts = await fetchLiveProducts(keyword, seed.category, filters, options);
      options.onProgress?.(98, '상품 URL과 리뷰 데이터 정리중');
      return buildLiveProducts(seed, apiProducts);
    }));
    const usableProducts = liveProducts.flat().filter((product): product is SourcingProduct => Boolean(product));
    if (usableProducts.length === 0) throw new Error('실제 상품 데이터를 아직 가져오지 못했습니다.');
    return usableProducts.sort(sortByOpportunity);
  }
}

export const sourcingProvider = new LiveSourcingProvider();
