/**
 * 내 가게와 얼마나 닮은 시장인가.
 *
 * 지금 기회점수는 모든 판매자에게 똑같다. "15,000~40,000원이 이상적이고 로켓은
 * 불리하다"가 코드에 박혀 있다. 그런데 이 기준은 누가 쓰든 같은 답을 낸다 —
 * 즉 경쟁자도 똑같은 점수를 본다. 그 점수로는 남과 다른 결정을 못 한다.
 *
 * 훈프로에는 남이 못 가진 게 있다. 정산AI가 아는 이 판매자의 실제 실적이다.
 * 무엇을 얼마에 파는지, 어느 창구로 파는지, 세트로 파는지. 그걸 기준으로
 * "대표님이 이미 잘 파는 것과 닮은 시장"을 찾는다.
 *
 * 다만 이 점수가 본래 점수를 덮으면 안 된다. 시장이 좋은가(기회점수)와 나에게
 * 맞는가(적합도)는 다른 질문이다. 둘을 섞되 기회점수 쪽에 무게를 둔다.
 */

import { parseSet } from './setProduct.js';

export interface SellerProfile {
  /** 실제 팔리는 가격대 — 사분위로 잡는다. 평균은 비싼 한두 개에 끌려간다 */
  priceP25: number;
  priceMedian: number;
  priceP75: number;
  /** 주력 창구 */
  channel: 'growth' | 'wing' | 'both';
  /** 상품명에 'N종 세트'가 들어가는 비중 (0~1) */
  setRatio: number;
  /** 이 값을 뽑은 근거 */
  basis: { soldOptions: number; days: number };
}

/** 이만큼은 팔려 봐야 '내 가게의 성격'이라고 할 수 있다 */
export const FIT_MIN_OPTIONS = 10;

export interface SoldOption {
  /** 실제 팔린 개당 가격 */
  unitPrice: number;
  channel?: string | null;
}

/** 백분위 — 값이 하나뿐이어도 그 값을 돌려준다 */
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 상품명이 세트 구성인가.
 *
 * setProduct.ts의 parseSet과 같은 표현만 잡아야 한다. 예전에는 여기가 훨씬
 * 헐거워서 두 가지가 새어 들어왔다.
 *
 *  · '묶음'이 아무 데서나 걸렸다. '묶음배송 가능'은 배송 안내지 세트가 아니다.
 *    이 문구는 흔해서, 단품만 파는 가게의 세트 비중이 0.5 근처로 올라간다.
 *    그 값은 0.6 위도 0.2 아래도 아니라 구성 신호가 통째로 죽는다. 조금 더
 *    올라가면 뒤집혀서, 세트를 한 번도 안 판 사람에게 세트 시장을 권한다.
 *  · '\d+\s*종'에 자릿수 제한이 없어 '12종합영양제'의 '12종'이 걸렸다.
 *
 * parseSet을 그대로 쓰면 규칙이 갈라질 일이 없다.
 */
export function looksLikeSet(productName: string | null | undefined): boolean {
  return parseSet(productName, 0).count > 1;
}

export function buildSellerProfile(
  sold: SoldOption[],
  productNames: string[],
  days: number,
): SellerProfile | null {
  const prices = sold
    .map(s => Math.round(Number(s.unitPrice) || 0))
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  if (prices.length < FIT_MIN_OPTIONS) return null;

  let growth = 0;
  let wing = 0;
  for (const s of sold) {
    if (s.channel === 'growth') growth++;
    else if (s.channel === 'marketplace') wing++;
  }
  // 한쪽이 뚜렷하게 많을 때만 주력으로 본다. 비슷하면 둘 다 하는 것이다.
  const channel: SellerProfile['channel'] =
    growth >= wing * 2 ? 'growth' : wing >= growth * 2 ? 'wing' : 'both';

  const names = productNames.filter(Boolean);
  const setRatio = names.length > 0 ? names.filter(looksLikeSet).length / names.length : 0;

  return {
    priceP25: Math.round(percentile(prices, 0.25)),
    priceMedian: Math.round(percentile(prices, 0.5)),
    priceP75: Math.round(percentile(prices, 0.75)),
    channel,
    setRatio,
    basis: { soldOptions: prices.length, days },
  };
}

