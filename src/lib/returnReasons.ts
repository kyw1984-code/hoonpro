/**
 * 반품 사유 분류 — 쿠팡이 준 사유 원문을 "고쳐야 할 것" 단위로 묶는다.
 *
 * 반품 목록을 그냥 보면 한 건씩 흩어져 있어서 무엇을 고쳐야 할지 안 보인다.
 * 같은 상품에서 사이즈 얘기가 스무 번 나왔다면 그건 개별 고객 취향이 아니라
 * 상세페이지에 실측 치수가 없다는 뜻이다. 그 신호를 뽑아내는 게 목적이다.
 *
 * AI를 쓰지 않는다. 쿠팡 반품 사유는 대부분 정해진 문구에서 나오고, 자유
 * 입력도 "사이즈가 작아요"처럼 짧고 단어가 반복된다. 규칙으로 충분히 잡히는
 * 일에 건당 비용을 붙이면 반품이 많은 달에 원가만 늘고 답은 같다.
 *
 * 분류가 애매하면 억지로 밀어 넣지 않고 'other'로 둔다. 잘못 분류된 수치는
 * 없느니만 못하다 — 판매자가 그 숫자를 보고 상세페이지를 고치기 때문이다.
 */

export type ReturnCategory =
  | 'size'        // 사이즈가 안 맞음
  | 'mismatch'    // 색상·소재가 사진과 다름
  | 'defect'      // 불량·파손·오염
  | 'delivery'    // 배송 지연·분실·오배송
  | 'changed'     // 단순 변심
  | 'duplicate'   // 잘못 주문·중복 주문
  | 'other';

export interface CategoryMeta {
  key: ReturnCategory;
  label: string;
  /** 판매자가 손을 댈 수 있는 문제인가 — 변심은 손댈 게 없다 */
  actionable: boolean;
  /** 이 유형이 많을 때 무엇을 하면 되는지 */
  advice: string;
}

export const RETURN_CATEGORIES: CategoryMeta[] = [
  {
    key: 'size',
    label: '사이즈',
    actionable: true,
    advice: '상세페이지에 실측 치수표와 "평소 M을 입으면 L" 같은 기준을 넣으면 줄어듭니다.',
  },
  {
    key: 'mismatch',
    label: '사진과 다름',
    actionable: true,
    advice: '대표 이미지의 색 보정을 줄이고, 실제 조명에서 찍은 사진을 한 장 넣어 보세요.',
  },
  {
    key: 'defect',
    label: '불량·파손',
    actionable: true,
    advice: '입고 검수와 포장을 점검할 구간입니다. 같은 옵션에 몰려 있으면 그 생산분 문제입니다.',
  },
  {
    key: 'delivery',
    label: '배송 문제',
    actionable: true,
    advice: '오배송이면 옵션 라벨을, 지연이면 재고 위치를 점검하세요.',
  },
  {
    key: 'changed',
    label: '단순 변심',
    actionable: false,
    advice: '판매자가 줄이기 어려운 유형입니다. 비율이 정상 범위면 신경 쓰지 않아도 됩니다.',
  },
  {
    key: 'duplicate',
    label: '주문 실수',
    actionable: false,
    advice: '옵션명이 헷갈리면 늘어납니다. 옵션 이름이 서로 구분되는지만 확인해 보세요.',
  },
  { key: 'other', label: '기타', actionable: false, advice: '' },
];

export const CATEGORY_LABEL: Record<ReturnCategory, string> = Object.fromEntries(
  RETURN_CATEGORIES.map(c => [c.key, c.label]),
) as Record<ReturnCategory, string>;

/**
 * 규칙은 위에서부터 본다. 먼저 걸리는 쪽이 이긴다.
 *
 * 순서가 중요하다. "색상이 달라 반품합니다"에는 '반품'도 들어 있지만 답은
 * 색상이다. 구체적인 원인을 위에, 뭉뚱그린 표현을 아래에 둔다.
 */
const RULES: { category: ReturnCategory; patterns: RegExp }[] = [
  // 오배송은 '다른 상품이 왔다'는 뜻이라 배송 쪽이다. '다르다'만 보고
  // 사진 불일치로 보내면 안 되므로 색상·소재보다 먼저 본다.
  // 사이에 말이 끼는 게 보통이다 — "배송이 너무 지연돼서"처럼. \s*로만 붙이면
  // 실제 사유의 대부분을 놓친다.
  { category: 'delivery', patterns: /오배송|미배송|배송사고|다른\s*(상품|제품|물건)|잘못\s*(배송|발송|왔|보내)|(배송|발송|도착|택배)[^\n]{0,12}(지연|늦|누락|분실|안\s*(옴|와|됨)|못\s*받)/ },

  { category: 'size', patterns: /사이즈|싸이즈|치수|사이스|크기가|작아|작음|작게|크다|커요|큼|헐렁|끼|타이트|길이가|짧|길어/ },

  { category: 'mismatch', patterns: /색상|색깔|컬러|재질|소재|材質|사진과\s*다|이미지와\s*다|화면과\s*다|실물|설명과\s*다|상세(페이지)?와\s*다|생각(과|했던\s*것과)\s*다|기대와\s*다/ },

  { category: 'defect', patterns: /불량|파손|破損|하자|고장|찢|뜯|오염|얼룩|냄새|이염|올\s*나감|터짐|깨|흠집|스크래치|작동\s*(안|불)|누락된\s*부품|부품\s*누락|유통기한|변질/ },

  { category: 'duplicate', patterns: /중복\s*(주문|구매)|주문\s*(실수|착오|잘못)|잘못\s*(주문|구매|선택)|옵션\s*(잘못|실수)|취소\s*요청/ },

  // 변심은 가장 넓은 그물이라 맨 아래에 둔다
  { category: 'changed', patterns: /변심|단순변심|필요\s*없|필요없|맘에\s*안|마음에\s*안|안\s*들어|취향|다른\s*곳에서\s*(더\s*)?(싸|저렴)|더\s*싼|구매의사\s*없|안\s*쓸/ },
];

