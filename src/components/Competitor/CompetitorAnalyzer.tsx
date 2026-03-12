import React, { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import {
  Loader2, TrendingUp, ShoppingCart, Plus, Trash2,
  BarChart2, Wand2, Sparkles
} from 'lucide-react';

const getApiKey = () =>
  import.meta.env.VITE_GOOGLE_API_KEY ||
  import.meta.env.VITE_GEMINI_API_KEY ||
  '';

const ai = new GoogleGenAI({ apiKey: getApiKey() });

interface CompetitorData {
  id: string;
  productName: string;
  price: number;
  reviewCount: number;
  rating: number;
  categoryName: string;
  estimatedSales: number;
  estimatedRevenue: number;
  loading: boolean;
  estimated: boolean; // AI 추정 여부
}

function formatNumber(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '억원';
  if (n >= 10000) return (n / 10000).toFixed(1) + '만원';
  return n.toLocaleString() + '원';
}

const emptyCompetitor = (): CompetitorData => ({
  id: Math.random().toString(36).substring(7),
  productName: '',
  price: 0,
  reviewCount: 0,
  rating: 0,
  categoryName: '',
  estimatedSales: 0,
  estimatedRevenue: 0,
  loading: false,
  estimated: false,
});

export const CompetitorAnalyzer: React.FC = () => {
  const [competitors, setCompetitors] = useState<CompetitorData[]>([emptyCompetitor(), emptyCompetitor()]);
  const [myProduct, setMyProduct] = useState({ name: '', price: '', features: '' });
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [globalError, setGlobalError] = useState('');

  const addCompetitor = () => setCompetitors(prev => [...prev, emptyCompetitor()]);
  const removeCompetitor = (id: string) => setCompetitors(prev => prev.filter(c => c.id !== id));

  const updateName = (id: string, productName: string) => {
    setCompetitors(prev => prev.map(c => c.id === id ? { ...c, productName, estimated: false } : c));
  };

  // AI로 경쟁사 데이터 추정
  const estimateCompetitor = async (id: string) => {
    const competitor = competitors.find(c => c.id === id);
    if (!competitor?.productName.trim()) return;

    setCompetitors(prev => prev.map(c => c.id === id ? { ...c, loading: true } : c));

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        config: { responseMimeType: 'application/json' },
        contents: `
당신은 한국 쿠팡 이커머스 전문가입니다.
아래 상품명을 보고 쿠팡에서 해당 상품의 일반적인 시장 데이터를 추정해주세요.

상품명: ${competitor.productName}

반드시 아래 JSON 형식으로만 반환하세요:
{
  "price": 예상 판매가 (숫자만, 원 단위),
  "reviewCount": 중간 정도 판매량 상품의 예상 리뷰수 (숫자만),
  "rating": 예상 평점 (숫자, 소수점 1자리),
  "categoryName": "카테고리명",
  "priceRange": "최저가~최고가 범위 (예: 15,000~35,000원)",
  "marketComment": "해당 카테고리 경쟁 강도와 시장 특성 한 줄 설명"
}
        `.trim(),
      });

      const text = response.text ?? '{}';
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

      const reviewCount = Number(parsed.reviewCount) || 0;
      const price = Number(parsed.price) || 0;

      setCompetitors(prev => prev.map(c =>
        c.id === id ? {
          ...c,
          loading: false,
          estimated: true,
          price,
          reviewCount,
          rating: Number(parsed.rating) || 0,
          categoryName: parsed.categoryName || '',
          estimatedSales: reviewCount * 10,
          estimatedRevenue: reviewCount * 10 * price,
          priceRange: parsed.priceRange,
          marketComment: parsed.marketComment,
        } as any : c
      ));
    } catch (e) {
      setCompetitors(prev => prev.map(c =>
        c.id === id ? { ...c, loading: false } : c
      ));
    }
  };

  const estimateAll = async () => {
    const toEstimate = competitors.filter(c => c.productName.trim() && !c.estimated);
    await Promise.all(toEstimate.map(c => estimateCompetitor(c.id)));
  };

  const handleAnalyze = async () => {
    const valid = competitors.filter(c => c.productName.trim());
    if (valid.length === 0) {
      setGlobalError('최소 1개 이상의 경쟁사 상품명을 입력해주세요.');
      return;
    }
    setGlobalError('');
    setAnalyzing(true);
    setAnalysis('');

    try {
      const competitorInfo = valid.map((c, i) => `
경쟁사 ${i + 1}: ${c.productName}
- 판매가: ${c.price.toLocaleString()}원 ${(c as any).priceRange ? `(시장 범위: ${(c as any).priceRange})` : ''}
- 리뷰수: ${c.reviewCount.toLocaleString()}개
- 평점: ${c.rating}점
- 카테고리: ${c.categoryName}
- 추정 판매수량: ${c.estimatedSales.toLocaleString()}개
- 추정 매출: ${formatNumber(c.estimatedRevenue)}
${(c as any).marketComment ? `- 시장 특성: ${(c as any).marketComment}` : ''}
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
        <p className="text-slate-500 mt-1">경쟁사 상품명만 입력하면 AI가 시장 데이터를 추정하고 전략을 분석해드려요.</p>
      </div>

      {/* 경쟁사 입력 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-700">1. 경쟁사 상품명 입력</h3>
            <p className="text-sm text-slate-400 mt-0.5">쿠팡에서 경쟁사 상품명을 복사해서 붙여넣으세요.</p>
          </div>
          <button
            onClick={estimateAll}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            전체 AI 추정
          </button>
        </div>

        <div className="space-y-3">
          {competitors.map((c, i) => (
            <div key={c.id} className="space-y-2">
              <div className="flex gap-2">
                <div className="flex items-center gap-2 flex-1 border border-slate-300 rounded-xl px-3 focus-within:ring-2 focus-within:ring-blue-500">
                  <span className="text-xs font-bold text-blue-500 shrink-0">{i + 1}</span>
                  <input
                    type="text"
                    value={c.productName}
                    onChange={e => updateName(c.id, e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && estimateCompetitor(c.id)}
                    placeholder="쿠팡 경쟁사 상품명 입력 후 엔터"
                    className="flex-1 py-3 outline-none text-sm"
                  />
                  {c.loading && <Loader2 className="w-4 h-4 animate-spin text-blue-500 shrink-0" />}
                </div>
                <button
                  onClick={() => estimateCompetitor(c.id)}
                  disabled={c.loading || !c.productName.trim()}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-xl text-sm font-medium text-slate-700 transition-colors shrink-0"
                >
                  AI 추정
                </button>
                {competitors.length > 1 && (
                  <button onClick={() => removeCompetitor(c.id)} className="p-2 text-red-400 hover:text-red-600 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* AI 추정 결과 */}
              {c.estimated && c.price > 0 && (
                <div className="ml-2 border border-blue-100 bg-blue-50/50 rounded-xl p-4">
                  <div className="flex items-center gap-1 mb-3">
                    <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs text-blue-500 font-medium">AI 추정 데이터</span>
                    {(c as any).priceRange && (
                      <span className="text-xs text-slate-400 ml-2">시장 가격대: {(c as any).priceRange}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                    <div className="bg-white rounded-lg p-2 text-center border border-slate-100">
                      <p className="text-xs text-slate-400">추정 판매가</p>
                      <p className="font-bold text-slate-700 text-sm">{c.price.toLocaleString()}원</p>
                    </div>
                    <div className="bg-white rounded-lg p-2 text-center border border-slate-100">
                      <p className="text-xs text-slate-400">추정 리뷰/평점</p>
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
                  {(c as any).marketComment && (
                    <p className="text-xs text-slate-500 mt-1">💡 {(c as any).marketComment}</p>
                  )}
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
