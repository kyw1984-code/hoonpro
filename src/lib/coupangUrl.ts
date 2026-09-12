/**
 * 쿠팡 상품 주소에서 필요한 번호를 뽑는다.
 *
 * 쿠팡 상품은 번호가 세 개다.
 *   productId     상품 묶음 (색상·사이즈를 아우르는 한 덩어리)
 *   itemId        그중 한 옵션
 *   vendorItemId  그 옵션의 판매자별 재고
 *
 * 검색 결과에서 복사한 주소에는 셋이 다 들어 있다. 예전에는 productId만
 * 뽑아 쓰고 나머지를 버렸는데, 리뷰 조각 엔드포인트는 옵션 단위로 응답해서
 * 옵션 번호가 없으면 빈 조각이 돌아오는 경우가 있다. 사용자가 이미 준
 * 정보를 버리고 실패한 셈이라, 셋 다 받아 둔다.
 *
 * 순수 함수로 떼어 둔 이유는 주소 형태가 여러 가지고(상품번호만, 짧은 주소,
 * 검색에서 복사한 긴 주소, m.coupang.com) 화면과 서버 양쪽에서 같은 규칙을
 * 써야 하기 때문이다.
 */

export interface ProductRef {
  /** 상품 묶음 번호. 못 찾으면 빈 문자열 */
  productId: string;
  /** 옵션 번호. 주소에 없으면 빈 문자열 */
  itemId: string;
  /** 판매자 재고 번호. 주소에 없으면 빈 문자열 */
  vendorItemId: string;
}

const EMPTY: ProductRef = { productId: '', itemId: '', vendorItemId: '' };

/** 질의 문자열에서 숫자로만 된 값을 뽑는다. 대소문자를 가리지 않는다. */
function numParam(raw: string, name: string): string {
  const m = raw.match(new RegExp(`[?&]${name}=(\\d+)`, 'i'));
  return m ? m[1] : '';
}

export function parseProductRef(input: unknown): ProductRef {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return EMPTY;

  // 상품번호만 붙여 넣은 경우
  if (/^\d+$/.test(raw)) return { productId: raw, itemId: '', vendorItemId: '' };

  // /vp/products/123456 — www, m, 모바일 단축 주소 모두 같은 경로를 쓴다
  const productId = raw.match(/\/vp\/products\/(\d+)/)?.[1]
    || numParam(raw, 'productId')
    || '';
  if (!productId) return EMPTY;

  return {
    productId,
    itemId: numParam(raw, 'itemId'),
    vendorItemId: numParam(raw, 'vendorItemId'),
  };
}

/**
 * 옵션 번호까지 살린 상품 페이지 주소.
 *
 * 옵션 번호가 없으면 쿠팡이 대표 옵션으로 되돌린다. 사용자가 보고 있던
 * 옵션과 다른 옵션의 리뷰를 분석해 주면 안 되므로, 있으면 붙인다.
 */
export function productPageUrl(ref: ProductRef): string {
  const q: string[] = [];
  if (ref.itemId) q.push(`itemId=${ref.itemId}`);
  if (ref.vendorItemId) q.push(`vendorItemId=${ref.vendorItemId}`);
  return `https://www.coupang.com/vp/products/${ref.productId}${q.length ? `?${q.join('&')}` : ''}`;
}
