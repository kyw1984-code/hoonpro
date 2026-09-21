/**
 * 광고비 대비 순이익 — 일별 광고비 막대와 ROAS 선.
 *
 * 광고비 총액만 보면 "많이 썼다"까지만 안다. 날짜별로 놓으면 광고를 늘린 날
 * 매출이 따라왔는지, 광고비만 나갔는지가 보인다. ROAS는 매출 ÷ 광고비라
 * 단위가 달라 오른쪽 축에 따로 둔다. 광고비가 없는 날은 ROAS를 그리지 않는다
 * — 0으로 나눈 값을 그리면 그날이 가장 좋은 날처럼 보인다.
 */
import { useMemo, useRef, useState } from 'react';
import type { ProfitDay } from '../../lib/coupang';
import { won } from '../../lib/coupang';

const AD_COLOR = '#c47a2c';
const ROAS_COLOR = '#7cf5ff';
const W = 720;
const PAD_L = 46;
const PAD_R = 40;
const TOP = 22;
const PLOT_H = 120;
const AXIS_H = 18;
const H = TOP + PLOT_H + AXIS_H;
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function AdRoasChart({ days }: { days: ProfitDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const model = useMemo(() => {
    const n = days.length;
    const innerW = W - PAD_L - PAD_R;
    const step = n > 0 ? innerW / n : 0;
    const xc = (i: number) => PAD_L + step * i + step / 2;
    const ad = days.map(d => d.adCost ?? 0);
    const roas = days.map(d => ((d.adCost ?? 0) > 0 ? d.salesAmount / (d.adCost as number) : null));
    const adHi = Math.max(1, ...ad);
    const roasHi = Math.max(1, ...roas.map(v => v ?? 0));
    const yAd = (v: number) => TOP + PLOT_H - (v / adHi) * PLOT_H;
    const yRoas = (v: number) => TOP + PLOT_H - (v / roasHi) * PLOT_H;
    const out: string[] = [];
    let started = false;
    roas.forEach((v, i) => {
      if (v === null) { started = false; return; }
      out.push(`${started ? 'L' : 'M'}${xc(i).toFixed(1)},${yRoas(v).toFixed(1)}`);
      started = true;
    });
    const totalAd = ad.reduce((a, b) => a + b, 0);
    const totalSales = days.reduce((a, d) => a + d.salesAmount, 0);
    return { step, xc, yAd, yRoas, ad, roas, adHi, roasHi, roasPath: out.join(' '), totalAd, avgRoas: totalAd > 0 ? totalSales / totalAd : null };
  }, [days]);

  if (days.length < 2 || model.totalAd <= 0) return null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((px - PAD_L) / model.step);
    setHover(i >= 0 && i < days.length ? i : null);
  };
  const point = hover !== null ? days[hover] : null;
  const pointRoas = hover !== null ? model.roas[hover] : null;
  const tickEvery = Math.max(1, Math.ceil(days.length / 6));

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="일별 광고비와 ROAS">
        <line x1={PAD_L} y1={TOP + PLOT_H} x2={W - PAD_R} y2={TOP + PLOT_H} stroke="var(--color-line)" strokeWidth="1" />
        <text x={PAD_L - 6} y={TOP + 4} fontSize="9" fill="var(--color-ink-3)" textAnchor="end">{Math.round(model.adHi / 10000).toLocaleString('ko-KR')}만</text>
        <text x={W - PAD_R + 6} y={TOP + 4} fontSize="9" fill={ROAS_COLOR} textAnchor="start">{model.roasHi.toFixed(1)}x</text>
        {days.map((d, i) => {
          const v = model.ad[i];
          if (v <= 0) return null;
          const bw = Math.max(2, model.step * 0.6);
          return <rect key={d.date} x={model.xc(i) - bw / 2} y={model.yAd(v)} width={bw} height={TOP + PLOT_H - model.yAd(v)} fill={AD_COLOR} opacity={hover === i ? 1 : 0.7} rx="1.5" />;
        })}
        <path d={model.roasPath} fill="none" stroke={ROAS_COLOR} strokeWidth="2" strokeLinecap="round" />
        {days.map((d, i) => (i % tickEvery === 0 ? <text key={d.date} x={model.xc(i)} y={H - 5} fontSize="9" fill="var(--color-ink-3)" textAnchor="middle">{shortDate(d.date)}</text> : null))}
        {hover !== null && <line x1={model.xc(hover)} y1={TOP} x2={model.xc(hover)} y2={TOP + PLOT_H} stroke="var(--color-ink-3)" strokeWidth="1" strokeDasharray="3 3" />}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: AD_COLOR }} />광고비</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: ROAS_COLOR }} />ROAS (매출 ÷ 광고비, 오른쪽 축)</span>
        {model.avgRoas !== null && <span>기간 평균 ROAS {model.avgRoas.toFixed(1)}x · 광고비 {won(Math.round(model.totalAd))}</span>}
      </div>
      {point && (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 rounded-control border border-line bg-paper-2 px-3 py-2 text-[11.5px] tabular-nums">
          <b className="text-ink">{point.date}</b>
          <span className="text-ink-2">광고비 {won(Math.round(point.adCost ?? 0))}</span>
          <span className="text-ink-2">매출 {won(point.salesAmount)}</span>
          <span style={{ color: ROAS_COLOR }}>ROAS {pointRoas === null ? '—' : `${pointRoas.toFixed(1)}x`}</span>
          <span className={point.profit - (point.adCost ?? 0) >= 0 ? 'text-positive' : 'text-critical'}>광고 뺀 순이익 {won(Math.round(point.profit - (point.adCost ?? 0)))}</span>
        </div>
      )}
    </div>
  );
}
