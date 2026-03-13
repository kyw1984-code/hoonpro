import { useState, useRef, KeyboardEvent } from "react";

// ─── 타입 ─────────────────────────────────────────────────────────────────────
interface CoupangProduct {
  productId: string;
  productName: string;
  productPrice: number;
  productImage: string;
  productUrl: string;
  isRocket: boolean;
  rating: number;
  reviewCount: number;
  salesRank?: number;
  category?: string;
}

interface SearchResult {
  products: CoupangProduct[];
  keyword: string;
  isMock: boolean;
}

interface PriceRange {
  min: number;
  max: number;
  avg: number;
}

interface Strategy {
  icon: string;
  title: string;
  desc: string;
  color: string;
}

// ─── 유틸 함수 ────────────────────────────────────────────────────────────────
function estimateMonthlySales(rank: number, price: number): number {
  const base = Math.max(0, (10 - rank) * 250);
  const multiplier = price < 20000 ? 1.3 : price < 40000 ? 1.0 : 0.75;
  return Math.round(base * multiplier);
}

function getPriceRange(products: CoupangProduct[]): PriceRange {
  const prices = products.map((p) => p.productPrice);
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
  };
}

function deriveStrategies(products: CoupangProduct[]): Strategy[] {
  const rocketRatio = products.filter((p) => p.isRocket).length / products.length;
  const priceRange = getPriceRange(products);
  const totalEstSales = products.reduce(
    (a, p, i) => a + estimateMonthlySales(p.salesRank ?? i + 1, p.productPrice), 0
  );
  const strategies: Strategy[] = [];

  if (rocketRatio > 0.6) {
    strategies.push({ icon: "🚀", title: "로켓배송 필수 진입", desc: "상위 상품의 " + Math.round(rocketRatio * 100) + "%가 로켓배송입니다. 로켓그로스 입점을 우선 검토하세요.", color: "#ef4444" });
  } else {
    strategies.push({ icon: "💡", title: "일반 판매 진입 가능", desc: "로켓 비중 " + Math.round(rocketRatio * 100) + "%로 낮아 일반 판매자도 충분히 경쟁 가능한 시장입니다.", color: "#14b8a6" });
  }

  if (priceRange.avg < 30000) {
    strategies.push({ icon: "💰", title: "저가 경쟁 심화 시장", desc: "평균가 " + priceRange.avg.toLocaleString() + "원. 가격 경쟁 대신 번들 구성·사은품으로 가치를 차별화하세요.", color: "#f59e0b" });
  } else {
    strategies.push({ icon: "🎯", title: "프리미엄 포지셔닝 가능", desc: "평균가 " + priceRange.avg.toLocaleString() + "원. 고품질 이미지·브랜드 스토리 강조가 핵심입니다.", color: "#a855f7" });
  }

  strategies.push({ icon: "📊", title: "시장 규모 추정", desc: "상위 상품 월 추정 판매량 " + totalEstSales.toLocaleString() + "개, 거래액 약 " + Math.round((totalEstSales * priceRange.avg) / 10000).toLocaleString() + "만원 규모입니다.", color: "#3b82f6" });

  return strategies;
}

function buildChecklist(products: CoupangProduct[]): string[] {
  const priceRange = getPriceRange(products);
  const rocketCount = products.filter((p) => p.isRocket).length;
  return [
    "가격대: " + priceRange.min.toLocaleString() + "원 이하 or " + Math.round(priceRange.avg * 1.2).toLocaleString() + "원 이상 프리미엄 포지셔닝",
    rocketCount > products.length / 2 ? "로켓그로스 입점 검토 필수" : "일반 판매 우선 진입 가능",
    "상품 썸네일·상세페이지 차별화 (상위 상품 대비 시각 우위 확보)",
    "롱테일 키워드 변형으로 검색 노출 다각화",
    "초기 광고 집행 시 키워드 입찰가 경쟁 강도 사전 확인 필요",
  ];
}

