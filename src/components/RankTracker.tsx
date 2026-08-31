/**
 * 내 상품 순위 추적 — 등록한 상품이 키워드 검색 결과 몇 위인지
 * 매일 새벽 크론이 자동 기록하고 여기서 추이를 확인한다.
 * (오가닉 기준, 1페이지 60위까지 · 사용자당 최대 20개)
 */
import { useEffect, useState } from 'react';
import { ListOrdered, Loader2, RefreshCw, X } from 'lucide-react';
import { getToken } from '../lib/auth';

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const BADGE_BASE = 'inline-flex items-center rounded-control border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap';

export function RankTracker() {
  const [watches, setWatches] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [kw, setKw] = useState('');
  const [product, setProduct] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sourcing?type=rankwatch&action=list', { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || data.error) { setWatches([]); setMsg(data.error || null); }
      else setWatches(data.watches || []);
    } catch {
      setWatches([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!kw.trim() || !product.trim()) return;
    setMsg(null);
    try {
      const params = new URLSearchParams({ type: 'rankwatch', action: 'add', keyword: kw.trim(), product: product.trim() });
      const res = await fetch(`/api/sourcing?${params.toString()}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || data.error) { setMsg(data.error || '등록 실패'); return; }
      setKw(''); setProduct('');
      setMsg('등록 완료 — 매일 새벽 자동으로 순위가 기록됩니다.');
      load();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const remove = async (keyword: string, productId: string) => {
    await fetch(`/api/sourcing?type=rankwatch&action=remove&keyword=${encodeURIComponent(keyword)}&product=${encodeURIComponent(productId)}`,
      { headers: authHeaders() }).catch(() => {});
    load();
  };

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-4">
      <div className="rounded-panel border border-line bg-paper p-6">
        <div className="mb-1 flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-accent" />
          <h2 className="text-base font-semibold text-ink">내 상품 순위 추적</h2>
        </div>
        <p className="mb-4 text-[12px] leading-relaxed text-ink-2">
          내 상품(또는 경쟁 상품)이 <b>키워드 검색 결과 몇 위</b>인지 매일 새벽 자동으로 기록합니다.
          광고를 제외한 오가닉 순위 기준이며, 1페이지(60위)까지 추적합니다. 훈프로 소싱AI의 상품 카드 [순위 추적]으로도 등록됩니다. (최대 20개)
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={kw} onChange={e => setKw(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="추적 키워드 (예: 캠핑의자)"
            className="flex-1 rounded-control border border-line bg-paper px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-accent" />
          <input value={product} onChange={e => setProduct(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="상품 URL 또는 상품번호 (coupang.com/vp/products/...)"
            className="flex-[2] rounded-control border border-line bg-paper px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-accent" />
          <button onClick={add} disabled={!kw.trim() || !product.trim()}
            className="rounded-control bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40">
            등록
          </button>
        </div>
        {msg && <p className={`mt-2.5 text-[12px] ${msg.includes('완료') ? 'text-positive' : 'text-critical'}`}>{msg}</p>}
      </div>

      <div className="rounded-panel border border-line bg-paper p-6">
        <div className="mb-4 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">추적 중인 상품 {watches ? `(${watches.length})` : ''}</h3>
          <button onClick={load} disabled={loading}
            className="ml-auto flex items-center gap-1 rounded-control border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />새로고침
          </button>
        </div>
        {loading && watches === null ? (
          <div className="flex items-center gap-2 py-8 text-ink-3">
            <Loader2 className="h-5 w-5 animate-spin" /><span className="text-[13px]">불러오는 중...</span>
          </div>
        ) : !watches || watches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-ink-3">
            <ListOrdered className="mb-4 h-12 w-12 opacity-20" />
            <p className="text-sm font-semibold">추적 중인 상품이 없습니다</p>
            <p className="mt-1.5 text-[12px]">내 상품 URL과 대표 키워드를 등록하면 매일 순위 변화를 볼 수 있습니다</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {watches.map((w: any) => {
              const trail = (w.history || []).slice(-10).map((o: any) => (o.rank === null ? '밖' : `${o.rank}`)).join(' → ');
              return (
                <div key={`${w.keyword}:${w.product_id}`} className="rounded-card border border-line bg-paper-2 p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-ink">"{w.keyword}"</span>
                    <a href={`https://www.coupang.com/vp/products/${w.product_id}`} target="_blank" rel="noopener noreferrer"
                      className="min-w-0 max-w-[45%] truncate text-[12px] text-ink-2 hover:text-accent">
                      {w.product_name || `상품 ${w.product_id}`}
                    </a>
                    <div className="ml-auto flex items-center gap-2">
                      {w.latestRank !== undefined && w.latestRank !== null ? (
                        <span className="text-[16px] font-semibold tabular-nums text-ink">{w.latestRank}위</span>
                      ) : w.latestAt ? (
                        <span className="text-[12px] font-semibold text-ink-3">60위 밖</span>
                      ) : (
                        <span className="text-[12px] text-ink-3">첫 기록 대기</span>
                      )}
                      {typeof w.delta === 'number' && w.delta !== 0 && (
                        <span className={`${BADGE_BASE} ${w.delta > 0 ? 'border-positive/35 bg-positive-soft text-positive' : 'border-critical/35 bg-critical-soft text-critical'}`}>
                          {w.delta > 0 ? `▲${w.delta}` : `▼${Math.abs(w.delta)}`}
                        </span>
                      )}
                      <button onClick={() => remove(w.keyword, w.product_id)} title="추적 해제"
                        className="rounded-control p-1 text-ink-3 hover:bg-paper hover:text-critical">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {trail && <p className="mt-2 text-[11px] tabular-nums text-ink-3">순위 추이: {trail}위</p>}
                  {w.latestAt && (
                    <p className="mt-0.5 text-[10px] text-ink-3">
                      마지막 기록 {Math.round((Date.now() - new Date(w.latestAt).getTime()) / 3600000)}시간 전
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
