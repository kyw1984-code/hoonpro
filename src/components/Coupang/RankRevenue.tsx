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
import { ChevronDown, ChevronRight, Info, ListOrdered, Loader2 } from 'lucide-react';
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

/**
 * 목표 순위 후보를 고른다.
 *
 * 1계단당 효과를 곱해 3위까지 늘려 보여주고 싶은 유혹이 있지만, 40위에서 3위로
 * 가는 구간은 관측된 적이 없다. 실제로 겪어 본 순위 구간 안에서만 제안한다.
 * 그 밖은 추정이 아니라 창작이다.
 */
function targetRanks(current: number, observedBest: number): number[] {
  const candidates = [current - 3, current - 5, current - 10, observedBest];
  const seen = new Set<number>();
  return candidates
    .map(n => Math.round(n))
    // 한 계단짜리 제안은 바로 위 문장을 그대로 반복할 뿐이라 뺀다.
    // 두 계단 이상 움직이는 경우만 새로운 정보가 된다.
    .filter(n => n >= observedBest && n >= 1 && current - n >= 2 && !seen.has(n) && (seen.add(n), true))
    .sort((a, b) => b - a)
    .slice(0, 3);
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
            <Verdict item={item} />
          ) : (
            <p className="rounded-card border border-line bg-paper-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
              {STATUS_TEXT[item.status]}
            </p>
          )}

          {item.series.length > 1 && <ChartToggle item={item} />}
        </article>
      ))}
    </div>
  );
}

/**
 * 결론을 문장으로 먼저 말한다.
 *
 * "상관계수 0.62"는 셀러가 오늘 무엇을 할지 알려주지 않는다. "지금 12위인데
 * 7위로 올리면 주간 매출이 약 32만원 늘어난다"는 알려준다. 계수와 표본 일수는
 * 결론을 얼마나 믿을지 판단할 근거로 아래에 작게 남긴다.
 */
export function Verdict({ item }: { item: RankRevenueItem }) {
  const ranks = item.series.map(p => p.rank).filter((r): r is number => r !== null);
  const observedBest = ranks.length > 0 ? Math.min(...ranks) : null;
  const current = item.latestRank;
  const perStep = item.weeklyRevenuePerStep;

  const targets =
    current !== null && observedBest !== null && perStep !== null && perStep > 0
      ? targetRanks(current, observedBest)
      : [];

  // 숫자를 아예 안 보여준 경우에는 "이 숫자는 참고용"이라는 단서가 가리킬 대상이 없다
  const showsEstimate = perStep !== null && perStep > 0;
  const weak = showsEstimate && Math.abs(item.correlation ?? 0) < 0.4;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] leading-relaxed text-ink">
        {current === null ? (
          '현재 순위를 아직 확인하지 못했습니다.'
        ) : perStep === null || perStep <= 0 ? (
          <>
            이 키워드에서는 순위가 올라간다고 판매가 늘지는 않았습니다. 순위보다 상세페이지나 가격을 먼저 보는 편이 낫습니다.
          </>
        ) : (
          <>
            지금 <b className="font-semibold">{current}위</b>입니다. 한 계단 올릴 때마다 주간 매출이 약{' '}
            <b className="font-semibold">{won(perStep)}</b> 늘어난 것으로 보입니다.
          </>
        )}
      </p>

      {targets.length === 0 && current !== null && observedBest !== null && perStep !== null && perStep > 0 && (
        <p className="rounded-card border border-line bg-paper-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
          {current <= observedBest
            ? '최근 기록 중 가장 높은 순위입니다. 여기서 더 올라가면 어떻게 될지는 아직 겪어 본 적이 없어 계산하지 않았습니다.'
            : '겪어 본 최고 순위와 차이가 크지 않아 따로 제안할 구간이 없습니다.'}
        </p>
      )}

      {targets.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {targets.map(t => (
            <li
              key={t}
              className="flex items-center gap-3 rounded-card border border-line bg-paper-2 px-3 py-2.5 text-[13px]"
            >
              <span className="text-ink-2">
                {current}위 <span className="text-ink-3">→</span> <b className="font-semibold text-ink">{t}위</b>
              </span>
              <span className="ml-auto font-semibold tabular-nums text-positive">
                주간 +{won((current! - t) * perStep!)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11.5px] leading-relaxed text-ink-3">
        {weak && '다만 순위와 판매가 함께 움직인 정도가 약해 이 숫자는 참고용입니다. '}
        {targets.length > 0 && `실제로 겪어 본 ${observedBest}위까지만 계산했습니다. `}
        평균 판매가 {won(item.avgPrice)} · {item.days}일치 기록 · 관계의 뚜렷함 {strengthLabel(item.correlation ?? 0)}
        (상관계수 {(item.correlation ?? 0).toFixed(2)})
      </p>
    </div>
  );
}

/** 추이는 결론을 의심할 때 보는 것이라 기본은 접어 둔다 */
function ChartToggle({ item }: { item: RankRevenueItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 text-[12px] font-medium text-ink-3 transition-colors hover:text-ink"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        순위와 판매 추이 보기
      </button>
      {open && (
        <div className="mt-2">
          <RankRevenueChart series={item.series} />
        </div>
      )}
    </div>
  );
}
