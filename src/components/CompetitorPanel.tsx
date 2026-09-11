/**
 * 키워드 경쟁 분석 — "내 위에 누가 있나".
 *
 * 순위 추적은 "내가 몇 위인지"까지만 답한다. 순위를 올리려면 그다음 질문에
 * 답해야 한다 — 위에 있는 상품들은 얼마에 팔고, 리뷰가 몇 개이고, 로켓인가.
 * 검색 결과 60개를 순위 수집 때 이미 파싱하고 있어서 추가 수집 비용은 없다.
 *
 * 요약은 광고를 뺀 오가닉 상위 10개를 기준으로 낸다. 광고 자리는 돈으로 산
 * 자리라 "저기 가려면 무엇이 필요한가"의 답이 되지 못한다.
 */
import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { getToken } from '../lib/auth';
import { won } from '../lib/coupang';

interface Competitor {
  productId: string;
  productName: string;
  rank: number;
  isAd: boolean;
  price: number;
  reviewCount: number;
  rating: number | null;
  deliveryType: string;
  isMine: boolean;
}

interface Summary {
  topCount: number;
  medianPrice: number | null;
  medianReviews: number | null;
  rocketShare: number | null;
  adCount: number;
  pageCount: number;
  me: { rank: number; price: number; reviewCount: number; isAd: boolean; deliveryType: string } | null;
}

const DELIVERY_LABEL: Record<string, string> = {
  rocket: '로켓배송',
  jet: '판매자로켓',
  general: '일반',
};


/** 중앙값 대비 몇 % 비싼지/싼지. 중앙값이 없으면 비교할 대상이 없다. */
function gapText(mine: number, median: number | null): string | null {
  if (!median || !mine) return null;
  const diff = Math.round(((mine - median) / median) * 100);
  if (Math.abs(diff) < 3) return '상위권과 비슷';
  return diff > 0 ? `상위권보다 ${diff}% 비쌉니다` : `상위권보다 ${Math.abs(diff)}% 쌉니다`;
}

export function CompetitorPanel({ keyword }: { keyword: string }) {
  const [data, setData] = useState<{ products: Competitor[]; summary: Summary | null; capturedAt: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const token = getToken();
        const res = await fetch(
          `/api/sourcing?type=rankwatch&action=competitors&keyword=${encodeURIComponent(keyword)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        const d = await res.json();
        if (!alive) return;
        if (!res.ok || d.error) setError(d.error || '불러오지 못했습니다.');
        else setData(d);
      } catch (e: any) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [keyword]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-[12px]">경쟁 상품을 불러오는 중...</span>
      </div>
    );
  }
  if (error) return <p className="py-4 text-[12px] text-critical">{error}</p>;

  if (!data || data.products.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-8 text-center text-ink-3">
        <Users className="h-8 w-8 opacity-20" />
        <p className="text-[12.5px] font-semibold">아직 이 키워드의 검색 결과가 없습니다</p>
        <p className="text-[11.5px] leading-relaxed">
          [지금 확인]을 누르거나 매일 새벽 자동 수집이 한 번 돌면
          <br />
          이 키워드의 경쟁 상품이 여기에 채워집니다.
        </p>
      </div>
    );
  }

  const s = data.summary;
  const priceGap = s?.me && s.medianPrice ? gapText(s.me.price, s.medianPrice) : null;

  return (
    <div className="flex flex-col gap-3">
      {s && (
        <div className="rounded-card border border-line bg-paper-2 p-3.5">
          <p className="text-[11.5px] leading-relaxed text-ink-2">
            광고를 뺀 <b className="text-ink">상위 {s.topCount}개</b>는 중앙값 기준
            {s.medianPrice !== null && <> 가격 <b className="text-ink">{won(s.medianPrice)}</b></>}
            {s.medianReviews !== null && <>, 리뷰 <b className="text-ink">{s.medianReviews.toLocaleString('ko-KR')}개</b></>}
            {s.rocketShare !== null && <>, 로켓 계열 <b className="text-ink">{s.rocketShare}%</b></>}
            입니다. 수집한 {s.pageCount}개 중 광고 상품은 {s.adCount}개입니다.
          </p>
          {s.me ? (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">
              내 상품은 <b className="text-ink">{s.me.rank}번째</b> 노출 · {won(s.me.price)} · 리뷰{' '}
              {s.me.reviewCount.toLocaleString('ko-KR')}개 · {DELIVERY_LABEL[s.me.deliveryType] ?? '일반'}
              {priceGap && <> — {priceGap}.</>}
              {s.medianReviews !== null && s.me.reviewCount < s.medianReviews / 2 && (
                <> 리뷰가 상위권 절반에 못 미칩니다 — 순위가 안 오르는 이유일 가능성이 큽니다.</>
              )}
            </p>
          ) : (
            <p className="mt-1.5 text-[11.5px] text-ink-3">
              내 추적 상품은 이 페이지(1페이지) 안에 없습니다.
            </p>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full min-w-[560px] text-[12px]">
          <thead>
            <tr className="border-b border-line text-[11px] text-ink-3">
              <th className="px-3 py-2 text-left font-medium">순서</th>
              <th className="px-3 py-2 text-left font-medium">상품</th>
              <th className="px-3 py-2 text-right font-medium">가격</th>
              <th className="px-3 py-2 text-right font-medium">리뷰</th>
              <th className="px-3 py-2 text-right font-medium">평점</th>
              <th className="px-3 py-2 text-left font-medium">배송</th>
            </tr>
          </thead>
          <tbody>
            {data.products.map(p => (
              <tr
                key={`${p.rank}-${p.productId}`}
                className={`border-b border-line/60 last:border-0 ${p.isMine ? 'bg-accent-soft' : ''}`}
              >
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink-2">
                  {p.rank}
                  {p.isAd && <span className="ml-1 rounded-control border border-line px-1 py-0.5 text-[9.5px] text-ink-3">광고</span>}
                </td>
                <td className="max-w-[280px] px-3 py-2">
                  <a
                    href={`https://www.coupang.com/vp/products/${p.productId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`block truncate hover:text-accent ${p.isMine ? 'font-semibold text-ink' : 'text-ink-2'}`}
                    title={p.productName}
                  >
                    {p.isMine && <span className="mr-1 text-accent">내 상품</span>}
                    {p.productName || `#${p.productId}`}
                  </a>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-2">{p.price ? won(p.price) : '-'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-3">{p.reviewCount.toLocaleString('ko-KR')}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-3">{p.rating ? p.rating.toFixed(1) : '-'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-ink-3">{DELIVERY_LABEL[p.deliveryType] ?? '일반'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.capturedAt && (
        <p className="text-[10.5px] text-ink-3">
          {new Date(data.capturedAt).toLocaleString('ko-KR')} 수집 기준입니다.
        </p>
      )}
    </div>
  );
}
