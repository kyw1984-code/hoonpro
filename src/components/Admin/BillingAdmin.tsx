import React, { useEffect, useState } from 'react';
import { CreditCard, Ticket, Plus, RefreshCw, Power, Loader2, AlertTriangle } from 'lucide-react';
import { getToken } from '../../lib/auth';

// 관리자 — 구독 현황 / 쿠폰 관리 / 유료화 스위치

interface SubRow {
  id: string;
  status: string;
  card_summary: string | null;
  next_billing_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  fail_count: number;
  created_at: string;
  users: { name: string; email: string } | null;
  coupons: { code: string } | null;
  plans: { name: string } | null;
}

interface CouponRow {
  id: string;
  code: string;
  type: 'free_period' | 'percent' | 'amount';
  value: number;
  duration_cycles: number | null;
  max_redemptions: number | null;
  redeemed_count: number;
  expires_at: string | null;
  active: boolean;
  note: string | null;
}

const SUB_STATUS: Record<string, { text: string; cls: string }> = {
  trial: { text: '무료 이용', cls: 'bg-positive-soft text-positive' },
  active: { text: '구독 중', cls: 'bg-positive-soft text-positive' },
  past_due: { text: '재시도 중', cls: 'bg-caution-soft text-caution' },
  paused: { text: '정지', cls: 'bg-critical-soft text-critical' },
  canceled: { text: '해지', cls: 'bg-paper-2 text-ink-3' },
};

// 차트 색 — dataviz 검증기(6개 검사) 통과 조합.
// UI 액센트(#7cf5ff)는 밝기가 높아 채움면에는 쓰지 않는다. 글자는 텍스트 토큰이 맡는다.
const MARK_PRIMARY = '#22a3b8';   // 월간 · 순매출 막대
const MARK_SECONDARY = '#8b7bff'; // 연간

const won = (n: number) => `${Math.round(n || 0).toLocaleString()}원`;
const monthLabel = (m: string) => `${Number(m.slice(5, 7))}월`;

// 해지 사유 라벨 — 값은 서버·구독 화면과 동일
const CANCEL_REASON_LABEL: Record<string, string> = {
  price: '가격 부담',
  'not-using': '자주 안 씀',
  'missing-feature': '기능 부족',
  quality: '결과물 불만족',
  temporary: '일시 중단',
  other: '기타',
  'toss-refund': '토스에서 환불 처리',
};

const COUPON_TYPE: Record<string, string> = {
  free_period: '무료 기간',
  percent: '정률 할인',
  amount: '정액 할인',
};

function couponValueLabel(c: CouponRow): string {
  if (c.type === 'free_period') return `${c.value}일 무료`;
  if (c.type === 'percent') return `${c.value}% 할인`;
  return `${c.value.toLocaleString()}원 할인`;
}

