import { useEffect, useState } from 'react';
import { SlidersHorizontal, RefreshCw, Loader2, Save, RotateCcw, AlertTriangle } from 'lucide-react';
import { getToken } from '../../lib/auth';

// 관리자 — 기능별 일일 한도
// 한도 × 실측 단가 = "한 사람이 매일 한도를 다 썼을 때의 월 원가"를 요금과 비교해 보여준다.
// 단가는 추정이 아니라 최근 30일 api_calls ÷ 소모한 한도 횟수로 계산한 실측값이다
// (표본 20건 미만이면 초기 추정치를 쓰고 '추정'으로 표시).

const MARK = '#22a3b8';

interface FeatureRow {
  key: string;
  label: string;
  hint: string;
  limit: number;
  defaultLimit: number;
  unitKrw: number;
  measured: boolean;
  units30d: number;
  cost30dKrw: number;
  worstCaseKrw: number;
}

interface LimitsData {
  usdKrw: number;
  priceKrw: number;
  resetLabel: string;
  features: FeatureRow[];
  worstCaseTotalKrw: number;
  worstCasePct: number;
}

// 평균 사용자는 한도의 약 18%만 쓴다 (원가 현황의 실측 평균과 맞춰 조정)
const AVG_RATIO = 0.18;

const won = (n: number) => `${Math.round(n || 0).toLocaleString()}원`;

