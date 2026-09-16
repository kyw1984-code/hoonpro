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

/**
 * 회원이 자동으로 받은 개인 추천 코드인가 (운영자가 만든 프로모션 쿠폰이 아니라).
 *
 * 추천 코드는 회원 한 명당 하나씩 자동으로 생기므로 회원이 늘면 그만큼 쌓인다.
 * 관리자 쿠폰 목록에 섞어 두면 회원 100명일 때 HOON-xxxxxx가 100줄 깔려
 * 정작 봐야 할 프로모션 쿠폰이 묻힌다. 그래서 목록에서 갈라 놓는데, 그
 * 판정을 화면마다 따로 적으면 한쪽만 고쳐졌을 때 조용히 어긋난다.
 */
export function isReferralNote(note: string | null | undefined): boolean {
  return referrerIdFromNote(note) !== null;
}

/**
 * 이 note를 쓴 추천 코드의 주인 userId. 추천 코드가 아니면 null.
 *
 * 친구가 결제를 마치면 추천인에게도 보상을 줘야 하는데, 그 추천인이
 * 누구인지는 이 note에만 적혀 있다.
 */
export function referrerIdFromNote(note: string | null | undefined): string | null {
  if (!note || !note.startsWith('referral:')) return null;
  const id = note.slice('referral:'.length).trim();
  return id.length > 0 ? id : null;
}
