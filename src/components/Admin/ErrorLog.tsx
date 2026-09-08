/**
 * 서버 오류 목록.
 *
 * 오늘 중계 서버가 90분 죽어 있었는데 아무도 몰랐다. 로그는 Vercel에만 남고
 * 운영자는 그걸 열어 볼 이유가 없기 때문이다. 여기서 바로 보이면 알아챌 수 있다.
 *
 * 같은 오류는 한 줄로 묶고 횟수를 센다. 같은 줄 100개는 목록을 못 쓰게 만든다.
 * [처리함]을 누르면 목록에서 내려간다 — 고쳤는지 여부는 사람만 안다.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react';
import { getToken } from '../../lib/auth';

interface ErrorRow {
  id: string;
  area: string;
  message: string;
  detail: string | null;
  severity: 'error' | 'warn';
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  userEmail: string | null;
}

/** "3분 전"처럼. 오류는 언제 났는지가 지금 대응할지를 가른다 */
function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function ErrorLog({ showToast }: { showToast: (msg: string, type?: 'success' | 'error') => void }) {
  const [rows, setRows] = useState<ErrorRow[] | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin?action=errors${showResolved ? '&all=true' : ''}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '오류 목록을 불러오지 못했습니다.');
      setRows(data.errors ?? []);
    } catch (e: any) {
      setError(e?.message ?? '오류 목록을 불러오지 못했습니다.');
      setRows([]);
    }
  }, [showResolved]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (id?: string) => {
    setBusy(id ?? 'all');
    try {
      const q = id ? `id=${encodeURIComponent(id)}` : 'all=true';
      const res = await fetch(`/api/admin?action=error-resolve&${q}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '처리하지 못했습니다.');
      showToast(id ? '처리했습니다.' : '전부 처리했습니다.', 'success');
      await load();
    } catch (e: any) {
      showToast(e?.message ?? '처리하지 못했습니다.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const open = (rows ?? []).filter(r => !r.resolvedAt);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold text-ink">
          서버 오류 {open.length > 0 && <span className="text-critical">{open.length}건</span>}
        </h3>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
          <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} />
          처리한 것도 보기
        </label>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 새로고침
        </button>
        {open.length > 0 && (
          <button
            onClick={() => resolve()}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[12px] text-ink-2 hover:text-ink disabled:opacity-45"
          >
            {busy === 'all' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            전부 처리함
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-panel border border-critical/35 bg-critical-soft px-4 py-3 text-[12.5px] text-ink-2">{error}</p>
      )}

      {rows === null ? (
        <div className="flex items-center gap-2 py-10 text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-[13px]">불러오는 중...</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-panel border border-line bg-paper py-14 text-ink-3">
          <Check className="mb-3 h-10 w-10 opacity-20" />
          <p className="text-sm font-semibold">기록된 오류가 없습니다</p>
          <p className="mt-1 text-[12px]">중계 서버 다운, 수집 실패, 자동결제 실패가 여기에 쌓입니다.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(r => (
            <div
              key={r.id}
              className={`rounded-panel border bg-paper px-4 py-3 ${
                r.resolvedAt ? 'border-line opacity-55' : r.severity === 'warn' ? 'border-line' : 'border-critical/35'
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="rounded-control bg-paper-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">{r.area}</span>
                <span className="min-w-0 flex-1 text-[13px] font-medium text-ink">{r.message}</span>
                {r.count > 1 && (
                  <span className="shrink-0 text-[11.5px] font-semibold text-critical tabular-nums">{r.count}회</span>
                )}
                {!r.resolvedAt && (
                  <button
                    onClick={() => resolve(r.id)}
                    disabled={busy !== null}
                    className="shrink-0 rounded-control border border-line px-2 py-0.5 text-[11.5px] text-ink-3 hover:text-ink disabled:opacity-45"
                  >
                    처리함
                  </button>
                )}
              </div>

              {r.detail && (
                <p className="mt-1.5 break-words rounded-card bg-paper-2 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-ink-3">
                  {r.detail}
                </p>
              )}

              <p className="mt-1.5 text-[11px] text-ink-3">
                {ago(r.lastSeenAt)}
                {r.count > 1 && ` · 처음 ${ago(r.firstSeenAt)}`}
                {r.userEmail && ` · ${r.userEmail}`}
                {r.resolvedAt && ' · 처리함'}
              </p>
            </div>
          ))}
        </div>
      )}

      <p className="flex items-start gap-2 rounded-panel border border-line bg-paper px-4 py-3 text-[11.5px] leading-relaxed text-ink-3">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          같은 오류는 한 줄로 묶고 횟수를 셉니다. [처리함]을 누르면 목록에서 내려가지만, 원인이 그대로면 다시 올라옵니다.
          중계 서버가 멈추면 여기에 남는 동시에 관리자 메일로도 알립니다.
        </span>
      </p>
    </div>
  );
}
