import type { CoupangProduct } from "../../types/coupang";
import { estimateMonthlySales } from "../../lib/coupang";

interface Props {
  products: CoupangProduct[];
}

function RatingBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-400 to-orange-400 rounded-full transition-all duration-700"
          style={{ width: `${(value / 5) * 100}%` }}
        />
      </div>
      <span className="text-xs text-neutral-500 min-w-[24px]">{value}</span>
    </div>
  );
}

export default function ProductList({ products }: Props) {
  return (
    <div className="flex flex-col gap-2">
      {products.map((p, i) => {
        const rank       = p.salesRank ?? i + 1;
        const estSales   = estimateMonthlySales(rank, p.reviewCount, p.productPrice);
        const estRevenue = estSales * p.productPrice;
        const isTop3     = i < 3;
        return (
          <div key={p.productId} className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-4
                     grid grid-cols-[32px_1fr_auto] gap-4 items-center hover:border-white/[0.15] transition">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-extrabold
              ${isTop3 ? "bg-gradient-to-br from-red-600 to-red-400 text-white" : "bg-white/[0.06] text-neutral-500"}`}>
              {i + 1}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium leading-snug mb-2 text-neutral-100 truncate">{p.productName}</p>
              <div className="flex flex-wrap items-center gap-2">
                {p.isRocket && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">
                    🚀 로켓
                  </span>
                )}
                <span className="text-xs text-neutral-500">⭐ {p.rating} ({p.reviewCount.toLocaleString()}개)</span>
                <span className="text-xs text-neutral-600">추정 {estSales.toLocaleString()}개/월</span>
              </div>
              <RatingBar value={p.rating} />
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
