/**
 * 1688 매입의 개당 입고 원가.
 *
 * 위안 단가 × 수량에 중국 내 배송비를 더해 환율을 곱하고, 원화로 나가는
 * 배대지비·관세·기타를 더한 뒤 수량으로 나눈다. 수입부가세는 일반과세자면
 * 매입세액으로 돌려받는 돈이라 기본은 원가에서 뺀다. 간이과세자처럼 못
 * 돌려받으면 includeVat을 켠다.
 */
export interface PurchaseInput {
  qty: number;
  unitPriceCny: number;
  /** 원/위안 */
  fxRate: number;
  domesticShipCny: number;
  intlShipKrw: number;
  customsKrw: number;
  vatKrw: number;
  otherKrw: number;
  includeVat: boolean;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 이 매입에 들어간 원화 총액 */
export function landedTotal(p: PurchaseInput): number {
  const cny = n(p.unitPriceCny) * Math.max(0, n(p.qty)) + n(p.domesticShipCny);
  const krw = cny * n(p.fxRate) + n(p.intlShipKrw) + n(p.customsKrw) + n(p.otherKrw) + (p.includeVat ? n(p.vatKrw) : 0);
  return Math.max(0, Math.round(krw));
}

/** 개당 입고 원가. 수량이 0이면 0 */
export function landedUnit(p: PurchaseInput): number {
  const qty = Math.max(0, n(p.qty));
  if (qty === 0) return 0;
  return Math.round(landedTotal(p) / qty);
}

/**
 * 여러 번 매입한 옵션의 가중평균 원가 = 총액 ÷ 총수량.
 * 매입마다 환율과 배송비가 달라 단순 평균은 틀린다.
 */
export function weightedUnitCost(list: PurchaseInput[]): number | null {
  let total = 0;
  let qty = 0;
  for (const p of list) {
    const q = Math.max(0, n(p.qty));
    if (q === 0) continue;
    total += landedTotal(p);
    qty += q;
  }
  return qty > 0 ? Math.round(total / qty) : null;
}
