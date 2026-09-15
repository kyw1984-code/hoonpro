import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SENDER, VERIFIED_SENDER_DOMAIN, emailFrom, isVerifiedSender, senderAddress,
} from '../src/lib/emailFrom.ts';

test('기본 발신 주소는 Resend에 등록된 도메인이다', () => {
  // 이 값이 등록 안 된 도메인이면 환경변수가 빠지는 순간 모든 메일이
  // 조용히 실패한다. 실제로 hoonpro.app으로 적혀 있던 자리가 있었다.
  assert.equal(VERIFIED_SENDER_DOMAIN, 'hoonproai.com');
  assert.equal(DEFAULT_SENDER, 'no-reply@hoonproai.com');
});

test('환경변수가 없거나 비어 있으면 기본값으로 돌아간다', () => {
  assert.equal(emailFrom(undefined), DEFAULT_SENDER);
  assert.equal(emailFrom(''), DEFAULT_SENDER);
  assert.equal(emailFrom('   '), DEFAULT_SENDER);
});

test('환경변수가 있으면 그대로 쓴다 — 표시이름이 붙은 형태도', () => {
  assert.equal(emailFrom('billing@hoonproai.com'), 'billing@hoonproai.com');
  assert.equal(emailFrom('훈프로 <no-reply@hoonproai.com>'), '훈프로 <no-reply@hoonproai.com>');
  // 앞뒤 공백은 떼고 보낸다. Resend가 거절하는 흔한 실수다.
  assert.equal(emailFrom('  billing@hoonproai.com  '), 'billing@hoonproai.com');
});

test('표시이름이 붙어 있어도 주소만 뽑아낸다', () => {
  assert.equal(senderAddress('훈프로 <no-reply@hoonproai.com>'), 'no-reply@hoonproai.com');
  assert.equal(senderAddress('no-reply@hoonproai.com'), 'no-reply@hoonproai.com');
});

test('주소 꼴이 아니면 null — 없는 값을 지어내지 않는다', () => {
  assert.equal(senderAddress('훈프로'), null);
  assert.equal(senderAddress(''), null);
  assert.equal(senderAddress('no-reply@localhost'), null);
});

test('등록되지 않은 도메인을 가려낸다', () => {
  assert.equal(isVerifiedSender(DEFAULT_SENDER), true);
  assert.equal(isVerifiedSender('훈프로 <no-reply@hoonproai.com>'), true);
  assert.equal(isVerifiedSender('NO-REPLY@HOONPROAI.COM'), true);
  // 폴백에 박혀 있던 도메인 — Resend에 등록된 적이 없다
  assert.equal(isVerifiedSender('no-reply@hoonpro.app'), false);
  // partially_failed 상태라 발송이 보장되지 않는다
  assert.equal(isVerifiedSender('no-reply@hoonpro.com'), false);
  // 도메인 끝을 흉내 낸 주소에 속지 않는다
  assert.equal(isVerifiedSender('no-reply@evil-hoonproai.com'), false);
  assert.equal(isVerifiedSender('no-reply@hoonproai.com.attacker.net'), false);
});
