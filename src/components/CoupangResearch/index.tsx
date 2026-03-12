import { useState } from "react";
import type { SearchResult } from "../../types/coupang";
import { MOCK_PRODUCTS } from "../../lib/coupang";
import SearchBar     from "./SearchBar";
import SummaryCards  from "./SummaryCards";
import ProductList   from "./ProductList";
import StrategyPanel from "./StrategyPanel";
import PriceChart    from "./PriceChart";

type Tab = "products" | "strategy" | "chart";

const TABS: { id: Tab; label: string }[] = [
  { id: "products", label: "📦 상품 목록" },
  { id: "strategy", label: "🎯 전략 분석" },
  { id: "chart",    label: "📊 가격 분포" },
];

export default function CoupangResearch() {
  const [keyword,   setKeyword]   = useState("");
  const [results,   setResults]   = useState<SearchResult | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("products");

  async function handleSearch() {
    if (!keyword.trim()) return;
    setLoading(true);
    setError("");
    setResults(null);

    try {
      const encodedKeyword = encodeURIComponent(keyword);
      const res = await fetch(
        "/api/coupang-search?keyword=" + encodedKeyword + "&limit=10"
      );

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await res.json();
      setResults({ products: data.products, keyword, isMock: false });
    } catch (err) {
      console.warn("API 호출 실패, 데모 데이터 사용:", err);
      await new Promise((r) => setTimeout(r, 800));
      setResults({ products: MOCK_PRODUCTS, keyword, isMock: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-[#0a0a0f] text-neutral-100"
      style={{ fontFamily: "'DM Sans', 'Apple SD Gothic Neo', sans-serif" }}
    >
      <header className="border-b border-white/[0.06] bg-white/[0.02]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 to-red-400 flex items-center justify-center text-lg font-extrabold">
              쿠
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight">쿠팡 AI 시장분석기</p>
              <p className="text-[10px] text-neutral-600 mt-0.5">
                Powered by Coupang Partners API
              </p>
            </div>
          </div>
          <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            BETA
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <SearchBar
          keyword={keyword}
          onChange={setKeyword}
          onSearch={handleSearch}
          loading={loading}
        />

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-5 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-center py-20">
            <div className="text-4xl mb-4 animate-spin inline-block">⏳</div>
            <p className="text-sm text-neutral-500">쿠팡 데이터 분석 중…</p>
          </div>
        )}

        {results && !loading && (
          <>
            {results.isMock && (
              <div className="bg-amber-500/[0.08] border border-amber-500/20 rounded-lg px-4 py-2.5 mb-5 text-xs text-amber-400">
                📌 데모 모드 — 샘플 데이터입니다. Vercel 환경변수에{" "}
                <code className="bg-white/10 px-1 rounded">COUPANG_ACCESS_KEY</code>와{" "}
                <code className="bg-white/10 px-1 rounded">COUPANG_SECRET_KEY</code>를
                설정하면 실제 데이터가 조회됩니다.
              </div>
            )}

            <SummaryCards products={results.products} />

            <div className="flex gap-1.5 mb-5">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={
                    "px-4 py-2 rounded-lg text-xs font-semibold border transition " +
                    (activeTab === t.id
                      ? "bg-red-500/20 text-red-400 border-red-500/40"
                      : "bg-white/[0.04] text-neutral-500 border-white/[0.06] hover:text-neutral-300")
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            {activeTab === "products" && <ProductList   products={results.products} />}
            {activeTab === "strategy" && <StrategyPanel products={results.products} />}
            {activeTab === "chart"    && <PriceChart    products={results.products} />}
          </>
        )}

        {!results && !loading && (
          <div className="text-center py-20 text-neutral-700">
            <div className="text-5xl mb-4 opacity-30">🔍</div>
            <p className="text-sm mb-1">키워드를 입력해서 시장을 분석해보세요</p>
            <p className="text-xs text-neutral-800">
              무선이어폰, 캠핑의자, 프로틴 쉐이커 등
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
