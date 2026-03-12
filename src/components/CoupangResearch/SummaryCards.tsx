import type { CoupangProduct, SummaryMetric } from "../../types/coupang";
import { getPriceRange } from "../../lib/coupang";

interface Props {
  products: CoupangProduct[];
}

export default function SummaryCards({ products }: Props) {
  const priceRange  = getPriceRange(products);
  const rocketCount = products.filter((p) => p.isRocket).length;
  const topAvgReviews = Math.round(
    products.slice(0, 5).reduce((a, p) => a + p.reviewCount, 0) / 5
  );

  const metrics: SummaryMetric[] = [
    { label: "검색 상품 수", value: `${products.length}개`, sub: "조회된 상품", color: "text-blue-400" },
    { label: "평균 가격", value: `${priceRange.avg.toLocaleString()}원`, sub: `${priceRange.min.toLocaleString()} ~ ${priceRange.max.toLocaleString()}`, color: "text-emerald-400" },
    { label: "로켓배송 비율", value: `${Math.round((rocketCount / products.length) * 100)}%`, sub: `${rocketCount}/${products.length}개`, color: "text-red-400" },
    { label: "상위 평균 리뷰", value: topAvgReviews.toLocaleString() + "개", sub: "Top 5 기준", color: "text-amber-400" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {metrics.map((m) => (
        <div key={m.label} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
          <p className="text-xs font-semibold text-neutral-500 mb-2">{m.label}</p>
          <p className={`text-2xl font-extrabold tracking-tight ${m.color}`}>{m.value}</p>
          <p className="text-xs text-neutral-600 mt-1">{m.sub}</p>
        </div>
      ))}
    </div>
  );
}
