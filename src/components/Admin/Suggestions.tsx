/**
 * 건의 목록 — 무엇을 먼저 고쳐야 하나.
 *
 * 건의를 한 줄씩 읽으면 무엇이 중요한지 안 보인다. 열 사람이 같은 말을 한 것과
 * 한 사람이 한 말은 무게가 다르다. 그래서 같은 요약끼리 묶어 많은 순으로 세운다.
 *
 * 사용법 문의는 목록에서 뺀다. AI가 이미 그 자리에서 답했고, 운영자가 다시 볼
 * 이유가 없다. 다만 개수는 보여준다 — 같은 걸 자꾸 물으면 그건 안내가 부족하다는
 * 뜻이라 그 자체가 개선할 거리다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import { getToken } from '../../lib/auth';

interface Item {
  id: string;
  area: string | null;
  body: string;
  kind: 'bug' | 'improve' | 'howto' | 'praise' | 'other' | null;
  summary: string | null;
  severity: 'high' | 'normal' | 'low' | null;
  autoReply: string | null;
  answered: boolean;
  status: 'open' | 'planned' | 'done' | 'wontfix';
  note: string | null;
  createdAt: string;
  userEmail: string | null;
  userName: string | null;
}

interface Group {
  summary: string;
  kind: string;
  severity: string;
  count: number;
  ids: string[];
}

interface Data {
  items: Item[];
  groups: Group[];
  counts: { open: number; bug: number; improve: number; howto: number };
}

const KIND_LABEL: Record<string, string> = {
  bug: '안 됨', improve: '개선 요청', howto: '사용법', praise: '칭찬', other: '기타',
};

const auth = () => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' });

function ago(iso: string): string {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return '';
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
}

export function Suggestions({ showToast }: { showToast: (msg: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState<'open' | 'all' | 'planned' | 'done'>('open');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/qa?action=suggest-list&status=${status}`, { headers: auth() });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || '불러오지 못했습니다.');
      setData(d);
    } catch (e: any) {
      showToast(e?.message ?? '불러오지 못했습니다.');
    }
  }, [status, showToast]);

  useEffect(() => { void load(); }, [load]);

  const update = async (ids: string[], next: Item['status']) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/qa?action=suggest-update', {
        method: 'POST', headers: auth(),
        body: JSON.stringify({ id: ids[0], ids, status: next }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || '저장하지 못했습니다.');
      showToast(`${d.updated}건을 ${next === 'done' ? '처리함' : next === 'planned' ? '예정' : '보류'}으로 바꿨습니다.`);
      await load();
    } catch (e: any) {
      showToast(e?.message ?? '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-16 text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">불러오는 중...</span>
      </div>
    );
  }

  const shown = data.items.filter(i => i.kind !== 'howto');
  const howtoCount = data.counts.howto;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <MessageSquare className="h-4 w-4 text-accent" />
        <h3 className="text-[15px] font-bold text-ink">건의</h3>
        <span className="rounded-control border border-line px-2 py-0.5 text-[11.5px] text-ink-2">
          미처리 {data.counts.open}건
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {(['open', 'planned', 'done', 'all'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-control px-2.5 py-1 text-[12px] font-medium transition-colors ${
                status === s ? 'bg-ink text-paper' : 'border border-line text-ink-2 hover:text-ink'
              }`}
            >
              {s === 'open' ? '미처리' : s === 'planned' ? '예정' : s === 'done' ? '완료' : '전체'}
            </button>
          ))}
          <button
            onClick={load}
            className="flex min-h-[30px] items-center gap-1 rounded-control border border-line px-2.5 text-[12px] text-ink-2 hover:text-ink"
          >
            <RefreshCw className="h-3 w-3" /> 새로고침
          </button>
        </div>
      </div>

      {/* 여러 사람이 같은 말을 한 것부터. 이게 다음에 고칠 목록이다 */}
      {data.groups.length > 0 && (
        <div className="rounded-panel border border-line bg-paper p-5">
          <p className="text-[12.5px] font-semibold text-ink">같은 얘기끼리 묶으면</p>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            여러 사람이 같은 말을 한 것이 위에 옵니다. 묶음을 한 번에 처리할 수 있습니다.
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            {data.groups.slice(0, 12).map(g => (
              <div key={g.summary} className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-paper-2 px-3.5 py-2.5">
                <span className="text-[13px] font-medium text-ink">{g.summary}</span>
                <span className="rounded-control border border-line px-1.5 py-0.5 text-[10.5px] text-ink-3">
                  {KIND_LABEL[g.kind] ?? g.kind}
                </span>
                {g.severity === 'high' && (
                  <span className="rounded-control border border-critical/35 bg-critical-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-critical">
                    급함
                  </span>
                )}
                <span className="text-[12px] font-semibold tabular-nums text-accent">{g.count}명</span>
                <div className="ml-auto flex gap-1">
                  <button
                    onClick={() => update(g.ids, 'planned')}
                    disabled={busy}
                    className="rounded-control border border-line px-2 py-1 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40"
                  >
                    예정
                  </button>
                  <button
                    onClick={() => update(g.ids, 'done')}
                    disabled={busy}
                    className="rounded-control border border-line px-2 py-1 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40"
                  >
                    처리함
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 사용법 문의가 많다는 건 안내가 부족하다는 뜻이다. 그 자체가 고칠 거리다 */}
      {howtoCount > 0 && (
        <p className="rounded-card border border-line bg-paper-2 px-4 py-2.5 text-[12px] text-ink-2">
          사용법 문의 {howtoCount}건은 AI가 그 자리에서 답해 목록에서 뺐습니다.
          같은 것을 자꾸 물으면 그 화면의 [사용 방법]을 고칠 때입니다.
        </p>
      )}

      {shown.length === 0 ? (
        <div className="rounded-panel border border-line bg-paper py-14 text-center text-[13px] text-ink-3">
          {status === 'open' ? '미처리 건의가 없습니다.' : '해당하는 건의가 없습니다.'}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map(i => (
            <div key={i.id} className="rounded-card border border-line bg-paper p-4">
              <div className="flex flex-wrap items-center gap-2">
                {i.summary && <span className="text-[13px] font-semibold text-ink">{i.summary}</span>}
                <span className="rounded-control border border-line px-1.5 py-0.5 text-[10.5px] text-ink-3">
                  {KIND_LABEL[i.kind ?? 'other']}
                </span>
                {i.severity === 'high' && (
                  <span className="rounded-control border border-critical/35 bg-critical-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-critical">
                    급함
                  </span>
                )}
                {i.area && <span className="text-[11px] text-ink-3">{i.area}</span>}
                <span className="ml-auto text-[11px] text-ink-3">{ago(i.createdAt)}</span>
              </div>

              <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">{i.body}</p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-ink-3">{i.userName ?? i.userEmail ?? '알 수 없음'}</span>
                {i.status !== 'open' && (
                  <span className="rounded-control border border-line px-1.5 py-0.5 text-[10.5px] text-ink-3">
                    {i.status === 'planned' ? '예정' : i.status === 'done' ? '완료' : '보류'}
                  </span>
                )}
                <div className="ml-auto flex gap-1">
                  {i.status !== 'planned' && (
                    <button
                      onClick={() => update([i.id], 'planned')}
                      disabled={busy}
                      className="rounded-control border border-line px-2 py-1 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40"
                    >
                      예정
                    </button>
                  )}
                  {i.status !== 'done' && (
                    <button
                      onClick={() => update([i.id], 'done')}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-control border border-line px-2 py-1 text-[11px] text-ink-2 hover:text-ink disabled:opacity-40"
                    >
                      <Check className="h-3 w-3" /> 처리함
                    </button>
                  )}
                  {i.status !== 'wontfix' && (
                    <button
                      onClick={() => update([i.id], 'wontfix')}
                      disabled={busy}
                      className="rounded-control border border-line px-2 py-1 text-[11px] text-ink-3 hover:text-ink-2 disabled:opacity-40"
                    >
                      보류
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
