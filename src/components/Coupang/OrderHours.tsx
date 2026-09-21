/**
 * 주문 시간대·요일 패턴.
 *
 * "이 가게는 밤 9~11시에 40%가 팔린다"를 알면 광고 시간대와 쿠폰 시작 시각을
 * 거기에 맞출 수 있다. 수집 때 주문 시각(한국 시간)을 시간 단위로 묶어 둔 값
 * 이라 외부 호출이 없다. 값이 쌓이기 시작한 날부터만 보인다.
 */
import { Fragment, useEffect, useState } from 'react';
import { Clock3, Loader2 } from 'lucide-react';
import { coupangApi, won, type OrderHoursResponse } from '../../lib/coupang';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function OrderHours() {
  const [days, setDays] = useState(28);
  const [data, setData] = useState<OrderHoursResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const d = await coupangApi.orderHours(days);
        if (alive) { setData(d); setError(null); }
      } catch (e: any) {
        if (alive) setError(e?.message ?? String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [days]);

  const total = data ? data.byHour.reduce((a, h) => a + h.quantity, 0) : 0;
  const maxCell = data ? Math.max(1, ...data.grid.flat()) : 1;
  const maxHour = data ? Math.max(1, ...data.byHour.map(h => h.quantity)) : 1;
  const maxDay = data ? Math.max(1, ...data.byWeekday.map(d => d.quantity)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-panel border border-line bg-paper p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold text-ink"><Clock3 className="h-5 w-5 text-accent" />주문 시간대·요일 패턴</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
              손님이 언제 주문하는지 봅니다. 광고 시간대와 쿠폰 시작 시각을 여기에 맞추세요. 윙·로켓그로스 주문을 합친 값이며 한국 시간 기준입니다.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-control bg-paper-2 px-2 py-1.5">
            <span className="text-[12px] text-ink-3">최근</span>
            <select value={days} onChange={e => setDays(Number(e.target.value))} className="cursor-pointer bg-transparent text-[13px] font-medium text-ink outline-none">
              <option value={14}>14일</option><option value={28}>28일</option><option value={56}>56일</option><option value={90}>90일</option>
            </select>
          </div>
        </div>
        {error && <p className="mt-3 rounded-control border border-critical/40 bg-critical-soft px-3 py-2 text-[13px] text-ink">{error}</p>}
        {loading && !data && <p className="mt-4 flex items-center gap-2 text-[13px] text-ink-3"><Loader2 className="h-4 w-4 animate-spin" />불러오는 중...</p>}
        {data && total === 0 && (
          <p className="mt-4 rounded-card border border-line bg-paper-2 px-4 py-6 text-center text-[13.5px] text-ink-2">
            아직 시간대 자료가 없습니다. 다음 수집부터 쌓이기 시작하며, 며칠치가 모이면 여기 보입니다.
          </p>
        )}
      </div>

      {data && total > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-panel border border-line bg-paper p-5 lg:col-span-2">
              <h3 className="text-[14px] font-semibold text-ink">시간대별 주문 <span className="text-ink-3">{data.from} ~ {data.to} · {total.toLocaleString('ko-KR')}개</span></h3>
              <div className="mt-3 flex items-end gap-[3px]" style={{ height: 140 }}>
                {data.byHour.map(h => {
                  const pct = Math.round((h.quantity / Math.max(1, total)) * 100);
                  const top = data.peakHours.includes(h.hour);
                  return (
                    <div key={h.hour} className="group relative flex flex-1 flex-col items-center justify-end" title={`${h.hour}시: ${h.quantity}개 (${pct}%) · ${won(h.amount)}`}>
                      <div className="w-full rounded-t" style={{ height: `${Math.max(2, (h.quantity / maxHour) * 120)}px`, background: top ? '#7cf5ff' : '#455684' }} />
                      <span className="mt-1 text-[10px] tabular-nums text-ink-3">{h.hour}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[12.5px] text-ink-2">
                가장 많이 팔리는 시간대 <b className="text-ink">{data.peakHours.map(h => `${h}시`).join(', ')}</b> — 이 세 시간에 전체의 <b className="text-ink">{data.peakShare}%</b>가 주문됩니다.
              </p>
            </div>
            <div className="rounded-panel border border-line bg-paper p-5">
              <h3 className="text-[14px] font-semibold text-ink">요일별 주문</h3>
              <div className="mt-3 flex flex-col gap-1.5">
                {data.byWeekday.map(d => (
                  <div key={d.weekday} className="flex items-center gap-2">
                    <span className="w-4 text-[12px] font-semibold text-ink-2">{WEEKDAYS[d.weekday]}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-paper-2">
                      <div className="h-full rounded" style={{ width: `${(d.quantity / maxDay) * 100}%`, background: d.weekday === data.peakWeekday ? '#7cf5ff' : '#455684' }} />
                    </div>
                    <span className="w-14 text-right text-[12px] tabular-nums text-ink-2">{d.quantity.toLocaleString('ko-KR')}개</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-panel border border-line bg-paper p-5">
            <h3 className="text-[14px] font-semibold text-ink">요일 × 시간대</h3>
            <p className="mt-0.5 text-[12px] text-ink-3">진할수록 주문이 많습니다. 칸에 커서를 대면 개수가 보입니다.</p>
            <div className="mt-3 overflow-x-auto">
              <div className="grid min-w-[640px]" style={{ gridTemplateColumns: '28px repeat(24, minmax(0, 1fr))', gap: 2 }}>
                <span />
                {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center text-[10px] tabular-nums text-ink-3">{h}</span>)}
                {data.grid.map((row, wd) => (
                  <Fragment key={wd}>
                    <span className="text-[11px] font-semibold text-ink-2">{WEEKDAYS[wd]}</span>
                    {row.map((q, h) => (
                      <div key={`${wd}-${h}`} title={`${WEEKDAYS[wd]}요일 ${h}시: ${q}개`} className="h-5 rounded-sm" style={{ background: q > 0 ? `rgba(124,245,255,${0.12 + (q / maxCell) * 0.78})` : 'var(--color-paper-2)' }} />
                    ))}
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
