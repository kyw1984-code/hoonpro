/**
 * 쿠팡 연동 대시보드 — 하위 화면들의 껍데기.
 * 키가 없으면 등록 화면만 보여주고, 연결된 뒤에 분석 화면들을 연다.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Link2, Loader2, RefreshCw, ShoppingBag, Trash2 } from 'lucide-react';
import { coupangApi, sinceText, type CoupangStatus, type SyncSummary } from '../../lib/coupang';
import { KeySetup } from './KeySetup';
import { ProfitDashboard } from './ProfitDashboard';
import { CostEditor } from './CostEditor';
import { SettlementCalendar } from './SettlementCalendar';
import { WeeklyReports } from './WeeklyReports';
import { InventoryForecast } from './InventoryForecast';
import { ReturnAnalysis } from './ReturnAnalysis';
import { InquiryAssistant } from './InquiryAssistant';
import { RankRevenue } from './RankRevenue';
import { PriceRules } from './PriceRules';

type View = 'profit' | 'settlement' | 'inventory' | 'returns' | 'inquiries' | 'rank' | 'price' | 'costs' | 'settings';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'profit', label: '순이익' },
  { id: 'settlement', label: '정산 캘린더' },
  { id: 'inventory', label: '재고 예측' },
  { id: 'returns', label: '반품 분석' },
  { id: 'inquiries', label: '고객문의' },
  { id: 'rank', label: '순위·매출' },
  { id: 'price', label: '가격 관리' },
  { id: 'costs', label: '원가 입력' },
  { id: 'settings', label: '연동 설정' },
];

export function CoupangDashboard() {
  const [status, setStatus] = useState<CoupangStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('profit');
  const [syncing, setSyncing] = useState(false);
  // 수집은 최대 1~2분 걸린다. 도는 동안 화면이 조용하면 멈춘 줄 알고 새로고침하거나
  // 버튼을 다시 누른다. 초를 세어 보여주면 "돌고 있다"가 눈으로 확인된다.
  const [syncElapsed, setSyncElapsed] = useState(0);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  // 수집이 끝나면 값을 올려 하위 화면을 다시 만든다. 상단 바만 "수집 완료"라
  // 하고 아래 표는 옛 숫자면 사용자는 어느 쪽을 믿어야 할지 모른다.
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await coupangApi.status());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => setSyncElapsed(v => v + 1), 1000);
    return () => clearInterval(t);
  }, [syncing]);

  const runSync = async (full = false) => {
    if (syncing) return;
    setSyncing(true);
    setSyncElapsed(0);
    setSyncMsg(null);
    try {
      const { summary } = await coupangApi.sync(full);
      setSyncMsg(describeSync(summary));
      await load();
      // 원가·가격 화면에서 입력하던 값이 있으면 다시 만들지 않는다. 수집은 최대
      // 90초 걸리고 키 등록 직후 자동으로도 도는데, 그 사이 작성하던 내용이
      // 예고 없이 사라지면 안 된다. 그 화면들은 저장 후 스스로 다시 읽는다.
      const editing = view === 'costs' || view === 'price';
      if (!editing) setRefreshKey(k => k + 1);
    } catch (e: any) {
      setSyncMsg(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('연동을 해제하면 저장된 키가 삭제되고 자동 수집이 멈춥니다. 이미 수집된 데이터는 남습니다. 해제할까요?')) return;
    await coupangApi.deleteKey().catch(() => {});
    await load();
  };

  if (loading && !status) {
    return (
      <div className="mx-auto flex max-w-[1000px] items-center gap-2 px-4 py-14 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[13px]">불러오는 중...</span>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="mx-auto max-w-[1000px] px-4">
        <div className="rounded-panel border border-critical/35 bg-critical-soft p-5 text-[13px] text-ink-2">{error}</div>
      </div>
    );
  }

  if (!status?.connected) {
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4">
        <header className="rounded-panel border border-line bg-paper p-6">
          <div className="mb-1 flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-accent" />
            <h2 className="text-base font-semibold text-ink">쿠팡 연동</h2>
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            윙 API를 연결하면 매출·수수료·정산·재고·반품·문의를 매일 자동으로 가져옵니다.
            원가만 한 번 입력하면 상품별 진짜 순이익이 나옵니다.
          </p>
        </header>
        <KeySetup
          status={status ?? { connected: false }}
          onSaved={async () => {
            await load();
            // 크론을 기다리면 최대 한 시간 동안 빈 화면이다. 바로 첫 수집을 건다.
            runSync(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-4">
      <ConnectionBar
        status={status}
        syncing={syncing}
        syncElapsed={syncElapsed}
        syncMsg={syncMsg}
        onSync={runSync}
        onDisconnect={disconnect}
      />

      {VIEWS.length > 1 && (
        <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="쿠팡 분석 화면">
          {VIEWS.map(v => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              aria-current={view === v.id ? 'page' : undefined}
              className={`relative -mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition-all ${
                view === v.id
                  ? 'border-accent font-semibold text-ink'
                  : 'border-transparent font-medium text-ink-3 hover:text-ink'
              }`}
            >
              {v.label}
            </button>
          ))}
        </nav>
      )}

      <div key={refreshKey} className="contents">
      {view === 'profit' && <ProfitDashboard onEditCosts={() => setView('costs')} />}
      {view === 'settlement' && <SettlementCalendar />}
      {view === 'inventory' && <InventoryForecast />}
      {view === 'returns' && <ReturnAnalysis onEditCosts={() => setView('costs')} />}
      {view === 'inquiries' && <InquiryAssistant />}
      {view === 'rank' && <RankRevenue />}
      {view === 'price' && <PriceRules onEditCosts={() => setView('costs')} />}
      {view === 'costs' && <CostEditor onSaved={() => undefined} />}
      </div>

      {view === 'settings' && (
        <div className="flex flex-col gap-5">
        <WeeklyReports />
        <div className="rounded-panel border border-line bg-paper p-6">
          <h3 className="mb-3 text-sm font-semibold text-ink">연동 정보</h3>
          <dl className="grid grid-cols-1 gap-2.5 text-[13px] sm:grid-cols-2">
            <Row label="업체코드" value={status.vendorId ?? '-'} mono />
            <Row label="Access Key" value={status.accessKeyMasked ?? '-'} mono />
            <Row label="수집된 상품(옵션)" value={`${(status.itemCount ?? 0).toLocaleString('ko-KR')}개`} />
            <Row label="매출 데이터" value={`${(status.salesDays ?? 0).toLocaleString('ko-KR')}일치`} />
            <Row label="키 만료일" value={status.keyExpiresAt ?? '미입력'} />
            <Row
              label="키 만료까지"
              value={status.daysToExpiry === null || status.daysToExpiry === undefined ? '발급일 미입력' : `${status.daysToExpiry}일`}
            />
          </dl>
          <button
            onClick={disconnect}
            className="mt-5 inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-2 text-[12px] font-medium text-ink-3 transition-colors hover:border-critical/50 hover:text-critical"
          >
            <Trash2 className="h-3.5 w-3.5" />
            연동 해제
          </button>
        </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-paper-2 px-3 py-2.5">
      <dt className="shrink-0 text-[12px] text-ink-3">{label}</dt>
      <dd className={`truncate text-right text-ink ${mono ? 'font-mono text-[12px]' : ''}`}>{value}</dd>
    </div>
  );
}

function ConnectionBar({
  status,
  syncing,
  syncElapsed,
  syncMsg,
  onSync,
  onDisconnect,
}: {
  status: CoupangStatus;
  syncing: boolean;
  syncElapsed: number;
  syncMsg: string | null;
  onSync: (full?: boolean) => void;
  onDisconnect: () => void;
}) {
  const broken = status.status === 'invalid' || status.status === 'expired';
  const expirySoon = typeof status.daysToExpiry === 'number' && status.daysToExpiry <= 14;

  return (
    <div className="flex flex-col gap-3">
      {/* 수집 중에는 막대 전체를 강조한다. 버튼 하나만 흐려지면 눌린 건지
          도는 건지 알 수 없어, 사람들이 새로고침하거나 다시 누른다. */}
      <div
        className={`flex flex-wrap items-center gap-3 rounded-panel border px-5 py-4 transition-colors ${
          syncing ? 'border-accent bg-accent-soft' : 'border-line bg-paper'
        }`}
      >
        {syncing ? (
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
        ) : (
          <Link2 className={`h-4 w-4 ${broken ? 'text-critical' : 'text-positive'}`} />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-ink">
            {syncing ? '쿠팡에서 데이터를 가져오는 중' : broken ? '연동에 문제가 있습니다' : '쿠팡 윙 연결됨'}
            <span className="ml-2 font-mono text-[11.5px] font-normal text-ink-3">{status.vendorId}</span>
          </p>
          {syncing ? (
            <p className="text-[11.5px] text-ink-2">
              상품 · 주문 · 매출 · 정산 · 반품 · 문의를 차례로 받고 있습니다 ·{' '}
              {/* 초를 세어 보여준다. 스피너는 멈춰도 도는 것처럼 보이지만 숫자는 못 속인다 */}
              <b className="tabular-nums text-accent">{syncElapsed}초</b> 경과 · 처음 수집은 1~2분 걸립니다
            </p>
          ) : (
            <p className="text-[11.5px] text-ink-3">마지막 수집 {sinceText(status.lastSyncAt)}</p>
          )}
        </div>
        <button
          onClick={() => onSync(false)}
          disabled={syncing}
          className={`flex items-center gap-1.5 rounded-control border px-3 py-2 text-[12px] font-semibold transition-colors ${
            syncing
              ? 'border-accent bg-accent text-paper'
              : 'border-line font-medium text-ink-2 hover:border-line-strong hover:text-ink'
          }`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? '수집 중...' : '지금 수집'}
        </button>
        <button
          onClick={() => onSync(true)}
          disabled={syncing}
          title="지난 60일치를 처음부터 다시 가져옵니다"
          className="rounded-control border border-line px-3 py-2 text-[12px] font-medium text-ink-3 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
        >
          전체 재수집
        </button>
      </div>

      {broken && (
        <div className="flex items-start gap-2 rounded-panel border border-critical/35 bg-critical-soft px-5 py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" />
          <div className="text-[12.5px] leading-relaxed text-ink-2">
            <p className="font-semibold text-ink">{status.status === 'expired' ? '키가 만료됐습니다' : '쿠팡이 키를 거부했습니다'}</p>
            <p className="mt-1">{status.lastSyncError ?? '윙에서 키를 확인한 뒤 다시 등록해주세요.'}</p>
            <button onClick={onDisconnect} className="mt-2 font-semibold text-accent hover:underline">
              키 다시 등록하기
            </button>
          </div>
        </div>
      )}

      {!broken && expirySoon && (
        <div className="rounded-panel border border-line bg-paper px-5 py-3 text-[12.5px] text-ink-2">
          쿠팡 API 키가 <b className="text-ink">{status.daysToExpiry}일 후</b> 만료됩니다. 윙에서 갱신한 뒤 같은 키를 다시 등록해주세요.
        </div>
      )}

      {status.lastSyncError && !broken && (
        <div className="rounded-panel border border-line bg-paper px-5 py-3 text-[12px] text-ink-3">
          일부 항목을 못 가져왔습니다: {status.lastSyncError}
        </div>
      )}

      {syncMsg && !syncing && (
        <div
          className={`rounded-panel border px-5 py-3 text-[12.5px] ${
            syncMsg.startsWith('수집 완료')
              ? 'border-positive/35 bg-positive-soft text-ink-2'
              : 'border-line bg-paper text-ink-2'
          }`}
        >
          {syncMsg}
        </div>
      )}
    </div>
  );
}

