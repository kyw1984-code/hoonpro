/**
 * 비어 있는 옵션명을 상품명에서 되살린다.
 *
 * 쿠팡이 옵션명을 늘 주지는 않는다. 원가 입력 시트를 내려받으면 옵션명 칸이
 * 비어 있거나 숫자(옵션ID로 보이는 값)만 들어 있는 줄이 섞인다. 그런 줄은
 * 어느 색·어느 사이즈인지 알 수 없어 원가를 넣을 수가 없다.
 *
 * 다행히 그런 줄은 상품명 안에 옵션이 함께 들어 있다. 두 가지 꼴이다.
 *
 *   ① "…트레이닝 자켓 2종 세트, 그레이+블랙(2종세트), Size 1 (55-66)"
 *      쿠팡 표준 표기다. 첫 ", " 뒤가 옵션이다.
 *
 *   ② "…롱원피스 3종세트 아이보리, 블랙, 올리브 3종세트 77"
 *      쉼표 없이 그냥 이어 붙었다. 여기서 첫 쉼표로 자르면 "아이보리"가
 *      떨어져 나가 엉뚱한 옵션이 된다. 대신 같은 상품의 다른 줄을 본다 —
 *      "…롱원피스 3종세트"라는 줄이 따로 있으므로, 그 길이만큼 떼면 된다.
 *
 * 그래서 ②를 ①보다 먼저 본다. 순서를 바꾸면 ②가 잘못 잘린다.
 */

export interface NamePair {
  productName: string;
  optionName: string;
}

/** 옵션명 구실을 하는 값인가. 숫자만이거나 상품명과 같으면 이름이 아니다 */
function usable(productName: string, optionName: string): boolean {
  const o = optionName.trim();
  return Boolean(o) && !/^\d+$/.test(o) && o !== productName.trim();
}

/** 앞에 붙은 기준 이름을 떼고 남은 부분. 단어 경계에서만 뗀다 */
function stripPrefix(full: string, base: string): string {
  if (!base || full.length <= base.length || !full.startsWith(base)) return '';
  const next = full[base.length];
  // "롱원피스 3종세트" + "즈" 처럼 단어 한가운데서 잘리면 안 된다
  if (next !== ' ' && next !== ',' && next !== '/' && next !== '-') return '';
  const tail = full.slice(base.length).replace(/^[\s,·/|-]+/, '').trim();
  return tail.length >= 2 ? tail : '';
}

/**
 * 여러 줄을 한꺼번에 본다. 같은 상품의 짧은 줄이 긴 줄의 옵션을 알려주기
 * 때문에, 한 줄만 떼어 보면 ②를 풀 수 없다.
 *
 * @returns 입력과 같은 순서의 옵션명 배열. 못 알아내면 빈 문자열.
 */
export function fillOptionNames(rows: readonly NamePair[]): string[] {
  // 다른 줄의 앞부분 노릇을 할 수 있는 이름들. 긴 것부터 본다 — 짧은 이름이
  // 먼저 걸리면 옵션의 일부가 상품명 쪽에 남는다.
  const bases = [...new Set(rows.map(r => r.productName.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);

  return rows.map(r => {
    const product = (r.productName ?? '').trim();
    const option = (r.optionName ?? '').trim();

    if (usable(product, option)) {
      // 옵션명에 상품명이 통째로 앞에 붙어 오는 경우가 있다
      return stripPrefix(option, product) || option;
    }

    // ② 같은 상품의 더 짧은 줄을 기준으로 뗀다
    for (const base of bases) {
      if (base.length >= product.length) continue;
      const tail = stripPrefix(product, base);
      if (tail) return tail;
    }

    // ① 쿠팡 표준 표기 — 첫 ", " 뒤가 옵션이다
    const comma = product.indexOf(', ');
    if (comma > 0) return product.slice(comma + 2).trim();

    return '';
  });
}
