/**
 * 검색 결과에 섞여 들어온 다른 상품군을 가려낸다.
 *
 * 쿠팡 검색은 카테고리를 가리지 않는다. "검정치마"를 치면 치마와 함께 밴드
 * 검정치마의 3집 CD가 나오고, 그게 점수까지 받아 순위 추적에 들어갔다.
 * 실제로 대표님 계정에서 그런 일이 있었다.
 *
 * 이런 상품은 리뷰가 많아 수요 점수가 높고 로켓이 아니라 진입 점수도 높다.
 * 즉 점수가 잘못된 방향으로 후해진다. 소싱 후보 맨 위에 CD가 올라온다.
 *
 * 지우지는 않는다. 판매자가 "왜 이게 빠졌지"를 확인할 수 있어야 하고,
 * 가끔은 규칙이 틀리기 때문이다. 표시만 하고 점수 순위에서 내린다.
 */

export type OffCategory = 'media' | 'book' | 'ticket' | 'digital' | 'food' | 'service';

export interface OffCategoryHit {
  category: OffCategory;
  label: string;
  /** 무엇을 보고 그렇게 판단했나 — 판매자가 규칙을 못 믿을 때 확인할 근거 */
  matched: string;
}

const RULES: { category: OffCategory; label: string; patterns: RegExp }[] = [
  // 음반·영상. "3집", "OST", "(CD)"처럼 상품명에 형식이 드러난다.
  {
    category: 'media',
    label: '음반·영상',
    patterns: /\((?:CD|DVD|LP|블루레이)\)|\b(?:CD|DVD|LP)\b|블루레이|바이닐|\d+집\b|정규\s?\d+집|미니앨범|싱글앨범|OST\b|앨범\s*\[/i,
  },
  // 도서. ISBN이나 출판 표현.
  {
    category: 'book',
    label: '도서',
    patterns: /ISBN|개정판|초판본|양장본|문고판|전자책|eBook|\b(?:상\.하|전\s?\d+권)\b|만화책|\d+권\s*세트\s*\(도서\)/i,
  },
  // 공연·입장권
  {
    category: 'ticket',
    label: '티켓·이용권',
    patterns: /입장권|관람권|예매권|이용권|교환권|상품권|기프티콘|쿠폰번호|수강권/i,
  },
  // 소프트웨어·구독
  {
    category: 'digital',
    label: '디지털·구독',
    patterns: /정품\s*라이선스|라이선스\s*키|시리얼\s*넘버|구독권|\d+개월\s*이용권|다운로드\s*버전/i,
  },
  // 신선식품·즉석
  {
    category: 'food',
    label: '식품',
    // '한우 1++등급'의 +는 글자 그대로여서 escape해야 한다
    patterns: /산지직송|당일\s*수확|냉장\s*배송|\d+\s*kg\s*(?:햅쌀|쌀)\b|정육|한우\s*\d\+*\s*등급/i,
  },
  // 설치·출장 같은 용역
  {
    category: 'service',
    label: '서비스',
    patterns: /출장\s*(?:설치|수리|청소)|방문\s*(?:설치|점검)|시공비|대여\s*서비스|렌탈\s*\d+개월/i,
  },
];

/**
 * 상품명이 검색한 키워드와 다른 상품군으로 보이는가.
 *
 * 키워드 자체가 그 상품군을 가리키면 판단하지 않는다. "CD 케이스"를 찾는
 * 사람에게 CD를 걸러 주면 결과가 통째로 빈다.
 */
export function detectOffCategory(
  productName: string | null | undefined,
  keyword = '',
): OffCategoryHit | null {
  const name = String(productName ?? '').trim();
  if (!name) return null;

  for (const rule of RULES) {
    // 찾는 키워드가 이미 그 상품군이면 거르지 않는다
    if (rule.patterns.test(keyword)) continue;
    const m = name.match(rule.patterns);
    if (m) return { category: rule.category, label: rule.label, matched: m[0].trim() };
  }
  return null;
}

// ── 점수 근거 ────────────────────────────────────────────────
// 숫자만 있으면 왜 Great인지 알 수 없어서 믿기 어렵다. 세 축이 각각 무엇을
// 말하는지 한 줄로 적어 준다.

export interface ScoreInput {
  reviewCount: number;
  deliveryType: 'rocket' | 'jet' | 'general';
  productPrice: number;
  demandScore: number;
  entryEase: number;
  priceFit: number;
}

/** "리뷰 340개로 수요 확인 · 로켓 아님 · 가격대 적합" */
export function scoreReasons(p: ScoreInput): string[] {
  const out: string[] = [];

  if (p.reviewCount >= 1000) out.push(`리뷰 ${p.reviewCount.toLocaleString('ko-KR')}개 — 수요는 크지만 이미 자리 잡음`);
  else if (p.reviewCount >= 30) out.push(`리뷰 ${p.reviewCount.toLocaleString('ko-KR')}개로 수요 확인`);
  else if (p.reviewCount > 0) out.push(`리뷰 ${p.reviewCount}개 — 아직 수요가 확인 안 됨`);
  else out.push('리뷰 없음 — 팔리는지 알 수 없음');

  if (p.deliveryType === 'rocket') out.push('로켓(직매입)과 직접 경쟁');
  else if (p.deliveryType === 'jet') out.push('로켓그로스 경쟁');
  else out.push('로켓 아님 — 들어갈 자리 있음');

  const won = p.productPrice.toLocaleString('ko-KR');
  if (p.priceFit >= 100) out.push(`${won}원 — 마진 내기 좋은 가격대`);
  else if (p.priceFit >= 80) out.push(`${won}원 — 무난한 가격대`);
  else if (p.productPrice < 15000) out.push(`${won}원 — 낮아서 마진 남기기 어려움`);
  else out.push(`${won}원 — 높아서 회전이 느릴 수 있음`);

  return out;
}
