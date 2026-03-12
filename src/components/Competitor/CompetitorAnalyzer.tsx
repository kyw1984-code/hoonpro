import React, { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import {
  Loader2, TrendingUp, Star, ShoppingCart,
  DollarSign, Lightbulb, Plus, Trash2, BarChart2, Wand2
} from 'lucide-react';

const getApiKey = () =>
  import.meta.env.VITE_GOOGLE_API_KEY ||
  import.meta.env.VITE_GEMINI_API_KEY ||
  '';

const ai = new GoogleGenAI({ apiKey: getApiKey() });

interface CompetitorData {
  id: string;
  productName: string;
  price: string;
  reviewCount: string;
  rating: string;
  features: string;
}

function formatNumber(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '억원';
  if (n >= 10000) return (n / 10000).toFixed(1) + '만원';
  return n.toLocaleString() + '원';
}

const emptyCompetitor = (): CompetitorData => ({
  id: Math.random().toString(36).substring(7),
  productName: '',
  price: '',
  reviewCount: '',
  rating: '',
  features: '',
});

export const CompetitorAnalyzer: React.FC = () => {
  const [competitors, setCompetitors] = useState<CompetitorData[]>([emptyCompetitor(), emptyCompetitor()]);
  const [myProduct, setMyProduct] = useState({ name: '', price: '', features: '' });
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [error, setError] = useState('');

  const addCompetitor = () => setCompetitors(prev => [...prev, emptyCompetitor()]);
  const removeCompetitor = (id: string) => setCompetitors(prev => prev.filter(c => c.id !== id));
  const updateCompetitor = (id: string, field: keyof CompetitorData, value: string) => {
    setCompetitors(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const getEstimates = (c: CompetitorData) => {
    const reviewCount = Number(c.reviewCount) || 0;
    const price = Number(c.price) || 0;
    const estimatedSales = reviewCount * 10;
    const estimatedRevenue = estimatedSales * price;
    return { estimatedSales, estimatedRevenue };
  };

  const handleAnalyze = async () => {
    const valid = competitors.filter(c => c.productName.trim() && c.price.trim());
    if (valid.length === 0) {
      setError('최소 1개 이상의 경쟁사 상품명과 가격을 입력해주세요.');
      return;
    }
    setError('');
    setAnalyzing(true);
    setAnalysis('');

    try {
      const competitorInfo = valid.map((c, i) => {
        const { estimatedSales, estimatedRevenue } = getEstimates(c);
        return `
경쟁사 ${i + 1}: ${c.productName}
- 판매가: ${Number(c.price).toLocaleString()}원
- 리뷰수: ${Number(c.reviewCount).toLocaleString()}개
- 평점: ${c.rating || '정보 없음'}점
- 특징: ${c.features || '정보 없음'}
- 추정 판매수량: ${estimatedSales.toLocaleString()}개 (리뷰수 × 10)
- 추정 매출: ${formatNumber(estimatedRevenue)}
        `.trim();
      }).join('\n\n');

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
      setError('AI 분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">🔍 경쟁사 분석기</h2>
        <p className="text-slate-500 mt-1">경쟁사 정보를 입력하면 AI가 추정 매출과 차별화 전략을 분석해드려요.</p>
      </div>

      {/* 경쟁사 입력 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-6">
        <h3 className="text-lg font-bold text-slate-700">1. 경쟁사 상품 정보 입력</h3>
        <p className="text-sm text-slate-400 -mt-4">쿠팡에서 경쟁사 상품 페이지를 보면서 아래에 입력해주세요.</p>

        <div className="space-y-4">
          {competitors.map((c, i) => (
            <div key={c.id} className="border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-blue-600">경쟁사 {i + 1}</span>
                {competitors.length > 1 && (
                  <button onClick={() => removeCompetitor(c.id)} className="text-red-400 hover:text-red-600 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">상품명 *</label>
                  <input
                    type="text"
                    value={c.productName}
                    onChange={e => updateCompetitor(c.id, 'productName', e.target.value)}
                    placeholder="예: 오버핏 반팔티 남자 여름"
                    className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">판매가 (원) *</label>
                  <input
                    type="number"
                    value={c.price}
                    onChange={e => updateCompetitor(c.id, 'price', e.target.value)}
                    placeholder="예: 29900"
                    className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">리뷰수</label>
                  <input
                    type="number"
                    value={c.reviewCount}
                    onChange={e => updateCompetitor(c.id, 'reviewCount', e.target.value)}
                    placeholder="예: 1250"
                    className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">평점</label>
                  <input
                    type="number"
                    step="0.1"
                    max="5"
                    value={c.rating}
                    onChange={e => updateCompetitor(c.id, 'rating', e.target.value)}
                    placeholder="예: 4.5"
                    className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">상품 특징</label>
                  <input
                    type="text"
                    value={c.features}
                    onChange={e => updateCompetitor(c.id, 'features', e.target.value)}
                    placeholder="예: 순면 100%, 7가지 색상"
                    className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
              </div>

              {/* 실시간 추정 데이터 */}
              {c.price && c.reviewCount && (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="bg-blue-50 rounded-lg p-3">
                    <div className="flex items-center gap-1 text-xs text-blue-500 mb-1">
                      <ShoppingCart className="w-3 h-3" /> 추정 판매수량
                    </div>
                    <p className="font-bold text-blue-700">{getEstimates(c).estimatedSales.toLocaleString()}개</p>
                    <p className="text-xs text-blue-400">리뷰수 × 10</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3">
                    <div className="flex items-center gap-1 text-xs text-green-500 mb-1">
                      <TrendingUp className="w-3 h-3" /> 추정 매출
                    </div>
                    <p className="font-bold text-green-700">{formatNumber(getEstimates(c).estimatedRevenue)}</p>
                    <p className="text-xs text-green-400">판매수량 × 판매가</p>
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
          <input
            type="text"
            value={myProduct.name}
            onChange={e => setMyProduct({ ...myProduct, name: e.target.value })}
            placeholder="내 상품명"
            className="p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
          />
          <input
            type="text"
            value={myProduct.price}
            onChange={e => setMyProduct({ ...myProduct, price: e.target.value })}
            placeholder="판매 희망가 (원)"
            className="p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
          />
          <input
            type="text"
            value={myProduct.features}
            onChange={e => setMyProduct({ ...myProduct, features: e.target.value })}
            placeholder="내 상품 특징/강점"
            className="p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
          />
        </div>
      </div>

      {error && <p className="text-red-500 text-sm bg-red-50 p-3 rounded-xl">{error}</p>}

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
