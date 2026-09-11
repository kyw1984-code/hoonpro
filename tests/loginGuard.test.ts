/**
 * 로그인 시도 제한 테스트.
 *
 * 상한이 없으면 서버가 늘어나는 만큼 대입 시도도 같이 늘어난다. scrypt가
 * 한 번에 100밀리초쯤 걸려도 병렬로 부르면 그 값은 의미가 없다.
 *
 * 다만 잠긴 동안은 진짜 주인도 못 들어온다. 막는 것과 가두는 것 사이의 선을
 * 여기서 지킨다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOGIN_LOCK_MS, LOGIN_MAX_ATTEMPTS, lockState, nextFailure,
} from '../src/lib/loginGuard.ts';

const NOW = Date.parse('2026-09-12T07:00:00Z');

test('잠금: 기록이 없으면 잠기지 않았다', () => {
  assert.deepEqual(lockState(null, NOW), { locked: false, minutesLeft: 0 });
  assert.deepEqual(lockState(undefined, NOW), { locked: false, minutesLeft: 0 });
});

test('잠금: 시각이 지났으면 저절로 풀린다', () => {
  const past = new Date(NOW - 1000).toISOString();
  assert.equal(lockState(past, NOW).locked, false);
});

test('잠금: 남은 시간을 분으로 알려 준다', () => {
  const until = new Date(NOW + 14 * 60_000).toISOString();
  const s = lockState(until, NOW);
  assert.equal(s.locked, true);
  assert.equal(s.minutesLeft, 14);
});

// 30초 남았는데 "0분 후"라고 하면 바로 눌러 보고 또 막힌다
test('잠금: 1분 미만도 1분으로 올린다', () => {
  const until = new Date(NOW + 30_000).toISOString();
  assert.equal(lockState(until, NOW).minutesLeft, 1);
});

test('잠금: 망가진 값에 무너지지 않는다', () => {
  assert.equal(lockState('어제', NOW).locked, false);
  assert.equal(lockState('', NOW).locked, false);
});

// ── 실패 누적 ──

test('실패: 상한 전까지는 세기만 한다', () => {
  for (let i = 0; i < LOGIN_MAX_ATTEMPTS - 1; i++) {
    const r = nextFailure(i, NOW);
    assert.equal(r.justLocked, false, `${i}회`);
    assert.equal(r.failedLogins, i + 1);
    assert.equal(r.lockedUntil, null);
  }
});

test('실패: 상한에 닿으면 잠근다', () => {
  const r = nextFailure(LOGIN_MAX_ATTEMPTS - 1, NOW);
  assert.equal(r.justLocked, true);
  assert.equal(Date.parse(r.lockedUntil!), NOW + LOGIN_LOCK_MS);
});

// 잠금이 풀린 뒤 한 번만 더 틀려도 바로 다시 잠기면, 오타를 낸 진짜 주인이
// 사실상 영영 못 들어온다. 잠글 때 횟수를 0으로 되돌린다.
test('실패: 잠근 뒤에는 횟수를 0으로 되돌린다', () => {
  assert.equal(nextFailure(LOGIN_MAX_ATTEMPTS - 1, NOW).failedLogins, 0);
  // 잠금이 풀린 직후 한 번 틀려도 다시 잠기지 않는다
  assert.equal(nextFailure(0, NOW).justLocked, false);
});

test('실패: 값이 없거나 이상해도 1부터 센다', () => {
  assert.equal(nextFailure(null, NOW).failedLogins, 1);
  assert.equal(nextFailure(undefined, NOW).failedLogins, 1);
  assert.equal(nextFailure('세 번', NOW).failedLogins, 1);
  assert.equal(nextFailure(-9, NOW).failedLogins, 1);
});
