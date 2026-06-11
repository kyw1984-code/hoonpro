/**
 * 소싱 파인더 컴포넌트
 * soucing 리포(src/app/page.tsx)에서 이식 — 인증/헤더/푸터 제거 후 탭 패널로 적용
 */
import React, { useState, useEffect } from 'react';
import {
  Search, TrendingUp, DollarSign, ChevronRight, Target, BarChart3,
  Loader2, LayoutDashboard, ExternalLink, Star, MessageSquare,
  Sparkles, Dumbbell, Tent, Baby, PawPrint, Sofa, Shirt, Cpu,
  Download, X, SlidersHorizontal, ArrowUpDown, Heart, ShoppingCart,
  Utensils, UtensilsCrossed, Palette, Car, Book,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ProductSkeleton } from './Skeleton';

// ─── Sparkline ────────────────────────────────────────────────────────────────
const Sparkline = ({ data }: { data: number[] }) => {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
  const safeData = React.useMemo(() => {
    if (!data || !Array.isArray(data) || data.length === 0) return Array.from({ length: 12 }, () => 0);
    return data.map(v => (typeof v === 'number' && !isNaN(v)) ? v : 0);
  }, [data]);
  const max = Math.max(...safeData, 1);
  const min = Math.min(...safeData);
  const range = max - min || 1;
  const months = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex items-stretch gap-2 h-40 relative px-1">
        {safeData.map((val, i) => {
          const isFlat = max === min;
          const heightPercent = isFlat ? 50 : 15 + ((val - min) / range) * 85;
          return (
            <div key={i} className="flex-1 flex flex-col justify-end relative group"
              onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)}>
              <div
                className={`w-full rounded-t-[8px] transition-all duration-500 relative shadow-sm ${
                  hoveredIndex === i
                    ? 'bg-gradient-to-t from-orange-600 to-amber-400 shadow-amber-200/50 scale-x-105 z-10'
                    : 'bg-gradient-to-t from-amber-400 to-amber-300 opacity-80 group-hover:opacity-100'
                }`}
                style={{ height: `${heightPercent}%` }}
              >
                {hoveredIndex === i && (
                  <div className="absolute -top-16 left-1/2 -translate-x-1/2 bg-slate-900 border border-slate-700 text-white px-3 py-2.5 rounded-2xl text-xs font-black whitespace-nowrap shadow-2xl z-[100]">
                    <div className="text-center">
                      <div className="text-[10px] text-amber-400 font-black mb-0.5 uppercase tracking-tighter">{months[i]} 검색 트렌드</div>
                      <div className="text-sm font-black tabular-nums">{val.toLocaleString()}건</div>
                    </div>
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-900 border-r border-b border-slate-700 rotate-45" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between px-1 pt-3 border-t border-slate-100">
        {months.map((m, i) => (
          <span key={i} className={`text-[9px] font-black tabular-nums transition-colors duration-300 ${hoveredIndex === i ? 'text-amber-600' : 'text-slate-400'}`}>
            {i + 1}
          </span>
        ))}
      </div>
      <div className="bg-amber-50 rounded-xl py-2 px-3 flex items-center justify-center gap-2 mt-2 border border-amber-100">
        <TrendingUp className="w-3 h-3 text-amber-500" />
        <p className="text-[10px] font-black text-amber-600 uppercase tracking-[0.1em]">월간 검색량 추이 분석 (1월 - 12월)</p>
      </div>
    </div>
  );
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface Product {
  productId: string;
  productName: string;
  productPrice: number;
  productImage: string;
  productUrl: string;
  rating?: number;
  ratingCount?: number;
  isRocket?: boolean;
  deliveryType?: 'rocket' | 'jet' | 'general' | 'rocket_fallback';
  reviewEnriched?: boolean;
  estimated1688Price?: number;
  calculated: {
    saleIndex: number;
    competitionStrength: number;
    sourcingScore: number;
    opportunityScore: number;
    grade: 'Great' | 'Excellent' | 'Good' | 'Bad';
    estimated?: boolean;
  };
}

// ─── SellerLandscape ─────────────────────────────────────────────────────────
const SellerLandscape = ({ products }: { products: Product[] }) => {
  if (!products || products.length === 0) return null;
  const total = Math.min(products.length, 20);
  const topProducts = products.slice(0, total);
  const rocketCount = topProducts.filter(p => p.deliveryType === 'rocket' || p.deliveryType === 'rocket_fallback' || (p.isRocket && !p.deliveryType)).length;
  const jetCount = topProducts.filter(p => p.deliveryType === 'jet').length;
  const rocketCombined = rocketCount + jetCount;
  const general = topProducts.filter(p => p.deliveryType === 'general' || (!p.isRocket && !p.deliveryType)).length;
  const rocketCombinedPct = (rocketCombined / total) * 100;
  const generalPct = (general / total) * 100;

  return (
    <div className="bg-slate-50 p-5 rounded-[24px] border border-slate-200 flex flex-col gap-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">판매자 경쟁 분포 (TOP {total})</p>
      <div className="flex h-3 w-full rounded-full overflow-hidden bg-slate-200">
        <div style={{ width: `${rocketCombinedPct}%` }} className="h-full bg-rose-500 transition-all duration-500" />
        <div style={{ width: `${generalPct}%` }} className="h-full bg-emerald-500 transition-all duration-500" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col">
          <span className="text-[9px] font-black text-rose-400 uppercase">로켓 / 판매자로켓</span>
          <span className="text-xl font-black text-slate-800">{Math.round(rocketCombinedPct)}%</span>
        </div>
        <div className="flex flex-col border-l border-slate-300 pl-4">
          <span className="text-[9px] font-black text-emerald-400 uppercase">일반배송</span>
          <span className="text-xl font-black text-slate-800">{Math.round(generalPct)}%</span>
        </div>
      </div>
    </div>
  );
};

// ─── CATEGORIES ───────────────────────────────────────────────────────────────
const CATEGORIES = [
  { label: '여성패션', icon: Shirt, subs: [
    { label: '상의', items: [{ label: '티셔츠', keyword: '여성 티셔츠' },{ label: '블라우스', keyword: '여성 블라우스' },{ label: '후드티', keyword: '여성 후드티' },{ label: '맨투맨', keyword: '여성 맨투맨' }] },
    { label: '하의', items: [{ label: '바지', keyword: '여성 바지' },{ label: '청바지', keyword: '여성 청바지' },{ label: '스커트', keyword: '여성 스커트' },{ label: '레깅스', keyword: '여성 레깅스' }] },
    { label: '아우터/원피스', items: [{ label: '원피스', keyword: '여성 원피스' },{ label: '자켓', keyword: '여성 자켓' },{ label: '코트', keyword: '여성 코트' },{ label: '패딩', keyword: '여성 패딩' }] },
  ]},
  { label: '남성패션', icon: Shirt, subs: [
    { label: '상의', items: [{ label: '티셔츠', keyword: '남성 티셔츠' },{ label: '셔츠', keyword: '남성 셔츠' },{ label: '후드티', keyword: '남성 후드티' },{ label: '맨투맨', keyword: '남성 맨투맨' }] },
    { label: '하의', items: [{ label: '바지', keyword: '남성 바지' },{ label: '청바지', keyword: '남성 청바지' },{ label: '반바지', keyword: '남성 반바지' }] },
    { label: '아우터', items: [{ label: '자켓', keyword: '남성 자켓' },{ label: '코트', keyword: '남성 코트' },{ label: '패딩', keyword: '남성 패딩' }] },
  ]},
  { label: '뷰티', icon: Heart, subs: [
    { label: '기초케어', items: [{ label: '스킨', keyword: '스킨' },{ label: '에센스', keyword: '에센스' },{ label: '크림', keyword: '수분크림' },{ label: '마스크팩', keyword: '마스크팩' }] },
    { label: '메이크업', items: [{ label: '쿠션', keyword: '쿠션 팩트' },{ label: '립스틱', keyword: '립스틱' },{ label: '틴트', keyword: '틴트' }] },
  ]},
  { label: '주방', icon: UtensilsCrossed, subs: [
    { label: '조리도구', items: [{ label: '냄비', keyword: '인덕션 냄비' },{ label: '프라이팬', keyword: '코팅 프라이팬' },{ label: '실리콘 조리도구', keyword: '실리콘 조리도구' }] },
    { label: '식기', items: [{ label: '그릇', keyword: '식기 그릇 세트' },{ label: '텀블러', keyword: '텀블러' }] },
  ]},
  { label: '생활용품', icon: UtensilsCrossed, subs: [
    { label: '욕실용품', items: [{ label: '샤워기', keyword: '필터 샤워기' },{ label: '욕실매트', keyword: '규조토 매트' }] },
    { label: '청소/세탁', items: [{ label: '세제', keyword: '세탁 세제' },{ label: '청소도구', keyword: '청소도구 세트' },{ label: '옷걸이', keyword: '논슬립 옷걸이' }] },
  ]},
  { label: '가전', icon: Cpu, subs: [
    { label: '생활가전', items: [{ label: '가습기', keyword: '복합식 가습기' },{ label: '공기청정기', keyword: '공기청정기' },{ label: '선풍기', keyword: '선풍기' }] },
    { label: '주방가전', items: [{ label: '에어프라이어', keyword: '에어프라이어' },{ label: '커피머신', keyword: '커피 머신' }] },
  ]},
  { label: '디지털', icon: Cpu, subs: [
    { label: '컴퓨터 주변기기', items: [{ label: '마우스', keyword: '무선 마우스' },{ label: '키보드', keyword: '기계식 키보드' },{ label: '보조배터리', keyword: '보조배터리' }] },
    { label: '모바일', items: [{ label: '휴대폰케이스', keyword: '아이폰 갤럭시 케이스' },{ label: '거치대', keyword: '휴대폰 거치대' }] },
  ]},
  { label: '가구/침구', icon: Sofa, subs: [
    { label: '침구', items: [{ label: '베개', keyword: '경추 베개' },{ label: '이불', keyword: '기능성 이불' },{ label: '커튼', keyword: '암막 커튼' }] },
    { label: '수납/가구', items: [{ label: '의자', keyword: '컴퓨터 의자' },{ label: '선반', keyword: '수납 선반' },{ label: '조명', keyword: '무드등' }] },
  ]},
  { label: '스포츠/캠핑', icon: Tent, subs: [
    { label: '홈트레이닝', items: [{ label: '요가매트', keyword: '요가매트' },{ label: '아령', keyword: '덤벨 아령' },{ label: '레깅스', keyword: '레깅스' }] },
    { label: '캠핑', items: [{ label: '텐트', keyword: '캠핑 텐트' },{ label: '캠핑의자', keyword: '캠핑 의자' },{ label: '랜턴', keyword: '캠핑 랜턴' }] },
  ]},
  { label: '반려동물', icon: PawPrint, subs: [
    { label: '펫 용품', items: [{ label: '강아지 사료', keyword: '강아지 사료' },{ label: '강아지 간식', keyword: '강아지 간식' },{ label: '배변패드', keyword: '배변패드' },{ label: '고양이모래', keyword: '고양이모래' }] },
  ]},
  { label: '자동차', icon: Car, subs: [
    { label: '관리용품', items: [{ label: '방향제', keyword: '차량용 방향제' },{ label: '거치대', keyword: '차량용 거치대' },{ label: '충전기', keyword: '차량용 무선 충전기' }] },
  ]},
];

// ─── Main Component ────────────────────────────────────────────────────────────
export function SourcingFinder() {
  const [keyword, setKeyword] = useState('');
  const [minPrice, setMinPrice] = useState('15000');
  const [maxPrice, setMaxPrice] = useState('1000000');
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [keywordStats, setKeywordStats] = useState<any | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'saleIndex' | 'ratingCount' | 'sourcingScore' | 'competitionStrength' | 'productPrice'>('saleIndex');
  const [gradeFilter, setGradeFilter] = useState<'all' | 'Great' | 'Excellent' | 'Good' | 'Bad'>('all');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [wholesalePrice, setWholesalePrice] = useState<number>(0);
  const [shippingFee] = useState(3000);
  const [sourcingMultiplier, setSourcingMultiplier] = useState<number>(300);
  const [purchasePopupProduct, setPurchasePopupProduct] = useState<Product | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('sourcingMultiplier');
    if (saved) setSourcingMultiplier(Number(saved));
  }, []);

  useEffect(() => {
    if (!expandedCategory) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedCategory(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expandedCategory]);

  const handleMultiplierChange = (val: number) => {
    setSourcingMultiplier(val);
    localStorage.setItem('sourcingMultiplier', String(val));
  };

  const calculateProfitData = (salePrice: number, cost: number, shipping: number) => {
    const fee = Math.round(salePrice * 0.12);
    const profit = salePrice - cost - shipping - fee;
    const margin = salePrice > 0 ? (profit / salePrice) * 100 : 0;
    return { fee, profit, margin };
  };

  const { fee, profit, margin } = selectedProduct
    ? calculateProfitData(selectedProduct.productPrice, wholesalePrice, shippingFee)
    : { fee: 0, profit: 0, margin: 0 };

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

  const handleSearchWithKeyword = async (kw: string) => {
    setLoading(true);
    setSearchError(null);
    try {
      const query = new URLSearchParams({ type: 'products', keyword: kw, minPrice, maxPrice });
      const response = await fetch(`/api/sourcing?${query.toString()}`);
      const data = await response.json();

      if (!response.ok || data.error) {
        setSearchError(data.error || '검색 실패');
        setProducts([]); setKeywordStats(null);
        return;
      }

      const savedPrices = JSON.parse(localStorage.getItem('1688prices') || '{}');
      const enrichedData = data.map((product: Product) => ({
        ...product,
        estimated1688Price: savedPrices[product.productId] || undefined,
      }));
      setProducts(enrichedData);

      const total = Math.min(data.length, 20);
      const topProducts = data.slice(0, total);
      const rocket = topProducts.filter((p: Product) => p.deliveryType === 'rocket' || (p.isRocket && !p.deliveryType)).length;
      const jet = topProducts.filter((p: Product) => p.deliveryType === 'jet').length;
      const general = topProducts.filter((p: Product) => p.deliveryType === 'general' || (!p.isRocket && !p.deliveryType)).length;
      const sellerDist = JSON.stringify({ rocketPct: (rocket / total) * 100, jetPct: (jet / total) * 100, generalPct: (general / total) * 100 });

      const statsRes = await fetch(`/api/sourcing?type=stats&keyword=${encodeURIComponent(kw)}&sellerDistribution=${encodeURIComponent(sellerDist)}`);
      const statsData = await statsRes.json();
      setKeywordStats(statsData);
    } catch (error: any) {
      setSearchError(error.message);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!keyword.trim()) return;
    setActiveCategory(null);
    await handleSearchWithKeyword(keyword.trim());
  };

  const handleCategorySearch = (subLabel: string, kw: string) => {
    setActiveCategory(subLabel);
    setKeyword(kw);
    handleSearchWithKeyword(kw);
  };

  const getGradeStyle = (grade: 'Great' | 'Excellent' | 'Good' | 'Bad') => {
    if (grade === 'Great') return 'text-emerald-400 bg-emerald-50 ring-emerald-500/20';
    if (grade === 'Excellent') return 'text-indigo-400 bg-indigo-50 ring-indigo-500/20';
    if (grade === 'Good') return 'text-amber-400 bg-amber-50 ring-amber-500/20';
    return 'text-rose-400 bg-rose-50 ring-rose-500/20';
  };

  const displayProducts = [...products]
    .filter(p => gradeFilter === 'all' || p.calculated.grade === gradeFilter)
    .sort((a, b) => {
      let primary = 0;
      if (sortBy === 'productPrice') primary = a.productPrice - b.productPrice;
      else if (sortBy === 'competitionStrength') primary = a.calculated.competitionStrength - b.calculated.competitionStrength;
      else if (sortBy === 'ratingCount') primary = (b.ratingCount || 0) - (a.ratingCount || 0);
      else primary = (b.calculated as any)[sortBy] - (a.calculated as any)[sortBy];
      if (primary !== 0) return primary;
      return (b.ratingCount || 0) - (a.ratingCount || 0);
    });

  const handleExportCSV = () => {
    const headers = ['상품명', '가격', '소싱지수', '등급', '쿠팡링크'];
    const rows = displayProducts.map(p => [
      `"${p.productName.replace(/"/g, '""')}"`, p.productPrice, p.calculated.sourcingScore, p.calculated.grade, p.productUrl,
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `소싱분석_${keyword}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="max-w-[1600px] mx-auto px-6 py-8 flex flex-col gap-8 bg-white">

        {/* 카테고리 + 검색바 */}
        <div className="sticky top-[64px] z-30 flex flex-col gap-4 bg-white/80 backdrop-blur-md pb-4 pt-2">
          {/* 카테고리 */}
          <div className="bg-white rounded-[32px] p-5 border border-slate-200 shadow-sm flex items-start gap-6">
            <div className="flex items-center gap-2 px-3 border-r border-slate-200 pr-6 shrink-0 mt-2.5">
              <Sparkles className="w-4 h-4 text-emerald-500" />
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">카테고리</span>
            </div>
            <div className="flex-1 py-1">
              <div className="flex gap-2.5 flex-wrap items-center">
                {CATEGORIES.map(cat => (
                  <div key={cat.label} className="relative">
                    <button
                      onClick={() => setExpandedCategory(expandedCategory === cat.label ? null : cat.label)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm ${
                        expandedCategory === cat.label ? 'bg-indigo-600 text-white shadow-indigo-200' : 'bg-slate-50 hover:bg-indigo-50/80 text-slate-600 border border-slate-100'
                      }`}
                    >
                      <cat.icon className="w-3.5 h-3.5" />
                      <span>{cat.label}</span>
                    </button>
                    <AnimatePresence>
                      {expandedCategory === cat.label && (
                        <>
                          <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setExpandedCategory(null); }}
                            className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm cursor-pointer"
                          />
                          <motion.div
                            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="fixed inset-0 m-auto z-[70] w-[95%] max-w-[1200px] h-fit max-h-[85vh] bg-white rounded-[48px] p-12 shadow-[0_32px_128px_-16px_rgba(0,0,0,0.3)] border border-slate-200 overflow-y-auto"
                          >
                            <div className="flex items-center justify-between mb-10 pb-8 border-b border-slate-100">
                              <div className="flex items-center gap-4">
                                <div className="p-4 bg-indigo-600 rounded-2xl shadow-xl shadow-indigo-100">
                                  <cat.icon className="w-8 h-8 text-white" />
                                </div>
                                <div>
                                  <h3 className="text-2xl font-black text-slate-800">{cat.label} <span className="text-indigo-600">마켓 분류</span></h3>
                                  <p className="text-xs text-slate-400 font-bold uppercase tracking-[0.2em] mt-1">High-Potential Sourcing Sectors</p>
                                </div>
                              </div>
                              <button onClick={() => setExpandedCategory(null)} className="p-4 hover:bg-slate-100 rounded-full transition-all">
                                <X className="w-8 h-8 text-slate-300 hover:text-slate-600" />
                              </button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-16 gap-y-12">
                              {cat.subs.map(sub => (
                                <div key={sub.label} className="space-y-6">
                                  <div className="flex items-center gap-2 pb-3 border-b-2 border-indigo-500/10">
                                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">{sub.label}</h4>
                                  </div>
                                  <div className="grid grid-cols-1 gap-1">
                                    {sub.items.map(item => (
                                      <button
                                        key={item.label}
                                        onClick={() => { handleCategorySearch(item.label, item.keyword); setExpandedCategory(null); }}
                                        className={`group flex items-center justify-between py-3 px-4 rounded-xl text-[13px] font-bold transition-all ${
                                          activeCategory === item.label ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
                                        }`}
                                      >
                                        <span>{item.label}</span>
                                        <ChevronRight className={`w-4 h-4 transition-all ${activeCategory === item.label ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100'}`} />
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 검색바 */}
          <div className="bg-white rounded-[32px] p-4 border-2 border-indigo-100 shadow-xl flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="공략할 상품 키워드를 입력하세요..."
                className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-300 rounded-2xl outline-none text-sm font-bold shadow-inner focus:ring-2 ring-indigo-500/20 transition-all text-slate-900"
              />
            </div>
            <button
              onClick={() => handleSearch()}
              disabled={loading}
              className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl flex items-center gap-2 transition-all shadow-lg active:scale-95"
            >
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Search className="w-5 h-5" />}
              소싱 제품 찾기
            </button>
            {!loading && products.length > 0 && (
              <button onClick={handleExportCSV} className="p-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl transition-all shadow-lg active:scale-95" title="엑셀로 저장">
                <Download className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* 에러 */}
        {searchError && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-700 text-sm font-bold">
            {searchError}
          </div>
        )}

        {/* 키워드 통계 */}
        <AnimatePresence>
          {!loading && keywordStats && products.length > 0 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-xl overflow-hidden">
              <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-indigo-50 rounded-2xl">
                  <TrendingUp className="w-6 h-6 text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-800">
                    {keywordStats.keyword} <span className="text-slate-500 font-bold ml-2">시장성 분석</span>
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Market Insight Analytics</p>
                    <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 text-[9px] font-black rounded-md border border-indigo-500/20">{keywordStats.marketTrend}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-8">
                {keywordStats.trendData && (
                  <div className="bg-slate-50 p-6 rounded-[24px] border border-slate-200">
                    <p className="text-[10px] font-black uppercase tracking-widest mb-4 text-amber-400">월간 검색량 추이</p>
                    <Sparkline data={keywordStats.trendData} />
                  </div>
                )}
                <div className="grid grid-cols-4 gap-6">
                  <div className="bg-slate-50 p-5 rounded-[24px] border border-slate-200">
                    <p className="text-[10px] font-black uppercase tracking-widest mb-2 text-slate-500">총 등록 상품</p>
                    <p className="text-2xl font-black text-blue-400">{keywordStats.totalProducts.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-500 font-bold mt-1">▸ 수집된 실시간 데이터</p>
                  </div>
                  <div className="bg-slate-50 p-5 rounded-[24px] border border-slate-200">
                    <p className="text-[10px] font-black uppercase tracking-widest mb-2 text-slate-500">경쟁 강도</p>
                    <p className={`text-2xl font-black ${keywordStats.competitionRate < 5.0 ? 'text-emerald-400' : keywordStats.competitionRate < 15.0 ? 'text-indigo-400' : 'text-rose-400'}`}>
                      {keywordStats.competitionRate}
                    </p>
                    <p className="text-[10px] text-slate-500 font-bold mt-1">
                      ▸ {keywordStats.competitionRate < 5.0 ? '블루오션 (강력추천)' : keywordStats.competitionRate < 15.0 ? '양호한 시장 (추천)' : '레드오션 (진입주의)'}
                    </p>
                  </div>
                  <div className="bg-slate-50 p-5 rounded-[24px] border border-slate-200">
                    <p className="text-[10px] font-black uppercase tracking-widest mb-2 text-slate-500">평균 객단가</p>
                    <p className="text-2xl font-black text-amber-400">{keywordStats.averagePrice.toLocaleString()}원</p>
                    <p className="text-[10px] text-slate-500 font-bold mt-1">▸ {keywordStats.minPrice.toLocaleString()} ~ {keywordStats.maxPrice.toLocaleString()} (범위)</p>
                  </div>
                  <div className="bg-slate-50 p-5 rounded-[24px] border border-slate-200">
                    <SellerLandscape products={products} />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 필터/정렬 */}
        {!loading && products.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 bg-white rounded-xl p-1 border border-slate-200 shadow-sm">
              {(['all', 'Great', 'Excellent', 'Good', 'Bad'] as const).map(g => (
                <button key={g} onClick={() => setGradeFilter(g)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${gradeFilter === g ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
                  {g}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-1.5 border border-slate-200 shadow-sm">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
                className="text-xs font-bold text-slate-700 bg-transparent outline-none cursor-pointer">
                <option value="saleIndex">판매지수순 (리뷰·인기)</option>
                <option value="ratingCount">리뷰수 많은순</option>
                <option value="sourcingScore">소싱점수순</option>
                <option value="competitionStrength">경쟁 낮은순</option>
                <option value="productPrice">가격 낮은순</option>
              </select>
            </div>
          </div>
        )}

        {/* 상품 목록 */}
        <div className="flex-1 overflow-y-auto pb-10">
          {loading ? (
            <div className="grid grid-cols-4 gap-6">
              {Array.from({ length: 9 }).map((_, i) => <ProductSkeleton key={i} />)}
            </div>
          ) : products.length > 0 ? (
            <div className="grid grid-cols-4 gap-6">
              <AnimatePresence>
                {displayProducts.map((product, index) => (
                  <motion.div key={product.productId} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="group bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                    <a href={product.productUrl} target="_blank" rel="noopener noreferrer"
                      className="relative aspect-square overflow-hidden bg-slate-100 cursor-pointer block">
                      <img src={product.productImage} alt={product.productName}
                        className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                      <div className="absolute top-3 right-3 flex flex-col gap-2 items-end">
                        <div className={`px-3 py-1 rounded-full text-[10px] font-bold ring-1 ${getGradeStyle(product.calculated.grade)}`}>
                          {product.calculated.grade}
                        </div>
                        {product.deliveryType === 'rocket' && <div className="px-2 py-0.5 bg-rose-500 text-white text-[8px] font-black rounded uppercase shadow-sm">로켓</div>}
                        {product.deliveryType === 'rocket_fallback' && <div className="px-2 py-0.5 bg-indigo-500 text-white text-[8px] font-black rounded uppercase shadow-sm">로켓/판매자</div>}
                        {product.deliveryType === 'jet' && <div className="px-2 py-0.5 bg-amber-500 text-white text-[8px] font-black rounded uppercase shadow-sm">판매자로켓</div>}
                        {(product.deliveryType === 'general' || !product.deliveryType) && <div className="px-2 py-0.5 bg-slate-400 text-white text-[8px] font-black rounded uppercase shadow-sm">일반배송</div>}
                      </div>
                    </a>
                    <div className="p-5 flex-1 flex flex-col">
                      <h3 className="font-bold text-[14px] text-slate-900 line-clamp-2 mb-2 h-10 leading-snug">{product.productName}</h3>
                      <div className="flex items-center gap-2 mb-3">
                        {product.reviewEnriched ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-black ring-1 ring-emerald-500/20">
                            <Star className="w-3 h-3 fill-emerald-500 text-emerald-500" />
                            {(product.rating || 0).toFixed(1)} · 리뷰 {(product.ratingCount || 0).toLocaleString()}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-50 text-slate-400 text-[10px] font-bold ring-1 ring-slate-200">
                            <MessageSquare className="w-3 h-3" />리뷰 미확인
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 font-bold">판매지수 {product.calculated.saleIndex}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mb-3">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ring-1 ${getGradeStyle(product.calculated.grade)}`}
                          title="시장수요·소싱적합성·진입용이성을 종합한 소싱 기회 지수 (0~100)">
                          기회지수 {product.calculated.opportunityScore}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ring-1 ${
                          product.calculated.competitionStrength < 25 ? 'bg-emerald-50 text-emerald-700 ring-emerald-500/20' :
                          product.calculated.competitionStrength < 45 ? 'bg-amber-50 text-amber-700 ring-amber-500/20' : 'bg-rose-50 text-rose-700 ring-rose-500/20'
                        }`}>
                          경쟁 {product.calculated.competitionStrength < 25 ? '낮음' : product.calculated.competitionStrength < 45 ? '보통' : '높음'}
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
                            구매하기
                          </button>
                          <button onClick={() => {
                              setSelectedProduct(product);
                              setIsDrawerOpen(true);
                              setWholesalePrice(Math.round((product.estimated1688Price || 0) * sourcingMultiplier));
                            }}
                            className="flex-1 py-3 bg-slate-900 text-white rounded-xl text-[11px] font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors">
                            <LayoutDashboard className="w-3 h-3" />소싱 분석
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center py-20 text-slate-400">
              <Search className="w-16 h-16 mb-6 opacity-20" />
              <h2 className="text-xl font-bold">분석을 시작해보세요</h2>
            </div>
          )}
        </div>

        {/* 소싱 분석 드로어 */}
        <AnimatePresence>
          {isDrawerOpen && selectedProduct && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setIsDrawerOpen(false)}
                className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm cursor-pointer" />
              <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                className="fixed top-0 right-0 h-full w-[450px] bg-white z-[60] shadow-2xl flex flex-col">
                <div className="p-8 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-slate-800">소싱 수익성 분석</h2>
                  <button onClick={() => setIsDrawerOpen(false)}>
                    <ChevronRight className="w-6 h-6 text-slate-600" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-8 space-y-10">
                  <div className="flex gap-6 items-start border-t border-slate-200 pt-10">
                    <img src={selectedProduct.productImage} className="w-20 h-20 rounded-2xl object-cover border shadow-sm" alt="" />
                    <div>
                      <h3 className="font-bold text-base line-clamp-2 mb-2 leading-tight text-slate-800">{selectedProduct.productName}</h3>
                      <p className="text-sm font-bold text-slate-600">현재 쿠팡가: {selectedProduct.productPrice.toLocaleString()}원</p>
                    </div>
                  </div>
                  <div className="space-y-4 pt-6 border-t border-dashed border-slate-200">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-black text-slate-500 uppercase tracking-widest">소싱 지표</h4>
                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold ring-1 ${getGradeStyle(selectedProduct.calculated.grade)}`}>
                        {selectedProduct.calculated.grade}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: '기회지수', value: selectedProduct.calculated.opportunityScore, desc: '수요·적합성·진입용이성 종합' },
                        { label: '판매지수', value: selectedProduct.calculated.saleIndex, desc: '네이버 인기순위·리뷰 기반 수요' },
                        { label: '경쟁강도', value: selectedProduct.calculated.competitionStrength, desc: '낮을수록 진입 쉬움' },
                        { label: '소싱적합', value: selectedProduct.calculated.sourcingScore, desc: '가격대·배송유형 적합도' },
                      ].map(m => (
                        <div key={m.label} className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="text-[10px] font-bold text-slate-500">{m.label}</span>
                            <span className="text-lg font-black text-slate-800">{m.value}</span>
                          </div>
                          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mb-1.5">
                            <div className={`h-full rounded-full ${m.label === '경쟁강도' ? 'bg-rose-400' : 'bg-indigo-500'}`}
                              style={{ width: `${Math.min(100, m.value)}%` }} />
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
                        <label className="text-[10px] font-bold text-slate-500 mb-2 block uppercase text-center">판매 매입가 (위안)</label>
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
                <div className="p-8 bg-slate-50 border-t border-slate-200">
                  <button onClick={() => setIsDrawerOpen(false)} className="w-full py-5 bg-slate-900 text-white font-black rounded-2xl">분석 완료</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* 구매하기 이벤트 팝업 */}
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