export interface FitInput {
  productPrice: number;
  deliveryType: 'rocket' | 'jet' | 'general';
  productName: string;
}

export interface FitResult {
  /** 0~100. 내 가게와 닮은 정도 */
  score: number;
  /** 왜 그 점수인지 한 줄 */
  reason: string;
}

/**
 * 이 상품이 내가 이미 하는 것과 얼마나 닮았나.
 *
 * 가격이 가장 무겁다. 같은 가격대는 같은 고객·같은 물류·같은 마진 구조를 뜻한다.
 * 창구가 그다음이다 — 로켓그로스를 쓰는 사람에게 그로스 경쟁은 불리한 게 아니라
 * 익숙한 자리다. 세트 구성은 참고 정도로 얹는다.
 */
export function sellerFit(p: FitInput, profile: SellerProfile): FitResult {
  // ── 가격 (0~100) ──
  // 사분위 안이면 만점. 밖으로 나갈수록 떨어지되, 중앙값 대비 배수로 잰다.
  const price = Math.max(0, Number(p.productPrice) || 0);
  let priceScore: number;
  let priceWord: string;
  if (price >= profile.priceP25 && price <= profile.priceP75) {
    priceScore = 100;
    priceWord = '늘 팔던 가격대';
  } else {
    const edge = price < profile.priceP25 ? profile.priceP25 : profile.priceP75;
    const ratio = edge > 0 ? Math.min(price, edge) / Math.max(price, edge) : 0;
    // 두 배 벗어나면 0에 가깝게
    priceScore = Math.max(0, Math.round(ratio * 100));
    priceWord = price < profile.priceP25 ? '평소보다 싼 가격대' : '평소보다 비싼 가격대';
  }

  // ── 창구 (0~100) ──
  // 로켓(직매입)은 누구에게나 어렵다. 그로스는 그로스를 쓰는 사람에게 익숙한 자리다.
  let channelScore: number;
  if (p.deliveryType === 'rocket') channelScore = 20;
  else if (p.deliveryType === 'jet') channelScore = profile.channel === 'wing' ? 50 : 90;
  else channelScore = profile.channel === 'growth' ? 70 : 90;

  // ── 구성 (0~100) ──
  // 세트로 파는 사람에게 세트 시장은 아는 싸움이다. 반반이면 굳이 따지지 않는다.
  const isSet = looksLikeSet(p.productName);
  let setScore = 60;
  if (profile.setRatio >= 0.6) setScore = isSet ? 100 : 45;
  else if (profile.setRatio <= 0.2) setScore = isSet ? 45 : 100;

  const score = Math.round(priceScore * 0.55 + channelScore * 0.3 + setScore * 0.15);

  const bits = [priceWord];
  if (p.deliveryType === 'rocket') bits.push('로켓은 직접 경쟁');
  else if (p.deliveryType === 'jet' && profile.channel !== 'wing') bits.push('그로스라 익숙한 자리');
  if (profile.setRatio >= 0.6 && isSet) bits.push('세트 구성도 하던 방식');

  return { score, reason: bits.join(' · ') };
}

/**
 * 기회점수와 적합도를 섞는다.
 *
 * 기회점수 쪽에 무게를 둔다. 적합도가 이기면 "내가 늘 팔던 가격이면 무조건 좋다"가
 * 되어, 이미 하는 것만 계속하게 된다. 적합도는 비슷한 시장 둘 중 하나를 고를 때
 * 기우는 정도여야 한다.
 */
export function blendScore(opportunityScore: number, fitScore: number): number {
  const o = Math.max(0, Math.min(100, opportunityScore));
  const f = Math.max(0, Math.min(100, fitScore));
  return Math.round(o * 0.7 + f * 0.3);
}
