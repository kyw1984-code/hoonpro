/**
 * 월별 순이익 리포트.
 *
 * 순이익 화면은 기간을 골라 보는 곳이라 '지난달보다 나아졌나'에 답하지 못한다.
 * 정산서 대조도 월 단위라 두 화면이 같은 눈금을 쓴다.
 *
 * 숫자를 늘어놓는 것만으로는 부족해서, 순이익이 움직인 가장 큰 이유 하나를
 * 달마다 한 줄로 적는다 — 광고비가 늘어서인지, 쿠폰을 더 써서인지, 그냥 덜
 * 팔려서인지. 그래야 다음 달에 손댈 곳이 정해진다.
 */
import { useCallback, useEffect, useState } from 'react';
import { CalendarRange, Loader2, RefreshCw } from 'lucide-react';
import { coupangApi, won, type MonthProfitRow } from '../../lib/coupang';
import { driverSentence } from '../../lib/monthlyProfit';

function monthLabel(m: string) {
  return `${m.slice(0, 4)}.${m.slice(5, 7)}`;
}

function Delta({ v, unit = '원', goodUp = true, digits = 0 }: { v: number | null; unit?: string; goodUp?: boolean; digits?: number }) {
  if (v === null) return <span className="text-[11px] text-ink-3">—</span>;
  if (Math.abs(v) < (unit === '%p' ? 0.05 : 1)) return <span className="text-[11px] text-ink-3">그대로</span>;
  const good = goodUp ? v > 0 : v < 0;
  return (
    <span className={`text-[11px] font-semibold tabular-nums ${good ? 'text-positive' : 'text-critical'}`}>
      {v > 0 ? '▲' : '▼'} {Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: digits })}{unit}
    </span>
  );
}

export function MonthlyProfit() {
  const [rows, setRows] = useState<MonthProfitRow[] | null>(null);
  const [thisMonth, setThisMonth] = useState('');
  const [months, setMonths] = useState(6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (n: number) => {
    setLoading(true);
    try {
      const d = await coupangApi.profitMonthly(n);
      setRows(d.rows);
      setThisMonth(d.thisMonth);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? '불러오지 못했습니다.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(months); }, [load, months]);

  const withData = (rows ?? []).filter(r => r.hasData);
  const best = withData.length > 1
    ? withData.reduce((a, b) => (b.profit > a.profit ? b : a))
    : null;

  return (
    <div className="rounded-panel border border-line bg-paper p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <CalendarRange className="h-4 w-4 text-accent" />
        <h3 className="text-[15px] font-semibold text-ink">월별 순이익</h3>
        <select
          value={months}
          onChange={e => setMonths(Number(e.target.value))}
          className="ml-auto rounded-control border border-line bg-paper px-2 py-1 text-[12px] text-ink"
        >
          {[3, 6, 12].map(n => <option key={n} value={n}>최근 {n}개월</option>)}
        </select>
        <button onClick={() => void load(months)} disabled={loading}
          className="flex items-center gap-1 rounded-control border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />새로고침
        </button>
      </div>
      <p className="text-[12.5px] text-ink-2">
        달마다 매출에서 쿠폰·수수료·원가·반품·광고비를 뺀 순이익입니다. 정산서 대조와 같은 월 기준이라 나란히 보시면 됩니다.
      </p>
      {error && <p className="mt-2 text-[12px] text-critical">{error}</p>}

      {rows === null ? (
        <div className="flex items-center gap-2 py-10 text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-[13px]">월별로 다시 세는 중...</span>
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-ink-3">아직 집계할 판매가 없습니다.</p>
      ) : (
        <>
          {best && (
            <p className="mt-3 rounded-card border border-accent-line bg-accent-soft px-3 py-2 text-[12.5px] text-ink-2">
              이 기간 순이익이 가장 좋았던 달은 <b>{monthLabel(best.month)}</b>({won(best.profit)}, 마진율 {best.marginRate.toFixed(1)}%)입니다.
            </p>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-line">
                <tr>
                  {['월', '매출', '쿠폰', '수수료', '원가', '반품', '광고비', '순이익', '마진율'].map((h, i) => (
                    <th key={h} className={`whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-2 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(r => (
                  <tr key={r.month} className={`transition-colors hover:bg-paper-2 ${r.hasData ? '' : 'opacity-50'}`}>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span className="text-[13px] font-semibold text-ink">{monthLabel(r.month)}</span>
                      {r.month === thisMonth && <span className="ml-1.5 text-[10.5px] text-caution">진행 중</span>}
                      <span className="mt-0.5 block text-[11px] text-ink-3">{r.quantity.toLocaleString()}개</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      <span className="text-[13px] text-ink">{won(r.salesAmount)}</span>
                      <span className="mt-0.5 block"><Delta v={r.salesDelta} /></span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-[12.5px] text-ink-2">-{won(r.couponDiscount)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-[12.5px] text-ink-2">-{won(r.commission)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-[12.5px] text-ink-2">-{won(r.unitCost)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-[12.5px] text-ink-2">-{won(r.returnCost)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-[12.5px] text-ink-2">-{won(r.adCost)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      <span className={`text-[13px] font-semibold ${r.profit >= 0 ? 'text-positive' : 'text-critical'}`}>{won(r.profit)}</span>
                      <span className="mt-0.5 block"><Delta v={r.profitDelta} /></span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      <span className="text-[13px] text-ink">{r.marginRate.toFixed(1)}%</span>
                      <span className="mt-0.5 block"><Delta v={r.marginRateDelta} unit="%p" digits={1} /></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 왜 그랬는지 — 숫자만으로는 다음 달에 손댈 곳이 안 정해진다 */}
          {rows.some(r => r.driver) && (
            <div className="mt-3 rounded-card border border-line bg-paper-2 p-3">
              <p className="mb-1.5 text-[12px] font-semibold text-ink-2">순이익이 움직인 가장 큰 이유</p>
              <ul className="space-y-1">
                {rows.filter(r => r.driver).map(r => (
                  <li key={r.month} className="text-[12px] leading-relaxed text-ink-2">
                    <b>{monthLabel(r.month)}</b> — 순이익이 {r.prevMonth ? `${monthLabel(r.prevMonth)}보다 ` : ''}
                    <span className={(r.profitDelta ?? 0) >= 0 ? 'font-semibold text-positive' : 'font-semibold text-critical'}>
                      {Math.abs(Math.round(r.profitDelta ?? 0)).toLocaleString()}원 {(r.profitDelta ?? 0) >= 0 ? '늘었습니다' : '줄었습니다'}
                    </span>
                    . {driverSentence(r.driver as any)}.
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
            이번 달은 오늘까지만 집계합니다 — 아직 끝나지 않은 달이라 지난달과 그대로 견주시면 안 됩니다.
            광고비는 광고분석AI에 올린 보고서에서 옵니다(쿠팡이 광고 API를 주지 않습니다). 안 올린 달은 광고비가 0으로 잡혀 순이익이 실제보다 높게 보입니다.
          </p>
        </>
      )}
    </div>
  );
}
