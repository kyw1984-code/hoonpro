/**
 * 추천 코드의 주인이 누구인지 — 한 곳에서 정한다.
 *
 * 추천 코드는 쿠폰 테이블을 그대로 쓰고, 누가 발행한 것인지는 note 칸에
 * 'referral:{userId}' 형태로 적어 둔다. 이 형식이 만드는 쪽과 확인하는 쪽에
 * 따로 적혀 있으면 한쪽만 고쳐졌을 때 확인이 조용히 통과한다. 한도 0의 뜻을
 * 뒤집었을 때 다섯 곳 중 세 곳만 고쳐져 코칭AI가 막혔던 것과 같은 일이다.
 *
 * 본인 사용을 막는 것이 이 파일의 이유다. 추천 코드는 [구독 관리] 화면에 늘
 * 떠 있고 바로 아래가 쿠폰 입력칸이다. 막지 않으면 복사해서 붙여넣는 것으로
 * 누구나 10% 할인을 받는다. 연간 결제 기준 1인당 39,336원이고, 장부에는
 * 매출 손실이 아니라 판촉비로 잡혀 눈에 띄지도 않는다.
 */

/** 이 사용자의 추천 코드에 적힐 note 값 */
export function referralNote(userId: string): string {
  return `referral:${userId}`;
}

/**
 * 이 쿠폰이 이 사람이 발행한 추천 코드인가.
 *
 * note가 비어 있으면 추천 코드가 아니라 운영자가 만든 일반 쿠폰이다.
 * 그런 쿠폰은 누가 쓰든 상관없으므로 false를 돌려준다.
 */
export function isOwnReferral(note: string | null | undefined, userId: string): boolean {
  if (!note || !userId) return false;
  return note === referralNote(userId);
}
