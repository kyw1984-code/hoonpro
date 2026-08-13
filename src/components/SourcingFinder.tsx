import React, { type ReactElement, useMemo, useState } from 'react';
import {
  BarChart3, Bookmark, Calculator, CheckCircle2, ChevronRight, Database,
  Download, FileSpreadsheet, Heart, LineChart, PackageSearch, Search, Settings,
  ShieldAlert, SlidersHorizontal, Sparkles, Target, TrendingUp, Upload,
  WalletCards, Waves, Sun, Coins, Boxes, Users, Zap,
} from 'lucide-react';
import { createMockAiStrategy } from '../lib/sourcing/aiStrategy';
import { providerStatuses, sourcingProducts } from '../lib/sourcing/mockData';
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

const getFilteredProducts = (filters: SourcingFilters, segment: Segment) => {
  const query = filters.query.trim().toLowerCase();
  return sourcingProducts
    .filter((product) => product.difficulty === filters.difficulty)
    .filter((product) => filters.category === '기타' || product.category === filters.category || Boolean(query))
    .filter((product) => product.price >= filters.minPrice && product.price <= filters.maxPrice)
    .filter((product) => product.avgReview <= filters.maxReview)
    .filter((product) => filters.keywordTypes.length === 0 || filters.keywordTypes.some((type) => product.keywordTypes.includes(type)))
    .filter((product) => segment === '전체' || product.keywordTypes.includes(segment as KeywordType))
    .filter((product) => !query || product.name.toLowerCase().includes(query) || product.category.toLowerCase().includes(query))
    .sort(sortByOpportunity);
};

