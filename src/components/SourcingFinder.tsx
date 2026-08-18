import React, { type ReactElement, useMemo, useState } from 'react';
import {
  BarChart3, Bookmark, Calculator, CheckCircle2, ChevronRight, Database,
  Download, FileSpreadsheet, Heart, LineChart, PackageSearch, Search, Settings,
  ShieldAlert, SlidersHorizontal, Sparkles, Target, TrendingUp, Upload,
  WalletCards, Waves, Sun, Coins, Boxes, Users, Zap,
} from 'lucide-react';
import { createMockAiStrategy } from '../lib/sourcing/aiStrategy';
import { providerStatuses, sourcingProducts } from '../lib/sourcing/mockData';
import {
  describeDiagnostics,
  fetchCoupangCategories,
  getDefaultCategoryUrls,
  readCategoryUrlConfig,
  resetCategoryUrlConfig,
  saveCategoryUrlConfig,
  sourcingProvider,
  type BrightDataRefreshResult,
  type CoupangCategoryOption,
} from '../lib/sourcing/providers';
import type { Difficulty, KeywordType, SourcingFilters, SourcingProduct, SourcingStatus } from '../lib/sourcing/types';

type View = 'dashboard' | 'sourcing' | 'results' | 'detail' | 'suppliers' | 'favorites' | 'calculator' | 'admin' | 'settings';
type Segment = '전체' | '급상승' | '블루오션' | '시즌상품' | '고마진' | '신규시장';

const fmt = (value: number) => value.toLocaleString('ko-KR');
const won = (value: number) => `${fmt(value)}원`;
const categories = ['생활', '주방', '패션', '스포츠', '자동차', '반려동물', '육아', '문구', 'DIY', '기타'];
const difficultyOptions: Difficulty[] = ['아마추어', '준프로', '프로'];
const keywordTypes: KeywordType[] = ['블루오션', '급상승', '시즌상품', '신규시장', '고마진', '저경쟁', '리뷰장벽 낮음'];
const statuses: SourcingStatus[] = ['발견', '분석중', '샘플 주문', '소싱 완료', '상품 등록', '판매중', '보류', '실패'];

const sortByOpportunity = (a: SourcingProduct, b: SourcingProduct) => {
  if (b.opportunityScore !== a.opportunityScore) return b.opportunityScore - a.opportunityScore;
  if (b.estimatedSales !== a.estimatedSales) return b.estimatedSales - a.estimatedSales;
  return a.coupangProductCount - b.coupangProductCount;
};

const gradeClass = {
  S: 'bg-red-50 text-red-700 ring-red-200',
  A: 'bg-orange-50 text-orange-700 ring-orange-200',
  B: 'bg-blue-50 text-blue-700 ring-blue-200',
  C: 'bg-slate-100 text-slate-700 ring-slate-200',
  D: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
} as const;

const LIST_ROW_LIMIT = 30;

const deliveryClass: Record<string, string> = {
  '로켓': 'bg-sky-50 text-sky-700 ring-sky-200',
  '판매자로켓': 'bg-violet-50 text-violet-700 ring-violet-200',
  '일반': 'bg-slate-100 text-slate-600 ring-slate-200',
};

function DeliveryBadge({ delivery }: { delivery?: string }) {
  if (!delivery) return <span className="text-xs font-bold text-slate-300">—</span>;
  return (
    <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-black ring-1 ${deliveryClass[delivery] || deliveryClass['일반']}`}>
      {delivery}
    </span>
  );
}

function GradeBadge({ grade }: { grade: keyof typeof gradeClass }) {
  return <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-black ring-1 ${gradeClass[grade]}`}>{grade}등급</span>;
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
      {sub && <p className="mt-1 text-xs font-medium text-slate-400">{sub}</p>}
    </div>
  );
}

function SectionTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <div>
      <h3 className="text-lg font-black text-slate-950">{title}</h3>
      {desc && <p className="mt-1 text-sm font-medium text-slate-500">{desc}</p>}
    </div>
  );
}

function SeasonBars({ product }: { product: SourcingProduct }) {
  const max = Math.max(...product.seasonality.map((point) => point.value));
  return (
    <div className="rounded-lg border border-amber-100 bg-amber-50 p-4">
      <div className="flex h-28 items-end gap-1">
        {product.seasonality.map((point) => (
          <div key={point.month} className="flex flex-1 flex-col items-center gap-1">
            <div className="w-full rounded-t bg-amber-500" style={{ height: `${Math.max(12, (point.value / max) * 100)}%` }} />
            <span className="text-[10px] font-black text-amber-700">{point.month}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs font-black text-amber-700">현재 시즌 진입 단계 · 예상 피크 {product.peakInDays}일 후</p>
    </div>
  );
}

const getFilteredProducts = (products: SourcingProduct[], filters: SourcingFilters, segment: Segment) => {
  const query = filters.query.trim().toLowerCase();
  return products
    .filter((product) => product.difficulty === filters.difficulty)
    .filter((product) => filters.category === '기타' || product.category === filters.category || Boolean(query))
    .filter((product) => product.price >= filters.minPrice && product.price <= filters.maxPrice)
    .filter((product) => product.avgReview <= filters.maxReview)
    .filter((product) => filters.keywordTypes.length === 0 || filters.keywordTypes.some((type) => product.keywordTypes.includes(type)))
    .filter((product) => segment === '전체' || product.keywordTypes.includes(segment as KeywordType))
    .filter((product) => !query || product.name.toLowerCase().includes(query) || product.category.toLowerCase().includes(query))
    .sort(sortByOpportunity);
};

// 상품 필터링/중복제거 로직이 바뀌면 키 버전을 올려 이전 캐시를 무효화합니다.
const SOURCING_CACHE_KEY = 'hoonpro:sourcing-cache:v4';
const SOURCING_CACHE_ENABLED_KEY = 'hoonpro:sourcing-cache-enabled';
const PENDING_SOURCING_KEY = 'hoonpro:sourcing-pending:v4';

type CachedSourcing = {
  savedAt: number;
  products: SourcingProduct[];
};

type PendingSourcing = {
  snapshotId: string;
  startedAt: number;
  meta?: Record<string, unknown>;
};

const readSourcingCache = (): CachedSourcing | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SOURCING_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSourcing;
    return Array.isArray(parsed.products) && parsed.products.length > 0 ? parsed : null;
  } catch {
    return null;
  }
};

const readPendingSourcing = (): PendingSourcing | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PENDING_SOURCING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSourcing;
    return parsed.snapshotId ? parsed : null;
  } catch {
    return null;
  }
};

