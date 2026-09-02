/**
 * 내 작업 — 저장한 상세페이지 기획안·썸네일을 다시 보는 보관함.
 * 상세페이지 제작의 [보관함에 저장], 썸네일 제작의 [보관함에 저장]에서 쌓인다.
 */
import { useEffect, useState } from 'react';
import { FolderOpen, FileText, Image as ImageIcon, Loader2, RefreshCw, X, Copy, Download } from 'lucide-react';
import { getToken } from '../../lib/auth';

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

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
          상세페이지 제작의 <b>[보관함에 저장]</b>, 썸네일 제작의 <b>[보관함에 저장]</b>으로 저장한 결과물이 여기 쌓입니다. (최대 50개)
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
          <p className="mt-1.5 text-[12px]">기획안이나 썸네일을 만들고 [보관함에 저장]을 눌러보세요 — 새로고침해도 사라지지 않습니다</p>
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
                  <FileText className="h-8 w-8 text-ink-3" />
                  <span className="line-clamp-3 text-center text-[12px] font-medium leading-snug text-ink-2">{w.title || '상세페이지 기획안'}</span>
                </button>
              )}
              <div className="flex items-center gap-1.5 border-t border-line px-3 py-2">
                {w.kind === 'thumbnail' ? <ImageIcon className="h-3 w-3 shrink-0 text-ink-3" /> : <FileText className="h-3 w-3 shrink-0 text-ink-3" />}
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">{w.title || (w.kind === 'thumbnail' ? '썸네일' : '기획안')}</span>
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
                <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">{viewer.kind === 'thumbnail' ? 'Thumbnail' : 'Detail Plan'}</p>
                <h3 className="truncate text-[15px] font-semibold text-ink">{viewer.title || (viewer.kind === 'thumbnail' ? '썸네일' : '상세페이지 기획안')}</h3>
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
              {viewer.kind === 'thumbnail' && viewer.payload?.url ? (
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
