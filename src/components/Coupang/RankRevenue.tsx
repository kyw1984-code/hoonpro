/**
 * [7] 순위와 판매의 상관 코칭
 *
 * 훈프로에는 순위 추적 이력이 이미 쌓여 있고, 이제 실제 판매량도 있다. 둘을
 * 붙이면 "이 키워드 순위 한 계단이 내 매출로 얼마인가"라는 답이 나온다.
 * 일반적인 업계 평균이 아니라 이 판매자의 상품에서 나온 숫자다.
 *
 * 통계를 함부로 말하지 않는다. 겹치는 날이 부족하거나 순위가 거의 안 변한
 * 구간은 계산하지 않고 왜 못 하는지 그대로 말한다.
 */
import { useEffect, useState } from 'react';
import { Loader2, ListOrdered, Info } from 'lucide-react';
import { coupangApi, won, type RankRevenueItem } from '../../lib/coupang';
import { RankRevenueChart } from './RankRevenueChart';

const STATUS_TEXT: Record<RankRevenueItem['status'], string> = {
  ok: '',
  'few-days': '순위와 판매가 함께 기록된 날이 아직 적어 관계를 계산하지 않았습니다. 며칠 더 쌓이면 자동으로 나옵니다.',
  'flat-rank': '이 기간 순위가 거의 변하지 않아 영향을 가늠할 수 없습니다. 순위가 움직이면 계산됩니다.',
  'no-orders': '이 상품의 주문 데이터를 찾지 못했습니다. 쿠팡 수집이 한 번 돌아야 연결됩니다.',
};

function strengthLabel(r: number): string {
  const a = Math.abs(r);
  if (a >= 0.7) return '뚜렷함';
  if (a >= 0.4) return '어느 정도';
  return '약함';
}

export function RankRevenue() {
  const [items, setItems] = useState<RankRevenueItem[] | null>(null);
  const [minPairs, setMinPairs] = useState(10);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    coupangApi
      .rankRevenue()
      .then(r => {
        setItems(r.items);
        setMinPairs(r.minPairs);
      })
      .catch(e => setError(e.message));
  }, []);

  if (error) {
    return <div className="rounded-panel border border-critical/35 bg-critical-soft p-5 text-[13px] text-ink-2">{error}</div>;
  }
  if (!items) {
    return (
      <div className="flex items-center gap-2 py-14 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-[13px]">순위와 판매를 맞춰 보는 중...</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-panel border border-line bg-paper py-16 text-ink-3">
        <ListOrdered className="mb-4 h-12 w-12 opacity-20" />
        <p className="text-sm font-semibold">추적 중인 키워드가 없습니다</p>
        <p className="mt-1.5 text-center text-[12px] leading-relaxed">
          [순위 추적] 탭에서 내 상품과 대표 키워드를 등록하면
          <br />
          순위 변화가 판매로 얼마나 이어지는지 계산해 드립니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-panel border border-line bg-paper px-5 py-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          순위 추적 기록과 실제 주문을 날짜로 맞춰 관계를 봅니다. 최소 {minPairs}일치가 겹쳐야 계산합니다.
          관계가 보인다고 해서 순위가 판매를 만든 것이라고 단정할 수는 없습니다. 시즌이나 광고가 둘을 동시에 움직였을 수도 있습니다.
        </p>
      </div>

      {items.map(item => (
        <article key={`${item.keyword}-${item.productId}`} className="rounded-panel border border-line bg-paper p-5">
          <header className="mb-3 flex flex-wrap items-baseline gap-2">
            <h3 className="text-[13.5px] font-semibold text-ink">"{item.keyword}"</h3>
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{item.productName || `상품 ${item.productId}`}</span>
            {item.latestRank !== null && (
              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">현재 {item.latestRank}위</span>
            )}
          </header>

          {item.status === 'ok' && item.correlation !== null ? (
            <>
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Stat
                  label="순위 1계단 개선 시"
                  value={
                    item.perStepQty === null
                      ? '-'
                      : `하루 ${item.perStepQty >= 0 ? '+' : ''}${item.perStepQty.toFixed(2)}개`
                  }
                />
                <Stat
                  label="주간 매출 환산"
                  value={item.weeklyRevenuePerStep === null ? '-' : won(item.weeklyRevenuePerStep)}
                  sub={`평균 판매가 ${won(item.avgPrice)} 기준`}
                />
                <Stat
                  label="관계의 뚜렷함"
                  value={strengthLabel(item.correlation)}
                  sub={`상관계수 ${item.correlation.toFixed(2)} · ${item.days}일치`}
                />
              </div>
              <RankRevenueChart series={item.series} />
            </>
          ) : (
            <>
              <p className="rounded-card border border-line bg-paper-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
                {STATUS_TEXT[item.status]}
              </p>
              {item.series.length > 1 && (
                <div className="mt-4">
                  <RankRevenueChart series={item.series} />
                </div>
              )}
            </>
          )}
        </article>
      ))}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-card border border-line bg-paper-2 px-3 py-3">
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className="mt-0.5 text-[16px] font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-[10.5px] leading-tight text-ink-3">{sub}</p>}
    </div>
  );
}
