/**
 * 월별 순이익 리포트.
 *
 * 순이익 화면은 기간을 골라 보는 곳이라 '지난달보다 나아졌나'에 답하지 못한다.
 * 정산서 대조도 월 단위라 두 화면이 같은 눈금을 쓰면 맞물린다.
 *
 * 숫자를 늘어놓는 것만으로는 부족하다. 순이익이 줄었을 때 무엇 때문에
 * 줄었는지까지 말해야 다음 달에 손댈 곳이 정해진다 — 광고비가 늘어서인지,
 * 쿠폰을 더 써서인지, 그냥 덜 팔려서인지.
 */

export interface MonthProfit {
  /** YYYY-MM */
  month: string;
  quantity: number;
  /** 주문금액 (쿠폰 차감 전) */
  salesAmount: number;
  /** 즉시할인쿠폰 */
  couponDiscount: number;
  commission: number;
  /** 원가 + 출고비 */
  unitCost: number;
  returnCost: number;
  returnAmount: number;
  adCost: number;
  /** 광고비까지 뺀 순이익 */
  profit: number;
}

export interface Delta {
  key: keyof MonthProfit | 'marginRate';
  label: string;
  /** 이번 달 − 지난달 */
  delta: number;
}

export interface MonthProfitRow extends MonthProfit {
  marginRate: number;
  hasData: boolean;
  prevMonth: string | null;
  /** 지난달 대비. 지난달 자료가 없으면 null */
  salesDelta: number | null;
  profitDelta: number | null;
  marginRateDelta: number | null;
  /**
   * 순이익이 줄었을 때 가장 크게 늘어난 비용, 늘었을 때 가장 크게 늘어난 매출.
   * 다음 달에 어디를 손댈지 정해 준다.
   */
  driver: Delta | null;
}

/** 순이익을 깎는 항목들 — 늘어나면 나쁜 쪽이다 */
const COST_KEYS: Array<{ key: keyof MonthProfit; label: string }> = [
  { key: 'adCost', label: '광고비' },
  { key: 'couponDiscount', label: '쿠폰' },
  { key: 'commission', label: '수수료' },
  { key: 'unitCost', label: '원가' },
  { key: 'returnCost', label: '반품 배송비' },
];

function marginRateOf(m: MonthProfit): number {
  return m.salesAmount > 0 ? (m.profit / m.salesAmount) * 100 : 0;
}

/**
 * 오래된 달부터 받은 목록을 최근 달이 위로 오게 접는다.
 *
 * 판매가 아예 없는 달도 빼지 않는다. 비어 있는 달이 사라지면 표가 연속으로
 * 보여서, 두 달 쉰 것이 안 보인다.
 */
export function rollupMonths(months: MonthProfit[]): MonthProfitRow[] {
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));

  const rows: MonthProfitRow[] = sorted.map((m, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const hasData = m.quantity > 0 || m.salesAmount > 0;
    // 지난달에 판매가 없었으면 증감이 무의미하다. 0에서 늘어난 것을
    // '개선'이라고 말하면 쉬었다 돌아온 달이 늘 최고의 달이 된다.
    const prevUsable = prev !== null && (prev.quantity > 0 || prev.salesAmount > 0);

    return {
      ...m,
      marginRate: marginRateOf(m),
      hasData,
      prevMonth: prevUsable ? prev!.month : null,
      salesDelta: prevUsable ? m.salesAmount - prev!.salesAmount : null,
      profitDelta: prevUsable ? m.profit - prev!.profit : null,
      marginRateDelta: prevUsable ? marginRateOf(m) - marginRateOf(prev!) : null,
      driver: prevUsable && hasData ? driverOf(m, prev!) : null,
    };
  });

  return rows.reverse();
}

/**
 * 순이익이 움직인 가장 큰 이유 하나.
 *
 * 여러 개를 늘어놓으면 읽는 사람이 다시 고르게 된다. 제일 큰 것 하나만
 * 짚는다. 순이익이 줄었으면 가장 많이 늘어난 비용을, 늘었으면 매출을 본다.
 */
export function driverOf(cur: MonthProfit, prev: MonthProfit): Delta | null {
  const profitDelta = cur.profit - prev.profit;
  // 순이익이 거의 그대로면 원인을 말할 것이 없다.
  if (Math.abs(profitDelta) < Math.max(10000, Math.abs(prev.profit) * 0.02)) return null;

  if (profitDelta < 0) {
    const worst = COST_KEYS
      .map(({ key, label }) => ({ key, label, delta: (cur[key] as number) - (prev[key] as number) }))
      .filter(d => d.delta > 0)
      .sort((a, b) => b.delta - a.delta)[0];
    // 비용이 하나도 안 늘었는데 순이익이 줄었으면 그냥 덜 팔린 것이다
    if (!worst) return { key: 'salesAmount', label: '매출', delta: cur.salesAmount - prev.salesAmount };
    return worst;
  }

  const salesDelta = cur.salesAmount - prev.salesAmount;
  if (salesDelta > 0) return { key: 'salesAmount', label: '매출', delta: salesDelta };
  // 매출은 그대로거나 줄었는데 순이익이 늘었으면 비용을 줄인 것이다
  const saved = COST_KEYS
    .map(({ key, label }) => ({ key, label, delta: (cur[key] as number) - (prev[key] as number) }))
    .filter(d => d.delta < 0)
    .sort((a, b) => a.delta - b.delta)[0];
  return saved ?? null;
}

/**
 * 받침이 있으면 '이', 없으면 '가'.
 *
 * "광고비이(가)"처럼 쓰면 기계가 쓴 티가 난다. 화면에 그대로 나가는 문장이라
 * 조사를 골라 준다.
 */
export function subjectParticle(word: string): '이' | '가' {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  // 한글 음절이 아니면(숫자·영문) 무난한 쪽으로
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return '가';
  return (code - 0xac00) % 28 === 0 ? '가' : '이';
}

/** "광고비가 90만원 늘었습니다" / "매출이 120만원 줄었습니다" */
export function driverSentence(d: Delta | null): string | null {
  if (!d) return null;
  const amount = Math.abs(Math.round(d.delta)).toLocaleString();
  return `${d.label}${subjectParticle(d.label)} ${amount}원 ${d.delta > 0 ? '늘었습니다' : '줄었습니다'}`;
}
