/**
 * 원가 입력 — 순이익 계산의 유일한 수동 입력값.
 *
 * 판매가·수수료·정산액은 쿠팡이 주지만 매입원가는 판매자만 안다.
 * 많이 팔리는데 원가가 비어 있는 옵션을 맨 위로 올려, 몇 개만 채워도
 * 순이익 숫자가 곧바로 쓸모 있어지게 만든다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Search } from 'lucide-react';
import { coupangApi, won, type CostRow } from '../../lib/coupang';

type Draft = Record<string, Partial<CostRow>>;

const FIELDS: Array<{ key: keyof CostRow; label: string; hint: string }> = [
  { key: 'unitCost', label: '매입원가', hint: '개당 사입가' },
  { key: 'packagingCost', label: '부자재', hint: '박스·완충재' },
  { key: 'shippingCost', label: '출고배송', hint: '개당 택배비' },
  { key: 'returnShippingCost', label: '반품배송', hint: '1건 왕복' },
];

export function CostEditor({ onSaved }: { onSaved?: () => void }) {
  const [rows, setRows] = useState<CostRow[] | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { rows } = await coupangApi.costs();
      setRows(rows);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const edit = (id: string, key: keyof CostRow, value: number) => {
    setDraft(d => ({ ...d, [id]: { ...d[id], [key]: Math.max(0, Math.round(value) || 0) } }));
  };

  const valueOf = (row: CostRow, key: keyof CostRow): number => {
    const d = draft[row.vendorItemId]?.[key];
    return typeof d === 'number' ? d : (row[key] as number) ?? 0;
  };

  const dirtyCount = Object.keys(draft).length;

  const save = async () => {
    if (dirtyCount === 0 || saving || !rows) return;
    setSaving(true);
    setMsg(null);
    try {
      const items = (Object.entries(draft) as Array<[string, Partial<CostRow>]>).map(([vendorItemId, patch]) => {
        const base = rows.find(r => r.vendorItemId === vendorItemId);
        return {
          vendorItemId,
          unitCost: patch.unitCost ?? base?.unitCost ?? 0,
          packagingCost: patch.packagingCost ?? base?.packagingCost ?? 0,
          shippingCost: patch.shippingCost ?? base?.shippingCost ?? 0,
          returnShippingCost: patch.returnShippingCost ?? base?.returnShippingCost ?? 0,
        };
      });
      const { saved } = await coupangApi.saveCosts(items);
      setDraft({});
      setMsg(`${saved}개 저장했습니다.`);
      await load();
      onSaved?.();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r => `${r.productName} ${r.optionName}`.toLowerCase().includes(needle));
  }, [rows, q]);

  if (error) {
    return <div className="rounded-panel border border-critical/35 bg-critical-soft p-5 text-[13px] text-ink-2">{error}</div>;
  }
  if (!rows) {
    return (
      <div className="flex items-center gap-2 py-14 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[13px]">상품을 불러오는 중...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-panel border border-line bg-paper p-5">
        <h3 className="mb-1 text-sm font-semibold text-ink">원가 입력</h3>
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          한 번만 넣으면 이후 순이익이 자동으로 계산됩니다. 최근 30일 판매가 많은데 원가가 비어 있는 옵션을 위로 올렸습니다.
          부자재·배송비를 모르면 매입원가만 넣어도 됩니다.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="상품명으로 찾기"
            className="w-full rounded-control border border-line bg-paper py-2 pl-9 pr-3 text-[13px] outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <button
          onClick={save}
          disabled={dirtyCount === 0 || saving}
          className="flex items-center gap-1.5 rounded-control bg-accent px-4 py-2 text-[13px] font-bold text-ground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {dirtyCount > 0 ? `${dirtyCount}개 저장` : '저장'}
        </button>
      </div>

      {msg && <p className="text-[12.5px] text-ink-2">{msg}</p>}

      <div className="rounded-panel border border-line bg-paper">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] text-ink-3">
                <th className="px-4 py-2.5 text-left font-medium">상품</th>
                <th className="px-3 py-2.5 text-right font-medium">판매가</th>
                <th className="px-3 py-2.5 text-right font-medium">30일 판매</th>
                {FIELDS.map(f => (
                  <th key={String(f.key)} className="px-3 py-2.5 text-right font-medium">
                    {f.label}
                    <span className="block text-[10px] font-normal text-ink-3">{f.hint}</span>
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right font-medium">개당 남는 돈</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const totalCost = FIELDS.filter(f => f.key !== 'returnShippingCost').reduce(
                  (n, f) => n + valueOf(r, f.key),
                  0,
                );
                // 수수료율은 상품마다 달라 여기서는 원가만 뺀 값을 보여준다.
                const gross = (r.salePrice ?? 0) - totalCost;
                return (
                  <tr key={r.vendorItemId} className="border-b border-line/60 last:border-0">
                    <td className="max-w-[280px] px-4 py-2">
                      <p className="truncate text-ink">{r.productName}</p>
                      {r.optionName && <p className="truncate text-[11px] text-ink-3">{r.optionName}</p>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-2">{r.salePrice ? won(r.salePrice) : '-'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-3">{r.soldLast30.toLocaleString('ko-KR')}</td>
                    {FIELDS.map(f => (
                      <td key={String(f.key)} className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={valueOf(r, f.key)}
                          onChange={e => edit(r.vendorItemId, f.key, Number(e.target.value))}
                          className="w-[86px] rounded-control border border-line bg-paper-2 px-2 py-1.5 text-right text-[12px] tabular-nums outline-none focus:ring-2 focus:ring-accent"
                        />
                      </td>
                    ))}
                    <td className={`px-4 py-2 text-right font-semibold tabular-nums ${gross >= 0 ? 'text-ink' : 'text-critical'}`}>
                      {r.salePrice ? won(gross) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="px-5 py-10 text-center text-[13px] text-ink-3">
            {rows.length === 0 ? '수집된 상품이 없습니다. 먼저 [지금 수집]을 눌러주세요.' : '검색 결과가 없습니다.'}
          </p>
        )}
      </div>
    </div>
  );
}
