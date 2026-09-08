/**
 * 시장 변화 — 지난번 수집 대비 이 키워드에서 무엇이 달라졌나.
 *
 * 같은 키워드를 다시 볼 때 눈으로 비교하기는 어렵다. 가격을 내린 경쟁 상품과
 * 새로 들어온 상품은 지금 시장에서 벌어지는 일을 그대로 보여주는 신호인데,
 * 관측 기록은 이미 쌓고 있었고 화면에만 없었다.
 *
 * 새 경쟁자를 늦게 아는 게 가장 비싸다. 가격을 내리고 순위가 오른 상품은
 * 그 자체로 "지금 이 시장에서 통하는 수"를 알려준다.
 */
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Megaphone, Sparkles, TrendingDown } from 'lucide-react';
import { getToken } from '../../lib/auth';

interface PriceChange {
  productId: string;
  productName: string;
  priceFrom: number;
  priceTo: number;
  changePct: number;
  rankFrom: number | null;
  rankTo: number | null;
}
interface Newcomer {
  productId: string;
  productName: string;
  rank: number | null;
  price: number;
  reviewCount: number;
  isAd: boolean;
}
interface Surging {
  productId: string;
  productName: string;
  reviewsAdded: number;
  perDay: number;
  rankFrom: number | null;
  rankTo: number | null;
  isAd: boolean;
  adSuspect: boolean;
}
interface Changes {
  keyword: string;
  from?: string;
  to?: string;
  days: number;
  hint?: string;
  priceChanges: PriceChange[];
  newcomers: Newcomer[];
  surging: Surging[];
  gone: Array<{ productId: string; productName: string; rank: number | null }>;
}

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

export function MarketChanges({ keyword }: { keyword: string }) {
  const [data, setData] = useState<Changes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!keyword) return;
    setData(null);
    setError(null);
    fetch(`/api/sourcing?type=rank&action=changes&keyword=${encodeURIComponent(keyword)}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || '시장 변화를 불러오지 못했습니다.');
        setData(d);
      })
      .catch(e => setError(e?.message ?? '시장 변화를 불러오지 못했습니다.'));
  }, [keyword]);

  if (error) return null;   // 부가 정보다. 실패했다고 분석 화면을 어지럽히지 않는다
  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-card border border-line bg-paper-2 p-4 text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-[12.5px]">지난 수집과 비교하는 중...</span>
      </div>
    );
  }

  // 관측이 하루뿐이면 비교할 대상이 없다. 없는 걸 지어내는 대신 언제 생기는지 말한다.
  if (data.hint === 'one-day') {
    return (
      <div className="rounded-card border border-line bg-paper-2 p-4">
        <h4 className="text-[13px] font-semibold text-ink">시장 변화</h4>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
          이 키워드는 아직 한 번만 수집됐습니다. 다시 분석하면 그때부터 가격을 내린 경쟁 상품과
          새로 들어온 상품을 짚어 드립니다.
        </p>
      </div>
    );
  }

  const drops = data.priceChanges.filter(c => c.changePct < 0);
  const rises = data.priceChanges.filter(c => c.changePct > 0);
  const surging = data.surging ?? [];
  const nothing = drops.length === 0 && rises.length === 0 && data.newcomers.length === 0 && surging.length === 0;

  return (
    <div className="rounded-card border border-line bg-paper-2 p-4">
      <h4 className="text-[13px] font-semibold text-ink">
        시장 변화 <span className="font-normal text-ink-3">{data.from} → {data.to}</span>
      </h4>

      {nothing ? (
        <p className="mt-1.5 text-[12px] text-ink-2">지난 수집 이후 가격이나 구성이 크게 달라지지 않았습니다.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {drops.length > 0 && (
            <section>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-critical">
                <TrendingDown className="h-3.5 w-3.5" /> 가격을 내린 경쟁 상품 {drops.length}개
              </p>
              <div className="flex flex-col gap-1.5">
                {drops.slice(0, 5).map(c => (
                  <ChangeRow key={c.productId} c={c} />
                ))}
              </div>
            </section>
          )}

          {data.newcomers.length > 0 && (
            <section>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-accent">
                <Sparkles className="h-3.5 w-3.5" /> 새로 들어온 상품 {data.newcomers.length}개
              </p>
              <div className="flex flex-col gap-1.5">
                {data.newcomers.slice(0, 5).map(n => (
                  <div key={n.productId} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                    <span className="min-w-0 flex-1 truncate text-ink-2" title={n.productName}>{n.productName}</span>
                    <span className="shrink-0 tabular-nums text-ink-3">
                      {n.rank !== null && `${n.rank}위 · `}{won(n.price)}
                      {n.isAd && <span className="ml-1 text-caution">광고</span>}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {surging.length > 0 && (
            <section>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-caution">
                <Megaphone className="h-3.5 w-3.5" /> 판매가 빨리 느는 상품 {surging.length}개
              </p>
              <div className="flex flex-col gap-1.5">
                {surging.slice(0, 5).map(v => (
                  <div key={v.productId} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                    <span className="min-w-0 flex-1 truncate text-ink-2" title={v.productName}>{v.productName}</span>
                    <span className="shrink-0 tabular-nums text-ink-3">리뷰 +{v.perDay}/일</span>
                    {v.adSuspect && (
                      <span className="shrink-0 text-caution" title="자연 순위는 그대로인데 판매가 늘고 있습니다">
                        광고로 미는 중
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
                리뷰 증가는 판매속도에 가깝습니다. 자연 순위가 그대로인데 리뷰가 빨리 늘면 그 판매는 광고에서 온 것입니다.
              </p>
            </section>
          )}

          {rises.length > 0 && (
            <section>
              <p className="mb-1.5 text-[11.5px] font-semibold text-ink-2">가격을 올린 상품 {rises.length}개</p>
              <div className="flex flex-col gap-1.5">
                {rises.slice(0, 3).map(c => (
                  <ChangeRow key={c.productId} c={c} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-3">
        이 키워드를 분석할 때마다 상위 상품을 기록해 두고 비교합니다. 자주 볼수록 촘촘해집니다.
      </p>
    </div>
  );
}

function ChangeRow({ c }: { c: PriceChange }) {
  const down = c.changePct < 0;
  // 가격을 내리고 순위가 올랐으면 그 수가 통했다는 뜻이다. 그걸 눈에 띄게 한다.
  const rankUp = c.rankFrom !== null && c.rankTo !== null && c.rankTo < c.rankFrom;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
      <span className="min-w-0 flex-1 truncate text-ink-2" title={c.productName}>{c.productName}</span>
      <span className="shrink-0 tabular-nums text-ink-3">
        {won(c.priceFrom)} → <b className={down ? 'text-critical' : 'text-ink-2'}>{won(c.priceTo)}</b>
        <span className={down ? 'ml-1 text-critical' : 'ml-1 text-ink-3'}>
          {down ? '' : '+'}{c.changePct}%
        </span>
      </span>
      {c.rankFrom !== null && c.rankTo !== null && (
        <span className={`shrink-0 inline-flex items-center gap-0.5 tabular-nums ${rankUp ? 'text-positive' : 'text-ink-3'}`}>
          {rankUp ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {c.rankFrom}→{c.rankTo}위
        </span>
      )}
    </div>
  );
}
