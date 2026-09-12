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
import { SourcingProfit } from './Sourcing/SourcingProfit';
import { MarketChanges } from './Sourcing/MarketChanges';
import {
  Search, ChevronRight, Loader2, ExternalLink, Sparkles,
  Download, X, ArrowUpDown, KeyRound, RefreshCw, Star, Calculator,
  TrendingUp, Home, Rocket, Store, LayoutDashboard, Zap, BarChart3,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getToken } from '../lib/auth';
import { ReviewSummaryView, safeJson } from './ReviewAnalyzer';

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
  /** 검색에 섞여 든 다른 상품군 (음반·도서 등). 없으면 null */
  offCategory: { category: string; label: string; matched: string } | null;
  /** 몇 개들이 세트인가. 단품이면 1 */
  setCount?: number;
  /** 낱개 가격 — 세트를 감안한 값 */
  unitPrice?: number;
  calculated: {
    demandScore: number;
    entryEase: number;
    priceFit: number;
    opportunityScore: number;
    /** 적합도를 섞기 전, 시장 자체의 점수 */
    marketScore?: number;
    grade: 'Great' | 'Good' | 'Normal' | 'Bad';
    /** 왜 이 점수인지 세 줄 (+ 내 가게 기준 한 줄) */
    reasons: string[];
    /** 내 가게와 닮은 정도 (0~100). 실적이 적으면 null */
    fitScore?: number | null;
  };
}

interface MyProductHit {
  productId: string;
  productName: string;
  rank: number;
  isAd: boolean;
}

interface Market {
  /** 세트를 낱개로 환산한 중앙값 — 세트가 섞인 시장은 표시가 평균이 체감가와 다르다 */
  unitMedianPrice?: number;
  /** 세트 상품 비중 (%) */
  setRatio?: number;
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

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// 응답 본문을 JSON으로 읽는다. Vercel이 함수 타임아웃(504)·크래시(502)를 낼 때는
// JSON이 아니라 평문("An error occurred with your deployment")을 돌려주므로,
// 그대로 res.json()을 부르면 "Unexpected token 'A'" 같은 파싱 오류가 화면에 뜬다.
// 그런 경우 사용자가 읽을 수 있는 안내로 바꿔 돌려준다.
const readJson = async (res: Response): Promise<any> => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 504) return { error: '수집 시간이 초과됐습니다. 잠시 후 다시 시도해주세요.' };
    if (res.status >= 500) return { error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' };
    return { error: text.slice(0, 120) || `요청 실패 (${res.status})` };
  }
};

// 쿠팡 대표 카테고리 (서버 CATEGORY_SEEDS와 키가 일치해야 함)
const KW_CATEGORIES = [
  '여성패션', '남성패션', '뷰티', '출산/유아', '식품', '주방용품', '생활용품', '홈인테리어',
  '가전디지털', '스포츠/레저', '자동차용품', '완구/취미', '문구/오피스', '헬스/건강', '반려동물',
];

const coupangSearchUrl = (kw: string) => `https://www.coupang.com/np/search?q=${encodeURIComponent(kw)}`;
const naverShopUrl = (kw: string) => `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(kw)}`;

// 뱃지는 채운 배경 대신 얇은 테두리 — 카드 위에 여러 개가 올라가도 시끄럽지 않다.
const BADGE_BASE = 'inline-flex items-center rounded-control border px-2 py-0.5 text-[11px] font-semibold';

const gradeStyle = (grade: string) => {
  if (grade === 'Great') return 'text-positive border-positive/35 bg-positive-soft';
  if (grade === 'Good') return 'text-accent border-accent/35 bg-accent-soft';
  if (grade === 'Normal') return 'text-caution border-caution/35 bg-caution-soft';
  return 'text-ink-3 border-line-strong bg-paper-2';
};

