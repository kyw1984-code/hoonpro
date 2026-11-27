/**
 * 소싱AI 상품 목록 — 표 보기.
 *
 * 카드는 한 상품을 자세히 읽기 좋지만, 클릭수·판매량·매출을 여러 상품에 걸쳐
 * 견주기에는 표가 낫다. 한 줄에 한 상품, 숫자는 오른쪽 정렬로 세로로 훑게 한다.
 * 열 머리를 누르면 그 숫자로 정렬된다.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Star } from 'lucide-react';
import { conversionRate } from '../../lib/wingStats';
import type { WingStat } from './WingStats';

interface Row {
  productId: string; productName: string; productPrice: number; productUrl: string; productImage: string;
  rating: number; reviewCount: number; deliveryType: 'rocket' | 'jet' | 'general'; rank: number;
  calculated: { opportunityScore: number; grade: string };
}
type SortKey = 'default' | 'price' | 'reviews' | 'pv' | 'sales' | 'cvr' | 'revenue';

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
    const va = value(a, sort.key), vb = value(b, sort.key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return sort.desc ? vb - va : va - vb;
  });

  const th = (label: string, key: SortKey) => (
    <th className="px-3 py-3 text-right font-semibold">
      <button
        onClick={() => setSort(s => (s.key === key ? (s.desc ? { key, desc: false } : { key: 'default', desc: true }) : { key, desc: true }))}
        className={`inline-flex items-center gap-0.5 hover:text-ink ${sort.key === key ? 'text-accent' : ''}`}
        title="누르면 이 숫자로 정렬합니다"
      >
        {label}
        {sort.key === key && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );
  const num = (v: number | null | undefined, suffix = '') => (v == null ? <span className="text-ink-3">—</span> : <>{v.toLocaleString()}{suffix}</>);

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-paper">
      <table className="w-full min-w-[980px] text-[12.5px]">
        <thead className="bg-paper-2 text-[11.5px] text-ink-3">
          <tr>
            <th className="w-14 px-3 py-3 text-left font-semibold">이미지</th>
            <th className="px-3 py-3 text-left font-semibold">상품명</th>
            {th('가격', 'price')}
            {th('리뷰수', 'reviews')}
            <th className="px-3 py-3 text-center font-semibold">배송방법</th>
            {th('클릭수', 'pv')}
            {th('월 판매량', 'sales')}
            {th('전환율', 'cvr')}
            {th('월 매출', 'revenue')}
            <th className="w-[168px] px-3 py-3 text-center font-semibold">분석/마진</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const s = stats[p.productId];
            const cvr = s ? conversionRate(s.pv28, s.sales28) : null;
            const d = DELIVERY[p.deliveryType];
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
                  <p className="mt-0.5 text-[10.5px] text-ink-3">노출 {p.rank}위 · 기회지수 {p.calculated.opportunityScore}</p>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-ink">{p.productPrice.toLocaleString()}원</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-2">
                  {p.reviewCount.toLocaleString()}
                  {p.rating > 0 && <span className="ml-1 inline-flex items-center text-caution"><Star className="h-3 w-3 fill-current" />{p.rating}</span>}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${d.cls}`}>{d.label}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink">{num(s?.pv28)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-ink">{num(s?.sales28)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-2">{num(cvr, '%')}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink">{num(s?.sales28 != null ? s.sales28 * p.productPrice : null, '원')}</td>
                <td className="px-3 py-2.5">
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => onCalc(p)} className="rounded-control bg-accent px-2 py-1.5 text-[11px] font-semibold text-black hover:opacity-90">마진 분석</button>
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
