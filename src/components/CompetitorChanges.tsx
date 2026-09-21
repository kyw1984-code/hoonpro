/**
 * 경쟁 상품 가격·리뷰 변동 — 관심 키워드 전체를 7일 전과 견준다.
 *
 * 소싱AI의 '시장 변화'는 키워드 하나를 어제와 견준다. 여기서는 관심 키워드
 * 전부를 한 표에 놓고, 가격을 내린 경쟁사와 리뷰가 빨리 붙는 상품을 한눈에
 * 본다. 관측은 순위 추적 크론이 매일 하고 있어 외부 호출이 없다.
 * 기능이 숨김이면 서버가 403을 주고, 그때는 아무것도 그리지 않는다.
 */
import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Loader2, MessageSquare, TrendingUp } from 'lucide-react';
import { getToken } from '../lib/auth';

type Kind = 'price-down' | 'price-up' | 'review-surge' | 'rank-jump';
interface ChangeItem {
  kind: Kind; keyword: string; productId: string; productName: string; productUrl: string;
  priceFrom: number | null; priceTo: number | null; pricePct: number | null;
  reviewFrom: number | null; reviewTo: number | null; reviewDelta: number | null;
  rankFrom: number | null; rankTo: number | null;
}
interface Resp { days: number; from: string; to: string; keywords: number; items: ChangeItem[] }

const KIND: Record<Kind, { label: string; icon: typeof ArrowDownRight; tone: string }> = {
  'price-down': { label: '가격 인하', icon: ArrowDownRight, tone: 'border-critical/35 bg-critical-soft text-critical' },
  'price-up': { label: '가격 인상', icon: ArrowUpRight, tone: 'border-caution/35 bg-caution-soft text-caution' },
  'review-surge': { label: '리뷰 급증', icon: MessageSquare, tone: 'border-positive/35 bg-positive-soft text-positive' },
  'rank-jump': { label: '순위 급상승', icon: TrendingUp, tone: 'border-accent/35 bg-accent-soft text-ink' },
};
const ORDER: Kind[] = ['price-down', 'review-surge', 'rank-jump', 'price-up'];
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

export function CompetitorChanges() {
  const [data, setData] = useState<Resp | null | 'hidden'>(null);
  const [filter, setFilter] = useState<Kind | 'all'>('all');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/sourcing?type=competitor-changes&days=7', { headers: { Authorization: `Bearer ${getToken()}` } });
        if (res.status === 403) { setData('hidden'); return; }
        const json = await res.json();
        setData(res.ok && Array.isArray(json.items) ? json : 'hidden');
      } catch { setData('hidden'); }
    })();
  }, []);

  if (data === 'hidden') return null;
  const items = data ? data.items.filter(i => filter === 'all' || i.kind === filter) : [];
  const counts = ORDER.map(k => ({ k, n: data ? data.items.filter(i => i.kind === k).length : 0 }));

  return (
    <div className="rounded-panel border border-line bg-paper p-6">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <TrendingUp className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-ink">경쟁 상품 변동 — 최근 7일</h3>
        {data && <span className="text-[12px] text-ink-3">관심 키워드 {data.keywords}개 · {data.from} → {data.to}</span>}
      </div>
      <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2">
        관심 키워드(★ 저장·순위 추적)의 검색 결과에서 가격을 내린 상품, 리뷰가 빨리 붙는 상품, 순위가 뛴 상품을 7일 전과 견줘 모았습니다.
      </p>
      {data === null ? (
        <p className="flex items-center gap-2 py-4 text-[12px] text-ink-3"><Loader2 className="h-4 w-4 animate-spin" />불러오는 중...</p>
      ) : data.items.length === 0 ? (
        <p className="py-4 text-[13px] text-ink-2">아직 견줄 관측이 없습니다. 관심 키워드가 며칠 수집되면 여기 변동이 보입니다.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button onClick={() => setFilter('all')} className={`rounded-control border px-2.5 py-1 text-[12px] font-semibold ${filter === 'all' ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-2'}`}>전체 {data.items.length}</button>
            {counts.map(({ k, n }) => (
              <button key={k} onClick={() => setFilter(k)} disabled={n === 0} className={`rounded-control border px-2.5 py-1 text-[12px] font-medium disabled:opacity-40 ${filter === k ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-2'}`}>{KIND[k].label} {n}</button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            {items.slice(0, 40).map(it => {
              const meta = KIND[it.kind];
              const Icon = meta.icon;
              return (
                <a key={`${it.kind}:${it.keyword}:${it.productId}`} href={it.productUrl} target="_blank" rel="noopener noreferrer"
                  className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-paper-2 px-3 py-2 transition-colors hover:border-line-strong">
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-control border px-1.5 py-0.5 text-[11px] font-semibold ${meta.tone}`}><Icon className="h-3 w-3" />{meta.label}</span>
                  <span className="shrink-0 text-[12px] text-accent">"{it.keyword}"</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{it.productName}</span>
                  <span className="w-full text-[12px] tabular-nums text-ink-2 sm:w-auto sm:text-right">
                    {it.kind === 'price-down' || it.kind === 'price-up'
                      ? <>{it.priceFrom !== null && won(it.priceFrom)} → <b className="text-ink">{it.priceTo !== null && won(it.priceTo)}</b> ({it.pricePct !== null && it.pricePct > 0 ? '+' : ''}{it.pricePct}%)</>
                      : it.kind === 'review-surge'
                        ? <>리뷰 {it.reviewFrom} → <b className="text-ink">{it.reviewTo}</b> (+{it.reviewDelta})</>
                        : <>순위 {it.rankFrom ?? '60위 밖'} → <b className="text-ink">{it.rankTo}위</b></>}
                  </span>
                </a>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
