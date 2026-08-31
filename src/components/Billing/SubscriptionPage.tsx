import React, { useEffect, useState } from 'react';
import { CreditCard, BadgeCheck, AlertTriangle, Ticket, Loader2, CalendarClock, Receipt } from 'lucide-react';
import {
  fetchBillingStatus, validateCoupon, subscribeWithCard, cancelSubscription, resumeSubscription,
  changeCard, requestRefund, startCardRegistration, consumeBillingReturn, tossConfigured,
  type BillingStatus, type CouponPreview,
} from '../../lib/billing';

// 구독 시작 + 마이페이지(구독 관리) 통합 화면

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  trial: { text: '무료 이용 중', cls: 'bg-positive-soft text-positive' },
  active: { text: '구독 중', cls: 'bg-positive-soft text-positive' },
  past_due: { text: '결제 재시도 중', cls: 'bg-caution-soft text-caution' },
  paused: { text: '정지됨 (결제 실패)', cls: 'bg-critical-soft text-critical' },
  canceled: { text: '해지됨', cls: 'bg-paper-2 text-ink-3' },
};

const PAYMENT_LABEL: Record<string, string> = {
  paid: '결제 완료',
  failed: '실패',
  canceled: '취소',
  partial_refund: '부분 환불',
  refunded: '환불 완료',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return iso.slice(0, 10);
}

