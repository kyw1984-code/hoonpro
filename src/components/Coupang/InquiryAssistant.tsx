/**
 * [6] 고객문의 AI 답변
 *
 * 쿠팡은 문의 응답 시간을 판매자 점수에 반영한다. 대부분의 문의는 배송·사이즈·
 * 재입고처럼 답이 정해져 있어 매번 처음부터 쓸 이유가 없다.
 *
 * 다만 고객에게 나가는 글이므로 AI가 쓴 문장을 사람 확인 없이 보내지 않는다.
 * 초안을 만들고, 판매자가 읽고 고친 뒤에야 전송 버튼이 의미를 갖는다.
 * 모델이 모르는 사실은 [대괄호] 자리표시자로 남아 있어 그대로 보내면 눈에 띈다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquare, Send, Sparkles } from 'lucide-react';
import { coupangApi, type Inquiry } from '../../lib/coupang';

export function InquiryAssistant() {
  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [showAnswered, setShowAnswered] = useState(false);

  const load = useCallback(async () => {
    try {
      const { inquiries } = await coupangApi.inquiries(showAnswered);
      setInquiries(inquiries);
      setDrafts(d => {
        const next = { ...d };
        for (const q of inquiries) if (q.draft && next[q.inquiryId] === undefined) next[q.inquiryId] = q.draft;
        return next;
      });
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [showAnswered]);

  useEffect(() => {
    load();
  }, [load]);

  const makeDraft = async (q: Inquiry) => {
    setBusy(q.inquiryId);
    setMsg(m => ({ ...m, [q.inquiryId]: '' }));
    try {
      const { draft, remaining } = await coupangApi.inquiryDraft(q.inquiryId);
      setDrafts(d => ({ ...d, [q.inquiryId]: draft }));
      if (typeof remaining === 'number' && remaining >= 0) {
        window.dispatchEvent(new CustomEvent('usage-updated', { detail: { remaining } }));
      }
    } catch (e: any) {
      setMsg(m => ({ ...m, [q.inquiryId]: e.message }));
    } finally {
      setBusy(null);
    }
  };

  const send = async (q: Inquiry) => {
    const content = (drafts[q.inquiryId] ?? '').trim();
    if (!content) return;
    if (/\[[^\]]{1,30}\]/.test(content)) {
      const ok = confirm('아직 채우지 않은 [대괄호] 자리가 있습니다. 이대로 고객에게 보낼까요?');
      if (!ok) return;
    }
    if (!confirm('이 내용으로 고객에게 답변을 전송합니다. 전송 후에는 수정할 수 없습니다.')) return;

    setBusy(q.inquiryId);
    try {
      await coupangApi.inquiryReply(q.inquiryId, content);
      setMsg(m => ({ ...m, [q.inquiryId]: '전송했습니다.' }));
      await load();
    } catch (e: any) {
      setMsg(m => ({ ...m, [q.inquiryId]: e.message }));
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return <div className="rounded-panel border border-critical/35 bg-critical-soft p-5 text-[13px] text-ink-2">{error}</div>;
  }
  if (!inquiries) {
    return (
      <div className="flex items-center gap-2 py-14 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[13px]">문의를 불러오는 중...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-paper px-5 py-4">
        <MessageSquare className="h-4 w-4 text-accent" />
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          미답변 문의 <b className="text-ink">{inquiries.filter(q => !q.answered).length}건</b>. 초안을 만든 뒤 반드시 읽고 고쳐서 보내세요.
          모델이 모르는 사실은 <span className="font-mono text-[11.5px] text-ink-3">[대괄호]</span>로 비워 둡니다.
        </p>
        <label className="ml-auto flex shrink-0 items-center gap-2 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={showAnswered} onChange={e => setShowAnswered(e.target.checked)} className="h-4 w-4" />
          답변한 것도 보기
        </label>
      </div>

      {inquiries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-panel border border-line bg-paper py-16 text-ink-3">
          <MessageSquare className="mb-4 h-12 w-12 opacity-20" />
          <p className="text-sm font-semibold">미답변 문의가 없습니다</p>
          <p className="mt-1.5 text-[12px]">쿠팡 문의는 최근 7일치를 가져옵니다.</p>
        </div>
      ) : (
        inquiries.map(q => (
          <article key={q.inquiryId} className="rounded-panel border border-line bg-paper p-5">
            <header className="mb-2 flex flex-wrap items-baseline gap-2">
              <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{q.productName || '(상품명 미확인)'}</h3>
              {q.answered && (
                <span className="rounded-control border border-positive/35 bg-positive-soft px-2 py-0.5 text-[10.5px] font-semibold text-positive">
                  답변 완료
                </span>
              )}
              <span className="text-[11px] text-ink-3">
                {q.customerName && `${q.customerName} · `}
                {q.inquiredAt ? new Date(q.inquiredAt).toLocaleString('ko-KR') : ''}
              </span>
            </header>

            <p className="whitespace-pre-wrap rounded-card border border-line bg-paper-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
              {q.content}
            </p>

            {!q.answered && (
              <div className="mt-3 flex flex-col gap-2">
                <textarea
                  value={drafts[q.inquiryId] ?? ''}
                  onChange={e => setDrafts(d => ({ ...d, [q.inquiryId]: e.target.value }))}
                  placeholder="답변을 직접 쓰거나 [답변 초안 만들기]를 눌러주세요."
                  rows={5}
                  className="w-full resize-y rounded-control border border-line bg-paper px-3 py-2.5 text-[12.5px] leading-relaxed outline-none focus:ring-2 focus:ring-accent"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => makeDraft(q)}
                    disabled={busy === q.inquiryId}
                    className="flex items-center gap-1.5 rounded-control border border-line px-3 py-2 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
                  >
                    {busy === q.inquiryId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    답변 초안 만들기
                  </button>
                  <button
                    onClick={() => send(q)}
                    disabled={busy === q.inquiryId || !(drafts[q.inquiryId] ?? '').trim()}
                    className="flex items-center gap-1.5 rounded-control bg-accent px-4 py-2 text-[12.5px] font-bold text-ground transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    <Send className="h-3.5 w-3.5" />
                    고객에게 전송
                  </button>
                  {msg[q.inquiryId] && (
                    <span className={`text-[12px] ${msg[q.inquiryId] === '전송했습니다.' ? 'text-positive' : 'text-critical'}`}>
                      {msg[q.inquiryId]}
                    </span>
                  )}
                </div>
              </div>
            )}
          </article>
        ))
      )}
    </div>
  );
}
