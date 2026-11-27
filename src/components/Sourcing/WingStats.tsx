/**
 * 소싱AI 상품 카드의 윙 판매 데이터 — 최근 28일 조회수·판매량·전환율·매출.
 *
 * 값은 판매자가 윙에서 즐겨찾기를 눌러 가져온다(src/lib/wingStats.ts). 한 번 가져온
 * 상품은 모두가 함께 쓰므로, 누군가 이미 조회한 상품은 누르지 않아도 보인다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, BookmarkPlus, Check, Copy, Download, LayoutGrid, List, Loader2, Zap } from 'lucide-react';
import { runWingStatsViaExtension, waitForExtension } from '../../lib/hoonproExt';
import { getToken } from '../../lib/auth';
import { buildWingStatsBookmarklet, conversionRate, itemIdFromUrl, WING_MAX_ITEMS, WING_WANTED_KEY } from '../../lib/wingStats';

export interface WingStat { itemId?: string; pv28: number | null; sales28: number | null; salePrice: number | null; category?: string | null; fetchedAt: string }
type P = { productId: string; productUrl: string; productName: string; productPrice: number };

/** 화면에 있는 상품들의 저장된 판매 데이터를 불러온다. 받는 창이 저장하면 다시 읽는다 */
export function useWingStats(products: P[]) {
  const [stats, setStats] = useState<Record<string, WingStat>>({});
  const ids = products.map(p => p.productId).slice(0, 120).join(',');
  const load = useCallback(async () => {
    if (!ids) { setStats({}); return; }
    try {
      const res = await fetch(`/api/coupang?action=wing-stats&ids=${ids}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      const d = await res.json();
      if (res.ok) setStats(d.stats || {});
    } catch { /* 판매 데이터는 덤이다 — 실패해도 화면을 막지 않는다 */ }
  }, [ids]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === 'hoonpro_wing_saved_at') void load(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', load);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('focus', load); };
  }, [load]);
  return { stats, reload: load };
}

/** 상품 카드 안의 한 줄 */
export function WingStatLine({ stat, listPrice }: { stat?: WingStat; listPrice: number }) {
  if (!stat) return null;
  const cvr = conversionRate(stat.pv28, stat.sales28);
  const revenue = stat.sales28 != null ? stat.sales28 * listPrice : null;
  const cell = (label: string, value: string) => (
    <div className="min-w-0">
      <p className="text-[9.5px] text-ink-3">{label}</p>
      <p className="truncate text-[12px] font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
  return (
    <div className="mb-3 rounded-control border border-line bg-paper px-2.5 py-2" title={`윙 기준 최근 28일 · ${stat.fetchedAt.slice(0, 10)} 조회`}>
      <div className="grid grid-cols-4 gap-2">
        {cell('클릭수', stat.pv28 != null ? stat.pv28.toLocaleString() : '—')}
        {cell('판매량', stat.sales28 != null ? stat.sales28.toLocaleString() : '—')}
        {cell('전환율', cvr != null ? `${cvr}%` : '—')}
        {cell('월 매출', revenue != null ? `${Math.round(revenue / 10000).toLocaleString()}만` : '—')}
      </div>
    </div>
  );
}

/** 목록 위의 안내 줄 — 조회할 상품을 적어 두고, 즐겨찾기를 건넨다 */
export function WingStatsBar({ keyword, products, stats, view, onView, onSaved }: {
  keyword: string; products: P[]; stats: Record<string, WingStat>; onSaved: () => void;
  view: 'table' | 'card'; onView: (v: 'table' | 'card') => void;
}) {
  const [open, setOpen] = useState(false);
  // 쇼크트리AI(확장 프로그램)가 있으면 즐겨찾기 없이 바로 가져온다
  const [ext, setExt] = useState<string | null>(null);
  const [extBusy, setExtBusy] = useState<string | null>(null);
  const [extMsg, setExtMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { void waitForExtension().then(setExt); }, []);
  const fetchViaExtension = async () => {
    const items = missing.slice(0, WING_MAX_ITEMS).map(p => ({ productId: p.productId, itemId: itemIdFromUrl(p.productUrl), name: p.productName.slice(0, 40) }));
    if (items.length === 0) return;
    setExtMsg(null); setExtBusy('윙에 연결하는 중...');
    try {
      const r = await runWingStatsViaExtension(items, pr => setExtBusy(`윙에서 읽는 중 ${pr.done + 1} / ${pr.total} (찾음 ${pr.found})${pr.mode === 'tab' ? ' · 윙 탭 사용' : ''}`));
      setExtBusy('저장하는 중...');
      const res = await fetch('/api/coupang?action=wing-stats-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ rows: r.rows }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || '저장에 실패했습니다.');
      onSaved();
      setExtMsg({ ok: true, text: `${d.saved ?? r.rows.length}개 상품의 판매 데이터를 가져왔습니다${r.missed ? ` (윙에서 못 찾음 ${r.missed}개)` : ''}${r.partial ? ' · 윙이 중간에 멈춰 일부만' : ''}.` });
    } catch (e: any) {
      setExtMsg({ ok: false, text: e?.message || '가져오지 못했습니다.' });
    } finally {
      setExtBusy(null);
    }
  };
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const href = buildWingStatsBookmarklet(window.location.origin);
  const have = products.filter(p => stats[p.productId]).length;
  const missing = products.filter(p => !stats[p.productId]);

  // React는 javascript: 주소를 href로 넣지 못하게 막는다. DOM에 직접 꽂는다
  useEffect(() => { if (linkRef.current) linkRef.current.setAttribute('href', href); }, [href, open]);

  // 보이는 상품 중 아직 값이 없는 것을 받는 창이 읽을 수 있게 적어 둔다
  useEffect(() => {
    const items = missing.slice(0, WING_MAX_ITEMS).map(p => ({ productId: p.productId, itemId: itemIdFromUrl(p.productUrl), name: p.productName.slice(0, 40) }));
    try { localStorage.setItem(WING_WANTED_KEY, JSON.stringify({ keyword, items, at: Date.now() })); } catch { /* 무시 */ }
  }, [keyword, missing.map(p => p.productId).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (products.length === 0) return null;
  return (
    <div className="mb-4 rounded-card border border-line bg-paper-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <BarChart3 className="h-4 w-4 text-accent" />
        <p className="text-[12.5px] text-ink">
          <b>판매 데이터</b> <span className="text-ink-3">(최근 28일 클릭수·판매량·전환율)</span> — {products.length}개 중 <b>{have}개</b> 표시 중
        </p>
        <div className="ml-auto flex overflow-hidden rounded-control border border-line">
          {([['table', '표', List], ['card', '카드', LayoutGrid]] as const).map(([v, label, Icon]) => (
            <button key={v} onClick={() => onView(v)} className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-semibold ${view === v ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'}`}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
        {missing.length > 0 && ext && (
          <button onClick={() => void fetchViaExtension()} disabled={!!extBusy}
            className="inline-flex items-center gap-1.5 rounded-control bg-accent px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-hover disabled:opacity-60">
            {extBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            {extBusy ? '가져오는 중' : `윙에서 바로 가져오기 (${Math.min(missing.length, WING_MAX_ITEMS)}개)`}
          </button>
        )}
        {missing.length > 0 && !ext && (
          <button onClick={() => setOpen(o => !o)} className="rounded-control border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-2 hover:border-line-strong hover:text-ink">
            {open ? '닫기' : `나머지 ${Math.min(missing.length, WING_MAX_ITEMS)}개 가져오기`}
          </button>
        )}
      </div>
      {(extBusy || extMsg) && (
        <p className={`mt-2 text-[12px] ${extBusy ? 'text-ink-2' : extMsg?.ok ? 'text-positive' : 'text-critical'}`}>{extBusy ?? extMsg?.text}</p>
      )}
      {open && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <a ref={linkRef} onClick={e => e.preventDefault()} draggable title="이 버튼을 즐겨찾기 바로 끌어다 놓으세요"
              className="inline-flex cursor-grab items-center gap-1.5 rounded-control border border-accent bg-accent-soft px-3.5 py-2 text-[12.5px] font-semibold text-ink active:cursor-grabbing">
              <BookmarkPlus className="h-4 w-4 text-accent" />훈프로 판매 데이터
            </a>
            <button onClick={() => { void navigator.clipboard.writeText(href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
              className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-2 text-[12px] font-medium text-ink-2 hover:border-line-strong hover:text-ink">
              {copied ? <Check className="h-3.5 w-3.5 text-positive" /> : <Copy className="h-3.5 w-3.5" />}{copied ? '복사됨' : '주소 복사'}
            </button>
          </div>
          <div className="mb-3 rounded-control border border-accent bg-accent-soft px-3 py-2.5">
            <p className="text-[12.5px] font-semibold text-ink">더 쉬운 방법 — 쇼크트리AI(크롬 확장 프로그램)</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-2">
              설치해 두면 즐겨찾기 없이 이 줄의 [윙에서 바로 가져오기] 버튼 하나로 끝납니다. 윙에 로그인만 돼 있으면 윙 화면을 열 필요도 없습니다.
            </p>
            <a href="/hoonpro-extension.zip" download className="mt-2 inline-flex items-center gap-1.5 rounded-control bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-hover">
              <Download className="h-3.5 w-3.5" />확장 프로그램 내려받기
            </a>
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[11px] leading-relaxed text-ink-3">
              <li>내려받은 zip 파일의 압축을 풉니다.</li>
              <li>크롬 주소창에 <b className="text-ink-2">chrome://extensions</b> 를 입력하고, 오른쪽 위 <b className="text-ink-2">개발자 모드</b>를 켭니다.</li>
              <li><b className="text-ink-2">압축해제된 확장 프로그램을 로드합니다</b>를 눌러 압축을 푼 폴더를 고릅니다.</li>
              <li>이 화면을 새로고침하면 [윙에서 바로 가져오기] 버튼이 나타납니다.</li>
            </ol>
          </div>
          <p className="mb-1 text-[11.5px] font-semibold text-ink-2">또는 즐겨찾기로</p>
          <ol className="mt-2.5 list-decimal space-y-1 pl-5 text-[11.5px] leading-relaxed text-ink-3">
            <li>위 버튼을 브라우저 즐겨찾기 바에 한 번 끌어다 놓습니다. (처음 한 번만)</li>
            <li>쿠팡 윙(wing.coupang.com)에 로그인한 화면에서 그 즐겨찾기를 누릅니다.</li>
            <li>훈프로 창이 하나 열리고 1~2분 뒤 저장됩니다. 이 화면으로 돌아오면 카드에 표시됩니다.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
