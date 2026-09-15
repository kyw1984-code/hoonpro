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

/** 옵션 하나의 마진 — 광고 보고서의 줄마다 제 옵션 값을 쓰기 위한 것 */
export interface OptionMargin {
  vendorItemId: string;
  netUnitPrice: number;
  netUnitMargin: number;
  /** 마진 ÷ 실결제가. 실측 전환매출에 곱해 순이익을 낸다 */
  netMarginRate: number;
}

export interface PresetItem {
  vendorItemId: string;
  unitPrice?: number;
  couponPerUnit?: number;
  unitCost?: number;
  fulfillmentCost?: number;
  returnRate?: number;
  returnShippingCost?: number;
  hasCost?: boolean;
}

/**
 * 옵션별 마진표.
 *
 * 광고 보고서 한 장에 옵션이 여럿 들어 있는 것이 보통인데, 마진 계산 칸은
 * 하나뿐이다. 3,000원짜리와 30,000원짜리를 같은 마진으로 계산하면 옵션별
 * 순이익이 통째로 틀리고, 그 값으로 키워드를 제외하게 된다.
 *
 * 원가가 없는 옵션은 아예 넣지 않는다. 원가 0으로 계산하면 마진이 판매가만큼
 * 나와서, 원가를 안 넣은 옵션일수록 제일 돈을 잘 버는 것처럼 보인다.
 */
export function optionMarginTable(items: PresetItem[], feeRate: number): Map<string, OptionMargin> {
  const out = new Map<string, OptionMargin>();
  for (const it of items ?? []) {
    const id = String(it.vendorItemId ?? '').trim();
    if (!id) continue;
    const unitCost = Number(it.unitCost) || 0;
    if (!it.hasCost || unitCost <= 0) continue;

    const netUnitPrice = Math.max(0, (Number(it.unitPrice) || 0) - (Number(it.couponPerUnit) || 0));
    if (netUnitPrice <= 0) continue;

    const m = computeMargin({
      netUnitPrice,
      unitCost,
      deliveryFee: Number(it.fulfillmentCost) || 0,
      feeRate,
      returnRate: Number(it.returnRate) || 0,
      returnShippingCost: Number(it.returnShippingCost) || 0,
    });
    out.set(id, {
      vendorItemId: id,
      netUnitPrice,
      netUnitMargin: m.netMargin,
      netMarginRate: m.netMargin / netUnitPrice,
    });
  }
  return out;
}
