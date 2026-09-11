/**
 * [4] 그로스 재고 예측
 *
 * 품절은 매출만 잃는 게 아니라 검색 순위까지 떨어뜨리고, 되돌리는 데 몇 주가
 * 걸린다. 그래서 "며칠 남았는지"를 미리 보여주고 입고 수량까지 제안한다.
 *
 * 재고는 로켓창고의 판매가능수량이고 판매 속도는 그로스 주문(결제일) 기준이다.
 * 판매자 창고 재고는 그로스에선 팔리는 재고가 아니라 여기서 보지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BellOff, BellRing, Boxes, Loader2, PackageX } from 'lucide-react';
import { coupangApi, type InventoryResponse, type InventoryRow, type StockRisk } from '../../lib/coupang';

const RISK_META: Record<StockRisk, { label: string; className: string }> = {
  out: { label: '품절', className: 'border-critical/35 bg-critical-soft text-critical' },
  urgent: { label: '7일 이내', className: 'border-critical/35 bg-critical-soft text-critical' },
  watch: { label: '14일 이내', className: 'border-line-strong bg-paper text-ink-2' },
  ok: { label: '여유', className: 'border-line bg-paper text-ink-3' },
  excess: { label: '과잉', className: 'border-line bg-paper text-ink-3' },
  idle: { label: '판매 없음', className: 'border-line bg-paper text-ink-3' },
};

type InvSortKey = 'stock' | 'sold7' | 'sold14' | 'velocity' | 'daysLeft' | 'reorderQty';

export function InventoryForecast() {
  const [leadTime, setLeadTime] = useState(14);
  const [cover, setCover] = useState(30);
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 보기: 부족한 것만(기본) / 전체 / 카드 하나(품절·7일·14일·과잉). 카드를 누르면
  // 그 상태만 남고, 다시 누르면 기본으로 돌아간다.
  const [view, setView] = useState<'risky' | 'all' | StockRisk>('risky');
  const [sort, setSort] = useState<{ key: InvSortKey; dir: 'asc' | 'desc' } | null>(null);
  const onlyRisk = view === 'risky';

  // 입력 한 글자마다 요청이 나가면 '14'를 '21'로 고치는 동안 세 번 조회되고,
  // 늦게 온 응답이 마지막에 도착하면 입력과 다른 값이 표에 남는다.
  // 입력이 멈춘 뒤 한 번만 부르고, 순번이 뒤처진 응답은 버린다.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const d = await coupangApi.inventory(leadTime, cover);
      if (mine !== seq.current) return;
      setData(d);
      setError(null);
    } catch (e: any) {
      if (mine !== seq.current) return;
      setError(e.message);
    }
  }, [leadTime, cover]);

  useEffect(() => {
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [load]);

  if (error) {
    return <div className="rounded-panel border border-critical/35 bg-critical-soft p-5 text-[13px] text-ink-2">{error}</div>;
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 py-14 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[13px]">재고를 계산하는 중...</span>
      </div>
    );
  }

  const risky = data.rows.filter(r => r.risk === 'out' || r.risk === 'urgent' || r.risk === 'watch');
  const shown = view === 'risky' ? risky : view === 'all' ? data.rows : data.rows.filter(r => r.risk === view);
  // 서버가 준 순서(위험한 것 먼저)를 기본으로 두고, 사용자가 고른 열이 있으면 그걸로 다시 정렬한다.
  // 남은 일수는 null(판매 속도 0)이 섞여 있어 숫자로만 비교하면 뒤죽박죽이 된다 — 항상 끝으로 보낸다.
  const sorted = sort
    ? [...shown].sort((a, b) => {
        const pick = (r: InventoryRow) => (sort.key === 'daysLeft' ? r.daysLeft : Number(r[sort.key] ?? 0));
        const av = pick(a);
        const bv = pick(b);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return sort.dir === 'asc' ? av - bv : bv - av;
      })
    : shown;
  const toggleSort = (key: InvSortKey) =>
    setSort(cur => (cur && cur.key === key ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  const SortTh = ({ k, label, className = 'px-3' }: { k: InvSortKey; label: string; className?: string }) => (
    <th className={`${className} py-2.5 text-right font-medium`}>
      <button
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-0.5 hover:text-ink ${sort?.key === k ? 'text-ink' : ''}`}
        title="누르면 이 열로 정렬합니다. 다시 누르면 방향이 바뀝니다"
      >
        {label}
        <span className="text-[10px]">{sort?.key === k ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}</span>
      </button>
    </th>
  );

  const pick = (risk: StockRisk) => setView(cur => (cur === risk ? 'risky' : risk));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="품절" value={`${data.counts.out ?? 0}개`} tone={(data.counts.out ?? 0) > 0 ? 'critical' : undefined} active={view === 'out'} onClick={() => pick('out')} />
        <Stat label="7일 이내 소진" value={`${data.counts.urgent ?? 0}개`} tone={(data.counts.urgent ?? 0) > 0 ? 'critical' : undefined} active={view === 'urgent'} onClick={() => pick('urgent')} />
        <Stat label="14일 이내" value={`${data.counts.watch ?? 0}개`} active={view === 'watch'} onClick={() => pick('watch')} />
        <Stat label="과잉 재고" value={`${data.counts.excess ?? 0}개`} sub="90일치 이상 · 자금이 묶인다" active={view === 'excess'} onClick={() => pick('excess')} />
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-panel border border-line bg-paper px-5 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] text-ink-3">입고 리드타임</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              max={120}
              value={leadTime}
              onChange={e => setLeadTime(Math.max(0, Number(e.target.value) || 0))}
              className="w-20 rounded-control border border-line bg-paper px-2 py-1.5 text-right text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-accent"
            />
            <span className="text-[12px] text-ink-3">일</span>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] text-ink-3">목표 재고 기간</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={180}
              value={cover}
              onChange={e => setCover(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 rounded-control border border-line bg-paper px-2 py-1.5 text-right text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-accent"
            />
            <span className="text-[12px] text-ink-3">일</span>
          </div>
        </label>
        <p className="flex-1 text-[11.5px] leading-relaxed text-ink-3">
          입고 권장 수량은 로켓창고 재고가 리드타임과 목표 기간을 합친 기간 동안 버티도록 채우는 수량입니다.
          재고는 쿠팡 로켓창고의 판매가능수량이고, 판매 속도는 그로스 주문 기준입니다.
        </p>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={onlyRisk} onChange={e => setView(e.target.checked ? 'risky' : 'all')} className="h-4 w-4" />
          부족한 것만 보기
        </label>
      </div>

      <div className="flex items-start gap-2 rounded-panel border border-line bg-paper px-5 py-3">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" />
        <p className="text-[11.5px] leading-relaxed text-ink-3">
          품절이었던 기간에는 팔리지 않으므로 판매 속도가 실제 수요보다 낮게 잡힙니다. 남은 일수는 다소 낙관적으로 보시는 게 안전합니다.
        </p>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-panel border border-line bg-paper py-16 text-ink-3">
          <Boxes className="mb-4 h-12 w-12 opacity-20" />
          <p className="text-sm font-semibold">{view === 'all' ? '재고 데이터가 없습니다' : onlyRisk ? '재고가 부족한 상품이 없습니다' : '이 상태의 상품이 없습니다'}</p>
          <p className="mt-1.5 text-[12px]">
            {onlyRisk ? '14일 이내 소진될 상품이 없습니다.' : '로켓창고 재고가 아직 없습니다. [지금 수집]을 누르면 쿠팡에서 가져옵니다. 로켓그로스를 쓰지 않는 계정이면 이 화면은 비어 있습니다.'}
          </p>
        </div>
      ) : (
        <div className="rounded-panel border border-line bg-paper">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-[11.5px] text-ink-3">
                  <th className="px-4 py-2.5 text-left font-medium">상품</th>
                  <SortTh k="stock" label="로켓창고 재고" />
                  <SortTh k="sold7" label="7일 판매" />
                  <SortTh k="sold14" label="14일 판매" />
                  <SortTh k="velocity" label="일 평균" />
                  <SortTh k="daysLeft" label="남은 일수" />
                  <SortTh k="reorderQty" label="입고 권장" />
                  <th className="px-4 py-2.5 text-right font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => {
                  const meta = RISK_META[r.risk];
                  return (
                    <tr key={r.vendorItemId} className="border-b border-line/60 last:border-0">
                      <td className="max-w-[280px] px-4 py-2.5">
                        <p className="truncate text-ink">{r.productName}</p>
                        {r.optionName && <p className="truncate text-[11px] text-ink-3">{r.optionName}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{r.stock.toLocaleString('ko-KR')}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-3">{r.sold7.toLocaleString('ko-KR')}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-3">{r.sold14.toLocaleString('ko-KR')}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-3">{r.velocity > 0 ? r.velocity.toFixed(1) : '-'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink">
                        {r.daysLeft === null ? '-' : `${Math.floor(r.daysLeft)}일`}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                        {r.reorderQty > 0 ? `${r.reorderQty.toLocaleString('ko-KR')}개` : '-'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-control border px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}
                          >
                            {(r.risk === 'out' || r.risk === 'urgent') && <PackageX className="h-3 w-3" />}
                            {meta.label}
                          </span>
                          <ReorderModeButton row={r} onChanged={load} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label, value, sub, tone, active, onClick,
}: { label: string; value: string; sub?: string; tone?: 'critical'; active?: boolean; onClick?: () => void }) {
  // 카드가 곧 필터다. 누르면 그 상태의 상품만 남고, 눌린 카드는 테두리로 표시한다.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? '다시 누르면 부족한 것만 보기로 돌아갑니다' : '누르면 이 상태의 상품만 봅니다'}
      className={`rounded-panel border px-4 py-4 text-left transition-colors ${
        active ? 'border-accent bg-accent-soft' : 'border-line bg-paper hover:border-line-strong'
      }`}
    >
      <p className="text-[11.5px] text-ink-3">{label}</p>
      <p className={`mt-1 text-[19px] font-semibold tabular-nums ${tone === 'critical' ? 'text-critical' : 'text-ink'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-tight text-ink-3">{sub}</p>}
    </button>
  );
}

/**
 * 발주 알림에서 이 옵션을 뺄지 정한다.
 *
 * 자동 판단은 '최근에 아직 팔리는가'만 본다. 그래서 곧 시즌이 시작될 상품을
 * 알 수 없다 — 겨울 패딩은 9월에 안 팔리지만 10월 발주는 해야 한다. 반대로
 * 단종한 상품은 잘 팔리는 중에도 채울 이유가 없다. 그 두 경우를 손으로 고정한다.
 */
