/**
 * 추천 코드 본인 사용 차단 테스트.
 *
 * 추천 코드는 [구독 관리] 화면에 늘 떠 있고 바로 아래가 쿠폰 입력칸이다.
 * 막지 않으면 복사해서 붙여넣는 것으로 누구나 10% 할인을 받는다. 연간 결제
 * 기준 1인당 39,336원이고, 장부에는 매출 손실이 아니라 판촉비로 잡혀 눈에
 * 띄지도 않는다. 그래서 이 규칙은 테스트로 고정해 둔다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOwnReferral, referralNote } from '../src/lib/referral.ts';

const ME = 'dfa8f57c-5854-4ea5-a1bb-3202826ed207';
const OTHER = 'f6d4ed71-1a11-4c8b-82e1-cc04934d580c';

test('내 추천 코드는 내가 못 쓴다', () => {
  assert.equal(isOwnReferral(referralNote(ME), ME), true);
});

test('남의 추천 코드는 쓸 수 있다 — 그게 추천 코드의 목적이다', () => {
  assert.equal(isOwnReferral(referralNote(OTHER), ME), false);
});

// 운영자가 만든 일반 쿠폰은 note가 비어 있다. 누가 쓰든 상관없다.
test('추천 코드가 아닌 쿠폰은 막지 않는다', () => {
  assert.equal(isOwnReferral(null, ME), false);
  assert.equal(isOwnReferral(undefined, ME), false);
  assert.equal(isOwnReferral('', ME), false);
  assert.equal(isOwnReferral('여름 프로모션', ME), false);
});

// 만드는 쪽과 확인하는 쪽이 같은 형식을 써야 한다. 한쪽만 바뀌면 확인이
// 조용히 통과한다 — 한도 0의 뜻을 뒤집었을 때 실제로 그랬다.
test('형식이 한 곳에서만 정해진다', () => {
  assert.equal(referralNote(ME), `referral:${ME}`);
  assert.equal(isOwnReferral(`referral:${ME}`, ME), true);
});

// 빈 사용자 아이디로 아무 추천 코드나 통과시키면 안 된다
test('사용자 아이디가 비면 주인으로 보지 않는다', () => {
  assert.equal(isOwnReferral('referral:', ''), false);
  assert.equal(isOwnReferral(referralNote(ME), ''), false);
});

// 앞뒤가 붙은 값이 우연히 통과하면 안 된다
test('부분만 같은 값은 통과하지 않는다', () => {
  assert.equal(isOwnReferral(`referral:${ME}x`, ME), false);
  assert.equal(isOwnReferral(`xreferral:${ME}`, ME), false);
  assert.equal(isOwnReferral(ME, ME), false);
});
