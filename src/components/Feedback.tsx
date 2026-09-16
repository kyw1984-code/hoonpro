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
import { Check, Loader2, MailCheck, MessageSquarePlus, X } from 'lucide-react';
import { getToken } from '../lib/auth';
import { HOWTO } from '../lib/howto';
import { ModalPortal } from './ModalPortal';

type Phase =
  | { kind: 'form' }
  | { kind: 'sending' }
  | { kind: 'done'; reply: string | null };

interface Reply {
  id: number;
  body: string;
  area: string | null;
  admin_reply: string;
  replied_at: string | null;
  reply_seen_at: string | null;
}

export function Feedback({ area }: { area: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [error, setError] = useState<string | null>(null);
  /**
   * 내 건의에 달린 답변.
   *
   * 예전에는 건의를 보내고 나면 그걸로 끝이었다. 운영자가 [처리함]으로 바꿔도
   * 적은 사람은 아무것도 못 받았고, 자기 건의가 어떻게 됐는지 볼 곳도 없었다.
   * 메일도 함께 가지만 메일을 안 보는 분도 있어 여기서도 보여준다 — 둘 중
   * 하나는 닿는다.
   */
  const [replies, setReplies] = useState<Reply[]>([]);
  const unseen = replies.filter(r => !r.reply_seen_at).length;
  /**
   * 접속 직후 한 번 띄우는 알림.
   *
   * 버튼 모서리의 숫자 배지만으로는 놓친다 — 가만히 있는 표시인 데다, 모바일에서
   * 그 버튼은 아이콘만 있는 28px 정사각형이다. 메일을 안 보는 분은 답변이 온 줄
   * 모르고 지나간다. 그래서 접속하면 한 번 떴다 사라지는 알림을 둔다.
   *
   * 창을 자동으로 열지는 않는다. 일하러 들어왔는데 창이 막고 있으면 성가시다.
   * 대신 눌러서 바로 열 수 있게 한다. 확인하지 않고 닫으면 다음 접속 때 또 뜬다.
   */
  const [notice, setNotice] = useState(false);

  // 답변이 왔는지는 창을 열지 않아도 알아야 한다. 버튼에 점을 찍으려면
  // 먼저 물어봐야 하므로 화면에 뜰 때 한 번 확인한다.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/qa?action=my-suggestions', {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        const d = await res.json();
        setReplies(d.replies ?? []);
        if ((d.unseen ?? 0) > 0) setNotice(true);
      } catch { /* 답변 확인 실패가 건의 쓰는 것을 막지 않는다 */ }
    })();
  }, []);

  // 읽고 누를 시간은 준다. 3초짜리 토스트는 눈에 들어오기 전에 사라진다.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(false), 12000);
    return () => clearTimeout(t);
  }, [notice]);

  // 닫았다 열면 처음부터. 지난번 답이 남아 있으면 지금 쓴 것에 대한 답으로 읽힌다.
  useEffect(() => {
    if (open) { setPhase({ kind: 'form' }); setError(null); }
  }, [open]);

  // 창을 열면 읽은 것으로 본다. 화면에 띄워 놓고도 계속 점이 남으면 곧 무시한다.
  useEffect(() => {
    if (!open || unseen === 0) return;
    setReplies(rs => rs.map(r => ({ ...r, reply_seen_at: r.reply_seen_at ?? new Date().toISOString() })));
    void fetch('/api/qa?action=suggest-mark-seen', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => { /* 확인 표시 실패는 다음에 다시 뜨는 것뿐이다 */ });
  }, [open, unseen]);

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
        className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-line text-ink-3 transition-colors hover:border-line-strong hover:text-ink sm:h-auto sm:w-auto sm:gap-1.5 sm:px-3 sm:py-1.5"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        <span className="hidden text-[12px] font-medium sm:inline">건의하기</span>
        {/* 답변이 왔다는 것은 창을 열지 않아도 보여야 한다.
            모바일에서 이 버튼은 28px 정사각형이라 안쪽에 넣으면 넘친다.
            모서리에 띄워 붙인다. */}
        {unseen > 0 && (
          <span
            aria-label={`새 답변 ${unseen}건`}
            className="absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-accent px-[3px] text-[9.5px] font-bold leading-none text-ground"
          >
            {unseen}
          </span>
        )}
      </button>

      {/* 접속 직후 한 번. 창이 열려 있으면 띄우지 않는다 — 이미 보고 있다 */}
      {notice && !open && (
        <ModalPortal>
          {/* 버튼 안에 버튼을 넣을 수 없다. 바깥은 상자로 두고 '보기'와 '닫기'를
              나란한 버튼 둘로 나눈다. */}
          <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[80] flex justify-center px-4">
            <div className="pointer-events-auto flex w-full max-w-[420px] items-center gap-1 rounded-panel border border-accent-line bg-paper py-2 pl-4 pr-2 shadow-overlay">
              <button
                type="button"
                onClick={() => { setNotice(false); setOpen(true); }}
                className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left"
              >
                <MailCheck className="h-4 w-4 shrink-0 text-accent" />
                <span className="min-w-0 text-[13px] leading-snug text-ink">
                  건의하신 내용에 <b className="text-accent">훈프로 답변</b>이 도착했습니다
                  {unseen > 1 && <span className="text-ink-2"> ({unseen}건)</span>}
                  <span className="ml-1 whitespace-nowrap text-[11.5px] text-ink-3">눌러서 보기</span>
                </span>
              </button>
              {/* 아이콘은 작게 두고 누를 자리만 44px로 넓힌다 — 이 앱의 다른
                  작은 버튼들과 같은 기준이다 */}
              <button
                type="button"
                aria-label="알림 닫기"
                onClick={() => setNotice(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink-2"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

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
                    : replies.length > 0
                      ? '지난 건의에 달린 답변이 아래에 있습니다. 새로 적으실 것이 있으면 이어서 적어주세요.'
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

            {/* 훈프로가 직접 단 답변 — 새로 쓰는 칸보다 위에 둔다. 아래에 두면
                긴 건의를 쓰는 동안 화면 밖으로 밀려 못 본 채 닫는다. */}
            {replies.length > 0 && phase.kind !== 'done' && (
              <div className="flex max-h-[38vh] flex-col gap-2 overflow-y-auto px-6 pb-1 pt-2">
                {replies.map(r => (
                  <div key={r.id} className="rounded-card border border-accent-line bg-accent-soft p-3.5">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <MailCheck className="h-3.5 w-3.5 text-accent" />
                      <span className="text-[12px] font-semibold text-accent">훈프로 답변</span>
                      <span className="text-[11px] text-ink-3">
                        {r.replied_at ? new Date(r.replied_at).toLocaleDateString('ko-KR') : ''}
                        {r.area ? ` · ${r.area}` : ''}
                      </span>
                    </div>
                    <p className="mb-1.5 whitespace-pre-wrap border-l-2 border-line pl-2.5 text-[12px] leading-relaxed text-ink-3">
                      {r.body}
                    </p>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{r.admin_reply}</p>
                  </div>
                ))}
              </div>
            )}

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
