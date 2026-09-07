/**
 * [2] 정산 캐시플로 캘린더
 *
 * "언제 얼마가 들어오나"에 답한다. 지급 일정이 확정된 금액만 달력에 찍고,
 * 아직 지급일이 배정되지 않은 정산예정액은 따로 표시한다. 둘을 섞으면
 * 실제 입금일이 없는 돈까지 날짜에 찍혀 자금 계획을 그르친다.
 */
import { useEffect, useState } from 'react';
import { CalendarDays, Loader2 } from 'lucide-react';
import { coupangApi, won, type SettlementDay, type SettlementResponse } from '../../lib/coupang';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function SettlementCalendar() {
  const [data, setData] = useState<SettlementResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    coupangApi.settlement().then(setData).catch(e => setError(e.message));
  }, []);

  if (error) {
    return <div className="rounded-panel border border-critical/35 bg-critical-soft p-5 text-[13px] text-ink-2">{error}</div>;
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 py-14 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[13px]">정산 일정을 불러오는 중...</span>
      </div>
    );
  }

  const byDate = new Map<string, SettlementDay>(data.days.map(d => [d.date, d] as [string, SettlementDay]));
  const months = monthsAround(data.today);
  const hasAny = data.days.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="앞으로 7일 입금" value={won(data.totals.in7)} />
        <Stat label="앞으로 30일 입금" value={won(data.totals.in30)} />
        <Stat
          label="주간 평균 입금"
          value={won(data.totals.weeklyAverage)}
          sub={data.totals.weeksObserved > 0 ? `최근 ${data.totals.weeksObserved}주 기준` : '기록 없음'}
        />
        <Stat label="일정 미배정" value={won(data.totals.unscheduled)} sub="지급일이 아직 안 잡힌 정산예정액" />
      </div>

      {!hasAny ? (
        <div className="flex flex-col items-center justify-center rounded-panel border border-line bg-paper py-16 text-ink-3">
          <CalendarDays className="mb-4 h-12 w-12 opacity-20" />
          <p className="text-sm font-semibold">지급내역이 아직 없습니다</p>
          <p className="mt-1.5 text-center text-[12px] leading-relaxed">
            첫 정산이 잡히면 이곳에 입금 예정일과 금액이 표시됩니다.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {months.map(m => (
            <MonthGrid key={m.key} month={m} byDate={byDate} today={data.today} />
          ))}
        </div>
      )}

      {hasAny && (
        <div className="rounded-panel border border-line bg-paper">
          <h3 className="border-b border-line px-5 py-4 text-sm font-semibold text-ink">입금 일정</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-[11.5px] text-ink-3">
                  <th className="px-4 py-2.5 text-left font-medium">지급일</th>
                  <th className="px-3 py-2.5 text-left font-medium">유형</th>
                  <th className="px-3 py-2.5 text-left font-medium">상태</th>
                  <th className="px-4 py-2.5 text-right font-medium">금액</th>
                </tr>
              </thead>
              <tbody>
                {data.days
                  .filter(d => d.date >= data.today)
                  .flatMap(d => d.items.map((it, i) => ({ d, it, i })))
                  .map(({ d, it, i }) => (
                    <tr key={`${d.date}-${i}`} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2.5 tabular-nums text-ink">{d.date}</td>
                      <td className="px-3 py-2.5 text-ink-2">{it.type}</td>
                      <td className="px-3 py-2.5 text-ink-3">{it.status || '예정'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{won(it.amount)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {data.days.filter(d => d.date >= data.today).length === 0 && (
            <p className="px-5 py-8 text-center text-[13px] text-ink-3">앞으로 잡힌 입금 일정이 없습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}

interface MonthInfo {
  key: string;
  year: number;
  month: number; // 0-based
  label: string;
}

function monthsAround(today: string): MonthInfo[] {
  const [y, m] = today.split('-').map(Number);
  const out: MonthInfo[] = [];
  for (const offset of [0, 1]) {
    const d = new Date(Date.UTC(y, m - 1 + offset, 1));
    out.push({
      key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`,
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      label: `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월`,
    });
  }
  return out;
}

function MonthGrid({ month, byDate, today }: { month: MonthInfo; byDate: Map<string, SettlementDay>; today: string }) {
  const first = new Date(Date.UTC(month.year, month.month, 1));
  const daysInMonth = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
  const leading = first.getUTCDay();

  const cells: Array<{ date: string | null; day: number | null }> = [];
  for (let i = 0; i < leading; i++) cells.push({ date: null, day: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month.year}-${String(month.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ date, day: d });
  }

  const monthTotal = cells.reduce((n, c) => n + (c.date ? byDate.get(c.date)?.amount ?? 0 : 0), 0);

  return (
    <div className="rounded-panel border border-line bg-paper p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-ink">{month.label}</h3>
        <span className="ml-auto text-[12px] font-semibold tabular-nums text-ink-2">{won(monthTotal)}</span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map(w => (
          <div key={w} className="pb-1 text-center text-[10.5px] text-ink-3">
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          const entry = c.date ? byDate.get(c.date) : undefined;
          const isToday = c.date === today;
          return (
            <div
              key={i}
              className={`min-h-[54px] rounded-card border p-1.5 ${
                c.date ? 'border-line bg-paper-2' : 'border-transparent'
              } ${isToday ? 'ring-1 ring-accent' : ''}`}
            >
              {c.day && (
                <>
                  <span className={`text-[10.5px] tabular-nums ${isToday ? 'font-bold text-accent' : 'text-ink-3'}`}>{c.day}</span>
                  {entry && (
                    <p className="mt-0.5 break-all text-[10.5px] font-semibold leading-tight tabular-nums text-ink">
                      {compactWon(entry.amount)}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 달력 칸은 좁아 만 단위로 줄여 쓴다 */
function compactWon(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`;
  return n.toLocaleString('ko-KR');
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-panel border border-line bg-paper px-4 py-4">
      <p className="text-[11.5px] text-ink-3">{label}</p>
      <p className="mt-1 text-[19px] font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-tight text-ink-3">{sub}</p>}
    </div>
  );
}
