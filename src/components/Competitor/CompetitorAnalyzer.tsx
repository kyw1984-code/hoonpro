import React, { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import {
  Loader2, TrendingUp, ShoppingCart, Plus, Trash2, BarChart2, Wand2, Link, RefreshCw
} from 'lucide-react';

const getApiKey = () =>
  import.meta.env.VITE_GOOGLE_API_KEY ||
  import.meta.env.VITE_GEMINI_API_KEY ||
  '';

const ai = new GoogleGenAI({ apiKey: getApiKey() });

interface CompetitorData {
  id: string;
  url: string;
  productName: string;
  price: number;
  reviewCount: number;
  rating: number;
  categoryName: string;
  estimatedSales: number;
  estimatedRevenue: number;
  loading: boolean;
  error: string;
}

function formatNumber(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '억원';
  if (n >= 10000) return (n / 10000).toFixed(1) + '만원';
  return n.toLocaleString() + '원';
}

const emptyCompetitor = (): CompetitorData => ({
  id: Math.random().toString(36).substring(7),
  url: '',
  productName: '',
  price: 0,
  reviewCount: 0,
  rating: 0,
  categoryName: '',
  estimatedSales: 0,
  estimatedRevenue: 0,
  loading: false,
  error: '',
});

export const CompetitorAnalyzer: React.FC = () => {
  const [competitors, setCompetitors] = useState<CompetitorData[]>([emptyCompetitor(), emptyCompetitor()]);
  const [myProduct, setMyProduct] = useState({ name: '', price: '', features: '' });
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [globalError, setGlobalError] = useState('');

  const addCompetitor = () => setCompetitors(prev => [...prev, emptyCompetitor()]);
  const removeCompetitor = (id: string) => setCompetitors(prev => prev.filter(c => c.id !== id));

  const updateUrl = (id: string, url: string) => {
    setCompetitors(prev => prev.map(c => c.id === id ? { ...c, url } : c));
  };

  const fetchCompetitor = async (id: string) => {
    const competitor = competitors.find(c => c.id === id);
    if (!competitor?.url.trim()) return;

    setCompetitors(prev => prev.map(c => c.id === id ? { ...c, loading: true, error: '' } : c));

    try {
      const res = await fetch('/api/coupang', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: competitor.url }),
      });

      const data = await res.json();

      if (data.error) {
        setCompetitors(prev => prev.map(c =>
          c.id === id ? { ...c, loading: false, error: data.message || '조회 실패' } : c
        ));
        return;
      }

      setCompetitors(prev => prev.map(c =>
        c.id === id ? {
          ...c,
          loading: false,
          error: '',
          productName: data.productName,
          price: data.price,
          reviewCount: data.reviewCount,
          rating: data.rating,
          categoryName: data.categoryName,
          estimatedSales: data.estimatedSales,
          estimatedRevenue: data.estimatedRevenue,
        } : c
      ));
    } catch (e: any) {
      setCompetitors(prev => prev.map(c =>
        c.id === id ? { ...c, loading: false, error: '네트워크 오류' } : c
      ));
    }
  };

  const fetchAll = async () => {
    const urlCompetitors = competitors.filter(c => c.url.trim());
    if (urlCompetitors.length === 0) return;
    await Promise.all(urlCompetitors.map(c => fetchCompetitor(c.id)));
  };

  const handleAnalyze = async () => {
    const valid = competitors.filter(c => c.productName.trim());
    if (valid.length === 0) {
      setGlobalError('먼저 경쟁사 URL을 입력하고 조회해주세요.');
      return;
    }
    setGlobalError('');
    setAnalyzing(true);
    setAnalysis('');

    try {
      const competitorInfo = valid.map((c, i) => `
경쟁사 ${i + 1}: ${c.productName}
- 판매가: ${c.price.toLocaleString()}원
- 리뷰수: ${c.reviewCount.toLocaleString()}개
- 평점: ${c.rating}점
- 카테고리: ${c.categoryName}
- 추정 판매수량: ${c.estimatedSales.toLocaleString()}개 (리뷰수 × 10)
- 추정 매출: ${formatNumber(c.estimatedRevenue)}
      `.trim()).join('\n\n');

      const myInfo = myProduct.name
        ? `\n내 상품 정보:\n- 상품명: ${myProduct.name}\n- 판매 희망가: ${myProduct.price}원\n- 특징/강점: ${myProduct.features}`
        : '';

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        config: { responseMimeType: 'text/plain' },
        contents: `
당신은 한국 이커머스 전문 컨설턴트입니다. 아래 경쟁사 데이터를 분석하고 차별화 전략을 제안해주세요.

${competitorInfo}
${myInfo}

다음 항목으로 분석해주세요:
1. 📊 시장 현황 분석 (경쟁사들의 추정 매출/리뷰 비교 및 시장 규모)
2. 💰 가격 전략 제안 (경쟁사 대비 최적 가격대 및 근거)
3. 🎯 차별화 포인트 (경쟁사와 다른 강점을 만들 수 있는 구체적인 방법)
4. 📝 상품명/키워드 전략 (검색 노출을 높이는 키워드 조합 추천)
5. 🚀 우선순위 액션 플랜 (당장 실행 가능한 3가지)

한국어로 구체적이고 실용적으로 작성해주세요.
        `.trim(),
      });

      setAnalysis(response.text ?? '');
    } catch (e) {
      setGlobalError('AI 분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">🔍 경쟁사 분석기</h2>
        <p className="text-slate-500 mt-1">쿠팡 상품 링크를 입력하면 AI가 자동으로 데이터를 분석해드려요.</p>
      </div>

      {/* 경쟁사 URL 입력 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-700">1. 경쟁사 상품 링크 입력</h3>
          <button
            onClick={fetchAll}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            전체 조회
          </button>
        </div>

        <div className="space-y-3">
          {competitors.map((c, i) => (
            <div key={c.id} className="space-y-2">
              <div className="flex gap-2">
                <div className="flex items-center gap-2 flex-1 border border-slate-300 rounded-xl px-3 focus-within:ring-2 focus-within:ring-blue-500">
                  <Link className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={c.url}
                    onChange={e => updateUrl(c.id, e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && fetchCompetitor(c.id)}
                    placeholder={`경쟁사 ${i + 1} 쿠팡 링크 입력 후 엔터`}
                    className="flex-1 py-3 outline-none text-sm"
                  />
                  {c.loading && <Loader2 className="w-4 h-4 animate-spin text-blue-500 shrink-0" />}
                </div>
                <button
                  onClick={() => fetchCompetitor(c.id)}
                  disabled={c.loading || !c.url.trim()}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-xl text-sm font-medium text-slate-700 transition-colors shrink-0"
                >
                  조회
                </button>
                {competitors.length > 1 && (
                  <button onClick={() => removeCompetitor(c.id)} className="p-2 text-red-400 hover:text-red-600 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* 오류 메시지 */}
              {c.error && (
                <p className="text-red-500 text-xs ml-2">{c.error} — 직접 입력하시겠어요?</p>
              )}

              {/* 조회 결과 */}
              {c.productName && (
                <div className="ml-2 border border-slate-100 bg-slate-50 rounded-xl p-4">
                  <p className="font-medium text-slate-800 text-sm mb-3">{c.productName}</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="bg-white rounded-lg p-2 text-center border border-slate-100">
                      <p className="text-xs text-slate-400">판매가</p>
                      <p className="font-bold text-slate-700 text-sm">{c.price.toLocaleString()}원</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 text-center border border-slate-100">
                      <p className="text-xs text-slate-400">리뷰/평점</p>
                      <p className="font-bold text-slate-700 text-sm">{c.reviewCount.toLocaleString()}개 / {c.rating}점</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-2 text-center border border-blue-100">
                      <p className="text-xs text-blue-400">추정 판매수량</p>
                      <p className="font-bold text-blue-700 text-sm">{c.estimatedSales.toLocaleString()}개</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-2 text-center border border-green-100">
                      <p className="text-xs text-green-400">추정 매출</p>
                      <p className="font-bold text-green-700 text-sm">{formatNumber(c.estimatedRevenue)}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={addCompetitor}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          <Plus className="w-4 h-4" /> 경쟁사 추가
        </button>
      </div>

      {/* 내 상품 정보 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <h3 className="text-lg font-bold text-slate-700 mb-1">2. 내 상품 정보 <span className="text-slate-400 text-sm font-normal">(선택)</span></h3>
        <p className="text-sm text-slate-400 mb-4">입력하면 더 정확한 차별화 전략을 제안해드려요.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input type="text" value={myProduct.name} onChange={e => setMyProduct({ ...myProduct, name: e.target.value })} placeholder="내 상품명" className="p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
          <input type="text" value={myProduct.price} onChange={e => setMyProduct({ ...myProduct, price: e.target.value })} placeholder="판매 희망가 (원)" className="p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
          <input type="text" value={myProduct.features} onChange={e => setMyProduct({ ...myProduct, features: e.target.value })} placeholder="내 상품 특징/강점" className="p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
        </div>
      </div>

      {globalError && <p className="text-red-500 text-sm bg-red-50 p-3 rounded-xl">{globalError}</p>}

      <button
        onClick={handleAnalyze}
        disabled={analyzing}
        className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white font-medium py-4 rounded-xl flex items-center justify-center gap-2 transition-colors text-lg"
      >
        {analyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
        {analyzing ? 'AI 분석 중...' : 'AI 차별화 전략 분석 시작'}
      </button>

      {/* AI 분석 결과 */}
      {analysis && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          <div className="flex items-center gap-2 mb-6">
            <BarChart2 className="w-5 h-5 text-purple-600" />
            <h3 className="text-lg font-bold text-slate-700">AI 차별화 전략 분석 결과</h3>
          </div>
          <div className="space-y-2">
            {analysis.split('\n').map((line, i) => {
              if (!line.trim()) return <div key={i} className="h-2" />;
              if (line.match(/^#{1,3}\s/)) return <h3 key={i} className="text-lg font-bold text-slate-800 mt-4 mb-1">{line.replace(/^#+\s*/, '')}</h3>;
              if (line.match(/^\d+\.\s/)) return <p key={i} className="font-bold text-slate-700 mt-4 text-base">{line}</p>;
              if (line.startsWith('- ')) return <p key={i} className="text-slate-600 ml-4 text-sm">• {line.slice(2)}</p>;
              if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-semibold text-slate-700">{line.replace(/\*\*/g, '')}</p>;
              return <p key={i} className="text-slate-600 text-sm leading-relaxed">{line}</p>;
            })}
          </div>
        </div>
      )}
    </div>
  );
};
