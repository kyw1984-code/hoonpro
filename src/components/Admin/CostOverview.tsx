import React, { useEffect, useState } from 'react';
import { Wallet, RefreshCw, Plus, Trash2, Save, Loader2, Zap, Server } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { FEATURE_LABEL, SOURCING_FEATURES, USD_TO_KRW } from '../../lib/pricing';

// 관리자 — 비용 현황
//   고정비: 관리자가 직접 입력 (Vercel Pro, 도메인, Supabase 등) → app_config.fixed_costs
//   변동비: 각 API가 호출 시점에 api_calls에 기록 → 새로고침마다 실시간 반영 (소싱AI 포함)

interface FixedCost {
  id: string;
  name: string;
  amountKrw: number;
  cycle: 'monthly' | 'yearly';
  note?: string;
}

interface Agg { calls: number; costUsd: number }

interface CostsResponse {
  generatedAt: string;
  monthStart: string;
  fixedCosts: FixedCost[];
  variable: {
    thisMonth: Agg;
    prevMonth: Agg;
    today: Agg;
    byFeature: (Agg & { feature: string })[];
    byModel: (Agg & { model: string })[];
  };
}

// 처음 비어 있을 때 한 번에 채워 넣을 수 있는 기본 항목 (금액은 관리자가 수정)
const DEFAULT_FIXED: Omit<FixedCost, 'id'>[] = [
  { name: 'Vercel Pro', amountKrw: Math.round(20 * USD_TO_KRW), cycle: 'monthly', note: '$20/월 — 함수 12개 제한 해제, 크론 확대' },
  { name: '도메인 hoonproai.com (가비아)', amountKrw: 0, cycle: 'yearly', note: '연 결제 금액 입력' },
  { name: 'Supabase', amountKrw: 0, cycle: 'monthly', note: '무료 플랜 사용 중 (Pro 전환 시 $25/월)' },
  { name: 'Resend (이메일)', amountKrw: 0, cycle: 'monthly', note: '무료 3,000건/월' },
  { name: 'Sentry (에러 모니터링)', amountKrw: 0, cycle: 'monthly', note: '무료 플랜' },
  { name: 'Bright Data 최소 충전', amountKrw: 0, cycle: 'monthly', note: '선불 충전액이 있으면 입력 (사용분은 아래 변동비에 반영)' },
];

const krw = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
const usdToKrw = (usd: number) => usd * USD_TO_KRW;
const fmtUsd = (usd: number) => `$${usd.toFixed(usd >= 1 ? 2 : 4)}`;
const newId = () => Math.random().toString(36).slice(2, 10);

