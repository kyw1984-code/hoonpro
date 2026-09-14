/**
 * 내 작업 — 저장해 둔 결과를 다시 보는 보관함.
 *
 * 상세페이지 기획안·썸네일은 내린 기능이라 새로 쌓이지 않지만, 만들어 둔
 * 것까지 없앨 이유는 없어 보는 것과 내려받는 것은 그대로 둔다.
 * 리뷰 분석은 여기에 새로 쌓인다 — 예전에는 화면을 닫으면 사라졌다.
 */
import { useEffect, useState } from 'react';
import { FolderOpen, FileText, Image as ImageIcon, Loader2, RefreshCw, X, Copy, Download, MessageSquareText, TrendingUp, ExternalLink } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { ReviewSummaryView } from '../ReviewAnalyzer';

/** 종류마다 이름·아이콘이 다르다. 한 곳에 둬야 카드와 모달이 어긋나지 않는다 */
const KIND_META: Record<string, { label: string; badge: string; Icon: typeof FileText }> = {
  thumbnail: { label: '썸네일', badge: 'Thumbnail', Icon: ImageIcon },
  'detail-plan': { label: '상세페이지 기획안', badge: 'Detail Plan', Icon: FileText },
  review: { label: '리뷰 분석', badge: '리뷰 분석AI', Icon: MessageSquareText },
  sourcing: { label: '소싱 검색', badge: '소싱AI', Icon: TrendingUp },
};
const metaOf = (kind: string) => KIND_META[kind] ?? KIND_META['detail-plan'];

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * 저장해 둔 소싱 검색 결과.
 *
 * 소싱AI 화면을 통째로 재현하지 않는다. 저장 시점의 시장 요약과 상품 목록만
 * 보여준다 — 그때 무엇을 보고 판단했는지 확인하는 것이 목적이고, 지금 화면은
 * 다시 조회하면 나오는 최신 결과이기 때문이다.
 */
