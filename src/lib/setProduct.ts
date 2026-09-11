/**
 * 'N종 세트'를 알아보고 낱개 가격으로 환산한다.
 *
 * 의류 시장은 세트가 흔하다. 대표님 상품 37개 중 29개가 세트다. 그런데 소싱AI는
 * 상품 가격을 그대로 비교해서, 2종 세트 41,200원과 단품 20,000원을 "비싼 것과
 * 싼 것"으로 읽는다. 실제로는 낱개 20,600원 대 20,000원으로 거의 같은 값이다.
 *
 * 가격이 어긋나면 그 위에 얹은 것이 전부 어긋난다 — 평균가도, 가격 적합도도,
 * 내 가게 기준 점수도. 세트 시장을 분석할 때 이 보정이 없으면 숫자가 통째로
 * 쓸모없어진다.
 *
 * 확신이 서는 표현만 잡는다. 애매하면 1로 둔다. 잘못 나눈 가격은 안 나눈
 * 가격보다 나쁘다 — 틀렸다는 걸 알아챌 방법이 없기 때문이다.
 */

export interface SetInfo {
  /** 몇 개들이인가. 단품이면 1 */
  count: number;
  /** 낱개 가격 */
  unitPrice: number;
  /** 무엇을 보고 그렇게 읽었나 */
  matched: string | null;
}

// 위에서부터 본다. 구체적인 표현이 먼저다.
const PATTERNS: RegExp[] = [
  // "2종 세트", "4종세트", "3종 SET"
  /(\d+)\s*종\s*(?:세트|셋트|set)/i,
  // "2개 세트", "3장 세트", "5매 세트"
  /(\d+)\s*(?:개|장|매|팩|벌)\s*(?:세트|셋트|set)/i,
  // "2종" 단독 — 상품명 끝이나 구분자 앞에서만
  /(\d+)\s*종(?=\s|,|$|\))/,
];

/** 1+1, 2+1 같은 덤 표기 */
const PLUS = /\b(\d+)\s*\+\s*(\d+)\b/;

/** 몇 개들이까지 믿을 것인가. 이보다 크면 낱개 환산이 의미를 잃는다 */
const MAX_COUNT = 12;

export function parseSet(productName: string | null | undefined, price: number): SetInfo {
  const name = String(productName ?? '');
  const p = Math.max(0, Number(price) || 0);
  const plain: SetInfo = { count: 1, unitPrice: p, matched: null };
  if (!name) return plain;

  // 1+1은 2개, 2+1은 3개
  const plus = name.match(PLUS);
  if (plus) {
    const n = Number(plus[1]) + Number(plus[2]);
    if (n >= 2 && n <= MAX_COUNT) {
      return { count: n, unitPrice: Math.round(p / n), matched: plus[0] };
    }
  }

  for (const re of PATTERNS) {
    const m = name.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    // 1종은 세트가 아니고, 너무 큰 수는 사이즈나 모델명일 가능성이 높다
    if (!Number.isFinite(n) || n < 2 || n > MAX_COUNT) continue;
    return { count: n, unitPrice: Math.round(p / n), matched: m[0].trim() };
  }

  return plain;
}

/**
 * 여러 상품의 낱개 가격 중앙값.
 *
 * 평균이 아니라 중앙값이다. 세트를 잘못 읽어 한두 개가 터무니없이 낮게
 * 잡혀도 중앙값은 흔들리지 않는다.
 */
export function medianUnitPrice(items: { productName: string; productPrice: number }[]): number {
  const units = items
    .map(i => parseSet(i.productName, i.productPrice).unitPrice)
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  if (units.length === 0) return 0;
  const mid = Math.floor(units.length / 2);
  return units.length % 2 ? units[mid] : Math.round((units[mid - 1] + units[mid]) / 2);
}
