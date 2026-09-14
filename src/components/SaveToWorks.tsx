import { useState } from 'react';
import { Check, FolderOpen, Loader2 } from 'lucide-react';
import { getToken } from '../lib/auth';

/**
 * 결과를 [내 작업]에 담는 버튼 — 종류에 상관없이 하나를 쓴다.
 *
 * 리뷰 분석과 소싱 결과가 각자 버튼을 만들면 저장 실패 처리나 중복 저장 방지
 * 같은 것이 두 벌이 되고, 한쪽만 고쳐진다. 담을 내용(payload)만 다르고
 * 나머지는 전부 같으므로 여기 한 곳에 둔다.
 */
export function SaveToWorksButton({
  kind,
  title,
  payload,
  label = '내 작업에 저장',
  savedLabel = '내 작업에 담았습니다',
}: {
  kind: 'review' | 'sourcing';
  title: string;
  /** 저장 직전에 만든다 — 화면이 바뀌는 동안 낡은 값을 담지 않게 */
  payload: () => Record<string, unknown>;
  label?: string;
  savedLabel?: string;
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (state !== 'idle') return;
    setState('saving');
    setErr(null);
    try {
      const token = getToken();
      const res = await fetch('/api/works?action=save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ kind, title: title.slice(0, 200), payload: payload() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setErr(data.error || '저장에 실패했습니다.');
        setState('idle');
        return;
      }
      setState('saved');
    } catch (e: any) {
      setErr(e?.message ?? '저장에 실패했습니다.');
      setState('idle');
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={save}
        disabled={state !== 'idle'}
        className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-accent-line hover:text-accent disabled:opacity-60"
      >
        {state === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : state === 'saved' ? <Check className="h-3.5 w-3.5 text-positive" />
          : <FolderOpen className="h-3.5 w-3.5" />}
        {state === 'saved' ? savedLabel : label}
      </button>
      {err && <span className="text-[11.5px] text-critical">{err}</span>}
    </span>
  );
}
