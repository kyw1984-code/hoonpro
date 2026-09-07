/**
 * 순위와 판매량을 위아래로 나란히 그린다.
 *
 * 두 지표는 단위가 전혀 다르므로 한 축에 겹쳐 그리지 않는다(이중 축은 기울기를
 * 마음대로 왜곡한다). 대신 x축을 공유하는 두 패널로 나누고, 커서를 대면 두
 * 패널에 같은 날짜의 십자선이 함께 서서 관계를 눈으로 잇게 한다.
 *
 * 순위 패널은 y축을 뒤집는다. 1위가 위로 가야 '올라갔다'는 말과 그림이 맞는다.
 */
import { useMemo, useRef, useState } from 'react';
import type { RankSeriesPoint } from '../../lib/coupang';

// 대비·색각 검증을 통과한 조합 (어두운 표면 #1b2745 기준)
const RANK_COLOR = '#2d9bb6';
const SALES_COLOR = '#c47a2c';

const W = 720;
const PAD_L = 34;
const PAD_R = 12;
const RANK_TOP = 16;
const RANK_H = 96;
const GAP = 34;
const SALES_H = 76;
const AXIS_H = 18;
const H = RANK_TOP + RANK_H + GAP + SALES_H + AXIS_H;

export function RankRevenueChart({ series }: { series: RankSeriesPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const model = useMemo(() => {
    const n = series.length;
    const innerW = W - PAD_L - PAD_R;
    const step = n > 1 ? innerW / (n - 1) : 0;
    const x = (i: number) => PAD_L + (n > 1 ? i * step : innerW / 2);

    const ranks = series.map(p => p.rank).filter((r): r is number => r !== null);
    const rankMin = ranks.length ? Math.min(...ranks) : 1;
    const rankMax = ranks.length ? Math.max(...ranks) : 60;
    const rSpan = Math.max(1, rankMax - rankMin);
    // 순위는 값이 작을수록 좋으므로 위로 올린다
    const yRank = (r: number) => RANK_TOP + ((r - rankMin) / rSpan) * RANK_H;

    const qtyMax = Math.max(1, ...series.map(p => p.quantity));
    const salesTop = RANK_TOP + RANK_H + GAP;
    const yQty = (q: number) => salesTop + SALES_H - (q / qtyMax) * SALES_H;

    // 순위가 없는 날(60위 밖)에서는 선을 끊는다. 이어 그리면 없는 값을 지어낸다.
    const segments: string[] = [];
    let current: string[] = [];
    series.forEach((p, i) => {
      if (p.rank === null) {
        if (current.length > 1) segments.push(current.join(' '));
        current = [];
        return;
      }
      current.push(`${current.length === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yRank(p.rank).toFixed(1)}`);
    });
    if (current.length > 1) segments.push(current.join(' '));

    const barW = Math.max(2, Math.min(14, step - 2));

    return { x, yRank, yQty, segments, qtyMax, rankMin, rankMax, salesTop, barW, step };
  }, [series]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || series.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const innerW = W - PAD_L - PAD_R;
    const ratio = Math.max(0, Math.min(1, (px - PAD_L) / innerW));
    setHover(Math.round(ratio * (series.length - 1)));
  };

  const point = hover !== null ? series[hover] : null;

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
        aria-label="검색 순위와 일별 판매량 추이"
      >
        {/* 기준선 — 눈에 띄지 않게 뒤로 뺀다 */}
        <line x1={PAD_L} y1={RANK_TOP + RANK_H} x2={W - PAD_R} y2={RANK_TOP + RANK_H} stroke="var(--color-line)" strokeWidth="1" />
        <line
          x1={PAD_L}
          y1={model.salesTop + SALES_H}
          x2={W - PAD_R}
          y2={model.salesTop + SALES_H}
          stroke="var(--color-line)"
          strokeWidth="1"
        />

        {/* 패널 제목 — 계열이 하나씩이라 범례 대신 제목이 이름을 맡는다 */}
        <text x={PAD_L} y={10} fontSize="10" fill="var(--color-ink-3)">
          검색 순위 (위로 갈수록 상위)
        </text>
        <text x={PAD_L} y={model.salesTop - 8} fontSize="10" fill="var(--color-ink-3)">
          일별 판매량
        </text>

        {/* 순위 눈금 */}
        <text x={PAD_L - 6} y={RANK_TOP + 4} fontSize="9" fill="var(--color-ink-3)" textAnchor="end">
          {model.rankMin}위
        </text>
        <text x={PAD_L - 6} y={RANK_TOP + RANK_H} fontSize="9" fill="var(--color-ink-3)" textAnchor="end">
          {model.rankMax}위
        </text>
        <text x={PAD_L - 6} y={model.salesTop + 8} fontSize="9" fill="var(--color-ink-3)" textAnchor="end">
          {model.qtyMax}
        </text>

        {/* 판매량 막대 — 바닥에 붙이고 위쪽만 둥글게.
            rect에 rx를 주면 아래도 둥글어져 짧은 막대가 알약처럼 보이고
            기준선에서 떠 있는 것처럼 읽힌다. 그래서 경로로 직접 그린다. */}
        {series.map((p, i) => {
          if (p.quantity <= 0) return null;
          const y = model.yQty(p.quantity);
          const base = model.salesTop + SALES_H;
          const h = Math.max(1, base - y);
          const left = model.x(i) - model.barW / 2;
          const right = left + model.barW;
          const r = Math.min(4, model.barW / 2, h);
          return (
            <path
              key={p.date}
              d={`M${left},${base} L${left},${y + r} Q${left},${y} ${left + r},${y} L${right - r},${y} Q${right},${y} ${right},${y + r} L${right},${base} Z`}
              fill={SALES_COLOR}
              opacity={hover === null || hover === i ? 1 : 0.45}
            />
          );
        })}

        {/* 순위 선 */}
        {model.segments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={RANK_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ))}

        {/* 공유 십자선 */}
        {point && (
          <>
            <line
              x1={model.x(hover!)}
              y1={RANK_TOP}
              x2={model.x(hover!)}
              y2={model.salesTop + SALES_H}
              stroke="var(--color-line-strong)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {point.rank !== null && (
              <circle
                cx={model.x(hover!)}
                cy={model.yRank(point.rank)}
                r="4.5"
                fill={RANK_COLOR}
                stroke="var(--color-paper)"
                strokeWidth="2"
              />
            )}
          </>
        )}

        {/* x축 양 끝 날짜만 — 모든 점에 라벨을 달면 읽을 수 없다 */}
        {series.length > 0 && (
          <>
            <text x={PAD_L} y={H - 4} fontSize="9" fill="var(--color-ink-3)">
              {series[0].date.slice(5)}
            </text>
            <text x={W - PAD_R} y={H - 4} fontSize="9" fill="var(--color-ink-3)" textAnchor="end">
              {series[series.length - 1].date.slice(5)}
            </text>
          </>
        )}
      </svg>

      {point && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-control border border-line bg-paper-2 px-2.5 py-1.5 text-[11px] shadow-overlay">
          <span className="text-ink-3">{point.date}</span>
          <span className="ml-2 font-semibold text-ink">{point.rank === null ? '60위 밖' : `${point.rank}위`}</span>
          <span className="ml-2 font-semibold text-ink">{point.quantity}개</span>
        </div>
      )}
    </div>
  );
}
