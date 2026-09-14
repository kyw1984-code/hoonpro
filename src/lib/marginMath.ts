/**
 * 개당 마진과 손익분기 ROAS.
 *
 * 광고분석AI의 모든 판단(입찰 조절, 키워드 제외, 최대 CPC)이 이 숫자 위에
 * 서 있다. 화면 여기저기에 같은 식을 흩어 두면 한 곳만 고쳐지고 같은 화면이
 * 서로 다른 마진을 보여 준다. 그래서 한 곳에 둔다.
 *
 * 반품을 넣는 이유: 반품률 5%짜리 상품은 100개를 팔아도 95개치 마진만
 * 남고, 그 5개에는 반품 배송비까지 나간다. 반품을 빼고 잡은 손익분기 ROAS로
 * 광고를 돌리면 화면은 흑자인데 통장은 적자다.
 */

export interface MarginInput {
  /** 고객 실결제가 = 판매가 − 즉시할인쿠폰 */
  netUnitPrice: number;
  /** 매입 + 부자재 + 출고 택배비 */
  unitCost: number;
  /** 로켓그로스 입출고비 */
  deliveryFee: number;
  /** 쿠팡 수수료율 (부가세 포함, %) */
  feeRate: number;
  /** 반품률 (%) — 판매 수량 대비 */
  returnRate?: number;
  /** 반품 1건에 판매자가 부담하는 배송비 */
  returnShippingCost?: number;
}

export interface MarginResult {
  /** 실결제가에 붙는 수수료 */
  fee: number;
  /** 반품을 빼기 전 개당 마진 */
  grossMargin: number;
  /** 판매 1건에 평균적으로 묻어 나가는 반품 손실 */
  returnLoss: number;
  /** 반품까지 반영한 개당 마진 — 광고 판단은 이 값으로 한다 */
  netMargin: number;
  /** 마진율 (%) */
  marginRate: number;
  /** 손익분기 ROAS (%) — 0이면 마진이 없어 계산할 수 없다는 뜻이다 */
  breakEvenROAS: number;
}

/** 반품률은 비율이라 0~90%로 자른다. 100%를 넣으면 아래 식이 무너진다 */
export function clampReturnRate(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(90, pct) / 100;
}

export function computeMargin(i: MarginInput): MarginResult {
  const net = Math.max(0, Math.round(i.netUnitPrice));
  const fee = Math.round((net * (Number(i.feeRate) || 0)) / 100);
  const grossMargin = Math.round(net - (Number(i.unitCost) || 0) - (Number(i.deliveryFee) || 0) - fee);

  const r = clampReturnRate(Number(i.returnRate) || 0);
  const returnShip = Math.max(0, Number(i.returnShippingCost) || 0);
  // 반품 1건은 그 건의 마진을 잃고(못 벌고) 반품 배송비까지 나간다.
  // 상품 자체는 재입고되는 것으로 본다 — 폐기까지 가정하면 원가만큼 더 빠지지만,
  // 폐기율은 우리가 알 수 없어서 지어내지 않는다.
  const returnLoss = Math.round(r * (grossMargin + returnShip));
  const netMargin = grossMargin - returnLoss;

  return {
    fee,
    grossMargin,
    returnLoss,
    netMargin,
    marginRate: net > 0 ? (netMargin / net) * 100 : 0,
    // 마진이 0 이하면 어떤 ROAS로도 흑자가 안 된다. 0을 돌려 '계산 불가'를 알린다.
    breakEvenROAS: netMargin > 0 ? (net / netMargin) * 100 : 0,
  };
}
