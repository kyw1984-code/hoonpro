/**
 * 변경 효과 측정 (실험 노트).
 *
 * 셀러는 가격을 내리고 썸네일을 바꾸지만 "그래서 효과가 있었나"를 알 방법이
 * 없었다. 상품과 바꾼 날짜 한 줄만 적으면 전후 N일의 판매·매출·광고비·추정
 * 순이익·순위를 하루 평균으로 견줘 준다. 데이터는 이미 쌓인 것이라 외부 호출이
 * 없다.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Loader2, Plus, Trash2, X } from 'lucide-react';
import { coupangApi, won, type ExperimentItem, type MyProductLite } from '../../lib/coupang';
import { perDay, type SideMetrics } from '../../lib/experimentCompare';

const KIND_LABEL: Record<string, string> = {
  price: '가격', thumbnail: '썸네일', title: '상품명', detail: '상세페이지',
  ad: '광고', coupon: '쿠폰', stock: '재고·옵션', other: '기타',
};

const TONE_CLS: Record<string, string> = {
  good: 'border-positive/40 bg-positive-soft text-ink',
  bad: 'border-critical/40 bg-critical-soft text-ink',
  mixed: 'border-line bg-paper-2 text-ink',
  na: 'border-line bg-paper-2 text-ink-2',
};

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function pct(before: SideMetrics, after: SideMetrics, key: 'quantity' | 'salesAmount' | 'adCost' | 'profit'): string {
  const b = perDay(before, key);
  const a = perDay(after, key);
  if (b === 0) return '—';
  const v = Math.round(((a - b) / Math.abs(b)) * 100);
  return `${v > 0 ? '+' : ''}${v}%`;
}

export function Experiments() {
  const [items, setItems] = useState<ExperimentItem[] | null>(null);
  const [products, setProducts] = useState<MyProductLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ productId: '', kind: 'price', changedOn: todayKst(), windowDays: 7, note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p] = await Promise.all([coupangApi.experiments(), coupangApi.myProducts(90).catch(() => ({ products: [] as MyProductLite[] }))]);
      setItems(d.items);
      setProducts(p.products);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!form.productId) { setError('상품을 고르세요.'); return; }
    setBusy(true);
    setError(null);
    try {
      const p = products.find(x => x.productId === form.productId);
      await coupangApi.experimentSave({ ...form, productName: p?.productName ?? '' });
      setShowForm(false);
      setForm({ productId: '', kind: 'price', changedOn: todayKst(), windowDays: 7, note: '' });
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('이 기록을 지울까요?')) return;
    setBusy(true);
    try {
      await coupangApi.experimentDelete(id);
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full rounded-control border border-line bg-paper-2 px-3 py-2 text-[13px] text-ink outline-none focus:border-accent';

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-panel border border-line bg-paper p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold text-ink"><FlaskConical className="h-5 w-5 text-accent" />변경 효과 측정</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
              가격을 내렸거나 썸네일을 바꿨다면 여기 한 줄 적어두세요. 바꾼 날을 기준으로 전후 기간의 판매·매출·광고비·추정 순이익·순위를 하루 평균으로 견줘 "효과가 있었는지"를 답합니다.
            </p>
          </div>
          <button onClick={() => setShowForm(v => !v)} className="flex items-center gap-1.5 rounded-control bg-accent px-3.5 py-2 text-[13px] font-semibold text-ground hover:opacity-90">
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{showForm ? '닫기' : '변경 기록 추가'}
          </button>
        </div>

        {showForm && (
          <div className="mt-4 grid grid-cols-1 gap-3 rounded-card border border-line bg-paper-2/60 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="mb-1 block text-[12px] font-medium text-ink-2">상품</label>
              <select className={inputCls} value={form.productId} onChange={e => setForm(f => ({ ...f, productId: e.target.value }))}>
                <option value="">상품을 고르세요 (최근 90일 판매순)</option>
                {products.map(p => <option key={p.productId} value={p.productId}>{p.productName} · 옵션 {p.optionCount}개</option>)}
              </select>
              {products.length === 0 && <p className="mt-1 text-[11.5px] text-ink-3">아직 노출상품ID를 못 찾았습니다. 수집이 끝난 뒤 다시 열어주세요.</p>}
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-ink-2">무엇을 바꿨나</label>
              <select className={inputCls} value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
                {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-ink-2">바꾼 날</label>
              <input type="date" className={inputCls} value={form.changedOn} max={todayKst()} onChange={e => setForm(f => ({ ...f, changedOn: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-ink-2">전후 며칠씩</label>
              <select className={inputCls} value={form.windowDays} onChange={e => setForm(f => ({ ...f, windowDays: Number(e.target.value) }))}>
                <option value={7}>7일</option><option value={14}>14일</option><option value={28}>28일</option>
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="mb-1 block text-[12px] font-medium text-ink-2">메모</label>
              <input className={inputCls} placeholder="예: 29,900 → 26,900 / 썸네일 흰 배경으로 교체" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <button onClick={save} disabled={busy} className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper hover:opacity-90 disabled:opacity-40">
                {busy ? '저장 중...' : '기록 저장'}
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 rounded-control border border-critical/40 bg-critical-soft px-3 py-2 text-[13px] text-ink">{error}</p>}
        {loading && !items && <p className="mt-4 flex items-center gap-2 text-[13px] text-ink-3"><Loader2 className="h-4 w-4 animate-spin" />불러오는 중...</p>}
        {items && items.length === 0 && !showForm && (
          <p className="mt-4 text-[13px] text-ink-3">아직 기록이 없습니다. 무언가를 바꾼 날 [변경 기록 추가]로 한 줄 적어두세요. 3일이 지나면 판정이 나옵니다.</p>
        )}
      </div>

      {items && items.map(it => (
        <div key={it.id} className="rounded-panel border border-line bg-paper p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">{KIND_LABEL[it.kind] ?? it.kind}</span>
                <h3 className="text-[15px] font-semibold text-ink">{it.productName}</h3>
              </div>
              <p className="mt-1 text-[12.5px] text-ink-3">
                {it.changedOn} 변경 · 전후 {it.windowDays}일 · 옵션 {it.linked}개{it.note ? ` · ${it.note}` : ''}
              </p>
            </div>
            <button onClick={() => remove(it.id)} disabled={busy} aria-label="지우기" className="rounded-full p-1.5 text-ink-3 hover:bg-paper-2 hover:text-critical"><Trash2 className="h-4 w-4" /></button>
          </div>

          <div className={`mt-3 rounded-card border px-4 py-3 ${TONE_CLS[it.verdict.tone]}`}>
            <p className="text-[14px] font-semibold">{it.verdict.headline}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-2">{it.verdict.detail}</p>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  <th className="px-2 py-2 text-left">하루 평균</th>
                  <th className="px-2 py-2 text-right">이전 {it.before.days}일</th>
                  <th className="px-2 py-2 text-right">이후 {it.after.days}일{it.window.complete ? '' : ' (진행 중)'}</th>
                  <th className="px-2 py-2 text-right">변화</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ['판매수량', 'quantity', (v: number) => `${Math.round(v * 10) / 10}개`],
                  ['매출', 'salesAmount', (v: number) => won(Math.round(v))],
                  ['광고비', 'adCost', (v: number) => won(Math.round(v))],
                  ['추정 순이익', 'profit', (v: number) => won(Math.round(v))],
                ] as Array<[string, 'quantity' | 'salesAmount' | 'adCost' | 'profit', (v: number) => string]>).map(([label, key, fmt]) => (
                  <tr key={key} className="border-b border-line last:border-b-0">
                    <td className="px-2 py-2 text-ink-2">{label}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{fmt(perDay(it.before, key))}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{fmt(perDay(it.after, key))}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-ink">{pct(it.before, it.after, key)}</td>
                  </tr>
                ))}
                {it.ranks.map(r => (
                  <tr key={r.keyword} className="border-b border-line last:border-b-0">
                    <td className="px-2 py-2 text-ink-2">순위 · {r.keyword}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{r.before === null ? '—' : `${r.before}위`}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{r.after === null ? '—' : `${r.after}위`}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-ink">
                      {r.before !== null && r.after !== null ? `${r.after < r.before ? '↑' : r.after > r.before ? '↓' : '='} ${Math.abs(Math.round((r.before - r.after) * 10) / 10)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11.5px] text-ink-3">
            이전 {it.window.beforeFrom} ~ {it.window.beforeTo} · 이후 {it.window.afterFrom} ~ {it.window.afterTo}.
            {!it.costKnown && ' 원가가 없어 순이익은 원가 0으로 계산됐습니다. [원가 입력]에 넣으면 정확해집니다.'}
            {it.ranks.length === 0 && ' 순위는 [순위 추적]에 이 상품을 등록해야 보입니다.'}
          </p>
        </div>
      ))}
    </div>
  );
}
