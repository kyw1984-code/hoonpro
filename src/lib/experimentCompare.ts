/**
 * 변경 전후 비교의 판정.
 *
 * 전후 기간의 길이가 다를 수 있으므로(바꾼 지 3일째면 '후'는 3일) 하루 평균으로
 * 견준다. 며칠 안 된 결과로 단정하지 않도록 최소 3일은 지나야 판정을 낸다.
 */
export interface SideMetrics {
  /** 실제로 데이터가 있는 날 수 */
  days: number;
  quantity: number;
  salesAmount: number;
  adCost: number;
  /** 추정 순이익 (매출 − 수수료 − 원가 − 광고비) */
  profit: number;
}

export interface RankPair {
  keyword: string;
  before: number | null;
  after: number | null;
}

export const MIN_DAYS_FOR_VERDICT = 3;

export function perDay(side: SideMetrics, key: 'quantity' | 'salesAmount' | 'adCost' | 'profit'): number {
  return side.days > 0 ? side[key] / side.days : 0;
}

/** 하루 평균 기준 변화율(%). 이전이 0이면 비교할 수 없어 null */
export function pctChange(before: SideMetrics, after: SideMetrics, key: 'quantity' | 'salesAmount' | 'adCost' | 'profit'): number | null {
  const b = perDay(before, key);
  const a = perDay(after, key);
  if (b === 0) return null;
  return Math.round(((a - b) / Math.abs(b)) * 100);
}

export interface Verdict {
  tone: 'good' | 'bad' | 'mixed' | 'na';
  headline: string;
  detail: string;
}

const signed = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v}%`);

export function verdict(before: SideMetrics, after: SideMetrics, ranks: RankPair[] = []): Verdict {
  if (after.days < MIN_DAYS_FOR_VERDICT) {
    return {
      tone: 'na',
      headline: after.days === 0 ? '아직 바꾼 뒤 데이터가 없습니다' : `바꾼 지 ${after.days}일째 — ${MIN_DAYS_FOR_VERDICT}일은 지나야 판단합니다`,
      detail: '하루 이틀은 요일과 우연에 흔들립니다. 조금 더 기다리세요.',
    };
  }
  if (before.days === 0) {
    return { tone: 'na', headline: '바꾸기 전 데이터가 없어 견줄 수 없습니다', detail: '수집이 시작되기 전의 변경이면 비교할 기준이 없습니다.' };
  }
  const q = pctChange(before, after, 'quantity');
  const p = pctChange(before, after, 'profit');
  const s = pctChange(before, after, 'salesAmount');

  const rankUp = ranks.filter(r => r.before !== null && r.after !== null && (r.after as number) < (r.before as number)).length;
  const rankDown = ranks.filter(r => r.before !== null && r.after !== null && (r.after as number) > (r.before as number)).length;
  const rankNote = ranks.length === 0 ? '' : rankUp > rankDown ? ' · 순위 상승' : rankDown > rankUp ? ' · 순위 하락' : ' · 순위 비슷';

  const headline = `판매 ${signed(q)} · 매출 ${signed(s)} · 순이익 ${signed(p)} (하루 평균)${rankNote}`;

  // 순이익이 답이다. 판매가 늘어도 순이익이 줄면 그 변경은 손해다.
  const profitBase = perDay(before, 'profit');
  if (p !== null && profitBase > 0) {
    if (p >= 5) return { tone: 'good', headline, detail: '순이익이 늘었습니다. 이 변경은 유지할 만합니다.' };
    if (p <= -5) {
      return {
        tone: 'bad', headline,
        detail: q !== null && q > 0 ? '판매는 늘었지만 순이익은 줄었습니다. 할인 폭이 마진을 넘어섰을 수 있습니다.' : '순이익이 줄었습니다. 되돌리는 쪽을 생각해보세요.',
      };
    }
    return { tone: 'mixed', headline, detail: '순이익 차이가 5% 안이라 뚜렷한 효과라고 보기 어렵습니다.' };
  }
  // 순이익 기준을 못 세우면(원가 미입력 등) 판매량으로 본다
  if (q !== null) {
    if (q >= 10) return { tone: 'good', headline, detail: '판매가 늘었습니다. 원가를 넣으면 순이익까지 견줄 수 있습니다.' };
    if (q <= -10) return { tone: 'bad', headline, detail: '판매가 줄었습니다. 원가를 넣으면 순이익까지 견줄 수 있습니다.' };
    return { tone: 'mixed', headline, detail: '판매량 차이가 10% 안이라 뚜렷한 효과라고 보기 어렵습니다.' };
  }
  return { tone: 'na', headline, detail: '바꾸기 전 판매가 없어 비율을 낼 수 없습니다.' };
}
