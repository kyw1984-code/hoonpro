import React, { useEffect, useState } from 'react';
import { CreditCard, Ticket, Plus, RefreshCw, Power, Loader2, AlertTriangle, Trash2 } from 'lucide-react';
import { couponBenefitLabel } from '../../lib/coupon';
import { isReferralNote } from '../../lib/referral';
import { getToken } from '../../lib/auth';
import { won } from '../../lib/coupang';

// 관리자 — 구독 현황 / 쿠폰 관리 / 유료화 스위치

interface SubRow {
  id: string;
  status: string;
  card_summary: string | null;
  next_billing_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  /** 해지 신청 시각 — status가 canceled로 넘어가기 전에도 찍힌다 */
  canceled_at: string | null;
  cancel_reason: string | null;
  fail_count: number;
  created_at: string;
  users: { name: string; email: string } | null;
  coupons: { code: string } | null;
  plans: { name: string } | null;
}

interface CouponRow {
  id: string;
  code: string;
  type: 'free_period' | 'percent' | 'amount' | 'amount_monthly';
  value: number;
  trial_days?: number | null;
  duration_cycles: number | null;
  max_redemptions: number | null;
  redeemed_count: number;
  expires_at: string | null;
  active: boolean;
  note: string | null;
  /** 한도가 다 찬 뒤 입력하면 대신 안내할 쿠폰 코드 */
  fallback_code?: string | null;
  /** 지금 이 쿠폰으로 할인받고 있는 구독 수 — 서버가 세어서 내려준다 */
  inUse?: number;
}

/**
 * 자주 쓰는 기간. 날짜 두 칸을 직접 채우는 건 매번 번거롭다.
 * 오늘을 KST로 잡는다 — 서버가 한국 시각 경계로 거르기 때문이다.
 */
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const kstDaysAgo = (n: number) =>
  new Date(Date.now() + 9 * 3600_000 - n * 86400_000).toISOString().slice(0, 10);

