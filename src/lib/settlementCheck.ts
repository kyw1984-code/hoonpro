/**
 * 정산서 대조 — 우리가 계산한 정산예정액이 쿠팡이 잡은 금액과 맞는지 본다.
 *
 * 이 파일을 읽기 전에 알아야 할 두 가지가 있다. 둘 다 실제 자료를 파 보고
 * 알아낸 것이고, 모르는 채로 만들었을 때 화면이 통째로 틀렸었다.
 *
 * 1) 쿠팡 지급내역(settlement-histories)에는 판매자배송(윙)만 들어온다.
 *    로켓그로스는 한 건도 없다. 그로스 매출이 477만 원인 달의 지급내역
 *    totalSale이 112만 원이고, 그 112만은 같은 달 윙 매출(108만)과 맞는다.
 *    그래서 자동 기준과 견줄 수 있는 것은 윙뿐이다. 윙+그로스 합계를
 *    견주면 매달 몇 배씩 어긋난 것처럼 보인다 — 실제로 그랬다.
 *
 * 2) RESERVE 유형 행은 그 달 WEEKLY 행들을 통째로 다시 적은 것이다.
 *    settlementTargetAmount·lastAmount·settlementAmount가 모두 그 달
 *    WEEKLY 합과 정확히 같다. 그 날 실제로 들어오는 돈은 lastAmount(최종액)
 *    뿐이다. 그래서 정산대상액을 셀 때 RESERVE를 함께 더하면 딱 두 배가 된다.
 *    (이 판정은 isReserveSettlement 한 곳에 둔다.)
 *
 * 그래서 이 화면이 실제로 하는 일은 둘이다.
 *   - 자동: 윙 정산예정액 vs 쿠팡 정산대상액. 어긋나면 매출 수집이 빠진 것이다.
 *   - 수동: 판매자가 정산서 금액을 적어 넣으면 윙+그로스 전체로 견준다.
 *     로켓그로스를 확인할 수 있는 길은 지금 이것뿐이다.
 *
 * 차이를 그대로 '오류'라고 부르지 않는다. 반품 차감, 판매장려금, 지급 지연이
 * 섞여 있기 때문이다. 대신 '이 정도면 맞다 / 한 번 보시라 / 어긋났다'로만
 * 나누고, 전체로 견준 달에 한해 그로스 수수료율을 몇 %로 봐야 맞는지 역산한다.
 */

/** 이 안쪽이면 맞은 것으로 본다 (%) */
export const OK_RATE = 1;
/** 여기를 넘으면 어긋난 것으로 본다 (%) */
export const OFF_RATE = 5;

/**
 * RESERVE 행인가 — 그 달 WEEKLY를 다시 적은 요약 행.
 *
 * 정산대상액을 셀 때는 빼야 하고(빼지 않으면 두 배), 캘린더에서는 이 날
 * 들어오는 돈이 settlementAmount가 아니라 lastAmount다. 두 곳이 서로 다른
 * 기준으로 판정하면 한쪽만 고쳐질 수 있어 한 곳에 둔다.
 */
export function isReserveSettlement(type: unknown): boolean {
  return String(type ?? '').toUpperCase().includes('RESERVE');
}

export interface MonthFigures {
  /** 매출인식월 YYYY-MM */
  month: string;
  /**
   * 윙 매출 자료를 그 달 1일부터 갖고 있나.
   *
   * 쿠팡 지급내역은 120일을 주는데 매출 수집은 그보다 늦게 시작된 계정이 있다.
   * 자료가 반만 있는 달을 견주면 '어긋났습니다'가 뜨지만 어긋난 게 아니다.
   * 자동 기준이 윙만 담고 있으므로 여기서 보는 것도 윙 자료다.
   */
  salesCovered: boolean;
  /**
   * 쿠팡이 그 달 매출 인식을 끝냈나.
   *
   * 그 달 행들의 매출인식 종료일이 말일까지 닿았는지로 본다. 쿠팡이 스스로
   * '이 달은 여기까지 인식했다'고 적어 주는 값이라 달력으로 어림하는 것보다
   * 정확하다. 8월 31일에 팔린 것이 9월에 구매확정되면 9월 매출로 잡히므로,
   * 달이 지났다고 바로 끝난 것이 아니다.
   */
  recognitionComplete: boolean;
  /** 아직 지급일이 안 온 최종액(30%) — RESERVE 행 기준 */
  pendingLast: number;
  /** 윙 정산예정액 — 쿠팡이 준 값 */
  marketSettlement: number;
  /** 그로스 정산예정액 — 우리가 만든 값 */
  growthSettlement: number;
  /** 그로스 실결제액(쿠폰 차감 후) = 정산예정액 + 수수료. 역산의 분모다 */
  growthNet: number;
  /**
   * 쿠팡이 잡은 정산대상액 합 (수수료 차감 후, 최종액 포함, RESERVE 제외).
   *
   * 통장에 들어온 금액이 아니라 '이 달 매출로 정산될 총액'이다. 우리가 계산한
   * 정산예정액과 같은 성격이라 이것끼리 견줘야 맞다. 들어온 돈(70%)과 견주면
   * 매달 30%씩 어긋난 것처럼 보인다.
   *
   * 다시 적어 둔다 — 이 값에는 로켓그로스가 없다. 윙뿐이다.
   */
  coupangPaid: number | null;
  /** 판매자가 정산서를 보고 적어 넣은 실지급액 (없으면 null) */
  actual: number | null;
  /** 이 달 반품 수량 — 차이의 흔한 원인이라 함께 보여 준다 */
  returnQuantity: number;
}

