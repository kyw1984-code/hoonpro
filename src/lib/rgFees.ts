/**
 * 로켓그로스 입출고비 조회 — 카테고리 × 판매가 구간 × 사이즈.
 *
 * 표는 대표님이 쿠팡 Wing [로켓그로스 비용/수수료 > 입출고/배송 비용]에서 받은
 * 엑셀을 그대로 옮긴 것이다(src/data/rgFees.json, 2026.11.27 조회, VAT 별도).
 *
 * 적용 순서 (엑셀 안내 그대로)
 *   1) 프로모션 기간(2027.01.31까지)이고 판매가 14,000원 미만이며 그 카테고리에
 *      저가 전용할인가가 있으면 → 저가 전용할인가
 *   2) 프로모션 기간이면 → 프로모션가
 *   3) 그 밖에는 → 정가
 *
 * 상품의 카테고리는 Wing 검색 응답의 category 경로("패션의류잡화>남성패션>…")로
 * 고른다. 표의 2차 분류는 Wing이 쓰는 묶음이라 쿠팡 카테고리와 1:1이 아니어서,
 * 경로 앞 두 단계가 맞는 묶음 가운데 이름이 경로에 가장 많이 들어간 것을 고른다.
 * 틀릴 수 있으므로 화면에서 늘 바꿀 수 있게 한다.
 */
import data from '../data/rgFees.json';

export type FeeKind = 'low' | 'promo' | 'list';
export interface RgBand { min: number; max: number | null; list: (number | null)[] | null; promo: (number | null)[] | null; low: (number | null)[] | null }
export interface RgGroup { g1: string; g2: string; cats: string[]; bands: RgBand[] }

export const RG_SIZES = data.sizes as string[];
export const RG_GROUPS = data.groups as RgGroup[];
export const RG_SOURCE = data.source as string;
export const RG_PROMO_UNTIL = data.promoUntil as string;

export const groupKey = (g: RgGroup) => `${g.g1}/${g.g2}`;

const won = (n: number) => n.toLocaleString('ko-KR');
export function bandLabel(b: RgBand): string {
  return b.max === null ? `${won(b.min)}원 이상` : `${won(b.min)}~${won(b.max)}원 미만`;
}

/** 오늘이 프로모션 기간인가 (한국 날짜 기준) */
export function promoActive(today = new Date()): boolean {
  const kst = new Date(today.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  return kst <= RG_PROMO_UNTIL;
}

export interface FeeResult { fee: number; kind: FeeKind; band: RgBand }

/** 그 묶음·판매가·사이즈의 입출고비 (VAT 별도). 표에 없으면 null */
export function rgFee(key: string, price: number, sizeIndex: number, today = new Date()): FeeResult | null {
  const g = RG_GROUPS.find(x => groupKey(x) === key);
  if (!g || !(price >= 0) || sizeIndex < 0 || sizeIndex > 5) return null;
  const band = g.bands.find(b => price >= b.min && (b.max === null || price < b.max));
  if (!band) return null;
  const pick = (arr: (number | null)[] | null) => (arr && arr[sizeIndex] != null ? Number(arr[sizeIndex]) : null);
  const promo = promoActive(today);
  if (promo && price < data.lowPriceUnder) {
    const v = pick(band.low);
    if (v != null) return { fee: v, kind: 'low', band };
  }
  if (promo) {
    const v = pick(band.promo);
    if (v != null) return { fee: v, kind: 'promo', band };
  }
  const v = pick(band.list);
  return v != null ? { fee: v, kind: 'list', band } : null;
}

/** 쿠팡 카테고리 경로 → 표의 묶음 키. 고를 수 없으면 null */
export function matchGroup(categoryPath: string | null | undefined): string | null {
  const parts = String(categoryPath ?? '').split('>').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const prefix = `${parts[0]}>${parts[1]}`;
  // 맨 앞 단계("패션의류잡화" 등)는 후보를 고를 때 이미 썼다. 점수는 그 아래로만 매긴다 —
  // 안 그러면 "패션의류잡화"의 "의류"가 신발·가방에까지 의류 점수를 준다
  const path = parts.slice(1).join('>');
  const candidates = RG_GROUPS.filter(g => g.cats.includes(prefix));
  if (candidates.length === 0) return null;
  const tokens = (s: string) => s.split(/[/&()\s,]+/).map(t => t.trim()).filter(t => t.length >= 2);
  const score = (g: RgGroup) => {
    let n = 0;
    for (const t of tokens(g.g2)) {
      if (path.includes(t)) n += 3;
      // 이름 끝 두 글자 ("패션신발"의 "신발", "남성의류"의 "의류")
      else if (t.length >= 3 && path.includes(t.slice(-2))) n += 1;
    }
    for (const t of tokens(g.g1)) if (path.includes(t)) n += 1;
    // 거꾸로, 경로의 낱말이 묶음 이름 안에 있으면 ("스킨" ⊂ "스킨케어")
    for (const seg of parts.slice(1)) for (const t of tokens(seg)) if (g.g2.includes(t)) n += 2;
    // 그 묶음이 이 1차 경로만 담고 있으면 더 확실하다
    if (g.cats.length === 1) n += 1;
    return n;
  };
  let best = candidates[0], bestScore = score(best);
  for (const g of candidates.slice(1)) {
    const s = score(g);
    if (s > bestScore) { best = g; bestScore = s; }
  }
  return groupKey(best);
}

export const FEE_KIND_LABEL: Record<FeeKind, string> = { low: '저가 전용할인가', promo: '프로모션가', list: '정가' };
