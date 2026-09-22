/**
 * 1688 매입 원가 계산.
 *
 * 원가를 안 넣는 회원이 많다. 원가가 비면 순이익, 진단 카드, 광고 마진이 전부
 * 틀어진다. 위안 단가·수량·배송비·관세·부가세만 적으면 개당 입고 원가가 나오고,
 * 저장하면서 원가 현황에 바로 넣는다. 같은 옵션을 여러 번 매입하면 가중평균이다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, PackageSearch, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { coupangApi, won, type CostRow, type PurchaseRow, type PurchaseSummary } from '../../lib/coupang';
import { landedTotal, landedUnit, type PurchaseInput } from '../../lib/landedCost';

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

const EMPTY_FORM = {
  id: '', productName: '', vendorItemId: '', purchasedOn: todayKst(), qty: '', unitPriceCny: '', fxRate: '',
  domesticShipCny: '', intlShipKrw: '', customsKrw: '', vatKrw: '', otherKrw: '', includeVat: false, memo: '', applyCost: true,
};

export function Purchases({ onGoCosts }: { onGoCosts?: () => void }) {
  const [rows, setRows] = useState<PurchaseRow[] | null>(null);
  const [summary, setSummary] = useState<PurchaseSummary[]>([]);
  const [options, setOptions] = useState<CostRow[]>([]);
  const [fx, setFx] = useState<{ rate: number | null; fetchedAt: string | null; stale: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [productFilter, setProductFilter] = useState('');

  // 쿠팡은 '상품명 · 옵션명'이고 같은 상품의 옵션은 원가가 거의 같다.
  // 상품을 먼저 고르고, 옵션은 '전체'가 기본이다.
  const products = useMemo(() => {
    const map = new Map<string, CostRow[]>();
    for (const o of options) {
      const k = o.productName || o.vendorItemId;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(o);
    }
    return [...map.entries()].map(([name, opts]) => ({ name, opts })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [options]);
  const productChoices = useMemo(() => {
    const needle = productFilter.trim().toLowerCase();
    return needle ? products.filter(p => p.name.toLowerCase().includes(needle)) : products;
  }, [products, productFilter]);
  const chosenProduct = products.find(p => p.name === form.productName) ?? null;
  const targetIds = chosenProduct ? (form.vendorItemId ? [form.vendorItemId] : chosenProduct.opts.map(o => o.vendorItemId)) : [];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c, f] = await Promise.all([
        coupangApi.purchases(),
        coupangApi.costs().catch(() => ({ rows: [] as CostRow[] })),
        coupangApi.fxRate().catch(() => ({ rate: null, fetchedAt: null, stale: true })),
      ]);
      setRows(p.rows);
      setSummary(p.summary);
      setOptions(c.rows);
      setFx(f);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const input: PurchaseInput = {
    qty: Number(form.qty) || 0, unitPriceCny: Number(form.unitPriceCny) || 0, fxRate: Number(form.fxRate) || 0,
    domesticShipCny: Number(form.domesticShipCny) || 0, intlShipKrw: Number(form.intlShipKrw) || 0,
    customsKrw: Number(form.customsKrw) || 0, vatKrw: Number(form.vatKrw) || 0, otherKrw: Number(form.otherKrw) || 0,
    includeVat: form.includeVat,
  };
  const previewUnit = landedUnit(input);
  const previewTotal = landedTotal(input);

  const openNew = () => {
    setForm({ ...EMPTY_FORM, purchasedOn: todayKst(), fxRate: fx?.rate ? String(fx.rate) : '' });
    setShowForm(true);
  };
  const openEdit = (r: PurchaseRow) => {
    setForm({
      id: r.id, productName: r.productName, vendorItemId: r.vendorItemIds.length > 1 ? '' : r.vendorItemId, purchasedOn: r.purchasedOn, qty: String(r.qty), unitPriceCny: String(r.unitPriceCny),
      fxRate: String(r.fxRate), domesticShipCny: String(r.domesticShipCny || ''), intlShipKrw: String(r.intlShipKrw || ''),
      customsKrw: String(r.customsKrw || ''), vatKrw: String(r.vatKrw || ''), otherKrw: String(r.otherKrw || ''),
      includeVat: r.includeVat, memo: r.memo, applyCost: true,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (targetIds.length === 0) { setError('상품을 고르세요.'); return; }
    if (!(Number(form.qty) > 0)) { setError('수량은 1 이상이어야 합니다.'); return; }
    if (!(Number(form.fxRate) > 0)) { setError('환율을 입력하세요.'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await coupangApi.purchaseSave({
        id: form.id || undefined, vendorItemIds: targetIds, purchasedOn: form.purchasedOn, qty: Number(form.qty),
        unitPriceCny: Number(form.unitPriceCny) || 0, fxRate: Number(form.fxRate), domesticShipCny: Number(form.domesticShipCny) || 0,
        intlShipKrw: Number(form.intlShipKrw) || 0, customsKrw: Number(form.customsKrw) || 0, vatKrw: Number(form.vatKrw) || 0,
        otherKrw: Number(form.otherKrw) || 0, includeVat: form.includeVat, memo: form.memo, applyCost: form.applyCost,
      });
      setNotice(r.appliedUnitCost !== null ? `저장했습니다. 옵션 ${r.optionCount}개의 매입원가를 ${won(r.appliedUnitCost)}(가중평균)으로 원가 현황에 넣었습니다.` : '저장했습니다.');
      setShowForm(false);
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('이 매입 기록을 지울까요? 남은 기록으로 평균을 다시 계산합니다.')) return;
    setBusy(true);
    try {
      await coupangApi.purchaseDelete(id);
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (vendorItemIds: string[]) => {
    setBusy(true);
    try {
      const r = await coupangApi.purchaseApply(vendorItemIds);
      setNotice(`매입원가를 ${won(r.appliedUnitCost)}으로 원가 현황에 넣었습니다.`);
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full rounded-control border border-line bg-paper-2 px-3 py-2 text-[13px] text-ink outline-none focus:border-accent tabular-nums';
  const num = (key: keyof typeof form, label: string, hint?: string) => (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-ink-2">{label}</label>
      <input type="number" inputMode="decimal" className={inputCls} placeholder={hint} value={String(form[key] ?? '')}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-panel border border-line bg-paper p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold text-ink"><PackageSearch className="h-5 w-5 text-accent" />1688 매입 원가 계산</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
              위안 단가·수량·배송비·관세만 적으면 개당 입고 원가가 나오고, 저장하면서 [원가 입력]의 매입원가에 바로 들어갑니다. 같은 옵션을 여러 번 매입하면 총액 ÷ 총수량의 가중평균으로 관리합니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-control bg-paper-2 px-3 py-1.5 text-[12px] text-ink-2">
              환율 <b className="tabular-nums text-ink">{fx?.rate ? `${fx.rate}원/위안` : '—'}</b>
              {fx?.stale && <span className="ml-1 text-[11px] text-ink-3">(옛 값)</span>}
            </div>
            <button onClick={openNew} className="flex items-center gap-1.5 rounded-control bg-accent px-3.5 py-2 text-[13px] font-semibold text-ground hover:opacity-90">
              <Plus className="h-4 w-4" />매입 기록
            </button>
          </div>
        </div>

        {showForm && (
          <div className="mt-4 rounded-card border border-line bg-paper-2/60 p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-ink">{form.id ? '매입 기록 수정' : '새 매입 기록'}</p>
              <button onClick={() => setShowForm(false)} aria-label="닫기" className="rounded-full p-1 text-ink-3 hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <div className="col-span-2 sm:col-span-2 lg:col-span-3">
                <label className="mb-1 block text-[12px] font-medium text-ink-2">상품</label>
                <input className={`${inputCls} mb-1.5`} placeholder="상품명으로 찾기" value={productFilter} onChange={e => setProductFilter(e.target.value)} />
                <select className={inputCls} value={form.productName} onChange={e => setForm(f => ({ ...f, productName: e.target.value, vendorItemId: '' }))}>
                  <option value="">상품을 고르세요{productChoices.length !== products.length ? ` (${productChoices.length}개 검색됨)` : ''}</option>
                  {productChoices.map(p => <option key={p.name} value={p.name}>{p.name} · 옵션 {p.opts.length}개</option>)}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-1 lg:col-span-1">
                <label className="mb-1 block text-[12px] font-medium text-ink-2">옵션</label>
                <select className={inputCls} value={form.vendorItemId} disabled={!chosenProduct} onChange={e => setForm(f => ({ ...f, vendorItemId: e.target.value }))}>
                  <option value="">{chosenProduct ? `전체 옵션 ${chosenProduct.opts.length}개` : '상품을 먼저 고르세요'}</option>
                  {chosenProduct?.opts.map(o => <option key={o.vendorItemId} value={o.vendorItemId}>{o.optionName || '기본 옵션'}{o.unitCost > 0 ? ` (현재 ${won(o.unitCost)})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">매입일</label>
                <input type="date" className={inputCls} value={form.purchasedOn} onChange={e => setForm(f => ({ ...f, purchasedOn: e.target.value }))} />
              </div>
              {num('qty', '수량 (개)', '예: 100')}
              {num('unitPriceCny', '위안 단가 (¥)', '예: 20')}
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">환율 (원/위안)</label>
                <div className="flex gap-1">
                  <input type="number" inputMode="decimal" className={inputCls} placeholder="예: 190" value={form.fxRate} onChange={e => setForm(f => ({ ...f, fxRate: e.target.value }))} />
                  {fx?.rate && <button type="button" onClick={() => setForm(f => ({ ...f, fxRate: String(fx.rate) }))} title="오늘 환율 넣기" className="shrink-0 rounded-control border border-line px-2 text-ink-3 hover:text-ink"><RefreshCw className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
              {num('domesticShipCny', '중국 내 배송비 합계 (¥)', '예: 50')}
              {num('intlShipKrw', '배대지·국제배송 합계 (원)', '예: 120000')}
              {num('customsKrw', '관세 합계 (원)', '예: 30000')}
              {num('vatKrw', '수입부가세 합계 (원)', '예: 45000')}
              {num('otherKrw', '기타 (검수·라벨 등, 원)', '예: 5000')}
              <div className="col-span-2 sm:col-span-3 lg:col-span-4">
                <label className="mb-1 block text-[12px] font-medium text-ink-2">메모</label>
                <input className={inputCls} placeholder="예: 1688 주문번호, 판매자명" value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-[12.5px] text-ink-2 sm:col-span-3 lg:col-span-4">
                <input type="checkbox" checked={form.includeVat} onChange={e => setForm(f => ({ ...f, includeVat: e.target.checked }))} />
                수입부가세를 원가에 포함 (간이과세자 등 매입세액 공제를 못 받는 경우만)
              </label>
              <label className="col-span-2 flex items-center gap-2 text-[12.5px] text-ink-2 sm:col-span-3 lg:col-span-4">
                <input type="checkbox" checked={form.applyCost} onChange={e => setForm(f => ({ ...f, applyCost: e.target.checked }))} />
                저장하면서 이 옵션의 매입원가(가중평균)를 [원가 입력]에 바로 반영
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-accent-line bg-accent-soft px-4 py-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">개당 입고 원가</p>
                <p className="text-[22px] font-semibold tabular-nums text-ink">{won(previewUnit)}</p>
                <p className="text-[12px] text-ink-3">총 {won(previewTotal)} ÷ {Number(form.qty) || 0}개</p>
              </div>
              <button onClick={save} disabled={busy} className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:opacity-90 disabled:opacity-40">
                {busy ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        )}

        {notice && <p className="mt-3 rounded-control border border-positive/40 bg-positive-soft px-3 py-2 text-[13px] text-ink">{notice}</p>}
        {error && <p className="mt-3 rounded-control border border-critical/40 bg-critical-soft px-3 py-2 text-[13px] text-ink">{error}</p>}
        {loading && !rows && <p className="mt-4 flex items-center gap-2 text-[13px] text-ink-3"><Loader2 className="h-4 w-4 animate-spin" />불러오는 중...</p>}
        {rows && rows.length === 0 && !showForm && (
          <p className="mt-4 text-[13px] text-ink-3">아직 매입 기록이 없습니다. [매입 기록]으로 첫 매입을 적으면 개당 원가가 바로 계산됩니다.</p>
        )}
      </div>

      {summary.length > 0 && (
        <div className="rounded-panel border border-line bg-paper p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-ink">상품별 평균 원가</h3>
            {onGoCosts && <button onClick={onGoCosts} className="text-[12.5px] font-medium text-accent hover:underline">원가 입력 화면 →</button>}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  <th className="px-2 py-2 text-left">상품</th>
                  <th className="px-2 py-2 text-right">매입</th>
                  <th className="px-2 py-2 text-right">총수량</th>
                  <th className="px-2 py-2 text-right">평균 원가</th>
                  <th className="px-2 py-2 text-right">원가 현황</th>
                  <th className="px-2 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {summary.map(s => (
                  <tr key={s.productName} className="border-b border-line last:border-b-0">
                    <td className="px-2 py-2 text-ink"><span className="font-medium">{s.productName}</span><span className="text-ink-3"> · 옵션 {s.optionCount}개</span></td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink-2">{s.records}회</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink-2">{s.totalQty.toLocaleString()}개</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-ink">
                      {s.avgUnitCost === null ? '—' : s.avgUnitCostMax !== null && s.avgUnitCostMax !== s.avgUnitCost ? `${won(s.avgUnitCost)}~${won(s.avgUnitCostMax)}` : won(s.avgUnitCost)}
                    </td>
                    <td className={`px-2 py-2 text-right tabular-nums ${s.needsApply ? 'text-caution' : 'text-ink-2'}`}>
                      {s.currentMixed ? '옵션마다 다름' : s.currentUnitCost === null ? '없음' : won(s.currentUnitCost)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {s.needsApply && <button onClick={() => apply(s.vendorItemIds)} disabled={busy} className="rounded-control border border-line px-2.5 py-1 text-[11.5px] font-medium text-ink-2 hover:text-ink">원가에 반영</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="rounded-panel border border-line bg-paper p-5">
          <h3 className="text-[15px] font-semibold text-ink">매입 기록</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  <th className="px-2 py-2 text-left">매입일</th>
                  <th className="px-2 py-2 text-left">옵션</th>
                  <th className="px-2 py-2 text-right">수량</th>
                  <th className="px-2 py-2 text-right">단가 ¥ × 환율</th>
                  <th className="px-2 py-2 text-right">배송·관세·기타</th>
                  <th className="px-2 py-2 text-right">총액</th>
                  <th className="px-2 py-2 text-right">개당</th>
                  <th className="px-2 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-paper-2">
                    <td className="whitespace-nowrap px-2 py-2 tabular-nums text-ink-2">{r.purchasedOn}</td>
                    <td className="px-2 py-2 text-ink"><button onClick={() => openEdit(r)} className="text-left hover:underline">{r.productName}{r.optionName && <span className="text-ink-3"> · {r.optionName}</span>}</button>{r.memo && <span className="block text-[11.5px] text-ink-3">{r.memo}</span>}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink-2">{r.qty.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-ink-2">¥{r.unitPriceCny} × {r.fxRate}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink-2">{won(Math.round(r.domesticShipCny * r.fxRate) + r.intlShipKrw + r.customsKrw + r.otherKrw + (r.includeVat ? r.vatKrw : 0))}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{won(r.total)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-ink">{won(r.unit)}</td>
                    <td className="px-2 py-2 text-right"><button onClick={() => remove(r.id)} disabled={busy} aria-label="지우기" className="rounded-full p-1 text-ink-3 hover:text-critical"><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11.5px] text-ink-3">수입부가세는 일반과세자면 매입세액으로 돌려받는 돈이라 기본은 원가에서 뺍니다. 옵션 이름을 누르면 수정할 수 있습니다.</p>
        </div>
      )}
    </div>
  );
}