const QUICK_RANGES: { label: string; range: () => [string, string] }[] = [
  { label: '오늘', range: () => [kstToday(), kstToday()] },
  { label: '7일', range: () => [kstDaysAgo(6), kstToday()] },
  { label: '30일', range: () => [kstDaysAgo(29), kstToday()] },
];

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
  amount_monthly: '정액 할인 (월 기준)',
};

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
  /**
   * 상태별 보기.
   *
   * 예전에는 숫자만 보여줘서 '재시도 중 3'을 보고도 누구인지 알려면 표를
   * 끝까지 훑어야 했다. 손이 가야 하는 사람(재시도 중·정지)을 바로 추려
   * 보려고 칩을 누를 수 있게 했다. 'all'이 기본이다.
   */
  const [subFilter, setSubFilter] = useState<string>('all');
  /**
   * 조회 기간. 비우면 누적(전체)이다.
   *
   * [오늘] 카드만 있던 시절에는 어제 누가 해지했는지 되짚을 방법이 없었다.
   * 기본을 누적으로 두는 이유는, 기간을 좁힌 화면을 열어 두고 '해지 0'을
   * 보면 진짜 없는 건지 그 기간에만 없는 건지 알 수 없어서다.
   */
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [payments, setPayments] = useState<any[] | null>(null);
  const [payTotals, setPayTotals] = useState<any>(null);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [enforced, setEnforced] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  /**
   * 회원 개인 추천 코드를 목록에 펼칠지.
   *
   * 추천 코드는 회원 한 명당 하나씩 자동으로 생긴다. 프로모션 쿠폰과 섞어
   * 두면 회원이 늘수록 HOON-xxxxxx가 목록을 덮어, 정작 봐야 할 쿠폰이
   * 묻히고 '쿠폰이 계속 자동발급된다'로 읽힌다. 기본은 접어 둔다.
   */
  const [showReferrals, setShowReferrals] = useState(false);

  const [form, setForm] = useState({
    code: '', type: 'free_period' as CouponRow['type'], value: '30',
    trialDays: '', durationCycles: '1', maxRedemptions: '', expiresAt: '', note: '', fallbackCode: '',
  });

  const reload = async () => {
    setLoading(true);
    try {
      const range = { from: rangeFrom || undefined, to: rangeTo || undefined };
      const [subData, couponData, cfg, statData, revData, payData] = await Promise.all([
        callBilling('admin-subscriptions', range),
        callBilling('admin-coupons'),
        callBilling('admin-config'),
        callBilling('admin-stats').catch(() => null),
        callBilling('admin-revenue').catch(() => null),
        callBilling('admin-payments', range).catch(() => null),
      ]);
      setSubs(subData.subscriptions ?? []);
      setByStatus(subData.byStatus ?? {});
      setPayments(payData?.payments ?? []);
      setPayTotals(payData?.totals ?? null);
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

  // 운영자가 만든 프로모션 쿠폰과, 회원마다 자동으로 생기는 개인 추천 코드를
  // 가른다. 둘은 성격이 다르다 — 앞의 것은 관리 대상이고, 뒤의 것은 회원 수만큼
  // 늘어나는 부산물이다. 섞어 놓으면 회원이 늘수록 앞의 것이 묻힌다.
  const referralCoupons = coupons.filter(c => isReferralNote(c.note));
  const promoCoupons = coupons.filter(c => !isReferralNote(c.note));
  const shownCoupons = showReferrals ? coupons : promoCoupons;

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
        trialDays: form.type === 'free_period' ? 0 : (form.trialDays === '' ? 0 : Number(form.trialDays)),
        durationCycles: form.type === 'free_period' ? 1 : (form.durationCycles === '' ? null : Number(form.durationCycles)),
        maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        note: form.note.trim() || null,
        fallbackCode: form.fallbackCode.trim() || null,
      });
      showToast('쿠폰이 생성됐습니다.');
      setShowCreate(false);
      setForm({ code: '', type: 'free_period', value: '30', trialDays: '', durationCycles: '1', maxRedemptions: '', expiresAt: '', note: '', fallbackCode: '' });
      await reload();
    } catch (e: any) {
      showToast(e?.message ?? '쿠폰 생성에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * 쿠폰 삭제.
   *
   * 쓰고 있는 사람이 있으면 서버가 409로 막는다. 여기서도 코드를 직접 치게
   * 해서 손이 미끄러지는 것을 한 번 더 거른다 — 되돌릴 수 없는 일이다.
   */
  const deleteCoupon = async (c: CouponRow) => {
    const typed = window.prompt(
      `'${c.code}' 쿠폰을 영구 삭제합니다. 되돌릴 수 없습니다.\n` +
      `사용 기록 ${c.redeemed_count}건도 함께 지워집니다.\n\n` +
      `확인하려면 쿠폰 코드를 그대로 입력해주세요.`,
    );
    if (typed === null) return;
    if (typed.trim() !== c.code) {
      showToast('코드가 다릅니다. 삭제하지 않았습니다.');
      return;
    }
    setBusy(true);
    try {
      await callBilling('admin-coupon-delete', { id: c.id });
      showToast(`'${c.code}' 쿠폰을 삭제했습니다.`);
      await reload();
    } catch (e: any) {
      showToast(e?.message ?? '쿠폰을 삭제하지 못했습니다.');
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

  // 전체 수는 서버가 센 값을 더한다. 표는 최근 200건까지만 내려오므로
  // subs.length로 세면 200명이 넘는 순간 '전체'가 실제보다 적게 나온다.
  const subTotal = Object.values(byStatus).reduce((n, v) => n + v, 0);
  const shownSubs = subFilter === 'all' ? subs : subs.filter(s => s.status === subFilter);
  // 고른 상태의 사람이 표에 다 안 들어온 경우 — 그렇다고 말해 준다
  const subTruncated = subFilter === 'all'
    ? subTotal > subs.length
    : (byStatus[subFilter] ?? 0) > shownSubs.length;

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

            {/* 쿠폰 할인 결제도 위 매출에 들어 있다. 그중 얼마가 할인 결제였고
                얼마를 깎아줬는지만 따로 적는다. */}
            {totals.couponCount > 0 && (
              <div className="rounded-card border border-line bg-paper-2 px-4 py-3 text-[12.5px] text-ink-2">
                <b className="text-ink">쿠폰 할인 결제도 위 매출에 포함됩니다.</b>{' '}
                누적 {totals.couponCount}건 · {won(totals.couponNet)} 입금 (할인 {won(totals.discount ?? 0)})
                {thisMonth.couponCount > 0 && (
                  <> · 이번 달 {thisMonth.couponCount}건 · {won(thisMonth.couponNet)} 입금 (할인 {won(thisMonth.discount ?? 0)})</>
                )}
                <span className="mt-0.5 block text-[11.5px] text-ink-3">
                  무료 기간 쿠폰은 결제가 일어나지 않아 애초에 집계되지 않습니다. 할인액은 부가세 포함 기준입니다.
                </span>
              </div>
            )}

            {/* 월별 순매출 — 단일 계열이라 범례 없음 */}
            <div className="rounded-card border border-line bg-paper p-5">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
                <h3 className="text-[15px] font-semibold text-ink">월별 순매출</h3>
                <span className="text-[12px] text-ink-3">최근 12개월 · 결제액에서 환불액을 뺀 금액 (쿠폰 적용 결제 제외)</span>
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
            {
              label: '최근 30일 해지',
              value: `${(stats.canceled30d ?? 0).toLocaleString()}명`,
              // 해지 예약을 함께 적는다. 해지 버튼을 누른 사람은 남은 기간이
              // 끝나는 날에야 canceled로 바뀌어서, 그 전까지 이 카드가 0으로
              // 보인다 — 위 [오늘] 카드는 1이라고 하는데 여기는 0이면
              // 어느 쪽이 맞는지 알 수 없다.
              sub: `${(stats.cancelScheduled ?? 0) > 0 ? `해지 예약 ${stats.cancelScheduled} · ` : ''}누적 해지 ${stats.counts?.canceled ?? 0} · 정지 ${stats.counts?.paused ?? 0}`,
            },
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
          <div className="flex flex-wrap items-center gap-2">
            <Ticket className="h-5 w-5 text-accent" />
            <h3 className="text-lg font-semibold text-ink">쿠폰 ({promoCoupons.length})</h3>
            {referralCoupons.length > 0 && (
              <button
                onClick={() => setShowReferrals(v => !v)}
                className="rounded-control border border-line px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-accent-line hover:text-accent"
              >
                회원 추천 코드 {referralCoupons.length}개 {showReferrals ? '접기' : '보기'}
              </button>
            )}
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
                  onChange={e => setForm(f => ({
                    ...f,
                    type: e.target.value as CouponRow['type'],
                    value: e.target.value === 'free_period' ? '30'
                      : e.target.value === 'percent' ? '30'
                      : e.target.value === 'amount_monthly' ? '5000' : '10000',
                  }))}>
                  <option value="free_period">무료 기간만 (일)</option>
                  <option value="percent">정률 할인 (%)</option>
                  <option value="amount">정액 할인 (원 · 플랜 무관 고정)</option>
                  <option value="amount_monthly">정액 할인 (월 기준 원 · 연간은 ×12)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">
                  {form.type === 'free_period' ? '무료 일수'
                    : form.type === 'percent' ? '할인율 (%)'
                    : form.type === 'amount_monthly' ? '월 기준 할인액 (원)' : '할인액 (원)'}
                </label>
                <input className={inputCls} type="number" value={form.value}
                  onChange={e => setForm(f => ({ ...f, value: e.target.value }))} />
              </div>
              {form.type !== 'free_period' && (
                <>
                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-ink-2">할인 적용 회차 (비우면 계속)</label>
                    <input className={inputCls} type="number" placeholder="비우면 갱신 때마다 계속" value={form.durationCycles}
                      onChange={e => setForm(f => ({ ...f, durationCycles: e.target.value }))} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-ink-2">무료 일수 (비우면 없음)</label>
                    <input className={inputCls} type="number" placeholder="예: 30 = 30일 무료 후 할인가로 결제" value={form.trialDays}
                      onChange={e => setForm(f => ({ ...f, trialDays: e.target.value }))} />
                  </div>
                </>
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
              <div>
                <label className="mb-1 block text-[12px] font-medium text-ink-2">소진 시 안내할 대체 쿠폰 (선택)</label>
                <input className={inputCls} placeholder="예: 훈프로3 — 한도가 다 차면 이 코드를 팝업으로 안내" value={form.fallbackCode}
                  onChange={e => setForm(f => ({ ...f, fallbackCode: e.target.value }))} />
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
            <p className="mt-2 text-[12px] text-ink-3">
              모든 쿠폰은 1인(본인인증 CI 기준) 1회만 사용할 수 있습니다.
              {' '}수강생용 예: <b className="text-ink-2">월 기준 5,000원 · 회차 비움 · 무료 30일</b> → 30일 무료 후 월간은 5,000원, 연간은 60,000원이 갱신할 때마다 계속 할인됩니다.
            </p>
          </div>
        )}

        {shownCoupons.length === 0 ? (
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
                  {shownCoupons.map(c => (
                    <tr key={c.id} className="transition-colors hover:bg-paper-2">
                      <td className="px-4 py-3 font-mono text-[13px] font-semibold text-ink">{c.code}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink">{couponBenefitLabel(c)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-2">
                        {c.type === 'free_period' ? '가입 시 1회' : c.duration_cycles === null ? '계속' : `첫 ${c.duration_cycles}회`}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-2">
                        {c.redeemed_count}{c.max_redemptions !== null && ` / ${c.max_redemptions}`}
                        {/* 지금 할인받고 있는 사람 수. 이게 0이어야 지울 수 있다 */}
                        {(c.inUse ?? 0) > 0 && (
                          <span className="mt-0.5 block text-[11px] font-semibold text-accent">할인 중 {c.inUse}명</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-2">{c.expires_at ? c.expires_at.slice(0, 10) : '무기한'}</td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-[12px] text-ink-3">
                        {c.note ?? ''}
                        {c.fallback_code && <span className="mt-0.5 block text-[11px] text-accent">소진 시 → {c.fallback_code}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.active ? 'bg-positive-soft text-positive' : 'bg-paper-2 text-ink-3'}`}>
                          {c.active ? '사용 가능' : '중지됨'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => toggleCoupon(c)}
                            disabled={busy}
                            className="rounded-control bg-paper-2 px-2.5 py-1 text-xs text-ink transition-colors hover:bg-line disabled:opacity-40"
                          >
                            {c.active ? '중지' : '재개'}
                          </button>
                          {/* 할인받는 사람이 있으면 아예 누를 수 없게 한다.
                              눌러서 오류를 보는 것보다 못 누르는 편이 낫다. */}
                          <button
                            onClick={() => deleteCoupon(c)}
                            disabled={busy || (c.inUse ?? 0) > 0}
                            title={(c.inUse ?? 0) > 0
                              ? `${c.inUse}명이 이 쿠폰으로 할인받는 중이라 삭제할 수 없습니다. [중지]를 쓰세요.`
                              : '쿠폰 영구 삭제'}
                            className="rounded-control border border-line px-2 py-1 text-xs text-ink-3 transition-colors hover:border-critical/40 hover:bg-critical-soft hover:text-critical disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-line disabled:hover:bg-transparent disabled:hover:text-ink-3"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
          <b>중지</b>는 새로 쓰는 것만 막습니다 — 이미 이 쿠폰으로 구독 중인 분들의 할인은 그대로 유지됩니다.
          <b className="ml-1">삭제</b>는 되돌릴 수 없고 사용 기록까지 지웁니다. 할인받는 분이 한 명이라도 있으면 누를 수 없습니다.
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
          <b>HOON-</b>으로 시작하는 코드는 <b>회원 개인 추천 코드</b>입니다. 회원이 [친구 추천] 화면을 처음 열 때
          한 명당 하나씩 자동으로 생기고, 그 친구의 첫 결제 10%를 할인합니다. 회원 수만큼 늘어나는 것이 정상이라
          위 목록에서는 접어 두었습니다 — 지우지 마세요. 지우면 그 회원의 추천 링크가 끊깁니다.
        </p>
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

        {/* 조회 기간 — 비우면 누적. 구독 목록과 아래 결제 내역에 함께 걸린다 */}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card border border-line bg-paper-2 px-3 py-2">
          <span className="text-[12px] font-semibold text-ink-2">조회 기간</span>
          <input type="date" value={rangeFrom} max={rangeTo || undefined}
            onChange={e => setRangeFrom(e.target.value)}
            className="rounded-control border border-line bg-paper px-2 py-1 text-[12.5px] text-ink" />
          <span className="text-ink-3">~</span>
          <input type="date" value={rangeTo} min={rangeFrom || undefined}
            onChange={e => setRangeTo(e.target.value)}
            className="rounded-control border border-line bg-paper px-2 py-1 text-[12.5px] text-ink" />
          <button onClick={reload} disabled={loading}
            className="rounded-control border border-accent-line bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent disabled:opacity-50">
            조회
          </button>
          {(rangeFrom || rangeTo) && (
            <button onClick={() => { setRangeFrom(''); setRangeTo(''); setTimeout(reload, 0); }}
              className="rounded-control border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink">
              누적 전체
            </button>
          )}
          {QUICK_RANGES.map(r => (
            <button key={r.label}
              onClick={() => { const [f, t] = r.range(); setRangeFrom(f); setRangeTo(t); setTimeout(reload, 0); }}
              className="rounded-control border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:border-accent-line hover:text-accent">
              {r.label}
            </button>
          ))}
          <span className="ml-auto text-[11.5px] text-ink-3">
            {rangeFrom || rangeTo ? `${rangeFrom || '처음'} ~ ${rangeTo || '오늘'} 가입분` : '누적 전체'}
          </span>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {/* 전체가 맨 앞이다. 걸러 놓은 것을 되돌릴 자리가 눈에 안 보이면
              사용자는 새로고침을 누른다. */}
          <button
            onClick={() => setSubFilter('all')}
            aria-pressed={subFilter === 'all'}
            className={`rounded-full px-3 py-1 text-[12px] font-medium transition-all ${
              subFilter === 'all'
                ? 'bg-accent-soft text-accent ring-1 ring-accent'
                : 'bg-paper-2 text-ink-2 hover:text-ink'
            }`}
          >
            전체 {subTotal}
          </button>
          {(['trial', 'active', 'past_due', 'paused', 'canceled'] as const).map(st => {
            const n = byStatus[st] ?? 0;
            const on = subFilter === st;
            return (
              <button
                key={st}
                // 한 번 더 누르면 전체로 돌아온다 — 끄는 법을 따로 찾지 않게
                onClick={() => setSubFilter(on ? 'all' : st)}
                aria-pressed={on}
                className={`rounded-full px-3 py-1 text-[12px] font-medium transition-all ${SUB_STATUS[st].cls} ${
                  on ? 'ring-1 ring-accent' : n === 0 ? 'opacity-45 hover:opacity-70' : 'hover:opacity-80'
                }`}
              >
                {SUB_STATUS[st].text} {n}
              </button>
            );
          })}
        </div>

        {shownSubs.length === 0 ? (
          <p className="rounded-card border border-line bg-paper px-4 py-8 text-center text-[13px] text-ink-3">
            {subs.length === 0
              ? '아직 구독이 없습니다.'
              : `${SUB_STATUS[subFilter]?.text ?? '해당 상태'}인 회원이 없습니다.`}
          </p>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-paper">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-paper-2">
                  <tr>
                    {['회원', '플랜', '상태', '카드', '다음 결제일', '이용 기간', '쿠폰', '해지', '실패', '시작일'].map(h => (
                      <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shownSubs.map(s => (
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
                      {/* 해지 신청 시점과 사유. 숫자만 보고 '누가?'를 되묻지 않게 */}
                      <td className="whitespace-nowrap px-4 py-3 text-[12px]">
                        {s.canceled_at ? (
                          <>
                            <span className="text-ink-2">{new Date(s.canceled_at).toLocaleDateString('ko-KR')}</span>
                            <span className="mt-0.5 block text-[11px] text-ink-3">{s.cancel_reason ?? '사유 미입력'}</span>
                          </>
                        ) : <span className="text-ink-3">-</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-2">{s.fail_count > 0 ? `${s.fail_count}회` : '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[12px] text-ink-2">{new Date(s.created_at).toLocaleDateString('ko-KR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {subTruncated && (
          <p className="mt-2 text-[11.5px] text-ink-3">
            최근 200건까지만 보여줍니다 — 위 숫자는 전체 기준입니다.
          </p>
        )}
      </div>

      {/* 결제 내역 — '결제 성공 3건'만으로는 고객이 "돈이 나갔는데요" 할 때
          답할 수가 없다. 누가 언제 얼마를 냈는지 그대로 보여준다. */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-accent" />
          <h3 className="text-lg font-semibold text-ink">결제 내역</h3>
          <span className="text-[12px] text-ink-3">
            {rangeFrom || rangeTo ? `${rangeFrom || '처음'} ~ ${rangeTo || '오늘'}` : '누적 전체'}
          </span>
        </div>

        {payTotals && (
          <div className="mb-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-positive-soft px-3 py-1 text-[12px] font-medium text-positive">
              성공 {payTotals.paidCount}건 · {won(payTotals.paidAmount)}
            </span>
            {payTotals.failedCount > 0 && (
              <span className="rounded-full bg-critical-soft px-3 py-1 text-[12px] font-medium text-critical">
                실패 {payTotals.failedCount}건
              </span>
            )}
            {payTotals.refundedCount > 0 && (
              <span className="rounded-full bg-paper-2 px-3 py-1 text-[12px] font-medium text-ink-2">
                환불 {payTotals.refundedCount}건 · {won(payTotals.refundedAmount)}
              </span>
            )}
          </div>
        )}

        {!payments || payments.length === 0 ? (
          <p className="rounded-card border border-line bg-paper px-4 py-8 text-center text-[13px] text-ink-3">
            이 기간에 결제 내역이 없습니다.
          </p>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-paper">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-paper-2">
                  <tr>
                    {['결제 시각', '회원', '내용', '금액', '상태', '영수증'].map(h => (
                      <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {payments.map((p: any) => (
                    <tr key={p.id} className="transition-colors hover:bg-paper-2">
                      <td className="whitespace-nowrap px-4 py-3 text-[12.5px] tabular-nums text-ink-2">
                        {new Date(p.created_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-4 py-3">
                        {/* 회원이 삭제돼도 결제 기록은 남는다(법정 5년 보존).
                            그때는 주문번호로만 짚을 수 있게 한다. */}
                        <div className="text-[13px] text-ink">{p.users?.name ?? '(삭제된 회원)'}</div>
                        <div className="text-[11.5px] text-ink-3">{p.users?.email ?? p.order_id}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[12.5px] text-ink-2">{p.order_name ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        <span className="text-[13px] font-semibold text-ink">{won(p.amount)}</span>
                        {(Number(p.discount) || 0) > 0 && (
                          <span className="mt-0.5 block text-[11px] text-accent">할인 {won(p.discount)}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {p.status === 'paid' ? (
                          <span className="rounded-full bg-positive-soft px-2 py-0.5 text-[11px] font-semibold text-positive">결제됨</span>
                        ) : p.status === 'refunded' ? (
                          <>
                            <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2">환불됨</span>
                            <span className="mt-0.5 block text-[11px] text-ink-3">{won(p.refunded_amount)}</span>
                          </>
                        ) : (
                          <>
                            <span className="rounded-full bg-critical-soft px-2 py-0.5 text-[11px] font-semibold text-critical">실패</span>
                            {p.fail_reason && <span className="mt-0.5 block max-w-[160px] text-[11px] text-ink-3">{p.fail_reason}</span>}
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {p.receipt_url
                          ? <a href={p.receipt_url} target="_blank" rel="noopener noreferrer"
                              className="text-[12px] font-semibold text-accent hover:underline">영수증</a>
                          : <span className="text-[12px] text-ink-3">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="mt-2 text-[11.5px] text-ink-3">
          기간을 비우면 누적 전체입니다. 환불은 결제액에서 빼지 않고 따로 셉니다 — 섞으면 얼마 들어왔는지와 얼마 돌려줬는지를 둘 다 잃습니다.
        </p>
      </div>
    </div>
  );
}
