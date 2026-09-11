/**
 * 접근 게이트 테스트.
 *
 * 두 가지를 한 곳에서 판단한다. 아직 우리 회원인가, 유료화가 켜졌다면 구독이
 * 있는가. 예전에는 회원 상태를 로그인할 때만 봐서, 관리자가 거절하거나 본인이
 * 탈퇴해도 토큰이 만료되는 7일까지 계속 쓸 수 있었다. 화면에는 거절됨으로
 * 뜨는데 실제로는 돈 드는 기능이 계속 나갔다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAccess, type GateRows } from '../src/lib/accessGate.ts';

const active: GateRows = {
  user: { status: 'approved', withdrawn_at: null },
  billingEnforced: false,
  subscription: null,
};

test('정상 회원은 통과한다', () => {
  assert.equal(decideAccess(active, false), null);
});

// ── 회원 상태 ──

test('탈퇴한 계정은 토큰이 남아 있어도 막는다', () => {
  const d = decideAccess({ ...active, user: { status: 'approved', withdrawn_at: '2026-09-01T00:00:00Z' } }, false);
  assert.equal(d?.status, 401);
  assert.equal(d?.body.reauth, true);
});

test('거절된 계정은 막는다', () => {
  const d = decideAccess({ ...active, user: { status: 'rejected', withdrawn_at: null } }, false);
  assert.equal(d?.status, 403);
});

test('승인 대기 중인 계정은 막는다', () => {
  assert.equal(decideAccess({ ...active, user: { status: 'pending', withdrawn_at: null } }, false)?.status, 403);
});

test('계정이 사라졌으면 막는다', () => {
  assert.equal(decideAccess({ ...active, user: null }, false)?.status, 401);
});

// 관리자라고 탈퇴·거절을 건너뛰면 안 된다. isAdmin은 토큰에 박혀 있어
// 권한을 거둬도 7일 남는데, 계정 자체를 막으면 그 자리에서 끊긴다.
test('관리자도 탈퇴·거절은 막는다', () => {
  assert.equal(decideAccess({ ...active, user: { status: 'rejected', withdrawn_at: null } }, true)?.status, 403);
  assert.equal(decideAccess({ ...active, user: { status: 'approved', withdrawn_at: '2026-09-01T00:00:00Z' } }, true)?.status, 401);
});

// ── 유료화 ──

test('유료화가 꺼져 있으면 구독이 없어도 통과한다', () => {
  assert.equal(decideAccess({ ...active, billingEnforced: false, subscription: null }, false), null);
});

test('유료화가 켜지면 구독이 없을 때 막는다', () => {
  const d = decideAccess({ ...active, billingEnforced: true, subscription: null }, false);
  assert.equal(d?.status, 402);
  assert.equal(d?.body.subscriptionRequired, true);
});

test('유료화가 켜져도 살아 있는 구독이면 통과한다', () => {
  for (const status of ['trial', 'active', 'past_due']) {
    assert.equal(decideAccess({ ...active, billingEnforced: true, subscription: { status } }, false), null, status);
  }
});

test('멈췄거나 해지된 구독은 막는다', () => {
  for (const status of ['paused', 'canceled']) {
    assert.equal(decideAccess({ ...active, billingEnforced: true, subscription: { status } }, false)?.status, 402, status);
  }
});

// 운영자가 자기 서비스를 구독해야 볼 수 있으면 장애 대응을 못 한다
test('관리자는 유료화 게이트를 건너뛴다', () => {
  assert.equal(decideAccess({ ...active, billingEnforced: true, subscription: null }, true), null);
});

// ── 조회 실패 ──
// 한도와 달리 여기서 막아도 돈이 절약되지 않는다. DB가 잠깐 흔들릴 때
// 전원이 로그아웃된 것처럼 보이는 쪽이 더 나쁘다.
test('조회가 실패하면 막지 않는다', () => {
  assert.equal(decideAccess({ user: null, billingEnforced: true, subscription: null, lookupFailed: true }, false), null);
});