/**
 * pending — 아직 견줄 때가 아니다 (매출 자료가 모자라거나 쿠팡 인식이 안 끝남).
 * unknown — 견줄 기준 자체가 없다 (지급내역도 입력값도 없음).
 */
export type Verdict = 'ok' | 'watch' | 'off' | 'unknown' | 'pending';

/**
 * 무엇끼리 견줬나.
 *   market — 윙만 (자동 기준인 쿠팡 지급내역에 그로스가 없어서)
 *   all    — 윙 + 그로스 (판매자가 적어 넣은 정산서 금액이 기준일 때)
 */
export type CheckScope = 'market' | 'all';

export interface MonthCheck extends MonthFigures {
  /** 무엇끼리 견줬나 */
  scope: CheckScope;
  /** 우리 계산 — scope에 맞춘 합 */
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
   * 윙만 견준 달(scope='market')에는 그로스가 아예 안 들어가 있어 늘 null이다.
   */
  impliedGrowthFeeRate: number | null;
  verdict: Verdict;
}

export function checkMonth(f: MonthFigures): MonthCheck {
  const reference = f.actual !== null ? f.actual : f.coupangPaid;
  const referenceSource: MonthCheck['referenceSource'] =
    f.actual !== null ? 'actual' : f.coupangPaid !== null ? 'coupang' : null;

  // 기준이 무엇이냐에 따라 견주는 범위가 달라진다. 쿠팡 지급내역은 윙만
  // 담고 있으므로 윙끼리, 판매자가 적어 넣은 정산서 금액은 전체이므로
  // 윙+그로스로 견딘다. 이걸 섞으면 매달 몇 배씩 어긋나 보인다.
  const scope: CheckScope = referenceSource === 'actual' ? 'all' : 'market';
  const ours = Math.round(
    scope === 'all' ? f.marketSettlement + f.growthSettlement : f.marketSettlement
  );

  if (reference === null || reference <= 0) {
    return {
      ...f, scope, ours, reference: null, referenceSource: null,
      diff: null, diffRate: null, impliedGrowthFeeRate: null, verdict: 'unknown',
    };
  }

  // 견줄 수 없는 달은 판정하지 않는다. 매출 자료가 반만 있거나 쿠팡 쪽
  // 인식이 안 끝난 달에 '어긋났습니다'를 띄우면, 진짜 어긋난 달이 그 속에
  // 묻힌다. 판매자가 직접 적어 넣은 정산서 금액은 그 자체로 완결이라
  // 이 제한을 받지 않는다.
  if (f.actual === null && (!f.salesCovered || !f.recognitionComplete)) {
    return {
      ...f, scope, ours, reference, referenceSource,
      diff: reference - ours, diffRate: null,
      impliedGrowthFeeRate: null, verdict: 'pending',
    };
  }

  const diff = reference - ours;
  const diffRate = (diff / reference) * 100;
  const abs = Math.abs(diffRate);
  const verdict: Verdict = abs < OK_RATE ? 'ok' : abs < OFF_RATE ? 'watch' : 'off';

  // 역산: 윙은 쿠팡이 준 값이라 맞다고 두고, 남는 몫을 전부 그로스로 본다.
  //   실제 그로스 정산액 = 기준 − 윙 정산액
  //   정산액 = 실결제액 × (1 − 요율)  →  요율 = 1 − 정산액 ÷ 실결제액
  // 윙만 견준 달에는 기준에 그로스가 없으므로 이 계산을 하면 안 된다.
  let implied: number | null = null;
  if (scope === 'all' && f.growthNet > 0) {
    const growthActual = reference - f.marketSettlement;
    const rate = (1 - growthActual / f.growthNet) * 100;
    // 음수(수수료가 없다는 뜻)나 40% 초과는 수수료로 설명되지 않는다.
    // 반품 차감이나 지급 지연이 섞였다고 보는 편이 맞다.
    if (rate >= 0 && rate <= 40) implied = Math.round(rate * 100) / 100;
  }

  return {
    ...f, scope, ours, reference, referenceSource,
    diff, diffRate: Math.round(diffRate * 100) / 100,
    impliedGrowthFeeRate: implied, verdict,
  };
}

/** 화면과 메일에서 같은 말을 쓰도록 한 곳에 둔다 */
export function verdictLabel(v: Verdict): string {
  return v === 'ok' ? '맞습니다'
    : v === 'watch' ? '한 번 보세요'
    : v === 'off' ? '어긋났습니다'
    : v === 'pending' ? '집계 중'
    : '기준 없음';
}