const compStyle = (compIdx: string) => {
  if (compIdx === '낮음') return 'text-positive border-positive/35 bg-positive-soft';
  if (compIdx === '중간') return 'text-caution border-caution/35 bg-caution-soft';
  return 'text-critical border-critical/35 bg-critical-soft';
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
  const [activeMonth, setActiveMonth] = useState<number | null>(null);
  // 데이터랩 월별 트렌드: keyword → { monthlyAvg, peakMonths, seasonality, insufficient }
  const [trendMap, setTrendMap] = useState<Record<string, any>>({});
  const [trendLoading, setTrendLoading] = useState<string | null>(null);
  const [openTrend, setOpenTrend] = useState<string | null>(null);
  // 관심 키워드 리포트 (크론이 축적한 리뷰 증가 속도)
  // 주간 소싱 브리핑
  const [briefing, setBriefing] = useState<any | null>(null);
  // 상품 리뷰 분석
  const [reviewTarget, setReviewTarget] = useState<Product | null>(null);
  const [reviewData, setReviewData] = useState<any | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  // 관심 상품 순위 추적 (목록·관리는 '순위 추적' 탭, 여기선 원클릭 등록만)
  const [rankAdded, setRankAdded] = useState<Record<string, boolean>>({});

  // 필터/정렬 (키워드)
  const [sortKey, setSortKey] = useState<'opportunityScore' | 'monthlyVolume' | 'monthlyClicks' | 'competition'>('opportunityScore');
  const [minVolume, setMinVolume] = useState('100');

  // 관심 키워드

  // 쿠팡 상품 분석
  const [activeKeyword, setActiveKeyword] = useState<string | null>(null);
  const [prodLoading, setProdLoading] = useState(false);
  const [prodError, setProdError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [market, setMarket] = useState<Market | null>(null);
  const [myProducts, setMyProducts] = useState<MyProductHit[]>([]);
  const [servedFrom, setServedFrom] = useState<string>('fresh');
  const [prodDebug, setProdDebug] = useState<string | null>(null);
  const [rocketFilter, setRocketFilter] = useState<'all' | 'general' | 'jet' | 'rocket'>('all');
  const [prodSort, setProdSort] = useState<'opportunityScore' | 'reviewCount' | 'rank' | 'priceAsc'>('opportunityScore');
  const [excludeBrands, setExcludeBrands] = useState(true);
  const [gemMode, setGemMode] = useState(false);
  const [prodMinPrice, setProdMinPrice] = useState('');
  const [prodMaxPrice, setProdMaxPrice] = useState('');
  const productsRef = useRef<HTMLDivElement>(null);

  // [마진 분석]로 고른 상품 — 아래 손익 계산기가 이 값으로 채워진다
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);


  // ─── API: 키워드 발굴 ───────────────────────────────────────────────────────
  const fetchKeywords = async (kw: string, mode: 'new' | 'drill' | 'trail' = 'new') => {
    const trimmed = kw.trim();
    if (!trimmed) return;
    setActiveKwCategory(null);
    setActiveMonth(null);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sourcing?type=keywords&seed=${encodeURIComponent(trimmed)}`, { headers: authHeaders() });
      const data = await readJson(res);
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
    setActiveMonth(null);
    setLoading(true);
    setError(null);
    setSeedStat(null);
    setSeedTrail([]);
    setSeedInput('');
    setCurrentSeed(cat);
    try {
      const res = await fetch(`/api/sourcing?type=keywords&category=${encodeURIComponent(cat)}`, { headers: authHeaders() });
      const data = await readJson(res);
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

  const fetchMonthKeywords = async (m: number) => {
    setActiveMonth(m);
    setActiveKwCategory(null);
    setLoading(true);
    setError(null);
    setSeedStat(null);
    setSeedTrail([]);
    setSeedInput('');
    setCurrentSeed(`${m}월 시즌`);
    try {
      const res = await fetch(`/api/sourcing?type=keywords&month=${m}`, { headers: authHeaders() });
      const data = await readJson(res);
      if (!res.ok || data.error) {
        setError(data.error || '월별 시즌 키워드 조회 실패');
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

  // ─── API: 데이터랩 월별 트렌드 (계절성) ─────────────────────────────────────
  const ensureTrend = async (kw: string): Promise<void> => {
    if (trendMap[kw]) return;
    try {
      const res = await fetch(`/api/sourcing?type=trend&keyword=${encodeURIComponent(kw)}`, { headers: authHeaders() });
      const data = await readJson(res);
      if (!res.ok || data.error) {
        setTrendMap(prev => ({ ...prev, [kw]: { keyword: kw, error: data.error || '트렌드 조회 실패' } }));
      } else {
        const t = (data.trends || []).find((x: any) => x.keyword === kw) || data.trends?.[0];
        setTrendMap(prev => ({ ...prev, [kw]: t || { keyword: kw, insufficient: true } }));
      }
    } catch (e: any) {
      setTrendMap(prev => ({ ...prev, [kw]: { keyword: kw, error: e.message } }));
    }
  };

  const fetchTrend = async (kw: string) => {
    if (openTrend === kw) { setOpenTrend(null); return; }
    if (trendMap[kw]) { setOpenTrend(kw); return; }
    setTrendLoading(kw);
    await ensureTrend(kw);
    setOpenTrend(kw);
    setTrendLoading(null);
  };

  // 계절성 요약 (배지용): 피크 월 + 소싱 적기
  const seasonalitySummary = (t: any): { label: string; prep?: string } | null => {
    if (!t || t.error || t.insufficient || !Array.isArray(t.monthlyAvg) || t.monthlyAvg.length === 0) return null;
    const peaks: number[] = Array.isArray(t.peakMonths) ? t.peakMonths : [];
    const flat = peaks.length === 0 || peaks.length > 4 || (t.seasonality > 0 && t.seasonality < 1.4);
    if (flat) return { label: '연중 고른 수요' };
    const p = peaks[0];
    const a = ((p - 3 + 12) % 12) + 1;
    const b = ((p - 2 + 12) % 12) + 1;
    return { label: `매년 ${peaks.join('·')}월 피크`, prep: `${a}~${b}월 소싱 적기` };
  };

  // ─── API: 주간 소싱 브리핑 ──────────────────────────────────────────────────
  const fetchBriefing = async () => {
    try {
      const res = await fetch('/api/sourcing?type=briefing', { headers: authHeaders() });
      const data = await readJson(res);
      if (res.ok && !data.error) setBriefing(data);
    } catch { /* 브리핑 실패는 조용히 무시 */ }
  };

  // ─── API: 관심 상품 순위 추적 (원클릭 등록 — 관리는 '순위 추적' 탭에서) ────────
  const addRankWatch = async (keyword: string, product: string, name = ''): Promise<boolean> => {
    const params = new URLSearchParams({ type: 'rankwatch', action: 'add', keyword: keyword.trim(), product: product.trim() });
    if (name) params.set('name', name.slice(0, 150));
    try {
      const res = await fetch(`/api/sourcing?${params.toString()}`, { headers: authHeaders() });
      const data = await readJson(res);
      if (!res.ok || data.error) { alert(data.error || '순위 추적 등록 실패'); return false; }
      return true;
    } catch (e: any) {
      alert(e.message);
      return false;
    }
  };

  useEffect(() => {
    fetchBriefing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── API: 상품 리뷰 분석 ────────────────────────────────────────────────
  const fetchReviewAnalysis = async (p: Product) => {
    setReviewTarget(p);
    setReviewData(null);
    setReviewLoading(true);
    try {
      const res = await fetch(
        // 상품번호만 보내면 서버가 대표 옵션의 리뷰를 찾는다. 검색에서 받은
        // 주소에는 옵션 번호가 들어 있어, 있으면 그대로 넘긴다.
        `/api/sourcing?type=reviews&product=${encodeURIComponent(p.productUrl || p.productId)}&name=${encodeURIComponent(p.productName.slice(0, 100))}`,
        { headers: authHeaders() },
      );
      const data = await safeJson(res);
      setReviewData(data);
      if (typeof data.remaining === 'number') {
        window.dispatchEvent(new CustomEvent('usage-updated', { detail: { remaining: data.remaining } }));
      }
    } catch (e: any) {
      setReviewData({ error: e.message });
    } finally {
      setReviewLoading(false);
    }
  };

  // ─── API: 쿠팡 상품 분석 ────────────────────────────────────────────────────
  const fetchProducts = async (kw: string, volume = 0) => {
    setActiveKeyword(kw);
    void ensureTrend(kw); // 시장 분석 헤더의 계절성 배지용 (7일 캐시라 부담 없음)
    setProdLoading(true);
    setProdError(null);
    setTimeout(() => productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    try {
      const params = new URLSearchParams({ type: 'products', keyword: kw });
      if (volume > 0) params.set('volume', String(volume));
      const res = await fetch(`/api/sourcing?${params.toString()}`, { headers: authHeaders() });
      const data = await readJson(res);
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
      setMyProducts(Array.isArray(data.myProducts) ? data.myProducts : []);
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

  // 마진 계산은 손익 계산기(SourcingProfit) 한 곳에서 한다. 예전에는 여기에도
  // 계산기가 있었는데 수수료 12%·배송비 3,000원이 코드에 박혀 있어 실측 비율을
  // 쓰는 손익 계산기와 다른 답을 냈다. 둘이 다르면 어느 쪽도 못 믿는다.
  const openCalcForProduct = (p: Product) => {
    setSelectedProduct(p);
    document.getElementById('sourcing-profit')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  // 예전에는 여기서 추천인 이벤트 팝업으로 한 번 가로막았다. '오늘 그만보기'를
  // 눌러도 다음 날 또 떠서, 기억에 남는 건 혜택이 아니라 팝업이었다.
  // 혜택 안내는 버튼 아래 한 줄로 옮기고 누르는 사람만 보게 한다.
  const handle1688Click = (target: Product | 'generic') => {
    if (target === 'generic') window.open('https://jungdari.com', '_blank', 'noopener');
    else submit1688ImageSearch(target.productImage);
  };

  // ─── 파생 목록 ──────────────────────────────────────────────────────────────
  const sourceList = keywords;
  const displayKeywords = sourceList
    .filter(k => k.monthlyVolume >= (Number(minVolume) || 0))
    .sort((a, b) => {
      if (sortKey === 'competition') return a.competition - b.competition;
      return (b[sortKey] as number) - (a[sortKey] as number);
    });

  const displayProducts = [...products]
    .filter(p => !excludeBrands || !p.isBrand)
    .filter(p => rocketFilter === 'all' || p.deliveryType === rocketFilter)
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
    `키워드발굴_${currentSeed || 'result'}.csv`,
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


  const verdictText: Record<Market['entryVerdict'], { label: string; desc: string; color: string }> = {
    Excellent: { label: '진입 기회 높음', desc: '로켓 비중이 낮고 경쟁이 약한 시장', color: 'text-positive' },
    Good: { label: '진입 가능', desc: '로켓과 일반 셀러가 공존하는 시장', color: 'text-accent' },
    Fair: { label: '진입 주의', desc: '로켓 비중이 높은 편 — 차별화 필요', color: 'text-caution' },
    Bad: { label: '진입 비추천', desc: '쿠팡 직매입(로켓)이 장악한 시장', color: 'text-critical' },
  };

  // ─── 렌더 ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-paper text-ink">
      <main className="mx-auto max-w-[1240px] px-6 py-8 flex flex-col gap-6 bg-paper">

        {/* 헤더 라인 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 px-4 py-2 bg-accent-soft rounded-card">
            <KeyRound className="w-4 h-4 text-accent" />
            <span className="text-sm font-semibold text-accent">니치 키워드 발굴 + 쿠팡 실데이터 분석</span>
          </div>
          <p className="text-[11px] text-ink-3 font-semibold hidden md:block">
            쿠팡 실시간 수집 데이터 기반
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => { setSelectedProduct(null); document.getElementById('sourcing-profit')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
              className="flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
              <Calculator className="w-3.5 h-3.5" />마진 계산기
            </button>
          </div>
        </div>

        {/* 주간 소싱 브리핑 — 다음 달 시즌 키워드 중 기회점수 상위 */}
        {briefing?.items?.length > 0 && (
          <div className="rounded-panel border border-accent-line bg-accent-soft p-5">
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-accent">
              <Zap className="h-3.5 w-3.5" />
              이번 주 추천 소싱 키워드 TOP {briefing.items.length}
            </p>
            <p className="mb-3 text-[12px] text-ink-2">
              <b className="text-ink">{briefing.month}월 판매</b>를 준비할 키워드 중 검색량·경쟁·계절성 기준 상위입니다.
              {briefing.leadMonths > 1 && <> 대표님 리드타임({briefing.leadMonths}개월 앞)에 맞춰 잡았습니다.</>}
              {' '}누르면 바로 쿠팡 분석이 실행됩니다.
            </p>
            <div className="flex gap-2 flex-wrap">
              {briefing.items.map((it: any) => (
                <button key={it.keyword} onClick={() => fetchProducts(it.keyword, it.monthlyVolume)}
                  className="group flex items-center gap-2 rounded-control border border-line bg-paper px-3 py-2 text-left transition-colors hover:border-accent">
                  <span className="text-[13px] font-semibold text-ink group-hover:text-accent">{it.keyword}</span>
                  <span className="text-[11px] tabular-nums text-ink-3">{Number(it.monthlyVolume).toLocaleString()}</span>
                  {Array.isArray(it.peakMonths) && it.peakMonths.length > 0 && it.peakMonths.length <= 4 && (
                    <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">{it.peakMonths.join('·')}월 피크</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 월별 시즌 키워드 — 소싱은 판매 1~2개월 전에 시작해야 함 */}
        {(() => {
          const curMonth = new Date().getMonth() + 1;
          const recMonth1 = (curMonth % 12) + 1;
          const recMonth2 = (recMonth1 % 12) + 1;
          return (
            <div className="bg-paper rounded-panel p-5 border border-line">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-2 mb-1 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                월별 시즌 키워드 — 그 달에 잘 팔리는 시즌 상품
              </p>
              <p className="mb-3 text-[12px] text-ink-2">
                소싱→입고→판매까지 1~2개월 걸립니다. 지금은 {curMonth}월이니 <b className="text-accent">{recMonth1}월·{recMonth2}월 판매 상품</b>을 준비할 때입니다.
              </p>
              <div className="flex gap-2 flex-wrap">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                  const isRec = m === recMonth1 || m === recMonth2;
                  return (
                    <button key={m} onClick={() => fetchMonthKeywords(m)} disabled={loading}
                      className={`relative rounded-control border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${
                        activeMonth === m
                          ? 'border-ink bg-ink text-paper'
                          : isRec
                            ? 'border-accent-line bg-accent-soft text-accent hover:border-accent'
                            : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'
                      }`}>
                      {m}월{isRec && activeMonth !== m ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* 쿠팡 대표 카테고리 (시드 없이 추천 키워드) */}
        <div className="bg-paper rounded-panel p-5 border border-line">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-2 mb-3 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            쿠팡 대표 카테고리 — 시드 키워드가 떠오르지 않으면 카테고리만 눌러도 추천 키워드가 나옵니다
          </p>
          <div className="flex gap-2 flex-wrap">
            {KW_CATEGORIES.map(cat => (
              <button key={cat} onClick={() => fetchCategoryKeywords(cat)} disabled={loading}
                className={`rounded-control border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${
                  activeKwCategory === cat
                    ? 'border-ink bg-ink text-paper'
                    : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'
                }`}>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* 검색바 */}
        <div className="flex flex-col items-stretch gap-2.5 rounded-card border border-line bg-paper p-3 sm:flex-row sm:items-center">
          <div className="flex-1 relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <input
              type="text"
              value={seedInput}
              onChange={e => setSeedInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchKeywords(seedInput)}
              placeholder="시드 키워드 입력 (예: 캠핑의자) — 연관 니치 키워드를 발굴합니다"
              className="w-full rounded-control border border-line bg-paper-2 py-2.5 pl-11 pr-4 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:bg-paper"
            />
          </div>
          <button
            onClick={() => fetchKeywords(seedInput)}
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-control bg-ink px-6 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
            키워드 발굴
          </button>
          {displayKeywords.length > 0 && (
            <button onClick={exportKeywordsCSV} className="flex items-center justify-center rounded-control border border-line px-3.5 py-2.5 text-ink-2 transition-colors hover:border-line-strong hover:text-ink" title="CSV로 저장">
              <Download className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* 심층 확장 경로 */}
        {seedTrail.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs font-semibold text-ink-2">
            <Home className="w-3.5 h-3.5 text-ink-3" />
            {seedTrail.map((s, i) => (
              <React.Fragment key={s}>
                {i > 0 && <ChevronRight className="w-3 h-3 text-ink-3" />}
                <button onClick={() => fetchKeywords(s, 'trail')}
                  className={`px-2.5 py-1 rounded-control transition-all ${
                    s === currentSeed ? 'bg-accent text-paper' : 'bg-paper-2 hover:bg-accent-soft hover:text-accent'
                  }`}>
                  {s}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-critical-soft border border-critical/30 rounded-card p-4 text-critical text-sm font-semibold whitespace-pre-wrap">{error}</div>
        )}

        {/* 시드 키워드 요약 */}
        {seedStat && !loading && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-card border border-line bg-paper p-5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">"{seedStat.keyword}" 월간 검색량</p>
              <p className="text-[26px] font-semibold tracking-tight tabular-nums text-ink">{seedStat.monthlyVolume.toLocaleString()}</p>
              <p className="mt-1 text-[12px] text-ink-3">PC {seedStat.monthlyPcVolume.toLocaleString()} · 모바일 {seedStat.monthlyMobileVolume.toLocaleString()}</p>
            </div>
            <div className="rounded-card border border-line bg-paper p-5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">월평균 클릭수</p>
              <p className="text-[26px] font-semibold tracking-tight tabular-nums text-ink">{seedStat.monthlyClicks.toLocaleString()}</p>
              <p className="mt-1 text-[12px] text-ink-3">광고 클릭 기준 실측치</p>
            </div>
            <div className="rounded-card border border-line bg-paper p-5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">광고 경쟁도</p>
              <span className={`${BADGE_BASE} mt-1 ${compStyle(seedStat.compIdx)}`}>{seedStat.compIdx}</span>
              <p className="mt-2 text-[12px] text-ink-3">평균 노출 광고 {seedStat.adDepth}개</p>
            </div>
            <div className="rounded-card border border-line bg-paper p-5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-2">기회점수</p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-[26px] font-semibold tracking-tight tabular-nums text-ink">{seedStat.opportunityScore}</p>
                <span className={`${BADGE_BASE} ${gradeStyle(seedStat.grade)}`}>{seedStat.grade}</span>
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
            <p className="text-sm font-semibold">훈프로AI 연관 키워드를 수집 중...</p>
          </div>
        ) : displayKeywords.length > 0 ? (
          <div className="bg-paper rounded-panel border border-line overflow-hidden">
            <div className="p-5 border-b border-line flex items-center gap-3 flex-wrap">
              <h3 className="text-sm font-semibold text-ink">
                {activeMonth
                    ? <>{activeMonth}월 시즌 추천 키워드 <span className="text-accent">{displayKeywords.length}개</span></>
                    : activeKwCategory
                      ? <>"{activeKwCategory}" 추천 키워드 <span className="text-accent">{displayKeywords.length}개</span></>
                      : <>연관 니치 키워드 <span className="text-accent">{displayKeywords.length}개</span></>}
              </h3>
              {cached && (
                <span className="text-[10px] font-semibold text-ink-3 flex items-center gap-1"><RefreshCw className="w-3 h-3" />캐시 데이터</span>
              )}
              <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                <div className="flex items-center gap-1 bg-paper-2 rounded-control px-2 py-1">
                  <span className="text-[11px] text-ink-3">검색량 ≥</span>
                  <input type="number" value={minVolume} onChange={e => setMinVolume(e.target.value)}
                    className="w-16 bg-transparent text-[12px] font-medium tabular-nums text-ink outline-none" />
                </div>
                <div className="flex items-center gap-1 bg-paper-2 rounded-control px-2 py-1.5">
                  <ArrowUpDown className="w-3 h-3 text-ink-3" />
                  <select value={sortKey} onChange={e => setSortKey(e.target.value as any)}
                    className="cursor-pointer bg-transparent text-[12px] font-medium text-ink outline-none">
                    <option value="opportunityScore">기회점수순</option>
                    <option value="monthlyVolume">검색량순</option>
                    <option value="monthlyClicks">클릭수순</option>
                    <option value="competition">경쟁 낮은순</option>
                  </select>
                </div>
              </div>
            </div>
            {(
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    {/* 머리글과 본문의 칸 수가 같아야 한다. 예전에 ★ 버튼 칸을
                        지우면서 본문 td만 빠지고 머리글의 빈 th가 남아, 키워드가
                        40px짜리 칸에 갇혀 한 글자씩 세로로 쪼개졌다. */}
                    <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                      <th className="px-3 py-2.5 text-left">키워드</th>
                      <th className="px-4 py-2.5 text-right">월간 검색량</th>
                      <th className="hidden px-4 py-2.5 text-right md:table-cell">월평균 클릭</th>
                      <th className="px-4 py-2.5 text-center">광고경쟁</th>
                      <th className="w-36 px-4 py-2.5 text-left">기회점수</th>
                      <th className="px-4 py-2.5 text-center">등급</th>
                      <th className="px-4 py-2.5 text-right">분석</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayKeywords.slice(0, 100).map(k => (
                      <React.Fragment key={k.keyword}>
                      <tr
                        className={`group border-b border-line transition-colors last:border-b-0 ${
                          activeKeyword === k.keyword ? 'bg-accent-soft' : 'hover:bg-paper-2'
                        }`}
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 text-[13px] font-medium text-ink">{k.keyword}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          <span className="text-[13px] font-semibold text-ink">{k.monthlyVolume.toLocaleString()}</span>
                          <span className="mt-0.5 block text-[11px] text-ink-3">PC {k.monthlyPcVolume.toLocaleString()} · MO {k.monthlyMobileVolume.toLocaleString()}</span>
                        </td>
                        <td className="hidden px-4 py-2.5 text-right text-[13px] tabular-nums text-ink-2 md:table-cell">{k.monthlyClicks.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`${BADGE_BASE} ${compStyle(k.compIdx)}`}>{k.compIdx}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                              <div className="h-full rounded-full bg-ink" style={{ width: `${k.opportunityScore}%` }} />
                            </div>
                            <span className="w-6 text-right text-[13px] font-semibold tabular-nums text-ink">{k.opportunityScore}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`${BADGE_BASE} ${gradeStyle(k.grade)}`}>{k.grade}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          {/* 주 동작만 채우고 나머지는 조용하게 — 행 위에 올렸을 때 또렷해진다 */}
                          <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                            <button onClick={() => fetchProducts(k.keyword, k.monthlyVolume)}
                              title="쿠팡 상품·리뷰 실데이터 분석"
                              className="flex items-center gap-1 rounded-control bg-ink px-2.5 py-1.5 text-[11px] font-semibold text-paper transition-opacity hover:opacity-90">
                              <LayoutDashboard className="h-3 w-3" />쿠팡 분석
                            </button>
                            <button onClick={() => fetchKeywords(k.keyword, 'drill')}
                              title="이 키워드를 시드로 다시 확장"
                              className="flex items-center gap-1 rounded-control border border-line px-2.5 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
                              <TrendingUp className="h-3 w-3" />확장
                            </button>
                            <button onClick={() => fetchTrend(k.keyword)}
                              title="최근 3년 월별 검색 트렌드 (계절성)"
                              className={`flex items-center gap-1 rounded-control border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                                openTrend === k.keyword
                                  ? 'border-accent bg-accent-soft text-accent'
                                  : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'
                              }`}>
                              {trendLoading === k.keyword ? <Loader2 className="h-3 w-3 animate-spin" /> : <BarChart3 className="h-3 w-3" />}트렌드
                            </button>
                            <a href={coupangSearchUrl(k.keyword)} target="_blank" rel="noopener noreferrer"
                              title="쿠팡에서 이 키워드 검색 결과 직접 확인"
                              className="rounded-control border border-line px-2.5 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
                              쿠팡
                            </a>
                            <a href={naverShopUrl(k.keyword)} target="_blank" rel="noopener noreferrer"
                              title="네이버쇼핑에서 직접 확인"
                              className="rounded-control border border-line px-2.5 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
                              N쇼핑
                            </a>
                          </div>
                        </td>
                      </tr>
                      {openTrend === k.keyword && (() => {
                        const t = trendMap[k.keyword];
                        if (!t) return null;
                        const avg: number[] = Array.isArray(t.monthlyAvg) ? t.monthlyAvg : [];
                        const maxAvg = Math.max(...avg, 1);
                        const peaks: number[] = Array.isArray(t.peakMonths) ? t.peakMonths : [];
                        const flatDemand = peaks.length === 0 || peaks.length > 4 || (t.seasonality > 0 && t.seasonality < 1.4);
                        const firstPeak = peaks[0] || 0;
                        const prepA = firstPeak ? ((firstPeak - 3 + 12) % 12) + 1 : 0;
                        const prepB = firstPeak ? ((firstPeak - 2 + 12) % 12) + 1 : 0;
                        return (
                          <tr className="border-b border-line bg-paper-2/60 last:border-b-0">
                            <td colSpan={8} className="px-5 py-4">
                              {t.error ? (
                                <p className="text-[12px] text-critical">{t.error}</p>
                              ) : t.insufficient || avg.length === 0 ? (
                                <p className="text-[12px] text-ink-3">검색량이 적어 데이터랩 트렌드 데이터가 없는 키워드입니다.</p>
                              ) : (
                                <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-6">
                                  <div className="flex-1">
                                    <div className="mb-2 flex items-center gap-2 flex-wrap">
                                      <p className="text-[11px] font-semibold text-ink-2">최근 3년 월별 검색 트렌드 — 네이버 데이터랩</p>
                                      {flatDemand ? (
                                        <span className={`${BADGE_BASE} border-line-strong bg-paper text-ink-2`}>연중 고른 수요</span>
                                      ) : (
                                        <span className={`${BADGE_BASE} border-accent/35 bg-accent-soft text-accent`}>매년 {peaks.join('·')}월 피크</span>
                                      )}
                                      {t.seasonality >= 1.4 && (
                                        <span className="text-[11px] text-ink-3">피크월 검색량이 바닥월의 {t.seasonality}배</span>
                                      )}
                                    </div>
                                    <div className="flex h-16 items-end gap-1">
                                      {avg.map((v, i) => (
                                        <div key={i} className="flex flex-1 flex-col items-center gap-1" title={`${i + 1}월 평균 ${v}`}>
                                          <div
                                            className={`w-full rounded-t-[3px] ${!flatDemand && peaks.includes(i + 1) ? 'bg-accent' : 'bg-accent/30'}`}
                                            style={{ height: `${Math.max(v / maxAvg * 52, v > 0 ? 3 : 1)}px` }}
                                          />
                                          <span className={`text-[9px] leading-none ${!flatDemand && peaks.includes(i + 1) ? 'font-semibold text-accent' : 'text-ink-3'}`}>{i + 1}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  {!flatDemand && firstPeak > 0 && (
                                    <p className="shrink-0 rounded-control border border-accent-line bg-accent-soft px-3 py-2 text-[12px] font-medium text-accent">
                                      {firstPeak}월 피크 → <b>{prepA}~{prepB}월에 소싱 시작</b> 추천
                                    </p>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })()}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        ) : !seedStat && !error && !activeKeyword && (
          <div className="flex flex-col items-center justify-center py-20 text-ink-3">
            <KeyRound className="w-16 h-16 mb-6 opacity-20" />
            <h2 className="text-xl font-semibold">니치 시장 발굴을 시작하세요</h2>
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
                <div className="bg-critical-soft border border-critical/30 rounded-card p-4 text-critical text-sm font-semibold whitespace-pre-wrap">{prodError}</div>
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
                  <p className="text-sm font-semibold">"{activeKeyword}" 쿠팡 검색 결과를 실시간 수집하는 중... (5~20초)</p>
                </div>
              ) : market && (
                <>
                  {/* 시장 요약 */}
                  <div className="bg-paper rounded-panel p-6 border border-line">
                    <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
                      <h3 className="text-base font-semibold text-ink">
                        "{activeKeyword}" <span className="text-ink-3 font-semibold">쿠팡 시장 분석</span>
                        <a href={coupangSearchUrl(activeKeyword!)} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 ml-3 text-[11px] font-semibold text-critical hover:text-critical">
                          쿠팡에서 보기 <ExternalLink className="w-3 h-3" />
                        </a>
                      </h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        {(() => {
                          const s = seasonalitySummary(trendMap[activeKeyword || '']);
                          if (!s) return null;
                          return (
                            <span className={`${BADGE_BASE} ${s.prep ? 'border-accent/35 bg-accent-soft text-accent' : 'border-line-strong bg-paper-2 text-ink-2'}`}>
                              {s.label}{s.prep ? ` · ${s.prep}` : ''}
                            </span>
                          );
                        })()}
                        <span className={`text-xs font-semibold ${verdictText[market.entryVerdict].color}`}>
                          {verdictText[market.entryVerdict].label} · {verdictText[market.entryVerdict].desc}
                        </span>
                      </div>
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
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">경쟁 강도 (상품수 ÷ 검색량)</p>
                        <p className={`text-xl font-semibold ${market.competitionRate === null ? 'text-ink-3' : market.competitionRate < 2 ? 'text-positive' : market.competitionRate < 8 ? 'text-accent' : 'text-critical'}`}>
                          {market.competitionRate === null ? '—' : market.competitionRate}
                        </p>
                        <p className="mt-1 text-[12px] text-ink-3">
                          총 {market.totalProducts > 0 ? market.totalProducts.toLocaleString() : '?'}개 상품
                          {market.keywordVolume > 0 && ` / 검색 ${market.keywordVolume.toLocaleString()}회`}
                        </p>
                      </div>
                      <div className="bg-paper-2 rounded-card p-4 border border-line">
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">리뷰 진입장벽</p>
                        <p className="text-xl font-semibold text-accent">중앙값 {market.medianReviews.toLocaleString()}</p>
                        <p className="mt-1 text-[12px] text-ink-3">1위 상품 리뷰 {market.maxReviews.toLocaleString()}개</p>
                      </div>
                      <div className="bg-paper-2 rounded-card p-4 border border-line">
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">평균 판매가</p>
                        <p className="text-xl font-semibold text-caution">{market.avgPrice.toLocaleString()}원</p>
                        <p className="mt-1 text-[12px] text-ink-3">{market.minPrice.toLocaleString()} ~ {market.maxPrice.toLocaleString()}원</p>
                        {/* 세트가 섞인 시장은 표시가가 체감가와 다르다. 2종 세트 41,200원은 낱개 20,600원이다 */}
                        {(market.setRatio ?? 0) >= 20 && (market.unitMedianPrice ?? 0) > 0 && (
                          <p className="mt-1 text-[11.5px] text-accent">
                            세트 {market.setRatio}% · 낱개 {market.unitMedianPrice!.toLocaleString()}원
                          </p>
                        )}
                      </div>
                    </div>

                    {/* 검색량·경쟁까지 봤으면 다음 질문은 "그래서 얼마 남나"다.
                        내 실제 정산 비율로 원가 상한을 낸다 — 경쟁사는 못 하는 계산이다. */}
                    <div className="mt-4 flex flex-col gap-3">
                      <div id="sourcing-profit">
                        <SourcingProfit avgPrice={market.avgPrice} product={selectedProduct} />
                      </div>
                      {/* 이 키워드를 전에도 본 적 있으면 그 사이 무엇이 달라졌는지 짚어 준다 */}
                      {/* 새 상품을 찾는 것만큼이나 "내 시장이 지금 어떤가"를 보러 온다 */}
                      {myProducts.length > 0 && (
                        <div className="rounded-card border border-accent-line bg-accent-soft p-4">
                          <p className="mb-2 text-[12px] font-semibold text-accent">
                            이 키워드에 내 상품 {myProducts.length}개가 있습니다
                          </p>
                          <div className="flex flex-col gap-1.5">
                            {myProducts.map(m => (
                              <div key={m.productId} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                                <span className="min-w-0 flex-1 truncate text-ink" title={m.productName}>{m.productName}</span>
                                <span className="shrink-0 font-semibold tabular-nums text-ink">
                                  {m.rank}위{m.isAd && <span className="ml-1 font-normal text-caution">광고</span>}
                                </span>
                              </div>
                            ))}
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                            위 목록의 경쟁 상품과 나란히 보시면 무엇이 다른지 알 수 있습니다.
                          </p>
                        </div>
                      )}
                      <MarketChanges keyword={activeKeyword ?? ""} />
                    </div>
                  </div>

                  {/* 필터 */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={() => setGemMode(v => !v)}
                      title="리뷰 30~1000개(수요 검증)이면서 로켓·브랜드가 아닌 상품만 — 진입 가능한 검증 시장"
                      className={`rounded-control border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                        gemMode ? 'border-ink bg-ink text-paper' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'
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
                          className={`px-3 py-1.5 rounded-control text-xs font-semibold ${rocketFilter === f.v ? 'bg-ink-2 text-paper' : 'text-ink-2'}`}>
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 bg-paper rounded-card px-3 py-1.5 border border-line">
                      <span className="text-[11px] text-ink-3">가격</span>
                      <input type="number" value={prodMinPrice} onChange={e => setProdMinPrice(e.target.value)} placeholder="최소"
                        className="w-16 bg-transparent text-[12px] font-medium tabular-nums text-ink outline-none" />
                      <span className="text-ink-3">~</span>
                      <input type="number" value={prodMaxPrice} onChange={e => setProdMaxPrice(e.target.value)} placeholder="최대"
                        className="w-16 bg-transparent text-[12px] font-medium tabular-nums text-ink outline-none" />
                    </div>
                    <button onClick={() => setExcludeBrands(v => !v)}
                      title="브랜드 상품(나이키·네파 등)을 목록에서 숨기거나 표시"
                      className={`px-3 py-2 rounded-card text-xs font-semibold border  transition-all ${
                        excludeBrands ? 'bg-ink-2 text-paper border-ink' : 'bg-paper text-ink-2 border-line'
                      }`}>
                      브랜드 제외 {excludeBrands ? 'ON' : 'OFF'}
                    </button>
                    <div className="flex items-center gap-2 bg-paper rounded-card px-3 py-1.5 border border-line">
                      <ArrowUpDown className="w-3.5 h-3.5 text-ink-3" />
                      <select value={prodSort} onChange={e => setProdSort(e.target.value as any)}
                        className="cursor-pointer bg-transparent text-[12px] font-medium text-ink outline-none">
                        <option value="opportunityScore">기회점수순</option>
                        <option value="reviewCount">리뷰 많은순</option>
                        <option value="rank">쿠팡 노출순</option>
                        <option value="priceAsc">가격 낮은순</option>
                      </select>
                    </div>
                    <button onClick={exportProductsCSV}
                      className="ml-auto flex items-center gap-2 px-4 py-2 bg-positive hover:bg-positive text-paper rounded-card text-xs font-semibold transition-all">
                      <Download className="w-3.5 h-3.5" />CSV 저장
                    </button>
                    {servedFrom !== 'fresh' && (
                      <span className="text-[10px] font-semibold text-ink-3 flex items-center gap-1">
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
                              {/* 쿠팡 검색은 카테고리를 안 가린다. "검정치마"에 밴드 3집 CD가 섞여 들어온다 */}
                              {product.offCategory && (
                                <div className="rounded-control bg-ink/85 px-2 py-0.5 text-[9px] font-semibold text-paper backdrop-blur"
                                  title={`상품명에 "${product.offCategory.matched}"가 있어 ${product.offCategory.label}으로 보입니다. 점수 순위에서 내렸습니다`}>
                                  {product.offCategory.label}?
                                </div>
                              )}
                              <div className={`${BADGE_BASE} bg-paper/90 backdrop-blur ${gradeStyle(product.calculated.grade)}`}>
                                {product.calculated.grade}
                              </div>
                              {product.deliveryType === 'rocket' && (
                                <div className="px-2 py-0.5 bg-critical text-paper text-[8px] font-semibold rounded uppercase flex items-center gap-1">
                                  <Rocket className="w-2.5 h-2.5" />로켓
                                </div>
                              )}
                              {product.deliveryType === 'jet' && (
                                <div className="px-2 py-0.5 bg-caution text-paper text-[8px] font-semibold rounded uppercase flex items-center gap-1">
                                  <Rocket className="w-2.5 h-2.5" />판매자로켓
                                </div>
                              )}
                              {product.deliveryType === 'general' && (
                                <div className="px-2 py-0.5 bg-positive text-paper text-[8px] font-semibold rounded uppercase flex items-center gap-1">
                                  <Store className="w-2.5 h-2.5" />일반배송
                                </div>
                              )}
                              {product.isBrand && (
                                <div className="px-2 py-0.5 bg-ink-2 text-paper text-[8px] font-semibold rounded uppercase">브랜드</div>
                              )}
                            </div>
                            <div className="absolute top-3 left-3 px-2 py-1 bg-ink/70 text-paper text-[10px] font-semibold rounded-control backdrop-blur-sm">
                              노출 {product.rank}위
                            </div>
                          </a>
                          <div className="p-5 flex-1 flex flex-col">
                            <h3 className="font-semibold text-[14px] text-ink line-clamp-2 mb-2 h-10 leading-snug">{product.productName}</h3>
                            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                              {product.reviewCount > 0 ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control bg-positive-soft text-positive text-[10px] font-semibold ring-1 ring-positive/20">
                                  <Star className="w-3 h-3 fill-emerald-500 text-positive" />
                                  {product.rating.toFixed(1)} · 리뷰 {product.reviewCount.toLocaleString()}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-control bg-paper-2 text-ink-3 text-[10px] font-semibold ring-1 ring-line">리뷰 없음</span>
                              )}
                              {product.reviewGrowthPerDay !== null && product.reviewGrowthPerDay > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-control bg-accent-soft text-accent text-[10px] font-semibold ring-1 ring-accent/20"
                                  title={`최근 ${product.obsDays}일 관측 기준 리뷰 증가 속도 (판매속도 지표)`}>
                                  <Zap className="w-3 h-3" />+{product.reviewGrowthPerDay}/일
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mb-3">
                              <span className={`${BADGE_BASE} ${gradeStyle(product.calculated.grade)}`}
                                title={product.calculated.fitScore != null
                                  ? `수요·진입난이도·가격에 대표님의 최근 60일 실적(가격대·판매 창구·세트 구성)까지 반영한 점수입니다. 시장 자체 점수는 ${product.calculated.marketScore}점입니다`
                                  : '수요검증(리뷰)·진입용이성(배송유형)·가격적합도 종합 (0~100)'}>
                                기회지수 {product.calculated.opportunityScore}
                                {product.calculated.fitScore != null && <span className="ml-1 font-normal opacity-70">내 기준</span>}
                              </span>
                              <span className={`px-2 py-0.5 rounded-control text-[10px] font-semibold ring-1 ${
                                product.deliveryType === 'rocket' ? 'bg-critical-soft text-critical ring-critical/20' : 'bg-positive-soft text-positive ring-positive/20'
                              }`}>
                                {product.deliveryType === 'rocket' ? '로켓 직접경쟁' : '셀러 진입 가능'}
                              </span>
                            </div>
                            {/* 숫자만 있으면 왜 Great인지 알 수 없어 믿기 어렵다. 세 축을 한 줄씩 말한다 */}
                            {(product.setCount ?? 1) > 1 && (
                              <p className="mb-1.5 text-[11px] text-accent">
                                {product.setCount}종 세트 · 낱개 {product.unitPrice?.toLocaleString()}원
                              </p>
                            )}
                            {product.calculated.reasons?.length > 0 && (
                              <ul className="mb-3 flex flex-col gap-0.5">
                                {product.calculated.reasons.map(r => (
                                  <li key={r} className="text-[10.5px] leading-snug text-ink-3">· {r}</li>
                                ))}
                              </ul>
                            )}
                            <div className="flex flex-col gap-1.5 mb-4">
                              <span className="text-lg font-semibold text-accent">{product.productPrice.toLocaleString()}원</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-ink-3 font-semibold">예상 1688원가:</span>
                                <input type="number" value={product.estimated1688Price || ''}
                                  onChange={e => {
                                    const newPrice = Number(e.target.value);
                                    setProducts(prev => prev.map(p => p.productId === product.productId ? { ...p, estimated1688Price: newPrice } : p));
                                    const saved = JSON.parse(localStorage.getItem('1688prices') || '{}');
                                    saved[product.productId] = newPrice;
                                    localStorage.setItem('1688prices', JSON.stringify(saved));
                                  }}
                                  className="w-16 px-2 py-0.5 text-[11px] font-semibold text-caution bg-caution-soft border border-caution/30 rounded-control outline-none focus:ring-1 ring-caution"
                                  placeholder="0"
                                />
                                <span className="text-[10px] text-caution font-semibold">¥</span>
                                {/* 예전에는 여기에 '마진 N%'를 띄웠는데 수수료 12%·배송비 3,000원이
                                    코드에 박힌 값이라 아래 손익 계산기와 다른 답을 냈다. 위안 가격만
                                    받아 두고 계산은 실측 비율을 쓰는 한 곳에서 한다. */}
                              </div>
                            </div>
                            <div className="flex flex-col gap-2 mt-auto">
                              <div className="flex gap-2">
                                <button onClick={() => fetchReviewAnalysis(product)}
                                  title="실제 리뷰를 수집해 불만·니즈·공략 포인트를 AI로 분석"
                                  className="flex-1 rounded-card border border-line py-2 text-[11px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
                                  리뷰 분석
                                </button>
                                <button
                                  onClick={async () => {
                                    if (!activeKeyword) return;
                                    const ok = await addRankWatch(activeKeyword, product.productId, product.productName);
                                    if (ok) setRankAdded(prev => ({ ...prev, [product.productId]: true }));
                                  }}
                                  disabled={!activeKeyword || rankAdded[product.productId]}
                                  title={`"${activeKeyword}" 검색 결과에서 이 상품의 순위를 매일 자동 기록`}
                                  className="flex-1 rounded-card border border-line py-2 text-[11px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60">
                                  {rankAdded[product.productId] ? '✓ 순위 추적 중' : '순위 추적'}
                                </button>
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => handle1688Click(product)}
                                  title="상품 이미지로 1688 소싱처 검색"
                                  className="flex-1 py-3 bg-accent-soft rounded-card text-[11px] font-semibold text-accent flex items-center justify-center gap-2 hover:bg-accent-soft transition-colors">
                                  1688 소싱처
                                </button>
                                <button onClick={() => openCalcForProduct(product)}
                                  className="flex-1 py-3 bg-ink text-paper rounded-card text-[11px] font-semibold flex items-center justify-center gap-2 hover:bg-ink-2 transition-colors">
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
                      <p className="text-sm font-semibold">필터 조건에 맞는 상품이 없습니다</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* ══════════ 상품 리뷰 분석 모달 ══════════ */}
        <AnimatePresence>
          {reviewTarget && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => { if (!reviewLoading) setReviewTarget(null); }}
                className="fixed inset-0 z-[80] bg-ink/50 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                className="fixed inset-0 m-auto z-[90] w-[92%] max-w-[620px] h-fit max-h-[88vh] bg-paper rounded-panel border border-line shadow-overlay overflow-y-auto">
                <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">Review Intelligence</p>
                    <h3 className="mt-1 truncate text-lg font-semibold text-ink">{reviewTarget.productName}</h3>
                  </div>
                  <button onClick={() => setReviewTarget(null)} className="rounded-full p-1.5 text-ink-3 transition-all hover:bg-paper-2 hover:text-ink-2">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="px-7 pb-6 pt-2">
                  {reviewLoading ? (
                    <div className="flex flex-col items-center gap-3 py-10 text-ink-3">
                      <Loader2 className="h-8 w-8 animate-spin text-accent" />
                      <p className="text-sm font-semibold">실제 리뷰를 수집해 훈프로AI가 분석하는 중... (10~30초)</p>
                    </div>
                  ) : (
                    <ReviewSummaryView data={reviewData} />
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>



      </main>
    </div>
  );
}
