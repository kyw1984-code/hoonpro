import { getGrade, getRecommendation } from '../scoring/calculateProductScore';
import {
  computeMarketCohort,
  computeMeasuredScore,
  deriveDifficulty,
  scoreProductInMarket,
  type MarketProductInput,
} from './marketScore';
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

/**
 * 카테고리별 쿠팡 카테고리 URL. 관리자 화면에서 추가/수정할 수 있고,
 * 저장된 값이 있으면 아래 기본값 대신 사용합니다.
 *
 * 카테고리 ID는 쿠팡에서 해당 카테고리를 열었을 때 주소창의
 * https://www.coupang.com/np/categories/{숫자} 에서 그대로 복사하면 됩니다.
 */
const defaultCoupangCategoryUrls: Record<string, string[]> = {
  패션: ['https://www.coupang.com/np/categories/525715'],
  DIY: [
    'https://www.coupang.com/np/categories/520663',
    'https://www.coupang.com/np/categories/184060',
    'https://www.coupang.com/np/categories/401027',
    'https://www.coupang.com/np/categories/497873',
  ],
};

const CATEGORY_URL_STORAGE_KEY = 'hoonpro:sourcing-category-urls:v1';

export const readCategoryUrlConfig = (): Record<string, string[]> => {
  if (typeof window === 'undefined') return { ...defaultCoupangCategoryUrls };
  try {
    const raw = window.localStorage.getItem(CATEGORY_URL_STORAGE_KEY);
    if (!raw) return { ...defaultCoupangCategoryUrls };
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const merged = { ...defaultCoupangCategoryUrls };
    for (const [category, urls] of Object.entries(parsed)) {
      const valid = (Array.isArray(urls) ? urls : []).filter((url) => /^https:\/\/(www\.)?coupang\.com\//i.test(url));
      if (valid.length > 0) merged[category] = valid;
      else delete merged[category];
    }
    return merged;
  } catch {
    return { ...defaultCoupangCategoryUrls };
  }
};

export const saveCategoryUrlConfig = (config: Record<string, string[]>) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CATEGORY_URL_STORAGE_KEY, JSON.stringify(config));
};

export const resetCategoryUrlConfig = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CATEGORY_URL_STORAGE_KEY);
};

export const getDefaultCategoryUrls = () => ({ ...defaultCoupangCategoryUrls });

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
  brand?: string;
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
  /** 아직 수집중일 때 Bright Data가 보고한 상태 */
  pendingStatus?: string;
  diagnostics?: SourcingDiagnostics;
};

type BrightDataRawRefreshResult = {
  snapshotId?: string;
  meta?: Record<string, unknown>;
  apiProducts?: CoupangApiProduct[];
};

/**
 * 리뷰 수에서 누적 판매량을 역산합니다. 리뷰 작성률을 4%로 가정한 값입니다.
 *
 * 이전 구현은 `max(1400 - 순위 * 95, ...)` 형태여서 수집 순위만으로 판매량이
 * 정해졌습니다. 리뷰가 4개인 상품이 "월판매 1,305개"로 표시된 것이 그 결과입니다.
 * 한 번의 수집에는 시간 정보가 없어 월 단위 판매량은 계산할 수 없으므로,
 * 실제 신호인 리뷰 수에서 누적 판매량만 추정합니다.
 */
const REVIEW_TO_SALES_MULTIPLIER = 25;