// ─── 서브 컴포넌트 ────────────────────────────────────────────────────────────
function SearchBar({ keyword, onChange, onSearch, loading }: { keyword: string; onChange: (v: string) => void; onSearch: () => void; loading: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") onSearch(); };
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6 mb-7">
      <p className="text-xs font-semibold text-neutral-500 mb-3 tracking-wide uppercase">키워드로 시장 분석</p>
      <div className="flex gap-3">
        <input ref={inputRef} value={keyword} onChange={(e) => onChange(e.target.value)} onKeyDown={handleKey}
          placeholder="예: 무선이어폰, 캠핑의자, 프로틴 쉐이커..."
          className="flex-1 bg-white/[0.05] border border-white/[0.12] rounded-xl px-4 py-3 text-neutral-100 placeholder-neutral-600 text-sm outline-none focus:border-red-500/50 transition" />
        <button onClick={onSearch} disabled={loading || !keyword.trim()}
          className="px-7 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-red-600 to-red-400 hover:from-red-500 hover:to-red-300 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition">
          {loading ? "분석 중…" : "🔍 분석하기"}
        </button>
      </div>
    </div>
  );
}

function SummaryCards({ products }: { products: CoupangProduct[] }) {
  const priceRange = getPriceRange(products);
  const rocketCount = products.filter((p) => p.isRocket).length;
  const totalEstSales = products.reduce((a, p, i) => a + estimateMonthlySales(p.salesRank ?? i + 1, p.productPrice), 0);
  const metrics = [
    { label: "검색 상품 수",   value: products.length + "개",                                  sub: "조회된 상품",    color: "text-blue-400"    },
    { label: "평균 가격",      value: priceRange.avg.toLocaleString() + "원",                  sub: priceRange.min.toLocaleString() + " ~ " + priceRange.max.toLocaleString(), color: "text-emerald-400" },
    { label: "로켓배송 비율",  value: Math.round((rocketCount / products.length) * 100) + "%", sub: rocketCount + "/" + products.length + "개", color: "text-red-400" },
    { label: "월 추정 판매량", value: totalEstSales.toLocaleString() + "개",                   sub: "순위 기반 추정",  color: "text-amber-400"   },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {metrics.map((m) => (
        <div key={m.label} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
          <p className="text-xs font-semibold text-neutral-500 mb-2">{m.label}</p>
          <p className={"text-2xl font-extrabold tracking-tight " + m.color}>{m.value}</p>
          <p className="text-xs text-neutral-600 mt-1">{m.sub}</p>
        </div>
      ))}
    </div>
  );
}

