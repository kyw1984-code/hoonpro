import { getToken } from '../auth';
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
 * 아래 ID는 쿠팡 카테고리 페이지의 제목으로 대조해 정리한 값입니다.
 * 쿠팡이 카테고리를 개편하면 달라질 수 있으니, 수집 결과가 카테고리와
 * 맞지 않으면 관리자 화면에서 해당 카테고리를 열어 주소를 바꿔주세요.
 *
 * 이전 기본값의 184060은 DIY로 등록돼 있었지만 실제로는 자동차용품이라,
 * DIY로 수집해도 기어봉·기어노브 같은 차량용품이 나왔습니다.
 *
 * 카테고리 ID는 쿠팡에서 해당 카테고리를 열었을 때 주소창의
 * https://www.coupang.com/np/categories/{숫자} 에서 그대로 복사하면 됩니다.
 */
const defaultCoupangCategoryUrls: Record<string, string[]> = {
  생활: ['https://www.coupang.com/np/categories/450624'],
  주방: ['https://www.coupang.com/np/categories/416452'],
  패션: ['https://www.coupang.com/np/categories/564653'],
  스포츠: ['https://www.coupang.com/np/categories/317778'],
  자동차: ['https://www.coupang.com/np/categories/521977'],
  반려동물: ['https://www.coupang.com/np/categories/452718'],
  육아: ['https://www.coupang.com/np/categories/221934'],
  문구: ['https://www.coupang.com/np/categories/177295'],
  DIY: [
    'https://www.coupang.com/np/categories/510113',
    'https://www.coupang.com/np/categories/184555',
  ],
};

const CATEGORY_URL_STORAGE_KEY = 'hoonpro:sourcing-category-urls:v1';

/**
 * 붙여넣은 쿠팡 주소에서 카테고리 URL을 뽑아냅니다.
 * 쿼리스트링이 붙었거나 m.coupang.com 형태여도 받아들입니다.
 */
export const normalizeCategoryUrl = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const idMatch = trimmed.match(/\/np\/categories\/(\d+)/);
  if (idMatch) return `https://www.coupang.com/np/categories/${idMatch[1]}`;
  // 숫자만 붙여넣은 경우도 카테고리 ID로 받아줍니다.
  if (/^\d{4,}$/.test(trimmed)) return `https://www.coupang.com/np/categories/${trimmed}`;
  if (/^https:\/\/(www\.|m\.)?coupang\.com\//i.test(trimmed)) return trimmed;
  return '';
};

/**
 * 저장된 설정이 있으면 그것만 사용하고, 없으면 기본값을 씁니다.
 *
 * 이전에는 기본값과 저장값을 병합하면서 빈 항목이면 기본값을 지웠는데,
 * 화면에 보이는 목록과 실제 수집 대상이 어긋나 보이기 쉬웠습니다.
 * 저장한 내용이 곧 등록 목록이 되도록 단순하게 바꿉니다.
 */
const sanitizeConfig = (input: unknown): Record<string, string[]> => {
  const config: Record<string, string[]> = {};
  if (!input || typeof input !== 'object') return config;
  for (const [category, urls] of Object.entries(input as Record<string, unknown>)) {
    const valid = (Array.isArray(urls) ? urls : []).map((url) => normalizeCategoryUrl(String(url))).filter(Boolean);
    if (valid.length > 0) config[category] = valid;
  }
  return config;
};

/**
 * 서버에서 불러온 설정을 담아두는 캐시입니다.
 *
 * 설정의 원본은 Supabase지만, 수집 경로 곳곳에서 동기적으로 읽기 때문에
 * 한 번 불러온 값을 여기에 두고 동기 접근을 유지합니다. localStorage는
 * 첫 화면을 그리는 동안 쓰는 임시 사본입니다.
 */
let categoryConfigCache: Record<string, string[]> | null = null;

const readLocalCategoryConfig = (): Record<string, string[]> | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CATEGORY_URL_STORAGE_KEY);
    if (!raw) return null;
    const config = sanitizeConfig(JSON.parse(raw));
    return Object.keys(config).length > 0 ? config : null;
  } catch {
    return null;
  }
};

const writeLocalCategoryConfig = (config: Record<string, string[]>) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CATEGORY_URL_STORAGE_KEY, JSON.stringify(config));
};

/** 동기 접근용. 서버에서 불러오기 전에는 로컬 사본이나 기본값을 씁니다. */
export const readCategoryUrlConfig = (): Record<string, string[]> => {
  if (categoryConfigCache && Object.keys(categoryConfigCache).length > 0) return categoryConfigCache;
  return readLocalCategoryConfig() || { ...defaultCoupangCategoryUrls };
};

