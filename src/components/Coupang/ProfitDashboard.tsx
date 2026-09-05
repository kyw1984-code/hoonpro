/**
 * [1] 상품별 순이익 대시보드
 *
 * 이 화면이 답하는 질문은 하나다 — "이 상품, 팔면 남나?"
 * 매출은 쿠팡이 보여주지만 순이익은 아무도 안 보여준다. 정산예정액에서
 * 원가와 반품 배송비를 빼야 비로소 남는 돈이 나온다.
 *
 * 광고비는 상품 단위로 알 수 없어(윙 API에 광고 데이터가 없다) 기간 총액으로만
 * 반영한다. 저장된 광고 보고서가 있으면 그 값을 기본값으로 채워 준다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Loader2, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { coupangApi, pct, won, type ProfitResponse } from '../../lib/coupang';

const PERIODS = [
  { days: 7, label: '최근 7일' },
  { days: 30, label: '최근 30일' },
  { days: 90, label: '최근 90일' },
];

interface Props {
  onEditCosts: () => void;
}

export function ProfitDashboard({ onEditCosts }: Props) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ProfitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adCost, setAdCost] = useState<number>(0);
  // 사용자가 광고비를 손댔는지는 조회 조건이 아니다. 상태로 두면 처음 수정하는
  // 순간 load의 정체성이 바뀌어 쓸데없는 재조회가 한 번 더 나간다.
  const adTouched = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await coupangApi.profit(days);
      setData(d);
      if (!adTouched.current) setAdCost(Math.round(d.adCostHint ?? 0));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  // 광고비는 상품별로 나눌 수 없으므로 포트폴리오 합계에만 반영한다
  const netProfit = useMemo(() => (data ? data.totals.profit - adCost : 0), [data, adCost]);
  const netMargin = useMemo(
    () => (data && data.totals.salesAmount > 0 ? (netProfit / data.totals.salesAmount) * 100 : 0),
    [data, netProfit],
  );

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-14 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[13px]">순이익을 계산하는 중...</span>
      </div>
    );
  }

  if (error) {
    return <div className="rounded-panel border border-critical/35 bg-critical-soft p-5 text-[13px] text-ink-2">{error}</div>;
  }
  if (!data) return null;

  const noSales = data.rows.length === 0;

  return (
    <div className="flex flex-col gap-5">
      {/* 기간 선택 */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map(p => (
          <button
            key={p.days}
            onClick={() => setDays(p.days)}
            className={`rounded-control border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              days === p.days ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-3 hover:border-line-strong hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto text-[11.5px] text-ink-3">
          {data.from} ~ {data.to}
        </span>
      </div>

      {/* 원가 미입력 경고 — 이게 없으면 순이익이 부풀려 보인다 */}
      {data.missingCost > 0 && (
        <div className="flex items-start gap-2 rounded-panel border border-line bg-paper px-5 py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
          <div className="text-[12.5px] leading-relaxed text-ink-2">
            <p>
              팔린 상품 중 <b className="text-ink">{data.missingCost}개</b>의 원가가 비어 있습니다.
              원가가 없으면 그 상품의 순이익이 실제보다 크게 나옵니다.
            </p>
            <button onClick={onEditCosts} className="mt-1.5 inline-flex items-center gap-1 font-semibold text-accent hover:underline">
              원가 입력하러 가기 <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {noSales ? (
        <div className="flex flex-col items-center justify-center rounded-panel border border-line bg-paper py-16 text-ink-3">
          <Wallet className="mb-4 h-12 w-12 opacity-20" />
          <p className="text-sm font-semibold">이 기간의 매출 데이터가 없습니다</p>
          <p className="mt-1.5 text-center text-[12px] leading-relaxed">
            쿠팡 매출내역은 구매확정 또는 배송완료 3일 뒤에 잡힙니다.
            <br />
            최근 주문은 아직 반영되지 않았을 수 있습니다.
          </p>
        </div>
      ) : (
        <>
          {/* 핵심 지표 */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="매출" value={won(data.totals.salesAmount)} sub={`${data.totals.quantity.toLocaleString('ko-KR')}개 판매`} />
            <Stat label="쿠팡 수수료" value={`− ${won(data.totals.commission)}`} sub={pct((data.totals.commission / Math.max(1, data.totals.salesAmount)) * 100)} />
            <Stat label="원가 + 배송" value={`− ${won(data.totals.unitCostTotal + data.totals.returnCost)}`} sub={`반품 ${data.totals.returnCount}건 포함`} />
            <Stat
              label="순이익"
              value={won(netProfit)}
              sub={pct(netMargin)}
              tone={netProfit >= 0 ? 'positive' : 'critical'}
            />
          </div>

          {/* 광고비 입력 */}
          <div className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-paper px-5 py-4">
            <label className="text-[12.5px] font-medium text-ink-2" htmlFor="adcost">
              이 기간 광고비
            </label>
            <input
              id="adcost"
              type="number"
              min={0}
              value={adCost}
              onChange={e => {
                adTouched.current = true;
                setAdCost(Math.max(0, Number(e.target.value) || 0));
              }}
              className="w-40 rounded-control border border-line bg-paper px-3 py-2 text-right text-[13px] tabular-nums outline-none focus:ring-2 focus:ring-accent"
            />
            <span className="text-[12px] text-ink-3">원</span>
            <p className="w-full text-[11.5px] leading-relaxed text-ink-3 sm:w-auto sm:flex-1">
              쿠팡 광고 데이터는 윙 API로 받을 수 없어 직접 입력합니다.
              {data.adCostHint !== null && ' [광고 성과 분석]에 저장된 보고서 값을 기본값으로 채웠습니다.'}
            </p>
          </div>

          {/* 상품별 표 */}
          <div className="rounded-panel border border-line bg-paper">
            <div className="flex items-center gap-2 border-b border-line px-5 py-4">
              <h3 className="text-sm font-semibold text-ink">상품별 순이익</h3>
              <span className="text-[11.5px] text-ink-3">순이익 높은 순</span>
              <button onClick={onEditCosts} className="ml-auto text-[12px] font-medium text-accent hover:underline">
                원가 편집
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-[11.5px] text-ink-3">
                    <th className="px-4 py-2.5 text-left font-medium">상품</th>
                    <th className="px-3 py-2.5 text-right font-medium">판매</th>
                    <th className="px-3 py-2.5 text-right font-medium">매출</th>
                    <th className="px-3 py-2.5 text-right font-medium">수수료</th>
                    <th className="px-3 py-2.5 text-right font-medium">원가</th>
                    <th className="px-3 py-2.5 text-right font-medium">반품</th>
                    <th className="px-3 py-2.5 text-right font-medium">순이익</th>
                    <th className="px-4 py-2.5 text-right font-medium">이익률</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(r => (
                    <tr key={r.vendorItemId} className="border-b border-line/60 last:border-0">
                      <td className="max-w-[300px] px-4 py-2.5">
                        <p className="truncate text-ink">{r.productName}</p>
                        {r.optionName && <p className="truncate text-[11px] text-ink-3">{r.optionName}</p>}
                        {!r.costEntered && r.quantity > 0 && (
                          <span className="mt-0.5 inline-flex items-center gap-1 rounded-control border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            원가 미입력
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{r.quantity.toLocaleString('ko-KR')}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{won(r.salesAmount)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-3">{won(r.commission)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-3">{r.costEntered ? won(r.unitCostTotal) : '-'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-3">{r.returnCount > 0 ? `${r.returnCount}건` : '-'}</td>
                      <td
                        className={`px-3 py-2.5 text-right font-semibold tabular-nums ${
                          !r.costEntered ? 'text-ink-3' : r.profit >= 0 ? 'text-positive' : 'text-critical'
                        }`}
                      >
                        {won(r.profit)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-2">
                        <span className="inline-flex items-center gap-1">
                          {r.costEntered && (r.marginRate >= 0 ? (
                            <TrendingUp className="h-3 w-3 text-positive" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-critical" />
                          ))}
                          {pct(r.marginRate)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'positive' | 'critical';
}) {
  const toneClass = tone === 'positive' ? 'text-positive' : tone === 'critical' ? 'text-critical' : 'text-ink';
  return (
    <div className="rounded-panel border border-line bg-paper px-4 py-4">
      <p className="text-[11.5px] text-ink-3">{label}</p>
      <p className={`mt-1 text-[19px] font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11.5px] tabular-nums text-ink-3">{sub}</p>}
    </div>
  );
}
