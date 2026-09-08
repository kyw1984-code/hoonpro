/**
 * 부가가치세 계산 — 서버·화면·테스트가 같은 규칙을 쓴다.
 *
 * 요금표의 가격은 공급가액이고, 실제 카드에 청구되는 금액은 여기에 세액을 더한
 * 값이다. 사업자 대상 서비스라 부가세 별도 표기가 관행이고, 구매자는 매입세액으로
 * 공제받는다.
 *
 * 이 계산이 두 곳에 따로 있으면 화면에 보이는 금액과 카드에 찍히는 금액이 어긋난다.
 * 결제 분쟁의 첫 번째 원인이라 한 곳에 둔다.
 */
export const VAT_RATE = 0.1;

export interface Charged {
  /** 공급가액 (요금표에 적히는 값) */
  supply: number;
  /** 부가세 */
  vat: number;
  /** 실제 청구 금액 */
  total: number;
}

/**
 * 공급가액 → 청구 금액.
 *
 * 할인은 이 함수에 넣기 전에 공급가액에서 빼야 한다. 세액을 붙인 뒤 할인하면
 * 세액이 할인 전 금액 기준이 되어 실제보다 많이 걷힌다.
 */
export function withVat(supply: number): Charged {
  const s = Math.max(0, Math.round(supply));
  const vat = Math.round(s * VAT_RATE);
  return { supply: s, vat, total: s + vat };
}
