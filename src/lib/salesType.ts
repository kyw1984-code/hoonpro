/**
 * 판매 유형 추정 — 이 상품이 광고로 팔리는지, 자연 노출로 팔리는지.
 *
 * 경쟁 상품의 광고 판매 수량은 그 판매자만 볼 수 있다. 우리가 아는 건 검색
 * 화면에서 광고 자리로 나왔는지와, 광고를 뺀 자연 순위뿐이다. 그래서 이건
 * 비중(%)이 아니라 '어떻게 노출되고 있는가'로 가른 추정이다. 화면에도 늘
 * 추정이라고 밝힌다.
 */
export type SalesType = 'organic' | 'mixed' | 'ad';

/** 자연 순위가 이 안이면 광고 없이도 보이는 자리로 본다 (쿠팡 검색 첫 화면 남짓) */
const ORGANIC_VISIBLE_RANK = 20;

export function salesTypeOf(p: { isAd: boolean; organicRank?: number | null }): SalesType {
  if (!p.isAd) return 'organic';
  if (p.organicRank != null && p.organicRank <= ORGANIC_VISIBLE_RANK) return 'mixed';
  return 'ad';
}

export const SALES_TYPE: Record<SalesType, { label: string; cls: string; bar: string; hint: string; order: number }> = {
  organic: { label: '자연 판매형', cls: 'bg-positive-soft text-positive', bar: 'bg-positive', order: 0,
    hint: '광고 자리 없이 자연 순위로 노출되고 있습니다 (추정)' },
  mixed: { label: '혼합형', cls: 'bg-caution-soft text-caution', bar: 'bg-caution', order: 1,
    hint: `광고 자리에도 나오고 자연 순위도 ${ORGANIC_VISIBLE_RANK}위 안입니다 (추정)` },
  ad: { label: '광고 의존형', cls: 'bg-critical-soft text-critical', bar: 'bg-critical', order: 2,
    hint: `광고 자리로 노출되고 자연 순위는 ${ORGANIC_VISIBLE_RANK}위 밖이거나 없습니다 (추정)` },
};

/**
 * 시장 전체의 유형별 비중. 판매량을 아는 상품이 절반 이상이면 판매량으로,
 * 아니면 상품 수로 센다 — 어느 쪽으로 셌는지 함께 돌려준다.
 */
export function salesTypeMix<T extends { productId: string; isAd: boolean; organicRank?: number | null }>(
  products: T[], sales: (p: T) => number | null | undefined,
): { basis: 'sales' | 'count'; total: number; share: Record<SalesType, number> } | null {
  if (products.length === 0) return null;
  const known = products.filter(p => sales(p) != null);
  const totalSales = known.reduce((a, p) => a + (sales(p) || 0), 0);
  const bySales = known.length * 2 >= products.length && totalSales > 0;
  const sum: Record<SalesType, number> = { organic: 0, mixed: 0, ad: 0 };
  for (const p of bySales ? known : products) sum[salesTypeOf(p)] += bySales ? (sales(p) || 0) : 1;
  const total = bySales ? totalSales : products.length;
  const share = {
    organic: Math.round((sum.organic / total) * 100),
    mixed: Math.round((sum.mixed / total) * 100),
    ad: 0,
  };
  share.ad = Math.max(0, 100 - share.organic - share.mixed);
  return { basis: bySales ? 'sales' : 'count', total: bySales ? known.length : products.length, share };
}
