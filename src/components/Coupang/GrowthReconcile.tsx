/**
 * [4-2] 그로스 재고 대조
 *
 * 로켓창고 재고는 쿠팡이 알려주지만, 그 재고가 "내가 보낸 만큼"인지는 아무도 말해
 * 주지 않는다. 사입 주문·입고는 여기서 판매자가 적고, 판매는 그로스 주문에서
 * 자동으로 센다.
 *
 *   예상 재고 = 기준 재고 + 그 뒤 입고 − 그 뒤 판매
 *   차이      = 쿠팡 재고 − 예상 재고   (음수: 미입고·분실·불량 / 양수: 반품 재입고 등)
 *
 * 처음엔 "지금 재고를 기준으로 시작"을 눌러 오늘 재고를 기준으로 잡고, 그 뒤로
 * 사입 주문과 입고를 적어 나가면 된다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, ChevronDown, ChevronUp, Loader2, Plus, Scale, Trash2 } from 'lucide-react';
import { coupangApi, type InboundRecord, type ReconcileResponse, type ReconcileRow, type ReconcileStatus } from '../../lib/coupang';

const STATUS_META: Record<ReconcileStatus, { label: string; className: string }> = {
  short: { label: '부족', className: 'border-critical/35 bg-critical-soft text-critical' },
  over: { label: '초과', className: 'border-line-strong bg-paper text-ink-2' },
  match: { label: '일치', className: 'border-line bg-paper text-ink-3' },
  nobase: { label: '기준 없음', className: 'border-line bg-paper text-ink-3' },
};

const num = (n: number | null | undefined) => (n === null || n === undefined ? '-' : n.toLocaleString('ko-KR'));
const today = () => {
  // 화면은 한국 시간 기준 오늘을 쓴다. 서버도 KST로 셈한다.
  const d = new Date(Date.now() + 9 * 3600_000);
  return d.toISOString().slice(0, 10);
};

type Draft = {
  kind: 'inbound' | 'baseline';
  orderedAt: string;
  orderedQty: string;
  receivedAt: string;
  receivedQty: string;
  memo: string;
};
const emptyDraft = (): Draft => ({ kind: 'inbound', orderedAt: today(), orderedQty: '', receivedAt: '', receivedQty: '', memo: '' });

export function GrowthReconcile() {
  const [data, setData] = useState<ReconcileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<'all' | 'tracked' | 'off'>('all');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await coupangApi.growthReconcile();
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toast = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 3000);
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.rows.filter(r => {
      if (view === 'tracked' && r.status === 'nobase') return false;
      if (view === 'off' && (r.status === 'nobase' || r.status === 'match')) return false;
      if (!needle) return true;
      return `${r.productName} ${r.optionName} ${r.vendorItemId}`.toLowerCase().includes(needle);
    });
  }, [data, view, q]);

  if (error) {
    return <div className="rounded-panel border border-critical/35 bg-critical-soft p-5 text-[13px] text-ink-2">{error}</div>;
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 py-14 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[13px]">재고를 대조하는 중...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="대조 중인 옵션" value={`${data.counts.tracked}개`} sub="기준 재고나 입고 기록이 있는 옵션" />
        <Stat label="쿠팡 재고가 부족" value={`${data.counts.short}개`} tone={data.counts.short > 0 ? 'critical' : undefined} sub="보낸 것보다 적다 — 미입고·분실·불량" />
        <Stat label="쿠팡 재고가 초과" value={`${data.counts.over}개`} sub="예상보다 많다 — 반품 재입고 등" />
        <Stat label="주문 후 미입고" value={`${num(data.counts.pendingQty)}개`} sub="사입 주문했는데 입고 기록이 없는 수량" />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-paper px-5 py-4">
        <p className="flex-1 min-w-[260px] text-[11.5px] leading-relaxed text-ink-3">
          <span className="font-semibold text-ink-2">예상 재고 = 기준 재고 + 그 뒤 입고 − 그 뒤 판매.</span> 쿠팡 재고와의 차이가 미입고·분실·불량입니다.
          처음엔 옵션을 펼쳐 <span className="text-ink-2">[지금 재고를 기준으로 시작]</span>을 누르고, 그 뒤로 사입 주문과 입고를 적어 나가세요.
          판매는 그로스 주문에서 자동으로 셉니다.
        </p>
        <div className="flex items-center gap-1.5">
          {(['all', 'tracked', 'off'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-control px-3 py-1.5 text-[12px] font-medium transition-colors ${
                view === v ? 'bg-ink text-paper' : 'border border-line text-ink-2 hover:text-ink'
              }`}
            >
              {v === 'all' ? '전체' : v === 'tracked' ? '대조 중' : '어긋난 것만'}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="상품·옵션 검색"
          className="w-44 rounded-control border border-line bg-paper px-3 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {msg && <p className="text-[12.5px] text-ink-2">{msg}</p>}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-panel border border-line bg-paper py-16 text-ink-3">
          <Boxes className="mb-4 h-12 w-12 opacity-20" />
          <p className="text-sm font-semibold">{data.rows.length === 0 ? '로켓창고 재고가 없습니다' : '해당하는 옵션이 없습니다'}</p>
          <p className="mt-1.5 text-[12px]">
            {data.rows.length === 0 ? '[지금 수집]을 누르면 쿠팡에서 재고를 가져옵니다. 로켓그로스를 쓰지 않는 계정이면 이 화면은 비어 있습니다.' : '검색어나 보기를 바꿔 보세요.'}
          </p>
        </div>
      ) : (
        <div className="rounded-panel border border-line bg-paper">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-[11.5px] text-ink-3">
                  <th className="px-4 py-2.5 text-left font-medium">상품</th>
                  <th className="px-3 py-2.5 text-right font-medium">기준 재고<span className="block text-[10px] font-normal">시작일</span></th>
                  <th className="px-3 py-2.5 text-right font-medium">사입 주문<span className="block text-[10px] font-normal">누계</span></th>
                  <th className="px-3 py-2.5 text-right font-medium">입고<span className="block text-[10px] font-normal">기준일 뒤</span></th>
                  <th className="px-3 py-2.5 text-right font-medium">판매<span className="block text-[10px] font-normal">기준일 뒤</span></th>
                  <th className="px-3 py-2.5 text-right font-medium">예상 재고</th>
                  <th className="px-3 py-2.5 text-right font-medium">쿠팡 재고</th>
                  <th className="px-3 py-2.5 text-right font-medium">차이</th>
                  <th className="px-4 py-2.5 text-right font-medium">기록</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const meta = STATUS_META[r.status];
                  const isOpen = open === r.vendorItemId;
                  return (
                    <RowGroup
                      key={r.vendorItemId}
                      row={r}
                      meta={meta}
                      isOpen={isOpen}
                      onToggle={() => setOpen(isOpen ? null : r.vendorItemId)}
                      onChanged={async (m) => { toast(m); await load(); }}
                    />
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

function RowGroup({
  row, meta, isOpen, onToggle, onChanged,
}: {
  row: ReconcileRow;
  meta: { label: string; className: string };
  isOpen: boolean;
  onToggle: () => void;
  onChanged: (msg: string) => Promise<void>;
}) {
  const diffTone = row.diff === null ? 'text-ink-3' : row.diff < 0 ? 'text-critical' : row.diff > 0 ? 'text-ink-2' : 'text-ink-3';
  return (
    <>
      <tr className="border-b border-line/60">
        <td className="max-w-[280px] px-4 py-2.5">
          <p className="truncate text-ink">{row.productName}</p>
          {row.optionName && <p className="truncate text-[11px] text-ink-3">{row.optionName}</p>}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
          {row.hasBaseline ? num(row.baselineQty) : row.startDate ? '0' : '-'}
          {row.startDate && <span className="block text-[10px] text-ink-3">{row.startDate}</span>}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-ink-3">
          {num(row.orderedTotal)}
          {row.pendingQty > 0 && <span className="block text-[10px] text-critical">미입고 {num(row.pendingQty)}</span>}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{row.startDate ? num(row.receivedAfter) : '-'}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{row.startDate ? num(row.soldAfter) : '-'}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-ink">{num(row.expected)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-ink">
          {num(row.stock)}
          {row.coupangSold30 !== null && <span className="block text-[10px] text-ink-3">30일 판매 {num(row.coupangSold30)}</span>}
        </td>
        <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${diffTone}`}>
          {row.diff === null ? '-' : `${row.diff > 0 ? '+' : ''}${num(row.diff)}`}
          <span className={`ml-1.5 inline-flex rounded-control border px-1.5 py-0.5 text-[10.5px] font-semibold ${meta.className}`}>{meta.label}</span>
        </td>
        <td className="px-4 py-2.5 text-right">
          <button
            onClick={onToggle}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-control border border-line px-2.5 py-1 text-[11.5px] text-ink-2 hover:border-line-strong hover:text-ink"
          >
            {row.records.length}건 {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b border-line/60 bg-paper-2/40">
          <td colSpan={9} className="px-4 py-3">
            <RecordsPanel row={row} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

function RecordsPanel({ row, onChanged }: { row: ReconcileRow; onChanged: (msg: string) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [busy, setBusy] = useState(false);

  const startBaseline = async () => {
    if (busy || row.stock === null) return;
    setBusy(true);
    try {
      await coupangApi.growthInboundSave({ vendorItemId: row.vendorItemId, kind: 'baseline', receivedAt: today(), receivedQty: row.stock });
      await onChanged(`오늘 재고 ${num(row.stock)}개를 기준으로 대조를 시작합니다.`);
    } catch (e: any) {
      await onChanged(e.message ?? '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await coupangApi.growthInboundSave({
        vendorItemId: row.vendorItemId,
        kind: draft.kind,
        orderedAt: draft.orderedAt || null,
        orderedQty: Number(draft.orderedQty) || 0,
        receivedAt: draft.receivedAt || null,
        receivedQty: draft.receivedQty === '' ? null : Number(draft.receivedQty) || 0,
        memo: draft.memo,
      });
      setDraft(emptyDraft());
      await onChanged('기록했습니다.');
    } catch (e: any) {
      await onChanged(e.message ?? '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rec: InboundRecord) => {
    if (busy) return;
    if (!window.confirm('이 기록을 지울까요?')) return;
    setBusy(true);
    try {
      await coupangApi.growthInboundDelete(rec.id);
      await onChanged('지웠습니다.');
    } catch (e: any) {
      await onChanged(e.message ?? '지우지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const input = 'rounded-control border border-line bg-paper px-2 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-accent';

  return (
    <div className="flex flex-col gap-3">
      {!row.hasBaseline && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-paper px-4 py-3">
          <Scale className="h-4 w-4 shrink-0 text-ink-3" />
          <p className="flex-1 min-w-[240px] text-[12px] text-ink-2">
            기준 재고가 없습니다. 지금 쿠팡 재고{row.stock !== null ? ` ${num(row.stock)}개` : ''}를 기준으로 잡으면 오늘부터의 입고·판매로 대조합니다.
            {row.startDate && ' 지금은 첫 입고 기록일부터 0에서 셉니다.'}
          </p>
          <button
            onClick={startBaseline}
            disabled={busy || row.stock === null}
            className="min-h-[36px] rounded-control bg-accent px-3 py-1.5 text-[12px] font-bold text-ground hover:opacity-90 disabled:opacity-40"
          >
            지금 재고를 기준으로 시작
          </button>
        </div>
      )}

      {row.records.length > 0 && (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[11px] text-ink-3">
              <th className="py-1.5 text-left font-medium">구분</th>
              <th className="py-1.5 text-left font-medium">주문일</th>
              <th className="py-1.5 text-right font-medium">주문수량</th>
              <th className="py-1.5 text-left font-medium pl-4">입고일</th>
              <th className="py-1.5 text-right font-medium">입고수량</th>
              <th className="py-1.5 text-left font-medium pl-4">메모</th>
              <th className="py-1.5 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {row.records.map(rec => (
              <tr key={rec.id} className="border-t border-line/50">
                <td className="py-1.5 text-ink-2">{rec.kind === 'baseline' ? '기준 재고' : '사입'}</td>
                <td className="py-1.5 tabular-nums text-ink-2">{rec.kind === 'baseline' ? '-' : rec.orderedAt ?? '-'}</td>
                <td className="py-1.5 text-right tabular-nums text-ink-2">{rec.kind === 'baseline' ? '-' : num(rec.orderedQty)}</td>
                <td className="py-1.5 pl-4 tabular-nums text-ink-2">{rec.receivedAt ?? <span className="text-critical">미입고</span>}</td>
                <td className="py-1.5 text-right tabular-nums text-ink">{num(rec.receivedQty)}</td>
                <td className="py-1.5 pl-4 text-ink-3">{rec.memo}</td>
                <td className="py-1.5 text-right">
                  <button onClick={() => remove(rec)} disabled={busy} className="inline-flex h-8 w-8 items-center justify-center rounded-control text-ink-3 hover:text-critical" title="지우기">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-paper px-4 py-3">
        <label className="flex flex-col gap-1 text-[11px] text-ink-3">
          구분
          <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })} className={input}>
            <option value="inbound">사입 주문 → 입고</option>
            <option value="baseline">기준 재고</option>
          </select>
        </label>
        {draft.kind === 'inbound' && (
          <>
            <label className="flex flex-col gap-1 text-[11px] text-ink-3">
              주문일
              <input type="date" value={draft.orderedAt} onChange={e => setDraft({ ...draft, orderedAt: e.target.value })} className={input} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-3">
              주문수량
              <input type="number" min={0} value={draft.orderedQty} onChange={e => setDraft({ ...draft, orderedQty: e.target.value })} className={`${input} w-24 text-right tabular-nums`} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-[11px] text-ink-3">
          {draft.kind === 'baseline' ? '기준일' : '입고일 (비우면 미입고)'}
          <input type="date" value={draft.receivedAt} onChange={e => setDraft({ ...draft, receivedAt: e.target.value })} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-ink-3">
          {draft.kind === 'baseline' ? '그날 재고' : '입고수량'}
          <input type="number" min={0} value={draft.receivedQty} onChange={e => setDraft({ ...draft, receivedQty: e.target.value })} className={`${input} w-24 text-right tabular-nums`} />
        </label>
        <label className="flex flex-1 min-w-[160px] flex-col gap-1 text-[11px] text-ink-3">
          메모
          <input value={draft.memo} onChange={e => setDraft({ ...draft, memo: e.target.value })} placeholder="송장·거래처 등" className={input} />
        </label>
        <button
          onClick={save}
          disabled={busy}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-control bg-accent px-3 py-1.5 text-[12px] font-bold text-ground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          기록
        </button>
      </div>

      {row.snapshots.length > 1 && (
        <p className="text-[11px] text-ink-3">
          최근 30일 쿠팡 재고 흐름: {row.snapshots.map(s => `${s.date.slice(5)} ${num(s.qty)}`).join(' → ')}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'critical' }) {
  return (
    <div className="rounded-panel border border-line bg-paper px-4 py-4">
      <p className="text-[11.5px] text-ink-3">{label}</p>
      <p className={`mt-1 text-[20px] font-bold tabular-nums ${tone === 'critical' ? 'text-critical' : 'text-ink'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-ink-3">{sub}</p>}
    </div>
  );
}
