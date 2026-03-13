import { useState, useRef } from "react";

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
}

interface SearchResult {
  products: CoupangProduct[];
  keyword: string;
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

function estimateMonthlySales(rank: number, price: number): number {
  const base = Math.max(0, (10 - rank) * 250);
  const multiplier = price < 20000 ? 1.3 : price < 40000 ? 1.0 : 0.75;
  return Math.round(base * multiplier);
}

function getPriceRange(products: CoupangProduct[]): PriceRange {
  const prices = products.map(function(p) { return p.productPrice; });
  return {
    min: Math.min.apply(null, prices),
    max: Math.max.apply(null, prices),
    avg: Math.round(prices.reduce(function(a, b) { return a + b; }, 0) / prices.length),
  };
}

function deriveStrategies(products: CoupangProduct[]): Strategy[] {
  const rocketRatio = products.filter(function(p) { return p.isRocket; }).length / products.length;
  const priceRange = getPriceRange(products);
  const totalEstSales = products.reduce(function(a, p, i) {
    return a + estimateMonthlySales(p.salesRank != null ? p.salesRank : i + 1, p.productPrice);
  }, 0);
  const strategies: Strategy[] = [];

  if (rocketRatio > 0.6) {
    strategies.push({ icon: "🚀", title: "로켓배송 필수 진입", desc: "상위 상품의 " + Math.round(rocketRatio * 100) + "%가 로켓배송입니다. 로켓그로스 입점을 우선 검토하세요.", color: "#ef4444" });
  } else {
    strategies.push({ icon: "💡", title: "일반 판매 진입 가능", desc: "로켓 비중 " + Math.round(rocketRatio * 100) + "%로 낮아 일반 판매자도 충분히 경쟁 가능한 시장입니다.", color: "#14b8a6" });
  }

  if (priceRange.avg < 30000) {
    strategies.push({ icon: "💰", title: "저가 경쟁 심화 시장", desc: "평균가 " + priceRange.avg.toLocaleString() + "원. 가격 경쟁 대신 번들 구성 사은품으로 가치를 차별화하세요.", color: "#f59e0b" });
  } else {
    strategies.push({ icon: "🎯", title: "프리미엄 포지셔닝 가능", desc: "평균가 " + priceRange.avg.toLocaleString() + "원. 고품질 이미지 브랜드 스토리 강조가 핵심입니다.", color: "#a855f7" });
  }

  strategies.push({ icon: "📊", title: "시장 규모 추정", desc: "상위 상품 월 추정 판매량 " + totalEstSales.toLocaleString() + "개, 거래액 약 " + Math.round((totalEstSales * priceRange.avg) / 10000).toLocaleString() + "만원 규모입니다.", color: "#3b82f6" });
  return strategies;
}

function buildChecklist(products: CoupangProduct[]): string[] {
  const priceRange = getPriceRange(products);
  const rocketCount = products.filter(function(p) { return p.isRocket; }).length;
  return [
    "가격대: " + priceRange.min.toLocaleString() + "원 이하 or " + Math.round(priceRange.avg * 1.2).toLocaleString() + "원 이상 프리미엄 포지셔닝",
    rocketCount > products.length / 2 ? "로켓그로스 입점 검토 필수" : "일반 판매 우선 진입 가능",
    "상품 썸네일 상세페이지 차별화 (상위 상품 대비 시각 우위 확보)",
    "롱테일 키워드 변형으로 검색 노출 다각화",
    "초기 광고 집행 시 키워드 입찰가 경쟁 강도 사전 확인 필요",
  ];
}

type ActiveTab = "products" | "strategy" | "chart";

export default function CoupangResearch() {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("products");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSearch();
  }

