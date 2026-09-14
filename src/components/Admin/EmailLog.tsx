import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, RefreshCw, Search, CheckCircle2, XCircle } from 'lucide-react';
import { getToken } from '../../lib/auth';

/**
 * 결제 관련 메일 발송 기록.
 *
 * 약관 제5조에 "정기결제일 최소 7일 전에 이메일로 고지한다"고 적어 두었다.
 * 고객이 "고지 못 받았다"고 할 때 여기서 확인한다 — 이메일로 찾는 것이
 * 대부분이라 검색을 이메일 기준으로 둔다.
 */

const KIND_LABEL: Record<string, string> = {
  'billing-notice': '결제 7일 전 고지',
  'payment-ok': '결제 완료',
  'payment-fail': '결제 실패',
  'subscribe-ok': '구독 시작',
  'refund-ok': '환불 완료',
  'referral-reward': '추천 보상',
  etc: '기타',
};

export function EmailLog() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [failed30, setFailed30] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ action: 'email-log' });
      if (q.trim()) params.set('q', q.trim());
      if (kind) params.set('kind', kind);
      if (failedOnly) params.set('failed', 'true');
      const res = await fetch(`/api/admin?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) { setRows([]); setError(data.error || '조회 실패'); return; }
      setRows(data.rows ?? []);
      setFailed30(data.failed30 ?? 0);
    } catch (e: any) {
      setRows([]);
      setError(e?.message ?? '조회 실패');
    } finally {
      setLoading(false);
    }
  }, [q, kind, failedOnly]);

  // 검색어는 엔터·버튼으로만 다시 부른다. 글자마다 부르면 서버를 두드린다.
  useEffect(() => { void load(); }, [kind, failedOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (s: string) => {
    const d = new Date(s);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-panel border border-line bg-paper p-5">
        <div className="mb-1 flex items-center gap-2">
          <Mail className="h-4 w-4 text-accent" />
          <h3 className="text-[15px] font-semibold text-ink">메일 발송 기록</h3>
          <button onClick={() => void load()} disabled={loading}
            className="ml-auto flex items-center gap-1 rounded-control border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />새로고침
          </button>
        </div>
        <p className="text-[12px] text-ink-2">
          결제 관련 메일이 실제로 나갔는지 확인합니다. 약관에 적어 둔 <b>결제 7일 전 고지</b>도 여기 남습니다.
        </p>
        {failed30 > 0 && (
          <p className="mt-2 rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[12.5px] font-semibold text-critical">
            최근 30일 발송 실패 {failed30}건 — 아래 [실패만]으로 확인해주세요.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-control border border-line bg-paper px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-ink-3" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void load(); }}
              placeholder="이메일로 검색 (엔터)"
              className="w-52 bg-transparent text-[12.5px] text-ink outline-none"
            />
          </div>
          <select value={kind} onChange={e => setKind(e.target.value)}
            className="rounded-control border border-line bg-paper px-2 py-1.5 text-[12.5px] text-ink">
            <option value="">전체 종류</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button
            onClick={() => setFailedOnly(v => !v)}
            className={`rounded-control border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
              failedOnly ? 'border-critical/40 bg-critical-soft text-critical' : 'border-line text-ink-2 hover:text-ink'
            }`}
          >
            실패만
          </button>
        </div>
        {error && <p className="mt-2 text-[12px] text-critical">{error}</p>}
      </div>

      {rows === null ? (
        <div className="flex items-center justify-center gap-2 rounded-panel border border-line bg-paper py-12 text-ink-3">
          <Loader2 className="h-5 w-5 animate-spin" /><span className="text-[13px]">불러오는 중...</span>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-panel border border-line bg-paper px-4 py-10 text-center text-[13px] text-ink-3">
          조건에 맞는 발송 기록이 없습니다.
        </p>
      ) : (
        <div className="overflow-hidden rounded-panel border border-line bg-paper">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-paper-2">
                <tr>
                  {['보낸 시각', '받는 사람', '종류', '대상', '결과'].map(h => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(r => (
                  <tr key={r.id} className="transition-colors hover:bg-paper-2">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[12.5px] text-ink-2">{fmt(r.sentAt)}</td>
                    <td className="px-4 py-3">
                      <span className="text-[12.5px] text-ink">{r.to}</span>
                      {r.name && <span className="ml-1.5 text-[11.5px] text-ink-3">{r.name}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[12.5px] text-ink-2">{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11.5px] text-ink-3">{r.ref ?? '—'}</td>
                    <td className="px-4 py-3">
                      {r.ok ? (
                        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-positive">
                          <CheckCircle2 className="h-3.5 w-3.5" />발송됨
                        </span>
                      ) : (
                        <span className="inline-flex items-start gap-1 text-[12px] font-semibold text-critical">
                          <XCircle className="mt-[1px] h-3.5 w-3.5 shrink-0" />
                          <span className="font-normal">{r.error || '실패'}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[11.5px] text-ink-3">
        최근 200건까지 보여줍니다. '대상'은 고지 대상 결제일이나 주문번호입니다 — 같은 대상으로 두 번 보내지 않게 하는 열쇠이기도 합니다.
      </p>
    </div>
  );
}
