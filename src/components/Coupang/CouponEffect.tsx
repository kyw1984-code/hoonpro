/**
 * 쿠폰 효과 비교 — 어느 쿠폰 금액이 실제로 남았나.
 *
 * 쿠폰 금액을 12,000 → 13,000 → 21,000 → 11,500으로 바꿔 가며 판 것은
 * 그 자체로 실험이다. 그런데 결과가 어디에도 안 남아서, 다음 쿠폰은 결국
 * 느낌으로 정하게 된다. 쿠폰이 걸려 있던 기간을 구간으로 놓고 나란히 세운다.
 *
 * 구간 길이가 제각각이라(3일 vs 20일) 총액을 그냥 비교하면 오래 걸어 둔
 * 쿠폰이 무조건 이긴다. 판단은 하루 평균 순이익으로 한다.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Ticket, Trophy } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { won } from '../../lib/coupang';

interface Segment {
  couponId: string;
  name: string;
  discount: number;
  type: string;
  start: string;
  end: string;
  days: number;
  quantity: number;
  salesAmount: number;
  profit: number;
  couponDiscount: number;
  perDayQuantity: number;
  perDayProfit: number;
  profitPerUnit: number;
  marginRate: number;
  overlapped: boolean;
}

interface Data {
  from: string;
  to: string;
  segments: Segment[];
  best: { couponId: string; name: string; discount: number } | null;
  reason?: string;
  note?: string | null;
  truncated?: boolean;
}

const auth = () => ({ Authorization: `Bearer ${getToken()}` });
const short = (d: string) => d.slice(5).replace('-', '/');

export function CouponEffect({ days = 90 }: { days?: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 30일에서 90일로 빠르게 바꾸면 요청이 두 번 나가고, 늦게 온 쪽이 마지막에
  // 도착한다. 그러면 90일 버튼이 눌린 채로 표에는 30일 숫자가 남는다. 오류도
  // 안 나고 되돌릴 방법도 없다. 순번이 뒤처진 응답은 버린다.
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setData(null);
    setError(null);
    fetch(`/api/coupang?action=coupon-effect&days=${days}`, { headers: auth() })
      .then(async r => {
        const d = await r.json();
        if (mine !== seq.current) return;
        if (!r.ok) throw new Error(d?.error || '쿠폰 성과를 불러오지 못했습니다.');
        setData(d);
      })
      .catch(e => { if (mine === seq.current) setError(e?.message ?? '쿠폰 성과를 불러오지 못했습니다.'); });
  }, [days]);

  if (error) {
    return (
      <div className="rounded-panel border border-line bg-paper px-5 py-4 text-[12.5px] text-ink-2">
        쿠폰 효과 비교: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-panel border border-line bg-paper px-5 py-4 text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-[13px]">쿠폰 구간별로 계산하는 중...</span>
      </div>
    );
  }

  if (data.segments.length === 0) {
    return (
      <div className="rounded-panel border border-line bg-paper px-5 py-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Ticket className="h-4 w-4 text-ink-3" /> 쿠폰 효과 비교
        </h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{data.reason}</p>
      </div>
    );
  }

  // 막대 길이의 기준. 하루 평균 순이익이 음수인 구간도 있어 절댓값으로 잡는다.
  const maxPerDay = Math.max(1, ...data.segments.map(s => Math.abs(s.perDayProfit)));

  return (
    <div className="rounded-panel border border-line bg-paper px-5 py-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Ticket className="h-4 w-4 text-accent" /> 쿠폰 효과 비교
      </h3>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
        쿠폰이 걸려 있던 기간을 구간으로 나눠 비교합니다. 구간 길이가 달라서
        <b className="text-ink"> 하루 평균 순이익</b>으로 견줍니다.
      </p>

      {data.best && (
        <div className="mt-3 flex items-start gap-2 rounded-control bg-accent-soft px-3.5 py-2.5">
          <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p className="text-[13px] leading-relaxed text-ink">
            가장 남은 쿠폰은 <b className="text-accent">{won(data.best.discount)}</b>짜리
            &quot;{data.best.name}&quot;입니다.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {data.segments.map(s => {
          const isBest = data.best?.couponId === s.couponId;
          const width = Math.round((Math.abs(s.perDayProfit) / maxPerDay) * 100);
          return (
            <div
              key={s.couponId}
              className={`rounded-card border px-3.5 py-3 ${isBest ? 'border-accent/50 bg-accent-soft/30' : 'border-line bg-paper-2'}`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[13px] font-semibold text-ink">
                  {s.discount > 0 ? won(s.discount) : s.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3" title={s.name}>
                  {s.discount > 0 && s.name}
                </span>
                <span className="shrink-0 text-[11.5px] tabular-nums text-ink-3">
                  {short(s.start)}~{short(s.end)} · {s.days}일
                </span>
              </div>

              {s.quantity === 0 ? (
                <p className="mt-1.5 text-[12px] text-ink-3">이 기간에 팔린 수량이 없어 비교할 수 없습니다.</p>
              ) : (
                <>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-paper">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${width}%`, background: s.perDayProfit >= 0 ? '#22a3b8' : '#ff8a8a' }}
                      />
                    </div>
                    <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-ink">
                      하루 {won(s.perDayProfit)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] tabular-nums text-ink-3">
                    {s.quantity.toLocaleString('ko-KR')}개 · 하루 {s.perDayQuantity.toFixed(1)}개 ·
                    개당 {won(s.profitPerUnit)} · 이익률 {s.marginRate.toFixed(1)}%
                  </p>
                </>
              )}

              {s.overlapped && (
                <p className="mt-1.5 text-[11px] text-caution">
                  다른 쿠폰과 기간이 겹쳐 이 구간의 실적은 그 쿠폰의 것이기도 합니다. 순위에서 제외했습니다.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {data.note && <p className="mt-2.5 text-[11.5px] text-ink-3">{data.note}</p>}

      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-3">
        순이익은 수수료·원가·반품까지 뺀 값입니다. 쿠폰 말고도 광고비나 시즌이 함께 움직였다면
        그 영향도 이 숫자에 섞여 있습니다.
        {data.truncated && ' 쿠폰이 많아 최근 6개 구간만 비교했습니다.'}
      </p>
    </div>
  );
}
