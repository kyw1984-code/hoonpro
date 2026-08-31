import React, { useEffect, useState } from 'react';
import { CreditCard, Ticket, Plus, RefreshCw, Power, Loader2 } from 'lucide-react';
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
      const [subData, couponData, cfg] = await Promise.all([
        callBilling('admin-subscriptions'),
        callBilling('admin-coupons'),
        callBilling('admin-config'),
      ]);
      setSubs(subData.subscriptions ?? []);
      setByStatus(subData.byStatus ?? {});
      setCoupons(couponData.coupons ?? []);
      setEnforced(Boolean(cfg.billingEnforced));
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

  return (
    <div className="space-y-8">
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
                    {['회원', '상태', '카드', '다음 결제일', '이용 기간', '쿠폰', '실패', '시작일'].map(h => (
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
