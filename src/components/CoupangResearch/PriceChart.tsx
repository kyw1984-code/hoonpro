import type { CoupangProduct } from "../../types/coupang";
import { getPriceRange } from "../../lib/coupang";

interface Props {
  products: CoupangProduct[];
}

export default function PriceChart({ products }: Props) {
  const { max } = getPriceRange(products);

  return (
    <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-6">
      <p className="text-xs font-semibold text-neutral-500 mb-6 uppercase tracking-wide">
        상품별 가격 분포 (순위 기준)
      </p>
      <div className="flex items-end gap-2 h-48">
        {products.map((p, i) => {
          const barH   = Math.max(12, (p.productPrice / max) * 160);
          const isTop3 = i < 3;
          return (
            <div key={p.productId} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] text-neutral-600">{Math.round(p.productPrice / 1000)}K</span>
              <div className="w-full relative" style={{ height: barH }}>
                <div className={`w-full h-full rounded-t-md transition-all duration-500
                  ${isTop3 ? "bg-gradient-to-t from-red-700 to-red-400" : "bg-white/[0.08]"}`} />
                {p.isRocket && (
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px]">🚀</span>
                )}
              </div>
              <span className="text-[10px] text-neutral-600">{i + 1}위</span>
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex gap-4 text-xs text-neutral-600">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-red-500 inline-block" />Top 3
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-white/20 inline-block" />일반 상품
        </span>
        <span>🚀 로켓배송</span>
      </div>
    </div>
  );
}
