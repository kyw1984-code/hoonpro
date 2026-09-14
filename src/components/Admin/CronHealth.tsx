/**
 * 크론이 돌고 있는가.
 *
 * 크론이 멈춰도 화면은 어제 숫자를 그대로 보여 준다. 아무 일도 없어 보이는
 * 것이 이 고장의 특징이라, 따로 보지 않으면 며칠 뒤에야 안다. 오류 목록
 * 위에 둔 이유도 그것이다 — 오류가 안 찍히는 고장이라서.
 */
import { useCallback, useEffect, useState } from 'react';
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { agoLabel, type CronHealth as Health } from '../../lib/cronHeartbeat';

const STATUS = {
  ok:      { label: '정상',        cls: 'border-positive/35 bg-positive-soft text-positive' },
  late:    { label: '늦었습니다',  cls: 'border-critical/35 bg-critical-soft text-critical' },
  failing: { label: '실패 중',     cls: 'border-critical/35 bg-critical-soft text-critical' },
  never:   { label: '기록 없음',   cls: 'border-line bg-paper-2 text-ink-3' },
} as const;

function fmt(s: string) {
  const d = new Date(s);
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function CronHealth() {
  const [jobs, setJobs] = useState<Health[] | null>(null);
  const [failures, setFailures] = useState<Array<{ job: string; runAt: string; detail: string | null }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin?action=cron-health', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || '조회 실패'); setJobs([]); return; }
      setJobs(data.jobs ?? []);
      setFailures(data.recentFailures ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? '조회 실패');
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const bad = (jobs ?? []).filter(j => j.status === 'late' || j.status === 'failing');

  return (
    <div className="rounded-panel border border-line bg-paper p-5">
      <div className="mb-1 flex items-center gap-2">
        <Activity className="h-4 w-4 text-accent" />
        <h3 className="text-[15px] font-semibold text-ink">크론 상태</h3>
        <button onClick={() => void load()} disabled={loading}
          className="ml-auto flex items-center gap-1 rounded-control border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />새로고침
        </button>
      </div>
      <p className="text-[12.5px] text-ink-2">
        매출 동기화·자동결제·브리핑은 전부 크론이 합니다. 멈춰도 화면은 어제 숫자를 그대로 보여 주니
        여기서 확인합니다.
      </p>
      {error && <p className="mt-2 text-[12px] text-critical">{error}</p>}

      {bad.length > 0 && (
        <p className="mt-3 rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[12.5px] font-semibold text-critical">
          {bad.map(j => j.label).join(', ')} — {bad[0].impact}
        </p>
      )}

      {jobs === null ? (
        <div className="flex items-center gap-2 py-8 text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-[13px]">불러오는 중...</span>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-line">
              <tr>
                {['하는 일', '마지막 실행', '결과', '기록'].map((h, i) => (
                  <th key={h} className={`whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-2 ${i === 0 ? 'text-left' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {jobs.map(j => {
                const st = STATUS[j.status];
                return (
                  <tr key={j.job} className="transition-colors hover:bg-paper-2">
                    <td className="px-3 py-3">
                      <span className="text-[13px] text-ink">{j.label}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-3">멈추면: {j.impact}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span className={`text-[13px] ${j.status === 'late' ? 'font-semibold text-critical' : 'text-ink'}`}>
                        {agoLabel(j.minutesAgo)}
                      </span>
                      {j.lastRunAt && <span className="mt-0.5 block text-[11px] tabular-nums text-ink-3">{fmt(j.lastRunAt)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span className={`inline-block rounded-control border px-1.5 py-[1px] text-[10.5px] font-semibold ${st.cls}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[11.5px] text-ink-3">{j.lastDetail || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {failures.length > 0 && (
        <div className="mt-4 rounded-card border border-line bg-paper-2 p-3">
          <p className="mb-1.5 text-[12px] font-semibold text-ink-2">최근 실패 {failures.length}건</p>
          <ul className="space-y-1">
            {failures.map((f, i) => (
              <li key={`${f.job}-${f.runAt}-${i}`} className="text-[11.5px] text-ink-3">
                <span className="tabular-nums">{fmt(f.runAt)}</span> · {f.job} · {f.detail || '사유 없음'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
        기록은 14일만 둡니다. '늦었습니다'는 주기의 두 배 남짓을 넘겼다는 뜻이고, 한 번 거른 것으로는
        켜지지 않습니다. 배포 직후에는 아직 안 돈 것이 정상이라 '기록 없음'으로 나옵니다.
      </p>
    </div>
  );
}
