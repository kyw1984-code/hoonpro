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
    <div className="max-w-3xl mx-auto px-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
            <MessageCircleQuestion className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">훈프로에게 질문</h2>
        </div>
        <p className="text-slate-500 mb-6">
          쿠팡 판매 관련 궁금한 점을 물어보세요. <span className="font-semibold text-slate-700">훈프로의 강의 자료와 노하우</span>에 근거해 답변합니다.
        </p>

        {/* 질문 입력 */}
        <form
          onSubmit={e => { e.preventDefault(); ask(question); }}
          className="flex gap-2 mb-4"
        >
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            maxLength={500}
            placeholder="예: 쿠팡 광고는 언제부터 돌리는 게 좋나요?"
            className="flex-1 p-3.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-400 outline-none text-sm"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="shrink-0 flex items-center gap-1.5 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            질문하기
          </button>
        </form>

        {/* 추천 질문 칩 */}
        <div className="flex flex-wrap gap-2 mb-2">
          {SUGGESTED_QUESTIONS.map(q => (
            <button
              key={q}
              onClick={() => ask(q)}
              disabled={loading}
              className="px-3 py-1.5 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50 text-slate-600 text-xs rounded-full border border-slate-200 hover:border-emerald-300 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3 mt-4">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500 mt-5">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            훈프로가 강의 자료를 확인하고 있습니다...
          </div>
        )}
      </div>

      {/* 답변 목록 */}
      <div ref={listTopRef} />
      <div className="space-y-4 mt-6 pb-10">
        {items.length === 0 && !loading && (
          <div className="text-center py-12 text-slate-400 text-sm">
            <Sparkles className="w-6 h-6 mx-auto mb-2 text-slate-300" />
            아직 질문이 없습니다. 위에서 궁금한 점을 물어보세요!
          </div>
        )}
        {items.map(item => (
          <div key={item.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* 질문 */}
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100">
              <div className="text-xs font-bold text-slate-400 mb-1">Q.</div>
              <div className="text-sm font-semibold text-slate-800">{item.question}</div>
            </div>
            {/* 답변 */}
            <div className="px-6 py-5">
              <div className="text-xs font-bold text-emerald-600 mb-2">훈프로 답변</div>
              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{item.answer}</div>

              {/* 출처 */}
              {item.sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-4">
                  <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                  {item.sources.map(s => (
                    <span
                      key={s.docId}
                      className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] font-medium rounded-full border border-emerald-100"
                      title={`유사도 ${(s.similarity * 100).toFixed(0)}%`}
                    >
                      {s.sourceType === 'kakao' ? '💬' : '📚'} {s.title}
                    </span>
                  ))}
                </div>
              )}

              {/* 피드백 */}
              {item.logId && (
                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
                  <span className="text-xs text-slate-400">답변이 도움이 됐나요?</span>
                  <button
                    onClick={() => sendFeedback(item, 1)}
                    disabled={item.feedback !== null}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                      item.feedback === 1
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40'
                    }`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" /> 도움됨
                  </button>
                  <button
                    onClick={() => sendFeedback(item, -1)}
                    disabled={item.feedback !== null}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                      item.feedback === -1
                        ? 'bg-red-50 border-red-300 text-red-600'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40'
                    }`}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" /> 아쉬움
                  </button>
                  {item.feedback !== null && (
                    <span className="text-xs text-slate-400">피드백 감사합니다!</span>
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