export function SubscriptionPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false); // 토스에서 돌아와 구독 활성화 중
  const [message, setMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  const [couponCode, setCouponCode] = useState('');
  const [couponPreview, setCouponPreview] = useState<CouponPreview | null>(null);
  // 연간 결제를 기본 선택으로 유도
  const [selectedPlanId, setSelectedPlanId] = useState('yearly');

  const reload = async () => {
    try {
      const s = await fetchBillingStatus();
      setStatus(s);
      // App의 기능 잠금 게이트가 최신 구독 상태를 반영하도록 알림
      window.dispatchEvent(new CustomEvent('billing-updated', { detail: s }));
    } catch (e: any) {
      setMessage({ text: e?.message ?? '구독 정보를 불러오지 못했습니다.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // 토스 카드 등록에서 돌아온 경우 → 구독 활성화/카드 변경 마무리
  useEffect(() => {
    const ret = consumeBillingReturn();
    if (!ret) { reload(); return; }

    if (ret.result === 'fail') {
      setMessage({ text: ret.errorMessage || '카드 등록이 취소됐습니다.', type: 'error' });
      reload();
      return;
    }
    if (!ret.authKey || !ret.customerKey) {
      setMessage({ text: '카드 등록 정보가 올바르지 않습니다. 다시 시도해주세요.', type: 'error' });
      reload();
      return;
    }

    setProcessing(true);
    const finish = ret.mode === 'change-card'
      ? changeCard(ret.authKey, ret.customerKey).then(r => {
          setMessage({ text: r.reactivated ? '카드가 변경되고 구독이 복구됐습니다.' : '카드가 변경됐습니다.', type: 'success' });
        })
      : subscribeWithCard(ret.authKey, ret.customerKey, ret.planId ?? 'yearly', ret.couponCode ?? undefined).then(r => {
          setMessage({
            text: r.status === 'trial' ? '무료 이용이 시작됐습니다!' : '구독이 시작됐습니다!',
            type: 'success',
          });
        });

    finish
      .catch((e: any) => setMessage({ text: e?.message ?? '처리에 실패했습니다.', type: 'error' }))
      .finally(() => { setProcessing(false); reload(); });
  }, []);

  const handleCouponCheck = async () => {
    const code = couponCode.trim();
    if (!code) { setCouponPreview(null); return; }
    setBusy(true);
    setMessage(null);
    try {
      setCouponPreview(await validateCoupon(code, selectedPlanId));
    } catch (e: any) {
      setCouponPreview(null);
      setMessage({ text: e?.message ?? '쿠폰 확인에 실패했습니다.', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleStart = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await startCardRegistration('subscribe', selectedPlanId, couponPreview ? couponCode.trim() : undefined);
      // 성공 시 토스 페이지로 이동하므로 이후 코드는 실행되지 않음
    } catch (e: any) {
      setMessage({ text: e?.message ?? '카드 등록을 시작하지 못했습니다.', type: 'error' });
      setBusy(false);
    }
  };

  const handleChangeCard = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await startCardRegistration('change-card');
    } catch (e: any) {
      setMessage({ text: e?.message ?? '카드 변경을 시작하지 못했습니다.', type: 'error' });
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<any>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ text: done, type: 'success' });
      await reload();
    } catch (e: any) {
      setMessage({ text: e?.message ?? '처리에 실패했습니다.', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (loading || processing) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-ink-3">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-[13px]">{processing ? '카드 등록을 확인하고 구독을 활성화하는 중...' : '구독 정보를 불러오는 중...'}</p>
      </div>
    );
  }

  const plan = status?.plan; // 현재 구독 중인 플랜 (마이페이지용)
  const sub = status?.subscription;
  const hasActiveSub = sub && sub.status !== 'canceled';

  // 플랜 목록 — 연간 우선. DB 마이그레이션 전에는 기본값으로 표시
  const plans = status?.plans?.length ? status.plans : [
    { id: 'yearly', name: '훈프로 연간', price: 357600, interval: 'year' as const },
    { id: 'standard', name: '훈프로 월간', price: 39800, interval: 'month' as const },
  ];
  const yearlyPlan = plans.find(p => p.interval === 'year');
  const monthlyPlan = plans.find(p => p.interval === 'month');
  const selectedPlan = plans.find(p => p.id === selectedPlanId) ?? yearlyPlan ?? plans[0];
  // 연간이 월간 대비 몇 % 저렴한지 (월 환산 기준)
  const discountPct = yearlyPlan && monthlyPlan
    ? Math.round((1 - yearlyPlan.price / 12 / monthlyPlan.price) * 100)
    : 0;

  const selectPlan = (id: string) => {
    setSelectedPlanId(id);
    setCouponPreview(null); // 쿠폰 금액은 플랜 기준으로 다시 검증
  };

  return (
    <div className="mx-auto w-full max-w-[720px] px-6">
      {message && (
        <p className={`mb-4 rounded-control px-4 py-3 text-[13px] ${
          message.type === 'error' ? 'bg-critical-soft text-critical' : 'bg-positive-soft text-positive'
        }`}>
          {message.text}
        </p>
      )}

      {!hasActiveSub ? (
        /* ── 구독 시작 ── */
        <div className="rounded-panel border border-line bg-paper p-7">
          <div className="mb-1 flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-ink" />
            <h2 className="text-[17px] font-semibold text-ink">훈프로 구독 시작</h2>
          </div>
          <p className="mb-6 text-[13px] text-ink-3">
            {sub?.status === 'canceled' ? '다시 구독하면 기존 데이터(관심 키워드·순위 추적 이력)를 그대로 이어서 사용합니다.' : '모든 AI 자동화 기능을 제한 없이 사용할 수 있습니다.'}
          </p>

          {/* 결제 주기 선택 — 연간이 먼저, 기본 선택 */}
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-card border border-line bg-paper-2 p-1">
            {yearlyPlan && (
              <button
                onClick={() => selectPlan(yearlyPlan.id)}
                className={`relative rounded-control py-2 text-[13px] font-semibold transition-colors ${
                  selectedPlanId === yearlyPlan.id ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
                }`}
              >
                연간 결제
                {discountPct > 0 && (
                  <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    selectedPlanId === yearlyPlan.id ? 'bg-paper text-ink' : 'bg-positive-soft text-positive'
                  }`}>
                    {discountPct}% 할인
                  </span>
                )}
              </button>
            )}
            {monthlyPlan && (
              <button
                onClick={() => selectPlan(monthlyPlan.id)}
                className={`rounded-control py-2 text-[13px] font-semibold transition-colors ${
                  selectedPlanId === monthlyPlan.id ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
                }`}
              >
                월간 결제
              </button>
            )}
          </div>

          <div className="mb-5 rounded-card border border-line bg-paper-2 p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] font-semibold text-ink">{selectedPlan.name}</span>
              <span className="text-right">
                <span className="text-[22px] font-bold tracking-tight text-ink">
                  {(selectedPlan.interval === 'year' ? Math.round(selectedPlan.price / 12) : selectedPlan.price).toLocaleString()}
                  <span className="ml-0.5 text-[13px] font-medium text-ink-3">원/월</span>
                </span>
                {selectedPlan.interval === 'year' && (
                  <span className="block text-[12px] text-ink-3">연 {selectedPlan.price.toLocaleString()}원 일시 결제</span>
                )}
              </span>
            </div>
            {selectedPlan.interval === 'year' && monthlyPlan && discountPct > 0 && (
              <p className="mt-2 text-[12.5px] font-medium text-positive">
                월간 결제({monthlyPlan.price.toLocaleString()}원/월) 대비 {discountPct}% 저렴합니다.
              </p>
            )}
            <ul className="mt-3 space-y-1 text-[12.5px] text-ink-2">
              <li>· 썸네일 · 상세페이지 · 상품명 AI 제작</li>
              <li>· 소싱AI · 순위 추적 · 리뷰 분석 · 광고 성과 분석</li>
              <li>· {selectedPlan.interval === 'year' ? '매년' : '매월'} 자동결제, 언제든 해지 가능 (남은 기간까지 이용)</li>
            </ul>
          </div>

          {/* 쿠폰 */}
          <div className="mb-5">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Ticket className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <input
                  type="text"
                  value={couponCode}
                  onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponPreview(null); }}
                  onKeyDown={e => e.key === 'Enter' && handleCouponCheck()}
                  placeholder="쿠폰 코드 (선택)"
                  className="w-full rounded-control border border-line bg-paper-2 py-2.5 pl-9 pr-3 text-[13px] uppercase outline-none transition-colors placeholder:normal-case placeholder:text-ink-3 focus:border-accent focus:bg-paper"
                />
              </div>
              <button
                onClick={handleCouponCheck}
                disabled={busy || !couponCode.trim()}
                className="shrink-0 rounded-control border border-line px-4 py-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-paper-2 disabled:opacity-40"
              >
                적용
              </button>
            </div>
            {couponPreview && (
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-positive">
                <BadgeCheck className="h-4 w-4" /> {couponPreview.description}
              </p>
            )}
          </div>

          <button
            onClick={handleStart}
            disabled={busy || !tossConfigured()}
            className="w-full rounded-control bg-ink py-3 text-[14px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {couponPreview?.type === 'free_period'
              ? `카드 등록하고 ${couponPreview.value}일 무료로 시작하기`
              : `카드 등록하고 시작하기 — ${(couponPreview?.firstAmount ?? selectedPlan.price).toLocaleString()}원${selectedPlan.interval === 'year' ? ' (연 1회)' : '/월'}`}
          </button>
          {!tossConfigured() && (
            <p className="mt-2 text-center text-[12px] text-caution">결제 설정이 아직 완료되지 않았습니다. 관리자에게 문의하세요.</p>
          )}
          <p className="mt-3 text-center text-[11.5px] leading-relaxed text-ink-3">
            카드 정보는 토스페이먼츠에 안전하게 보관되며 서버에 저장되지 않습니다.<br />
            결제 후 7일 이내 미사용 시 전액 환불, 이후에는 잔여 기간만큼 일할 환불됩니다.
          </p>
        </div>
      ) : (
        /* ── 마이페이지: 구독 관리 ── */
        <div className="space-y-5">
          <div className="rounded-panel border border-line bg-paper p-7">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-ink">내 구독</h2>
              <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${STATUS_LABEL[sub!.status]?.cls ?? ''}`}>
                {STATUS_LABEL[sub!.status]?.text ?? sub!.status}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
              <div className="rounded-card border border-line bg-paper-2 p-4">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">플랜</p>
                <p className="font-medium text-ink">
                  {plan?.name ?? '-'} · {(plan?.price ?? 0).toLocaleString()}원/{plan?.interval === 'year' ? '연' : '월'}
                </p>
              </div>
              <div className="rounded-card border border-line bg-paper-2 p-4">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">등록 카드</p>
                <p className="font-medium text-ink">{sub!.cardSummary ?? '-'}</p>
              </div>
              <div className="rounded-card border border-line bg-paper-2 p-4">
                <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  <CalendarClock className="h-3.5 w-3.5" />{sub!.cancelAtPeriodEnd ? '이용 종료일' : '다음 결제일'}
                </p>
                <p className="font-medium text-ink">
                  {sub!.cancelAtPeriodEnd ? fmtDate(sub!.currentPeriodEnd) : fmtDate(sub!.nextBillingAt)}
                </p>
              </div>
              <div className="rounded-card border border-line bg-paper-2 p-4">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">이용 기간</p>
                <p className="font-medium text-ink">{fmtDate(sub!.currentPeriodEnd)} 까지</p>
              </div>
            </div>

            {sub!.status === 'past_due' && (
              <p className="mt-4 flex items-start gap-2 rounded-control bg-caution-soft px-4 py-3 text-[12.5px] text-caution">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                결제가 실패해 재시도 중입니다 ({sub!.failCount}회). 카드 한도·유효기간을 확인하시거나 카드를 변경해주세요.
              </p>
            )}
            {sub!.status === 'paused' && (
              <p className="mt-4 flex items-start gap-2 rounded-control bg-critical-soft px-4 py-3 text-[12.5px] text-critical">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                결제가 3회 실패해 구독이 정지됐습니다. 데이터는 보존됩니다 — 카드를 다시 등록하면 즉시 복구됩니다.
              </p>
            )}
            {sub!.cancelAtPeriodEnd && sub!.status !== 'paused' && (
              <p className="mt-4 rounded-control bg-paper-2 px-4 py-3 text-[12.5px] text-ink-2">
                해지가 예약됐습니다. {fmtDate(sub!.currentPeriodEnd)}까지 이용할 수 있고 이후 자동결제되지 않습니다.
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                onClick={handleChangeCard}
                disabled={busy}
                className="rounded-control border border-line px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-paper-2 disabled:opacity-40"
              >
                {sub!.status === 'paused' ? '카드 다시 등록하고 복구' : '카드 변경'}
              </button>
              {sub!.cancelAtPeriodEnd ? (
                <button
                  onClick={() => act(resumeSubscription, '해지 예약이 취소됐습니다. 구독이 계속됩니다.')}
                  disabled={busy}
                  className="rounded-control border border-line px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-paper-2 disabled:opacity-40"
                >
                  해지 취소
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (window.confirm('구독을 해지할까요? 남은 기간까지는 그대로 이용할 수 있습니다.')) {
                      act(cancelSubscription, '해지가 예약됐습니다. 남은 기간까지 이용할 수 있습니다.');
                    }
                  }}
                  disabled={busy}
                  className="rounded-control border border-line px-4 py-2 text-[13px] font-medium text-ink-3 transition-colors hover:bg-paper-2 hover:text-critical disabled:opacity-40"
                >
                  해지
                </button>
              )}
              <button
                onClick={() => {
                  if (window.confirm('환불과 함께 즉시 해지됩니다. 결제 후 7일 이내 미사용 시 전액, 그 외에는 잔여 기간 일할 환불됩니다. 진행할까요?')) {
                    act(requestRefund, '환불 처리가 완료됐습니다.');
                  }
                }}
                disabled={busy}
                className="rounded-control px-4 py-2 text-[13px] font-medium text-ink-3 transition-colors hover:bg-paper-2 hover:text-critical disabled:opacity-40"
              >
                환불 요청
              </button>
            </div>
          </div>

          {/* 결제 이력 */}
          <div className="rounded-panel border border-line bg-paper p-7">
            <div className="mb-4 flex items-center gap-2">
              <Receipt className="h-4 w-4 text-ink" />
              <h3 className="text-[15px] font-semibold text-ink">결제 이력</h3>
            </div>
            {status!.payments.length === 0 ? (
              <p className="text-[13px] text-ink-3">아직 결제 이력이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                      <th className="py-2 pr-4 font-semibold">일시</th>
                      <th className="py-2 pr-4 font-semibold">내용</th>
                      <th className="py-2 pr-4 text-right font-semibold">금액</th>
                      <th className="py-2 pr-4 font-semibold">상태</th>
                      <th className="py-2 font-semibold">영수증</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status!.payments.map((p, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="whitespace-nowrap py-2.5 pr-4 text-ink-2">{fmtDate(p.approved_at ?? p.created_at)}</td>
                        <td className="py-2.5 pr-4 text-ink">{p.order_name}{p.discount > 0 && <span className="ml-1 text-positive">(-{p.discount.toLocaleString()}원)</span>}</td>
                        <td className="whitespace-nowrap py-2.5 pr-4 text-right font-medium tabular-nums text-ink">{p.amount.toLocaleString()}원</td>
                        <td className="whitespace-nowrap py-2.5 pr-4">
                          <span className={p.status === 'paid' ? 'text-positive' : p.status === 'failed' ? 'text-critical' : 'text-ink-2'}>
                            {PAYMENT_LABEL[p.status] ?? p.status}
                          </span>
                          {p.fail_reason && <span className="ml-1 text-[11px] text-ink-3">({p.fail_reason})</span>}
                        </td>
                        <td className="py-2.5">
                          {p.receipt_url && (
                            <a href={p.receipt_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">보기</a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