function SourcingSavedView({ payload }: { payload: any }) {
  const m = payload?.market;
  const products: any[] = Array.isArray(payload?.products) ? payload.products : [];
  const won = (n: any) => (typeof n === 'number' ? `${n.toLocaleString()}원` : '—');

  return (
    <div className="flex flex-col gap-4">
      {m && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { k: '경쟁 강도', v: m.competitionRate === null || m.competitionRate === undefined ? '—' : String(m.competitionRate), hint: '상품수 ÷ 검색량' },
            { k: '리뷰 중앙값', v: (m.medianReviews ?? 0).toLocaleString(), hint: '진입장벽' },
            { k: '평균 판매가', v: won(m.avgPrice), hint: `상위 ${m.totalOnPage ?? 0}개` },
            { k: '로켓 비중', v: m.totalOnPage ? `${Math.round(((m.rocketCount ?? 0) / m.totalOnPage) * 100)}%` : '—', hint: `로켓 ${m.rocketCount ?? 0}개` },
          ].map(c => (
            <div key={c.k} className="rounded-card border border-line bg-paper-2 p-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">{c.k}</p>
              <p className="mt-0.5 text-[16px] font-semibold tabular-nums text-ink">{c.v}</p>
              <p className="text-[10.5px] text-ink-3">{c.hint}</p>
            </div>
          ))}
        </div>
      )}

      {products.length > 0 ? (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full text-[12.5px]">
            <thead className="bg-paper-2 text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-3 py-2 text-left">순위 · 상품</th>
                <th className="px-3 py-2 text-right">가격</th>
                <th className="px-3 py-2 text-right">리뷰</th>
                <th className="px-3 py-2 text-right">점수</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p: any, i: number) => (
                <tr key={p.productId ?? i} className="border-t border-line">
                  <td className="max-w-[320px] px-3 py-2">
                    <span className="mr-1.5 text-[11px] tabular-nums text-ink-3">{p.rank ?? i + 1}위</span>
                    <span className="line-clamp-2 text-ink">{p.productName ?? '—'}</span>
                    {p.productUrl && (
                      <a href={p.productUrl} target="_blank" rel="noopener noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] font-semibold text-accent hover:underline">
                        쿠팡에서 보기 <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-2">{won(p.productPrice)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-2">{(p.reviewCount ?? 0).toLocaleString()}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold text-ink">
                    {p.calculated?.opportunityScore ?? '—'}
                    {p.calculated?.grade && <span className="ml-1 text-[10.5px] font-normal text-ink-3">{p.calculated.grade}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[13px] text-ink-3">저장된 상품 목록이 없습니다.</p>
      )}

      <p className="text-[11px] text-ink-3">
        저장 시점의 결과입니다. 같은 키워드도 다시 조회하면 순위와 상품이 달라집니다.
      </p>
    </div>
  );
}

export function WorksLibrary() {
  const [works, setWorks] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/works?action=list', { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || data.error) { setWorks([]); setError(data.error || '조회 실패'); }
      else setWorks(data.works || []);
    } catch (e: any) {
      setWorks([]);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const remove = async (id: number) => {
    if (!confirm('이 항목을 보관함에서 삭제할까요?')) return;
    await fetch('/api/works?action=delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    setViewer(null);
    load();
  };

  const copyPlanText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* 무시 */ }
  };

  const fmtDate = (s: string) => {
    const d = new Date(s);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-6">
      <div className="rounded-panel border border-line bg-paper p-6">
        <div className="mb-1 flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-accent" />
          <h2 className="text-base font-semibold text-ink">내 작업</h2>
          <button onClick={load} disabled={loading}
            className="ml-auto flex items-center gap-1 rounded-control border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />새로고침
          </button>
        </div>
        <p className="text-[12px] text-ink-2">
          저장해 두신 결과가 모입니다. 각 화면에서 [내 작업에 저장]을 누르면 여기 쌓입니다.
        </p>
        {error && <p className="mt-2 text-[12px] text-critical">{error}</p>}
      </div>

      {works === null || (loading && works.length === 0) ? (
        <div className="flex items-center justify-center gap-2 rounded-panel border border-line bg-paper py-14 text-ink-3">
          <Loader2 className="h-5 w-5 animate-spin" /><span className="text-[13px]">불러오는 중...</span>
        </div>
      ) : works.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-panel border border-line bg-paper py-16 text-ink-3">
          <FolderOpen className="mb-4 h-12 w-12 opacity-20" />
          <p className="text-sm font-semibold">저장된 작업이 없습니다</p>
          <p className="mt-1.5 text-[12px]">리뷰 분석AI에서 분석한 뒤 [내 작업에 저장]을 누르면 여기 모입니다</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {works.map((w: any) => (
            <div key={w.id} className="group overflow-hidden rounded-card border border-line bg-paper">
              {w.kind === 'thumbnail' && w.payload?.url ? (
                <button onClick={() => setViewer(w)} className="block aspect-square w-full overflow-hidden bg-paper-2">
                  <img src={w.payload.url} alt={w.title || '썸네일'} className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
                </button>
              ) : (
                <button onClick={() => setViewer(w)} className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-paper-2 p-4">
                  {(() => { const I = metaOf(w.kind).Icon; return <I className="h-8 w-8 text-ink-3" />; })()}
                  <span className="line-clamp-3 text-center text-[12px] font-medium leading-snug text-ink-2">{w.title || metaOf(w.kind).label}</span>
                  {w.kind === 'review' && w.payload?.summary?.oneLine && (
                    <span className="line-clamp-2 text-center text-[10.5px] leading-snug text-ink-3">{w.payload.summary.oneLine}</span>
                  )}
                  {w.kind === 'sourcing' && (
                    <span className="text-center text-[10.5px] leading-snug text-ink-3">상품 {(w.payload?.products?.length ?? 0)}개</span>
                  )}
                </button>
              )}
              <div className="flex items-center gap-1.5 border-t border-line px-3 py-2">
                {(() => { const I = metaOf(w.kind).Icon; return <I className="h-3 w-3 shrink-0 text-ink-3" />; })()}
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">{w.title || metaOf(w.kind).label}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-ink-3">{fmtDate(w.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 뷰어 모달 */}
      {viewer && (
        <>
          <div onClick={() => setViewer(null)} className="fixed inset-0 z-[80] bg-ink/50 backdrop-blur-sm" />
          <div className="fixed inset-0 z-[90] m-auto flex h-fit max-h-[88vh] w-[92%] max-w-[720px] flex-col overflow-hidden rounded-panel border border-line bg-paper shadow-overlay">
            <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">{metaOf(viewer.kind).badge}</p>
                <h3 className="truncate text-[15px] font-semibold text-ink">{viewer.title || metaOf(viewer.kind).label}</h3>
                {viewer.kind === 'review' && (
                  <p className="mt-0.5 text-[11.5px] text-ink-3">
                    리뷰 {viewer.payload?.reviewCount ?? 0}개 분석 · {fmtDate(viewer.created_at)}
                  </p>
                )}
                {viewer.kind === 'sourcing' && (
                  <p className="mt-0.5 text-[11.5px] text-ink-3">
                    상품 {viewer.payload?.products?.length ?? 0}개 · {fmtDate(viewer.created_at)} 저장
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {viewer.kind === 'thumbnail' && viewer.payload?.url && (
                  <a href={viewer.payload.url} download target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 rounded-control border border-line px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 hover:border-line-strong hover:text-ink">
                    <Download className="h-3.5 w-3.5" />다운로드
                  </a>
                )}
                {viewer.kind === 'detail-plan' && viewer.payload?.planText && (
                  <button onClick={() => copyPlanText(viewer.payload.planText)}
                    className="flex items-center gap-1 rounded-control border border-line px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 hover:border-line-strong hover:text-ink">
                    <Copy className="h-3.5 w-3.5" />{copied ? '복사됨 ✓' : '전체 복사'}
                  </button>
                )}
                <button onClick={() => remove(viewer.id)}
                  className="rounded-control border border-line px-2.5 py-1.5 text-[12px] font-semibold text-critical hover:border-critical/40">
                  삭제
                </button>
                <button onClick={() => setViewer(null)} className="rounded-full p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-6">
              {viewer.kind === 'review' ? (
                <ReviewSummaryView data={viewer.payload} />
              ) : viewer.kind === 'sourcing' ? (
                <SourcingSavedView payload={viewer.payload} />
              ) : viewer.kind === 'thumbnail' && viewer.payload?.url ? (
                <img src={viewer.payload.url} alt="" className="mx-auto max-h-[65vh] rounded-card border border-line" />
              ) : (
                <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ink-2">
                  {viewer.payload?.planText || '내용이 없습니다.'}
                </pre>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
