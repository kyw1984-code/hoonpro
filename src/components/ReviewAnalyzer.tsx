/**
 * 상품 리뷰 분석 — 쿠팡 상품의 실제 리뷰를 수집해
 * 만족/불만/숨은 니즈/공략 포인트를 훈프로AI가 요약한다.
 * 경쟁 상품 벤치마킹은 물론 내 상품의 개선점 확인에도 쓴다.
 * 소싱AI의 상품 카드 [리뷰 분석] 모달과 결과 뷰(ReviewSummaryView)를 공유한다.
 */
import { useState } from 'react';
import { Loader2, MessageSquareText, Search } from 'lucide-react';
import { getToken } from '../lib/auth';

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// 서버리스 타임아웃 등으로 JSON이 아닌 응답이 와도 안전하게 처리
export const safeJson = async (res: Response): Promise<any> => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 504 || /timeout|timed out/i.test(text)) {
      return { error: '분석 시간이 초과되었습니다. 리뷰 수집이 오래 걸린 경우이니 잠시 후 다시 시도해주세요 — 재시도 시 이어서 더 빨리 처리됩니다.' };
    }
    return { error: `서버 응답 오류 (HTTP ${res.status}) — 잠시 후 다시 시도해주세요.` };
  }
};

// 분석 결과 렌더링 (소싱AI 모달과 공용)
export function ReviewSummaryView({ data }: { data: any }) {
  if (!data) return null;
  if (data.error) {
    return (
      <div className="rounded-card border border-critical/30 bg-critical-soft p-4 text-[13px] text-critical">
        {data.error}
        {data.diagnostics && (
          <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[10px] opacity-80">{data.diagnostics}</pre>
        )}
      </div>
    );
  }
  if (!data.summary) return null;
  if (data.summary.error) return <p className="text-[13px] text-critical">{data.summary.error}</p>;

  return (
    <div className="flex flex-col gap-3">
      {data.summary.oneLine && (
        <p className="rounded-card border border-accent-line bg-accent-soft px-4 py-3 text-[13px] font-semibold text-ink">
          {data.summary.oneLine}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {([
          ['👍 고객 만족 포인트', data.summary.positives, 'text-positive'],
          ['⚠️ 고객 불만 포인트', data.summary.complaints, 'text-critical'],
          ['🔍 숨은 니즈', data.summary.needs, 'text-ink'],
          ['🎯 내가 공략할 포인트', data.summary.attackPoints, 'text-accent'],
        ] as const).map(([title, items, cls]) => (
          Array.isArray(items) && items.length > 0 ? (
            <div key={title} className="rounded-card border border-line bg-paper-2 p-3.5">
              <p className={`mb-1.5 text-[12px] font-semibold ${cls}`}>{title}</p>
              <ul className="list-disc list-inside space-y-0.5 text-[12px] leading-relaxed text-ink-2">
                {items.map((s: string, i: number) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          ) : null
        ))}
      </div>
      {Array.isArray(data.samples) && data.samples.length > 0 && (
        <div className="rounded-card border border-line p-3.5">
          <p className="mb-1.5 text-[11px] font-semibold text-ink-3">실제 리뷰 샘플 (수집 {data.reviewCount}개 중)</p>
          {data.samples.slice(0, 3).map((s: any, i: number) => (
            <p key={i} className="mt-1 text-[11px] leading-relaxed text-ink-3">
              {s.rating > 0 && <b>[{s.rating}점] </b>}{s.text.slice(0, 160)}{s.text.length > 160 ? '…' : ''}
            </p>
          ))}
        </div>
      )}
      <p className="text-[11px] text-ink-3">
        공략 포인트는 상세페이지 제작 탭의 기획안에 그대로 활용하세요. 결과는 7일간 캐시됩니다.
      </p>
    </div>
  );
}

export function ReviewAnalyzer() {
  const [input, setInput] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any | null>(null);

  const analyze = async () => {
    const target = input.trim();
    if (!target || loading) return;
    setLoading(true);
    setData(null);
    try {
      const params = new URLSearchParams({ type: 'reviews', product: target });
      if (name.trim()) params.set('name', name.trim().slice(0, 100));
      const res = await fetch(`/api/sourcing?${params.toString()}`, { headers: authHeaders() });
      const json = await safeJson(res);
      setData(json);
      if (typeof json.remaining === 'number') {
        window.dispatchEvent(new CustomEvent('usage-updated', { detail: { remaining: json.remaining } }));
      }
    } catch (e: any) {
      setData({ error: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-4">
      <div className="rounded-panel border border-line bg-paper p-6">
        <div className="mb-1 flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-accent" />
          <h2 className="text-base font-semibold text-ink">상품 리뷰 분석</h2>
        </div>
        <p className="mb-4 text-[12px] leading-relaxed text-ink-2">
          쿠팡 상품 URL을 넣으면 실제 고객 리뷰를 수집해 <b>불만·숨은 니즈·공략 포인트</b>를 분석합니다.
          경쟁 상품의 불만은 내 상세페이지의 <b>핵심 차별점</b>이 되고, <b>내 상품</b>을 넣으면 개선할 점이 보입니다.
          훈프로 소싱AI의 상품 카드 [리뷰 분석]에서도 바로 실행할 수 있습니다.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && analyze()}
            placeholder="쿠팡 상품 URL 또는 상품번호 (coupang.com/vp/products/...)"
            className="flex-[2] rounded-control border border-line bg-paper px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-accent" />
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && analyze()}
            placeholder="상품명 (선택 — 분석 정확도 향상)"
            className="flex-1 rounded-control border border-line bg-paper px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-accent" />
          <button onClick={analyze} disabled={!input.trim() || loading}
            className="flex items-center justify-center gap-1.5 rounded-control bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}분석
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center gap-3 rounded-panel border border-line bg-paper py-12 text-ink-3">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="text-sm font-semibold">실제 리뷰를 수집해 훈프로AI가 분석하는 중... (10~30초)</p>
        </div>
      )}

      {!loading && data && (
        <div className="rounded-panel border border-line bg-paper p-6">
          {data.productName && data.productName !== '상품' && (
            <h3 className="mb-3 truncate text-[15px] font-semibold text-ink">{data.productName}</h3>
          )}
          <ReviewSummaryView data={data} />
        </div>
      )}

      {!loading && !data && (
        <div className="flex flex-col items-center justify-center rounded-panel border border-line bg-paper py-16 text-ink-3">
          <MessageSquareText className="mb-4 h-12 w-12 opacity-20" />
          <p className="text-sm font-semibold">분석할 상품의 쿠팡 URL을 입력하세요</p>
          <p className="mt-1.5 text-[12px]">소싱 전 경쟁 상품 2~3개, 판매 중이라면 내 상품 리뷰까지 분석해 보세요</p>
        </div>
      )}
    </div>
  );
}
