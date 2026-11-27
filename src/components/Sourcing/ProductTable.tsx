/**
 * 소싱AI 상품 목록 — 표 보기.
 *
 * 카드는 한 상품을 자세히 읽기 좋지만, 클릭수·판매량·매출을 여러 상품에 걸쳐
 * 견주기에는 표가 낫다. 한 줄에 한 상품, 숫자는 오른쪽 정렬로 세로로 훑게 한다.
 * 열 머리를 누르면 그 숫자로 정렬된다.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Star } from 'lucide-react';
import { conversionRate } from '../../lib/wingStats';
import type { WingStat } from './WingStats';
import { SALES_TYPE, salesTypeOf } from '../../lib/salesType';

interface Row {
  productId: string; productName: string; productPrice: number; productUrl: string; productImage: string;
  rating: number; reviewCount: number; deliveryType: 'rocket' | 'jet' | 'general'; rank: number;
  isAd: boolean; organicRank?: number | null;
  calculated: { opportunityScore: number; grade: string };
}
type SortKey = 'default' | 'name' | 'price' | 'reviews' | 'delivery' | 'type' | 'pv' | 'sales' | 'cvr' | 'revenue';

/** 배송방법 정렬 순서 — 진입하기 쉬운 쪽(일반)을 위로 */
const DELIVERY_ORDER: Record<string, number> = { general: 0, jet: 1, rocket: 2 };

const DELIVERY: Record<Row['deliveryType'], { label: string; cls: string }> = {
  rocket: { label: '로켓배송', cls: 'bg-critical-soft text-critical' },
  jet: { label: '판매자로켓', cls: 'bg-caution-soft text-caution' },
  general: { label: '일반', cls: 'bg-paper-2 text-ink-2 border border-line' },
};

export function ProductTable<T extends Row>({
  products, stats, rankAdded, onReview, onRank, onSource, onCalc,
}: {
  products: T[];
  stats: Record<string, WingStat>;
  rankAdded: Record<string, boolean>;
  onReview: (p: T) => void;
  onRank: (p: T) => void;
  onSource: (p: T) => void;
  onCalc: (p: T) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'default', desc: true });

  const value = (p: T, key: SortKey): number | null => {
    const s = stats[p.productId];
    if (key === 'delivery') return DELIVERY_ORDER[p.deliveryType] ?? 9;
    if (key === 'type') return SALES_TYPE[salesTypeOf(p)].order;
    if (key === 'price') return p.productPrice;
    if (key === 'reviews') return p.reviewCount;
    if (key === 'pv') return s?.pv28 ?? null;
    if (key === 'sales') return s?.sales28 ?? null;
    if (key === 'cvr') return s ? conversionRate(s.pv28, s.sales28) : null;
    if (key === 'revenue') return s?.sales28 != null ? s.sales28 * p.productPrice : null;
    return null;
  };
  // 값이 없는 상품은 방향과 상관없이 늘 아래로 보낸다
  const rows = sort.key === 'default' ? products : [...products].sort((a, b) => {
    if (sort.key === 'name') return sort.desc ? b.productName.localeCompare(a.productName, 'ko') : a.productName.localeCompare(b.productName, 'ko');
    const va = value(a, sort.key), vb = value(b, sort.key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return sort.desc ? vb - va : va - vb;
  });

  // 정렬되는 열은 늘 ↕ 표시를 달아 누를 수 있다는 걸 보이게 한다.
  // 누를 때마다 높은순 → 낮은순 → 원래 순서 (상품명·배송방법은 가나다순·일반 먼저부터)
  const th = (label: string, key: SortKey, align: 'left' | 'right' | 'center' = 'right', firstAsc = false) => {
    const active = sort.key === key;
    const next = () => setSort(s => {
      if (s.key !== key) return { key, desc: !firstAsc };
      if (s.desc === !firstAsc) return { key, desc: firstAsc };
      return { key: 'default', desc: true };
    });
    return (
      <th className={`whitespace-nowrap px-3 py-3 font-semibold ${align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right'}`}>
        <button onClick={next} title="누르면 정렬합니다"
          className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-ink ${active ? 'text-accent' : ''}`}>
          {label}
          {active ? (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-50" />}
        </button>
      </th>
    );
  };
  const num = (v: number | null | undefined, suffix = '') => (v == null ? <span className="text-ink-3">—</span> : <>{v.toLocaleString()}{suffix}</>);

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-paper">
      <table className="w-full min-w-[1080px] text-[12.5px]">
        <thead className="bg-paper-2 text-[11.5px] text-ink-3">
          <tr>
            <th className="w-16 whitespace-nowrap px-3 py-3 text-left font-semibold">이미지</th>
            {th('상품명', 'name', 'left', true)}
            {th('가격', 'price')}
            {th('리뷰수', 'reviews')}
            {th('배송방법', 'delivery', 'center', true)}
            {th('판매 유형(추정)', 'type', 'center', true)}
            {th('클릭수', 'pv')}
            {th('월 판매량', 'sales')}
            {th('전환율', 'cvr')}
            {th('월 매출', 'revenue')}
            <th className="w-[168px] whitespace-nowrap px-3 py-3 text-center font-semibold">분석/마진</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const s = stats[p.productId];
            const cvr = s ? conversionRate(s.pv28, s.sales28) : null;
            const d = DELIVERY[p.deliveryType];
            const st = SALES_TYPE[salesTypeOf(p)];
            return (
              <tr key={p.productId} className="border-t border-line align-middle hover:bg-paper-2/60">
                <td className="px-3 py-2.5">
                  <a href={p.productUrl} target="_blank" rel="noopener noreferrer">
                    <img src={p.productImage} alt="" loading="lazy" className="h-12 w-12 rounded-control border border-line bg-white object-cover" />
                  </a>
                </td>
                <td className="max-w-[320px] px-3 py-2.5">
                  <a href={p.productUrl} target="_blank" rel="noopener noreferrer" title={p.productName} className="line-clamp-2 font-medium leading-snug text-ink hover:text-accent">
                    {p.productName}
                  </a>
                  <p className="mt-0.5 text-[10.5px] text-ink-3">{p.isAd ? `광고 ${p.rank}위${p.organicRank ? ` · 자연 ${p.organicRank}위` : ''}` : `노출 ${p.rank}위`} · 기회지수 {p.calculated.opportunityScore}</p>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-ink">{p.productPrice.toLocaleString()}원</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-2">
                  {p.reviewCount.toLocaleString()}
                  {p.rating > 0 && <span className="ml-1 inline-flex items-center text-caution"><Star className="h-3 w-3 fill-current" />{p.rating}</span>}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${d.cls}`}>{d.label}</span>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span title={st.hint} className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${st.cls}`}>{st.label}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink">{num(s?.pv28)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-accent">{num(s?.sales28)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-2">{num(cvr, '%')}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-positive">{num(s?.sales28 != null ? s.sales28 * p.productPrice : null, '원')}</td>
                <td className="px-3 py-2.5">
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => onCalc(p)} className="rounded-control bg-accent px-2 py-1.5 text-[11px] font-semibold text-white hover:opacity-90">마진 분석</button>
                    <button onClick={() => onReview(p)} className="rounded-control border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-2 hover:border-line-strong hover:text-ink">리뷰 분석</button>
                    <button onClick={() => onSource(p)} className="rounded-control border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-2 hover:border-line-strong hover:text-ink">1688</button>
                    <button onClick={() => onRank(p)} disabled={rankAdded[p.productId]} className="rounded-control border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50">
                      {rankAdded[p.productId] ? '✓ 추적 중' : '순위 추적'}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
