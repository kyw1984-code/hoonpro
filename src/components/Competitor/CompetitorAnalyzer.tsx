import React, { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import {
  Search, Loader2, TrendingUp, Star, ShoppingCart,
  DollarSign, Lightbulb, Plus, Trash2, BarChart2
} from 'lucide-react';

const getApiKey = () =>
  import.meta.env.VITE_GOOGLE_API_KEY ||
  import.meta.env.VITE_GEMINI_API_KEY ||
  '';

const ai = new GoogleGenAI({ apiKey: getApiKey() });

interface ProductData {
  productId: string;
  productName: string;
  price: number;
  reviewCount: number;
  rating: number;
  categoryName: string;
  imageUrl: string;
  productUrl: string;
  estimatedSales: number;
  estimatedRevenue: number;
}

function extractProductId(url: string): string {
  // 쿠팡 URL에서 상품ID 추출
  // https://www.coupang.com/vp/products/12345678
  const match = url.match(/products\/(\d+)/);
  if (match) return match[1];
  // 숫자만 입력한 경우
  if (/^\d+$/.test(url.trim())) return url.trim();
  return '';
}

function formatNumber(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '억원';
  if (n >= 10000) return (n / 10000).toFixed(1) + '만원';
  return n.toLocaleString() + '원';
}

export const CompetitorAnalyzer: React.FC = () => {
  const [urls, setUrls] = useState<string[]>(['', '']);
  const [myProduct, setMyProduct] = useState({ name: '', price: '', features: '' });
  const [products, setProducts] = useState<ProductData[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [error, setError] = useState('');

  const addUrl = () => setUrls(prev => [...prev, '']);
  const removeUrl = (i: number) => setUrls(prev => prev.filter((_, idx) => idx !== i));
  const updateUrl = (i: number, val: string) => setUrls(prev => prev.map((u, idx) => idx === i ? val : u));

  const fetchProduct = async (url: string): Promise<ProductData | null> => {
    const productId = extractProductId(url);
    if (!productId) return null;

    const res = await fetch('/api/coupang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId }),
    });

    if (!res.ok) return null;
    const json = await res.json();
    if (json?.error) return null;
    return json;
  };

  const handleFetch = async () => {
    const validUrls = urls.filter(u => u.trim());
    if (validUrls.length === 0) {
      setError('최소 1개 이상의 쿠팡 상품 링크를 입력해주세요.');
      return;
    }
    setError('');
    setLoading(true);
    setProducts([]);
    setAnalysis('');

    try {
      const results = await Promise.all(validUrls.map(fetchProduct));
      const valid = results.filter(Boolean) as ProductData[];
      if (valid.length === 0) {
        setError('상품 정보를 가져오지 못했습니다. URL을 확인해주세요.');
      } else {
        setProducts(valid);
      }
    } catch (e) {
      setError('상품 정보 조회 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (products.length === 0) return;
    setAnalyzing(true);
    setAnalysis('');

    try {
      const competitorInfo = products.map((p, i) => `
경쟁사 ${i + 1}: ${p.productName}
- 판매가: ${(Number(p.price) || 0).toLocaleString()}원
- 리뷰수: ${(Number(p.reviewCount) || 0).toLocaleString()}개
- 평점: ${p.rating}점
- 추정 판매수량: ${(Number(p.estimatedSales) || 0).toLocaleString()}개 (리뷰수 x10)
- 추정 매출: ${formatNumber(p.estimatedRevenue)}
- 카테고리: ${p.categoryName}
      `.trim()).join('\n\n');

      const myInfo = myProduct.name
        ? `\n내 상품 정보:\n- 상품명: ${myProduct.name}\n- 판매가: ${myProduct.price}원\n- 특징: ${myProduct.features}`
        : '';

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        config: { responseMimeType: 'text/plain' },
        contents: `
당신은 한국 이커머스 전문 컨설턴트입니다. 아래 경쟁사 데이터를 분석하고 차별화 전략을 제안해주세요.

${competitorInfo}
${myInfo}

다음 항목으로 분석해주세요:
1. 📊 시장 현황 분석 (경쟁사들의 매출/리뷰 비교)
2. 💡 가격 전략 제안 (경쟁사 대비 최적 가격대)
3. 🎯 차별화 포인트 (경쟁사와 다른 강점을 만들 수 있는 방법)
4. 📝 상품명/키워드 전략 (검색 노출을 높이는 방법)
5. 🚀 실행 가능한 액션 플랜 (우선순위 순으로 3가지)

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
        <p className="text-slate-500 mt-1">쿠팡 경쟁사 링크를 입력하면 리뷰 기반 추정 매출과 차별화 전략을 분석해드려요.</p>
      </div>

      {/* 입력 섹션 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-6">
        <div>
          <h3 className="text-lg font-bold text-slate-700 mb-4">1. 경쟁사 상품 링크 입력</h3>
          <div className="space-y-3">
            {urls.map((url, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={url}
                  onChange={e => updateUrl(i, e.target.value)}
                  placeholder="https://www.coupang.com/vp/products/..."
                  className="flex-1 p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
                {urls.length > 1 && (
                  <button onClick={() => removeUrl(i)} className="p-3 text-red-400 hover:bg-red-50 rounded-xl transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addUrl}
            className="mt-3 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <Plus className="w-4 h-4" /> 링크 추가
          </button>
        </div>

        <div className="border-t border-slate-100 pt-6">
          <h3 className="text-lg font-bold text-slate-700 mb-4">2. 내 상품 정보 <span className="text-slate-400 text-sm font-normal">(선택 - 입력하면 더 정확한 전략 제안)</span></h3>
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

        {error && (
          <p className="text-red-500 text-sm bg-red-50 p-3 rounded-xl">{error}</p>
        )}

        <button
          onClick={handleFetch}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
          {loading ? '상품 정보 조회 중...' : '경쟁사 데이터 조회'}
        </button>
      </div>

      {/* 결과 섹션 */}
      {products.length > 0 && (
        <>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <h3 className="text-lg font-bold text-slate-700 mb-6">3. 경쟁사 데이터 분석</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {products.map((p, i) => (
                <div key={i} className="border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    {p.imageUrl && (
                      <img src={p.imageUrl} alt={p.productName} className="w-16 h-16 object-cover rounded-lg border border-slate-100 shrink-0" />
                    )}
                    <div>
                      <p className="text-xs text-blue-600 font-medium mb-1">경쟁사 {i + 1}</p>
                      <p className="font-medium text-slate-800 text-sm line-clamp-2">{p.productName}</p>
                      <p className="text-xs text-slate-400 mt-1">{p.categoryName}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                        <DollarSign className="w-3 h-3" /> 판매가
                      </div>
                      <p className="font-bold text-slate-800">{(Number(p.price) || 0).toLocaleString()}원</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                        <Star className="w-3 h-3 text-yellow-400" /> 평점/리뷰
                      </div>
                      <p className="font-bold text-slate-800">{p.rating}점 / {(Number(p.reviewCount) || 0).toLocaleString()}개</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3">
                      <div className="flex items-center gap-1 text-xs text-blue-500 mb-1">
                        <ShoppingCart className="w-3 h-3" /> 추정 판매수량
                      </div>
                      <p className="font-bold text-blue-700">{(Number(p.estimatedSales) || 0).toLocaleString()}개</p>
                      <p className="text-xs text-blue-400">리뷰수 × 10</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3">
                      <div className="flex items-center gap-1 text-xs text-green-500 mb-1">
                        <TrendingUp className="w-3 h-3" /> 추정 매출
                      </div>
                      <p className="font-bold text-green-700">{formatNumber(p.estimatedRevenue)}</p>
                      <p className="text-xs text-green-400">판매수량 × 판매가</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="mt-6 w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white font-medium py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              {analyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lightbulb className="w-5 h-5" />}
              {analyzing ? 'AI 분석 중...' : 'AI 차별화 전략 분석'}
            </button>
          </div>

          {/* AI 분석 결과 */}
          {analysis && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 className="w-5 h-5 text-purple-600" />
                <h3 className="text-lg font-bold text-slate-700">AI 차별화 전략 분석 결과</h3>
              </div>
              <div className="prose prose-slate max-w-none">
                {analysis.split('\n').map((line, i) => {
                  if (!line.trim()) return <br key={i} />;
                  if (line.startsWith('##')) return <h3 key={i} className="text-lg font-bold text-slate-800 mt-4 mb-2">{line.replace(/^#+\s*/, '')}</h3>;
                  if (line.match(/^\d+\./)) return <p key={i} className="font-semibold text-slate-700 mt-3">{line}</p>;
                  if (line.startsWith('-')) return <p key={i} className="text-slate-600 ml-4 text-sm">• {line.slice(1).trim()}</p>;
                  return <p key={i} className="text-slate-600 text-sm leading-relaxed">{line}</p>;
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
