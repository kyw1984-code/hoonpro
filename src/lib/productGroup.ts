/**
 * 옵션 줄들을 상품으로 묶는다.
 *
 * 쿠팡 상품 상세에서 온 옵션은 등록상품ID(seller_product_id)가 있어 그걸로
 * 묶으면 된다. 그런데 반품 재판매 옵션은 매출내역에서만 보여 등록상품ID가 없고,
 * 상품명에 옵션명이 붙어 있다("…3종세트 아이보리, 블랙, 올리브 3종세트 55").
 * 이름으로만 묶으면 같은 상품이 사이즈마다 갈라진다. 그래서 등록상품ID로 먼저
 * 묶고, ID가 없는 줄은 이름이 어느 상품명으로 시작하는지 보고 그 상품에 붙인다.
 */
export interface GroupableRow {
  vendorItemId: string;
  productName: string;
  sellerProductId?: string | null;
}

export interface ProductGroup<T> {
  key: string;
  name: string;
  rows: T[];
}

export function groupProducts<T extends GroupableRow>(rows: T[]): ProductGroup<T>[] {
  const groups: ProductGroup<T>[] = [];
  const byKey = new Map<string, ProductGroup<T>>();
  const push = (key: string, name: string, r: T) => {
    let g = byKey.get(key);
    if (!g) {
      g = { key, name, rows: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    // 같은 상품인데 이름이 여럿이면 짧은 쪽이 옵션명이 안 붙은 원래 상품명이다
    if (name && (!g.name || name.length < g.name.length)) g.name = name;
    g.rows.push(r);
  };

  const orphans: T[] = [];
  for (const r of rows) {
    const sp = String(r.sellerProductId ?? '').trim();
    if (sp) push(`sp:${sp}`, r.productName, r);
    else orphans.push(r);
  }
  // ID 없는 줄: 이미 만들어진 상품명 중 가장 긴 접두어와 맞는 상품에 붙인다
  for (const r of orphans) {
    const name = String(r.productName ?? '').trim();
    let best: ProductGroup<T> | null = null;
    for (const g of groups) {
      if (!g.key.startsWith('sp:') || !g.name) continue;
      if (name === g.name || name.startsWith(g.name + ' ')) {
        if (!best || g.name.length > best.name.length) best = g;
      }
    }
    if (best) best.rows.push(r);
    else push(`nm:${name || r.vendorItemId}`, name, r);
  }
  return groups;
}
