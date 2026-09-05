import { useEffect, useState } from 'react';
import { Wallet, RefreshCw, Loader2, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { getToken } from '../../lib/auth';

// 관리자 — 원가 현황
// 변동비(AI·크롤링·메일)는 api_calls 실측, 고정비는 관리자가 입력한다.
// 요금(39,800원) 대비 구독자 1인당 원가를 보는 게 이 화면의 목적이다.

const MARK = '#22a3b8'; // 채움색 — 밝은 UI 액센트는 면에 쓰지 않는다

const FEATURE_LABEL: Record<string, string> = {
  'sourcing-products': '소싱AI · 상품 수집',
  'sourcing-reviews': '소싱AI · 리뷰 수집',
  'sourcing-review-summary': '소싱AI · 리뷰 요약',
  'sourcing-cron': '소싱AI · 자동 수집',
  'rank-check': '순위 추적',
  'qa-ask': '훈프로 코칭AI',
  'email-notify': '알림 메일',
  'thumbnail-image': '썸네일 제작',
  'detail-image': '상세페이지 제작',
};

const won = (n: number) => `${Math.round(n || 0).toLocaleString()}원`;

export function CostsAdmin({ showToast }: { showToast: (msg: string) => void }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fixed, setFixed] = useState<{ label: string; monthlyKrw: number }[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin?action=costs', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '불러오지 못했습니다.');
      setData(d);
      setFixed(d.fixedCosts ?? []);
    } catch (e: any) {
      showToast(e?.message ?? '원가 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const saveFixed = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin?action=costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ fixedCosts: fixed }),
      });
      if (!res.ok) throw new Error((await res.json()).error || '저장 실패');
      showToast('고정비를 저장했습니다.');
      await load();
    } catch (e: any) {
      showToast(e?.message ?? '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-[13px] text-ink-2">
        <Loader2 className="h-4 w-4 animate-spin" /> 원가를 집계하는 중…
      </div>
    );
  }
  if (!data) return null;

  const peak = Math.max(1, ...(data.month?.byFeature ?? []).map((f: any) => f.krw));
  const priceKrw = 39800;
  const perSub = data.perSubscriberKrw ?? 0;
  const marginPct = priceKrw > 0 ? Math.round(((priceKrw - perSub) / priceKrw) * 100) : 0;
  const risky = perSub > priceKrw * 0.3;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Wallet className="h-4 w-4 text-ink" />
        <h2 className="text-lg font-semibold text-ink">원가 현황</h2>
        <span className="text-[12px] text-ink-3">환율 {data.usdKrw?.toLocaleString()}원/$ 기준</span>
        <button
          onClick={load}
          className="ml-auto flex min-h-[36px] items-center gap-1.5 rounded-control border border-line px-3 text-[12.5px] text-ink-2 transition-colors hover:text-ink"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 새로고침
        </button>
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: '오늘 변동비', value: won(data.today?.krw), sub: `호출 ${data.today?.calls ?? 0}건` },
          { label: '이번 달 변동비', value: won(data.month?.krw), sub: `지난달 ${won(data.prevMonth?.krw)}` },
          { label: '고정비 (월)', value: won(data.fixedTotalKrw), sub: '아래에서 입력' },
          { label: '이번 달 총원가', value: won(data.totalMonthKrw), sub: `구독자 ${data.subscribers ?? 0}명` },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-card border border-line bg-paper p-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">{label}</p>
            <p className="mt-1 whitespace-nowrap text-[16px] font-semibold tabular-nums text-ink sm:text-[20px]">{value}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">{sub}</p>
          </div>
        ))}
      </div>

      {/* 1인당 원가 — 이 화면의 핵심 지표 */}
      <div className={`rounded-card border p-5 ${risky ? 'border-caution/40 bg-caution-soft' : 'border-line bg-paper'}`}>
        <div className="mb-2 flex items-center gap-2">
          {risky && <AlertTriangle className="h-4 w-4 text-caution" />}
          <h3 className="text-[15px] font-semibold text-ink">구독자 1명당 변동비</h3>
        </div>
        <p className="text-[24px] font-semibold tabular-nums text-ink">
          {won(perSub)}
          <span className="ml-2 text-[13px] font-normal text-ink-2">
            / 월 요금 {won(priceKrw)} · 변동비 제외 마진 {marginPct}%
          </span>
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-2">
          {data.subscribers > 0
            ? risky
              ? '변동비가 요금의 30%를 넘습니다. 기능별 일 한도를 조정하세요.'
              : '변동비 비중이 안정적입니다.'
            : '구독자가 없어 1인당 원가를 계산할 수 없습니다. 결제가 시작되면 표시됩니다.'}
        </p>
      </div>

      {/* 기능별 — 어디에 돈이 나가는지 */}
      <div className="rounded-card border border-line bg-paper p-5">
        <h3 className="mb-4 text-[15px] font-semibold text-ink">
          기능별 변동비 <span className="text-[12px] font-normal text-ink-3">이번 달</span>
        </h3>
        {(data.month?.byFeature ?? []).length === 0 ? (
          <p className="text-[12.5px] text-ink-2">아직 집계된 호출이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {data.month.byFeature.map((f: any) => (
              <div key={f.feature}>
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[13px] font-medium text-ink">{FEATURE_LABEL[f.feature] ?? f.feature}</span>
                  <span className="text-[12.5px] tabular-nums text-ink-2">
                    <b className="font-semibold text-ink">{won(f.krw)}</b> · {f.calls.toLocaleString()}회
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-paper-2">
                  <div className="h-full rounded-full" style={{ width: `${Math.round((f.krw / peak) * 100)}%`, background: MARK }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 원가 상위 회원 — 한도를 정할 근거 */}
      {(data.topUsers ?? []).length > 0 && (
        <div className="rounded-card border border-line bg-paper p-5">
          <h3 className="mb-1 text-[15px] font-semibold text-ink">원가 상위 회원</h3>
          <p className="mb-4 text-[12px] text-ink-2">
            이번 달 기준. 상위 회원의 원가가 요금을 넘으면 그 기능에 한도가 필요합니다.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="py-2 font-semibold">회원</th>
                  <th className="py-2 text-right font-semibold">이번 달 원가</th>
                </tr>
              </thead>
              <tbody>
                {data.topUsers.map((u: any) => (
                  <tr key={u.id} className="border-b border-line/60">
                    <td className="py-2.5 text-ink">
                      {u.name}
                      <span className="ml-1.5 text-[11.5px] text-ink-3">{u.email}</span>
                    </td>
                    <td className={`py-2.5 text-right tabular-nums ${u.krw > priceKrw ? 'font-semibold text-critical' : 'text-ink-2'}`}>
                      {won(u.krw)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 고정비 */}
      <div className="rounded-card border border-line bg-paper p-5">
        <h3 className="mb-1 text-[15px] font-semibold text-ink">고정비</h3>
        <p className="mb-4 text-[12px] text-ink-2">
          Vercel·Supabase·Bright Data 구독료처럼 사용량과 무관하게 매달 나가는 비용을 입력하세요.
        </p>
        <div className="flex flex-col gap-2">
          {fixed.map((f, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={f.label}
                onChange={e => setFixed(v => v.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                placeholder="항목 (예: Vercel Pro)"
                // min-w-0: input은 기본 최소 너비가 있어 flex-1만으로는 줄어들지 않는다
                className="min-h-[40px] w-full min-w-0 flex-1 rounded-control border border-line bg-paper-2 px-3 text-[13px] text-ink outline-none focus:border-accent"
              />
              <input
                type="number"
                value={f.monthlyKrw}
                onChange={e => setFixed(v => v.map((x, j) => j === i ? { ...x, monthlyKrw: Number(e.target.value) } : x))}
                placeholder="월 금액"
                className="min-h-[40px] w-[96px] shrink-0 rounded-control border border-line bg-paper-2 px-2.5 text-right text-[13px] tabular-nums text-ink outline-none focus:border-accent sm:w-[130px] sm:px-3"
              />
              <button
                onClick={() => setFixed(v => v.filter((_, j) => j !== i))}
                aria-label="삭제"
                className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-control border border-line text-ink-3 transition-colors hover:text-critical"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setFixed(v => [...v, { label: '', monthlyKrw: 0 }])}
            className="flex min-h-[40px] items-center gap-1.5 rounded-control border border-line px-3.5 text-[13px] text-ink-2 transition-colors hover:text-ink"
          >
            <Plus className="h-3.5 w-3.5" /> 항목 추가
          </button>
          <button
            onClick={saveFixed}
            disabled={saving}
            className="min-h-[40px] rounded-control bg-accent px-4 text-[13px] font-semibold text-ground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
