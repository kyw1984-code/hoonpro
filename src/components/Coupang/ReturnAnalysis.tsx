/**
 * [5] 반품 손실 분석
 *
 * 쿠팡 화면은 반품을 건수로만 보여준다. 이 화면은 '얼마를 잃었는지'와
 * '왜 반품됐는지'에 답한다. 사유가 상품 설명으로 고칠 수 있는 것이면
 * 상세페이지를 고치는 게 가장 싼 해결책이다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, PackageOpen, RotateCcw } from 'lucide-react';
import { coupangApi, pct, won, type ReturnsResponse } from '../../lib/coupang';

const PERIODS = [
  { days: 30, label: '최근 30일' },
  { days: 90, label: '최근 90일' },
];

export function ReturnAnalysis({ onEditCosts }: { onEditCosts: () => void }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ReturnsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 기간 버튼 연타 시 늦게 온 옛 응답이 화면을 덮지 않게 순번으로 거른다
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const d = await coupangApi.returns(days);
      if (mine !== seq.current) return;
      setData(d);
      setError(null);
    } catch (e: any) {
      if (mine !== seq.current) return;
      setError(e.message);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return <div className="rounded-panel border border-critical/35 bg-critical-soft p-5 text-[13px] text-ink-2">{error}</div>;
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 py-14 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[13px]">반품을 분석하는 중...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
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

      {data.totals.count === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-panel border border-line bg-paper py-16 text-ink-3">
          <PackageOpen className="mb-4 h-12 w-12 opacity-20" />
          <p className="text-sm font-semibold">이 기간 반품이 없습니다</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="반품·교환 건수"
              value={`${data.totals.count.toLocaleString('ko-KR')}건`}
              sub={`교환 ${data.totals.exchangeCount}건 포함 · 취소된 접수 ${data.totals.cancelledCount}건 제외`}
            />
            <Stat label="반품률" value={pct(data.totals.returnRate)} sub={`판매 ${data.totals.soldQuantity.toLocaleString('ko-KR')}개 대비`} />
            <Stat label="배송비 손실" value={won(data.totals.shippingLoss)} tone="critical" />
            <Stat label="판매자 귀책" value={`${data.totals.sellerFaultCount}건`} sub="왕복 배송비를 판매자가 부담" />
          </div>

          {data.missingReturnCost > 0 && (
            <div className="rounded-panel border border-line bg-paper px-5 py-4 text-[12.5px] leading-relaxed text-ink-2">
              반품 배송비를 입력하지 않은 상품이 <b className="text-ink">{data.missingReturnCost}개</b> 있어 손실이 실제보다 적게 나옵니다.{' '}
              <button onClick={onEditCosts} className="font-semibold text-accent hover:underline">
                원가 입력에서 채우기
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-panel border border-line bg-paper">
              <h3 className="border-b border-line px-5 py-4 text-sm font-semibold text-ink">반품 사유</h3>
              <ul className="divide-y divide-line/60">
                {data.reasons.map(r => (
                  <li key={r.reason} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{r.reason}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-3">{r.count}건</span>
                    <span className="w-12 shrink-0 text-right text-[12px] font-semibold tabular-nums text-ink">{pct(r.share, 0)}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line px-5 py-3 text-[11.5px] leading-relaxed text-ink-3">
                사유가 크기·색상·설명 불일치라면 상세페이지를 고치는 게 가장 싼 해결책입니다.
              </p>
            </div>

            <div className="rounded-panel border border-line bg-paper">
              <h3 className="border-b border-line px-5 py-4 text-sm font-semibold text-ink">상품별 반품</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-[11.5px] text-ink-3">
                      <th className="px-4 py-2.5 text-left font-medium">상품</th>
                      <th className="px-3 py-2.5 text-right font-medium">건수</th>
                      <th className="px-3 py-2.5 text-right font-medium">반품률</th>
                      <th className="px-4 py-2.5 text-right font-medium">손실</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.slice(0, 20).map(r => (
                      <tr key={r.vendorItemId} className="border-b border-line/60 last:border-0">
                        <td className="max-w-[220px] px-4 py-2.5">
                          <p className="truncate text-ink">{r.productName}</p>
                          {r.topReason && <p className="truncate text-[11px] text-ink-3">{r.topReason}</p>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{r.count}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                          {r.soldQuantity > 0 ? pct(r.returnRate, 0) : '-'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                          {r.costEntered ? won(r.shippingLoss) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-panel border border-line bg-paper px-5 py-3">
            <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" />
            <p className="text-[11.5px] leading-relaxed text-ink-3">
              손실은 왕복 배송비만 계산한 값입니다. 재판매가 불가능한 반품은 원가까지 잃으므로 실제 손실은 이보다 큽니다.
            </p>
          </div>
        </>
      )}
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
