/**
 * 일별 매출·순이익 추이.
 *
 * 합계 하나로는 "지금 오르는 중인지 꺾이는 중인지"를 알 수 없다. 같은 300만원도
 * 우상향이면 재고를 늘려야 하고, 우하향이면 원인을 찾아야 한다.
 *
 * 매출과 순이익은 단위가 같으므로 한 축에 겹쳐 그린다(이중 축은 기울기를
 * 왜곡한다). 순이익은 음수가 될 수 있어 0선을 그어 적자를 눈에 보이게 한다.
 * 요일 효과 때문에 하루하루는 심하게 튀므로 7일 이동평균을 함께 그려
 * 추세를 읽게 한다.
 */
import { useMemo, useRef, useState } from 'react';
import type { ProfitDay } from '../../lib/coupang';

// RankRevenueChart와 같은 팔레트 — 어두운 표면에서 대비·색각 검증을 통과한 조합
const SALES_COLOR = '#c47a2c';
const PROFIT_COLOR = '#2d9bb6';

const W = 720;
const PAD_L = 46;
const PAD_R = 12;
const TOP = 22;
const PLOT_H = 132;
const AXIS_H = 18;
const H = TOP + PLOT_H + AXIS_H;

/** 7일 이동평균. 앞쪽은 표본이 모자라 null로 두고 선을 시작하지 않는다. */
function movingAverage(values: number[], window: number): Array<number | null> {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    let sum = 0;
    for (let k = i - window + 1; k <= i; k++) sum += values[k];
    return sum / window;
  });
}

const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const money = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

export function DailyTrendChart({ days }: { days: ProfitDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const model = useMemo(() => {
    const n = days.length;
    const innerW = W - PAD_L - PAD_R;
    const step = n > 1 ? innerW / (n - 1) : 0;
    const x = (i: number) => PAD_L + (n > 1 ? i * step : innerW / 2);

    const sales = days.map(d => d.salesAmount);
    const profits = days.map(d => d.profit);
    // 축은 두 계열을 함께 담아야 한다. 따로 잡으면 순이익 선이 매출 선 위로
    // 올라가 실제보다 잘 남는 것처럼 보인다.
    const hi = Math.max(1, ...sales, ...profits);
    const lo = Math.min(0, ...profits);
    const span = hi - lo || 1;
    const y = (v: number) => TOP + PLOT_H - ((v - lo) / span) * PLOT_H;
    const yZero = y(0);

    const path = (vals: Array<number | null>) => {
      const out: string[] = [];
      let started = false;
      vals.forEach((v, i) => {
        if (v === null) { started = false; return; }
        out.push(`${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
        started = true;
      });
      return out.join(' ');
    };

    // 30일 이상일 때만 이동평균이 의미가 있다. 7일치에 7일 평균은 점 하나뿐이다.
    const showMa = n >= 14;
    return {
      x, y, yZero, step,
      salesPath: path(sales),
      profitPath: path(profits),
      salesMaPath: showMa ? path(movingAverage(sales, 7)) : '',
      profitMaPath: showMa ? path(movingAverage(profits, 7)) : '',
      showMa, hi, lo,
    };
  }, [days]);

  if (days.length < 2) return null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = Math.max(0, Math.min(1, (px - PAD_L) / (W - PAD_L - PAD_R)));
    setHover(Math.round(ratio * (days.length - 1)));
  };

  const point = hover !== null ? days[hover] : null;
  // x축 라벨은 6개면 충분하다. 30일치 날짜를 다 쓰면 서로 겹쳐 아무것도 못 읽는다.
  const tickEvery = Math.max(1, Math.ceil(days.length / 6));

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 'auto' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="일별 매출과 순이익 추이"
      >
        {/* 0선 — 순이익이 이 아래로 내려간 날이 적자다 */}
        <line x1={PAD_L} y1={model.yZero} x2={W - PAD_R} y2={model.yZero} stroke="var(--color-line)" strokeWidth="1" />

        <text x={PAD_L - 6} y={TOP + 4} fontSize="9" fill="var(--color-ink-3)" textAnchor="end">
          {Math.round(model.hi / 10000).toLocaleString('ko-KR')}만
        </text>
        <text x={PAD_L - 6} y={model.yZero + 3} fontSize="9" fill="var(--color-ink-3)" textAnchor="end">
          0
        </text>

        {/* 하루하루 값은 흐리게, 7일 평균은 진하게 — 추세가 앞에 서야 한다 */}
        <path d={model.salesPath} fill="none" stroke={SALES_COLOR} strokeWidth="1.2" opacity={model.showMa ? 0.35 : 1} />
        <path d={model.profitPath} fill="none" stroke={PROFIT_COLOR} strokeWidth="1.2" opacity={model.showMa ? 0.35 : 1} />
        {model.showMa && (
          <>
            <path d={model.salesMaPath} fill="none" stroke={SALES_COLOR} strokeWidth="2.2" strokeLinecap="round" />
            <path d={model.profitMaPath} fill="none" stroke={PROFIT_COLOR} strokeWidth="2.2" strokeLinecap="round" />
          </>
        )}

        {days.map((d, i) =>
          i % tickEvery === 0 ? (
            <text key={d.date} x={model.x(i)} y={H - 5} fontSize="9" fill="var(--color-ink-3)" textAnchor="middle">
              {shortDate(d.date)}
            </text>
          ) : null,
        )}

        {hover !== null && (
          <line x1={model.x(hover)} y1={TOP} x2={model.x(hover)} y2={TOP + PLOT_H} stroke="var(--color-ink-3)" strokeWidth="1" strokeDasharray="3 3" />
        )}
      </svg>

      {/* 범례 — 선이 두 개뿐이라 색만으로 충분하지만, 색각 이상을 고려해 이름을 붙인다 */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: SALES_COLOR }} />매출
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: PROFIT_COLOR }} />순이익 (광고비 빼기 전)
        </span>
        {model.showMa && <span>진한 선은 7일 평균입니다 — 요일에 따라 튀는 값을 걷어낸 추세입니다.</span>}
      </div>

      {point && (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 rounded-control border border-line bg-paper-2 px-3 py-2 text-[11.5px] tabular-nums">
          <b className="text-ink">{point.date}</b>
          <span className="text-ink-2">매출 {money(point.salesAmount)}</span>
          <span className={point.profit >= 0 ? 'text-positive' : 'text-critical'}>순이익 {money(point.profit)}</span>
          <span className="text-ink-3">{point.quantity.toLocaleString('ko-KR')}개</span>
        </div>
      )}
    </div>
  );
}
