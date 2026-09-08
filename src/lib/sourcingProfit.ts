/**
 * 소싱 손익 계산 — "이 가격에 팔면 원가가 얼마 이하여야 남나".
 *
 * 키워드 분석은 "검색량이 얼마고 경쟁이 어떤가"까지 답한다. 정작 소싱할 때
 * 필요한 건 "그래서 공장에 얼마를 불러야 하나"인데, 그건 판매자 자신의
 * 수수료율·광고비율·반품률·쿠폰율을 알아야 나온다. 훈프로는 정산AI에 그 값을
 * 실측으로 갖고 있다 — 업계 평균이 아니라 이 판매자의 숫자다.
 *
 * 순서가 중요하다. 쿠폰은 매출에서 먼저 빠지고, 수수료·광고비·반품은 그렇게
 * 남은 실매출에 붙는다. 쿠폰을 나중에 빼면 수수료를 쿠폰 포함 금액에 매기게
 * 되어 원가 상한이 실제보다 높게 나온다 — 밑지는 소싱을 부추기는 방향이다.
 */

/** 판매자의 실측 비율. 전부 실매출(쿠폰 차감 후) 대비다 */
export interface SellerRates {
  /** 쿠팡 판매수수료율 (0~1) */
  commission: number;
  /** 광고비율 (0~1) */
  ad: number;
  /** 반품으로 잃는 비율 (0~1) */
  returns: number;
  /** 판매가 대비 쿠폰 할인율 (0~1) */
  coupon: number;
  /** 이 비율들이 몇 건의 실적에서 나왔는지 — 근거가 얇으면 화면에서 밝힌다 */
  basis: { orders: number; salesAmount: number; from: string; to: string };
}

export interface CostCeiling {
  /** 화면에 보이는 판매가 */
  listPrice: number;
  /** 쿠폰을 뺀 실제로 받는 금액 */
  netPrice: number;
  commission: number;
  adCost: number;
  returnLoss: number;
  /** 목표 순이익 */
  targetProfit: number;
  /** 원가 + 배송비가 이 값 이하여야 목표 이익률을 만족한다. 음수면 불가능 */
  maxCost: number;
  /** 어떤 원가로도 목표를 못 맞추는 시장이면 true */
  impossible: boolean;
}

/**
 * 판매가와 목표 이익률에서 원가 상한을 낸다.
 *
 * @param listPrice   쿠팡에 표시되는 판매가
 * @param rates       판매자 실측 비율
 * @param targetMargin 목표 순이익률 (0~1, 실매출 대비)
 */
export function costCeiling(listPrice: number, rates: SellerRates, targetMargin: number): CostCeiling {
  const list = Math.max(0, Math.round(listPrice));
  // 쿠폰은 판매가에서 먼저 빠진다. 여기서부터가 실제로 손에 들어오는 돈이다.
  const netPrice = Math.round(list * (1 - clamp01(rates.coupon)));

  const commission = Math.round(netPrice * clamp01(rates.commission));
  const adCost = Math.round(netPrice * clamp01(rates.ad));
  const returnLoss = Math.round(netPrice * clamp01(rates.returns));
  const targetProfit = Math.round(netPrice * clamp01(targetMargin));

  const maxCost = netPrice - commission - adCost - returnLoss - targetProfit;
  return {
    listPrice: list,
    netPrice,
    commission,
    adCost,
    returnLoss,
    targetProfit,
    maxCost,
    impossible: maxCost <= 0,
  };
}

/**
 * 원가를 알 때의 실제 순이익률. 계산기 반대 방향이다.
 * 견적을 받아 왔을 때 "이 값이면 되나"를 바로 확인할 수 있어야 한다.
 */
export function marginAt(listPrice: number, unitCost: number, rates: SellerRates): { profit: number; rate: number } {
  const c = costCeiling(listPrice, rates, 0);
  const profit = c.maxCost - Math.max(0, Math.round(unitCost));
  return { profit, rate: c.netPrice > 0 ? profit / c.netPrice : 0 };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(1, n);
}
