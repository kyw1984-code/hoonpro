/**
 * 정산서 대조 — 우리가 계산한 정산예정액이 실제 지급액과 맞는지 본다.
 *
 * 이게 필요한 이유는 로켓그로스다. 윙은 쿠팡이 준 정산예정액을 그대로 쓰지만,
 * 그로스는 쿠팡이 수수료도 정산액도 주지 않아 우리가 만든다. 만드는 쪽이
 * 틀리면 순이익이 조용히 부풀고, 판매자는 몇 달 뒤 통장을 보고서야 안다.
 * 실제로 즉시할인쿠폰을 빼지 않아 순이익이 크게 부풀어 있던 적이 있다.
 *
 * 여기서 쓰는 기준선은 둘이다.
 *   1) 쿠팡 지급내역 API가 내려준 인식월별 지급액 — 자동으로 들어온다
 *   2) 판매자가 정산서를 보고 직접 적어 넣은 실지급액 — 있으면 이쪽이 우선이다
 *
 * 차이를 그대로 '오류'라고 부르지 않는다. 반품 차감, 판매장려금, 지연 지급이
 * 섞여 있기 때문이다. 대신 '이 정도면 맞다 / 한 번 보시라 / 어긋났다'로만
 * 나누고, 어긋났을 때 그로스 수수료율을 몇 %로 봐야 맞는지 역산해 준다.
 */

/** 이 안쪽이면 맞은 것으로 본다 (%) */
export const OK_RATE = 1;
/** 여기를 넘으면 어긋난 것으로 본다 (%) */
export const OFF_RATE = 5;

export interface MonthFigures {
  /** 매출인식월 YYYY-MM */
  month: string;
  /** 윙 정산예정액 — 쿠팡이 준 값 */
  marketSettlement: number;
  /** 그로스 정산예정액 — 우리가 만든 값 */
  growthSettlement: number;
  /** 그로스 실결제액(쿠폰 차감 후) = 정산예정액 + 수수료. 역산의 분모다 */
  growthNet: number;
  /** 쿠팡 지급내역 API가 이 인식월로 내려준 금액 합 (없으면 null) */
  coupangPaid: number | null;
  /** 판매자가 정산서를 보고 적어 넣은 실지급액 (없으면 null) */
  actual: number | null;
  /** 이 달 반품 수량 — 차이의 흔한 원인이라 함께 보여 준다 */
  returnQuantity: number;
}

export type Verdict = 'ok' | 'watch' | 'off' | 'unknown';

export interface MonthCheck extends MonthFigures {
  /** 우리 계산 합 */
  ours: number;
  /** 비교 기준이 된 금액 */
  reference: number | null;
  referenceSource: 'actual' | 'coupang' | null;
  /** 기준 − 우리 계산. 양수면 실제로 더 들어왔다는 뜻이다 */
  diff: number | null;
  /** 차이 ÷ 기준 (%) */
  diffRate: number | null;
  /**
   * 차이를 전부 그로스 수수료율 탓으로 돌렸을 때 나오는 요율 (%).
   * 0~40% 밖이면 수수료로 설명되지 않는다는 뜻이라 null이다.
   */
  impliedGrowthFeeRate: number | null;
  verdict: Verdict;
}

export function checkMonth(f: MonthFigures): MonthCheck {
  const ours = Math.round(f.marketSettlement + f.growthSettlement);
  const reference = f.actual !== null ? f.actual : f.coupangPaid;
  const referenceSource: MonthCheck['referenceSource'] =
    f.actual !== null ? 'actual' : f.coupangPaid !== null ? 'coupang' : null;

  if (reference === null || reference <= 0) {
    return {
      ...f, ours, reference: null, referenceSource: null,
      diff: null, diffRate: null, impliedGrowthFeeRate: null, verdict: 'unknown',
    };
  }

  const diff = reference - ours;
  const diffRate = (diff / reference) * 100;
  const abs = Math.abs(diffRate);
  const verdict: Verdict = abs < OK_RATE ? 'ok' : abs < OFF_RATE ? 'watch' : 'off';

  // 역산: 윙은 쿠팡이 준 값이라 맞다고 두고, 남는 몫을 전부 그로스로 본다.
  //   실제 그로스 정산액 = 기준 − 윙 정산액
  //   정산액 = 실결제액 × (1 − 요율)  →  요율 = 1 − 정산액 ÷ 실결제액
  let implied: number | null = null;
  if (f.growthNet > 0) {
    const growthActual = reference - f.marketSettlement;
    const rate = (1 - growthActual / f.growthNet) * 100;
    // 음수(수수료가 없다는 뜻)나 40% 초과는 수수료로 설명되지 않는다.
    // 반품 차감이나 지급 지연이 섞였다고 보는 편이 맞다.
    if (rate >= 0 && rate <= 40) implied = Math.round(rate * 100) / 100;
  }

  return {
    ...f, ours, reference, referenceSource,
    diff, diffRate: Math.round(diffRate * 100) / 100,
    impliedGrowthFeeRate: implied, verdict,
  };
}

/** 화면과 메일에서 같은 말을 쓰도록 한 곳에 둔다 */
export function verdictLabel(v: Verdict): string {
  return v === 'ok' ? '맞습니다'
    : v === 'watch' ? '한 번 보세요'
    : v === 'off' ? '어긋났습니다'
    : '기준 없음';
}
