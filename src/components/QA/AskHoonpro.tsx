import React, { useRef, useState } from 'react';
import { MessageCircleQuestion, Send, Loader2, ThumbsUp, ThumbsDown, BookOpen, Sparkles, AlertCircle } from 'lucide-react';
import { getToken } from '../../lib/auth';

interface Source {
  docId: string;
  title: string;
  sourceType: 'lecture' | 'kakao';
  similarity: number;
}

interface QAItem {
  id: number;
  question: string;
  answer: string;
  sources: Source[];
  matched: boolean;
  logId: string | null;
  feedback: 1 | -1 | null;
}

const SUGGESTED_QUESTIONS = [
  '쿠팡 상품명은 어떻게 지어야 노출이 잘 되나요?',
  '로켓그로스랑 판매자배송 중 뭐부터 시작할까요?',
  '광고 예산은 처음에 얼마로 잡는 게 좋나요?',
  '소싱할 때 아이템 고르는 기준이 뭔가요?',
  '리뷰가 없는 초기에 판매를 어떻게 일으키나요?',
];

export const AskHoonpro: React.FC = () => {
  const [question, setQuestion] = useState('');
  const [items, setItems] = useState<QAItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const listTopRef = useRef<HTMLDivElement>(null);

  const ask = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/qa?action=ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '답변 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
        return;
      }
      if (typeof data.remaining === 'number') {
        window.dispatchEvent(new CustomEvent('usage-updated', { detail: { remaining: data.remaining } }));
      }
      setItems(prev => [
        {
          id: nextId.current++,
          question: trimmed,
          answer: data.answer,
          sources: Array.isArray(data.sources) ? data.sources : [],
          matched: data.matched !== false,
          logId: data.logId ?? null,
          feedback: null,
        },
        ...prev,
      ]);
      setQuestion('');
      listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch {
      setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const sendFeedback = async (item: QAItem, value: 1 | -1) => {
    if (!item.logId || item.feedback !== null) return;
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, feedback: value } : i)));
    try {
      await fetch('/api/qa?action=feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ logId: item.logId, feedback: value }),
      });
    } catch {
      // 피드백 실패는 사용자 흐름을 막지 않음
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6">
      <div className="rounded-panel border border-line bg-paper p-8">
        {/* 헤더 */}
        <div className="mb-2 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-control bg-ink">
            <MessageCircleQuestion className="h-5 w-5 text-paper" />
          </div>
          <h2 className="text-xl font-semibold text-ink">훈프로에게 질문</h2>
        </div>
        <p className="mb-6 text-[13px] text-ink-2">
          쿠팡 판매 관련 궁금한 점을 물어보세요. <span className="font-semibold text-ink">훈프로의 강의 자료와 노하우</span>에 근거해 답변합니다.
        </p>

        {/* 질문 입력 */}
        <form
          onSubmit={e => { e.preventDefault(); ask(question); }}
          className="mb-4 flex gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            maxLength={500}
            placeholder="예: 쿠팡 광고는 언제부터 돌리는 게 좋나요?"
            className="flex-1 rounded-control border border-line bg-paper px-3.5 py-2.5 text-[13px] text-ink outline-none transition-colors focus:border-accent"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-control bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            질문하기
          </button>
        </form>

        {/* 추천 질문 칩 */}
        <div className="mb-2 flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map(q => (
            <button
              key={q}
              onClick={() => ask(q)}
              disabled={loading}
              className="rounded-full border border-line bg-paper-2 px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-accent-line hover:bg-accent-soft hover:text-accent disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="mt-5 flex items-center gap-2 text-[13px] text-ink-2">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            훈프로가 강의 자료를 확인하고 있습니다...
          </div>
        )}
      </div>

      {/* 답변 목록 */}
      <div ref={listTopRef} />
      <div className="mt-6 space-y-4 pb-10">
        {items.length === 0 && !loading && (
          <div className="py-12 text-center text-[13px] text-ink-3">
            <Sparkles className="mx-auto mb-2 h-6 w-6 text-line-strong" />
            아직 질문이 없습니다. 위에서 궁금한 점을 물어보세요!
          </div>
        )}
        {items.map(item => (
          <div key={item.id} className="overflow-hidden rounded-panel border border-line bg-paper">
            {/* 질문 */}
            <div className="border-b border-line bg-paper-2 px-6 py-4">
              <div className="mb-1 text-[11px] font-semibold text-ink-3">Q.</div>
              <div className="text-[13px] font-semibold text-ink">{item.question}</div>
            </div>
            {/* 답변 */}
            <div className="px-6 py-5">
              <div className="mb-2 text-[11px] font-semibold text-accent">훈프로 답변</div>
              <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{item.answer}</div>

              {/* 출처 */}
              {item.sources.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-ink-3" />
                  {item.sources.map(s => (
                    <span
                      key={s.docId}
                      className="rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"
                      title={`유사도 ${(s.similarity * 100).toFixed(0)}%`}
                    >
                      {s.sourceType === 'kakao' ? '💬' : '📚'} {s.title}
                    </span>
                  ))}
                </div>
              )}

              {/* 피드백 */}
              {item.logId && (
                <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
                  <span className="text-xs text-ink-3">답변이 도움이 됐나요?</span>
                  <button
                    onClick={() => sendFeedback(item, 1)}
                    disabled={item.feedback !== null}
                    className={`flex items-center gap-1 rounded-control border px-2.5 py-1 text-xs transition-colors ${
                      item.feedback === 1
                        ? 'border-positive/40 bg-positive-soft text-positive'
                        : 'border-line text-ink-2 hover:bg-paper-2 disabled:opacity-40'
                    }`}
                  >
                    <ThumbsUp className="h-3.5 w-3.5" /> 도움됨
                  </button>
                  <button
                    onClick={() => sendFeedback(item, -1)}
                    disabled={item.feedback !== null}
                    className={`flex items-center gap-1 rounded-control border px-2.5 py-1 text-xs transition-colors ${
                      item.feedback === -1
                        ? 'border-critical/40 bg-critical-soft text-critical'
                        : 'border-line text-ink-2 hover:bg-paper-2 disabled:opacity-40'
                    }`}
                  >
                    <ThumbsDown className="h-3.5 w-3.5" /> 아쉬움
                  </button>
                  {item.feedback !== null && (
                    <span className="text-xs text-ink-3">피드백 감사합니다!</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
