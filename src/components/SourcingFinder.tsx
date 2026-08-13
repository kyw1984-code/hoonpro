import React, { useMemo, useState } from 'react';
import {
  BarChart3, Bookmark, Calculator, CheckCircle2, ChevronRight, Download,
  Heart, LineChart, Package, Search, Settings, ShieldAlert, SlidersHorizontal,
  Sparkles, Star, Target, TrendingUp, Upload, WalletCards,
} from 'lucide-react';
import { calculateProductScore, type ProductGrade, type ProductScoreBreakdown } from '../lib/scoring/calculateProductScore';

type Difficulty = '초보' | '중수' | '고수';
type SourcingStatus = '발견' | '분석중' | '샘플 주문' | '소싱 완료' | '상품 등록' | '판매중' | '보류' | '실패';
type View = 'dashboard' | 'sourcing' | 'results' | 'detail' | 'favorites' | 'calculator';

type SourcingProduct = {
  id: string;
  name: string;
  category: string;
  keywordType: string[];
  price: number;
  supplierCost: number;
  shippingCost: number;
  avgReview: number;
  searchVolume: number;
  growth30d: number;
  estimatedSales: number;
  estimatedRevenue: number;
  competitionLevel: number;
  rocketRatio: number;
  adRatio: number;
  moq: number;
  difficulty: Difficulty;
  supplier: string;
  supplierUrl: string;
  score: ProductScoreBreakdown;
  status: SourcingStatus;
  competitors: { name: string; price: number; reviews: number; sales: number; delivery: string }[];
  targets: string[];
  weaknesses: string[];
  strategy: string[];
  keywords: string[];
};

const fmt = (value: number) => value.toLocaleString('ko-KR');
const won = (value: number) => `${fmt(value)}원`;

const categories = ['생활', '주방', '패션', '스포츠', '자동차', '반려동물', '육아', '문구', 'DIY', '기타'];
const keywordTypes = ['블루오션', '급상승', '시즌상품', '신규시장', '고마진', '저경쟁', '리뷰장벽 낮음'];
const statuses: SourcingStatus[] = ['발견', '분석중', '샘플 주문', '소싱 완료', '상품 등록', '판매중', '보류', '실패'];

