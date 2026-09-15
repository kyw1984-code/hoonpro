/**
 * 저장해 둔 소싱 결과와 지금을 견준다.
 *
 * 소싱 결과를 저장하는 이유는 나중에 다시 보기 위해서가 아니라 '그때 봐 둔
 * 상품이 그동안 어떻게 됐나'를 알기 위해서다. 순위가 밀렸는지, 리뷰가 얼마나
 * 붙었는지(= 그동안 얼마나 팔렸는지), 가격이 내려갔는지.
 *
 * 견줄 값은 매일 도는 소싱 크론이 쌓아 둔 관측치에서 가져온다. 열 때마다
 * Bright Data를 다시 부르면 사용자당 월 비용이 붙고 하루 한도까지 깎인다.
 * 대신 자동 수집 대상이 아닌 키워드는 견줄 것이 없다 — 그건 그렇다고 말한다.
 */

export interface SavedProduct {
  productId: string;
  productName?: string;
  rank?: number | null;
  productPrice?: number | null;
  reviewCount?: number | null;
}

export interface CurrentObs {
  productId: string;
  /** 오가닉 순위. null이면 1페이지 밖 */
  rank?: number | null;
  price?: number | null;
  reviewCount?: number | null;
}

export type DiffStatus = 'up' | 'down' | 'same' | 'gone' | 'unknown';

export interface ProductDiff {
  productId: string;
  productName: string;
  savedRank: number | null;
  currentRank: number | null;
  /** 양수면 올랐다는 뜻이다. 순위는 숫자가 작을수록 좋으므로 뺄셈 방향이 뒤집힌다 */
  rankDelta: number | null;
  savedPrice: number | null;
  currentPrice: number | null;
  priceDelta: number | null;
  savedReviews: number | null;
  currentReviews: number | null;
  /** 저장 이후 붙은 리뷰 수 — 그동안 얼마나 팔렸는지의 대리 지표다 */
  reviewDelta: number | null;
  status: DiffStatus;
}

export interface DiffSummary {
  compared: number;
  up: number;
  down: number;
  gone: number;
  /** 리뷰가 가장 많이 붙은 상품 (그 기간 가장 잘 팔린 상품) */
  topMover: ProductDiff | null;
  /** 리뷰 증가 합 — 이 키워드 상위권 전체가 그동안 얼마나 팔렸나 */
  totalReviewGain: number;
}

/**
 * null을 0으로 만들지 않는다.
 *
 * Number(null)은 0이다. 이걸 거르지 않으면 1페이지 밖으로 밀린 상품(rank=null)이
 * 0위로 읽혀 '1위보다 위로 올랐다'가 된다.
 */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function diffSourcing(saved: SavedProduct[], current: CurrentObs[]): {
  rows: ProductDiff[];
  summary: DiffSummary;
} {
  const now = new Map<string, CurrentObs>();
  for (const c of current) now.set(String(c.productId), c);

  const rows: ProductDiff[] = saved.map((s, i) => {
    const id = String(s.productId ?? '');
    const c = now.get(id);
    const savedRank = num(s.rank) ?? i + 1;
    const currentRank = c ? num(c.rank) : null;

    // 관측치에 아예 없으면 '모름'이고, 관측은 됐는데 순위가 비었으면
    // 1페이지 밖으로 밀린 것이다. 둘은 다른 이야기라 섞지 않는다.
    let status: DiffStatus;
    if (!c) status = 'unknown';
    else if (currentRank === null) status = 'gone';
    else if (currentRank < savedRank) status = 'up';
    else if (currentRank > savedRank) status = 'down';
    else status = 'same';

    const savedReviews = num(s.reviewCount);
    const currentReviews = c ? num(c.reviewCount) : null;
    const savedPrice = num(s.productPrice);
    const currentPrice = c ? num(c.price) : null;

    return {
      productId: id,
      productName: String(s.productName ?? ''),
      savedRank,
      currentRank,
      rankDelta: currentRank !== null ? savedRank - currentRank : null,
      savedPrice,
      currentPrice,
      priceDelta: savedPrice !== null && currentPrice !== null ? currentPrice - savedPrice : null,
      savedReviews,
      currentReviews,
      // 리뷰는 줄지 않는다. 음수가 나오면 관측이 어긋난 것이라 버린다 —
      // 마이너스 판매량을 화면에 보여 줄 수는 없다.
      reviewDelta:
        savedReviews !== null && currentReviews !== null && currentReviews >= savedReviews
          ? currentReviews - savedReviews
          : null,
      status,
    };
  });

  const compared = rows.filter(r => r.status !== 'unknown');
  const withGain = compared.filter(r => (r.reviewDelta ?? 0) > 0);
  withGain.sort((a, b) => (b.reviewDelta ?? 0) - (a.reviewDelta ?? 0));

  return {
    rows,
    summary: {
      compared: compared.length,
      up: rows.filter(r => r.status === 'up').length,
      down: rows.filter(r => r.status === 'down').length,
      gone: rows.filter(r => r.status === 'gone').length,
      topMover: withGain[0] ?? null,
      totalReviewGain: compared.reduce((n, r) => n + (r.reviewDelta ?? 0), 0),
    },
  };
}

/** "3계단 상승" / "2계단 하락" / "그대로" */
export function rankMoveLabel(d: ProductDiff): string {
  if (d.status === 'unknown') return '기록 없음';
  if (d.status === 'gone') return '1페이지 밖';
  if (d.rankDelta === null || d.rankDelta === 0) return '그대로';
  return d.rankDelta > 0 ? `${d.rankDelta}계단 상승` : `${-d.rankDelta}계단 하락`;
}