export function SourcingFinder() {
  const [view, setView] = useState<View>('dashboard');
  const [segment, setSegment] = useState<Segment>('전체');
  const [filters, setFilters] = useState<SourcingFilters>({
    difficulty: '아마추어',
    category: '기타',
    minPrice: 10000,
    maxPrice: 50000,
    maxReview: 100000,
    keywordTypes: [],
    categories: [],
    query: '',
  });
  const [selectedProductId, setSelectedProductId] = useState(sourcingProducts[0].id);
  const [favorites, setFavorites] = useState<string[]>(sourcingProducts.slice(0, 5).map((product) => product.id));
  const [statusById, setStatusById] = useState<Record<string, SourcingStatus>>({});
  const [calcProductId, setCalcProductId] = useState(sourcingProducts[0].id);
  const [calcSupply, setCalcSupply] = useState(sourcingProducts[0].supplierCost);
  const [calcAd, setCalcAd] = useState(10);
  const [calcOther, setCalcOther] = useState(500);
  const [uploadedRows, setUploadedRows] = useState(0);
  const [hasRunSourcing, setHasRunSourcing] = useState(false);
  const [products, setProducts] = useState<SourcingProduct[]>(sourcingProducts);
  const [isSourcingLoading, setIsSourcingLoading] = useState(false);
  const [sourcingProgress, setSourcingProgress] = useState(0);
  const [sourcingMessage, setSourcingMessage] = useState('실제 데이터 Provider 대기 중');
  const [cacheEnabled, setCacheEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(SOURCING_CACHE_ENABLED_KEY) !== 'off';
  });
  const [cacheInfo, setCacheInfo] = useState<CachedSourcing | null>(() => readSourcingCache());
  const [pendingSourcing, setPendingSourcing] = useState<PendingSourcing | null>(() => readPendingSourcing());
  const [coupangCategories, setCoupangCategories] = useState<CoupangCategoryOption[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [categoryTarget, setCategoryTarget] = useState<string>('DIY');
  const [categoryConfigVersion, setCategoryConfigVersion] = useState(0);
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryUrlDraft, setCategoryUrlDraft] = useState<Record<string, string>>(() => {
    const config = readCategoryUrlConfig();
    return Object.fromEntries(categories.map((category) => [category, (config[category] || []).join('\n')]));
  });

  const saveCategoryUrls = () => {
    const next: Record<string, string[]> = {};
    for (const [category, raw] of Object.entries(categoryUrlDraft)) {
      const urls = String(raw).split('\n').map((url) => url.trim()).filter(Boolean);
      if (urls.length > 0) next[category] = urls;
    }
    const invalid = Object.values(next).flat().filter((url) => !/^https:\/\/(www\.)?coupang\.com\//i.test(url));
    if (invalid.length > 0) {
      setSourcingMessage(`쿠팡 주소가 아닌 항목이 있어 저장하지 않았습니다: ${invalid[0]}`);
      return;
    }
    saveCategoryUrlConfig(next);
    setCategoryConfigVersion((v) => v + 1);
    const saved = readCategoryUrlConfig();
    setCategoryUrlDraft(Object.fromEntries(categories.map((category) => [category, (saved[category] || []).join('\n')])));
    setSourcingMessage(`수집 카테고리를 저장했습니다. 등록된 카테고리 ${Object.keys(saved).length}개.`);
  };

  /** URL이 등록돼 실제로 수집 가능한 카테고리. 관리자 저장 시 갱신됩니다. */
  const collectableCategories = useMemo(
    () => sourcingProvider.getCollectableCategories(),
    [categoryConfigVersion],
  );

  const toggleCollectCategory = (category: string) => {
    setFilters((current) => {
      const selected = current.categories || [];
      return {
        ...current,
        categories: selected.includes(category)
          ? selected.filter((item) => item !== category)
          : [...selected, category],
      };
    });
  };

  const loadCoupangCategories = async () => {
    setIsLoadingCategories(true);
    setSourcingMessage('쿠팡 카테고리 목록을 불러오는 중입니다.');
    try {
      const options = await fetchCoupangCategories();
      setCoupangCategories(options);
      setSourcingMessage(`쿠팡 카테고리 ${options.length}개를 불러왔습니다. 추가할 카테고리를 눌러주세요.`);
    } catch (error) {
      setCoupangCategories([]);
      setSourcingMessage(error instanceof Error ? error.message : '쿠팡 카테고리 조회에 실패했습니다.');
    } finally {
      setIsLoadingCategories(false);
    }
  };

  /** 불러온 쿠팡 카테고리를 선택한 앱 카테고리 입력칸에 한 줄 추가합니다. */
  const appendCategoryUrl = (option: CoupangCategoryOption) => {
    setCategoryUrlDraft((current) => {
      const existing = String(current[categoryTarget] || '');
      const lines = existing.split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines.includes(option.url)) return current;
      return { ...current, [categoryTarget]: [...lines, option.url].join('\n') };
    });
    setSourcingMessage(`${categoryTarget}에 "${option.name}" 카테고리를 추가했습니다. 저장을 눌러야 반영됩니다.`);
  };

  const restoreDefaultCategoryUrls = () => {
    resetCategoryUrlConfig();
    setCategoryConfigVersion((v) => v + 1);
    const defaults = getDefaultCategoryUrls();
    setCategoryUrlDraft(Object.fromEntries(categories.map((category) => [category, (defaults[category] || []).join('\n')])));
    setSourcingMessage('수집 카테고리를 기본값으로 되돌렸습니다.');
  };

  const filteredProducts = useMemo(() => {
    return getFilteredProducts(products, filters, segment);
  }, [filters, products, segment]);

  const resultSummary = useMemo(() => {
    const totalSales = filteredProducts.reduce((sum, product) => sum + product.estimatedSales, 0);
    const totalReviews = filteredProducts.reduce((sum, product) => sum + product.avgReview, 0);
    const totalRevenue = filteredProducts.reduce((sum, product) => sum + product.estimatedRevenue, 0);
    const totalPrice = filteredProducts.reduce((sum, product) => sum + product.price, 0);
    const avgPrice = filteredProducts.length ? Math.round((totalPrice / filteredProducts.length) / 100) * 100 : 0;
    const lowCompetitionCount = filteredProducts.filter((product) => product.competitionLevel <= 40).length;

    return {
      avgPrice,
      lowCompetitionCount,
      productCount: filteredProducts.length,
      totalRevenue,
      totalReviews,
      totalSales,
    };
  }, [filteredProducts]);

  const selectedProduct = products.find((product) => product.id === selectedProductId) || products[0] || sourcingProducts[0];
  const aiStrategy = createMockAiStrategy(selectedProduct);
  const calcProduct = products.find((product) => product.id === calcProductId) || sourcingProducts.find((product) => product.id === calcProductId) || sourcingProducts[0];
  const coupangFee = Math.round(calcProduct.price * 0.12);
  const adCost = Math.round(calcProduct.price * (calcAd / 100));
  const totalCost = calcSupply + calcProduct.shippingCost + coupangFee + adCost + calcOther;
  const netProfit = calcProduct.price - totalCost;
  const netMargin = Math.round((netProfit / calcProduct.price) * 100);

  const setFilter = <K extends keyof SourcingFilters>(key: K, value: SourcingFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const openDetail = (product: SourcingProduct) => {
    setSelectedProductId(product.id);
    setCalcProductId(product.id);
    setCalcSupply(product.supplierCost);
    setView('detail');
  };

  const applyProducts = (nextProducts: SourcingProduct[], nextSegment: Segment) => {
    setProducts(nextProducts);
    const nextFiltered = getFilteredProducts(nextProducts, filters, nextSegment);
    const first = nextFiltered[0] || nextProducts[0] || sourcingProducts[0];
    setSegment(nextSegment);
    setSelectedProductId(first.id);
    setCalcProductId(first.id);
    setCalcSupply(first.supplierCost);
    setHasRunSourcing(true);
    setView('results');
  };

  const saveSourcingCache = (nextProducts: SourcingProduct[]) => {
    if (!cacheEnabled || typeof window === 'undefined' || nextProducts.length === 0) return;
    const nextCache = { savedAt: Date.now(), products: nextProducts };
    window.localStorage.setItem(SOURCING_CACHE_KEY, JSON.stringify(nextCache));
    setCacheInfo(nextCache);
  };

  const savePendingSourcing = (snapshotId: string, meta?: Record<string, unknown>) => {
    if (typeof window === 'undefined' || !snapshotId) return;
    const nextPending = { snapshotId, startedAt: Date.now(), meta };
    window.localStorage.setItem(PENDING_SOURCING_KEY, JSON.stringify(nextPending));
    setPendingSourcing(nextPending);
  };

  const clearPendingSourcing = () => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(PENDING_SOURCING_KEY);
    setPendingSourcing(null);
  };

  const clearSourcingCache = () => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(SOURCING_CACHE_KEY);
    setCacheInfo(null);
    setSourcingMessage('관리자가 소싱 캐시를 비웠습니다.');
  };

  const updateCacheEnabled = (enabled: boolean) => {
    setCacheEnabled(enabled);
    if (typeof window !== 'undefined') window.localStorage.setItem(SOURCING_CACHE_ENABLED_KEY, enabled ? 'on' : 'off');
    setSourcingMessage(enabled ? '소싱 캐시 사용이 켜졌습니다.' : '소싱 캐시 사용이 꺼졌습니다.');
  };

  const importSnapshotToCache = async (snapshotId: string, silent = false) => {
    if (!silent) {
      setIsSourcingLoading(true);
      setSourcingProgress(72);
      setSourcingMessage('Bright Data snapshot 완료 여부를 확인중입니다.');
    }
    try {
      const outcome = await sourcingProvider.resumeSnapshot(snapshotId, filters);

      if (outcome.status === 'pending') {
        setSourcingMessage(
          `Bright Data 수집이 아직 진행중입니다 (${outcome.progressStatus}). 완료까지 1시간 정도 걸리며, 완료되면 자동으로 불러옵니다.`,
        );
        return false;
      }

      setSourcingProgress(100);
      clearPendingSourcing();

      if (outcome.products.length === 0) {
        // 수집은 끝났는데 표시할 게 없다면 어느 단계에서 걸러졌는지 그대로 보여줍니다.
        setSourcingMessage(`수집은 완료됐지만 필터를 통과한 상품이 없습니다. ${describeDiagnostics(outcome.diagnostics)}`);
        return true;
      }

      saveSourcingCache(outcome.products);
      applyProducts(outcome.products, '전체');
      setSourcingMessage(`Bright Data 결과 ${outcome.products.length}개를 캐시에 저장했습니다. ${describeDiagnostics(outcome.diagnostics)}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bright Data snapshot 확인에 실패했습니다.';
      setSourcingMessage(message);
      return false;
    } finally {
      if (!silent) {
        setIsSourcingLoading(false);
        window.setTimeout(() => setSourcingProgress(0), 900);
      }
    }
  };

  const handleRefreshResult = (result: BrightDataRefreshResult) => {
    if (result.products && result.products.length > 0) {
      saveSourcingCache(result.products);
      clearPendingSourcing();
      applyProducts(result.products, '전체');
      const detail = result.diagnostics ? ` ${describeDiagnostics(result.diagnostics)}` : '';
      setSourcingMessage(`Bright Data 결과 ${result.products.length}개를 캐시에 저장했습니다.${detail}`);
      return;
    }
    if (result.snapshotId) {
      savePendingSourcing(result.snapshotId, result.meta);
      setSourcingMessage(
        result.pendingStatus
          ? `진행중인 snapshot ${result.snapshotId} 이(가) 아직 수집중입니다 (${result.pendingStatus}). 완료되면 자동으로 불러옵니다.`
          : `Bright Data 수집을 시작했습니다. 완료까지 1시간 정도 걸리며, 완료되면 자동으로 불러옵니다. (snapshot ${result.snapshotId})`,
      );
      return;
    }
    setSourcingMessage('Bright Data 수집 요청은 완료됐지만 snapshot ID를 받지 못했습니다.');
  };

  /**
   * 진행중인 snapshot이 있으면 새 작업을 만들지 않고 그것부터 확인합니다.
   * 수집이 1시간씩 걸려서, 버튼을 누를 때마다 새로 시작하면 이미 끝난 결과를
   * 회수하지 못한 채 사용량만 계속 쓰게 됩니다.
   */
  const startAdminRefresh = async () => {
    setIsSourcingLoading(true);
    setSourcingProgress(12);
    setSourcingMessage(pendingSourcing ? '진행중인 snapshot을 먼저 확인합니다.' : 'Bright Data 수집 작업을 등록중입니다.');
    try {
      const result = await sourcingProvider.startRefresh(
        filters,
        {
          onProgress: (progress, message) => {
            setSourcingProgress(progress);
            setSourcingMessage(message);
          },
          onSnapshot: (snapshotId, meta) => savePendingSourcing(snapshotId, meta),
        },
        pendingSourcing?.snapshotId,
      );
      setSourcingProgress(result.products?.length ? 100 : 32);
      handleRefreshResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bright Data 수집 작업 등록에 실패했습니다.';
      setSourcingMessage(message);
    } finally {
      setIsSourcingLoading(false);
      window.setTimeout(() => setSourcingProgress(0), 900);
    }
  };

  /** 진행중인 snapshot을 1분마다 자동 확인해서 완료되면 바로 회수합니다. */
  React.useEffect(() => {
    if (!pendingSourcing) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (cancelled || isSourcingLoading) return;
      await importSnapshotToCache(pendingSourcing.snapshotId, true);
    }, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSourcing?.snapshotId, isSourcingLoading]);

  /** 새 snapshot을 강제로 시작합니다. 진행중인 작업은 버려집니다. */
  const forceNewSnapshot = async () => {
    clearPendingSourcing();
    setIsSourcingLoading(true);
    setSourcingProgress(12);
    setSourcingMessage('새 Bright Data 수집 작업을 등록중입니다.');
    try {
      const result = await sourcingProvider.startRefresh(filters, {
        onProgress: (progress, message) => {
          setSourcingProgress(progress);
          setSourcingMessage(message);
        },
        onSnapshot: (snapshotId, meta) => savePendingSourcing(snapshotId, meta),
      });
      handleRefreshResult(result);
    } catch (error) {
      setSourcingMessage(error instanceof Error ? error.message : 'Bright Data 수집 작업 등록에 실패했습니다.');
    } finally {
      setIsSourcingLoading(false);
      window.setTimeout(() => setSourcingProgress(0), 900);
    }
  };

  const runSourcing = async () => {
    const cached = cacheEnabled ? readSourcingCache() : null;
    if (cached) {
      setCacheInfo(cached);
      applyProducts(cached.products, '전체');
      setSourcingMessage(`캐시된 Bright Data 결과 ${cached.products.length}개를 즉시 표시했습니다. 저장 ${new Date(cached.savedAt).toLocaleString('ko-KR')}`);
      return;
    }
    const pending = readPendingSourcing();
    if (pending) {
      setPendingSourcing(pending);
      await importSnapshotToCache(pending.snapshotId);
      return;
    }
    setIsSourcingLoading(true);
    setSourcingProgress(8);
    setHasRunSourcing(false);
    setProducts([]);
    setView('dashboard');
    setSourcingMessage('캐시된 대박 상품이 없습니다. 관리자에서 실시간 강제 갱신을 먼저 실행해주세요.');
    setIsSourcingLoading(false);
    window.setTimeout(() => setSourcingProgress(0), 900);
  };

  const runSourcingBySegment = async (nextSegment: Segment) => {
    const cached = cacheEnabled ? readSourcingCache() : null;
    if (cached) {
      setCacheInfo(cached);
      applyProducts(cached.products, nextSegment);
      setSourcingMessage(`캐시된 Bright Data 결과 ${cached.products.length}개를 즉시 표시했습니다. 저장 ${new Date(cached.savedAt).toLocaleString('ko-KR')}`);
      return;
    }
    const pending = readPendingSourcing();
    if (pending) {
      setPendingSourcing(pending);
      await importSnapshotToCache(pending.snapshotId);
      return;
    }
    setSegment(nextSegment);
    setIsSourcingLoading(true);
    setSourcingProgress(8);
    setHasRunSourcing(false);
    setProducts([]);
    setView('dashboard');
    setSourcingMessage('캐시된 대박 상품이 없습니다. 관리자에서 실시간 강제 갱신을 먼저 실행해주세요.');
    setIsSourcingLoading(false);
    window.setTimeout(() => setSourcingProgress(0), 900);
  };

  const runLiveSourcingForDebug = async () => {
    setIsSourcingLoading(true);
    setSourcingProgress(8);
    setHasRunSourcing(false);
    setProducts([]);
    setView('dashboard');
    setSourcingMessage('쿠팡 실제 상품 데이터를 불러오는 중입니다.');
    try {
      const liveProducts = await sourcingProvider.searchProducts(filters, { onProgress: (progress, message) => {
        setSourcingProgress(progress);
        setSourcingMessage(message);
      }, onSnapshot: (snapshotId, meta) => savePendingSourcing(snapshotId, meta) });
      setSourcingProgress(100);
      saveSourcingCache(liveProducts);
      clearPendingSourcing();
      applyProducts(liveProducts, '전체');
      setSourcingMessage(liveProducts.some((product) => product.id.startsWith('live-')) ? 'Bright Data Coupang Scraper로 수집한 실제 쿠팡 상품 데이터입니다.' : '실제 API 연결 실패로 mock fallback을 표시합니다.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '실제 데이터 분석이 아직 완료되지 않았습니다.';
      setProducts([]);
      setHasRunSourcing(false);
      setSourcingMessage(message);
    } finally {
      setIsSourcingLoading(false);
      window.setTimeout(() => setSourcingProgress(0), 900);
    }
  };

  const toggleType = (type: KeywordType) => {
    setFilter('keywordTypes', filters.keywordTypes.includes(type) ? filters.keywordTypes.filter((item) => item !== type) : [...filters.keywordTypes, type]);
  };

  const toggleFavorite = (id: string) => {
    setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const exportCsv = () => {
    const rows = [['상품명', '등급', '기회점수', 'AI점수', '누적판매추정', '수집표본', '누적매출추정', '리뷰수', '예상마진'], ...filteredProducts.map((product) => [
      product.name,
      product.grade,
      String(product.opportunityScore),
      String(product.score.total),
      String(product.estimatedSales),
      String(product.coupangProductCount),
      String(product.estimatedRevenue),
      String(product.avgReview),
      `${Math.round(((product.price - product.supplierCost - product.shippingCost - product.price * 0.12) / product.price) * 100)}%`,
    ])];
    const blob = new Blob(['\ufeff' + rows.map((row) => row.join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '훈프로-AI-소싱분석기.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const onUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadedRows(Math.max(1, Math.round(file.size / 180)));
  };

  const nav = [
    ['dashboard', BarChart3, '대시보드'],
    ['sourcing', Sparkles, 'AI 훈프로'],
    ['results', LineChart, '상품분석'],
    ['suppliers', Boxes, '소싱상품'],
    ['favorites', Heart, '관심상품'],
    ['calculator', Calculator, '마진계산기'],
    ['admin', Users, '관리자'],
    ['settings', Settings, '설정'],
  ] as const;

  const segmentButtons = [
    ['전체', Target], ['급상승', TrendingUp], ['블루오션', Waves], ['시즌상품', Sun], ['고마진', Coins], ['신규시장', Zap],
  ] as const;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="flex min-h-screen">
        <aside className="sticky top-16 h-[calc(100vh-4rem)] w-64 border-r border-slate-200 bg-white px-4 py-6">
          <div className="mb-7">
            <p className="text-xs font-black text-blue-600">훈프로 AI 소싱분석기</p>
            <h2 className="mt-1 text-lg font-black tracking-tight">AI 상품 소싱 시스템</h2>
          </div>
          <nav className="space-y-1">
            {nav.map(([key, Icon, label]) => (
              <button key={label} onClick={() => setView(key)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition ${view === key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 px-8 py-7">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-black tracking-tight">훈프로 AI 소싱분석기</h1>
              <p className="mt-1 text-sm font-medium text-slate-500">상품 발굴부터 소싱, 마진, 판매전략까지 한 화면 흐름으로 확인합니다.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-100"><Download className="h-4 w-4" />CSV</button>
              <button onClick={runSourcing} disabled={isSourcingLoading} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"><Sparkles className="h-4 w-4" />{isSourcingLoading ? '실제 데이터 분석중' : 'AI 소싱 시작'}</button>
            </div>
          </div>

          {view === 'dashboard' && (
            <section className="space-y-6">
              <div className="grid grid-cols-4 gap-4">
                <MetricCard label="오늘 분석 상품" value="182,431" sub="mock + provider 구조" />
                <MetricCard label="발견 키워드" value="1,283" sub="급상승/시즌 포함" />
                <MetricCard label="S등급 상품" value={`${sourcingProducts.filter((product) => product.grade === 'S').length}`} sub="90점 이상" />
                <MetricCard label="신규 급상승" value="38" sub="30일 성장률 기준" />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <SectionTitle title="판매 난이도 선택" desc="셀러 레벨을 고르면 그 조건에 맞는 소싱 키워드를 찾아드립니다." />
                <div className="mt-5 grid grid-cols-3 gap-3">
                  {difficultyOptions.map((item) => (
                    <button key={item} onClick={() => setFilter('difficulty', item)} className={`rounded-lg border px-5 py-5 text-left transition ${filters.difficulty === item ? 'border-blue-600 bg-blue-50 text-blue-800 ring-1 ring-blue-200' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-slate-50'}`}>
                      <span className="text-xl font-black">{item}</span>
                      <span className="mt-2 block text-sm font-bold text-slate-500">{item === '아마추어' ? '리뷰 장벽 낮은 저위험 상품' : item === '준프로' ? '마진과 성장성이 균형 잡힌 상품' : '경쟁까지 감수하는 고수익 상품'}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <SectionTitle
                    title="수집할 카테고리 선택"
                    desc="선택한 카테고리를 한 번의 수집으로 함께 훑습니다. 아무것도 고르지 않으면 등록된 카테고리를 모두 수집합니다."
                  />
                  {collectableCategories.length === 0 ? (
                    <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                      등록된 카테고리가 없습니다. 관리자 탭의 “수집 카테고리 관리”에서 먼저 추가해주세요.
                    </p>
                  ) : (
                    <>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {collectableCategories.map((category) => {
                          const selected = (filters.categories || []).includes(category);
                          return (
                            <button
                              key={category}
                              onClick={() => toggleCollectCategory(category)}
                              className={`rounded-lg px-4 py-2 text-sm font-black ring-1 transition ${selected ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-600 ring-slate-200 hover:ring-blue-300'}`}
                            >
                              {selected ? '✓ ' : ''}{category}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-3 text-xs font-bold text-slate-500">
                        {(filters.categories || []).length > 0
                          ? `${(filters.categories || []).length}개 카테고리를 수집합니다.`
                          : `전체 ${collectableCategories.length}개 카테고리를 수집합니다.`}
                        {' '}카테고리를 늘릴수록 상품 수와 난이도 분포가 넓어집니다.
                      </p>
                    </>
                  )}
                </div>
                <div className={`mt-4 overflow-hidden rounded-lg border px-5 py-4 transition ${isSourcingLoading ? 'border-blue-200 bg-blue-50 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.08)]' : 'border-transparent bg-slate-50'}`}>
                  {isSourcingLoading && (
                    <div className="mb-4 h-2 overflow-hidden rounded-full bg-white">
                      <div className="h-full rounded-full bg-blue-600 transition-all duration-700 ease-out" style={{ width: `${sourcingProgress}%` }} />
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-black text-slate-950">{isSourcingLoading ? `${sourcingProgress}% 실제 데이터 분석중` : `${filters.difficulty} 기준으로 분석 대기 중`}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">{isSourcingLoading || sourcingMessage !== '실제 데이터 Provider 대기 중' ? sourcingMessage : '시작 전에는 추천 키워드를 숨겨두고, 실행 후 결과 화면에서 공개합니다.'}</p>
                  </div>
                  <button onClick={runSourcing} disabled={isSourcingLoading} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"><Sparkles className="h-4 w-4" />{isSourcingLoading ? '실제 데이터 분석중' : '소싱 시작'}</button>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-6 gap-3">
                {segmentButtons.slice(1).map(([label, Icon]) => (
                  <button key={label} onClick={() => runSourcingBySegment(label)} disabled={isSourcingLoading} className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-blue-200 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60">
                    <Icon className="h-5 w-5 text-blue-600" />
                    <p className="mt-3 text-sm font-black">{label}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">클릭 시 바로 소싱</p>
                  </button>
                ))}
              </div>
            </section>
          )}

          {view === 'sourcing' && (
            <section className="grid grid-cols-[360px_1fr] gap-5">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center gap-2"><SlidersHorizontal className="h-5 w-5 text-blue-600" /><SectionTitle title="검색 조건" /></div>
                <div className="space-y-5">
                  <label className="block"><span className="text-xs font-black text-slate-500">키워드</span><div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"><Search className="h-4 w-4 text-slate-400" /><input value={filters.query} onChange={(event) => setFilter('query', event.target.value)} placeholder="예: 안경김서림 방지 냉감 마스크" className="w-full bg-transparent text-sm font-bold outline-none" /></div></label>
                  <div><p className="text-xs font-black text-slate-500">판매 난이도</p><div className="mt-2 grid grid-cols-3 gap-2">{difficultyOptions.map((item) => <button key={item} onClick={() => setFilter('difficulty', item)} className={`rounded-lg px-3 py-2 text-sm font-black ${filters.difficulty === item ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{item}</button>)}</div></div>
                  <label className="block"><span className="text-xs font-black text-slate-500">카테고리</span><select value={filters.category} onChange={(event) => setFilter('category', event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none">{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <div className="grid grid-cols-2 gap-3"><label><span className="text-xs font-black text-slate-500">최소 판매가</span><input type="number" value={filters.minPrice} onChange={(event) => setFilter('minPrice', Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" /></label><label><span className="text-xs font-black text-slate-500">최대 판매가</span><input type="number" value={filters.maxPrice} onChange={(event) => setFilter('maxPrice', Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" /></label></div>
                  <label className="block"><span className="text-xs font-black text-slate-500">최대 리뷰</span><select value={filters.maxReview} onChange={(event) => setFilter('maxReview', Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none">{[100, 300, 500, 1000, 5000, 100000].map((item) => <option key={item} value={item}>{item >= 100000 ? '제한 없음' : `${fmt(item)}개`}</option>)}</select></label>
                  <div><p className="text-xs font-black text-slate-500">키워드 유형</p><div className="mt-2 grid grid-cols-2 gap-2">{keywordTypes.map((type) => <button key={type} onClick={() => toggleType(type)} className={`rounded-lg px-3 py-2 text-left text-xs font-black ring-1 ${filters.keywordTypes.includes(type) ? 'bg-orange-50 text-orange-700 ring-orange-200' : 'bg-white text-slate-500 ring-slate-200'}`}>{filters.keywordTypes.includes(type) ? '선택됨 · ' : ''}{type}</button>)}</div></div>
                  <button onClick={runSourcing} disabled={isSourcingLoading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"><Sparkles className="h-4 w-4" />{isSourcingLoading ? '실제 데이터 분석중' : 'AI 훈프로 찾기'}</button>
                </div>
              </div>
              <div className="space-y-5">
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <SectionTitle title="분석 대기" desc="조건을 정한 뒤 AI 훈프로 찾기를 누르면 추천 키워드가 표시됩니다." />
                  <div className="mt-5 grid h-48 place-items-center rounded-lg bg-slate-50 text-center">
                    <div>
                      <PackageSearch className="mx-auto h-8 w-8 text-blue-600" />
                      <p className="mt-3 text-sm font-black text-slate-700">{filters.difficulty} 기준 조건 설정 중</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <SectionTitle title="CSV / Excel 업로드 분석" desc="V1에서는 업로드 파일을 mock 후보와 매칭하는 흐름까지 제공합니다." />
                  <label className="mt-4 flex cursor-pointer items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm font-black text-slate-600 hover:bg-blue-50">
                    <FileSpreadsheet className="h-5 w-5 text-blue-600" />
                    파일 선택 후 업로드 분석
                    <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onUpload} />
                  </label>
                  {uploadedRows > 0 && <p className="mt-3 text-sm font-bold text-blue-700">업로드 데이터 {uploadedRows}행을 분석 대기열에 추가했습니다. 현재 Preview에서는 mock matching으로 처리됩니다.</p>}
                </div>
              </div>
            </section>
          )}

          {view === 'results' && (
            <section className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <SectionTitle title={`${filters.difficulty} 추천 키워드 TOP ${hasRunSourcing ? filteredProducts.length : 0}`} desc={hasRunSourcing ? sourcingMessage : '대시보드에서 난이도를 선택하고 소싱 시작을 눌러주세요.'} />
                <div className="flex gap-2">{segmentButtons.map(([label, Icon]) => <button key={label} onClick={() => setSegment(label)} className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-black ${segment === label ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}><Icon className="h-3.5 w-3.5" />{label}</button>)}</div>
              </div>
              {hasRunSourcing ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                    <MetricCard label="총판매량" value={`${fmt(resultSummary.totalSales)}개`} sub="월 판매량 추정 합산" />
                    <MetricCard label="총리뷰수" value={fmt(resultSummary.totalReviews)} sub="상위권 리뷰 장벽 합산" />
                    <MetricCard label="상품수" value={`${fmt(resultSummary.productCount)}개`} sub={`저경쟁 ${fmt(resultSummary.lowCompetitionCount)}개`} />
                    <MetricCard label="평균가" value={won(resultSummary.avgPrice)} sub="추천 키워드 평균 판매가" />
                    <MetricCard label="누적 매출 추정" value={`${fmt(Math.round(resultSummary.totalRevenue / 10000))}만원`} sub="리뷰 기반 환산" />
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <SectionTitle title="대박 상품 리스트" desc={`기회점수가 높은 순서 Top ${Math.min(LIST_ROW_LIMIT, filteredProducts.length)}입니다. 경쟁도는 수집된 표본 전체에서 계산하고, 리뷰가 없는 상품은 수요 미검증으로 감점합니다.`} />
                      <span className="rounded-md bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">표본 {fmt(filteredProducts[0]?.coupangProductCount || 0)}개 · 경쟁도 {filteredProducts[0]?.competitionLevel ?? 0}</span>
                    </div>
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[860px] text-sm">
                        <thead className="bg-slate-50 text-xs font-black text-slate-500">
                          <tr>
                            <th className="px-3 py-3 text-left">상품명</th>
                            <th className="px-3 py-3 text-center">배송</th>
                            <th className="px-3 py-3 text-center">난이도</th>
                            <th className="px-3 py-3 text-right">가격</th>
                            <th className="px-3 py-3 text-right">리뷰</th>
                            <th className="px-3 py-3 text-right">누적판매</th>
                            <th className="px-3 py-3 text-right">누적매출</th>
                            <th className="px-3 py-3 text-center">AI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredProducts.slice(0, LIST_ROW_LIMIT).map((product, index) => (
                            <tr key={product.id} className="border-b border-slate-100 hover:bg-blue-50/60">
                              <td className="px-3 py-4">
                                <div className="flex items-center gap-3">
                                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-slate-100 text-xs font-black text-slate-600">{index + 1}</span>
                                  <div>
                                    {product.productUrl ? (
                                      <a href={product.productUrl} target="_blank" rel="noopener noreferrer" className="font-black text-blue-700 underline-offset-2 hover:underline">
                                        {product.name}
                                      </a>
                                    ) : (
                                      <button onClick={() => openDetail(product)} className="text-left font-black text-slate-900 hover:text-blue-700">
                                        {product.name}
                                      </button>
                                    )}
                                    <p className="mt-1 text-xs font-bold text-slate-500">
                                      {product.sourceCategoryName ? `${product.sourceCategoryName} · ` : ''}
                                      수집 표본 {fmt(product.coupangProductCount)}개 · 경쟁도 {product.competitionLevel} · 기회점수 {product.opportunityScore}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-4 text-center"><DeliveryBadge delivery={product.delivery} /></td>
                              <td className="px-3 py-4 text-center text-xs font-black text-slate-600">{product.difficulty}</td>
                              <td className="px-3 py-4 text-right font-bold">{won(product.price)}</td>
                              <td className="px-3 py-4 text-right font-bold text-slate-600">{fmt(product.avgReview)}</td>
                              <td className="px-3 py-4 text-right text-base font-black text-slate-950">{product.avgReview > 0 ? fmt(product.estimatedSales) : <span className="text-sm font-bold text-slate-400">미검증</span>}</td>
                              <td className="px-3 py-4 text-right font-black text-amber-600">{product.avgReview > 0 ? `${fmt(Math.round(product.estimatedRevenue / 10000))}만원` : <span className="text-sm font-bold text-slate-400">—</span>}</td>
                              <td className="px-3 py-4 text-center">
                                {product.productUrl ? (
                                  <a href={product.productUrl} target="_blank" rel="noopener noreferrer" className="inline-grid h-9 w-9 place-items-center rounded-full bg-slate-950 text-white hover:bg-blue-600" aria-label={`${product.name} 쿠팡 상품 열기`}>
                                    <ChevronRight className="h-4 w-4" />
                                  </a>
                                ) : (
                                  <button onClick={() => openDetail(product)} className="inline-grid h-9 w-9 place-items-center rounded-full bg-slate-950 text-white hover:bg-blue-600" aria-label={`${product.name} 상세분석`}>
                                  <ChevronRight className="h-4 w-4" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <SectionTitle title="추천 카드" desc="상세 분석, 즐겨찾기, 상태 관리를 위한 카드형 보기입니다." />
                    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">{filteredProducts.map((product) => (
                      <React.Fragment key={product.id}>
                        <ProductCard product={product} favorites={favorites} onFavorite={toggleFavorite} onOpen={openDetail} />
                      </React.Fragment>
                    ))}</div>
                  </div>
                </div>
              ) : (
                <div className="grid h-72 place-items-center rounded-lg border border-dashed border-slate-300 bg-white text-center">
                  <div>
                    <Sparkles className="mx-auto h-8 w-8 text-blue-600" />
                    <p className="mt-3 text-base font-black text-slate-800">아직 소싱을 시작하지 않았습니다.</p>
                    <button onClick={() => setView('dashboard')} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white">난이도 선택하기</button>
                  </div>
                </div>
              )}
            </section>
          )}

          {view === 'detail' && (
            <section className="grid grid-cols-[1fr_360px] gap-5">
              <div className="space-y-5">
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div><GradeBadge grade={selectedProduct.grade} /><h3 className="mt-3 text-2xl font-black">{selectedProduct.name}</h3><p className="mt-1 text-sm font-bold text-slate-500">{selectedProduct.difficulty} 추천 · {selectedProduct.recommendation}</p></div>
                    <span className="text-4xl font-black text-blue-600">{selectedProduct.score.total}</span>
                  </div>
                  <div className="mt-5 grid grid-cols-4 gap-3"><MetricCard label="누적 판매 추정" value={`${fmt(selectedProduct.estimatedSales)}개`} sub="리뷰 기반 환산" /><MetricCard label="수집 표본" value={`${fmt(selectedProduct.coupangProductCount)}개`} sub="쿠팡 전체 등록수 아님" /><MetricCard label="기회점수" value={`${selectedProduct.opportunityScore}점`} sub={`경쟁도 ${selectedProduct.competitionLevel}/100`} /><MetricCard label="누적 매출 추정" value={won(selectedProduct.estimatedRevenue)} /></div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <SectionTitle title="AI SCORE 세부 점수" desc="수집 데이터로 실측 가능한 축만 채점하고, 데이터 소스가 없는 축은 —로 표시합니다." />
                  <div className="mt-4 grid grid-cols-4 gap-3">{[
                    { label: '수요', value: selectedProduct.score.demand, max: 20 },
                    { label: '경쟁', value: selectedProduct.score.competition, max: 20 },
                    { label: '리뷰장벽', value: selectedProduct.score.review, max: 15 },
                    { label: '예상마진', value: selectedProduct.score.margin, max: 15 },
                    { label: '성장성', value: null, max: 15 },
                    { label: '가격안정성', value: null, max: 5 },
                    { label: '시즌성', value: null, max: 5 },
                    { label: '공급가능성', value: null, max: 5 },
                  ].map(({ label, value, max }) => <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-black text-slate-500">{label}</p><p className={`mt-1 text-xl font-black ${value === null ? 'text-slate-300' : 'text-slate-950'}`}>{value === null ? '—' : value}</p><p className="text-[10px] font-bold text-slate-400">{value === null ? '데이터 미연결' : `/ ${max}점`}</p></div>)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <SectionTitle title="경쟁상품 TOP 10" desc="브랜드 상품은 제외하고, 가격·리뷰·판매량은 비브랜드 후보 기준 추정값으로 표시합니다." />
                  <table className="mt-4 w-full text-sm"><thead className="bg-slate-50 text-xs font-black text-slate-500"><tr><th className="px-3 py-3 text-left">순위</th><th className="px-3 py-3 text-left">상품</th><th className="px-3 py-3 text-right">가격</th><th className="px-3 py-3 text-right">리뷰 추정</th><th className="px-3 py-3 text-right">판매량 추정</th><th className="px-3 py-3 text-center">배송</th></tr></thead><tbody>{selectedProduct.competitors.map((competitor) => <tr key={`${competitor.rank}-${competitor.name}`} className="border-b border-slate-100 hover:bg-blue-50/60"><td className="px-3 py-3 font-bold">{competitor.rank}</td><td className="px-3 py-3 font-bold">{competitor.productUrl ? <a href={competitor.productUrl} target="_blank" rel="noopener noreferrer" title="쿠팡 상품 상세페이지 열기" className="text-blue-700 underline-offset-2 hover:underline">{competitor.name}</a> : <span className="text-slate-700">{competitor.name}</span>}</td><td className="px-3 py-3 text-right">{won(competitor.price)}</td><td className="px-3 py-3 text-right">{fmt(competitor.reviews)}</td><td className="px-3 py-3 text-right">{fmt(competitor.estimatedSales)}</td><td className="px-3 py-3 text-center">{competitor.delivery}</td></tr>)}</tbody></table>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle title="시즌성 예측" /><div className="mt-4"><SeasonBars product={selectedProduct} /></div></div>
              </div>
              <aside className="space-y-5">
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle title="경쟁시장 요약" /><div className="mt-4 space-y-3 text-sm"><p className="flex justify-between"><span className="font-bold text-slate-500">상위 평균 리뷰</span><b>{fmt(selectedProduct.avgReview)}개</b></p><p className="flex justify-between"><span className="font-bold text-slate-500">리뷰 100개 이하</span><b>{selectedProduct.competitors.filter((item) => item.reviews <= 100).length}개</b></p><p className="flex justify-between"><span className="font-bold text-slate-500">로켓 비율</span><b>{selectedProduct.rocketRatio}%</b></p><p className="flex justify-between"><span className="font-bold text-slate-500">광고상품 비율</span><b>{selectedProduct.adRatio}%</b></p></div></div>
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle title="AI 시장 분석" /><p className="mt-3 text-sm font-semibold leading-7 text-slate-700">{aiStrategy.reason}</p></div>
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle title="AI 판매 전략" /><div className="mt-4 space-y-4 text-sm"><InfoBlock label="타겟 고객" items={aiStrategy.targetCustomers} /><InfoBlock label="위험 요소" items={aiStrategy.risks} /><InfoBlock label="차별화 전략" items={aiStrategy.differentiation} /><InfoBlock label="상품명 생성" items={aiStrategy.productNames} /><InfoBlock label="검색 키워드" items={aiStrategy.keywords} /></div></div>
                <button onClick={() => setView('suppliers')} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-black text-white"><Boxes className="h-4 w-4" />소싱상품 찾기</button>
              </aside>
            </section>
          )}

          {view === 'suppliers' && (
            <section className="space-y-5">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle title="소싱상품 매칭" desc="V1에서는 수동 등록과 CSV 업로드를 허용하고, 텍스트/이미지 유사도 구조를 제공합니다." /></div>
              <div className="grid grid-cols-2 gap-4">{selectedProduct.suppliers.map((supplier) => <div key={supplier.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><p className="text-lg font-black">{supplier.productName}</p><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><p className="rounded-md bg-slate-50 p-3"><span className="block text-xs font-bold text-slate-500">공급가</span><b>{won(supplier.cost)}</b></p><p className="rounded-md bg-slate-50 p-3"><span className="block text-xs font-bold text-slate-500">MOQ</span><b>{supplier.moq}개</b></p><p className="rounded-md bg-blue-50 p-3 text-blue-800"><span className="block text-xs font-bold">텍스트 유사도</span><b>{supplier.textSimilarity}%</b></p><p className="rounded-md bg-blue-50 p-3 text-blue-800"><span className="block text-xs font-bold">종합 유사도</span><b>{supplier.totalSimilarity}%</b></p></div></div>)}</div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle title="수동 소싱상품 등록" /><div className="mt-4 grid grid-cols-3 gap-3">{['상품명', '공급가', '도매 URL', 'MOQ', '배송비', '이미지 URL'].map((field) => <input key={field} placeholder={field} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />)}</div><button className="mt-4 rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white">후보 저장</button></div>
            </section>
          )}

          {view === 'favorites' && (
            <section className="space-y-4">
              <div className="grid grid-cols-3 gap-4"><MetricCard label="S급" value={`${products.filter((product) => favorites.includes(product.id) && product.grade === 'S').length}개`} /><MetricCard label="A급" value={`${products.filter((product) => favorites.includes(product.id) && product.grade === 'A').length}개`} /><MetricCard label="보류" value={`${products.filter((product) => favorites.includes(product.id) && (statusById[product.id] || product.status) === '보류').length}개`} /></div>
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">{products.filter((product) => favorites.includes(product.id)).map((product) => <div key={product.id} className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-3"><Bookmark className="h-5 w-5 text-red-500" fill="currentColor" /><div><p className="font-black">{product.name}</p><p className="text-xs font-bold text-slate-500">{product.grade}등급 · {product.score.total}점</p></div></div><select value={statusById[product.id] || product.status} onChange={(event) => setStatusById((current) => ({ ...current, [product.id]: event.target.value as SourcingStatus }))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold">{statuses.map((status) => <option key={status}>{status}</option>)}</select></div>)}</div>
            </section>
          )}

          {view === 'calculator' && (
            <section className="grid grid-cols-[420px_1fr] gap-5">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle title="마진 계산기" /><div className="mt-5 space-y-4"><label className="block"><span className="text-xs font-black text-slate-500">상품</span><select value={calcProductId} onChange={(event) => { const product = products.find((item) => item.id === event.target.value) || sourcingProducts[0]; setCalcProductId(product.id); setCalcSupply(product.supplierCost); }} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold">{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label className="block"><span className="text-xs font-black text-slate-500">공급가격</span><input type="number" value={calcSupply} onChange={(event) => setCalcSupply(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" /></label><label className="block"><span className="text-xs font-black text-slate-500">광고비 %</span><input type="number" value={calcAd} onChange={(event) => setCalcAd(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" /></label><label className="block"><span className="text-xs font-black text-slate-500">기타 비용</span><input type="number" value={calcOther} onChange={(event) => setCalcOther(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" /></label></div></div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle title={calcProduct.name} desc="쿠팡 수수료는 MVP 기준 12%로 계산합니다." /><div className="mt-5 grid grid-cols-2 gap-4"><MetricCard label="판매가격" value={won(calcProduct.price)} /><MetricCard label="총 비용" value={won(totalCost)} /><MetricCard label="예상 순이익" value={won(netProfit)} /><MetricCard label="예상 마진율" value={`${netMargin}%`} /></div><div className={`mt-5 rounded-lg p-5 ${netMargin >= 30 ? 'bg-emerald-50 text-emerald-800' : 'bg-orange-50 text-orange-800'}`}><div className="flex items-center gap-2 font-black">{netMargin >= 30 ? <CheckCircle2 className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}{netMargin >= 30 ? '마진 구조 양호' : '원가 또는 광고비 재검토'}</div><p className="mt-2 text-sm font-semibold">총 비용 = 공급가 + 배송비 + 쿠팡 수수료 + 광고비 + 기타 비용입니다.</p></div></div>
            </section>
          )}

          {view === 'admin' && (
            <section className="space-y-5">
              <div className="grid grid-cols-4 gap-4"><MetricCard label="회원" value="128" /><MetricCard label="분석 횟수" value="9,842" /><MetricCard label="AI 사용량" value="3,106" /><MetricCard label="저장상품" value={`${favorites.length}`} /></div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <SectionTitle title="Bright Data 캐시 제어" desc="사용자는 캐시된 최신 결과를 즉시 보고, 관리자는 필요할 때만 실시간 수집을 강제합니다." />
                  <button onClick={() => updateCacheEnabled(!cacheEnabled)} className={`rounded-lg px-4 py-2 text-sm font-black ${cacheEnabled ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                    캐시 {cacheEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-4 gap-3">
                  <div className="rounded-lg bg-slate-50 p-4">
                    <p className="text-xs font-black text-slate-500">캐시 상태</p>
                    <p className="mt-2 text-lg font-black">{cacheInfo ? `${cacheInfo.products.length}개 저장` : '비어 있음'}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">{cacheInfo ? new Date(cacheInfo.savedAt).toLocaleString('ko-KR') : '실시간 수집 완료 후 자동 저장'}</p>
                  </div>
                  <button onClick={startAdminRefresh} disabled={isSourcingLoading} className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-left text-blue-800 disabled:opacity-50">
                    <p className="text-sm font-black">{pendingSourcing ? '진행중 작업 확인' : '실시간 강제 갱신'}</p>
                    <p className="mt-2 text-xs font-bold">{pendingSourcing ? '진행중인 snapshot을 확인하고, 끝났으면 바로 불러옵니다.' : 'Bright Data snapshot을 시작합니다. 수집에 1시간 정도 걸립니다.'}</p>
                  </button>
                  <button onClick={() => pendingSourcing && importSnapshotToCache(pendingSourcing.snapshotId)} disabled={isSourcingLoading || !pendingSourcing} className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-left text-emerald-800 disabled:opacity-50">
                    <p className="text-sm font-black">완료 확인</p>
                    <p className="mt-2 break-all text-xs font-bold">{pendingSourcing ? `대기중 ${pendingSourcing.snapshotId}` : '진행중인 snapshot 없음'}</p>
                  </button>
                  <button onClick={clearSourcingCache} className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-left text-slate-700">
                    <p className="text-sm font-black">캐시 비우기</p>
                    <p className="mt-2 text-xs font-bold">저장된 결과를 삭제하고 다음 소싱 때 새로 수집합니다.</p>
                  </button>
                </div>
                {pendingSourcing && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
                    <p>
                      Bright Data 수집 진행중 · 시작 {new Date(pendingSourcing.startedAt).toLocaleString('ko-KR')} · 1분마다 자동으로 완료 여부를 확인합니다.
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button onClick={() => importSnapshotToCache(pendingSourcing.snapshotId)} disabled={isSourcingLoading} className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50">
                        지금 확인
                      </button>
                      <button onClick={forceNewSnapshot} disabled={isSourcingLoading} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-black text-amber-800 disabled:opacity-50">
                        이 작업 버리고 새로 시작
                      </button>
                      <button onClick={clearPendingSourcing} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-black text-amber-800">
                        대기 해제
                      </button>
                    </div>
                  </div>
                )}
                <button onClick={runLiveSourcingForDebug} disabled={isSourcingLoading} className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 disabled:opacity-50">
                  장시간 직접 수집 테스트
                </button>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <SectionTitle
                  title="수집 카테고리 관리"
                  desc="쿠팡 카테고리를 불러와서 목록에서 고르면 됩니다. 번호를 직접 찾을 필요는 없고, 직접 붙여넣고 싶으면 아래 입력칸에 URL을 넣어도 됩니다."
                />

                <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={loadCoupangCategories} disabled={isLoadingCategories} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
                      {isLoadingCategories ? '불러오는 중…' : '쿠팡 카테고리 불러오기'}
                    </button>
                    {coupangCategories.length > 0 && (
                      <>
                        <span className="text-xs font-black text-slate-500">추가할 곳</span>
                        <select value={categoryTarget} onChange={(event) => setCategoryTarget(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black">
                          {categories.filter((category) => category !== '기타').map((category) => <option key={category}>{category}</option>)}
                        </select>
                        <input
                          value={categorySearch}
                          onChange={(event) => setCategorySearch(event.target.value)}
                          placeholder="카테고리 검색"
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                      </>
                    )}
                  </div>
                  {coupangCategories.length > 0 && (
                    <div className="mt-3 flex max-h-52 flex-wrap gap-2 overflow-y-auto">
                      {coupangCategories
                        .filter((option) => !categorySearch || option.name.includes(categorySearch))
                        .map((option) => (
                          <button
                            key={option.id}
                            onClick={() => appendCategoryUrl(option)}
                            title={option.url}
                            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:border-blue-400 hover:text-blue-700"
                          >
                            {option.name} <span className="font-mono text-[10px] text-slate-400">{option.id}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-3">
                  {categories.filter((category) => category !== '기타').map((category) => {
                    const urls = categoryUrlDraft[category] || '';
                    const count = urls.split('\n').map((url) => url.trim()).filter(Boolean).length;
                    return (
                      <div key={category} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-black text-slate-800">{category}</p>
                          <span className={`rounded-md px-2 py-0.5 text-[11px] font-black ${count > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                            {count > 0 ? `${count}개 URL · 수집 가능` : '미설정'}
                          </span>
                        </div>
                        <textarea
                          value={urls}
                          onChange={(event) => setCategoryUrlDraft((current) => ({ ...current, [category]: event.target.value }))}
                          rows={Math.max(2, Math.min(5, count + 1))}
                          placeholder="https://www.coupang.com/np/categories/1234567"
                          className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700"
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button onClick={saveCategoryUrls} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white">
                    카테고리 저장
                  </button>
                  <button onClick={restoreDefaultCategoryUrls} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600">
                    기본값으로 되돌리기
                  </button>
                  <p className="text-xs font-bold text-slate-500">저장 후 “새로 시작”으로 수집하면 해당 카테고리에서 상품을 가져옵니다.</p>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle title="관리자 지표" desc="회원, 분석 횟수, 인기 키워드, 검색 횟수, 저장상품, 사용자 활동을 확인합니다." /><div className="mt-4 grid grid-cols-3 gap-3">{['안경김서림 방지 냉감 귀걸이 마스크', '차박용 자석 암막 사이드 햇빛가리개', '목뒤 밀착형 PCM 아이스 넥쿨러', '종이호일 대체 사각 실리콘 에어프라이어 용기', '스노쿨링 터치가능 스마트폰 방수팩', '독서실용 무드등 겸 저소음 탁상 선풍기'].map((keyword, index) => <div key={keyword} className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">인기 키워드 {index + 1}</p><p className="mt-1 font-black">{keyword}</p></div>)}</div></div>
            </section>
          )}

          {view === 'settings' && (
            <section className="space-y-5">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle title="데이터 Provider Architecture" desc="실제 데이터 공급자가 바뀌어도 Provider만 교체하도록 분리했습니다." /><div className="mt-4 grid grid-cols-2 gap-3">{providerStatuses.map((provider) => <div key={provider.name} className="rounded-lg border border-slate-100 bg-slate-50 p-4"><div className="flex items-center gap-2"><Database className="h-4 w-4 text-blue-600" /><p className="font-black">{provider.name}</p></div><p className="mt-2 text-sm font-semibold text-slate-600">{provider.role}</p><p className="mt-3 text-xs font-black text-blue-700">{provider.implementation} · {provider.status}</p></div>)}</div></div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle title="개발 로드맵" desc="기획안의 Phase 1~5를 배포 전 피드백 가능한 형태로 정리했습니다." /><div className="mt-4 grid grid-cols-5 gap-3">{['Phase 1 UI/Fake Data 완료', 'Phase 2 Supabase 스키마 준비', 'Phase 3 OpenAI API 골격 준비', 'Phase 4 Provider 분리 완료', 'Phase 5 자동화 예정'].map((phase) => <div key={phase} className="rounded-lg bg-blue-50 p-3 text-sm font-black text-blue-800">{phase}</div>)}</div></div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

type ProductCardProps = {
  product: SourcingProduct;
  favorites: string[];
  onFavorite: (id: string) => void;
  onOpen: (product: SourcingProduct) => void;
};

function ProductCard({ product, favorites, onFavorite, onOpen }: ProductCardProps): ReactElement {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between"><GradeBadge grade={product.grade} /><button onClick={() => onFavorite(product.id)} className={`rounded-lg p-2 ${favorites.includes(product.id) ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}><Heart className="h-4 w-4" fill={favorites.includes(product.id) ? 'currentColor' : 'none'} /></button></div>
      {product.productUrl ? (
        <a href={product.productUrl} target="_blank" rel="noopener noreferrer" className="mt-4 block text-lg font-black text-blue-700 underline-offset-2 hover:underline">
          {product.name}
        </a>
      ) : (
        <p className="mt-4 text-lg font-black">{product.name}</p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><p className="rounded-md bg-blue-50 p-2 text-blue-800"><span className="block text-xs font-bold">기회점수</span><b>{product.opportunityScore} / 100</b></p><p className="rounded-md bg-slate-50 p-2"><span className="block text-xs font-bold text-slate-500">월 판매량 추정</span><b>{fmt(product.estimatedSales)}개</b></p><p className="rounded-md bg-slate-50 p-2"><span className="block text-xs font-bold text-slate-500">쿠팡 상품수 추정</span><b>{fmt(product.coupangProductCount)}개</b></p><p className="rounded-md bg-slate-50 p-2"><span className="block text-xs font-bold text-slate-500">AI SCORE</span><b>{product.score.total}점</b></p></div>
      <button onClick={() => onOpen(product)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 py-2.5 text-sm font-black text-white">상세 분석 <ChevronRight className="h-4 w-4" /></button>
    </article>
  );
}

function InfoBlock({ label, items }: { label: string; items: string[] }) {
  return <div><p className="font-black text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-800">{items.join(', ')}</p></div>;
}