const productSeeds = [
  ['냉감 스포츠 마스크', '스포츠', 16900, 2500, 82, 82400, 67, 1430, 18, 70, 30, '초보'],
  ['차량 햇빛가리개', '자동차', 15900, 3300, 96, 76200, 58, 1210, 24, 38, 22, '초보'],
  ['휴대용 신발건조기', '생활', 34900, 9800, 144, 54200, 49, 730, 31, 44, 26, '중수'],
  ['냉감 침대패드', '생활', 42900, 14500, 238, 69800, 41, 850, 42, 62, 35, '중수'],
  ['스포츠 팔토시 2종', '스포츠', 12900, 2100, 61, 48800, 72, 980, 17, 48, 18, '초보'],
  ['실리콘 음식덮개', '주방', 11900, 1800, 44, 36200, 35, 640, 22, 24, 20, '초보'],
  ['캠핑 접이식 선반', '스포츠', 29900, 9200, 312, 31500, 28, 410, 46, 36, 31, '중수'],
  ['반려동물 쿨매트', '반려동물', 21900, 5900, 104, 40700, 63, 690, 27, 52, 26, '초보'],
  ['유아 모서리 보호대', '육아', 13900, 2600, 68, 29600, 32, 530, 26, 29, 19, '초보'],
  ['무타공 욕실 선반', '생활', 18900, 4300, 352, 45200, 24, 600, 55, 58, 42, '중수'],
  ['저소음 탁상 선풍기', '생활', 24900, 7300, 211, 88200, 46, 1220, 48, 68, 44, '중수'],
  ['아이스 넥쿨러', '스포츠', 17900, 4100, 58, 61100, 75, 1040, 20, 56, 24, '초보'],
  ['차량용 틈새 수납함', '자동차', 14900, 3600, 173, 34200, 19, 430, 39, 31, 28, '초보'],
  ['프리미엄 빨래 건조볼', '생활', 10900, 1900, 92, 22700, 27, 360, 33, 12, 16, '초보'],
  ['초경량 등산 무릎보호대', '스포츠', 19900, 5100, 131, 37800, 44, 560, 29, 35, 21, '초보'],
  ['주방 싱크대 배수망', '주방', 8900, 950, 38, 31800, 31, 720, 19, 18, 16, '초보'],
  ['강아지 산책 물병', '반려동물', 15900, 3400, 88, 28600, 39, 480, 24, 26, 18, '초보'],
  ['멀티 케이블 정리함', 'DIY', 12900, 2300, 75, 25100, 22, 370, 28, 16, 20, '초보'],
  ['문구 데스크 정리 트레이', '문구', 13900, 2900, 53, 18400, 18, 260, 21, 11, 14, '초보'],
  ['접이식 장바구니 캐리어', '생활', 32900, 11800, 422, 39800, 29, 390, 61, 55, 37, '고수'],
  ['여름 자외선 차단 모자', '패션', 18900, 4200, 126, 51600, 54, 820, 32, 46, 29, '초보'],
  ['아기 이유식 큐브 트레이', '육아', 14900, 3100, 73, 26400, 37, 410, 25, 22, 18, '초보'],
  ['차량용 무선 청소기 필터', '자동차', 9900, 1600, 45, 21900, 26, 300, 23, 13, 15, '초보'],
  ['캠핑 식기 건조망', '스포츠', 15900, 3700, 117, 29300, 43, 440, 35, 31, 24, '초보'],
  ['방수 네임스티커 세트', '문구', 7900, 900, 39, 17800, 21, 310, 18, 9, 12, '초보'],
  ['고양이 창문 해먹', '반려동물', 24900, 7900, 286, 33600, 34, 360, 49, 42, 30, '중수'],
  ['실리콘 에어프라이어 용기', '주방', 13900, 2400, 64, 44700, 52, 770, 23, 33, 24, '초보'],
  ['욕실 곰팡이 제거젤', '생활', 9900, 1500, 185, 38100, 16, 610, 43, 37, 32, '중수'],
  ['DIY 가구 이동 패드', 'DIY', 11900, 2100, 58, 20600, 25, 290, 27, 14, 17, '초보'],
  ['스마트폰 방수팩', '스포츠', 10900, 1700, 91, 58800, 61, 980, 26, 49, 27, '초보'],
] as const;

const createProducts = (): SourcingProduct[] => productSeeds.map((seed, index) => {
  const [name, category, price, supplierCost, avgReview, searchVolume, growth30d, estimatedSales, competitionLevel, rocketRatio, adRatio, difficulty] = seed;
  const margin = Math.round(((price - supplierCost - 3000 - price * 0.12) / price) * 100);
  const score = calculateProductScore({
    searchVolume,
    competitionLevel,
    avgReview,
    growth30d,
    expectedMargin: margin,
    priceStability: index % 4 === 0 ? 4 : 5,
    seasonality: ['스포츠', '생활', '자동차'].includes(category) ? 5 : 3,
    supplierReliability: supplierCost < price * 0.35 ? 5 : 4,
  });

  return {
    id: `hp-${index + 1}`,
    name,
    category,
    keywordType: [
      score.grade === 'S' ? '블루오션' : '저경쟁',
      growth30d >= 45 ? '급상승' : '신규시장',
      margin >= 35 ? '고마진' : '리뷰장벽 낮음',
      ['스포츠', '생활', '자동차'].includes(category) ? '시즌상품' : '신규시장',
    ],
    price,
    supplierCost,
    shippingCost: 3000,
    avgReview,
    searchVolume,
    growth30d,
    estimatedSales,
    estimatedRevenue: price * estimatedSales,
    competitionLevel,
    rocketRatio,
    adRatio,
    moq: index % 5 === 0 ? 100 : index % 3 === 0 ? 50 : 20,
    difficulty,
    supplier: index % 2 === 0 ? '1688 도매 후보' : '국내 도매 후보',
    supplierUrl: 'https://example.com/supplier',
    score,
    status: index < 8 ? '발견' : index < 14 ? '분석중' : index < 20 ? '보류' : '샘플 주문',
    competitors: Array.from({ length: 10 }, (_, rank) => ({
      name: `${name} 경쟁상품 ${rank + 1}`,
      price: Math.round(price * (0.88 + rank * 0.025) / 100) * 100,
      reviews: Math.max(12, avgReview + (rank - 4) * 18),
      sales: Math.max(80, estimatedSales - rank * 75),
      delivery: rank % 3 === 0 ? '로켓' : '일반',
    })),
    targets: ['초보 셀러', '쿠팡 검색 구매자', '선물/시즌 수요 고객'],
    weaknesses: ['상위 상품의 상세 설명 부족', '세트 구성 차별화 부족', '사용 장면 이미지 부족'],
    strategy: ['2개 세트 또는 사은품 구성', '기능성 키워드 전면 배치', '실사용 이미지와 비교표 강화'],
    keywords: [name.replace(/\s/g, ''), `${category}추천`, '쿠팡소싱', '초보셀러', '고마진상품'],
  };
});