const estimateSales = (product: CoupangApiProduct) => {
  const reviewCount = Number(product.ratingCount ?? product.reviewCount ?? 0);
  return Math.round(Math.max(0, reviewCount) * REVIEW_TO_SALES_MULTIPLIER);
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

/** 화면에 노출할 최대 상품 수 */
const LIVE_PRODUCT_DISPLAY_LIMIT = 24;

const toMarketInput = (product: CoupangApiProduct, fallbackPrice: number): MarketProductInput => ({
  reviews: Number(product.ratingCount ?? product.reviewCount ?? 0),
  price: Number(product.productPrice) || fallbackPrice,
  delivery: getDeliveryLabel(product.deliveryType),
  brand: product.brand,
});

const buildLiveProducts = (seed: SourcingProduct, apiProducts: CoupangApiProduct[]): SourcingProduct[] => {
  const productsForDisplay = uniqueApiProducts(apiProducts);

  // 경쟁도는 개별 상품이 아니라 수집된 집합 전체에서 계산합니다.
  const cohort = computeMarketCohort(productsForDisplay.map((product) => toMarketInput(product, seed.price)));

  const competitors = productsForDisplay.slice(0, 10).map((product, rank) => ({
    rank: rank + 1,
    name: product.productName,
    productUrl: product.productUrl,
    price: Number(product.productPrice) || seed.price,
    reviews: Number(product.ratingCount ?? product.reviewCount ?? 0),
    estimatedSales: estimateSales(product),
    delivery: getDeliveryLabel(product.deliveryType),
  }));
  const avgReview = cohort.medianReviews;

  return productsForDisplay.slice(0, LIVE_PRODUCT_DISPLAY_LIMIT).map((product, index) => {
    const marketInput = toMarketInput(product, seed.price);
    const opportunity = scoreProductInMarket(marketInput, cohort);
    const measured = computeMeasuredScore(marketInput, cohort);
    const estimatedSales = estimateSales(product);
    const grade = getGrade(measured.total);

    return {
      ...seed,
      id: `live-${String(product.productId || index + 1)}`,
      keyword: product.productName,
      name: product.productName,
      productUrl: product.productUrl,
      price: marketInput.price,
      avgReview: marketInput.reviews,
      rating: Number(product.rating ?? 0),
      delivery: marketInput.delivery,
      // 난이도는 seed가 아니라 이 상품의 리뷰 장벽에서 판정합니다.
      difficulty: deriveDifficulty(marketInput.reviews),
      estimatedSales,
      estimatedRevenue: marketInput.price * estimatedSales,
      coupangProductCount: cohort.sampleSize,
      opportunityScore: opportunity.opportunityScore,
      competitionLevel: cohort.competitionLevel,
      rocketRatio: cohort.rocketRatio,
      brandRatio: cohort.brandConcentration,
      topConcentration: cohort.topConcentration,
      competitors,
      recommendation: `${cohort.confidenceLabel} · 수집 ${cohort.sampleSize}개 기준 · 경쟁도 ${cohort.competitionLevel}/100`,
      score: {
        ...seed.score,
        demand: measured.demand,
        competition: measured.competition,
        review: measured.review,
        margin: measured.margin,
        // 성장성·가격안정성·시즌성·공급가능성은 연결된 데이터 소스가 없어 측정하지 않습니다.
        growth: 0,
        priceStability: 0,
        seasonality: 0,
        supplier: 0,
        total: measured.total,
        grade,
        recommendation: getRecommendation(grade),
      },
      grade,
    };
  });
};

const readLiveProductsResponse = async (params: URLSearchParams) => {
  const response = await fetch(`/api/sourcing?${params.toString()}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Vercel Preview 보호 설정으로 API 응답이 차단되었습니다.');
  }
  const data = await response.json();
  return { response, data };
};

const buildLiveParams = (keyword: string, category: string, filters?: SourcingFilters) => {
  const params = new URLSearchParams({
    keyword,
    limit: '60',
    excludeBrands: 'true',
  });
  if (filters) {
    params.set('minPrice', String(filters.minPrice));
    params.set('maxPrice', String(filters.maxPrice));
  }
  const categoryUrls = readCategoryUrlConfig()[category] || [];
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
  const params = buildLiveParams(keyword, category, filters);
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

/**
 * 수집 결과가 어느 단계에서 줄어드는지 추적합니다.
 * 상품이 몇 개 안 나올 때 원인이 수집인지 필터인지 구분하기 위한 값입니다.
 */
export type SourcingDiagnostics = {
  /** Bright Data가 반환한 원본 레코드 수 */
  rawRecordCount: number;
  /** 이름·URL·가격이 유효한 레코드 수 */
  candidateCount: number;
  /** 품절로 제외된 수 */
  outOfStockCount: number;
  /** 브랜드 제외와 limit 적용 후 서버가 내려준 수 */
  returnedCount: number;
  /** 가격 필터 적용 후 남은 수 */
  priceFilteredCount: number;
  /** 중복 제거 후 최종 수 */
  dedupedCount: number;
  priceRange: { min: number; max: number };
};

const readDiagnostics = (data: any, returned: number, priceFiltered: number, filters: SourcingFilters): SourcingDiagnostics => ({
  rawRecordCount: Number(data?.meta?.rawRecordCount ?? 0),
  candidateCount: Number(data?.meta?.candidateCount ?? 0),
  outOfStockCount: Number(data?.meta?.outOfStockCount ?? 0),
  returnedCount: returned,
  priceFilteredCount: priceFiltered,
  dedupedCount: 0,
  priceRange: { min: filters.minPrice, max: filters.maxPrice },
});

export const describeDiagnostics = (diagnostics: SourcingDiagnostics) => {
  const { rawRecordCount, candidateCount, outOfStockCount, returnedCount, priceFilteredCount, dedupedCount, priceRange } = diagnostics;
  return `수집 ${rawRecordCount} → 유효 ${candidateCount} → 품절제외 -${outOfStockCount} → 브랜드/한도 ${returnedCount} → 가격 ${priceRange.min.toLocaleString('ko-KR')}~${priceRange.max.toLocaleString('ko-KR')}원 ${priceFilteredCount} → 중복제거 ${dedupedCount}`;
};

export type SnapshotOutcome =
  | { status: 'pending'; progressStatus: string; meta?: Record<string, unknown> }
  | { status: 'ready'; apiProducts: CoupangApiProduct[]; diagnostics: SourcingDiagnostics };

export type ResumeOutcome =
  | { status: 'pending'; progressStatus: string; meta?: Record<string, unknown> }
  | { status: 'ready'; products: SourcingProduct[]; diagnostics: SourcingDiagnostics };

/**
 * 완료된 snapshot을 읽어옵니다. 아직 수집중이면 예외를 던지지 않고
 * pending 상태를 그대로 돌려줘서 호출부가 폴링할 수 있게 합니다.
 */
const fetchSnapshotProducts = async (snapshotId: string, filters: SourcingFilters): Promise<SnapshotOutcome> => {
  const params = new URLSearchParams({
    type: 'shopping-data',
    snapshotId,
    limit: '60',
    excludeBrands: 'true',
    minPrice: String(filters.minPrice),
    maxPrice: String(filters.maxPrice),
  });
  const { response, data } = await readLiveProductsResponse(params);

  if (response.status === 202 || data?.pending) {
    return {
      status: 'pending',
      progressStatus: String(data?.progressStatus || 'running'),
      meta: data?.meta,
    };
  }
  if (!response.ok) throw new Error(data?.error || 'Bright Data snapshot 확인에 실패했습니다.');
  if (!Array.isArray(data?.products)) throw new Error('Bright Data 결과에서 상품 데이터를 찾지 못했습니다.');

  const returned = data.products as CoupangApiProduct[];
  const priceFiltered = filterLiveProductsByPrice(returned, filters);
  return {
    status: 'ready',
    apiProducts: priceFiltered,
    diagnostics: readDiagnostics(data, returned.length, priceFiltered.length, filters),
  };
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
  /**
   * 수집에 쓸 seed를 고릅니다. seed의 카테고리가 어떤 쿠팡 카테고리 URL로
   * 수집할지를 결정하므로, 사용자가 고른 카테고리에 URL이 등록돼 있으면
   * 그 카테고리를 우선합니다.
   *
   * 난이도(filters.difficulty)로는 seed를 좁히지 않습니다. 난이도는 수집한
   * 상품마다 리뷰 장벽으로 다시 판정하므로, 여기서 좁히면 한 난이도의
   * 결과만 수집되어 나머지 탭이 비게 됩니다.
   */
  private async getLiveSeed(filters: SourcingFilters) {
    const configured = readCategoryUrlConfig();
    const pool = sourcingProducts.filter((product) => configured[product.category]);

    const bySelectedCategory = pool.filter((product) => product.category === filters.category);
    if (bySelectedCategory.length > 0) return bySelectedCategory[0];

    const query = normalize(filters.query);
    if (query) {
      const byQuery = pool.find((product) => normalize(product.name).includes(query));
      if (byQuery) return byQuery;
    }

    return pool[0] || sourcingProducts[0];
  }

  /**
   * 새 수집 작업을 등록합니다.
   *
   * existingSnapshotId가 있으면 먼저 그 snapshot을 확인합니다. 수집이 1시간씩
   * 걸리는데 버튼을 누를 때마다 새 작업을 만들면, 이미 끝난 결과를 회수하지
   * 못한 채 계속 새 작업만 쌓이고 Bright Data 사용량도 그만큼 낭비됩니다.
   */
  async startRefresh(
    filters: SourcingFilters,
    options: FetchLiveOptions = {},
    existingSnapshotId?: string,
  ): Promise<BrightDataRefreshResult> {
    const seed = await this.getLiveSeed(filters);

    if (existingSnapshotId) {
      options.onProgress?.(20, '진행중인 snapshot을 먼저 확인합니다.');
      const outcome = await this.resumeSnapshot(existingSnapshotId, filters);
      if (outcome.status === 'ready') {
        return { snapshotId: existingSnapshotId, products: outcome.products, diagnostics: outcome.diagnostics };
      }
      return { snapshotId: existingSnapshotId, pendingStatus: outcome.progressStatus, meta: outcome.meta };
    }

    const keyword = filters.query.trim() || seed.name;
    options.onProgress?.(18, 'Bright Data 수집 작업 생성중');
    const result = await startLiveRefresh(keyword, seed.category, filters, options);
    if (result.apiProducts && result.apiProducts.length > 0) {
      const products = buildLiveProducts(seed, result.apiProducts).sort(sortByOpportunity);
      return { ...result, products };
    }
    return result;
  }

  /**
   * 완료된 snapshot을 읽어 상품으로 변환합니다.
   * 아직 수집중이면 pending 상태를 그대로 돌려주고, 완료됐는데 결과가 비면
   * 어느 단계에서 걸러졌는지 진단 문구와 함께 알립니다.
   */
  async resumeSnapshot(snapshotId: string, filters: SourcingFilters): Promise<ResumeOutcome> {
    const seed = await this.getLiveSeed(filters);
    const outcome = await fetchSnapshotProducts(snapshotId, filters);
    if (outcome.status === 'pending') return outcome;

    const products = buildLiveProducts(seed, outcome.apiProducts).sort(sortByOpportunity);
    const diagnostics = { ...outcome.diagnostics, dedupedCount: products.length };
    return { status: 'ready', products, diagnostics };
  }

  async searchProducts(filters: SourcingFilters, options: FetchLiveOptions = {}) {
    // 수집이 1시간 가까이 걸리므로 요청 하나를 붙잡고 기다리지 않습니다.
    // 작업만 등록하고 snapshot ID를 저장한 뒤, 완료 확인/자동 폴링으로 회수합니다.
    const result = await this.startRefresh(filters, options);
    if (result.products && result.products.length > 0) return result.products;
    throw new Error(
      result.snapshotId
        ? `Bright Data 수집을 시작했습니다. 완료까지 1시간 정도 걸리며, 완료되면 자동으로 불러옵니다. (snapshot ${result.snapshotId})`
        : '실제 상품 데이터를 아직 가져오지 못했습니다.',
    );
  }
}

export const sourcingProvider = new LiveSourcingProvider();
