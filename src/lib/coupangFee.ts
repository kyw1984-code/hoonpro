/**
 * 쿠팡 판매수수료율 — 부가세 포함.
 *
 * 판매자가 확인해 준 값은 10.8%(부가세 별도)이고, 우리가 쓰는 자리는 전부
 * 부가세를 포함한 실부담 기준이라 10.8 × 1.1 = 11.88을 쓴다.
 *
 * 이 값이 필요한 이유는 로켓그로스다. 쿠팡은 그로스 주문에 수수료도
 * 정산예정액도 내려주지 않아 우리가 만들어야 한다. 윙은 쿠팡이 준 정산액이
 * 정확하므로 이 값을 쓰지 않는다.
 *
 * 분모는 반드시 '쿠폰을 뺀 실결제액'이다. 주문금액에 곱하면 즉시할인쿠폰을
 * 많이 쓰는 판매자일수록 수수료가 과다하게 잡힌다.
 */
export const COUPANG_FEE_RATE_PCT = 11.88;

/** 실결제액(쿠폰 차감 후)에 붙는 수수료 */
export function coupangCommission(netAmount: number, ratePct = COUPANG_FEE_RATE_PCT): number {
  return Math.round((Math.max(0, netAmount) * ratePct) / 100);
}
