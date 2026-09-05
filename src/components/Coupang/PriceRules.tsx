/**
 * [9] 마진 하한 가격 조정
 *
 * 판매자 돈이 직접 움직이는 화면이라 다른 곳과 규칙이 다르다.
 *  · 기본은 제안이다. 반영은 사람이 누른다.
 *  · 자동 반영은 옵션마다 따로 켜야 하고, 하루 변동폭이 제한된다.
 *  · 어떤 경로로도 마진 하한 아래로는 못 내린다. 화면에서 막고 서버에서 또 막는다.
 *
 * 하한가는 그 상품의 실제 수수료율로 역산한다. 카테고리마다 수수료가 달라
 * 고정값을 쓰면 어떤 상품은 하한을 지켰는데도 적자가 난다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Save, Search, Tag } from 'lucide-react';
import { coupangApi, pct, won, type PriceLog, type PriceRow } from '../../lib/coupang';

type Draft = Record<string, Partial<PriceRow>>;

export function PriceRules({ onEditCosts }: { onEditCosts: () => void }) {
  const [rows, setRows] = useState<PriceRow[] | null>(null);
  const [logs, setLogs] = useState<PriceLog[]>([]);
  const [maxChange, setMaxChange] = useState(10);
  const [draft, setDraft] = useState<Draft>({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await coupangApi.priceRules();
      setRows(r.rows);
      setLogs(r.logs);
      setMaxChange(r.autoApplyMaxChangePct);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const edit = (id: string, patch: Partial<PriceRow>) => setDraft(d => ({ ...d, [id]: { ...d[id], ...patch } }));
  const valueOf = <K extends keyof PriceRow>(row: PriceRow, key: K): PriceRow[K] => {
    const d = draft[row.vendorItemId]?.[key];
    return (d === undefined ? row[key] : d) as PriceRow[K];
  };

  const dirtyCount = Object.keys(draft).length;

  const saveRules = async () => {
    if (dirtyCount === 0 || saving || !rows) return;
    setSaving(true);
    setMsg(null);
    try {
      const items = Object.keys(draft).map(id => {
        const base = rows.find(r => r.vendorItemId === id)!;
        return {
          vendorItemId: id,
          enabled: valueOf(base, 'enabled'),
          autoApply: valueOf(base, 'autoApply'),
          minMarginRate: valueOf(base, 'minMarginRate'),
          minPrice: valueOf(base, 'minPrice'),
          maxPrice: valueOf(base, 'maxPrice'),
          targetKeyword: valueOf(base, 'targetKeyword'),
        };
      });
      const { saved } = await coupangApi.savePriceRules(items);
      setDraft({});
      setMsg(`${saved}개 규칙을 저장했습니다.`);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  const apply = async (row: PriceRow) => {
    if (row.suggestedPrice === null) return;
    if (
      !confirm(
        `"${row.productName}"의 판매가를 ${won(row.currentPrice ?? 0)} → ${won(row.suggestedPrice)}로 즉시 변경합니다.\n쿠팡에 바로 반영됩니다. 진행할까요?`,
      )
    )
      return;
    setBusy(row.vendorItemId);
    setMsg(null);
    try {
      await coupangApi.applyPrice(row.vendorItemId, row.suggestedPrice, row.currentPrice);
      setMsg('가격을 반영했습니다.');
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(null);
    }
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r => `${r.productName} ${r.optionName}`.toLowerCase().includes(needle));
  }, [rows, q]);

  const belowFloorCount = rows?.filter(r => r.belowFloor).length ?? 0;
  const missingCost = rows?.filter(r => !r.costEntered).length ?? 0;

  if (error) {
    return <div className="rounded-panel border border-critical/35 bg-critical-soft p-5 text-[13px] text-ink-2">{error}</div>;
  }
  if (!rows) {
    return (
      <div className="flex items-center gap-2 py-14 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[13px]">가격을 검토하는 중...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-panel border border-line bg-paper p-5">
        <div className="mb-1 flex items-center gap-2">
          <Tag className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-ink">마진 하한 가격 조정</h3>
        </div>
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          하한가는 원가와 <b>그 상품의 실제 수수료율</b>로 역산합니다. 어떤 경우에도 하한 아래로는 내려가지 않습니다.
          경쟁가는 소싱AI가 이미 모아 둔 관측치의 중앙값을 쓰므로 추가 수집 비용이 들지 않습니다.
          자동 반영을 켜면 매일 오전 9시에 하루 <b>{maxChange}%</b>, 7일 누적 20% 이내로만 조정합니다. 반영 직전에 쿠팡의 현재가를 다시 읽어 그 기준으로 검사합니다.
        </p>
      </div>

      {belowFloorCount > 0 && (
        <div className="flex items-start gap-2 rounded-panel border border-critical/35 bg-critical-soft px-5 py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" />
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            <b className="text-ink">{belowFloorCount}개 상품이 마진 하한 아래에서 팔리고 있습니다.</b> 지금은 팔릴수록 손해입니다.
          </p>
        </div>
      )}

      {missingCost > 0 && (
        <div className="rounded-panel border border-line bg-paper px-5 py-4 text-[12.5px] leading-relaxed text-ink-2">
          원가를 입력하지 않은 상품이 <b className="text-ink">{missingCost}개</b> 있어 하한가를 계산할 수 없습니다.{' '}
          <button onClick={onEditCosts} className="font-semibold text-accent hover:underline">
            원가 입력하러 가기
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="상품명으로 찾기"
            className="w-full rounded-control border border-line bg-paper py-2 pl-9 pr-3 text-[13px] outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <button
          onClick={saveRules}
          disabled={dirtyCount === 0 || saving}
          className="flex items-center gap-1.5 rounded-control bg-accent px-4 py-2 text-[13px] font-bold text-ground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {dirtyCount > 0 ? `규칙 ${dirtyCount}개 저장` : '규칙 저장'}
        </button>
      </div>

      {msg && <p className="text-[12.5px] text-ink-2">{msg}</p>}

      <div className="rounded-panel border border-line bg-paper">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] text-ink-3">
                <th className="px-4 py-2.5 text-left font-medium">상품</th>
                <th className="px-3 py-2.5 text-right font-medium">현재가</th>
                <th className="px-3 py-2.5 text-right font-medium">수수료율</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  목표 이익률
                  <span className="block text-[10px] font-normal">하한가 기준</span>
                </th>
                <th className="px-3 py-2.5 text-right font-medium">하한가</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  절대 하한
                  <span className="block text-[10px] font-normal">선택</span>
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  절대 상한
                  <span className="block text-[10px] font-normal">선택</span>
                </th>
                <th className="px-3 py-2.5 text-left font-medium">비교 키워드</th>
                <th className="px-3 py-2.5 text-right font-medium">시장가</th>
                <th className="px-3 py-2.5 text-center font-medium">자동</th>
                <th className="px-4 py-2.5 text-right font-medium">제안</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.vendorItemId} className={`border-b border-line/60 last:border-0 ${r.belowFloor ? 'bg-critical-soft' : ''}`}>
                  <td className="max-w-[220px] px-4 py-2">
                    <p className="truncate text-ink">{r.productName}</p>
                    {r.optionName && <p className="truncate text-[11px] text-ink-3">{r.optionName}</p>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{r.currentPrice ? won(r.currentPrice) : '-'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-3">{pct(r.commissionRate)}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      max={90}
                      value={valueOf(r, 'minMarginRate')}
                      onChange={e => edit(r.vendorItemId, { minMarginRate: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-[64px] rounded-control border border-line bg-paper-2 px-2 py-1.5 text-right text-[12px] tabular-nums outline-none focus:ring-2 focus:ring-accent"
                    />
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.belowFloor ? 'text-critical' : 'text-ink'}`}>
                    {r.floorPrice ? won(r.floorPrice) : '-'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      value={valueOf(r, 'minPrice') ?? ''}
                      onChange={e => edit(r.vendorItemId, { minPrice: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })}
                      placeholder="없음"
                      className="w-[84px] rounded-control border border-line bg-paper-2 px-2 py-1.5 text-right text-[12px] tabular-nums outline-none focus:ring-2 focus:ring-accent"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      value={valueOf(r, 'maxPrice') ?? ''}
                      onChange={e => edit(r.vendorItemId, { maxPrice: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })}
                      placeholder="없음"
                      className="w-[84px] rounded-control border border-line bg-paper-2 px-2 py-1.5 text-right text-[12px] tabular-nums outline-none focus:ring-2 focus:ring-accent"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={valueOf(r, 'targetKeyword') ?? ''}
                      onChange={e => edit(r.vendorItemId, { targetKeyword: e.target.value })}
                      placeholder="예: 캠핑의자"
                      className="w-[110px] rounded-control border border-line bg-paper-2 px-2 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-accent"
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-3">{r.marketPrice ? won(r.marketPrice) : '-'}</td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={Boolean(valueOf(r, 'autoApply'))}
                      onChange={e => edit(r.vendorItemId, { autoApply: e.target.checked })}
                      disabled={!r.costEntered}
                      title={r.costEntered ? '매일 오전 9시 자동 반영' : '원가를 먼저 입력해야 합니다'}
                      className="h-4 w-4 disabled:opacity-30"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.suggestedPrice !== null ? (
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={() => apply(r)}
                          disabled={busy === r.vendorItemId}
                          className="flex items-center gap-1 rounded-control border border-accent-line bg-accent-soft px-2.5 py-1 text-[11.5px] font-semibold text-ink transition-opacity hover:opacity-80 disabled:opacity-50"
                        >
                          {busy === r.vendorItemId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          {won(r.suggestedPrice)}로 변경
                        </button>
                        <span className="max-w-[220px] text-right text-[10.5px] leading-tight text-ink-3">{r.reason}</span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-ink-3">{r.reason}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="px-5 py-10 text-center text-[13px] text-ink-3">
            {rows.length === 0 ? '수집된 상품이 없습니다. 먼저 [지금 수집]을 눌러주세요.' : '검색 결과가 없습니다.'}
          </p>
        )}
      </div>

      {logs.length > 0 && (
        <div className="rounded-panel border border-line bg-paper">
          <h3 className="border-b border-line px-5 py-4 text-sm font-semibold text-ink">가격 변경 기록</h3>
          <ul className="divide-y divide-line/60">
            {logs.map((l, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-[12px]">
                <span className="text-ink-3">{new Date(l.created_at).toLocaleString('ko-KR')}</span>
                <span className="tabular-nums text-ink-2">
                  {l.old_price ? won(l.old_price) : '-'} → {l.new_price ? won(l.new_price) : '-'}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-3">{l.reason}</span>
                <span className={l.applied ? 'text-positive' : 'text-critical'}>{l.applied ? '반영됨' : `실패: ${l.error ?? ''}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