export function LimitsAdmin({ showToast }: { showToast: (msg: string) => void }) {
  const [data, setData] = useState<LimitsData | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin?action=limits', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '불러오지 못했습니다.');
      setData(d);
      setLimits(Object.fromEntries(d.features.map((f: FeatureRow) => [f.key, f.limit])));
    } catch (e: any) {
      showToast(e.message || '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin?action=limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ limits }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '저장에 실패했습니다.');
      showToast('한도를 저장했습니다. 최대 1분 뒤부터 적용됩니다.');
      await load();
    } catch (e: any) {
      showToast(e.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="flex items-center gap-2 py-16 text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">불러오는 중...</span>
      </div>
    );
  }

  // 입력값 기준으로 예상 원가를 즉시 다시 계산한다 (저장 전에도 영향이 보이게)
  const projected = data.features.map(f => ({
    ...f,
    editedLimit: limits[f.key] ?? f.limit,
    editedWorstKrw: Math.round((limits[f.key] ?? f.limit) * 30 * f.unitKrw),
  }));
  const worstTotal = projected.reduce((s, f) => s + f.editedWorstKrw, 0);
  // 모든 항목을 매일 한도까지 쓰는 사람은 사실상 없다. 판단 기준은 '평균'이고,
  // 실사용은 대체로 한도의 15~20% 수준이라 18%를 기준선으로 쓴다.
  const avgTotal = Math.round(worstTotal * AVG_RATIO);
  const avgPct = Math.round((avgTotal / data.priceKrw) * 100);
  const worstPct = Math.round((worstTotal / data.priceKrw) * 100);
  const dirty = projected.some(f => f.editedLimit !== f.limit);
  const maxWorst = Math.max(1, ...projected.map(f => f.editedWorstKrw));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <SlidersHorizontal className="h-4 w-4" style={{ color: MARK }} />
        <h3 className="text-[15px] font-bold text-ink">기능별 일일 한도</h3>
        <span className="rounded-control border border-line px-2 py-0.5 text-[11.5px] text-ink-2">
          초기화 {data.resetLabel}
        </span>
        <button
          onClick={load}
          className="ml-auto flex min-h-[36px] items-center gap-1.5 rounded-control border border-line px-3 text-[12.5px] text-ink-2 hover:text-ink"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 새로고침
        </button>
      </div>

      <p className="text-[12.5px] leading-relaxed text-ink-2">
        0으로 두면 <b className="text-ink">무제한</b>입니다. 아래 &quot;최대 월 원가&quot;는 한 사람이 매일 한도를 끝까지
        썼을 때의 금액이고, 실제 평균 사용량은 보통 한도의 15~20% 수준입니다.
        저장 후 최대 1분 뒤부터 서버에 반영됩니다.
      </p>

      {/* 요약 — 판단 기준은 '예상 평균 원가'다 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-card border border-line bg-paper p-4">
          <p className="text-[11.5px] text-ink-3">예상 평균 원가 (1인 / 월)</p>
          <p className="mt-1 text-[22px] font-bold tabular-nums text-ink">{won(avgTotal)}</p>
          <p className="mt-0.5 text-[11px] text-ink-3">한도의 {Math.round(AVG_RATIO * 100)}%를 쓴다고 가정</p>
        </div>
        <div className="rounded-card border border-line bg-paper p-4">
          <p className="text-[11.5px] text-ink-3">요금({won(data.priceKrw)}) 대비 · 목표 20% 이하</p>
          <p
            className="mt-1 text-[22px] font-bold tabular-nums"
            style={{ color: avgPct > 30 ? '#ff8a8a' : avgPct > 20 ? '#ffb454' : MARK }}
          >
            {avgPct}%
          </p>
          <p className="mt-0.5 text-[11px] text-ink-3">마진 {won(data.priceKrw - avgTotal)}</p>
        </div>
        <div className="rounded-card border border-line bg-paper p-4">
          <p className="text-[11.5px] text-ink-3">이론상 최대 (모든 항목 매일 한도까지)</p>
          <p className="mt-1 text-[22px] font-bold tabular-nums text-ink-2">{won(worstTotal)}</p>
          <p className="mt-0.5 text-[11px] text-ink-3">요금의 {worstPct}% · 실제로는 거의 나오지 않는 값</p>
        </div>
      </div>

      {avgPct > 25 && (
        <div className="flex items-start gap-2 rounded-card border p-3.5 text-[12.5px]" style={{ borderColor: 'rgba(255,138,138,.4)', background: 'rgba(255,138,138,.08)' }}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#ff8a8a' }} />
          <span className="text-ink-2">
            예상 평균 원가가 요금의 25%를 넘습니다. 아래에서 원가 비중(막대)이 큰 항목의 한도를 낮추세요.
          </span>
        </div>
      )}

      {/* 항목별 설정 */}
      <div className="flex flex-col gap-2.5">
        {projected.map(f => {
          const changed = f.editedLimit !== f.limit;
          return (
            <div key={f.key} className="rounded-card border border-line bg-paper p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-ink">{f.label}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-3">{f.hint}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={f.editedLimit}
                    onChange={e => setLimits(l => ({ ...l, [f.key]: Math.max(0, Number(e.target.value) || 0) }))}
                    className={`w-[86px] min-h-[40px] rounded-control border bg-paper-2 px-2.5 text-right text-[14px] tabular-nums text-ink ${changed ? 'border-accent' : 'border-line'}`}
                  />
                  <span className="text-[12.5px] text-ink-2">회/일</span>
                  <button
                    type="button"
                    onClick={() => setLimits(l => ({ ...l, [f.key]: f.defaultLimit }))}
                    title={`권장값 ${f.defaultLimit}회로 되돌리기`}
                    className="flex h-9 w-9 items-center justify-center rounded-control border border-line text-ink-3 hover:text-ink"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-paper-2">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.round((f.editedWorstKrw / maxWorst) * 100)}%`, background: MARK }}
                  />
                </div>
                <span className="text-[11.5px] tabular-nums text-ink-2">
                  단가 {won(f.unitKrw)}
                  <span className="ml-1 text-ink-3">{f.measured ? `(30일 실측 ${f.units30d.toLocaleString()}회)` : '(추정)'}</span>
                </span>
                <span className="text-[12.5px] font-semibold tabular-nums text-ink">
                  {f.editedLimit === 0 ? '무제한' : `최대 월 ${won(f.editedWorstKrw)}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="flex min-h-[44px] items-center gap-2 rounded-control px-4 text-[13.5px] font-semibold text-ground disabled:opacity-40"
          style={{ background: MARK }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          한도 저장
        </button>
        {dirty && <span className="text-[12px] text-ink-3">저장하지 않은 변경이 있습니다.</span>}
      </div>
    </div>
  );
}
