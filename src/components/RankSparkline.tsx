/**
 * 순위 추이 스파크라인.
 *
 * 순위는 값이 작을수록 좋으므로 y축을 뒤집는다 — 1위가 위로 가야 "올라갔다"는
 * 말과 그림이 맞는다.
 *
 * 60위 밖으로 밀린 날(rank === null)에는 선을 끊는다. 이어 그리면 없던 순위를
 * 지어내는 셈이고, 밀려났다 돌아온 사실이 지워진다. 대신 바닥에 옅은 점을 찍어
 * "이날은 밖이었다"를 남긴다.
 */
interface Point {
  rank: number | null;
  captured_at?: string;
}

const W = 120;
const H = 30;
const PAD = 3;

export function RankSparkline({ history }: { history: Point[] }) {
  const pts = history.slice(-30);
  if (pts.length < 2) return null;

  const ranked = pts.map(p => p.rank).filter((r): r is number => typeof r === 'number');
  if (ranked.length === 0) return null;

  const best = Math.min(...ranked);
  const worst = Math.max(...ranked);
  // 순위가 내내 같으면 span이 0이 되어 나눗셈이 깨진다. 그때는 가운데에 평평하게 긋는다.
  const span = worst - best;
  const step = (W - PAD * 2) / (pts.length - 1);
  const x = (i: number) => PAD + i * step;
  const y = (r: number) => (span === 0 ? H / 2 : PAD + ((r - best) / span) * (H - PAD * 2));

  // 선은 두 점 이상일 때만 그릴 수 있다. 앞뒤가 모두 60위 밖이라 혼자 남은
  // 기록은 선이 못 되므로 점으로 찍는다. 버리면 "최고 N위"라고 써 놓고
  // 그래프에는 아무것도 없는 상태가 된다.
  const segments: string[] = [];
  const isolated: Array<{ i: number; rank: number }> = [];
  let cur: Array<{ i: number; rank: number }> = [];
  const flush = () => {
    if (cur.length > 1) segments.push(cur.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.rank).toFixed(1)}`).join(' '));
    else if (cur.length === 1) isolated.push(cur[0]);
    cur = [];
  };
  pts.forEach((p, i) => {
    if (p.rank === null) { flush(); return; }
    cur.push({ i, rank: p.rank });
  });
  flush();

  const last = pts[pts.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[30px] w-[120px] shrink-0"
      role="img"
      aria-label={`최근 ${pts.length}회 순위 추이, 최고 ${best}위 최저 ${worst}위`}
    >
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {/* 앞뒤가 모두 60위 밖이라 선을 못 이루는 기록 */}
      {isolated.map(p => (
        <circle key={`i${p.i}`} cx={x(p.i)} cy={y(p.rank)} r="1.8" fill="var(--color-accent)" />
      ))}
      {/* 순위가 없던 날 — 바닥에 점으로만 남긴다 */}
      {pts.map((p, i) =>
        p.rank === null ? <circle key={`o${i}`} cx={x(i)} cy={H - PAD} r="1.2" fill="var(--color-ink-3)" opacity="0.5" /> : null,
      )}
      {/* 지금 위치를 점으로 찍어 선의 끝이 어디인지 분명히 한다 */}
      {typeof last?.rank === 'number' && (
        <circle cx={x(pts.length - 1)} cy={y(last.rank)} r="2.2" fill="var(--color-accent)" />
      )}
    </svg>
  );
}
