/**
 * 소싱 파인더 v2
 *
 * 네이버 쇼핑검색 API 종료(2026-07)에 따라 전면 재구축:
 *  1) 니치 키워드 발굴 — 네이버 검색광고 API: 실제 월간검색량 + 광고경쟁도로
 *     "검색량은 많은데 경쟁은 적은" 키워드를 찾는다
 *  2) 쿠팡 상품 분석 — 쿠팡 파트너스 API: 실제 로켓배송 여부(isRocket)로
 *     로켓 비중이 낮은(= 일반 셀러가 진입하기 쉬운) 시장을 판별
 *  3) 카테고리 베스트 — 쿠팡 공식 베스트셀러 중 로켓이 아닌 상품 = 소싱 기회
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  Search, TrendingUp, DollarSign, ChevronRight, Loader2, LayoutDashboard,
  ExternalLink, Sparkles, Tent, PawPrint, Sofa, Shirt, Cpu, Download, X,
  ArrowUpDown, Heart, UtensilsCrossed, Car, Book, Baby, Rocket, Store,
  KeyRound, Crown, Gamepad2, Pencil, Apple, Dumbbell, RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ProductSkeleton } from './Skeleton';
import { getToken } from '../lib/auth';

// ─── Types ────────────────────────────────────────────────────────────────────
interface KeywordStat {
  keyword: string;
  monthlyPcVolume: number;
  monthlyMobileVolume: number;
  monthlyVolume: number;
  monthlyClicks: number;
  compIdx: string;
  adDepth: number;
  volumeScore: number;
  competition: number;
  opportunityScore: number;
  grade: 'Great' | 'Good' | 'Normal' | 'Bad';
}

interface Product {
  productId: string;
  productName: string;
  productPrice: number;
  productImage: string;
  productUrl: string;
  categoryName: string;
  isRocket: boolean;
  isFreeShipping: boolean;
  rank: number;
  estimated1688Price?: number;
  calculated: {
    exposureScore: number;
    entryEase: number;
    priceFit: number;
    opportunityScore: number;
    grade: 'Great' | 'Good' | 'Normal' | 'Bad';
  };
}

interface Market {
  totalCollected: number;
  inPriceRange: number;
  rocketCount: number;
  generalCount: number;
  rocketRatio: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  keywordVolume: number;
  entryVerdict: 'Excellent' | 'Good' | 'Fair' | 'Bad';
}

// ─── 카테고리 (쿠팡 파트너스 베스트 카테고리 ID) ─────────────────────────────
const BEST_CATEGORIES = [
  { id: '1001', label: '여성패션', icon: Shirt },
  { id: '1002', label: '남성패션', icon: Shirt },
  { id: '1030', label: '유아동패션', icon: Baby },
  { id: '1010', label: '뷰티', icon: Heart },
  { id: '1011', label: '출산/유아동', icon: Baby },
  { id: '1012', label: '식품', icon: Apple },
  { id: '1013', label: '주방용품', icon: UtensilsCrossed },
  { id: '1014', label: '생활용품', icon: Sparkles },
  { id: '1015', label: '홈인테리어', icon: Sofa },
  { id: '1016', label: '가전디지털', icon: Cpu },
  { id: '1017', label: '스포츠/레저', icon: Tent },
  { id: '1018', label: '자동차용품', icon: Car },
  { id: '1019', label: '도서/음반', icon: Book },
  { id: '1020', label: '완구/취미', icon: Gamepad2 },
  { id: '1021', label: '문구/오피스', icon: Pencil },
  { id: '1024', label: '헬스/건강식품', icon: Dumbbell },
  { id: '1029', label: '반려동물', icon: PawPrint },
];

// ─── 공통 헬퍼 ────────────────────────────────────────────────────────────────
const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const gradeStyle = (grade: string) => {
  if (grade === 'Great') return 'text-emerald-600 bg-emerald-50 ring-emerald-500/20';
  if (grade === 'Good') return 'text-indigo-600 bg-indigo-50 ring-indigo-500/20';
  if (grade === 'Normal') return 'text-amber-600 bg-amber-50 ring-amber-500/20';
  return 'text-rose-600 bg-rose-50 ring-rose-500/20';
};

const compStyle = (compIdx: string) => {
  if (compIdx === '낮음') return 'text-emerald-600 bg-emerald-50 ring-emerald-500/20';
  if (compIdx === '중간') return 'text-amber-600 bg-amber-50 ring-amber-500/20';
  return 'text-rose-600 bg-rose-50 ring-rose-500/20';
};

// ─── 시장 요약 카드 ───────────────────────────────────────────────────────────
const MarketSummary = ({ market, title }: { market: Market; title: string }) => {
  const verdictText: Record<Market['entryVerdict'], { label: string; desc: string; color: string }> = {
    Excellent: { label: '진입 기회 높음', desc: '로켓 비중이 낮아 일반 셀러가 노려볼 만한 시장입니다', color: 'text-emerald-600' },
    Good: { label: '진입 가능', desc: '로켓과 일반 셀러가 공존하는 시장입니다', color: 'text-indigo-600' },
    Fair: { label: '진입 주의', desc: '로켓 비중이 높은 편이라 차별화가 필요합니다', color: 'text-amber-600' },
    Bad: { label: '진입 비추천', desc: '쿠팡 직매입(로켓)이 장악한 시장입니다', color: 'text-rose-600' },
  };
  const v = verdictText[market.entryVerdict];

  return (
    <div className="bg-white rounded-[24px] p-6 border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <h3 className="text-base font-black text-slate-800">{title} <span className="text-slate-400 font-bold">시장 분석</span></h3>
        <span className={`text-xs font-black ${v.color}`}>{v.label} · {v.desc}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">로켓 vs 일반 (상위 {market.totalCollected}개)</p>
          <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-slate-200 mb-2">
            <div style={{ width: `${market.rocketRatio}%` }} className="h-full bg-rose-500 transition-all duration-500" />
            <div style={{ width: `${100 - market.rocketRatio}%` }} className="h-full bg-emerald-500 transition-all duration-500" />
          </div>
          <div className="flex justify-between text-[11px] font-black">
            <span className="text-rose-500">로켓 {market.rocketRatio}%</span>
            <span className="text-emerald-600">일반 {100 - market.rocketRatio}%</span>
          </div>
        </div>
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">평균 판매가</p>
          <p className="text-xl font-black text-amber-600">{market.avgPrice.toLocaleString()}원</p>
          <p className="text-[10px] text-slate-400 font-bold mt-1">{market.minPrice.toLocaleString()} ~ {market.maxPrice.toLocaleString()}원</p>
        </div>
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">일반배송 상품</p>
          <p className="text-xl font-black text-emerald-600">{market.generalCount}개</p>
          <p className="text-[10px] text-slate-400 font-bold mt-1">로켓 경쟁 없이 노출 가능한 자리</p>
        </div>
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{market.keywordVolume > 0 ? '월간 검색량' : '수집 상품'}</p>
          <p className="text-xl font-black text-indigo-600">
            {market.keywordVolume > 0 ? market.keywordVolume.toLocaleString() : market.totalCollected}
            <span className="text-xs text-slate-400 font-bold ml-1">{market.keywordVolume > 0 ? '회/월' : '개'}</span>
          </p>
          <p className="text-[10px] text-slate-400 font-bold mt-1">{market.keywordVolume > 0 ? '네이버 검색광고 실데이터' : '쿠팡 파트너스 API 실데이터'}</p>
        </div>
      </div>
    </div>
  );
};

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export function SourcingFinder() {
  // 서브탭
  const [subTab, setSubTab] = useState<'finder' | 'best'>('finder');

  // 1) 키워드 발굴
  const [seed, setSeed] = useState('');
  const [kwLoading, setKwLoading] = useState(false);
  const [kwError, setKwError] = useState<string | null>(null);
  const [seedStat, setSeedStat] = useState<KeywordStat | null>(null);
  const [keywords, setKeywords] = useState<KeywordStat[]>([]);
  const [kwCached, setKwCached] = useState(false);
  const [kwSortKey, setKwSortKey] = useState<'opportunityScore' | 'monthlyVolume' | 'monthlyClicks' | 'competition'>('opportunityScore');
  const [compFilter, setCompFilter] = useState<'all' | '낮음' | '중간' | '높음'>('all');
  const [minVolume, setMinVolume] = useState('100');

  // 2) 쿠팡 상품 분석
  const [activeKeyword, setActiveKeyword] = useState<string | null>(null);
  const [prodLoading, setProdLoading] = useState(false);
  const [prodError, setProdError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [market, setMarket] = useState<Market | null>(null);
  const [servedFrom, setServedFrom] = useState<string>('fresh');
  const [rocketFilter, setRocketFilter] = useState<'all' | 'general' | 'rocket'>('all');
  const [gradeFilter, setGradeFilter] = useState<'all' | 'Great' | 'Good' | 'Normal' | 'Bad'>('all');
  const [prodSort, setProdSort] = useState<'opportunityScore' | 'rank' | 'priceAsc'>('opportunityScore');
  const productsRef = useRef<HTMLDivElement>(null);

  // 3) 카테고리 베스트
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // 수익 시뮬레이션 드로어
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [wholesalePrice, setWholesalePrice] = useState<number>(0);
  const [shippingFee] = useState(3000);
  const [sourcingMultiplier, setSourcingMultiplier] = useState<number>(300);
  const [purchasePopupProduct, setPurchasePopupProduct] = useState<Product | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('sourcingMultiplier');
    if (saved) setSourcingMultiplier(Number(saved));
  }, []);

  const handleMultiplierChange = (val: number) => {
    setSourcingMultiplier(val);
    localStorage.setItem('sourcingMultiplier', String(val));
  };

  // ─── API 호출 ───────────────────────────────────────────────────────────────
  const fetchKeywords = async (kw: string) => {
    setKwLoading(true);
    setKwError(null);
    try {
      const res = await fetch(`/api/sourcing?type=keywords&seed=${encodeURIComponent(kw)}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || data.error) {
        setKwError(data.error || '키워드 조회 실패');
        setSeedStat(null);
        setKeywords([]);
        return;
      }
      setSeedStat(data.seedStat || null);
      setKeywords(Array.isArray(data.keywords) ? data.keywords : []);
      setKwCached(!!data.cached);
    } catch (e: any) {
      setKwError(e.message);
      setKeywords([]);
    } finally {
      setKwLoading(false);
    }
  };

  const fetchProducts = async (kw: string, volume = 0) => {
    setActiveKeyword(kw);
    setActiveCategory(null);
    setProdLoading(true);
    setProdError(null);
    setTimeout(() => productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    try {
      const params = new URLSearchParams({ type: 'products', keyword: kw });
      if (volume > 0) params.set('volume', String(volume));
      const res = await fetch(`/api/sourcing?${params.toString()}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || (data.error && !data.products?.length)) {
        setProdError(data.error || '상품 조회 실패');
        setProducts([]);
        setMarket(null);
        return;
      }
      applyProductPayload(data);
    } catch (e: any) {
      setProdError(e.message);
      setProducts([]);
      setMarket(null);
    } finally {
      setProdLoading(false);
    }
  };

  const fetchBest = async (categoryId: string) => {
    setActiveCategory(categoryId);
    setActiveKeyword(null);
    setProdLoading(true);
    setProdError(null);
    try {
      const res = await fetch(`/api/sourcing?type=best&categoryId=${categoryId}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || (data.error && !data.products?.length)) {
        setProdError(data.error || '베스트 상품 조회 실패');
        setProducts([]);
        setMarket(null);
        return;
      }
      applyProductPayload(data);
    } catch (e: any) {
      setProdError(e.message);
      setProducts([]);
      setMarket(null);
    } finally {
      setProdLoading(false);
    }
  };

  const applyProductPayload = (data: any) => {
    const savedPrices = JSON.parse(localStorage.getItem('1688prices') || '{}');
    const enriched = (data.products || []).map((p: Product) => ({
      ...p,
      estimated1688Price: savedPrices[p.productId] || undefined,
    }));
    setProducts(enriched);
    setMarket(data.market || null);
    setServedFrom(data.servedFrom || 'fresh');
  };

  // ─── 수익 계산 ──────────────────────────────────────────────────────────────
  const calculateProfitData = (salePrice: number, cost: number, shipping: number) => {
    const fee = Math.round(salePrice * 0.12);
    const profit = salePrice - cost - shipping - fee;
    const margin = salePrice > 0 ? (profit / salePrice) * 100 : 0;
    return { fee, profit, margin };
  };

  const { profit, margin } = selectedProduct
    ? calculateProfitData(selectedProduct.productPrice, wholesalePrice, shippingFee)
    : { profit: 0, margin: 0 };

  // ─── 1688 이미지 검색 ───────────────────────────────────────────────────────
  const PURCHASE_POPUP_HIDE_KEY = 'purchase_popup_hide_date';

  const submit1688Search = (imageUrl: string) => {
    if (!imageUrl) { alert('이미지 없음'); return; }
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://jungdari.com/search1688/image/string';
    form.target = '_blank';
    const sourceInput = document.createElement('input');
    sourceInput.type = 'hidden'; sourceInput.name = 'source'; sourceInput.value = imageUrl;
    const pageInput = document.createElement('input');
    pageInput.type = 'hidden'; pageInput.name = 'beginPage'; pageInput.value = '1';
    form.appendChild(sourceInput); form.appendChild(pageInput);
    document.body.appendChild(form); form.submit(); document.body.removeChild(form);
  };

  const handlePurchaseClick = (product: Product) => {
    const today = new Date().toISOString().slice(0, 10);
    const hideUntil = localStorage.getItem(PURCHASE_POPUP_HIDE_KEY);
    if (hideUntil === today) submit1688Search(product.productImage);
    else setPurchasePopupProduct(product);
  };

  // ─── 파생 목록 ──────────────────────────────────────────────────────────────
  const displayKeywords = keywords
    .filter(k => compFilter === 'all' || k.compIdx === compFilter)
    .filter(k => k.monthlyVolume >= (Number(minVolume) || 0))
    .sort((a, b) => {
      if (kwSortKey === 'competition') return a.competition - b.competition;
      return (b[kwSortKey] as number) - (a[kwSortKey] as number);
    });

  const displayProducts = [...products]
    .filter(p => rocketFilter === 'all' || (rocketFilter === 'rocket' ? p.isRocket : !p.isRocket))
    .filter(p => gradeFilter === 'all' || p.calculated.grade === gradeFilter)
    .sort((a, b) => {
      if (prodSort === 'rank') return a.rank - b.rank;
      if (prodSort === 'priceAsc') return a.productPrice - b.productPrice;
      return b.calculated.opportunityScore - a.calculated.opportunityScore;
    });

  // ─── CSV 내보내기 ───────────────────────────────────────────────────────────
  const downloadCSV = (name: string, headers: string[], rows: (string | number)[][]) => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  const exportKeywordsCSV = () => downloadCSV(
    `키워드발굴_${seed}.csv`,
    ['키워드', '월간검색량', 'PC검색량', '모바일검색량', '월평균클릭', '광고경쟁도', '기회점수', '등급'],
    displayKeywords.map(k => [k.keyword, k.monthlyVolume, k.monthlyPcVolume, k.monthlyMobileVolume, k.monthlyClicks, k.compIdx, k.opportunityScore, k.grade]),
  );

  const exportProductsCSV = () => downloadCSV(
    `소싱분석_${activeKeyword || activeCategory || 'products'}.csv`,
    ['순위', '상품명', '가격', '배송유형', '기회점수', '등급', '쿠팡링크'],
    displayProducts.map(p => [p.rank, p.productName, p.productPrice, p.isRocket ? '로켓' : '일반', p.calculated.opportunityScore, p.calculated.grade, p.productUrl]),
  );

  // ─── 렌더 ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6 bg-white">

        {/* 서브탭 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSubTab('finder')}
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-black transition-all ${
              subTab === 'finder' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            <KeyRound className="w-4 h-4" />니치 키워드 발굴
          </button>
          <button
            onClick={() => setSubTab('best')}
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-black transition-all ${
              subTab === 'best' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            <Crown className="w-4 h-4" />카테고리 베스트
          </button>
          <p className="text-[11px] text-slate-400 font-bold ml-auto hidden md:block">
            네이버 검색광고 · 쿠팡 파트너스 공식 API 실데이터 기반
          </p>
        </div>

        {/* ══════════ 1) 니치 키워드 발굴 ══════════ */}
        {subTab === 'finder' && (
          <>
            <div className="bg-white rounded-[28px] p-4 border-2 border-indigo-100 shadow-xl flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={seed}
                  onChange={e => setSeed(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && seed.trim() && fetchKeywords(seed.trim())}
                  placeholder="시드 키워드 입력 (예: 캠핑의자) — 연관 니치 키워드를 발굴합니다"
                  className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-300 rounded-2xl outline-none text-sm font-bold shadow-inner focus:ring-2 ring-indigo-500/20 transition-all text-slate-900"
                />
              </div>
              <button
                onClick={() => seed.trim() && fetchKeywords(seed.trim())}
                disabled={kwLoading}
                className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95"
              >
                {kwLoading ? <Loader2 className="animate-spin w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                키워드 발굴
              </button>
              {!kwLoading && keywords.length > 0 && (
                <button onClick={exportKeywordsCSV} className="p-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl transition-all shadow-lg active:scale-95" title="CSV로 저장">
                  <Download className="w-5 h-5" />
                </button>
              )}
            </div>

            {kwError && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-700 text-sm font-bold whitespace-pre-wrap">{kwError}</div>
            )}

            {/* 시드 키워드 요약 */}
            {seedStat && !kwLoading && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">"{seedStat.keyword}" 월간 검색량</p>
                  <p className="text-2xl font-black text-indigo-600">{seedStat.monthlyVolume.toLocaleString()}</p>
                  <p className="text-[10px] text-slate-400 font-bold mt-1">PC {seedStat.monthlyPcVolume.toLocaleString()} · 모바일 {seedStat.monthlyMobileVolume.toLocaleString()}</p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">월평균 클릭수</p>
                  <p className="text-2xl font-black text-amber-600">{seedStat.monthlyClicks.toLocaleString()}</p>
                  <p className="text-[10px] text-slate-400 font-bold mt-1">광고 클릭 기준 실측치</p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">광고 경쟁도</p>
                  <span className={`inline-block mt-1 px-3 py-1 rounded-full text-sm font-black ring-1 ${compStyle(seedStat.compIdx)}`}>{seedStat.compIdx}</span>
                  <p className="text-[10px] text-slate-400 font-bold mt-2">평균 노출 광고 {seedStat.adDepth}개</p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">기회점수</p>
                  <div className="flex items-center gap-3">
                    <p className="text-2xl font-black text-slate-800">{seedStat.opportunityScore}</p>
                    <span className={`px-3 py-1 rounded-full text-xs font-black ring-1 ${gradeStyle(seedStat.grade)}`}>{seedStat.grade}</span>
                  </div>
                  <button onClick={() => fetchProducts(seedStat.keyword, seedStat.monthlyVolume)}
                    className="mt-2 text-[11px] font-black text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                    쿠팡 상품 분석 <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}

            {/* 연관 키워드 테이블 */}
            {kwLoading ? (
              <div className="bg-white rounded-[24px] border border-slate-200 p-12 flex flex-col items-center gap-4 text-slate-400">
                <Loader2 className="w-10 h-10 animate-spin text-indigo-400" />
                <p className="text-sm font-bold">네이버 검색광고 API에서 연관 키워드를 수집하는 중...</p>
              </div>
            ) : keywords.length > 0 ? (
              <div className="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center gap-3 flex-wrap">
                  <h3 className="text-sm font-black text-slate-800">연관 니치 키워드 <span className="text-indigo-600">{displayKeywords.length}개</span></h3>
                  {kwCached && <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1"><RefreshCw className="w-3 h-3" />캐시 데이터</span>}
                  <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                    {(['all', '낮음', '중간', '높음'] as const).map(c => (
                      <button key={c} onClick={() => setCompFilter(c)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${compFilter === c ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                        {c === 'all' ? '경쟁 전체' : `경쟁 ${c}`}
                      </button>
                    ))}
                    <div className="flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1">
                      <span className="text-[10px] font-bold text-slate-500">검색량 ≥</span>
                      <input type="number" value={minVolume} onChange={e => setMinVolume(e.target.value)}
                        className="w-16 bg-transparent text-xs font-bold text-slate-700 outline-none" />
                    </div>
                    <div className="flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1.5">
                      <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      <select value={kwSortKey} onChange={e => setKwSortKey(e.target.value as any)}
                        className="text-xs font-bold text-slate-700 bg-transparent outline-none cursor-pointer">
                        <option value="opportunityScore">기회점수순</option>
                        <option value="monthlyVolume">검색량순</option>
                        <option value="monthlyClicks">클릭수순</option>
                        <option value="competition">경쟁 낮은순</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                        <th className="text-left px-5 py-3">키워드</th>
                        <th className="text-right px-4 py-3">월간 검색량</th>
                        <th className="text-right px-4 py-3 hidden md:table-cell">월평균 클릭</th>
                        <th className="text-center px-4 py-3">광고경쟁</th>
                        <th className="text-left px-4 py-3 w-40">기회점수</th>
                        <th className="text-center px-4 py-3">등급</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {displayKeywords.slice(0, 60).map(k => (
                        <tr key={k.keyword} className="border-b border-slate-50 hover:bg-indigo-50/40 transition-colors">
                          <td className="px-5 py-3 font-bold text-slate-800">{k.keyword}</td>
                          <td className="px-4 py-3 text-right font-black text-slate-700 tabular-nums">
                            {k.monthlyVolume.toLocaleString()}
                            <span className="block text-[9px] text-slate-400 font-bold">PC {k.monthlyPcVolume.toLocaleString()} · MO {k.monthlyMobileVolume.toLocaleString()}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-slate-500 tabular-nums hidden md:table-cell">{k.monthlyClicks.toLocaleString()}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2.5 py-1 rounded-full text-[11px] font-black ring-1 ${compStyle(k.compIdx)}`}>{k.compIdx}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${k.opportunityScore}%` }} />
                              </div>
                              <span className="text-xs font-black text-slate-700 tabular-nums w-7 text-right">{k.opportunityScore}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2.5 py-1 rounded-full text-[11px] font-black ring-1 ${gradeStyle(k.grade)}`}>{k.grade}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => fetchProducts(k.keyword, k.monthlyVolume)}
                              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-700 text-white rounded-lg text-[11px] font-black whitespace-nowrap transition-all">
                              쿠팡 분석
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : !seedStat && !kwError && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <KeyRound className="w-16 h-16 mb-6 opacity-20" />
                <h2 className="text-xl font-bold">시드 키워드로 니치 시장을 발굴하세요</h2>
                <p className="text-sm mt-2 font-medium">검색량은 많고 경쟁은 적은 키워드를 찾은 뒤, 쿠팡 로켓 비중까지 확인합니다</p>
              </div>
            )}
          </>
        )}

        {/* ══════════ 2) 카테고리 베스트 ══════════ */}
        {subTab === 'best' && (
          <div className="bg-white rounded-[28px] p-5 border border-slate-200 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-500" />쿠팡 카테고리 베스트셀러 — 잘 팔리는데 로켓이 아닌 상품이 소싱 기회입니다
            </p>
            <div className="flex gap-2 flex-wrap">
              {BEST_CATEGORIES.map(cat => (
                <button key={cat.id} onClick={() => fetchBest(cat.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm ${
                    activeCategory === cat.id ? 'bg-indigo-600 text-white shadow-indigo-200' : 'bg-slate-50 hover:bg-indigo-50/80 text-slate-600 border border-slate-100'
                  }`}>
                  <cat.icon className="w-3.5 h-3.5" />{cat.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ══════════ 상품 분석 결과 (공용) ══════════ */}
        <div ref={productsRef}>
          {(activeKeyword || activeCategory || prodLoading || prodError) && (
            <div className="flex flex-col gap-5">
              {prodError && (
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-700 text-sm font-bold whitespace-pre-wrap">{prodError}</div>
              )}

              {!prodLoading && market && (
                <MarketSummary
                  market={market}
                  title={activeKeyword ? `"${activeKeyword}"` : BEST_CATEGORIES.find(c => c.id === activeCategory)?.label || ''}
                />
              )}

              {!prodLoading && products.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5 bg-white rounded-xl p-1 border border-slate-200 shadow-sm">
                    {([
                      { v: 'all', label: '전체' },
                      { v: 'general', label: '일반배송만' },
                      { v: 'rocket', label: '로켓만' },
                    ] as const).map(f => (
                      <button key={f.v} onClick={() => setRocketFilter(f.v)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold ${rocketFilter === f.v ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 bg-white rounded-xl p-1 border border-slate-200 shadow-sm">
                    {(['all', 'Great', 'Good', 'Normal', 'Bad'] as const).map(g => (
                      <button key={g} onClick={() => setGradeFilter(g)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold ${gradeFilter === g ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
                        {g === 'all' ? '등급 전체' : g}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-1.5 border border-slate-200 shadow-sm">
                    <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                    <select value={prodSort} onChange={e => setProdSort(e.target.value as any)}
                      className="text-xs font-bold text-slate-700 bg-transparent outline-none cursor-pointer">
                      <option value="opportunityScore">기회점수순</option>
                      <option value="rank">쿠팡 순위순</option>
                      <option value="priceAsc">가격 낮은순</option>
                    </select>
                  </div>
                  <button onClick={exportProductsCSV}
                    className="ml-auto flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black transition-all shadow-sm">
                    <Download className="w-3.5 h-3.5" />CSV 저장
                  </button>
                  {servedFrom !== 'fresh' && (
                    <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" />{servedFrom === 'stale' ? 'API 한도로 캐시 데이터 표시 중' : '캐시 데이터'}
                    </span>
                  )}
                </div>
              )}

              {prodLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {Array.from({ length: 8 }).map((_, i) => <ProductSkeleton key={i} />)}
                </div>
              ) : displayProducts.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  <AnimatePresence>
                    {displayProducts.map((product, index) => (
                      <motion.div key={product.productId} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(index * 0.04, 0.6) }}
                        className="group bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                        <a href={product.productUrl} target="_blank" rel="noopener noreferrer"
                          className="relative aspect-square overflow-hidden bg-slate-100 cursor-pointer block">
                          <img src={product.productImage} alt={product.productName} loading="lazy"
                            className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                          <div className="absolute top-3 right-3 flex flex-col gap-2 items-end">
                            <div className={`px-3 py-1 rounded-full text-[10px] font-bold ring-1 ${gradeStyle(product.calculated.grade)}`}>
                              {product.calculated.grade}
                            </div>
                            {product.isRocket ? (
                              <div className="px-2 py-0.5 bg-rose-500 text-white text-[8px] font-black rounded uppercase shadow-sm flex items-center gap-1">
                                <Rocket className="w-2.5 h-2.5" />로켓
                              </div>
                            ) : (
                              <div className="px-2 py-0.5 bg-emerald-500 text-white text-[8px] font-black rounded uppercase shadow-sm flex items-center gap-1">
                                <Store className="w-2.5 h-2.5" />일반배송
                              </div>
                            )}
                          </div>
                          <div className="absolute top-3 left-3 px-2 py-1 bg-slate-900/70 text-white text-[10px] font-black rounded-lg backdrop-blur-sm">
                            {activeCategory ? '베스트' : '검색'} {product.rank}위
                          </div>
                        </a>
                        <div className="p-5 flex-1 flex flex-col">
                          <h3 className="font-bold text-[14px] text-slate-900 line-clamp-2 mb-2 h-10 leading-snug">{product.productName}</h3>
                          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ring-1 ${gradeStyle(product.calculated.grade)}`}
                              title="진입용이성·노출순위·가격적합도를 종합한 소싱 기회 지수 (0~100)">
                              기회지수 {product.calculated.opportunityScore}
                            </span>
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ring-1 ${
                              product.isRocket ? 'bg-rose-50 text-rose-700 ring-rose-500/20' : 'bg-emerald-50 text-emerald-700 ring-emerald-500/20'
                            }`}>
                              {product.isRocket ? '로켓 직접경쟁' : '일반셀러 시장'}
                            </span>
                          </div>
                          <div className="flex flex-col gap-1.5 mb-4">
                            <span className="text-lg font-black text-indigo-600">{product.productPrice.toLocaleString()}원</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400 font-bold">예상 1688원가:</span>
                              <input type="number" value={product.estimated1688Price || ''}
                                onChange={e => {
                                  const newPrice = Number(e.target.value);
                                  setProducts(prev => prev.map(p => p.productId === product.productId ? { ...p, estimated1688Price: newPrice } : p));
                                  const saved = JSON.parse(localStorage.getItem('1688prices') || '{}');
                                  saved[product.productId] = newPrice;
                                  localStorage.setItem('1688prices', JSON.stringify(saved));
                                }}
                                className="w-16 px-2 py-0.5 text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-md outline-none focus:ring-1 ring-amber-400"
                                placeholder="0"
                              />
                              <span className="text-[10px] text-amber-600 font-black">¥</span>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 mt-auto">
                            <a href={product.productUrl} target="_blank" rel="noopener noreferrer"
                              className="w-full py-3 bg-gradient-to-r from-rose-500 to-orange-500 hover:from-rose-600 hover:to-orange-600 text-white rounded-xl text-[11px] font-bold flex items-center justify-center gap-2 transition-all shadow-sm">
                              <ExternalLink className="w-3 h-3" />쿠팡 바로가기
                            </a>
                            <div className="flex gap-2">
                              <button onClick={() => handlePurchaseClick(product)}
                                className="flex-1 py-3 bg-blue-50 rounded-xl text-[11px] font-bold text-blue-600 flex items-center justify-center gap-2 hover:bg-blue-100 transition-colors">
                                1688 소싱처 찾기
                              </button>
                              <button onClick={() => {
                                  setSelectedProduct(product);
                                  setIsDrawerOpen(true);
                                  setWholesalePrice(Math.round((product.estimated1688Price || 0) * sourcingMultiplier));
                                }}
                                className="flex-1 py-3 bg-slate-900 text-white rounded-xl text-[11px] font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors">
                                <LayoutDashboard className="w-3 h-3" />마진 분석
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              ) : !prodError && (activeKeyword || activeCategory) && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Search className="w-12 h-12 mb-4 opacity-20" />
                  <p className="text-sm font-bold">필터 조건에 맞는 상품이 없습니다</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ══════════ 마진 분석 드로어 ══════════ */}
        <AnimatePresence>
          {isDrawerOpen && selectedProduct && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setIsDrawerOpen(false)}
                className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm cursor-pointer" />
              <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                className="fixed top-0 right-0 h-full w-full sm:w-[450px] bg-white z-[60] shadow-2xl flex flex-col">
                <div className="p-6 sm:p-8 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-slate-800">소싱 수익성 분석</h2>
                  <button onClick={() => setIsDrawerOpen(false)}>
                    <ChevronRight className="w-6 h-6 text-slate-600" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-8">
                  <div className="flex gap-6 items-start">
                    <img src={selectedProduct.productImage} className="w-20 h-20 rounded-2xl object-cover border shadow-sm" alt="" />
                    <div>
                      <h3 className="font-bold text-base line-clamp-2 mb-2 leading-tight text-slate-800">{selectedProduct.productName}</h3>
                      <p className="text-sm font-bold text-slate-600">현재 쿠팡가: {selectedProduct.productPrice.toLocaleString()}원</p>
                      <span className={`inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-md text-[10px] font-black ${
                        selectedProduct.isRocket ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                      }`}>
                        {selectedProduct.isRocket ? <Rocket className="w-3 h-3" /> : <Store className="w-3 h-3" />}
                        {selectedProduct.isRocket ? '로켓배송 (직접경쟁 주의)' : '일반배송 (진입 용이)'}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-4 pt-6 border-t border-dashed border-slate-200">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-black text-slate-500 uppercase tracking-widest">소싱 지표</h4>
                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold ring-1 ${gradeStyle(selectedProduct.calculated.grade)}`}>
                        {selectedProduct.calculated.grade}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: '기회지수', value: selectedProduct.calculated.opportunityScore, desc: '진입용이성·노출·가격 종합' },
                        { label: '노출순위', value: selectedProduct.calculated.exposureScore, desc: `쿠팡 ${activeCategory ? '베스트' : '검색'} ${selectedProduct.rank}위 기반` },
                        { label: '진입용이성', value: selectedProduct.calculated.entryEase, desc: '로켓 직매입과의 경쟁 여부' },
                        { label: '가격적합도', value: selectedProduct.calculated.priceFit, desc: '소싱 마진 확보 가능 가격대' },
                      ].map(m => (
                        <div key={m.label} className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="text-[10px] font-bold text-slate-500">{m.label}</span>
                            <span className="text-lg font-black text-slate-800">{m.value}</span>
                          </div>
                          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mb-1.5">
                            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, m.value)}%` }} />
                          </div>
                          <p className="text-[9px] text-slate-400 font-medium leading-tight">{m.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-6 pt-6 border-t border-dashed border-slate-200">
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-emerald-500" />
                      <h4 className="text-sm font-black text-slate-500 uppercase tracking-widest">수익 시뮬레이션</h4>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 mb-2 block uppercase text-center">1688 매입가 (위안)</label>
                        <input type="number" placeholder="예: 25.5"
                          defaultValue={selectedProduct.estimated1688Price || ''}
                          onChange={e => setWholesalePrice(Math.round(Number(e.target.value) * sourcingMultiplier))}
                          className="text-center w-full px-4 py-4 bg-amber-50 border border-amber-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 ring-amber-400" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 mb-2 block uppercase text-center">소싱 배수(환율/관세)</label>
                        <input type="number" value={sourcingMultiplier}
                          onChange={e => handleMultiplierChange(Number(e.target.value))}
                          className="text-center w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 flex items-center justify-between border border-slate-200">
                      <span className="text-xs font-bold text-slate-500">예상 원가(합계)</span>
                      <span className="text-sm font-black text-indigo-600">{wholesalePrice.toLocaleString()}원</span>
                    </div>
                    <div className={`p-8 rounded-[32px] border-2 ${margin > 20 ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex justify-between items-center mb-6">
                        <span className="text-sm font-bold text-slate-500">예상 마진율</span>
                        <span className="text-3xl font-black text-emerald-600">{margin.toFixed(1)}%</span>
                      </div>
                      <div className="pt-6 flex justify-between items-center border-t border-dashed border-slate-200">
                        <span className="font-bold text-lg text-slate-800">최종 수익</span>
                        <span className={`text-2xl font-black ${profit > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {profit.toLocaleString()}원
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-6 sm:p-8 bg-slate-50 border-t border-slate-200">
                  <button onClick={() => setIsDrawerOpen(false)} className="w-full py-5 bg-slate-900 text-white font-black rounded-2xl">분석 완료</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ══════════ 구매하기 이벤트 팝업 ══════════ */}
        <AnimatePresence>
          {purchasePopupProduct && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setPurchasePopupProduct(null)}
                className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                className="fixed inset-0 m-auto z-[90] w-[92%] max-w-[480px] h-fit bg-white rounded-[28px] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.3)] border border-slate-200 overflow-hidden flex flex-col">
                <div className="px-7 pt-7 pb-2 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-indigo-500">Hoonpro Special</p>
                    <h3 className="text-xl font-black text-slate-900 mt-1.5">쇼크트리 추천인 가입 이벤트 안내</h3>
                  </div>
                  <button onClick={() => setPurchasePopupProduct(null)} className="p-1.5 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="px-7 pb-6 pt-2 flex flex-col gap-5">
                  <div className="bg-indigo-50 border border-indigo-100 rounded-2xl px-5 py-4">
                    <p className="text-[13px] font-bold text-slate-700 leading-relaxed">
                      회원가입 후{' '}
                      <span className="inline-block px-2 py-0.5 bg-indigo-600 text-white font-black rounded-md text-xs tracking-wide">hoonpro05</span>{' '}
                      추천인 코드를 입력하면 아래 추가 혜택이 제공됩니다.
                    </p>
                  </div>
                  <ul className="flex flex-col gap-2 text-[13px] font-bold text-slate-700">
                    <li className="flex items-start gap-2"><span className="text-indigo-500 font-black">①</span>LCL 중달이 사업자 통관 시 통관수수료 면제 <span className="text-slate-400">(3만 원 상당)</span></li>
                    <li className="flex items-start gap-2"><span className="text-indigo-500 font-black">②</span>OEM 공장조사 1회 무료 제공 <span className="text-slate-400">(5만 원 상당)</span></li>
                  </ul>
                </div>
                <div className="px-7 pb-7 pt-2 flex gap-2 border-t border-slate-100">
                  <button onClick={() => {
                    localStorage.setItem(PURCHASE_POPUP_HIDE_KEY, new Date().toISOString().slice(0, 10));
                    const p = purchasePopupProduct; setPurchasePopupProduct(null); if (p) submit1688Search(p.productImage);
                  }} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-all">오늘 그만보기</button>
                  <button onClick={() => {
                    const p = purchasePopupProduct; setPurchasePopupProduct(null); if (p) submit1688Search(p.productImage);
                  }} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black transition-all shadow-sm">창닫기</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
