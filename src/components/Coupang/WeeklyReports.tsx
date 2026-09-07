/**
 * [3] 주간 성과 리포트 이력
 *
 * 메일은 매주 월요일 아침에 자동으로 나간다. 이 화면은 "정말 오고 있는지"를
 * 확인하고 지난 주들의 흐름을 한눈에 보게 하는 용도다.
 */
import { useEffect, useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { coupangApi, pct, won, type WeeklyReport } from '../../lib/coupang';

export function WeeklyReports() {
  const [reports, setReports] = useState<WeeklyReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    coupangApi
      .reports()
      .then(r => setReports(r.reports))
      .catch(e => setError(e.message));
  }, []);

  return (
    <div className="rounded-panel border border-line bg-paper">
      <div className="flex items-center gap-2 border-b border-line px-5 py-4">
        <Mail className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-ink">주간 성과 리포트</h3>
        <span className="ml-auto text-[11.5px] text-ink-3">매주 월요일 아침 자동 발송</span>
      </div>

      {error && <p className="px-5 py-6 text-[12.5px] text-critical">{error}</p>}

      {!error && !reports && (
        <div className="flex items-center gap-2 px-5 py-8 text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-[13px]">불러오는 중...</span>
        </div>
      )}

      {reports && reports.length === 0 && (
        <p className="px-5 py-8 text-center text-[12.5px] leading-relaxed text-ink-3">
          아직 발송된 리포트가 없습니다. 지난주 판매가 있으면 다음 월요일 아침에 첫 리포트가 갑니다.
        </p>
      )}

      {reports && reports.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] text-ink-3">
                <th className="px-4 py-2.5 text-left font-medium">기간</th>
                <th className="px-3 py-2.5 text-right font-medium">매출</th>
                <th className="px-3 py-2.5 text-right font-medium">순이익</th>
                <th className="px-3 py-2.5 text-right font-medium">이익률</th>
                <th className="px-4 py-2.5 text-right font-medium">반품</th>
              </tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.period_start} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2.5 tabular-nums text-ink">
                    {r.period_start.slice(5)} ~ {r.period_end.slice(5)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{won(r.summary.salesAmount)}</td>
                  <td
                    className={`px-3 py-2.5 text-right font-semibold tabular-nums ${
                      r.summary.profit >= 0 ? 'text-positive' : 'text-critical'
                    }`}
                  >
                    {won(r.summary.profit)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{pct(r.summary.marginRate)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-3">{r.summary.returnCount}건</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