function describeSync(s: SyncSummary): string {
  const parts = [
    `상품 ${s.items}`,
    `주문 ${s.orders}`,
    `윙 매출 ${s.sales}`,
    // 그로스는 창구가 달라 따로 센다. 합쳐 놓으면 어느 쪽이 안 들어왔는지 모른다.
    `그로스 매출 ${s.growth ?? 0}`,
    `그로스 재고 ${s.growthInventory ?? 0}`,
    `쿠폰 설정 ${s.couponDefs ?? 0}`,
    `정산 ${s.settlements}`,
    `반품 ${s.returns}`,
    `문의 ${s.inquiries}`,
  ];
  // 취소를 뺐다는 걸 밝힌다. 윙 판매자센터 숫자와 맞춰 볼 때 이게 첫 번째 질문이다.
  const cancelNote = s.growthCancelled ? ` (그로스 취소 ${s.growthCancelled}건 제외)` : '';
  const base = s.truncated
    ? `수집 진행 중 — ${parts.join(' · ')}건까지 받았습니다${cancelNote}. 나머지는 자동으로 이어받습니다`
    : `수집 완료 — ${parts.join(' · ')}건${cancelNote}`;
  return s.errors?.length ? `${base} (일부 실패: ${s.errors.slice(0, 2).join(' / ')})` : base;
}