function ReorderModeButton({ row, onChanged }: { row: InventoryRow; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState(row.reorderMode);

  // 서버에서 새로 받아온 값이 내 것과 다르면 그쪽을 따른다
  useEffect(() => { setMode(row.reorderMode); }, [row.reorderMode]);

  const cycle = async () => {
    if (saving) return;
    const next = mode === 'auto' ? 'exclude' : mode === 'exclude' ? 'always' : 'auto';
    setSaving(true);
    setMode(next);
    try {
      await coupangApi.reorderRule(row.vendorItemId, next);
      onChanged();
    } catch {
      setMode(row.reorderMode);   // 실패하면 되돌린다
    } finally {
      setSaving(false);
    }
  };

  const meta = {
    auto: { icon: null, title: '자동 판단 — 최근에 팔리면 발주 알림에 넣습니다. 눌러서 제외로 바꿉니다.', cls: 'text-ink-3 hover:text-ink' },
    exclude: { icon: <BellOff className="h-3.5 w-3.5" />, title: '발주 알림에서 제외 (시즌 종료·단종). 눌러서 항상 포함으로 바꿉니다.', cls: 'text-critical' },
    always: { icon: <BellRing className="h-3.5 w-3.5" />, title: '판매가 없어도 항상 알림 (곧 시즌이 오는 상품). 눌러서 자동으로 되돌립니다.', cls: 'text-accent' },
  }[mode];

  return (
    <button
      type="button"
      onClick={cycle}
      disabled={saving}
      title={meta.title}
      aria-label={meta.title}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-line transition-colors disabled:opacity-45 ${meta.cls}`}
    >
      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : meta.icon ?? <span className="text-[10px]">자동</span>}
    </button>
  );
}
