/**
 * 건의함 — 불편한 것, 있었으면 하는 것을 글로 받는다.
 *
 * 전화나 카카오 상담은 받는 순간 응답 시간이 기대치가 되고, 그게 곧 제품
 * 만들 시간을 먹는다. 대신 어느 화면에서든 한 번에 열리는 창을 둔다.
 *
 * 보내면 그 자리에서 답이 나올 수도 있다. 이미 되는 일을 몰라서 물은 것이면
 * 어디를 누르면 되는지 알려준다. 그게 아니면 "전달했습니다"로 끝낸다.
 * 없는 기능을 있다고 답하면 찾아 헤매다 신뢰를 잃으므로, 확실할 때만 답한다.
 */
import { useEffect, useState } from 'react';
import { Check, Loader2, MessageSquarePlus, X } from 'lucide-react';
import { getToken } from '../lib/auth';
import { HOWTO } from '../lib/howto';
import { ModalPortal } from './ModalPortal';

type Phase =
  | { kind: 'form' }
  | { kind: 'sending' }
  | { kind: 'done'; reply: string | null };

export function Feedback({ area }: { area: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [error, setError] = useState<string | null>(null);

  // 닫았다 열면 처음부터. 지난번 답이 남아 있으면 지금 쓴 것에 대한 답으로 읽힌다.
  useEffect(() => {
    if (open) { setPhase({ kind: 'form' }); setError(null); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const send = async () => {
    const text = body.trim();
    if (text.length < 5) { setError('조금만 더 자세히 적어주세요.'); return; }
    setPhase({ kind: 'sending' });
    setError(null);
    try {
      const res = await fetch('/api/qa?action=suggest', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, area: HOWTO[area]?.title ?? area }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || '보내지 못했습니다.');
      setBody('');
      setPhase({ kind: 'done', reply: d.reply ?? null });
    } catch (e: any) {
      setError(e?.message ?? '보내지 못했습니다.');
      setPhase({ kind: 'form' });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="불편한 점이나 있었으면 하는 기능을 알려주세요"
        aria-label="건의하기"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-line text-ink-3 transition-colors hover:border-line-strong hover:text-ink sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        <span className="hidden text-[12px] font-medium sm:inline">건의하기</span>
      </button>

      {open && (
        <ModalPortal>
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="건의하기"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-[500px] flex-col overflow-hidden rounded-panel border border-line bg-paper shadow-overlay"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
              <div className="min-w-0">
                <h3 className="text-[17px] font-semibold text-ink">건의하기</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                  {phase.kind === 'done'
                    ? '보내주셔서 감사합니다.'
                    : '불편한 점, 있었으면 하는 기능, 잘못 나오는 숫자 — 무엇이든 적어주세요.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="shrink-0 rounded-full p-1.5 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink-2"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {phase.kind === 'done' ? (
              <div className="flex flex-col gap-3 px-6 pb-4 pt-2">
                {phase.reply ? (
                  <>
                    {/* 이미 되는 일이면 그 자리에서 답한다. 운영자까지 갈 이유가 없다 */}
                    <div className="rounded-card border border-accent-line bg-accent-soft p-4">
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-accent">바로 답변</p>
                      <p className="text-[13px] leading-relaxed text-ink">{phase.reply}</p>
                    </div>
                    <p className="text-[11.5px] leading-relaxed text-ink-3">
                      이 답으로 해결되지 않으면 한 번 더 보내주세요. 사람이 직접 확인합니다.
                    </p>
                  </>
                ) : (
                  <div className="flex items-start gap-2.5 rounded-card border border-line bg-paper-2 p-4">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
                    <p className="text-[13px] leading-relaxed text-ink-2">
                      의견이 전달됐습니다. 같은 의견이 여러 번 오면 먼저 고칩니다.
                      반영되면 화면에서 바뀐 것으로 확인하실 수 있습니다.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2 px-6 pb-4 pt-2">
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={6}
                  maxLength={2000}
                  autoFocus
                  placeholder="예) 재고 알림에 여름 상품이 계속 떠서 정작 발주할 게 안 보입니다."
                  className="w-full resize-none rounded-control border border-line bg-paper-2 px-3 py-2.5 text-[13px] leading-relaxed text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-ink-3">
                    지금 보고 계신 화면({HOWTO[area]?.title ?? area})이 함께 전달됩니다
                  </span>
                  <span className="ml-auto text-[11px] tabular-nums text-ink-3">{body.length}/2000</span>
                </div>
                {error && <p className="text-[12px] text-critical">{error}</p>}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
              {phase.kind === 'done' ? (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90"
                >
                  닫기
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-control border border-line px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={send}
                    disabled={phase.kind === 'sending' || body.trim().length < 5}
                    className="flex items-center gap-1.5 rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {phase.kind === 'sending' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    보내기
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </>
  );
}
