/**
 * 관리자 · 쿠팡 연동 현황
 *
 * 몇 명이 연결했고 누구 수집이 멈춰 있는지를 문의가 오기 전에 본다.
 * 문제 있는 계정이 위로 온다.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Link2, Loader2, RefreshCw, Plus, Trash2, Save, Server } from 'lucide-react';
import { getToken } from '../../lib/auth';
import { coupangApi, type CoupangVendor } from '../../lib/coupang';

interface AccountRow {
  userId: string;
  name: string;
  email: string;
  vendorId: string;
  status: 'active' | 'invalid' | 'expired';
  lastSyncAt: string | null;
  lastSyncError: string | null;
  backfillDone: boolean;
  daysToExpiry: number | null;
  stale: boolean;
  connectedAt: string;
}

interface Overview {
  counts: { total: number; active: number; invalid: number; expired: number; stale: number; backfilling: number; expiringSoon: number };
  accounts: AccountRow[];
  relayConfigured: boolean;
  relayIp: string | null;
}

const STATUS_LABEL: Record<AccountRow['status'], string> = { active: '정상', invalid: '키 거부', expired: '만료' };

function since(iso: string | null): string {
  if (!iso) return '없음';
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600_000);
  if (h < 1) return '1시간 이내';
  if (h < 48) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

export function CoupangAdmin() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/coupang?action=admin-overview', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '불러오지 못했습니다.');
      setData(json);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (error) return <div className="rounded-panel border border-critical/35 bg-critical-soft p-5 text-[13px] text-ink-2">{error}</div>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 py-10 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[13px]">불러오는 중...</span>
      </div>
    );
  }

  const c = data.counts;
  const problems = c.invalid + c.expired + c.stale;

  return (
    <div className="flex flex-col gap-5">
      {!data.relayConfigured && (
        <div className="flex items-start gap-2 rounded-panel border border-critical/35 bg-critical-soft px-5 py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" />
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            중계 서버가 설정돼 있지 않습니다. 쿠팡은 등록된 IP에서만 호출을 받으므로 지금은 모든 수집이 실패합니다.
            docs/coupang-wing-setup.md를 따라 중계 서버를 띄우고 환경변수를 넣어주세요.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="연동 계정" value={`${c.total}명`} sub={`정상 ${c.active}명`} />
        <Stat label="문제 있는 계정" value={`${problems}명`} sub={`키 거부 ${c.invalid} · 만료 ${c.expired} · 수집 지연 ${c.stale}`} tone={problems > 0 ? 'critical' : undefined} />
        <Stat label="첫 수집 진행 중" value={`${c.backfilling}명`} sub="상품이 많으면 몇 회차에 나눠 끝납니다" />
        <Stat label="키 만료 임박" value={`${c.expiringSoon}명`} sub="14일 이내 · 자동 안내 발송됨" />
      </div>

      <div className="rounded-panel border border-line bg-paper">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <Link2 className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-ink">계정별 상태</h3>
          {data.relayIp && <span className="font-mono text-[11px] text-ink-3">중계 IP {data.relayIp}</span>}
          <button
            onClick={load}
            disabled={loading}
            className="ml-auto flex items-center gap-1 rounded-control border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] text-ink-3">
                <th className="px-4 py-2.5 text-left font-medium">회원</th>
                <th className="px-3 py-2.5 text-left font-medium">업체코드</th>
                <th className="px-3 py-2.5 text-left font-medium">상태</th>
                <th className="px-3 py-2.5 text-left font-medium">마지막 수집</th>
                <th className="px-3 py-2.5 text-right font-medium">키 만료</th>
                <th className="px-4 py-2.5 text-left font-medium">최근 오류</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map(a => {
                const bad = a.status !== 'active' || a.stale;
                return (
                  <tr key={a.userId} className={`border-b border-line/60 last:border-0 ${bad ? 'bg-critical-soft' : ''}`}>
                    <td className="px-4 py-2.5">
                      <p className="text-ink">{a.name || '(이름 없음)'}</p>
                      <p className="text-[11px] text-ink-3">{a.email}</p>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11.5px] text-ink-2">{a.vendorId}</td>
                    <td className="px-3 py-2.5">
                      <span className={`font-semibold ${a.status === 'active' ? 'text-positive' : 'text-critical'}`}>{STATUS_LABEL[a.status]}</span>
                      {a.stale && a.status === 'active' && <span className="ml-1.5 text-[11px] text-critical">수집 지연</span>}
                      {!a.backfillDone && a.status === 'active' && <span className="ml-1.5 text-[11px] text-ink-3">첫 수집 중</span>}
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">{since(a.lastSyncAt)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                      {a.daysToExpiry === null ? '-' : a.daysToExpiry <= 0 ? '만료' : `${a.daysToExpiry}일`}
                    </td>
                    <td className="max-w-[320px] truncate px-4 py-2.5 text-[11.5px] text-ink-3" title={a.lastSyncError ?? ''}>
                      {a.lastSyncError ?? '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.accounts.length === 0 && <p className="px-5 py-10 text-center text-[13px] text-ink-3">아직 연동한 회원이 없습니다.</p>}
        </div>
      </div>

      <VendorIpManager />
    </div>
  );
}

/**
 * 주문수집 업체 IP 관리
 *
 * 자체개발 모드에서는 IP를 여러 개 등록할 수 있어, 기존 프로그램의 IP를 훈프로
 * IP와 함께 넣으면 둘 다 돈다. 판매자가 그 업체에 일일이 전화하지 않도록
 * 여기서 목록을 관리하면 온보딩 화면에 바로 뜬다.
 */