export function CostOverview({ showToast }: { showToast: (m: string) => void }) {
  const [data, setData] = useState<CostsResponse | null>(null);
  const [fixed, setFixed] = useState<FixedCost[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const headers = () => ({ Authorization: `Bearer ${getToken()}` });

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin?action=costs', { headers: headers() });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? '비용 현황을 불러오지 못했습니다.'); return; }
      setData(json);
      // 편집 중이면 서버 값으로 덮어쓰지 않음
      if (!dirty) setFixed(json.fixedCosts ?? []);
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // 소싱AI 사용 금액 실시간 반영 — 탭이 열려 있는 동안 60초마다 갱신
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => load(true), 60_000);
    return () => clearInterval(t);
  }, [autoRefresh, dirty]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin?action=costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ fixedCosts: fixed }),
      });
      const json = await res.json();
      if (!res.ok) { showToast(json.error ?? '저장 실패'); return; }
      setFixed(json.fixedCosts ?? fixed);
      setDirty(false);
      showToast('고정비 항목을 저장했습니다.');
      load(true);
    } catch {
      showToast('네트워크 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const updateRow = (id: string, patch: Partial<FixedCost>) => {
    setFixed(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const addRow = () => { setFixed(prev => [...prev, { id: newId(), name: '', amountKrw: 0, cycle: 'monthly', note: '' }]); setDirty(true); };
  const removeRow = (id: string) => { setFixed(prev => prev.filter(r => r.id !== id)); setDirty(true); };
  const loadDefaults = () => { setFixed(DEFAULT_FIXED.map(d => ({ ...d, id: newId() }))); setDirty(true); };

  // 월 환산 고정비 합계 (연 결제는 12로 나눔)
  const fixedMonthlyKrw = fixed.reduce((s, r) => s + (r.cycle === 'yearly' ? r.amountKrw / 12 : r.amountKrw), 0);
  const v = data?.variable;
  const variableMonthKrw = usdToKrw(v?.thisMonth.costUsd ?? 0);
  const sourcingMonth = (v?.byFeature ?? []).filter(f => SOURCING_FEATURES.includes(f.feature))
    .reduce((s, f) => ({ calls: s.calls + f.calls, costUsd: s.costUsd + f.costUsd }), { calls: 0, costUsd: 0 });
  const otherMonth = { calls: (v?.thisMonth.calls ?? 0) - sourcingMonth.calls, costUsd: (v?.thisMonth.costUsd ?? 0) - sourcingMonth.costUsd };

  const monthLabel = data ? (() => { const d = new Date(new Date(data.monthStart).getTime() + 9 * 3600 * 1000); return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월`; })() : '이번 달';
  const updatedLabel = data ? new Date(data.generatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5"><Wallet className="w-4 h-4 text-accent" /> 비용 현황 — {monthLabel}</h3>
          <p className="text-[12px] text-ink-2 mt-0.5">
            고정비는 직접 입력, 변동비(API)는 호출 시점에 자동 기록되어 새로고침할 때마다 반영됩니다. 환율 ₩{USD_TO_KRW.toLocaleString()}/$ 기준 환산.
            {updatedLabel && <span className="ml-1 text-ink-3">마지막 갱신 {updatedLabel}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-ink-2 cursor-pointer select-none">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-accent" />
            60초 자동 갱신
          </label>
          <button onClick={() => load()} disabled={loading}
            className="flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[12px] font-medium text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 새로고침
          </button>
        </div>
      </div>

      {error && <p className="text-[12px] text-critical">{error}</p>}

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="이번 달 예상 총비용" value={krw(fixedMonthlyKrw + variableMonthKrw)} sub="고정비(월 환산) + 변동비" accent />
        <SummaryCard label="고정비 (월 환산)" value={krw(fixedMonthlyKrw)} sub={`${fixed.length}개 항목`} />
        <SummaryCard label="변동비 (API 사용)" value={krw(variableMonthKrw)} sub={`${(v?.thisMonth.calls ?? 0).toLocaleString()}회 호출 · ${fmtUsd(v?.thisMonth.costUsd ?? 0)}`} />
        <SummaryCard label="소싱AI 사용 금액" value={krw(usdToKrw(sourcingMonth.costUsd))} sub={`${sourcingMonth.calls.toLocaleString()}회 · 오늘 전체 ${krw(usdToKrw(v?.today.costUsd ?? 0))}`} live />
      </div>

      {/* 고정비 */}
      <section className="rounded-panel border border-line bg-paper p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h4 className="text-[13px] font-semibold text-ink flex items-center gap-1.5"><Server className="w-4 h-4 text-ink-3" /> 고정비 항목</h4>
          <div className="flex items-center gap-2">
            {fixed.length === 0 && (
              <button onClick={loadDefaults} className="rounded-control border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-line-strong hover:text-ink">
                기본 항목 불러오기
              </button>
            )}
            <button onClick={addRow} className="flex items-center gap-1 rounded-control border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-line-strong hover:text-ink">
              <Plus className="w-3 h-3" /> 항목 추가
            </button>
            <button onClick={save} disabled={!dirty || saving}
              className="flex items-center gap-1 rounded-control bg-accent px-3 py-1 text-[11px] font-semibold text-paper disabled:opacity-40">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} 저장
            </button>
          </div>
        </div>
        {fixed.length === 0 ? (
          <p className="text-[12px] text-ink-3 py-4 text-center">등록된 고정비가 없습니다. [기본 항목 불러오기]로 시작하거나 직접 추가하세요.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-ink-3 border-b border-line">
                  <th className="py-2 pr-2 font-medium">항목</th>
                  <th className="py-2 pr-2 font-medium w-36">금액 (원)</th>
                  <th className="py-2 pr-2 font-medium w-24">주기</th>
                  <th className="py-2 pr-2 font-medium w-28 text-right">월 환산</th>
                  <th className="py-2 pr-2 font-medium">메모</th>
                  <th className="py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {fixed.map(r => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="py-1.5 pr-2">
                      <input value={r.name} onChange={e => updateRow(r.id, { name: e.target.value })} placeholder="예: Vercel Pro"
                        className="w-full rounded-control border border-line bg-paper px-2 py-1 text-ink focus:border-accent focus:outline-none" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input type="number" min={0} step={100} value={r.amountKrw} onChange={e => updateRow(r.id, { amountKrw: Number(e.target.value) || 0 })}
                        className="w-full rounded-control border border-line bg-paper px-2 py-1 text-right tabular-nums text-ink focus:border-accent focus:outline-none" />
                    </td>
                    <td className="py-1.5 pr-2">
                      <select value={r.cycle} onChange={e => updateRow(r.id, { cycle: e.target.value as FixedCost['cycle'] })}
                        className="w-full rounded-control border border-line bg-paper px-2 py-1 text-ink focus:border-accent focus:outline-none">
                        <option value="monthly">월</option>
                        <option value="yearly">연</option>
                      </select>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-ink-2">{krw(r.cycle === 'yearly' ? r.amountKrw / 12 : r.amountKrw)}</td>
                    <td className="py-1.5 pr-2">
                      <input value={r.note ?? ''} onChange={e => updateRow(r.id, { note: e.target.value })} placeholder="메모"
                        className="w-full rounded-control border border-line bg-paper px-2 py-1 text-ink-2 focus:border-accent focus:outline-none" />
                    </td>
                    <td className="py-1.5 text-right">
                      <button onClick={() => removeRow(r.id)} className="p-1 text-ink-3 hover:text-critical" title="삭제"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-ink">
                  <td className="py-2 pr-2" colSpan={3}>합계 (월 환산)</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{krw(fixedMonthlyKrw)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {dirty && <p className="mt-2 text-[11px] text-caution">변경 사항이 있습니다 — [저장]을 눌러야 반영됩니다.</p>}
      </section>

      {/* 변동비 — 기능별 */}
      <section className="rounded-panel border border-line bg-paper p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h4 className="text-[13px] font-semibold text-ink flex items-center gap-1.5"><Zap className="w-4 h-4 text-ink-3" /> 변동비 — 기능별 API 사용 금액 ({monthLabel})</h4>
          <span className="text-[11px] text-ink-3">지난달 {krw(usdToKrw(v?.prevMonth.costUsd ?? 0))} · {(v?.prevMonth.calls ?? 0).toLocaleString()}회</span>
        </div>
        {loading && !data ? (
          <div className="flex items-center gap-2 py-6 justify-center text-ink-3 text-[12px]"><Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중...</div>
        ) : (v?.byFeature.length ?? 0) === 0 ? (
          <p className="text-[12px] text-ink-3 py-4 text-center">이번 달 기록된 API 호출이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-ink-3 border-b border-line">
                  <th className="py-2 pr-2 font-medium">기능</th>
                  <th className="py-2 pr-2 font-medium text-right w-24">호출</th>
                  <th className="py-2 pr-2 font-medium text-right w-28">USD</th>
                  <th className="py-2 pr-2 font-medium text-right w-28">원화</th>
                  <th className="py-2 font-medium w-40">비중</th>
                </tr>
              </thead>
              <tbody>
                {v!.byFeature.map(f => {
                  const share = v!.thisMonth.costUsd > 0 ? (f.costUsd / v!.thisMonth.costUsd) * 100 : 0;
                  const isSourcing = SOURCING_FEATURES.includes(f.feature);
                  return (
                    <tr key={f.feature} className={`border-b border-line/60 ${isSourcing ? 'bg-accent-soft/50' : ''}`}>
                      <td className="py-1.5 pr-2 text-ink">
                        {FEATURE_LABEL[f.feature] ?? f.feature}
                        {isSourcing && <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">소싱AI</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-ink-2">{f.calls.toLocaleString()}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-ink-2">{fmtUsd(f.costUsd)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums font-medium text-ink">{krw(usdToKrw(f.costUsd))}</td>
                      <td className="py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-paper-2 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${share}%` }} /></div>
                          <span className="w-10 text-right tabular-nums text-ink-3">{share.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="text-ink-2">
                  <td className="py-1.5 pr-2">소싱AI 소계</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{sourcingMonth.calls.toLocaleString()}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtUsd(sourcingMonth.costUsd)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{krw(usdToKrw(sourcingMonth.costUsd))}</td>
                  <td></td>
                </tr>
                <tr className="text-ink-2">
                  <td className="py-1.5 pr-2">기타 (썸네일·상세페이지·질문 등) 소계</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{otherMonth.calls.toLocaleString()}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtUsd(otherMonth.costUsd)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{krw(usdToKrw(otherMonth.costUsd))}</td>
                  <td></td>
                </tr>
                <tr className="font-semibold text-ink">
                  <td className="py-2 pr-2">변동비 합계</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{(v?.thisMonth.calls ?? 0).toLocaleString()}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{fmtUsd(v?.thisMonth.costUsd ?? 0)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{krw(variableMonthKrw)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-ink-3 leading-relaxed">
          단가 기준: GPT/Gemini는 토큰 사용량 × 모델 단가, Bright Data(쿠팡 수집)는 성공 건당 $0.0015, 1688 이미지 매칭은 건당 $0.005 추정입니다.
          Bright Data·1688 단가는 Vercel 환경변수 UNLOCKER_COST_USD / API1688_COST_USD로 계약 단가에 맞게 조정할 수 있습니다.
          캐시로 응답한 조회는 외부 비용이 없어 집계되지 않습니다.
        </p>
      </section>

      {/* 모델별 */}
      {v && v.byModel.length > 0 && (
        <section className="rounded-panel border border-line bg-paper p-5">
          <h4 className="text-[13px] font-semibold text-ink mb-3">변동비 — 모델/공급자별</h4>
          <div className="flex flex-wrap gap-2">
            {v.byModel.map(m => (
              <div key={m.model} className="rounded-card border border-line bg-paper-2 px-3 py-2 text-[12px]">
                <div className="font-medium text-ink">{m.model}</div>
                <div className="text-ink-2 tabular-nums">{m.calls.toLocaleString()}회 · {krw(usdToKrw(m.costUsd))}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, accent, live }: { label: string; value: string; sub?: string; accent?: boolean; live?: boolean }) {
  return (
    <div className={`rounded-card border p-4 ${accent ? 'border-accent-line bg-accent-soft/50' : 'border-line bg-paper'}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
        {label}
        {live && <span className="flex items-center gap-1 text-[10px] font-semibold text-positive"><span className="inline-block h-1.5 w-1.5 rounded-full bg-positive animate-pulse" />실시간</span>}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${accent ? 'text-accent' : 'text-ink'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}