function ProductList({ products }: { products: CoupangProduct[] }) {
  return (
    <div className="flex flex-col gap-2">
      {products.map((p, i) => {
        const rank = p.salesRank ?? i + 1;
        const estSales = estimateMonthlySales(rank, p.productPrice);
        const estRevenue = estSales * p.productPrice;
        const isTop3 = i < 3;
        return (
          <div key={p.productId} className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-4 grid grid-cols-[32px_1fr_auto] gap-4 items-center hover:border-white/[0.15] transition">
            <div className={"w-8 h-8 rounded-lg flex items-center justify-center text-sm font-extrabold " + (isTop3 ? "bg-gradient-to-br from-red-600 to-red-400 text-white" : "bg-white/[0.06] text-neutral-500")}>{i + 1}</div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <p className="text-sm font-medium leading-snug text-neutral-100 truncate">{p.productName}</p>
                
                  href={p.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition whitespace-nowrap"
                >
                  바로가기 →
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {p.isRocket && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">🚀 로켓</span>}
                <span className="text-xs text-neutral-600">추정 {estSales.toLocaleString()}개/월</span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-extrabold text-emerald-400 tracking-tight">{p.productPrice.toLocaleString()}원</p>
              <p className="text-xs text-neutral-600 mt-1">월매출 ≈ {Math.round(estRevenue / 10000).toLocaleString()}만원</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StrategyPanel({ products }: { products: CoupangProduct[] }) {
  const strategies = deriveStrategies(products);
  const checklist = buildChecklist(products);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {strategies.map((s) => (
          <div key={s.title} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-5" style={{ borderLeftColor: s.color, borderLeftWidth: 3 }}>
            <div className="text-2xl mb-2">{s.icon}</div>
            <p className="text-sm font-bold mb-2" style={{ color: s.color }}>{s.title}</p>
            <p className="text-xs text-neutral-400 leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>
      <div className="bg-blue-500/[0.08] border border-blue-500/20 rounded-xl p-5">
        <p className="text-sm font-bold text-blue-400 mb-4">📋 권장 진입 체크리스트</p>
        <ul className="flex flex-col gap-2">
          {checklist.map((item, idx) => (
            <li key={idx} className="flex gap-3 text-xs text-neutral-400 leading-relaxed">
              <span className="text-blue-500 font-bold shrink-0">·</span>{item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PriceChart({ products }: { products: CoupangProduct[] }) {
  const { max } = getPriceRange(products);
  return (
    <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-6">
      <p className="text-xs font-semibold text-neutral-500 mb-6 uppercase tracking-wide">상품별 가격 분포 (순위 기준)</p>
      <div className="flex items-end gap-2 h-48">
        {products.map((p, i) => {
          const barH = Math.max(12, (p.productPrice / max) * 160);
          const isTop3 = i < 3;
          return (
            <div key={p.productId} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] text-neutral-600">{Math.round(p.productPrice / 1000)}K</span>
              <div className="w-full relative" style={{ height: barH }}>
                <div className={"w-full h-full rounded-t-md " + (isTop3 ? "bg-gradient-to-t from-red-700 to-red-400" : "bg-white/[0.08]")} />
                {p.isRocket && <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px]">🚀</span>}
              </div>
              <span className="text-[10px] text-neutral-600">{i + 1}위</span>
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex gap-4 text-xs text-neutral-600">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" />Top 3</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-white/20 inline-block" />일반 상품</span>
        <span>🚀 로켓배송</span>
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
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
      const res = await fetch("/api/coupang-search?keyword=" + encodedKeyword + "&limit=10");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResults({ products: data.products, keyword, isMock: false });
    } catch (err) {
      setError("검색 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-neutral-100" style={{ fontFamily: "'DM Sans', 'Apple SD Gothic Neo', sans-serif" }}>
      <header className="border-b border-white/[0.06] bg-white/[0.02]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 to-red-400 flex items-center justify-center text-lg font-extrabold">쿠</div>
            <div>
              <p className="text-sm font-bold tracking-tight">쿠팡 시장 분석기</p>
              <p className="text-[10px] text-neutral-600 mt-0.5">Powered by Coupang Partners API</p>
            </div>
          </div>
          <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">BETA</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <SearchBar keyword={keyword} onChange={setKeyword} onSearch={handleSearch} loading={loading} />

        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-5 text-sm text-red-300">{error}</div>}

        {loading && (
          <div className="text-center py-20">
            <div className="text-4xl mb-4 animate-spin inline-block">⏳</div>
            <p className="text-sm text-neutral-500">쿠팡 데이터 분석 중…</p>
          </div>
        )}

        {results && !loading && (
          <>
            <SummaryCards products={results.products} />
            <div className="flex gap-1.5 mb-5">
              {TABS.map((t) => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={"px-4 py-2 rounded-lg text-xs font-semibold border transition " + (activeTab === t.id ? "bg-red-500/20 text-red-400 border-red-500/40" : "bg-white/[0.04] text-neutral-500 border-white/[0.06] hover:text-neutral-300")}>
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
            <p className="text-xs text-neutral-800">무선이어폰, 캠핑의자, 프로틴 쉐이커 등</p>
          </div>
        )}
      </main>
    </div>
  );
}