/**
 * 사유 한 줄을 분류한다. 못 알아보면 'other'.
 *
 * 쿠팡은 사유를 "CHANGE_MIND" 같은 코드로 줄 때도, 한글 문장으로 줄 때도
 * 있어서 둘 다 받는다.
 */
export function classifyReturnReason(raw: string | null | undefined): ReturnCategory {
  if (!raw) return 'other';
  const text = String(raw).trim();
  if (!text) return 'other';

  // 쿠팡이 영문 코드로 주는 경우 — 문장 규칙에 걸리지 않으므로 먼저 본다
  const code = text.toUpperCase().replace(/[\s_-]/g, '');
  if (/CHANGEMIND|CUSTOMERCHANGE|SIMPLECHANGE/.test(code)) return 'changed';
  if (/WRONGDELIVERY|MISDELIVERY|DELIVERYDELAY|NOTDELIVERED|LOST/.test(code)) return 'delivery';
  if (/DEFECT|DAMAGE|BROKEN|FAULT(?!Y?CUSTOMER)|QUALITY/.test(code)) return 'defect';
  if (/SIZE/.test(code)) return 'size';
  if (/COLOR|COLOUR|DIFFERENT(FROM)?(IMAGE|DESCRIPTION)|NOTASDESCRIBED/.test(code)) return 'mismatch';
  if (/DUPLICATE|WRONGORDER|ORDERMISTAKE/.test(code)) return 'duplicate';

  for (const rule of RULES) {
    if (rule.patterns.test(text)) return rule.category;
  }
  return 'other';
}

export interface ReasonCount {
  category: ReturnCategory;
  label: string;
  count: number;
  quantity: number;
  /** 전체 반품 중 비중 (0~1) */
  share: number;
  actionable: boolean;
  advice: string;
  /** 이 유형으로 묶인 사유 원문 몇 개 — 분류가 맞는지 판매자가 눈으로 확인한다 */
  samples: string[];
}

export interface ReturnLike {
  reason?: string | null;
  quantity?: number | null;
  fault?: string | null;
}

/**
 * 반품 목록을 유형별로 센다.
 *
 * 건수와 수량을 함께 센다. 한 건에 3개를 반품한 것과 세 사람이 한 개씩
 * 반품한 것은 손실은 같아도 뜻이 다르다 — 뒤쪽이 상품 문제에 가깝다.
 */
export function summarizeReturnReasons(rows: ReturnLike[]): {
  total: number;
  totalQuantity: number;
  /** 판매자 귀책으로 기록된 건수 */
  sellerFault: number;
  categories: ReasonCount[];
} {
  const buckets = new Map<ReturnCategory, { count: number; quantity: number; samples: string[] }>();
  let totalQuantity = 0;
  let sellerFault = 0;

  for (const r of rows) {
    const category = classifyReturnReason(r.reason);
    const qty = Math.max(1, Number(r.quantity) || 1);
    totalQuantity += qty;
    if (String(r.fault ?? '').toUpperCase() === 'COMPANY') sellerFault++;

    const b = buckets.get(category) ?? { count: 0, quantity: 0, samples: [] };
    b.count++;
    b.quantity += qty;
    const sample = String(r.reason ?? '').trim();
    // 같은 문구가 반복되면 표본으로서 값이 없다
    if (sample && b.samples.length < 3 && !b.samples.includes(sample)) b.samples.push(sample);
    buckets.set(category, b);
  }

  const total = rows.length;
  const categories = RETURN_CATEGORIES
    .map(meta => {
      const b = buckets.get(meta.key);
      if (!b) return null;
      return {
        category: meta.key,
        label: meta.label,
        count: b.count,
        quantity: b.quantity,
        share: total > 0 ? b.count / total : 0,
        actionable: meta.actionable,
        advice: meta.advice,
        samples: b.samples,
      };
    })
    .filter((c): c is ReasonCount => c !== null)
    .sort((a, b) => b.count - a.count);

  return { total, totalQuantity, sellerFault, categories };
}
