/**
 * 훈프로 상품 진단 카드 — 옵션마다 "손볼 것"을 한 화면에.
 *
 * 원가 미입력·마진 얇음·재고 임박·반품률 높음·60일 무판매·판매중지 재고.
 * 항목마다 그 일을 처리하는 화면으로 가는 버튼이 있다. 판정은 서버가 한다.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, RefreshCw, Stethoscope } from 'lucide-react';
import { coupangApi, type HealthItem, type HealthKind, type HealthReport } from '../../lib/coupang';

const KIND_META: Record<HealthKind, { label: string; why: string; go: string; goLabel: string }> = {
  'cost-missing': { label: '원가 미입력', why: '팔리는데 원가가 없으면 순이익이 그만큼 부풀려집니다.', go: 'costs', goLabel: '원가 입력' },
  'thin-margin': { label: '마진 5% 미만', why: '쿠폰 한 번, 반품 하나에 적자로 넘어갑니다. 가격이나 원가를 다시 보세요.', go: 'price', goLabel: '가격 관리' },
  'stock-low': { label: '재고 임박·품절', why: '품절은 매출만이 아니라 순위까지 잃습니다. 지금 발주해야 늦지 않습니다.', go: 'inventory', goLabel: '재고 예측' },
  'return-high': { label: '반품률 높음', why: '사유를 보면 상세페이지에서 미리 막을 수 있는 게 많습니다.', go: 'returns', goLabel: '반품 분석' },
  idle: { label: '60일 무판매', why: '재고만 묶여 있는 옵션입니다. 가격을 내리거나 정리를 검토하세요.', go: 'price', goLabel: '가격 관리' },
  stopped: { label: '판매중지 재고', why: '판매를 멈췄는데 재고가 남아 있습니다. 다시 열거나 회수하세요.', go: 'inventory', goLabel: '재고 예측' },
};
const KIND_ORDER: HealthKind[] = ['stock-low', 'cost-missing', 'thin-margin', 'return-high', 'idle', 'stopped'];

const SEV = {
  high: 'border-critical/35 bg-critical-soft text-critical',
  mid: 'border-caution/35 bg-caution-soft text-caution',
  low: 'border-line-strong bg-paper-2 text-ink-2',
};

export function HealthCheck({ onGo }: { onGo: (view: string) => void }) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<HealthKind | 'all'>('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try { setReport(await coupangApi.healthCheck()); } catch (e: any) { setError(e?.message ?? String(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const total = report ? report.items.length : 0;
  const shown = report ? report.items.filter(i => filter === 'all' || i.kind === filter) : [];
  const groups = KIND_ORDER.filter(k => (report?.counts[k] ?? 0) > 0 && (filter === 'all' || filter === k));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-panel border border-line bg-paper p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold text-ink">
              <Stethoscope className="h-5 w-5 text-accent" />훈프로 상품 진단 카드
            </h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
              옵션마다 원가·마진·재고·반품·판매 정체를 점검해 손볼 것만 모았습니다. 항목을 누르면 처리하는 화면으로 갑니다.
              {report && <span className="text-ink-3"> · 옵션 {report.optionsChecked}개 점검</span>}
            </p>
          </div>
          <button type="button" onClick={load} disabled={loading} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-control border border-line px-3 text-[13px] font-medium text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-40">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}다시 점검
          </button>
        </div>

        {error && <p className="mt-3 rounded-control border border-critical/40 bg-critical-soft px-3 py-2 text-[13px] text-ink">{error}</p>}

        {report && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setFilter('all')} className={`rounded-control border px-3 py-1.5 text-[13px] font-semibold ${filter === 'all' ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-2 hover:text-ink'}`}>
              손볼 것 {total}개
            </button>
            {KIND_ORDER.map(k => (
              <button key={k} type="button" onClick={() => setFilter(k)} disabled={report.counts[k] === 0}
                className={`rounded-control border px-3 py-1.5 text-[13px] font-medium disabled:opacity-40 ${filter === k ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-2 hover:text-ink'}`}>
                {KIND_META[k].label} {report.counts[k]}
              </button>
            ))}
          </div>
        )}
      </div>

      {report && total === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-panel border border-line bg-paper py-14 text-ink-2">
          <CheckCircle2 className="h-10 w-10 text-positive" />
          <p className="text-[15px] font-semibold text-ink">손볼 것이 없습니다</p>
          <p className="text-[13px] text-ink-3">원가·마진·재고·반품·판매 정체 모두 기준 안입니다.</p>
        </div>
      )}

      {groups.map(k => {
        const meta = KIND_META[k];
        const rows = shown.filter(i => i.kind === k);
        return (
          <section key={k} className="rounded-panel border border-line bg-paper p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                  <AlertTriangle className={`h-4 w-4 ${rows.some(r => r.severity === 'high') ? 'text-critical' : 'text-caution'}`} />
                  {meta.label} <span className="text-ink-3">{rows.length}개</span>
                </h3>
                <p className="mt-1 text-[13px] text-ink-2">{meta.why}</p>
              </div>
              <button type="button" onClick={() => onGo(meta.go)} className="inline-flex min-h-[36px] items-center gap-1 rounded-control bg-accent px-3.5 text-[13px] font-bold text-ground hover:opacity-90">
                {meta.goLabel} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              {rows.map((r: HealthItem) => (
                <div key={`${r.kind}:${r.vendorItemId}`} className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-paper-2 px-3 py-2">
                  <span className={`inline-flex shrink-0 items-center rounded-control border px-1.5 py-0.5 text-[11px] font-semibold ${SEV[r.severity]}`}>
                    {r.severity === 'high' ? '급함' : r.severity === 'mid' ? '확인' : '참고'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                    {r.channel === 'growth' && <span className="mr-1.5 rounded-control border border-line px-1 py-0.5 text-[10.5px] text-ink-3">그로스</span>}
                    {r.productName}{r.optionName ? <span className="text-ink-3"> / {r.optionName}</span> : null}
                  </span>
                  <span className="w-full text-[12.5px] text-ink-2 sm:w-auto sm:max-w-[55%] sm:text-right">{r.detail}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
