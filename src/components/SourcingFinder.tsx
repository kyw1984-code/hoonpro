/**
 * 소싱 파인더 v3 — 네이버 검색광고 API 단독 구성
 *
 * 네이버 쇼핑검색 API 종료 + 쿠팡(파트너스 API/크롤링) 이용 불가에 따라
 * 니치 키워드 발굴 도구로 재편:
 *  1) 키워드 발굴 — 실제 월간검색량 + 광고경쟁도로 "검색량은 많은데
 *     경쟁은 적은" 키워드를 점수화 (판매자 적고 잘 팔리는 시장의 대리 지표)
 *  2) 심층 확장 — 발굴된 키워드를 다시 시드로 재확장해 2차·3차 니치 채굴
 *  3) 쿠팡/네이버쇼핑 원클릭 링크 — 로켓 비중·상품 경쟁은 사용자 브라우저에서
 *     직접 확인 (서버 크롤링은 차단되지만 개인 브라우저 접속은 자유)
 *  4) 관심 키워드 저장 + 마진 계산기
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  Search, DollarSign, ChevronRight, Loader2, ExternalLink, Sparkles,
  Download, X, ArrowUpDown, KeyRound, RefreshCw, Star, Calculator,
  TrendingUp, Home,
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

const coupangSearchUrl = (kw: string) => `https://www.coupang.com/np/search?q=${encodeURIComponent(kw)}`;
const naverShopUrl = (kw: string) => `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(kw)}`;

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
  const [seedTrail, setSeedTrail] = useState<string[]>([]); // 심층 확장 경로

  // 필터/정렬
  const [sortKey, setSortKey] = useState<'opportunityScore' | 'monthlyVolume' | 'monthlyClicks' | 'competition'>('opportunityScore');
  const [compFilter, setCompFilter] = useState<'all' | '낮음' | '중간' | '높음'>('all');
  const [minVolume, setMinVolume] = useState('100');

  // 관심 키워드
  const [favorites, setFavorites] = useState<Record<string, KeywordStat>>(loadFavorites);
  const [showFavorites, setShowFavorites] = useState(false);

  // 마진 계산기
  const [isCalcOpen, setIsCalcOpen] = useState(false);
  const [salePrice, setSalePrice] = useState('29900');
  const [yuanPrice, setYuanPrice] = useState('');
  const [shippingFee, setShippingFee] = useState('3000');
  const [sourcingMultiplier, setSourcingMultiplier] = useState<number>(300);

  // 쇼크트리 이벤트 팝업
  const [showPurchasePopup, setShowPurchasePopup] = useState(false);

  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('sourcingMultiplier');
    if (saved) setSourcingMultiplier(Number(saved));
  }, []);

  const handleMultiplierChange = (val: number) => {
    setSourcingMultiplier(val);
    localStorage.setItem('sourcingMultiplier', String(val));
  };

  // ─── API 호출 ───────────────────────────────────────────────────────────────
  const fetchKeywords = async (kw: string, mode: 'new' | 'drill' | 'trail' = 'new') => {
    const trimmed = kw.trim();
    if (!trimmed) return;
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
      setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── 관심 키워드 ────────────────────────────────────────────────────────────
  const toggleFavorite = (k: KeywordStat) => {
    setFavorites(prev => {
      const next = { ...prev };
      if (next[k.keyword]) delete next[k.keyword];
      else next[k.keyword] = k;
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
      return next;
    });
  };

  // ─── 마진 계산 ──────────────────────────────────────────────────────────────
  const sale = Number(salePrice) || 0;
  const cost = Math.round((Number(yuanPrice) || 0) * sourcingMultiplier);
  const shipping = Number(shippingFee) || 0;
  const fee = Math.round(sale * 0.12);
  const profit = sale - cost - shipping - fee;
  const margin = sale > 0 ? (profit / sale) * 100 : 0;

  // ─── 1688 소싱 (중달이) ─────────────────────────────────────────────────────
  const open1688 = () => {
    window.open('https://jungdari.com', '_blank', 'noopener');
  };

  const handle1688Click = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(PURCHASE_POPUP_HIDE_KEY) === today) open1688();
    else setShowPurchasePopup(true);
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

  // ─── CSV 내보내기 ───────────────────────────────────────────────────────────
  const exportCSV = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const headers = ['키워드', '월간검색량', 'PC검색량', '모바일검색량', '월평균클릭', '광고경쟁도', '기회점수', '등급', '쿠팡링크'];
    const rows = displayKeywords.map(k => [
      k.keyword, k.monthlyVolume, k.monthlyPcVolume, k.monthlyMobileVolume,
      k.monthlyClicks, k.compIdx, k.opportunityScore, k.grade, coupangSearchUrl(k.keyword),
    ]);
    const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = showFavorites ? '관심키워드.csv' : `키워드발굴_${currentSeed || 'result'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const favCount = Object.keys(favorites).length;

  // ─── 렌더 ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6 bg-white">

        {/* 헤더 라인 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 rounded-xl">
            <KeyRound className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-black text-indigo-700">니치 키워드 발굴</span>
          </div>
          <p className="text-[11px] text-slate-400 font-bold hidden md:block">
            네이버 검색광고 API 실데이터 — 검색량은 많고 경쟁은 적은 키워드를 찾습니다
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={() => { setShowFavorites(v => !v); setError(null); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all ${
                showFavorites ? 'bg-amber-500 text-white shadow-lg shadow-amber-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}>
              <Star className={`w-3.5 h-3.5 ${showFavorites ? 'fill-white' : ''}`} />관심 키워드 {favCount > 0 && `(${favCount})`}
            </button>
            <button onClick={() => setIsCalcOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-700 text-white rounded-xl text-xs font-black transition-all">
              <Calculator className="w-3.5 h-3.5" />마진 계산기
            </button>
          </div>
        </div>

        {/* 검색바 */}
        <div className="bg-white rounded-[28px] p-4 border-2 border-indigo-100 shadow-xl flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={seedInput}
              onChange={e => setSeedInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchKeywords(seedInput)}
              placeholder="시드 키워드 입력 (예: 캠핑의자) — 연관 니치 키워드를 발굴합니다"
              className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-300 rounded-2xl outline-none text-sm font-bold shadow-inner focus:ring-2 ring-indigo-500/20 transition-all text-slate-900"
            />
          </div>
          <button
            onClick={() => fetchKeywords(seedInput)}
            disabled={loading}
            className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95"
          >
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
            키워드 발굴
          </button>
          {displayKeywords.length > 0 && (
            <button onClick={exportCSV} className="p-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl transition-all shadow-lg active:scale-95" title="CSV로 저장">
              <Download className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* 심층 확장 경로 (브레드크럼) */}
        {!showFavorites && seedTrail.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs font-bold text-slate-500">
            <Home className="w-3.5 h-3.5 text-slate-400" />
            {seedTrail.map((s, i) => (
              <React.Fragment key={s}>
                {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300" />}
                <button onClick={() => fetchKeywords(s, 'trail')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    s === currentSeed ? 'bg-indigo-600 text-white' : 'bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600'
                  }`}>
                  {s}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-700 text-sm font-bold whitespace-pre-wrap">{error}</div>
        )}

        {/* 시드 키워드 요약 */}
        {seedStat && !loading && !showFavorites && (
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
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">기회점수</p>
                <button onClick={() => toggleFavorite(seedStat)} title="관심 키워드">
                  <Star className={`w-4 h-4 transition-all ${favorites[seedStat.keyword] ? 'fill-amber-400 text-amber-400' : 'text-slate-300 hover:text-amber-400'}`} />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-2xl font-black text-slate-800">{seedStat.opportunityScore}</p>
                <span className={`px-3 py-1 rounded-full text-xs font-black ring-1 ${gradeStyle(seedStat.grade)}`}>{seedStat.grade}</span>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <a href={coupangSearchUrl(seedStat.keyword)} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] font-black text-rose-500 hover:text-rose-700 flex items-center gap-1">
                  쿠팡 확인 <ExternalLink className="w-3 h-3" />
                </a>
                <a href={naverShopUrl(seedStat.keyword)} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] font-black text-emerald-600 hover:text-emerald-800 flex items-center gap-1">
                  네이버쇼핑 <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* 키워드 테이블 */}
        <div ref={tableRef}>
          {loading ? (
            <div className="bg-white rounded-[24px] border border-slate-200 p-12 flex flex-col items-center gap-4 text-slate-400">
              <Loader2 className="w-10 h-10 animate-spin text-indigo-400" />
              <p className="text-sm font-bold">네이버 검색광고 API에서 연관 키워드를 수집하는 중...</p>
            </div>
          ) : displayKeywords.length > 0 || (showFavorites && favCount === 0) ? (
            <div className="bg-white rounded-[24px] border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center gap-3 flex-wrap">
                <h3 className="text-sm font-black text-slate-800">
                  {showFavorites
                    ? <>관심 키워드 <span className="text-amber-500">{displayKeywords.length}개</span></>
                    : <>연관 니치 키워드 <span className="text-indigo-600">{displayKeywords.length}개</span></>}
                </h3>
                {!showFavorites && cached && (
                  <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1"><RefreshCw className="w-3 h-3" />캐시 데이터</span>
                )}
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
                    <select value={sortKey} onChange={e => setSortKey(e.target.value as any)}
                      className="text-xs font-bold text-slate-700 bg-transparent outline-none cursor-pointer">
                      <option value="opportunityScore">기회점수순</option>
                      <option value="monthlyVolume">검색량순</option>
                      <option value="monthlyClicks">클릭수순</option>
                      <option value="competition">경쟁 낮은순</option>
                    </select>
                  </div>
                </div>
              </div>
              {displayKeywords.length === 0 ? (
                <div className="p-12 flex flex-col items-center gap-3 text-slate-400">
                  <Star className="w-10 h-10 opacity-20" />
                  <p className="text-sm font-bold">저장된 관심 키워드가 없습니다. 테이블에서 ★을 눌러 저장하세요.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
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
                        <tr key={k.keyword} className="border-b border-slate-50 hover:bg-indigo-50/40 transition-colors">
                          <td className="px-3 py-3 text-center">
                            <button onClick={() => toggleFavorite(k)} title="관심 키워드">
                              <Star className={`w-4 h-4 transition-all ${favorites[k.keyword] ? 'fill-amber-400 text-amber-400' : 'text-slate-300 hover:text-amber-400'}`} />
                            </button>
                          </td>
                          <td className="px-3 py-3 font-bold text-slate-800">{k.keyword}</td>
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
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                              <button onClick={() => fetchKeywords(k.keyword, 'drill')}
                                title="이 키워드를 시드로 다시 확장"
                                className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-[11px] font-black transition-all flex items-center gap-1">
                                <TrendingUp className="w-3 h-3" />확장
                              </button>
                              <a href={coupangSearchUrl(k.keyword)} target="_blank" rel="noopener noreferrer"
                                title="쿠팡에서 로켓 비중·경쟁 상품 직접 확인"
                                className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-lg text-[11px] font-black transition-all">
                                쿠팡
                              </a>
                              <a href={naverShopUrl(k.keyword)} target="_blank" rel="noopener noreferrer"
                                title="네이버쇼핑에서 상품수·가격대 직접 확인"
                                className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded-lg text-[11px] font-black transition-all">
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
          ) : !seedStat && !error && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <KeyRound className="w-16 h-16 mb-6 opacity-20" />
              <h2 className="text-xl font-bold">시드 키워드로 니치 시장을 발굴하세요</h2>
              <p className="text-sm mt-2 font-medium text-center leading-relaxed">
                검색량은 많고 경쟁은 적은 키워드를 찾고, [확장]으로 더 깊은 니치까지 파고든 뒤<br />
                쿠팡 버튼으로 로켓 비중(진입 난이도)을 직접 확인하세요
              </p>
            </div>
          )}
        </div>

        {/* ══════════ 마진 계산기 드로어 ══════════ */}
        <AnimatePresence>
          {isCalcOpen && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setIsCalcOpen(false)}
                className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm cursor-pointer" />
              <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                className="fixed top-0 right-0 h-full w-full sm:w-[420px] bg-white z-[60] shadow-2xl flex flex-col">
                <div className="p-6 sm:p-8 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Calculator className="w-5 h-5 text-indigo-500" />소싱 마진 계산기
                  </h2>
                  <button onClick={() => setIsCalcOpen(false)}>
                    <ChevronRight className="w-6 h-6 text-slate-600" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 mb-2 block uppercase text-center">판매가 (원)</label>
                      <input type="number" value={salePrice} onChange={e => setSalePrice(e.target.value)}
                        className="text-center w-full px-4 py-4 bg-indigo-50 border border-indigo-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 ring-indigo-400" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 mb-2 block uppercase text-center">1688 매입가 (위안)</label>
                      <input type="number" value={yuanPrice} onChange={e => setYuanPrice(e.target.value)} placeholder="예: 25.5"
                        className="text-center w-full px-4 py-4 bg-amber-50 border border-amber-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 ring-amber-400" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 mb-2 block uppercase text-center">소싱 배수(환율/관세)</label>
                      <input type="number" value={sourcingMultiplier} onChange={e => handleMultiplierChange(Number(e.target.value))}
                        className="text-center w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 mb-2 block uppercase text-center">국내 배송비 (원)</label>
                      <input type="number" value={shippingFee} onChange={e => setShippingFee(e.target.value)}
                        className="text-center w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="bg-slate-50 rounded-2xl p-4 flex items-center justify-between border border-slate-200">
                      <span className="text-xs font-bold text-slate-500">예상 원가 (위안 × 배수)</span>
                      <span className="text-sm font-black text-indigo-600">{cost.toLocaleString()}원</span>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 flex items-center justify-between border border-slate-200">
                      <span className="text-xs font-bold text-slate-500">판매 수수료 (12%)</span>
                      <span className="text-sm font-black text-slate-600">{fee.toLocaleString()}원</span>
                    </div>
                  </div>
                  <div className={`p-8 rounded-[32px] border-2 ${margin > 20 ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex justify-between items-center mb-6">
                      <span className="text-sm font-bold text-slate-500">예상 마진율</span>
                      <span className={`text-3xl font-black ${margin > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{margin.toFixed(1)}%</span>
                    </div>
                    <div className="pt-6 flex justify-between items-center border-t border-dashed border-slate-200">
                      <span className="font-bold text-lg text-slate-800">개당 수익</span>
                      <span className={`text-2xl font-black ${profit > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {profit.toLocaleString()}원
                      </span>
                    </div>
                  </div>
                  <button onClick={handle1688Click}
                    className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-2xl text-sm font-black flex items-center justify-center gap-2 transition-all shadow-lg">
                    <DollarSign className="w-4 h-4" />1688 소싱처 찾기 (중달이)
                  </button>
                </div>
                <div className="p-6 sm:p-8 bg-slate-50 border-t border-slate-200">
                  <button onClick={() => setIsCalcOpen(false)} className="w-full py-5 bg-slate-900 text-white font-black rounded-2xl">닫기</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ══════════ 쇼크트리 이벤트 팝업 ══════════ */}
        <AnimatePresence>
          {showPurchasePopup && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowPurchasePopup(false)}
                className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                className="fixed inset-0 m-auto z-[90] w-[92%] max-w-[480px] h-fit bg-white rounded-[28px] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.3)] border border-slate-200 overflow-hidden flex flex-col">
                <div className="px-7 pt-7 pb-2 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-indigo-500">Hoonpro Special</p>
                    <h3 className="text-xl font-black text-slate-900 mt-1.5">쇼크트리 추천인 가입 이벤트 안내</h3>
                  </div>
                  <button onClick={() => setShowPurchasePopup(false)} className="p-1.5 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all">
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
                    setShowPurchasePopup(false); open1688();
                  }} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-all">오늘 그만보기</button>
                  <button onClick={() => { setShowPurchasePopup(false); open1688(); }}
                    className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black transition-all shadow-sm">이동하기</button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