async function callBilling(action: string, body?: Record<string, unknown>) {
  const res = await fetch(`/api/billing?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '요청에 실패했습니다.');
  return data;
}

export function BillingAdmin({ showToast }: { showToast: (msg: string) => void }) {
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [stats, setStats] = useState<any | null>(null);
  const [revenue, setRevenue] = useState<any | null>(null);
  const [hoverMonth, setHoverMonth] = useState<number | null>(null);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [enforced, setEnforced] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [form, setForm] = useState({
    code: '', type: 'free_period' as CouponRow['type'], value: '30',
    durationCycles: '1', maxRedemptions: '', expiresAt: '', note: '',
  });

  const reload = async () => {
    setLoading(true);
    try {
      const [subData, couponData, cfg, statData, revData] = await Promise.all([
        callBilling('admin-subscriptions'),
        callBilling('admin-coupons'),
        callBilling('admin-config'),
        callBilling('admin-stats').catch(() => null),
        callBilling('admin-revenue').catch(() => null),
      ]);
      setSubs(subData.subscriptions ?? []);
      setByStatus(subData.byStatus ?? {});
      setCoupons(couponData.coupons ?? []);
      setEnforced(Boolean(cfg.billingEnforced));
      setStats(statData);
      setRevenue(revData);
    } catch (e: any) {
      showToast(e?.message ?? '구독 정보를 불러오지 못했습니다. (DB 마이그레이션 확인)');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const toggleEnforce = async () => {
    const next = !enforced;
    const warning = next
      ? '유료화를 켭니다. 구독이 없는 모든 계정은 즉시 기능 사용이 차단되고 구독 시작 화면을 보게 됩니다. 진행할까요?'
      : '유료화를 끕니다. 구독 없이도 모든 계정이 기능을 사용할 수 있게 됩니다. 진행할까요?';
    if (!confirm(warning)) return;
    setBusy(true);
    try {
      const data = await callBilling('admin-config', { enforce: next });
      setEnforced(Boolean(data.billingEnforced));
      showToast(next ? '유료화가 켜졌습니다.' : '유료화가 꺼졌습니다.');
    } catch (e: any) {
      showToast(e?.message ?? '설정 변경에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const createCoupon = async () => {
    if (!form.code.trim() || !form.value) return showToast('코드와 값을 입력해주세요.');
    setBusy(true);
    try {
      await callBilling('admin-coupon-create', {
        code: form.code.trim(),
        type: form.type,
        value: Number(form.value),
        durationCycles: form.type === 'free_period' ? 1 : (form.durationCycles === '' ? null : Number(form.durationCycles)),
        maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        note: form.note.trim() || null,
      });
      showToast('쿠폰이 생성됐습니다.');
      setShowCreate(false);
      setForm({ code: '', type: 'free_period', value: '30', durationCycles: '1', maxRedemptions: '', expiresAt: '', note: '' });
      await reload();
    } catch (e: any) {
      showToast(e?.message ?? '쿠폰 생성에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const toggleCoupon = async (c: CouponRow) => {
    setBusy(true);
    try {
      await callBilling('admin-coupon-update', { id: c.id, active: !c.active });
      showToast(c.active ? '쿠폰을 중지했습니다.' : '쿠폰을 다시 활성화했습니다.');
      await reload();
    } catch (e: any) {
      showToast(e?.message ?? '쿠폰 수정에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="text-center py-16 text-ink-3">불러오는 중...</div>;

  const inputCls = 'w-full rounded-control border border-line bg-paper-2 px-3 py-2 text-[13px] outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:bg-paper';

  const today = stats?.today;
  const needsAttention = (today?.needsAttention ?? 0) > 0 || (today?.failed ?? 0) > 0;

  return (
    <div className="space-y-8">
      {/* 매출 */}
      {revenue && (() => {
        const { totals, thisMonth, lastMonth, arpu, monthly, byPlan } = revenue;
        const peak = Math.max(1, ...monthly.map((m: any) => m.net));
        const diff = lastMonth ? thisMonth.net - lastMonth.net : null;
        const planTotal = Math.max(1, byPlan.reduce((a: number, p: any) => a + p.net, 0));

        return (
          <div className="space-y-4">
            {/* 헤드라인 숫자 — 차트가 아니라 그냥 숫자가 맞는 자리 */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { label: '이번 달 순매출', value: won(thisMonth.net),
                  sub: diff === null ? '비교할 지난달 없음'
                     : diff === 0 ? '지난달과 같음'
                     : `지난달 대비 ${diff > 0 ? '+' : '−'}${won(Math.abs(diff))}` },
                { label: '이번 달 결제자', value: `${thisMonth.payers.toLocaleString()}명`,
                  sub: `결제 ${thisMonth.count}건` },
                { label: '결제자당 매출', value: won(arpu),
                  sub: '이번 달 순매출 ÷ 결제자' },
                { label: '누적 순매출', value: won(totals.net),
                  sub: `총 ${totals.count}건 · 누적 결제자 ${totals.payers}명` },
              ].map(({ label, value, sub }) => (
                <div key={label} className="rounded-card border border-line bg-paper p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">{label}</p>
                  <p className="mt-1 whitespace-nowrap text-[16px] font-semibold tabular-nums text-ink sm:text-[20px]">{value}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{sub}</p>
                </div>
              ))}
            </div>

            {/* 월별 순매출 — 단일 계열이라 범례 없음 */}
            <div className="rounded-card border border-line bg-paper p-5">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
                <h3 className="text-[15px] font-semibold text-ink">월별 순매출</h3>
                <span className="text-[12px] text-ink-3">최근 12개월 · 결제액에서 환불액을 뺀 금액</span>
              </div>

              <div className="mt-5 flex gap-2">
                {/* 눈금 라벨 — 가로 스크롤 밖에 두어야 좁은 화면에서도 보인다 */}
                <div className="relative w-[62px] shrink-0" style={{ height: 180 }}>
                  {[1, 0.5].map(f => (
                    <span
                      key={f}
                      // 눈금선 바로 아래에 둔다. 선 위에 두면 최고 눈금 라벨이 카드 밖으로 나간다
                      className="absolute right-0 translate-y-[2px] whitespace-nowrap text-[10.5px] tabular-nums text-ink-3"
                      style={{ bottom: `${f * 100}%` }}
                    >
                      {won(peak * f)}
                    </span>
                  ))}
                </div>

                <div className="min-w-0 flex-1 overflow-x-auto">
                <div className="relative min-w-[420px]" style={{ height: 180 }}>
                  {[1, 0.5].map(f => (
                    <div
                      key={f}
                      className="pointer-events-none absolute left-0 right-0 border-t border-line"
                      style={{ bottom: `${f * 100}%` }}
                    />
                  ))}
                <div className="flex h-full items-end gap-[2px]">
                  {monthly.map((m: any, i: number) => {
                    const h = Math.max(m.net > 0 ? 3 : 0, (m.net / peak) * 100);
                    const isHover = hoverMonth === i;
                    return (
                      <div
                        key={m.month}
                        className="relative flex h-full flex-1 cursor-default flex-col justify-end"
                        onMouseEnter={() => setHoverMonth(i)}
                        onMouseLeave={() => setHoverMonth(null)}
                        onFocus={() => setHoverMonth(i)}
                        onBlur={() => setHoverMonth(null)}
                        tabIndex={0}
                      >
                        {isHover && (
                          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-[168px] -translate-x-1/2 rounded-control border border-line-strong bg-paper-2 p-2.5 text-[11.5px] shadow-overlay">
                            <p className="font-semibold text-ink">{m.month}</p>
                            <p className="mt-1 flex justify-between text-ink-2"><span>결제액</span><span className="tabular-nums text-ink">{won(m.gross)}</span></p>
                            <p className="flex justify-between text-ink-2"><span>환불액</span><span className="tabular-nums text-ink">−{won(m.refund)}</span></p>
                            <p className="mt-1 flex justify-between border-t border-line pt-1 font-semibold text-ink"><span>순매출</span><span className="tabular-nums">{won(m.net)}</span></p>
                            <p className="mt-1 flex justify-between text-ink-3"><span>결제자</span><span className="tabular-nums">{m.payers}명 / {m.count}건</span></p>
                          </div>
                        )}
                        <div
                          className="w-full rounded-t-[4px] transition-opacity"
                          style={{
                            height: `${h}%`,
                            background: MARK_PRIMARY,
                            opacity: hoverMonth === null || isHover ? 1 : 0.45,
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                </div>
                <div className="mt-2 flex min-w-[420px] gap-[2px] border-t border-line-strong pt-1.5">
                  {monthly.map((m: any) => (
                    <span key={m.month} className="flex-1 text-center text-[10.5px] tabular-nums text-ink-3">
                      {monthLabel(m.month)}
                    </span>
                  ))}
                </div>
                </div>
              </div>

              {totals.count === 0 && (
                <p className="mt-4 text-[12.5px] text-ink-2">
                  아직 결제 기록이 없습니다. 첫 결제가 발생하면 여기에 월별 추이가 그려집니다.
                </p>
              )}
            </div>

            {/* 플랜별 구성 — 두 계열이라 색+직접 라벨을 함께 쓴다 */}
            {byPlan.length > 0 && (
              <div className="rounded-card border border-line bg-paper p-5">
                <h3 className="mb-4 text-[15px] font-semibold text-ink">
                  플랜별 매출 <span className="text-[12px] font-normal text-ink-3">누적 순매출</span>
                </h3>
                <div className="flex flex-col gap-3">
                  {byPlan.map((p: any) => {
                    const pct = Math.round((p.net / planTotal) * 100);
                    return (
                      <div key={p.name}>
                        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                              style={{ background: p.interval === 'year' ? MARK_SECONDARY : MARK_PRIMARY }}
                            />
                            {p.name}
                          </span>
                          <span className="text-[12.5px] tabular-nums text-ink-2">
                            <b className="font-semibold text-ink">{won(p.net)}</b> · {p.count}건 · {pct}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-paper-2">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, background: p.interval === 'year' ? MARK_SECONDARY : MARK_PRIMARY }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* 오늘 — 매일 확인해야 이상을 하루 안에 발견할 수 있다 */}
      {today && (
        <div className={`rounded-card border p-5 ${needsAttention ? 'border-caution/40 bg-caution-soft' : 'border-line bg-paper'}`}>
          <div className="mb-4 flex items-center gap-2">
            {needsAttention
              ? <AlertTriangle className="h-4 w-4 text-caution" />
              : <CreditCard className="h-4 w-4 text-ink" />}
            <h3 className="text-[15px] font-semibold text-ink">오늘</h3>
            {needsAttention && (
              <span className="rounded-full bg-caution-soft px-2 py-0.5 text-[11px] font-semibold text-caution">
                확인 필요
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              { label: '신규 구독', value: `${today.newSubs ?? 0}명`, warn: false },
              { label: '해지 신청', value: `${today.canceled ?? 0}명`, warn: false },
              { label: '결제 성공', value: `${today.paid ?? 0}건`, warn: false },
              { label: '결제 실패', value: `${today.failed ?? 0}건`, warn: (today.failed ?? 0) > 0 },
              { label: '조치 필요', value: `${today.needsAttention ?? 0}명`, warn: (today.needsAttention ?? 0) > 0 },
            ].map(({ label, value, warn }) => (
              <div key={label} className="rounded-control border border-line bg-paper p-3">
                <p className="text-[11px] font-semibold text-ink-3">{label}</p>
                <p className={`mt-1 text-[18px] font-semibold tabular-nums ${warn ? 'text-critical' : 'text-ink'}`}>{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] text-ink-2">
            오늘 결제액 {(today.revenue ?? 0).toLocaleString()}원 · 해지 예약 {today.cancelScheduled ?? 0}명
            {' · '}같은 내용을 매일 저녁 크론 실행 후 관리자 메일로도 보냅니다.
          </p>
        </div>
      )}

      {/* 수익 요약 */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: '유효 구독자', value: `${(stats.totalSubscribers ?? 0).toLocaleString()}명`, sub: `체험 ${stats.counts?.trial ?? 0} · 활성 ${stats.counts?.active ?? 0} · 재시도 ${stats.counts?.past_due ?? 0}` },
            { label: '월 반복 매출 (MRR)', value: `${(stats.mrr ?? 0).toLocaleString()}원`, sub: '활성·재시도 구독 기준 추정' },
            { label: '최근 30일 결제액', value: `${(stats.revenue30d ?? 0).toLocaleString()}원`, sub: `성공 ${stats.payments30d ?? 0}건 · 실패 ${stats.failed30d ?? 0}건` },
            { label: '최근 30일 해지', value: `${(stats.canceled30d ?? 0).toLocaleString()}명`, sub: `누적 해지 ${stats.counts?.canceled ?? 0} · 정지 ${stats.counts?.paused ?? 0}` },
          ].map(({ label, value, sub }) => (
            <div key={label} className="rounded-card border border-line bg-paper p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">{label}</p>
              <p className="mt-1 whitespace-nowrap text-[16px] font-semibold tabular-nums text-ink sm:text-[20px]">{value}</p>
              <p className="mt-0.5 text-[11px] text-ink-3">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* 해지 사유 (최근 30일) — 무엇을 고쳐야 하는지 알려주는 지표 */}
      {stats?.cancelReasons && Object.keys(stats.cancelReasons).length > 0 && (
        <div className="rounded-card border border-line bg-paper p-5">
          <h3 className="mb-3 text-[15px] font-semibold text-ink">해지 사유 <span className="text-[12px] font-normal text-ink-3">최근 30일</span></h3>
          <div className="flex flex-col gap-2">
            {Object.entries(stats.cancelReasons as Record<string, number>)
              .sort((a, b) => b[1] - a[1])
              .map(([key, count]) => {
                const total = Object.values(stats.cancelReasons as Record<string, number>).reduce((s, n) => s + n, 0);
                const pct = Math.round((count / total) * 100);
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-[150px] shrink-0 text-[12.5px] text-ink-2">{CANCEL_REASON_LABEL[key] ?? key}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-2">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: MARK_PRIMARY }} />
                    </div>
                    <span className="w-[64px] shrink-0 text-right text-[12px] tabular-nums text-ink-3">{count}건 {pct}%</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* 유료화 스위치 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-paper p-5">
        <div>
          <div className="flex items-center gap-2">
            <Power className={`h-4 w-4 ${enforced ? 'text-positive' : 'text-ink-3'}`} />
            <h3 className="text-[15px] font-semibold text-ink">유료화 강제</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${enforced ? 'bg-positive-soft text-positive' : 'bg-paper-2 text-ink-3'}`}>
              {enforced ? 'ON' : 'OFF'}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-2">
            켜면 구독 없는 계정은 기능 사용이 차단됩니다. 소프트 오픈(수강생 쿠폰 배포) 시점에 켜세요.
          </p>
        </div>
        <button
          onClick={toggleEnforce}
          disabled={busy || enforced === null}
          className={`rounded-control px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 ${
            enforced ? 'border border-line text-ink' : 'bg-ink text-paper'
          }`}
        >
          {enforced ? '유료화 끄기' : '유료화 켜기'}
        </button>
      </div>

      {/* 쿠폰 관리 */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-accent" />
            <h3 className="text-lg font-semibold text-ink">쿠폰 ({coupons.length})</h3>
          </div>
          <button
            onClick={() => setShowCreate(v => !v)}
            className="flex items-center gap-1.5 rounded-control bg-ink px-3.5 py-1.5 text-[13px] font-medium text-paper transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> 쿠폰 만들기
          </button>
        </div>

        {showCreate && (
          <div className="mb-4 rounded-card border border-line bg-paper p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">쿠폰 코드</label>
                <input className={inputCls + ' uppercase'} placeholder="예: HOONPRO1M" value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">유형</label>
                <select className={inputCls} value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value as CouponRow['type'], value: e.target.value === 'free_period' ? '30' : e.target.value === 'percent' ? '30' : '10000' }))}>
                  <option value="free_period">무료 기간 (일)</option>
                  <option value="percent">정률 할인 (%)</option>
                  <option value="amount">정액 할인 (원)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">
                  {form.type === 'free_period' ? '무료 일수' : form.type === 'percent' ? '할인율 (%)' : '할인액 (원)'}
                </label>
                <input className={inputCls} type="number" value={form.value}
                  onChange={e => setForm(f => ({ ...f, value: e.target.value }))} />
              </div>
              {form.type !== 'free_period' && (
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-ink-2">할인 적용 회차 (비우면 계속)</label>
                  <input className={inputCls} type="number" placeholder="예: 3 = 첫 3개월" value={form.durationCycles}
                    onChange={e => setForm(f => ({ ...f, durationCycles: e.target.value }))} />
                </div>
              )}
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">총 사용 한도 (비우면 무제한)</label>
                <input className={inputCls} type="number" placeholder="예: 100" value={form.maxRedemptions}
                  onChange={e => setForm(f => ({ ...f, maxRedemptions: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">유효기간 (비우면 무기한)</label>
                <input className={inputCls} type="date" value={form.expiresAt}
                  onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="mb-1 block text-[12px] font-medium text-ink-2">메모</label>
                <input className={inputCls} placeholder="예: 기존 수강생 전원 무료 1개월" value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              </div>
            </div>
            <button
              onClick={createCoupon}
              disabled={busy}
              className="mt-4 flex items-center gap-1.5 rounded-control bg-accent px-4 py-2 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} 생성
            </button>
            <p className="mt-2 text-[12px] text-ink-3">모든 쿠폰은 1인(본인인증 CI 기준) 1회만 사용할 수 있습니다.</p>
          </div>
        )}

        {coupons.length === 0 ? (
          <p className="rounded-card border border-line bg-paper px-4 py-8 text-center text-[13px] text-ink-3">
            쿠폰이 없습니다. '쿠폰 만들기'로 첫 쿠폰을 생성하세요. (예: 수강생 무료 1개월 — 무료 기간 30일)
          </p>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-paper">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-paper-2">
                  <tr>
                    {['코드', '혜택', '적용', '사용', '유효기간', '메모', '상태', '관리'].map(h => (
                      <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {coupons.map(c => (
                    <tr key={c.id} className="transition-colors hover:bg-paper-2">
                      <td className="px-4 py-3 font-mono text-[13px] font-semibold text-ink">{c.code}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink">{couponValueLabel(c)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-2">
                        {c.type === 'free_period' ? '가입 시 1회' : c.duration_cycles === null ? '계속' : `첫 ${c.duration_cycles}회`}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-2">
                        {c.redeemed_count}{c.max_redemptions !== null && ` / ${c.max_redemptions}`}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-2">{c.expires_at ? c.expires_at.slice(0, 10) : '무기한'}</td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-[12px] text-ink-3">{c.note ?? ''}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.active ? 'bg-positive-soft text-positive' : 'bg-paper-2 text-ink-3'}`}>
                          {c.active ? '사용 가능' : '중지됨'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleCoupon(c)}
                          disabled={busy}
                          className="rounded-control bg-paper-2 px-2.5 py-1 text-xs text-ink transition-colors hover:bg-line disabled:opacity-40"
                        >
                          {c.active ? '중지' : '재개'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 구독 현황 */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-accent" />
            <h3 className="text-lg font-semibold text-ink">구독 현황</h3>
          </div>
          <button onClick={reload} className="flex items-center gap-1.5 text-sm text-ink-2 transition-colors hover:text-ink">
            <RefreshCw className="h-4 w-4" /> 새로고침
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(['trial', 'active', 'past_due', 'paused', 'canceled'] as const).map(s => (
            <span key={s} className={`rounded-full px-3 py-1 text-[12px] font-medium ${SUB_STATUS[s].cls}`}>
              {SUB_STATUS[s].text} {byStatus[s] ?? 0}
            </span>
          ))}
        </div>

        {subs.length === 0 ? (
          <p className="rounded-card border border-line bg-paper px-4 py-8 text-center text-[13px] text-ink-3">아직 구독이 없습니다.</p>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-paper">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-paper-2">
                  <tr>
                    {['회원', '플랜', '상태', '카드', '다음 결제일', '이용 기간', '쿠폰', '실패', '시작일'].map(h => (
                      <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {subs.map(s => (
                    <tr key={s.id} className="transition-colors hover:bg-paper-2">
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{s.users?.name ?? '-'}</div>
                        <div className="text-[12px] text-ink-3">{s.users?.email ?? ''}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-2">{s.plans?.name ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SUB_STATUS[s.status]?.cls ?? ''}`}>
                          {SUB_STATUS[s.status]?.text ?? s.status}
                        </span>
                        {s.cancel_at_period_end && <span className="ml-1 text-[11px] text-ink-3">(해지 예약)</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-2">{s.card_summary ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-2">{s.next_billing_at ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-2">{s.current_period_end?.slice(0, 10) ?? '-'} 까지</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-ink-2">{s.coupons?.code ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-2">{s.fail_count > 0 ? `${s.fail_count}회` : '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[12px] text-ink-2">{new Date(s.created_at).toLocaleDateString('ko-KR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