export function SourcingFinder() {
  const [view, setView] = useState<View>('dashboard');
  const [segment, setSegment] = useState<Segment>('전체');
  const [filters, setFilters] = useState<SourcingFilters>({
    difficulty: '아마추어',
    category: '기타',
    minPrice: 10000,
    maxPrice: 50000,
    maxReview: 1000,
    keywordTypes: [],
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

  const filteredProducts = useMemo(() => {
    return getFilteredProducts(filters, segment);
  }, [filters, segment]);

  const resultSummary = useMemo(() => {
    const totalSales = filteredProducts.reduce((sum, product) => sum + product.estimatedSales, 0);
    const totalReviews = filteredProducts.reduce((sum, product) => sum + product.avgReview, 0);
    const totalRevenue = filteredProducts.reduce((sum, product) => sum + product.estimatedRevenue, 0);
    const totalPrice = filteredProducts.reduce((sum, product) => sum + product.price, 0);
    const avgPrice = filteredProducts.length ? Math.round((totalPrice / filteredProducts.length) / 100) * 100 : 0;
    const lowCompetitionCount = filteredProducts.filter((product) => product.coupangProductCount <= 100).length;

    return {
      avgPrice,
      lowCompetitionCount,
      productCount: filteredProducts.length,
      totalRevenue,
      totalReviews,
      totalSales,
    };
  }, [filteredProducts]);

  const selectedProduct = sourcingProducts.find((product) => product.id === selectedProductId) || sourcingProducts[0];
  const aiStrategy = createMockAiStrategy(selectedProduct);
  const calcProduct = sourcingProducts.find((product) => product.id === calcProductId) || sourcingProducts[0];
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

  const runSourcing = () => {
    const products = getFilteredProducts(filters, '전체');
    const first = products[0] || sourcingProducts[0];
    setSegment('전체');
    setSelectedProductId(first.id);
    setCalcProductId(first.id);
    setCalcSupply(first.supplierCost);
    setHasRunSourcing(true);
    setView('results');
  };

  const runSourcingBySegment = (nextSegment: Segment) => {
    setSegment(nextSegment);
    const products = getFilteredProducts(filters, nextSegment);
    const first = products[0] || sourcingProducts[0];
    setSelectedProductId(first.id);
    setCalcProductId(first.id);
    setCalcSupply(first.supplierCost);
    setHasRunSourcing(true);
    setView('results');
  };

  const toggleType = (type: KeywordType) => {
    setFilter('keywordTypes', filters.keywordTypes.includes(type) ? filters.keywordTypes.filter((item) => item !== type) : [...filters.keywordTypes, type]);
  };

  const toggleFavorite = (id: string) => {
    setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const exportCsv = () => {
    const rows = [['상품명', '등급', '기회점수', 'AI점수', '월판매량추정', '쿠팡상품수추정', '예상월매출', '평균리뷰', '예상마진'], ...filteredProducts.map((product) => [
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
              <button onClick={runSourcing} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-slate-800"><Sparkles className="h-4 w-4" />AI 소싱 시작</button>
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
                <div className="mt-6 flex items-center justify-between rounded-lg bg-slate-50 px-5 py-4">
                  <div>
                    <p className="text-sm font-black text-slate-950">{filters.difficulty} 기준으로 분석 대기 중</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">시작 전에는 추천 키워드를 숨겨두고, 실행 후 결과 화면에서 공개합니다.</p>
                  </div>
                  <button onClick={runSourcing} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-blue-700"><Sparkles className="h-4 w-4" />소싱 시작</button>
                </div>
              </div>
              <div className="grid grid-cols-6 gap-3">
                {segmentButtons.slice(1).map(([label, Icon]) => (
                  <button key={label} onClick={() => runSourcingBySegment(label)} className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-blue-200 hover:bg-blue-50">
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
                  <label className="block"><span className="text-xs font-black text-slate-500">최대 리뷰</span><select value={filters.maxReview} onChange={(event) => setFilter('maxReview', Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none">{[100, 300, 500, 1000, 5000].map((item) => <option key={item} value={item}>{fmt(item)}개</option>)}</select></label>
                  <div><p className="text-xs font-black text-slate-500">키워드 유형</p><div className="mt-2 grid grid-cols-2 gap-2">{keywordTypes.map((type) => <button key={type} onClick={() => toggleType(type)} className={`rounded-lg px-3 py-2 text-left text-xs font-black ring-1 ${filters.keywordTypes.includes(type) ? 'bg-orange-50 text-orange-700 ring-orange-200' : 'bg-white text-slate-500 ring-slate-200'}`}>{filters.keywordTypes.includes(type) ? '선택됨 · ' : ''}{type}</button>)}</div></div>
                  <button onClick={runSourcing} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-black text-white shadow-sm hover:bg-blue-700"><Sparkles className="h-4 w-4" />AI 훈프로 찾기</button>
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
                <SectionTitle title={`${filters.difficulty} 추천 키워드 TOP ${hasRunSourcing ? filteredProducts.length : 0}`} desc={hasRunSourcing ? '쿠팡 상품수 100개 이하 중 월 판매량과 매출이 높은 순서로 추론했습니다.' : '대시보드에서 난이도를 선택하고 소싱 시작을 눌러주세요.'} />
                <div className="flex gap-2">{segmentButtons.map(([label, Icon]) => <button key={label} onClick={() => setSegment(label)} className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-black ${segment === label ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}><Icon className="h-3.5 w-3.5" />{label}</button>)}</div>
              </div>
              {hasRunSourcing ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                    <MetricCard label="총판매량" value={`${fmt(resultSummary.totalSales)}개`} sub="월 판매량 추정 합산" />
                    <MetricCard label="총리뷰수" value={fmt(resultSummary.totalReviews)} sub="상위권 리뷰 장벽 합산" />
                    <MetricCard label="상품수" value={`${fmt(resultSummary.productCount)}개`} sub={`저경쟁 ${fmt(resultSummary.lowCompetitionCount)}개`} />
                    <MetricCard label="평균가" value={won(resultSummary.avgPrice)} sub="추천 키워드 평균 판매가" />
                    <MetricCard label="총 월매출" value={`${fmt(Math.round(resultSummary.totalRevenue / 10000))}만원`} sub={`Top ${fmt(filteredProducts[0]?.estimatedSales || 0)}개/월`} />
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <SectionTitle title="대박 상품 리스트" desc={`쿠팡 상품수 100개 이하에서 월판매와 월매출이 높은 순서 Top ${Math.min(7, filteredProducts.length)}입니다.`} />
                      <span className="rounded-md bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">상품수 100개 이하</span>
                    </div>
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[860px] text-sm">
                        <thead className="bg-slate-50 text-xs font-black text-slate-500">
                          <tr>
                            <th className="px-3 py-3 text-left">상품명</th>
                            <th className="px-3 py-3 text-right">가격</th>
                            <th className="px-3 py-3 text-right">리뷰</th>
                            <th className="px-3 py-3 text-right">월판매</th>
                            <th className="px-3 py-3 text-right">월매출</th>
                            <th className="px-3 py-3 text-center">AI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredProducts.slice(0, 7).map((product, index) => (
                            <tr key={product.id} className="border-b border-slate-100 hover:bg-blue-50/60">
                              <td className="px-3 py-4">
                                <div className="flex items-center gap-3">
                                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-slate-100 text-xs font-black text-slate-600">{index + 1}</span>
                                  <div>
                                    <p className="font-black text-slate-900">{product.name}</p>
                                    <p className="mt-1 text-xs font-bold text-slate-500">쿠팡 상품수 {fmt(product.coupangProductCount)}개 · 기회점수 {product.opportunityScore}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-4 text-right font-bold">{won(product.price)}</td>
                              <td className="px-3 py-4 text-right font-bold text-slate-600">{fmt(product.avgReview)}</td>
                              <td className="px-3 py-4 text-right text-base font-black text-slate-950">{fmt(product.estimatedSales)}</td>
                              <td className="px-3 py-4 text-right font-black text-amber-600">{fmt(Math.round(product.estimatedRevenue / 10000))}만원</td>
                              <td className="px-3 py-4 text-center">
                                <button onClick={() => openDetail(product)} className="inline-grid h-9 w-9 place-items-center rounded-full bg-slate-950 text-white hover:bg-blue-600" aria-label={`${product.name} 상세분석`}>
                                  <ChevronRight className="h-4 w-4" />
                                </button>
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
                  <div className="mt-5 grid grid-cols-4 gap-3"><MetricCard label="월 판매량 추정" value={`${fmt(selectedProduct.estimatedSales)}개`} /><MetricCard label="쿠팡 상품수 추정" value={`${fmt(selectedProduct.coupangProductCount)}개`} /><MetricCard label="기회점수" value={`${selectedProduct.opportunityScore}점`} /><MetricCard label="예상 월매출" value={won(selectedProduct.estimatedRevenue)} /></div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <SectionTitle title="AI SCORE 세부 점수" desc="총점 100점, 계산 함수는 UI와 분리되어 있습니다." />
                  <div className="mt-4 grid grid-cols-4 gap-3">{Object.entries({ 수요: selectedProduct.score.demand, 경쟁: selectedProduct.score.competition, 리뷰장벽: selectedProduct.score.review, 성장성: selectedProduct.score.growth, 예상마진: selectedProduct.score.margin, 가격안정성: selectedProduct.score.priceStability, 시즌성: selectedProduct.score.seasonality, 공급가능성: selectedProduct.score.supplier }).map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-black text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-slate-950">{value}</p></div>)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <SectionTitle title="경쟁상품 TOP 10" desc="판매량과 매출은 추정값으로 표시합니다." />
                  <table className="mt-4 w-full text-sm"><thead className="bg-slate-50 text-xs font-black text-slate-500"><tr><th className="px-3 py-3 text-left">순위</th><th className="px-3 py-3 text-left">상품</th><th className="px-3 py-3 text-right">가격</th><th className="px-3 py-3 text-right">리뷰</th><th className="px-3 py-3 text-right">판매량 추정</th><th className="px-3 py-3 text-center">배송</th></tr></thead><tbody>{selectedProduct.competitors.map((competitor) => <tr key={`${competitor.rank}-${competitor.name}`} className="border-b border-slate-100 hover:bg-blue-50/60"><td className="px-3 py-3 font-bold">{competitor.rank}</td><td className="px-3 py-3 font-bold"><a href={competitor.productUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline-offset-2 hover:underline">{competitor.name}</a></td><td className="px-3 py-3 text-right">{won(competitor.price)}</td><td className="px-3 py-3 text-right">{fmt(competitor.reviews)}</td><td className="px-3 py-3 text-right">{fmt(competitor.estimatedSales)}</td><td className="px-3 py-3 text-center">{competitor.delivery}</td></tr>)}</tbody></table>
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
              <div className="grid grid-cols-3 gap-4"><MetricCard label="S급" value={`${sourcingProducts.filter((product) => favorites.includes(product.id) && product.grade === 'S').length}개`} /><MetricCard label="A급" value={`${sourcingProducts.filter((product) => favorites.includes(product.id) && product.grade === 'A').length}개`} /><MetricCard label="보류" value={`${sourcingProducts.filter((product) => favorites.includes(product.id) && (statusById[product.id] || product.status) === '보류').length}개`} /></div>
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">{sourcingProducts.filter((product) => favorites.includes(product.id)).map((product) => <div key={product.id} className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-3"><Bookmark className="h-5 w-5 text-red-500" fill="currentColor" /><div><p className="font-black">{product.name}</p><p className="text-xs font-bold text-slate-500">{product.grade}등급 · {product.score.total}점</p></div></div><select value={statusById[product.id] || product.status} onChange={(event) => setStatusById((current) => ({ ...current, [product.id]: event.target.value as SourcingStatus }))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold">{statuses.map((status) => <option key={status}>{status}</option>)}</select></div>)}</div>
            </section>
          )}

          {view === 'calculator' && (
            <section className="grid grid-cols-[420px_1fr] gap-5">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle title="마진 계산기" /><div className="mt-5 space-y-4"><label className="block"><span className="text-xs font-black text-slate-500">상품</span><select value={calcProductId} onChange={(event) => { const product = sourcingProducts.find((item) => item.id === event.target.value) || sourcingProducts[0]; setCalcProductId(product.id); setCalcSupply(product.supplierCost); }} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold">{sourcingProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label className="block"><span className="text-xs font-black text-slate-500">공급가격</span><input type="number" value={calcSupply} onChange={(event) => setCalcSupply(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" /></label><label className="block"><span className="text-xs font-black text-slate-500">광고비 %</span><input type="number" value={calcAd} onChange={(event) => setCalcAd(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" /></label><label className="block"><span className="text-xs font-black text-slate-500">기타 비용</span><input type="number" value={calcOther} onChange={(event) => setCalcOther(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" /></label></div></div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><SectionTitle title={calcProduct.name} desc="쿠팡 수수료는 MVP 기준 12%로 계산합니다." /><div className="mt-5 grid grid-cols-2 gap-4"><MetricCard label="판매가격" value={won(calcProduct.price)} /><MetricCard label="총 비용" value={won(totalCost)} /><MetricCard label="예상 순이익" value={won(netProfit)} /><MetricCard label="예상 마진율" value={`${netMargin}%`} /></div><div className={`mt-5 rounded-lg p-5 ${netMargin >= 30 ? 'bg-emerald-50 text-emerald-800' : 'bg-orange-50 text-orange-800'}`}><div className="flex items-center gap-2 font-black">{netMargin >= 30 ? <CheckCircle2 className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}{netMargin >= 30 ? '마진 구조 양호' : '원가 또는 광고비 재검토'}</div><p className="mt-2 text-sm font-semibold">총 비용 = 공급가 + 배송비 + 쿠팡 수수료 + 광고비 + 기타 비용입니다.</p></div></div>
            </section>
          )}

          {view === 'admin' && (
            <section className="space-y-5">
              <div className="grid grid-cols-4 gap-4"><MetricCard label="회원" value="128" /><MetricCard label="분석 횟수" value="9,842" /><MetricCard label="AI 사용량" value="3,106" /><MetricCard label="저장상품" value={`${favorites.length}`} /></div>
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
      <p className="mt-4 text-lg font-black">{product.name}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><p className="rounded-md bg-blue-50 p-2 text-blue-800"><span className="block text-xs font-bold">기회점수</span><b>{product.opportunityScore} / 100</b></p><p className="rounded-md bg-slate-50 p-2"><span className="block text-xs font-bold text-slate-500">월 판매량 추정</span><b>{fmt(product.estimatedSales)}개</b></p><p className="rounded-md bg-slate-50 p-2"><span className="block text-xs font-bold text-slate-500">쿠팡 상품수 추정</span><b>{fmt(product.coupangProductCount)}개</b></p><p className="rounded-md bg-slate-50 p-2"><span className="block text-xs font-bold text-slate-500">AI SCORE</span><b>{product.score.total}점</b></p></div>
      <button onClick={() => onOpen(product)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 py-2.5 text-sm font-black text-white">상세 분석 <ChevronRight className="h-4 w-4" /></button>
    </article>
  );
}

function InfoBlock({ label, items }: { label: string; items: string[] }) {
  return <div><p className="font-black text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-800">{items.join(', ')}</p></div>;
}