const mockProducts = createProducts();

const gradeClass: Record<ProductGrade, string> = {
  S: 'bg-red-50 text-red-700 ring-red-200',
  A: 'bg-orange-50 text-orange-700 ring-orange-200',
  B: 'bg-blue-50 text-blue-700 ring-blue-200',
  C: 'bg-slate-100 text-slate-700 ring-slate-200',
  D: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
};

function GradeBadge({ grade }: { grade: ProductGrade }) {
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

export function SourcingFinder() {
  const [view, setView] = useState<View>('dashboard');
  const [difficulty, setDifficulty] = useState<Difficulty>('초보');
  const [category, setCategory] = useState('생활');
  const [minPrice, setMinPrice] = useState(10000);
  const [maxPrice, setMaxPrice] = useState(50000);
  const [maxReview, setMaxReview] = useState(300);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['블루오션', '급상승', '시즌상품']);
  const [query, setQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState(mockProducts[0].id);
  const [favorites, setFavorites] = useState<string[]>(mockProducts.slice(0, 5).map((product) => product.id));
  const [statusById, setStatusById] = useState<Record<string, SourcingStatus>>({});
  const [calcProductId, setCalcProductId] = useState(mockProducts[0].id);
  const [calcSupply, setCalcSupply] = useState(mockProducts[0].supplierCost);
  const [calcAd, setCalcAd] = useState(10);
  const [calcOther, setCalcOther] = useState(500);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return mockProducts
      .filter((product) => product.difficulty === difficulty || difficulty === '고수')
      .filter((product) => category === '기타' || product.category === category || query.trim())
      .filter((product) => product.price >= minPrice && product.price <= maxPrice)
      .filter((product) => product.avgReview <= maxReview)
      .filter((product) => selectedTypes.length === 0 || selectedTypes.some((type) => product.keywordType.includes(type)))
      .filter((product) => !normalizedQuery || product.name.toLowerCase().includes(normalizedQuery) || product.category.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => b.score.total - a.score.total);
  }, [category, difficulty, maxPrice, maxReview, minPrice, query, selectedTypes]);

  const selectedProduct = mockProducts.find((product) => product.id === selectedProductId) || mockProducts[0];
  const calcProduct = mockProducts.find((product) => product.id === calcProductId) || mockProducts[0];
  const coupangFee = Math.round(calcProduct.price * 0.12);
  const adCost = Math.round(calcProduct.price * (calcAd / 100));
  const totalCost = calcSupply + calcProduct.shippingCost + coupangFee + adCost + calcOther;
  const netProfit = calcProduct.price - totalCost;
  const netMargin = Math.round((netProfit / calcProduct.price) * 100);

  const openDetail = (product: SourcingProduct) => {
    setSelectedProductId(product.id);
    setCalcProductId(product.id);
    setCalcSupply(product.supplierCost);
    setView('detail');
  };

  const runSourcing = () => {
    const first = filteredProducts[0] || mockProducts[0];
    setSelectedProductId(first.id);
    setCalcProductId(first.id);
    setCalcSupply(first.supplierCost);
    setView('results');
  };

  const toggleType = (type: string) => {
    setSelectedTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  };

  const toggleFavorite = (id: string) => {
    setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const updateStatus = (id: string, status: SourcingStatus) => {
    setStatusById((current) => ({ ...current, [id]: status }));
  };

  const exportCsv = () => {
    const rows = [['상품명', '등급', 'AI점수', '예상월매출', '평균리뷰', '예상마진'], ...filteredProducts.map((product) => [
      product.name,
      product.score.grade,
      String(product.score.total),
      String(product.estimatedRevenue),
      String(product.avgReview),
      `${Math.round(((product.price - product.supplierCost - product.shippingCost - product.price * 0.12) / product.price) * 100)}%`,
    ])];
    const blob = new Blob(['\ufeff' + rows.map((row) => row.join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'hunpro-ai-sourcing.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const nav = [
    ['dashboard', BarChart3, '대시보드'],
    ['sourcing', Sparkles, 'AI 훈프로'],
    ['results', LineChart, '상품분석'],
    ['favorites', Heart, '관심상품'],
    ['calculator', Calculator, '마진계산기'],
    ['dashboard', Settings, '설정'],
  ] as const;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="flex min-h-screen">
        <aside className="sticky top-16 h-[calc(100vh-4rem)] w-64 border-r border-slate-200 bg-white px-4 py-6">
          <div className="mb-7">
            <p className="text-xs font-black text-blue-600">HUNPRO AI SOURCING</p>
            <h2 className="mt-1 text-lg font-black tracking-tight">AI 상품 소싱 시스템</h2>
          </div>
          <nav className="space-y-1">
            {nav.map(([key, Icon, label]) => (
              <button
                key={label}
                onClick={() => setView(key)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition ${view === key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 px-8 py-7">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-black tracking-tight">HUNPRO AI SOURCING</h1>
              <p className="mt-1 text-sm font-medium text-slate-500">판단 결과를 먼저 보여주고, 상세 숫자는 아래에서 확인합니다.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-100">
                <Download className="h-4 w-4" /> CSV
              </button>
              <button onClick={() => setView('sourcing')} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-slate-800">
                <Sparkles className="h-4 w-4" /> AI 소싱 시작
              </button>
            </div>
          </div>

          {view === 'dashboard' && (
            <section className="space-y-6">
              <div className="grid grid-cols-4 gap-4">
                <MetricCard label="오늘 분석 상품" value="182,431" sub="mock data 기반 MVP" />
                <MetricCard label="발견 키워드" value="1,283" sub="급상승/시즌 포함" />
                <MetricCard label="S등급 상품" value={`${mockProducts.filter((product) => product.score.grade === 'S').length}`} sub="90점 이상" />
                <MetricCard label="신규 급상승" value="38" sub="30일 성장률 기준" />
              </div>
              <div className="grid grid-cols-[1.25fr_0.75fr] gap-5">
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-black">오늘의 훈프로 TOP 5</h3>
                    <button onClick={() => setView('results')} className="text-sm font-black text-blue-600">전체 보기</button>
                  </div>
                  <div className="space-y-3">
                    {mockProducts.slice(0, 5).map((product, index) => (
                      <button key={product.id} onClick={() => openDetail(product)} className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-4 py-3 text-left hover:border-blue-200 hover:bg-blue-50">
                        <div className="flex items-center gap-3">
                          <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-950 text-sm font-black text-white">{index + 1}</span>
                          <div>
                            <p className="font-black text-slate-950">{product.name}</p>
                            <p className="text-xs font-medium text-slate-500">{product.category} · {product.score.recommendation}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <GradeBadge grade={product.score.grade} />
                          <span className="text-lg font-black text-blue-600">{product.score.total}점</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-black">AI SCORE 구조</h3>
                  <div className="mt-4 space-y-3">
                    {[
                      ['시장 수요', 20], ['경쟁 강도', 20], ['리뷰 장벽', 15], ['성장성', 15],
                      ['예상 마진', 15], ['가격 안정성', 5], ['시즌성', 5], ['공급 가능성', 5],
                    ].map(([label, points]) => (
                      <div key={label} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm">
                        <span className="font-bold text-slate-600">{label}</span>
                        <span className="font-black text-slate-950">{points}점</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {view === 'sourcing' && (
            <section className="grid grid-cols-[360px_1fr] gap-5">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center gap-2">
                  <SlidersHorizontal className="h-5 w-5 text-blue-600" />
                  <h3 className="text-lg font-black">검색 조건</h3>
                </div>
                <div className="space-y-5">
                  <label className="block">
                    <span className="text-xs font-black text-slate-500">키워드</span>
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                      <Search className="h-4 w-4 text-slate-400" />
                      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: 냉감 마스크" className="w-full bg-transparent text-sm font-bold outline-none" />
                    </div>
                  </label>
                  <div>
                    <p className="text-xs font-black text-slate-500">판매 난이도</p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {(['초보', '중수', '고수'] as Difficulty[]).map((item) => (
                        <button key={item} onClick={() => setDifficulty(item)} className={`rounded-lg px-3 py-2 text-sm font-black ${difficulty === item ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{item}</button>
                      ))}
                    </div>
                  </div>
                  <label className="block">
                    <span className="text-xs font-black text-slate-500">카테고리</span>
                    <select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none">
                      {categories.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label>
                      <span className="text-xs font-black text-slate-500">최소 판매가</span>
                      <input type="number" value={minPrice} onChange={(event) => setMinPrice(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
                    </label>
                    <label>
                      <span className="text-xs font-black text-slate-500">최대 판매가</span>
                      <input type="number" value={maxPrice} onChange={(event) => setMaxPrice(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold outline-none" />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-xs font-black text-slate-500">최대 리뷰</span>
                    <select value={maxReview} onChange={(event) => setMaxReview(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none">
                      {[100, 300, 500, 1000, 5000].map((item) => <option key={item} value={item}>{fmt(item)}개</option>)}
                    </select>
                  </label>
                  <div>
                    <p className="text-xs font-black text-slate-500">키워드 유형</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {keywordTypes.map((type) => (
                        <button key={type} onClick={() => toggleType(type)} className={`rounded-lg px-3 py-2 text-left text-xs font-black ring-1 ${selectedTypes.includes(type) ? 'bg-orange-50 text-orange-700 ring-orange-200' : 'bg-white text-slate-500 ring-slate-200'}`}>
                          {selectedTypes.includes(type) ? '선택됨 · ' : ''}{type}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={runSourcing} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-black text-white shadow-sm hover:bg-blue-700">
                    <Sparkles className="h-4 w-4" /> AI 훈프로 찾기
                  </button>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-black">검색 전 미리보기</h3>
                <p className="mt-1 text-sm font-medium text-slate-500">조건에 맞는 추천 후보 {filteredProducts.length}개가 준비되었습니다.</p>
                <div className="mt-5 grid grid-cols-3 gap-4">
                  {filteredProducts.slice(0, 6).map((product) => (
                    <button key={product.id} onClick={() => openDetail(product)} className="rounded-lg border border-slate-200 p-4 text-left hover:border-blue-300 hover:bg-blue-50">
                      <div className="flex items-center justify-between">
                        <GradeBadge grade={product.score.grade} />
                        <span className="text-lg font-black text-blue-600">{product.score.total}</span>
                      </div>
                      <p className="mt-3 font-black">{product.name}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">예상 월매출 {won(product.estimatedRevenue)}</p>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {view === 'results' && (
            <section className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div>
                  <h3 className="text-lg font-black">추천 상품 TOP {filteredProducts.length}</h3>
                  <p className="text-sm font-medium text-slate-500">S/A/B 등급과 추천 판단을 먼저 확인하세요.</p>
                </div>
                <button onClick={() => setView('sourcing')} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-black text-slate-700">조건 수정</button>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {filteredProducts.map((product) => (
                  <article key={product.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <GradeBadge grade={product.score.grade} />
                      <button onClick={() => toggleFavorite(product.id)} className={`rounded-lg p-2 ${favorites.includes(product.id) ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                        <Heart className="h-4 w-4" fill={favorites.includes(product.id) ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                    <p className="mt-4 text-lg font-black">{product.name}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <p className="rounded-md bg-slate-50 p-2"><span className="block text-xs font-bold text-slate-500">AI SCORE</span><b>{product.score.total} / 100</b></p>
                      <p className="rounded-md bg-slate-50 p-2"><span className="block text-xs font-bold text-slate-500">추천</span><b>{product.score.recommendation}</b></p>
                      <p className="rounded-md bg-slate-50 p-2"><span className="block text-xs font-bold text-slate-500">예상 월매출</span><b>{won(product.estimatedRevenue)}</b></p>
                      <p className="rounded-md bg-slate-50 p-2"><span className="block text-xs font-bold text-slate-500">평균 리뷰</span><b>{fmt(product.avgReview)}개</b></p>
                    </div>
                    <button onClick={() => openDetail(product)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 py-2.5 text-sm font-black text-white">
                      상세 분석 <ChevronRight className="h-4 w-4" />
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}

          {view === 'detail' && (
            <section className="grid grid-cols-[1fr_360px] gap-5">
              <div className="space-y-5">
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <GradeBadge grade={selectedProduct.score.grade} />
                      <h3 className="mt-3 text-2xl font-black">{selectedProduct.name}</h3>
                      <p className="mt-1 text-sm font-bold text-slate-500">{selectedProduct.difficulty} 추천 · {selectedProduct.score.recommendation}</p>
                    </div>
                    <span className="text-4xl font-black text-blue-600">{selectedProduct.score.total}</span>
                  </div>
                  <div className="mt-5 grid grid-cols-4 gap-3">
                    <MetricCard label="월 검색량" value={fmt(selectedProduct.searchVolume)} />
                    <MetricCard label="30일 성장률" value={`+${selectedProduct.growth30d}%`} />
                    <MetricCard label="평균 판매가" value={won(selectedProduct.price)} />
                    <MetricCard label="예상 월매출" value={won(selectedProduct.estimatedRevenue)} />
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-black">경쟁상품 TOP 10</h3>
                  <table className="mt-4 w-full text-sm">
                    <thead className="bg-slate-50 text-xs font-black text-slate-500">
                      <tr><th className="px-3 py-3 text-left">순위</th><th className="px-3 py-3 text-left">상품</th><th className="px-3 py-3 text-right">가격</th><th className="px-3 py-3 text-right">리뷰</th><th className="px-3 py-3 text-right">판매량 추정</th><th className="px-3 py-3 text-center">배송</th></tr>
                    </thead>
                    <tbody>
                      {selectedProduct.competitors.map((competitor, index) => (
                        <tr key={competitor.name} className="border-b border-slate-100">
                          <td className="px-3 py-3 font-bold">{index + 1}</td>
                          <td className="px-3 py-3 font-bold">{competitor.name}</td>
                          <td className="px-3 py-3 text-right">{won(competitor.price)}</td>
                          <td className="px-3 py-3 text-right">{fmt(competitor.reviews)}</td>
                          <td className="px-3 py-3 text-right">{fmt(competitor.sales)}</td>
                          <td className="px-3 py-3 text-center">{competitor.delivery}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-black">AI 시장 분석</h3>
                  <p className="mt-3 text-sm font-semibold leading-7 text-slate-700">
                    이 시장은 최근 30일 검색 성장률이 +{selectedProduct.growth30d}%이며 평균 리뷰가 {fmt(selectedProduct.avgReview)}개로 신규 판매자 진입 가능성이 있습니다.
                    로켓 판매 비율은 {selectedProduct.rocketRatio}%이고 광고상품 비율은 {selectedProduct.adRatio}%입니다. 추천 진입 가격은 {won(Math.round(selectedProduct.price * 0.94 / 100) * 100)} ~ {won(Math.round(selectedProduct.price * 1.06 / 100) * 100)}입니다.
                    표시된 판매량과 매출은 mock data 기준 추정값입니다.
                  </p>
                </div>
              </div>
              <aside className="space-y-5">
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-black">소싱상품 매칭</h3>
                  <div className="mt-4 space-y-3 text-sm">
                    <p className="flex justify-between"><span className="font-bold text-slate-500">공급처</span><b>{selectedProduct.supplier}</b></p>
                    <p className="flex justify-between"><span className="font-bold text-slate-500">공급가</span><b>{won(selectedProduct.supplierCost)}</b></p>
                    <p className="flex justify-between"><span className="font-bold text-slate-500">MOQ</span><b>{selectedProduct.moq}개</b></p>
                    <p className="flex justify-between"><span className="font-bold text-slate-500">유사도</span><b>91%</b></p>
                  </div>
                  <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 py-2.5 text-sm font-black text-slate-700">
                    <Upload className="h-4 w-4" /> 수동 후보 등록
                  </button>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-black">AI 판매 전략</h3>
                  <div className="mt-4 space-y-4 text-sm">
                    <div><p className="font-black text-slate-500">타겟 고객</p><p className="mt-1 font-semibold">{selectedProduct.targets.join(', ')}</p></div>
                    <div><p className="font-black text-slate-500">경쟁사 약점</p><p className="mt-1 font-semibold">{selectedProduct.weaknesses.join(', ')}</p></div>
                    <div><p className="font-black text-slate-500">추천 상품 전략</p><p className="mt-1 font-semibold">{selectedProduct.strategy.join(', ')}</p></div>
                    <div><p className="font-black text-slate-500">검색 키워드</p><p className="mt-1 font-semibold">{selectedProduct.keywords.join(', ')}</p></div>
                  </div>
                </div>
                <button onClick={() => setView('calculator')} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-black text-white">
                  <Calculator className="h-4 w-4" /> 마진 계산
                </button>
              </aside>
            </section>
          )}

          {view === 'favorites' && (
            <section className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <MetricCard label="S급" value={`${mockProducts.filter((product) => favorites.includes(product.id) && product.score.grade === 'S').length}개`} />
                <MetricCard label="A급" value={`${mockProducts.filter((product) => favorites.includes(product.id) && product.score.grade === 'A').length}개`} />
                <MetricCard label="보류" value={`${mockProducts.filter((product) => favorites.includes(product.id) && (statusById[product.id] || product.status) === '보류').length}개`} />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                {mockProducts.filter((product) => favorites.includes(product.id)).map((product) => (
                  <div key={product.id} className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <Bookmark className="h-5 w-5 text-red-500" fill="currentColor" />
                      <div><p className="font-black">{product.name}</p><p className="text-xs font-bold text-slate-500">{product.score.grade}등급 · {product.score.total}점</p></div>
                    </div>
                    <select value={statusById[product.id] || product.status} onChange={(event) => updateStatus(product.id, event.target.value as SourcingStatus)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold">
                      {statuses.map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </section>
          )}

          {view === 'calculator' && (
            <section className="grid grid-cols-[420px_1fr] gap-5">
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-black">마진 계산기</h3>
                <div className="mt-5 space-y-4">
                  <label className="block"><span className="text-xs font-black text-slate-500">상품</span><select value={calcProductId} onChange={(event) => { const product = mockProducts.find((item) => item.id === event.target.value) || mockProducts[0]; setCalcProductId(product.id); setCalcSupply(product.supplierCost); }} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold">{mockProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
                  <label className="block"><span className="text-xs font-black text-slate-500">공급가격</span><input type="number" value={calcSupply} onChange={(event) => setCalcSupply(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" /></label>
                  <label className="block"><span className="text-xs font-black text-slate-500">광고비</span><input type="number" value={calcAd} onChange={(event) => setCalcAd(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" /></label>
                  <label className="block"><span className="text-xs font-black text-slate-500">기타 비용</span><input type="number" value={calcOther} onChange={(event) => setCalcOther(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" /></label>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-black">{calcProduct.name}</h3>
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <MetricCard label="판매가격" value={won(calcProduct.price)} />
                  <MetricCard label="총 비용" value={won(totalCost)} />
                  <MetricCard label="예상 순이익" value={won(netProfit)} />
                  <MetricCard label="예상 마진율" value={`${netMargin}%`} />
                </div>
                <div className={`mt-5 rounded-lg p-5 ${netMargin >= 30 ? 'bg-emerald-50 text-emerald-800' : 'bg-orange-50 text-orange-800'}`}>
                  <div className="flex items-center gap-2 font-black">
                    {netMargin >= 30 ? <CheckCircle2 className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                    {netMargin >= 30 ? '마진 구조 양호' : '원가 또는 광고비 재검토'}
                  </div>
                  <p className="mt-2 text-sm font-semibold">쿠팡 수수료는 MVP 기준 12%로 계산했습니다. 실제 판매 전 카테고리별 수수료와 배송 정책을 확인하세요.</p>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