function VendorIpManager() {
  const [vendors, setVendors] = useState<CoupangVendor[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    coupangApi.adminVendors()
      .then(r => setVendors(r.vendors))
      .catch(() => setVendors([]));
  }, []);

  const save = async () => {
    if (!vendors || saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await coupangApi.adminVendorsSave(vendors);
      setVendors(r.vendors);
      setMsg('저장했습니다. 온보딩 화면에 바로 반영됩니다.');
    } catch (e: any) {
      setMsg(e.message || '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const patch = (i: number, next: Partial<CoupangVendor>) =>
    setVendors(v => (v ? v.map((x, j) => (j === i ? { ...x, ...next } : x)) : v));

  if (!vendors) {
    return (
      <div className="flex items-center gap-2 py-8 text-ink-3">
        <Loader2 className="h-4 w-4 animate-spin" /><span className="text-[13px]">업체 목록 불러오는 중...</span>
      </div>
    );
  }

  return (
    <div className="rounded-panel border border-line bg-paper p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Server className="h-4 w-4 text-accent" />
        <h3 className="text-[15px] font-semibold text-ink">주문수집 업체 IP</h3>
      </div>
      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-2">
        판매자가 이미 쓰는 프로그램(토글·사방넷 등)의 IP를 훈프로 IP와 <b className="text-ink">함께</b> 윙에 등록하면
        양쪽 다 동작합니다. 여기에 업체를 넣어두면 온보딩 화면에서 판매자가 그 업체를 고르는 순간
        IP 목록이 바로 떠서, <b className="text-ink">업체에 문의할 필요가 없어집니다.</b>
        새 업체 IP를 확보하시면 여기 추가해주세요. (배포 없이 즉시 반영)
      </p>

      <div className="flex flex-col gap-3">
        {vendors.map((v, i) => (
          <div key={i} className="rounded-card border border-line bg-paper-2 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={v.name}
                onChange={e => patch(i, { name: e.target.value })}
                placeholder="업체명 (예: 사방넷)"
                className="min-w-0 flex-1 rounded-control border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => setVendors(vs => (vs ? vs.filter((_, j) => j !== i) : vs))}
                aria-label="업체 삭제"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-line text-ink-3 hover:text-critical"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={v.ips.join('\n')}
              onChange={e => patch(i, { ips: e.target.value.split(/[\s,]+/).map(x => x.trim()).filter(Boolean) })}
              rows={Math.max(2, v.ips.length)}
              placeholder={'IP를 한 줄에 하나씩\n61.251.171.79\n61.251.171.82'}
              className="mt-2 w-full rounded-control border border-line bg-paper px-3 py-2 font-mono text-[12.5px] text-ink outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="mt-1 text-[11.5px] text-ink-3">IP {v.ips.length}개 · 훈프로 IP 1개를 더하면 판매자가 윙에 {v.ips.length + 1}개를 등록합니다 (한도 10개)</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setVendors(vs => [...(vs ?? []), { id: `v${Date.now()}`, name: '', ips: [] }])}
          className="flex min-h-[40px] items-center gap-1.5 rounded-control border border-line px-3.5 text-[13px] text-ink-2 hover:text-ink"
        >
          <Plus className="h-4 w-4" /> 업체 추가
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex min-h-[40px] items-center gap-2 rounded-control bg-accent px-4 text-[13px] font-bold text-ground hover:opacity-90 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} 저장
        </button>
        {msg && <span className="text-[12.5px] text-ink-2">{msg}</span>}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'critical' }) {
  return (
    <div className="rounded-panel border border-line bg-paper px-4 py-4">
      <p className="text-[11.5px] text-ink-3">{label}</p>
      <p className={`mt-1 text-[19px] font-semibold tabular-nums ${tone === 'critical' ? 'text-critical' : 'text-ink'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-tight text-ink-3">{sub}</p>}
    </div>
  );
}
