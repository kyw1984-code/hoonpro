/**
 * 광고비가 며칠째 비어 있나 — 순이익이 얼마나 부풀려져 있나.
 *
 * 쿠팡 광고센터에는 공개 API가 없어서 광고비만은 판매자가 즐겨찾기를 눌러
 * 가져와야 한다. 그 한 번을 잊으면 그날부터 순이익이 광고비만큼 크게 나온다.
 * 화면에는 경고가 있지만 순이익 탭을 열어야 보이고, 안 열면 부풀려진 숫자를
 * 그대로 믿게 된다.
 *
 * 그래서 매일 아침 브리핑에서 말한다. 다만 조건이 있다.
 *
 *  · 어제 하루가 빈 건 정상이다. 어제 아침에 눌렀다면 그제까지만 들어와 있다.
 *    그걸 매일 잡으면 제대로 쓰는 사람에게 매일 잔소리하는 꼴이 된다.
 *  · 매출이 없던 날은 광고비도 없는 게 맞다. 쉬는 날까지 세면 안 된다.
 *
 * 부풀려진 금액을 함께 말한다. "3일 비었습니다"보다 "순이익이 19만원쯤 크게
 * 나옵니다"가 사람을 움직인다.
 */

/** 며칠부터 알릴까 — 어제 하루는 정상 운영에서도 늘 비어 있다 */
export const AD_GAP_NAG_DAYS = 2;

export interface AdGapInput {
  /** 광고비가 들어와 있는 마지막 날 (YYYY-MM-DD). 한 번도 없으면 null */
  lastAdDate: string | null;
  /** 브리핑이 말하는 날 = 어제 (YYYY-MM-DD) */
  through: string;
  /** 빈 구간에서 매출이 있었던 날짜들 */
  salesDatesInGap: string[];
  /** 최근 평균 일 광고비 (원). 모르면 0 */
  dailyAverage: number;
}

export interface AdGap {
  lastAdDate: string | null;
  /** 어제까지 광고비가 비어 있는 날 수 */
  missingDays: number;
  /** 그중 실제로 매출이 있던 날 수 — 부풀려진 날은 이쪽이다 */
  missingWithSales: number;
  /** 그만큼 순이익이 크게 나온 금액 (추정) */
  overstatedBy: number;
  /** 브리핑에서 말할 만한가 */
  shouldWarn: boolean;
  /** 광고비를 한 번도 가져온 적이 없다 */
  never: boolean;
}

function daysBetweenUtc(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function adCostGap(input: AdGapInput): AdGap {
  const { lastAdDate, through, salesDatesInGap, dailyAverage } = input;

  // 한 번도 안 가져온 경우. 매출이 있는데 광고비가 통째로 없으면 알린다.
  if (!lastAdDate) {
    const withSales = new Set(salesDatesInGap).size;
    return {
      lastAdDate: null,
      missingDays: withSales,
      missingWithSales: withSales,
      overstatedBy: 0,          // 평균을 낼 근거가 없으니 금액은 지어내지 않는다
      shouldWarn: withSales >= AD_GAP_NAG_DAYS,
      never: true,
    };
  }

  const missingDays = Math.max(0, daysBetweenUtc(lastAdDate, through));
  // 빈 구간 밖의 날짜가 섞여 들어와도 세지 않는다
  const withSales = new Set(
    salesDatesInGap.filter(d => d > lastAdDate && d <= through),
  ).size;

  const avg = Number.isFinite(dailyAverage) && dailyAverage > 0 ? dailyAverage : 0;

  return {
    lastAdDate,
    missingDays,
    missingWithSales: withSales,
    overstatedBy: Math.round(avg * withSales),
    shouldWarn: withSales >= AD_GAP_NAG_DAYS,
    never: false,
  };
}