/** Supabase에서 카테고리 설정을 불러와 캐시에 채웁니다. */
export const loadCategoryUrlConfig = async (): Promise<Record<string, string[]>> => {
  const token = getToken();
  if (!token) return readCategoryUrlConfig();
  try {
    const response = await fetch('/api/sourcing?type=category-config', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || '카테고리 설정을 불러오지 못했습니다.');

    const config = sanitizeConfig(data?.config);
    if (Object.keys(config).length === 0) {
      // 서버에 아직 아무것도 없으면 기본값을 그대로 씁니다.
      categoryConfigCache = { ...defaultCoupangCategoryUrls };
      return categoryConfigCache;
    }
    categoryConfigCache = config;
    writeLocalCategoryConfig(config);
    return config;
  } catch {
    // 서버를 못 읽어도 화면은 로컬 사본으로 계속 동작하게 둡니다.
    return readCategoryUrlConfig();
  }
};

/** 관리자만 가능. 서버에 저장하고 캐시·로컬 사본을 갱신합니다. */
export const saveCategoryUrlConfig = async (config: Record<string, string[]>): Promise<number> => {
  const token = getToken();
  if (!token) throw new Error('로그인이 필요합니다.');

  const response = await fetch('/api/sourcing?type=category-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ config }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || '카테고리 설정 저장에 실패했습니다.');

  const saved = sanitizeConfig(config);
  categoryConfigCache = saved;
  writeLocalCategoryConfig(saved);
  return Number(data?.saved ?? Object.keys(saved).length);
};

/** 기본값으로 되돌리고 서버에도 반영합니다. */
export const resetCategoryUrlConfig = async (): Promise<void> => {
  if (typeof window !== 'undefined') window.localStorage.removeItem(CATEGORY_URL_STORAGE_KEY);
  categoryConfigCache = { ...defaultCoupangCategoryUrls };
  await saveCategoryUrlConfig(defaultCoupangCategoryUrls).catch(() => undefined);
};

export const getDefaultCategoryUrls = () => ({ ...defaultCoupangCategoryUrls });

export type CoupangCategoryOption = {
  id: string;
  name: string;
  url: string;
};

/**
 * 수집 결과를 Supabase에 관측치로 남깁니다.
 *
 * 한 번의 수집에는 시간 정보가 없어 판매 속도를 알 수 없습니다.
 * 매 수집을 쌓아두면 같은 상품의 리뷰 증가분으로 속도를 낼 수 있고,
 * 그게 "지금 잘 팔리는 상품"을 찾는 유일한 근거가 됩니다.
 */
export const saveSourcingRun = async (input: {
  snapshotId?: string;
  categories: string[];
  products: SourcingProduct[];
}): Promise<{ runId: string; saved: number }> => {
  const token = getToken();
  if (!token) throw new Error('로그인이 필요합니다.');
  if (input.products.length === 0) throw new Error('저장할 상품이 없습니다.');

  const first = input.products[0];
  const cohort = {
    sampleSize: first.coupangProductCount,
    competitionLevel: first.competitionLevel,
    medianReviews: first.avgReview,
    rocketRatio: first.rocketRatio,
    brandConcentration: first.brandRatio,
    topConcentration: first.topConcentration,
    confidenceLabel: first.recommendation,
  };

  const response = await fetch('/api/sourcing?type=save-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      snapshotId: input.snapshotId,
      categories: input.categories,
      cohort,
      products: input.products.map((product) => ({
        // live- 접두사를 떼어 쿠팡 상품 ID를 안정적인 키로 씁니다.
        coupangProductId: product.id.replace(/^live-/, ''),
        name: product.name,
        productUrl: product.productUrl,
        brand: product.brand,
        appCategory: product.category,
        sourceCategoryName: product.sourceCategoryName,
        price: product.price,
        reviews: product.avgReview,
        rating: product.rating,
        delivery: product.delivery,
        opportunityScore: product.opportunityScore,
        competitionLevel: product.competitionLevel,
        aiScore: product.score.total,
        grade: product.grade,
        difficulty: product.difficulty,
      })),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || '수집 이력 저장에 실패했습니다.');
  return data;
};

export type ProductVelocity = {
  coupangProductId: string;
  name: string;
  productUrl?: string;
  price: number;
  delivery?: string;
  sourceCategory?: string;
  observations: number;
  elapsedDays: number;
  reviewGain: number;
  reviewsPerDay: number;
  reviewsPerMonth: number;
  latestReviews: number;
};

export type SourcingHistory = {
  runs: Array<{
    id: string;
    snapshot_id: string | null;
    categories: string[];
    sample_size: number;
    competition_level: number;
    confidence_label: string | null;
    collected_at: string;
  }>;
  runCount: number;
  trackedProducts: number;
  measurableProducts: number;
  velocity: ProductVelocity[];
};

/** 저장된 관측치에서 리뷰 증가 속도를 조회합니다. */
export const fetchSourcingHistory = async (days = 90): Promise<SourcingHistory> => {
  const token = getToken();
  if (!token) throw new Error('로그인이 필요합니다.');
  const response = await fetch(`/api/sourcing?type=history&days=${days}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || '수집 이력 조회에 실패했습니다.');
  return data;
};

/** 쿠팡에서 카테고리 목록을 받아옵니다. 관리자가 번호를 직접 찾지 않아도 되게 합니다. */
export const fetchCoupangCategories = async (): Promise<CoupangCategoryOption[]> => {
  const response = await fetch('/api/sourcing?type=categories');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Vercel Preview 보호 설정으로 API 응답이 차단되었습니다.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || '쿠팡 카테고리 조회에 실패했습니다.');
  return Array.isArray(data?.categories) ? (data.categories as CoupangCategoryOption[]) : [];
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
  brand?: string;
  sourceCategory?: string;
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
const LIVE_PRODUCT_DISPLAY_LIMIT = 150;

/** 서버에서 받아올 상품 수. 난이도 3구간으로 나뉘므로 넉넉히 받습니다. */
const COLLECTION_LIMIT = 250;

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
      // 앱 카테고리 필터와 맞물려야 하므로 category는 seed 값을 유지하고,
      // 쿠팡이 준 실제 분류명은 표시용으로 따로 담습니다.
      sourceCategoryName: product.sourceCategory || '',
      brand: product.brand || '',
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

/**
 * 선택한 카테고리들의 쿠팡 URL을 한 번의 수집에 모두 넣습니다.
 * Bright Data는 input을 여러 개 받으므로, 카테고리마다 따로 1시간씩
 * 돌리지 않고 한 번에 여러 카테고리를 훑을 수 있습니다.
 */
const buildLiveParams = (keyword: string, selectedCategories: string[], filters?: SourcingFilters) => {
  const params = new URLSearchParams({
    keyword,
    limit: String(COLLECTION_LIMIT),
    excludeBrands: 'true',
  });
  if (filters) {
    params.set('minPrice', String(filters.minPrice));
    params.set('maxPrice', String(filters.maxPrice));
  }
  const config = readCategoryUrlConfig();
  const categoryUrls = selectedCategories.flatMap((category) => config[category] || []);
  const uniqueUrls = Array.from(new Set(categoryUrls));
  if (uniqueUrls.length > 0) params.set('categoryUrls', uniqueUrls.join(','));
  params.set('type', 'shopping-data');
  return params;
};

const filterLiveProductsByPrice = (products: CoupangApiProduct[], filters: SourcingFilters) => {
  return products.filter((product) => {
    const price = Number(product.productPrice) || 0;
    return price >= filters.minPrice && price <= filters.maxPrice;
  });
};

const startLiveRefresh = async (keyword: string, selectedCategories: string[], filters: SourcingFilters, options: FetchLiveOptions = {}): Promise<BrightDataRawRefreshResult> => {
  const params = buildLiveParams(keyword, selectedCategories, filters);
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
    limit: String(COLLECTION_LIMIT),
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

  /** URL이 등록돼 있어 실제로 수집 가능한 카테고리 목록입니다. */
  getCollectableCategories(): string[] {
    return Object.keys(readCategoryUrlConfig());
  }

  /**
   * 수집 대상 카테고리를 정합니다. 사용자가 고른 게 있으면 그것만,
   * 없으면 등록된 카테고리 전부를 한 번에 훑습니다.
   */
  private resolveTargetCategories(filters: SourcingFilters): string[] {
    const configured = readCategoryUrlConfig();
    const selected = (filters.categories || []).filter((category) => configured[category]);
    return selected.length > 0 ? selected : Object.keys(configured);
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
    const targetCategories = this.resolveTargetCategories(filters);
    options.onProgress?.(18, `Bright Data 수집 작업 생성중 · 카테고리 ${targetCategories.length}개`);
    const result = await startLiveRefresh(keyword, targetCategories, filters, options);
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