  async function handleSearch() {
    if (!keyword.trim()) return;
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const res = await fetch("/api/coupang-search?keyword=" + encodeURIComponent(keyword) + "&limit=10");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResults({ products: data.products, keyword: keyword });
    } catch (err) {
      setError("검색 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  const priceRange = results ? getPriceRange(results.products) : null;
  const rocketCount = results ? results.products.filter(function(p) { return p.isRocket; }).length : 0;
  const totalEstSales = results ? results.products.reduce(function(a, p, i) {
    return a + estimateMonthlySales(p.salesRank != null ? p.salesRank : i + 1, p.productPrice);
  }, 0) : 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#f5f5f5", fontFamily: "Apple SD Gothic Neo, sans-serif" }}>
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#dc2626,#f87171)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 14 }}>쿠</div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>쿠팡 시장 분석기</p>
              <p style={{ fontSize: 10, color: "#a3a3a3", margin: 0 }}>Powered by Coupang Partners API</p>
            </div>
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)" }}>BETA</span>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 24, marginBottom: 28 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: "#a3a3a3", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>키워드로 시장 분석</p>
          <div style={{ display: "flex", gap: 12 }}>
            <input
              ref={inputRef}
              value={keyword}
              onChange={function(e) { setKeyword(e.target.value); }}
              onKeyDown={handleKey}
              placeholder="예: 무선이어폰, 캠핑의자, 프로틴 쉐이커..."
              style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "12px 16px", color: "#f5f5f5", fontSize: 14, outline: "none" }}
            />
            <button
              onClick={handleSearch}
              disabled={loading || !keyword.trim()}
              style={{ padding: "12px 28px", borderRadius: 12, fontWeight: 700, fontSize: 14, color: "#fff", background: "linear-gradient(to right, #dc2626, #f87171)", border: "none", cursor: loading || !keyword.trim() ? "not-allowed" : "pointer", opacity: loading || !keyword.trim() ? 0.4 : 1, whiteSpace: "nowrap" }}
            >
              {loading ? "분석 중..." : "검색"}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 20, fontSize: 14, color: "#fca5a5" }}>
            {error}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>⏳</div>
            <p style={{ fontSize: 14, color: "#a3a3a3" }}>쿠팡 데이터 분석 중...</p>
          </div>
        )}

        {results && !loading && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
              {[
                { label: "검색 상품 수", value: results.products.length + "개", sub: "단품 기준", color: "#60a5fa" },
                { label: "평균 가격", value: priceRange ? priceRange.avg.toLocaleString() + "원" : "-", sub: priceRange ? priceRange.min.toLocaleString() + " ~ " + priceRange.max.toLocaleString() : "", color: "#34d399" },
                { label: "로켓배송 비율", value: Math.round((rocketCount / results.products.length) * 100) + "%", sub: rocketCount + "/" + results.products.length + "개", color: "#f87171" },
                { label: "월 추정 판매량", value: totalEstSales.toLocaleString() + "개", sub: "순위 기반 추정", color: "#fbbf24" },
              ].map(function(m) {
                return (
                  <div key={m.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 16 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: "#a3a3a3", marginBottom: 8 }}>{m.label}</p>
                    <p style={{ fontSize: 22, fontWeight: 900, color: m.color, margin: 0 }}>{m.value}</p>
                    <p style={{ fontSize: 11, color: "#8a8a8a", marginTop: 4 }}>{m.sub}</p>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
              {(["products", "strategy", "chart"] as ActiveTab[]).map(function(t) {
                const labels: Record<ActiveTab, string> = { products: "📦 상품 목록", strategy: "🎯 전략 분석", chart: "📊 가격 분포" };
                const isActive = activeTab === t;
                return (
                  <button
                    key={t}
                    onClick={function() { setActiveTab(t); }}
                    style={{ padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: isActive ? "1px solid rgba(239,68,68,0.4)" : "1px solid rgba(255,255,255,0.06)", background: isActive ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.04)", color: isActive ? "#f87171" : "#b3b3b3", cursor: "pointer" }}
                  >
                    {labels[t]}
                  </button>
                );
              })}
            </div>

            {activeTab === "products" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {results.products.map(function(p, i) {
                  const rank = p.salesRank != null ? p.salesRank : i + 1;
                  const estSales = estimateMonthlySales(rank, p.productPrice);
                  const estRevenue = estSales * p.productPrice;
                  const isTop3 = i < 3;
                  return (
                    <div key={p.productId} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "16px", display: "grid", gridTemplateColumns: "32px 1fr auto", gap: 16, alignItems: "center" }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, background: isTop3 ? "linear-gradient(135deg,#dc2626,#f87171)" : "rgba(255,255,255,0.06)", color: isTop3 ? "#fff" : "#a3a3a3" }}>
                        {i + 1}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                          <p style={{ fontSize: 14, fontWeight: 500, color: "#f5f5f5", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.productName}</p>
                          <a href={p.productUrl} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "rgba(16,185,129,0.15)", color: "#34d399", border: "1px solid rgba(16,185,129,0.3)", textDecoration: "none", whiteSpace: "nowrap" }}>
                            바로가기
                          </a>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                          {p.isRocket && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}>🚀 로켓</span>
                          )}
                          <span style={{ fontSize: 12, color: "#8a8a8a" }}>추정 {estSales.toLocaleString()}개/월</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <p style={{ fontSize: 18, fontWeight: 900, color: "#34d399", margin: 0 }}>{p.productPrice.toLocaleString()}원</p>
                        <p style={{ fontSize: 11, color: "#8a8a8a", marginTop: 4 }}>월매출 약 {Math.round(estRevenue / 10000).toLocaleString()}만원</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === "strategy" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {deriveStrategies(results.products).map(function(s) {
                    return (
                      <div key={s.title} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderLeft: "3px solid " + s.color, borderRadius: 12, padding: 20 }}>
                        <div style={{ fontSize: 24, marginBottom: 8 }}>{s.icon}</div>
                        <p style={{ fontSize: 13, fontWeight: 700, color: s.color, marginBottom: 8 }}>{s.title}</p>
                        <p style={{ fontSize: 12, color: "#c3c3c3", lineHeight: 1.6 }}>{s.desc}</p>
                      </div>
                    );
                  })}
                </div>
                <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 12, padding: 20 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa", marginBottom: 16 }}>📋 권장 진입 체크리스트</p>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                    {buildChecklist(results.products).map(function(item, idx) {
                      return (
                        <li key={idx} style={{ display: "flex", gap: 12, fontSize: 12, color: "#c3c3c3", lineHeight: 1.6 }}>
                          <span style={{ color: "#3b82f6", fontWeight: 700, flexShrink: 0 }}>·</span>{item}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}

            {activeTab === "chart" && (
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 24 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: "#a3a3a3", marginBottom: 24, textTransform: "uppercase", letterSpacing: 1 }}>상품별 가격 분포 (순위 기준)</p>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 192 }}>
                  {results.products.map(function(p, i) {
                    const maxPrice = priceRange ? priceRange.max : 1;
                    const barH = Math.max(12, (p.productPrice / maxPrice) * 160);
                    const isTop3 = i < 3;
                    return (
                      <div key={p.productId} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 10, color: "#8a8a8a" }}>{Math.round(p.productPrice / 1000)}K</span>
                        <div style={{ width: "100%", height: barH, borderRadius: "4px 4px 0 0", background: isTop3 ? "linear-gradient(to top, #7f1d1d, #f87171)" : "rgba(255,255,255,0.08)", position: "relative" }}>
                          {p.isRocket && <span style={{ position: "absolute", top: -16, left: "50%", transform: "translateX(-50%)", fontSize: 10 }}>🚀</span>}
                        </div>
                        <span style={{ fontSize: 10, color: "#8a8a8a" }}>{i + 1}위</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 20, display: "flex", gap: 16, fontSize: 12, color: "#8a8a8a" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 2, background: "#ef4444", display: "inline-block" }}></span>Top 3
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 2, background: "rgba(255,255,255,0.2)", display: "inline-block" }}></span>일반 상품
                  </span>
                  <span>🚀 로켓배송</span>
                </div>
              </div>
            )}
          </div>
        )}

        {!results && !loading && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#8a8a8a" }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🔍</div>
            <p style={{ fontSize: 14, marginBottom: 4 }}>키워드를 입력해서 시장을 분석해보세요</p>
            <p style={{ fontSize: 12, color: "#6b6b6b" }}>무선이어폰, 캠핑의자, 프로틴 쉐이커 등</p>
          </div>
        )}
      </div>
    </div>
  );
}
