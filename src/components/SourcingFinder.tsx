/**
 * 소싱 파인더 v4
 *
 *  1) 니치 키워드 발굴 — 네이버 검색광고 API: 실제 월간검색량 + 광고경쟁도
 *  2) 쿠팡 상품 분석 — Bright Data Web Unlocker 실시간 수집:
 *     실제 리뷰수·평점·로켓비중·총 상품수로 "판매자 적고 잘 팔리는" 시장 판별
 *  3) 리뷰 증가속도 — 수집 이력이 쌓이면 상품별 리뷰 +N/일(≒판매속도) 표시
 *  4) 심층 확장 · 관심 키워드 · 1688 이미지 소싱 · 마진 계산기 · CSV
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  Search, DollarSign, ChevronRight, Loader2, ExternalLink, Sparkles,
  Download, X, ArrowUpDown, KeyRound, RefreshCw, Star, Calculator,
  TrendingUp, Home, Rocket, Store, LayoutDashboard, Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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
  productUrl: string;
  productImage: string;
  rating: number;
  reviewCount: number;
  deliveryType: 'rocket' | 'jet' | 'general';
  rank: number;
  isAd: boolean;
  isBrand: boolean;
  reviewGrowthPerDay: number | null;
  obsDays: number | null;
  estimated1688Price?: number;
  calculated: {
    demandScore: number;
    entryEase: number;
    priceFit: number;
    opportunityScore: number;
    grade: 'Great' | 'Good' | 'Normal' | 'Bad';
  };
}

interface Market {
  totalOnPage: number;
  rocketCount: number;
  jetCount: number;
  generalCount: number;
  rocketRatio: number;
  totalProducts: number;
  keywordVolume: number;
  competitionRate: number | null;
  medianReviews: number;
  maxReviews: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  entryVerdict: 'Excellent' | 'Good' | 'Fair' | 'Bad';
}

// ─── 공통 헬퍼 ────────────────────────────────────────────────────────────────
const FAV_KEY = 'sourcingFavKeywords';
const PURCHASE_POPUP_HIDE_KEY = 'purchase_popup_hide_date';

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const loadFavorites = (): Record<string, KeywordStat> => {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '{}'); } catch { return {}; }
};

// 쿠팡 대표 카테고리 (서버 CATEGORY_SEEDS와 키가 일치해야 함)
const KW_CATEGORIES = [
  '여성패션', '남성패션', '뷰티', '출산/유아', '식품', '주방용품', '생활용품', '홈인테리어',
  '가전디지털', '스포츠/레저', '자동차용품', '완구/취미', '문구/오피스', '헬스/건강', '반려동물',
];

const coupangSearchUrl = (kw: string) => `https://www.coupang.com/np/search?q=${encodeURIComponent(kw)}`;
const naverShopUrl = (kw: string) => `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(kw)}`;

const gradeStyle = (grade: string) => {
  if (grade === 'Great') return 'text-positive bg-positive-soft ring-positive/20';
  if (grade === 'Good') return 'text-accent bg-accent-soft ring-accent/20';
  if (grade === 'Normal') return 'text-caution bg-caution-soft ring-caution/20';
  return 'text-critical bg-critical-soft ring-critical/20';
};

const compStyle = (compIdx: string) => {
  if (compIdx === '낮음') return 'text-positive bg-positive-soft ring-positive/20';
  if (compIdx === '중간') return 'text-caution bg-caution-soft ring-caution/20';
  return 'text-critical bg-critical-soft ring-critical/20';
};

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export function SourcingFinder() {
  // 키워드 발굴
  const [seedInput, setSeedInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seedStat, setSeedStat] = useState<KeywordStat | null>(null);
  const [currentSeed, setCurrentSeed] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<KeywordStat[]>([]);
  const [cached, setCached] = useState(false);
  const [seedTrail, setSeedTrail] = useState<string[]>([]);
  const [activeKwCategory, setActiveKwCategory] = useState<string | null>(null);

  // 필터/정렬 (키워드)
  const [sortKey, setSortKey] = useState<'opportunityScore' | 'monthlyVolume' | 'monthlyClicks' | 'competition'>('opportunityScore');
  const [compFilter, setCompFilter] = useState<'all' | '낮음' | '중간' | '높음'>('all');
  const [minVolume, setMinVolume] = useState('100');

  // 관심 키워드
  const [favorites, setFavorites] = useState<Record<string, KeywordStat>>(loadFavorites);
  const [showFavorites, setShowFavorites] = useState(false);

  // 쿠팡 상품 분석
  const [activeKeyword, setActiveKeyword] = useState<string | null>(null);
  const [prodLoading, setProdLoading] = useState(false);
  const [prodError, setProdError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [market, setMarket] = useState<Market | null>(null);
  const [servedFrom, setServedFrom] = useState<string>('fresh');
  const [prodDebug, setProdDebug] = useState<string | null>(null);
  const [rocketFilter, setRocketFilter] = useState<'all' | 'general' | 'jet' | 'rocket'>('all');
  const [gradeFilter, setGradeFilter] = useState<'all' | 'Great' | 'Good' | 'Normal' | 'Bad'>('all');
  const [prodSort, setProdSort] = useState<'opportunityScore' | 'reviewCount' | 'rank' | 'priceAsc'>('opportunityScore');
  const [excludeBrands, setExcludeBrands] = useState(true);
  const [gemMode, setGemMode] = useState(false);
  const [prodMinPrice, setProdMinPrice] = useState('');
  const [prodMaxPrice, setProdMaxPrice] = useState('');
  const productsRef = useRef<HTMLDivElement>(null);

  // 마진 계산기 (상품 컨텍스트 선택적)
  const [isCalcOpen, setIsCalcOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [salePrice, setSalePrice] = useState('29900');
  const [yuanPrice, setYuanPrice] = useState('');
  const [shippingFee, setShippingFee] = useState('3000');
  const [sourcingMultiplier, setSourcingMultiplier] = useState<number>(300);

  // 쇼크트리 이벤트 팝업 (1688 이동 전 노출)
  const [popupProduct, setPopupProduct] = useState<Product | 'generic' | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('sourcingMultiplier');
    if (saved) setSourcingMultiplier(Number(saved));
    // 관심 키워드 서버 동기화 (크론 자동 추적의 대상이 되도록 서버에 저장)
    (async () => {
      try {
        const res = await fetch('/api/sourcing?type=favorites&action=list', { headers: authHeaders() });
        const data = await res.json();
        if (res.ok && Array.isArray(data.favorites)) {
          const map: Record<string, KeywordStat> = {};
          for (const f of data.favorites) {
            if (f.stat && f.stat.keyword) map[f.keyword] = f.stat;
            else map[f.keyword] = {
              keyword: f.keyword, monthlyPcVolume: 0, monthlyMobileVolume: 0, monthlyVolume: 0,
              monthlyClicks: 0, compIdx: '중간', adDepth: 0, volumeScore: 0, competition: 50,
              opportunityScore: 0, grade: 'Normal',
            };
          }
          setFavorites(map);
          localStorage.setItem(FAV_KEY, JSON.stringify(map));
        }
      } catch { /* 서버 동기화 실패 시 localStorage 값 유지 */ }
    })();
  }, []);

  const handleMultiplierChange = (val: number) => {
    setSourcingMultiplier(val);
    localStorage.setItem('sourcingMultiplier', String(val));
  };

  // ─── API: 키워드 발굴 ───────────────────────────────────────────────────────
  const fetchKeywords = async (kw: string, mode: 'new' | 'drill' | 'trail' = 'new') => {
    const trimmed = kw.trim();
    if (!trimmed) return;
    setActiveKwCategory(null);
    setLoading(true);
    setError(null);
    setShowFavorites(false);
    try {
      const res = await fetch(`/api/sourcing?type=keywords&seed=${encodeURIComponent(trimmed)}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || '키워드 조회 실패');
        return;
      }
      setSeedStat(data.seedStat || null);
      setKeywords(Array.isArray(data.keywords) ? data.keywords : []);
      setCached(!!data.cached);
      setCurrentSeed(trimmed);
      setSeedInput(trimmed);
      if (mode === 'new') setSeedTrail([trimmed]);
      else if (mode === 'drill') setSeedTrail(prev => [...prev.filter(s => s !== trimmed), trimmed]);
      else setSeedTrail(prev => prev.slice(0, prev.indexOf(trimmed) + 1));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── API: 카테고리 추천 키워드 (시드 없이) ──────────────────────────────────
  const fetchCategoryKeywords = async (cat: string) => {
    setActiveKwCategory(cat);
    setLoading(true);
    setError(null);
    setShowFavorites(false);
    setSeedStat(null);
    setSeedTrail([]);
    setSeedInput('');
    setCurrentSeed(cat);
    try {
      const res = await fetch(`/api/sourcing?type=keywords&category=${encodeURIComponent(cat)}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || '추천 키워드 조회 실패');
        setKeywords([]);
        return;
      }
      setKeywords(Array.isArray(data.keywords) ? data.keywords : []);
      setCached(!!data.cached);
    } catch (e: any) {
      setError(e.message);
      setKeywords([]);
    } finally {
      setLoading(false);
    }
  };

  // ─── API: 쿠팡 상품 분석 ────────────────────────────────────────────────────
  const fetchProducts = async (kw: string, volume = 0) => {
    setActiveKeyword(kw);
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
      const savedPrices = JSON.parse(localStorage.getItem('1688prices') || '{}');
      setProducts((data.products || []).map((p: Product) => ({
        ...p,
        estimated1688Price: savedPrices[p.productId] || undefined,
      })));
      setMarket(data.market || null);
      setServedFrom(data.servedFrom || 'fresh');
      setProdDebug(data.parseDebug || null);
      if (typeof data.remaining === 'number') {
        window.dispatchEvent(new CustomEvent('usage-updated', { detail: { remaining: data.remaining } }));
      }
    } catch (e: any) {
      setProdError(e.message);
      setProducts([]);
      setMarket(null);
    } finally {
      setProdLoading(false);
    }
  };

  // ─── 관심 키워드 ────────────────────────────────────────────────────────────
  const toggleFavorite = (k: KeywordStat) => {
    const adding = !favorites[k.keyword];
    setFavorites(prev => {
      const next = { ...prev };
      if (next[k.keyword]) delete next[k.keyword];
      else next[k.keyword] = k;
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
      return next;
    });
    // 서버에도 저장 — 관심 키워드는 매일 새벽 크론이 자동 재수집해 판매속도를 축적
    const params = new URLSearchParams({ type: 'favorites', action: adding ? 'add' : 'remove', keyword: k.keyword });
    if (adding) params.set('stat', JSON.stringify(k));
    fetch(`/api/sourcing?${params.toString()}`, { headers: authHeaders() }).catch(() => {});
  };

  // ─── 마진 계산 ──────────────────────────────────────────────────────────────
  const sale = Number(salePrice) || 0;
  const cost = Math.round((Number(yuanPrice) || 0) * sourcingMultiplier);
  const shipping = Number(shippingFee) || 0;
  const fee = Math.round(sale * 0.12);
  const profit = sale - cost - shipping - fee;
  const margin = sale > 0 ? (profit / sale) * 100 : 0;

  const openCalcForProduct = (p: Product) => {
    setSelectedProduct(p);
    setSalePrice(String(p.productPrice));
    setYuanPrice(p.estimated1688Price ? String(p.estimated1688Price) : '');
    setIsCalcOpen(true);
  };

  // ─── 1688 소싱 ─────────────────────────────────────────────────────────────
  const submit1688ImageSearch = (imageUrl: string) => {
    if (!imageUrl) { window.open('https://jungdari.com', '_blank', 'noopener'); return; }
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

  const proceed1688 = (target: Product | 'generic') => {
    if (target === 'generic') window.open('https://jungdari.com', '_blank', 'noopener');
    else submit1688ImageSearch(target.productImage);
  };

  const handle1688Click = (target: Product | 'generic') => {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(PURCHASE_POPUP_HIDE_KEY) === today) proceed1688(target);
    else setPopupProduct(target);
  };

  // ─── 파생 목록 ──────────────────────────────────────────────────────────────
  const sourceList = showFavorites ? Object.values(favorites) : keywords;
  const displayKeywords = sourceList
    .filter(k => compFilter === 'all' || k.compIdx === compFilter)
    .filter(k => k.monthlyVolume >= (Number(minVolume) || 0))
    .sort((a, b) => {
      if (sortKey === 'competition') return a.competition - b.competition;
      return (b[sortKey] as number) - (a[sortKey] as number);
    });

  const displayProducts = [...products]
    .filter(p => !excludeBrands || !p.isBrand)
    .filter(p => rocketFilter === 'all' || p.deliveryType === rocketFilter)
    .filter(p => gradeFilter === 'all' || p.calculated.grade === gradeFilter)
    .filter(p => !prodMinPrice || p.productPrice >= Number(prodMinPrice))
    .filter(p => !prodMaxPrice || p.productPrice <= Number(prodMaxPrice))
    // 숨은 보석: 수요는 검증됐지만(리뷰 30~1000) 로켓·브랜드가 장악하지 않은 자리
    .filter(p => !gemMode || (p.reviewCount >= 30 && p.reviewCount <= 1000 && p.deliveryType !== 'rocket' && !p.isBrand))
    .sort((a, b) => {
      if (prodSort === 'rank') return a.rank - b.rank;
      if (prodSort === 'priceAsc') return a.productPrice - b.productPrice;
      if (prodSort === 'reviewCount') return b.reviewCount - a.reviewCount;
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
    showFavorites ? '관심키워드.csv' : `키워드발굴_${currentSeed || 'result'}.csv`,
    ['키워드', '월간검색량', 'PC검색량', '모바일검색량', '월평균클릭', '광고경쟁도', '기회점수', '등급', '쿠팡링크'],
    displayKeywords.map(k => [k.keyword, k.monthlyVolume, k.monthlyPcVolume, k.monthlyMobileVolume, k.monthlyClicks, k.compIdx, k.opportunityScore, k.grade, coupangSearchUrl(k.keyword)]),
  );

  const exportProductsCSV = () => downloadCSV(
    `쿠팡분석_${activeKeyword || 'products'}.csv`,
    ['순위', '상품명', '가격', '평점', '리뷰수', '리뷰증가/일', '배송유형', '기회점수', '등급', '쿠팡링크'],
    displayProducts.map(p => [
      p.rank, p.productName, p.productPrice, p.rating, p.reviewCount,
      p.reviewGrowthPerDay ?? '', p.deliveryType === 'rocket' ? '로켓' : p.deliveryType === 'jet' ? '판매자로켓' : '일반',
      p.calculated.opportunityScore, p.calculated.grade, p.productUrl,
    ]),
  );

  const favCount = Object.keys(favorites).length;

  const verdictText: Record<Market['entryVerdict'], { label: string; desc: string; color: string }> = {
    Excellent: { label: '진입 기회 높음', desc: '로켓 비중이 낮고 경쟁이 약한 시장', color: 'text-positive' },
    Good: { label: '진입 가능', desc: '로켓과 일반 셀러가 공존하는 시장', color: 'text-accent' },
    Fair: { label: '진입 주의', desc: '로켓 비중이 높은 편 — 차별화 필요', color: 'text-caution' },
    Bad: { label: '진입 비추천', desc: '쿠팡 직매입(로켓)이 장악한 시장', color: 'text-critical' },
  };

  // ─── 렌더 ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-paper text-ink">
      <main className="max-w-[1500px] mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6 bg-paper">

        {/* 헤더 라인 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 px-4 py-2 bg-accent-soft rounded-card">
            <KeyRound className="w-4 h-4 text-accent" />
            <span className="text-sm font-semibold text-accent">니치 키워드 발굴 + 쿠팡 실데이터 분석</span>
          </div>
          <p className="text-[11px] text-ink-3 font-bold hidden md:block">
            쿠팡 실시간 수집 데이터 기반
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => { setShowFavorites(v => !v); setError(null); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-card text-xs font-semibold transition-all ${
                showFavorites ? 'bg-caution text-white shadow-raised shadow-amber-200' : 'bg-paper-2 text-ink-2 hover:bg-line'
              }`}>
              <Star className={`w-3.5 h-3.5 ${showFavorites ? 'fill-white' : ''}`} />관심 키워드 {favCount > 0 && `(${favCount})`}
            </button>
            <button onClick={() => { setSelectedProduct(null); setIsCalcOpen(true); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-ink hover:bg-ink-2 text-white rounded-card text-xs font-semibold transition-all">
              <Calculator className="w-3.5 h-3.5" />마진 계산기
            </button>
          </div>
        </div>

        {/* 쿠팡 대표 카테고리 (시드 없이 추천 키워드) */}
        <div className="bg-paper rounded-panel p-5 border border-line">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-2 mb-3 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            쿠팡 대표 카테고리 — 시드 키워드가 떠오르지 않으면 카테고리만 눌러도 추천 키워드가 나옵니다
          </p>
          <div className="flex gap-2 flex-wrap">
            {KW_CATEGORIES.map(cat => (
              <button key={cat} onClick={() => fetchCategoryKeywords(cat)} disabled={loading}
                className={`px-4 py-2 rounded-card text-xs font-bold transition-all  ${
                  activeKwCategory === cat
                    ? 'bg-accent text-white shadow-indigo-200'
                    : 'bg-paper-2 hover:bg-accent-soft/80 text-ink-2 border border-line'
                }`}>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* 검색바 */}
        <div className="bg-paper rounded-panel p-4 border-2 border-accent-line shadow-overlay flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-3" />
            <input
              type="text"
              value={seedInput}
              onChange={e => setSeedInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchKeywords(seedInput)}
              placeholder="시드 키워드 입력 (예: 캠핑의자) — 연관 니치 키워드를 발굴합니다"
              className="w-full pl-12 pr-6 py-4 bg-paper-2 border border-line-strong rounded-card outline-none text-sm font-bold shadow-inner focus:ring-2 ring-accent/20 transition-all text-ink"
            />
          </div>
          <button
            onClick={() => fetchKeywords(seedInput)}
            disabled={loading}
            className="px-8 py-4 bg-accent hover:bg-accent-hover text-white font-semibold rounded-card flex items-center justify-center gap-2 transition-all shadow-raised active:scale-95"
          >
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
            키워드 발굴
          </button>
          {displayKeywords.length > 0 && (
            <button onClick={exportKeywordsCSV} className="p-4 bg-positive hover:bg-positive text-white rounded-card transition-all shadow-raised active:scale-95" title="CSV로 저장">
              <Download className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* 심층 확장 경로 */}
        {!showFavorites && seedTrail.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs font-bold text-ink-2">
            <Home className="w-3.5 h-3.5 text-ink-3" />
            {seedTrail.map((s, i) => (
              <React.Fragment key={s}>
                {i > 0 && <ChevronRight className="w-3 h-3 text-ink-3" />}
                <button onClick={() => fetchKeywords(s, 'trail')}
                  className={`px-2.5 py-1 rounded-control transition-all ${
                    s === currentSeed ? 'bg-accent text-white' : 'bg-paper-2 hover:bg-accent-soft hover:text-accent'
                  }`}>
                  {s}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-critical-soft border border-critical/30 rounded-card p-4 text-critical text-sm font-bold whitespace-pre-wrap">{error}</div>
        )}

        {/* 시드 키워드 요약 */}
        {seedStat && !loading && !showFavorites && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-paper rounded-card p-5 border border-line">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-2 mb-1">"{seedStat.keyword}" 월간 검색량</p>
              <p className="text-2xl font-semibold text-accent">{seedStat.monthlyVolume.toLocaleString()}</p>
              <p className="text-[10px] text-ink-3 font-bold mt-1">PC {seedStat.monthlyPcVolume.toLocaleString()} · 모바일 {seedStat.monthlyMobileVolume.toLocaleString()}</p>
            </div>
            <div className="bg-paper rounded-card p-5 border border-line">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-2 mb-1">월평균 클릭수</p>
              <p className="text-2xl font-semibold text-caution">{seedStat.monthlyClicks.toLocaleString()}</p>
              <p className="text-[10px] text-ink-3 font-bold mt-1">광고 클릭 기준 실측치</p>
            </div>
            <div className="bg-paper rounded-card p-5 border border-line">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-2 mb-1">광고 경쟁도</p>
              <span className={`inline-block mt-1 px-3 py-1 rounded-full text-sm font-semibold ring-1 ${compStyle(seedStat.compIdx)}`}>{seedStat.compIdx}</span>
              <p className="text-[10px] text-ink-3 font-bold mt-2">평균 노출 광고 {seedStat.adDepth}개</p>
            </div>
            <div className="bg-paper rounded-card p-5 border border-line">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-2">기회점수</p>
                <button onClick={() => toggleFavorite(seedStat)} title="관심 키워드">
                  <Star className={`w-4 h-4 transition-all ${favorites[seedStat.keyword] ? 'fill-amber-400 text-caution' : 'text-ink-3 hover:text-caution'}`} />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-2xl font-semibold text-ink">{seedStat.opportunityScore}</p>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ring-1 ${gradeStyle(seedStat.grade)}`}>{seedStat.grade}</span>
              </div>
              <button onClick={() => fetchProducts(seedStat.keyword, seedStat.monthlyVolume)}
                className="mt-2 text-[11px] font-semibold text-accent hover:text-accent-hover flex items-center gap-1">
                쿠팡 상품 분석 <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* 키워드 테이블 */}
        {loading ? (
          <div className="bg-paper rounded-panel border border-line p-12 flex flex-col items-center gap-4 text-ink-3">
            <Loader2 className="w-10 h-10 animate-spin text-accent" />
            <p className="text-sm font-bold">훈프로AI 연관 키워드를 수집 중...</p>
          </div>
        ) : displayKeywords.length > 0 || (showFavorites && favCount === 0) ? (
          <div className="bg-paper rounded-panel border border-line overflow-hidden">
            <div className="p-5 border-b border-line flex items-center gap-3 flex-wrap">
              <h3 className="text-sm font-semibold text-ink">
                {showFavorites
                  ? <>관심 키워드 <span className="text-caution">{displayKeywords.length}개</span></>
                  : activeKwCategory
                    ? <>"{activeKwCategory}" 추천 키워드 <span className="text-accent">{displayKeywords.length}개</span></>
                    : <>연관 니치 키워드 <span className="text-accent">{displayKeywords.length}개</span></>}
              </h3>
              {!showFavorites && cached && (
                <span className="text-[10px] font-bold text-ink-3 flex items-center gap-1"><RefreshCw className="w-3 h-3" />캐시 데이터</span>
              )}
              <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                {(['all', '낮음', '중간', '높음'] as const).map(c => (
                  <button key={c} onClick={() => setCompFilter(c)}
                    className={`px-3 py-1.5 rounded-control text-xs font-bold transition-all ${compFilter === c ? 'bg-ink-2 text-white' : 'bg-paper-2 text-ink-2 hover:bg-line'}`}>
                    {c === 'all' ? '경쟁 전체' : `경쟁 ${c}`}
                  </button>
                ))}
                <div className="flex items-center gap-1 bg-paper-2 rounded-control px-2 py-1">
                  <span className="text-[10px] font-bold text-ink-2">검색량 ≥</span>
                  <input type="number" value={minVolume} onChange={e => setMinVolume(e.target.value)}
                    className="w-16 bg-transparent text-xs font-bold text-ink outline-none" />
                </div>
                <div className="flex items-center gap-1 bg-paper-2 rounded-control px-2 py-1.5">
                  <ArrowUpDown className="w-3 h-3 text-ink-3" />
                  <select value={sortKey} onChange={e => setSortKey(e.target.value as any)}
                    className="text-xs font-bold text-ink bg-transparent outline-none cursor-pointer">
                    <option value="opportunityScore">기회점수순</option>
                    <option value="monthlyVolume">검색량순</option>
                    <option value="monthlyClicks">클릭수순</option>
                    <option value="competition">경쟁 낮은순</option>
                  </select>
                </div>
              </div>
            </div>
            {displayKeywords.length === 0 ? (
              <div className="p-12 flex flex-col items-center gap-3 text-ink-3">
                <Star className="w-10 h-10 opacity-20" />
                <p className="text-sm font-bold">저장된 관심 키워드가 없습니다. 테이블에서 ★을 눌러 저장하세요.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] font-semibold uppercase tracking-widest text-ink-3 border-b border-line">
                      <th className="px-3 py-3 w-10" />
                      <th className="text-left px-3 py-3">키워드</th>
                      <th className="text-right px-4 py-3">월간 검색량</th>
                      <th className="text-right px-4 py-3 hidden md:table-cell">월평균 클릭</th>
                      <th className="text-center px-4 py-3">광고경쟁</th>
                      <th className="text-left px-4 py-3 w-36">기회점수</th>
                      <th className="text-center px-4 py-3">등급</th>
                      <th className="px-4 py-3 text-right">분석</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayKeywords.slice(0, 100).map(k => (
                      <tr key={k.keyword} className={`border-b border-line hover:bg-accent-soft/40 transition-colors ${activeKeyword === k.keyword ? 'bg-accent-soft/60' : ''}`}>
                        <td className="px-3 py-3 text-center">
                          <button onClick={() => toggleFavorite(k)} title="관심 키워드">
                            <Star className={`w-4 h-4 transition-all ${favorites[k.keyword] ? 'fill-amber-400 text-caution' : 'text-ink-3 hover:text-caution'}`} />
                          </button>
                        </td>
                        <td className="px-3 py-3 font-bold text-ink">{k.keyword}</td>
                        <td className="px-4 py-3 text-right font-semibold text-ink tabular-nums">
                          {k.monthlyVolume.toLocaleString()}
                          <span className="block text-[9px] text-ink-3 font-bold">PC {k.monthlyPcVolume.toLocaleString()} · MO {k.monthlyMobileVolume.toLocaleString()}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-ink-2 tabular-nums hidden md:table-cell">{k.monthlyClicks.toLocaleString()}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ${compStyle(k.compIdx)}`}>{k.compIdx}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-paper-2 rounded-full overflow-hidden">
                              <div className="h-full bg-accent rounded-full" style={{ width: `${k.opportunityScore}%` }} />
                            </div>
                            <span className="text-xs font-semibold text-ink tabular-nums w-7 text-right">{k.opportunityScore}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ${gradeStyle(k.grade)}`}>{k.grade}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <button onClick={() => fetchProducts(k.keyword, k.monthlyVolume)}
                              title="쿠팡 상품·리뷰 실데이터 분석"
                              className="px-2.5 py-1.5 bg-ink hover:bg-ink-2 text-white rounded-control text-[11px] font-semibold transition-all flex items-center gap-1">
                              <LayoutDashboard className="w-3 h-3" />쿠팡 분석
                            </button>
                            <button onClick={() => fetchKeywords(k.keyword, 'drill')}
                              title="이 키워드를 시드로 다시 확장"
                              className="px-2.5 py-1.5 bg-accent-soft hover:bg-accent-soft text-accent rounded-control text-[11px] font-semibold transition-all flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" />확장
                            </button>
                            <a href={coupangSearchUrl(k.keyword)} target="_blank" rel="noopener noreferrer"
                              title="쿠팡에서 이 키워드 검색 결과 직접 확인"
                              className="px-2.5 py-1.5 bg-critical-soft hover:bg-critical-soft text-critical rounded-control text-[11px] font-semibold transition-all">
                              쿠팡
                            </a>
                            <a href={naverShopUrl(k.keyword)} target="_blank" rel="noopener noreferrer"
                              title="네이버쇼핑에서 직접 확인"
                              className="px-2.5 py-1.5 bg-positive-soft hover:bg-positive-soft text-positive rounded-control text-[11px] font-semibold transition-all">
                              N쇼핑
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : !seedStat && !error && !activeKeyword && (
          <div className="flex flex-col items-center justify-center py-20 text-ink-3">
            <KeyRound className="w-16 h-16 mb-6 opacity-20" />
            <h2 className="text-xl font-bold">니치 시장 발굴을 시작하세요</h2>
            <p className="text-sm mt-2 font-medium text-center leading-relaxed">
              시드 키워드를 검색하거나, 위의 쿠팡 대표 카테고리를 눌러 추천 키워드를 받아보세요.<br />
              검색량은 많고 경쟁은 적은 키워드를 찾은 뒤 [쿠팡 분석]으로 실제 리뷰·로켓 비중까지 확인합니다
            </p>
          </div>
        )}

        {/* ══════════ 쿠팡 상품 분석 ══════════ */}
        <div ref={productsRef}>
          {(activeKeyword || prodLoading || prodError) && (
            <div className="flex flex-col gap-5">
              {prodError && (
                <div className="bg-critical-soft border border-critical/30 rounded-card p-4 text-critical text-sm font-bold whitespace-pre-wrap">{prodError}</div>
              )}
              {prodDebug && !prodLoading && (
                <div className="bg-paper-2 border border-line rounded-card p-4">
                  <p className="text-[10px] font-semibold text-ink-2 mb-1">파싱 진단 — 결과가 이상하면 이 내용을 공유해주세요</p>
                  <pre className="text-[10px] text-ink-2 whitespace-pre-wrap break-all font-mono">{prodDebug}</pre>
                </div>
              )}

              {prodLoading ? (
                <div className="bg-paper rounded-panel border border-line p-12 flex flex-col items-center gap-4 text-ink-3">
                  <Loader2 className="w-10 h-10 animate-spin text-critical" />
                  <p className="text-sm font-bold">"{activeKeyword}" 쿠팡 검색 결과를 실시간 수집하는 중... (5~20초)</p>
                </div>
              ) : market && (
                <>
                  {/* 시장 요약 */}
                  <div className="bg-paper rounded-panel p-6 border border-line">
                    <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
                      <h3 className="text-base font-semibold text-ink">
                        "{activeKeyword}" <span className="text-ink-3 font-bold">쿠팡 시장 분석</span>
                        <a href={coupangSearchUrl(activeKeyword!)} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 ml-3 text-[11px] font-semibold text-critical hover:text-critical">
                          쿠팡에서 보기 <ExternalLink className="w-3 h-3" />
                        </a>
                      </h3>
                      <span className={`text-xs font-semibold ${verdictText[market.entryVerdict].color}`}>
                        {verdictText[market.entryVerdict].label} · {verdictText[market.entryVerdict].desc}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="bg-paper-2 rounded-card p-4 border border-line">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-2 mb-2">배송 유형 (상위 {market.totalOnPage}개)</p>
                        <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-line mb-2">
                          <div style={{ width: `${(market.rocketCount / market.totalOnPage) * 100}%` }} className="h-full bg-critical" />
                          <div style={{ width: `${(market.jetCount / market.totalOnPage) * 100}%` }} className="h-full bg-caution" />
                          <div style={{ width: `${(market.generalCount / market.totalOnPage) * 100}%` }} className="h-full bg-positive" />
                        </div>
                        <div className="flex justify-between text-[10px] font-semibold">
                          <span className="text-critical">로켓 {market.rocketCount}</span>
                          <span className="text-caution">판매자로켓 {market.jetCount}</span>
                          <span className="text-positive">일반 {market.generalCount}</span>
                        </div>
                      </div>
                      <div className="bg-paper-2 rounded-card p-4 border border-line">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-2 mb-1">경쟁 강도 (상품수 ÷ 검색량)</p>
                        <p className={`text-xl font-semibold ${market.competitionRate === null ? 'text-ink-3' : market.competitionRate < 2 ? 'text-positive' : market.competitionRate < 8 ? 'text-accent' : 'text-critical'}`}>
                          {market.competitionRate === null ? '—' : market.competitionRate}
                        </p>
                        <p className="text-[10px] text-ink-3 font-bold mt-1">
                          총 {market.totalProducts > 0 ? market.totalProducts.toLocaleString() : '?'}개 상품
                          {market.keywordVolume > 0 && ` / 검색 ${market.keywordVolume.toLocaleString()}회`}
                        </p>
                      </div>
                      <div className="bg-paper-2 rounded-card p-4 border border-line">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-2 mb-1">리뷰 진입장벽</p>
                        <p className="text-xl font-semibold text-accent">중앙값 {market.medianReviews.toLocaleString()}</p>
                        <p className="text-[10px] text-ink-3 font-bold mt-1">1위 상품 리뷰 {market.maxReviews.toLocaleString()}개</p>
                      </div>
                      <div className="bg-paper-2 rounded-card p-4 border border-line">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-2 mb-1">평균 판매가</p>
                        <p className="text-xl font-semibold text-caution">{market.avgPrice.toLocaleString()}원</p>
                        <p className="text-[10px] text-ink-3 font-bold mt-1">{market.minPrice.toLocaleString()} ~ {market.maxPrice.toLocaleString()}원</p>
                      </div>
                    </div>
                  </div>

                  {/* 필터 */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={() => setGemMode(v => !v)}
                      title="리뷰 30~1000개(수요 검증)이면서 로켓·브랜드가 아닌 상품만 — 진입 가능한 검증 시장"
                      className={`px-3 py-2 rounded-card text-xs font-semibold border  transition-all ${
                        gemMode ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white border-accent shadow-indigo-200' : 'bg-paper text-accent border-accent-line'
                      }`}>
                      💎 숨은 보석
                    </button>
                    <div className="flex items-center gap-1.5 bg-paper rounded-card p-1 border border-line">
                      {([
                        { v: 'all', label: '전체' },
                        { v: 'general', label: '일반배송' },
                        { v: 'jet', label: '판매자로켓' },
                        { v: 'rocket', label: '로켓' },
                      ] as const).map(f => (
                        <button key={f.v} onClick={() => setRocketFilter(f.v)}
                          className={`px-3 py-1.5 rounded-control text-xs font-bold ${rocketFilter === f.v ? 'bg-ink-2 text-white' : 'text-ink-2'}`}>
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 bg-paper rounded-card p-1 border border-line">
                      {(['all', 'Great', 'Good', 'Normal', 'Bad'] as const).map(g => (
                        <button key={g} onClick={() => setGradeFilter(g)}
                          className={`px-3 py-1.5 rounded-control text-xs font-bold ${gradeFilter === g ? 'bg-ink-2 text-white' : 'text-ink-2'}`}>
                          {g === 'all' ? '등급 전체' : g}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 bg-paper rounded-card px-3 py-1.5 border border-line">
                      <span className="text-[10px] font-bold text-ink-2">가격</span>
                      <input type="number" value={prodMinPrice} onChange={e => setProdMinPrice(e.target.value)} placeholder="최소"
                        className="w-16 bg-transparent text-xs font-bold text-ink outline-none" />
                      <span className="text-ink-3">~</span>
                      <input type="number" value={prodMaxPrice} onChange={e => setProdMaxPrice(e.target.value)} placeholder="최대"
                        className="w-16 bg-transparent text-xs font-bold text-ink outline-none" />
                    </div>
                    <button onClick={() => setExcludeBrands(v => !v)}
                      title="브랜드 상품(나이키·네파 등)을 목록에서 숨기거나 표시"
                      className={`px-3 py-2 rounded-card text-xs font-bold border  transition-all ${
                        excludeBrands ? 'bg-ink-2 text-white border-ink' : 'bg-paper text-ink-2 border-line'
                      }`}>
                      브랜드 제외 {excludeBrands ? 'ON' : 'OFF'}
                    </button>
                    <div className="flex items-center gap-2 bg-paper rounded-card px-3 py-1.5 border border-line">
                      <ArrowUpDown className="w-3.5 h-3.5 text-ink-3" />
                      <select value={prodSort} onChange={e => setProdSort(e.target.value as any)}
                        className="text-xs font-bold text-ink bg-transparent outline-none cursor-pointer">
                        <option value="opportunityScore">기회점수순</option>
                        <option value="reviewCount">리뷰 많은순</option>
                        <option value="rank">쿠팡 노출순</option>
                        <option value="priceAsc">가격 낮은순</option>
                      </select>
                    </div>
                    <button onClick={exportProductsCSV}
                      className="ml-auto flex items-center gap-2 px-4 py-2 bg-positive hover:bg-positive text-white rounded-card text-xs font-semibold transition-all">
                      <Download className="w-3.5 h-3.5" />CSV 저장
                    </button>
                    {servedFrom !== 'fresh' && (
                      <span className="text-[10px] font-bold text-ink-3 flex items-center gap-1">
                        <RefreshCw className="w-3 h-3" />{servedFrom === 'stale' ? '수집 실패로 이전 데이터 표시 중' : '캐시 데이터 (24시간)'}
                      </span>
                    )}
                  </div>

                  {/* 상품 그리드 */}
                  {displayProducts.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                      {displayProducts.map(product => (
                        <div key={product.productId}
                          className="group bg-paper rounded-card border border-line overflow-hidden flex flex-col">
                          <a href={product.productUrl} target="_blank" rel="noopener noreferrer"
                            className="relative aspect-square overflow-hidden bg-paper-2 cursor-pointer block">
                            {product.productImage
                              ? <img src={product.productImage} alt={product.productName} loading="lazy"
                                  className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                              : <div className="w-full h-full flex items-center justify-center text-ink-3"><Search className="w-10 h-10" /></div>}
                            <div className="absolute top-3 right-3 flex flex-col gap-2 items-end">
                              <div className={`px-3 py-1 rounded-full text-[10px] font-bold ring-1 ${gradeStyle(product.calculated.grade)}`}>
                                {product.calculated.grade}
                              </div>
                              {product.deliveryType === 'rocket' && (
                                <div className="px-2 py-0.5 bg-critical text-white text-[8px] font-semibold rounded uppercase flex items-center gap-1">
                                  <Rocket className="w-2.5 h-2.5" />로켓
                                </div>
                              )}
                              {product.deliveryType === 'jet' && (
                                <div className="px-2 py-0.5 bg-caution text-white text-[8px] font-semibold rounded uppercase flex items-center gap-1">
                                  <Rocket className="w-2.5 h-2.5" />판매자로켓
                                </div>
                              )}
                              {product.deliveryType === 'general' && (
                                <div className="px-2 py-0.5 bg-positive text-white text-[8px] font-semibold rounded uppercase flex items-center gap-1">
                                  <Store className="w-2.5 h-2.5" />일반배송
                                </div>
                              )}
                              {product.isBrand && (
                                <div className="px-2 py-0.5 bg-ink-2 text-white text-[8px] font-semibold rounded uppercase">브랜드</div>
                              )}
                            </div>
                            <div className="absolute top-3 left-3 px-2 py-1 bg-ink/70 text-white text-[10px] font-semibold rounded-control backdrop-blur-sm">
                              노출 {product.rank}위
                            </div>
                          </a>
                          <div className="p-5 flex-1 flex flex-col">
                            <h3 className="font-bold text-[14px] text-ink line-clamp-2 mb-2 h-10 leading-snug">{product.productName}</h3>
                            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                              {product.reviewCount > 0 ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control bg-positive-soft text-positive text-[10px] font-semibold ring-1 ring-positive/20">
                                  <Star className="w-3 h-3 fill-emerald-500 text-positive" />
                                  {product.rating.toFixed(1)} · 리뷰 {product.reviewCount.toLocaleString()}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-control bg-paper-2 text-ink-3 text-[10px] font-bold ring-1 ring-line">리뷰 없음</span>
                              )}
                              {product.reviewGrowthPerDay !== null && product.reviewGrowthPerDay > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control bg-accent-soft text-accent text-[10px] font-semibold ring-1 ring-accent/20"
                                  title={`최근 ${product.obsDays}일 관측 기준 리뷰 증가 속도 (판매속도 지표)`}>
                                  <Zap className="w-3 h-3" />+{product.reviewGrowthPerDay}/일
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mb-3">
                              <span className={`px-2 py-0.5 rounded-control text-[10px] font-semibold ring-1 ${gradeStyle(product.calculated.grade)}`}
                                title="수요검증(리뷰)·진입용이성(배송유형)·가격적합도 종합 (0~100)">
                                기회지수 {product.calculated.opportunityScore}
                              </span>
                              <span className={`px-2 py-0.5 rounded-control text-[10px] font-bold ring-1 ${
                                product.deliveryType === 'rocket' ? 'bg-critical-soft text-critical ring-critical/20' : 'bg-positive-soft text-positive ring-positive/20'
                              }`}>
                                {product.deliveryType === 'rocket' ? '로켓 직접경쟁' : '셀러 진입 가능'}
                              </span>
                            </div>
                            <div className="flex flex-col gap-1.5 mb-4">
                              <span className="text-lg font-semibold text-accent">{product.productPrice.toLocaleString()}원</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-ink-3 font-bold">예상 1688원가:</span>
                                <input type="number" value={product.estimated1688Price || ''}
                                  onChange={e => {
                                    const newPrice = Number(e.target.value);
                                    setProducts(prev => prev.map(p => p.productId === product.productId ? { ...p, estimated1688Price: newPrice } : p));
                                    const saved = JSON.parse(localStorage.getItem('1688prices') || '{}');
                                    saved[product.productId] = newPrice;
                                    localStorage.setItem('1688prices', JSON.stringify(saved));
                                  }}
                                  className="w-16 px-2 py-0.5 text-[11px] font-bold text-caution bg-caution-soft border border-caution/30 rounded-control outline-none focus:ring-1 ring-caution"
                                  placeholder="0"
                                />
                                <span className="text-[10px] text-caution font-semibold">¥</span>
                                {(() => {
                                  if (!product.estimated1688Price || product.estimated1688Price <= 0) return null;
                                  const s = product.productPrice;
                                  const pf = s - Math.round(product.estimated1688Price * sourcingMultiplier) - 3000 - Math.round(s * 0.12);
                                  const mg = s > 0 ? (pf / s) * 100 : 0;
                                  return (
                                    <span className={`px-2 py-0.5 rounded-control text-[10px] font-semibold ring-1 ${
                                      mg >= 20 ? 'bg-positive-soft text-positive ring-positive/20'
                                      : mg > 0 ? 'bg-caution-soft text-caution ring-caution/20'
                                      : 'bg-critical-soft text-critical ring-critical/20'
                                    }`} title="판매가 - (위안×배수) - 배송비 3,000원 - 수수료 12% 기준">
                                      마진 {mg.toFixed(0)}%
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>
                            <div className="flex flex-col gap-2 mt-auto">
                              <div className="flex gap-2">
                                <button onClick={() => handle1688Click(product)}
                                  title="상품 이미지로 1688 소싱처 검색"
                                  className="flex-1 py-3 bg-accent-soft rounded-card text-[11px] font-bold text-accent flex items-center justify-center gap-2 hover:bg-accent-soft transition-colors">
                                  1688 소싱처
                                </button>
                                <button onClick={() => openCalcForProduct(product)}
                                  className="flex-1 py-3 bg-ink text-white rounded-card text-[11px] font-bold flex items-center justify-center gap-2 hover:bg-ink-2 transition-colors">
                                  <Calculator className="w-3 h-3" />마진 분석
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-ink-3">
                      <Search className="w-12 h-12 mb-4 opacity-20" />
                      <p className="text-sm font-bold">필터 조건에 맞는 상품이 없습니다</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* ══════════ 마진 계산기 드로어 ══════════ */}
        <AnimatePresence>
          {isCalcOpen && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setIsCalcOpen(false)}
                className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm cursor-pointer" />
              <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                className="fixed top-0 right-0 h-full w-full sm:w-[420px] bg-paper z-[60] shadow-overlay flex flex-col">
                <div className="p-6 sm:p-8 border-b border-line flex items-center justify-between">
                  <h2 className="text-xl font-bold text-ink flex items-center gap-2">
                    <Calculator className="w-5 h-5 text-accent" />소싱 마진 계산기
                  </h2>
                  <button onClick={() => setIsCalcOpen(false)}>
                    <ChevronRight className="w-6 h-6 text-ink-2" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6">
                  {selectedProduct && (
                    <div className="flex gap-4 items-start">
                      {selectedProduct.productImage && (
                        <img src={selectedProduct.productImage} className="w-16 h-16 rounded-card object-cover border" alt="" />
                      )}
                      <div>
                        <h3 className="font-bold text-sm line-clamp-2 leading-tight text-ink">{selectedProduct.productName}</h3>
                        <p className="text-xs font-bold text-ink-2 mt-1">
                          쿠팡가 {selectedProduct.productPrice.toLocaleString()}원 · 리뷰 {selectedProduct.reviewCount.toLocaleString()}개
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-ink-2 mb-2 block uppercase text-center">판매가 (원)</label>
                      <input type="number" value={salePrice} onChange={e => setSalePrice(e.target.value)}
                        className="text-center w-full px-4 py-4 bg-accent-soft border border-accent-line rounded-card text-sm font-bold outline-none focus:ring-2 ring-accent" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-ink-2 mb-2 block uppercase text-center">1688 매입가 (위안)</label>
                      <input type="number" value={yuanPrice} onChange={e => setYuanPrice(e.target.value)} placeholder="예: 25.5"
                        className="text-center w-full px-4 py-4 bg-caution-soft border border-caution/30 rounded-card text-sm font-bold outline-none focus:ring-2 ring-caution" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-ink-2 mb-2 block uppercase text-center">소싱 배수(환율/관세)</label>
                      <input type="number" value={sourcingMultiplier} onChange={e => handleMultiplierChange(Number(e.target.value))}
                        className="text-center w-full px-4 py-4 bg-paper-2 border border-line rounded-card text-sm font-bold outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-ink-2 mb-2 block uppercase text-center">국내 배송비 (원)</label>
                      <input type="number" value={shippingFee} onChange={e => setShippingFee(e.target.value)}
                        className="text-center w-full px-4 py-4 bg-paper-2 border border-line rounded-card text-sm font-bold outline-none" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="bg-paper-2 rounded-card p-4 flex items-center justify-between border border-line">
                      <span className="text-xs font-bold text-ink-2">예상 원가 (위안 × 배수)</span>
                      <span className="text-sm font-semibold text-accent">{cost.toLocaleString()}원</span>
                    </div>
                    <div className="bg-paper-2 rounded-card p-4 flex items-center justify-between border border-line">
                      <span className="text-xs font-bold text-ink-2">판매 수수료 (12%)</span>
                      <span className="text-sm font-semibold text-ink-2">{fee.toLocaleString()}원</span>
                    </div>
                  </div>
                  <div className={`p-8 rounded-panel border-2 ${margin > 20 ? 'bg-positive-soft border-positive/20' : 'bg-paper-2 border-line'}`}>
                    <div className="flex justify-between items-center mb-6">
                      <span className="text-sm font-bold text-ink-2">예상 마진율</span>
                      <span className={`text-3xl font-semibold ${margin > 0 ? 'text-positive' : 'text-critical'}`}>{margin.toFixed(1)}%</span>
                    </div>
                    <div className="pt-6 flex justify-between items-center border-t border-dashed border-line">
                      <span className="font-bold text-lg text-ink">개당 수익</span>
                      <span className={`text-2xl font-semibold ${profit > 0 ? 'text-positive' : 'text-critical'}`}>
                        {profit.toLocaleString()}원
                      </span>
                    </div>
                  </div>
                  <button onClick={() => handle1688Click(selectedProduct || 'generic')}
                    className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-card text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-raised">
                    <DollarSign className="w-4 h-4" />1688 소싱처 찾기 (중달이)
                  </button>
                </div>
                <div className="p-6 sm:p-8 bg-paper-2 border-t border-line">
                  <button onClick={() => setIsCalcOpen(false)} className="w-full py-5 bg-ink text-white font-semibold rounded-card">닫기</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ══════════ 쇼크트리 이벤트 팝업 ══════════ */}
        <AnimatePresence>
          {popupProduct && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setPopupProduct(null)}
                className="fixed inset-0 z-[80] bg-ink/50 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                className="fixed inset-0 m-auto z-[90] w-[92%] max-w-[480px] h-fit bg-paper rounded-panel shadow-[0_24px_80px_-12px_rgba(0,0,0,0.3)] border border-line overflow-hidden flex flex-col">
                <div className="px-7 pt-7 pb-2 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">Hoonpro Special</p>
                    <h3 className="text-xl font-semibold text-ink mt-1.5">쇼크트리 추천인 가입 이벤트 안내</h3>
                  </div>
                  <button onClick={() => setPopupProduct(null)} className="p-1.5 text-ink-3 hover:text-ink-2 hover:bg-paper-2 rounded-full transition-all">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="px-7 pb-6 pt-2 flex flex-col gap-5">
                  <div className="bg-accent-soft border border-accent-line rounded-card px-5 py-4">
                    <p className="text-[13px] font-bold text-ink leading-relaxed">
                      회원가입 후{' '}
                      <span className="inline-block px-2 py-0.5 bg-accent text-white font-semibold rounded-control text-xs tracking-wide">hoonpro05</span>{' '}
                      추천인 코드를 입력하면 아래 추가 혜택이 제공됩니다.
                    </p>
                  </div>
                  <ul className="flex flex-col gap-2 text-[13px] font-bold text-ink">
                    <li className="flex items-start gap-2"><span className="text-accent font-semibold">①</span>LCL 중달이 사업자 통관 시 통관수수료 면제 <span className="text-ink-3">(3만 원 상당)</span></li>
                    <li className="flex items-start gap-2"><span className="text-accent font-semibold">②</span>OEM 공장조사 1회 무료 제공 <span className="text-ink-3">(5만 원 상당)</span></li>
                  </ul>
                </div>
                <div className="px-7 pb-7 pt-2 flex gap-2 border-t border-line">
                  <button onClick={() => {
                    localStorage.setItem(PURCHASE_POPUP_HIDE_KEY, new Date().toISOString().slice(0, 10));
                    const p = popupProduct; setPopupProduct(null); if (p) proceed1688(p);
                  }} className="flex-1 py-3 bg-paper-2 hover:bg-line text-ink rounded-card text-xs font-semibold transition-all">오늘 그만보기</button>
                  <button onClick={() => {
                    const p = popupProduct; setPopupProduct(null); if (p) proceed1688(p);
                  }} className="flex-1 py-3 bg-accent hover:bg-accent-hover text-white rounded-card text-xs font-semibold transition-all">이동하기</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
