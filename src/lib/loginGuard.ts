/**
 * 로그인 시도 제한 — 규칙을 한 곳에 둔다.
 *
 * 비밀번호 재설정에는 횟수 제한과 재발송 간격이 있는데 로그인에는 없었다.
 * 비밀번호 규칙이 8자 이상 영문+숫자라, 상한이 없으면 서버가 늘어나는 만큼
 * 시도도 같이 늘어난다. scrypt가 한 번에 100밀리초쯤 걸려도 병렬로 부르면
 * 그 값은 의미가 없다.
 *
 * 계정 단위로 잠근다. IP 단위가 더 좋지만 프록시 뒤라 믿을 수 없고, 계정
 * 잠금만으로도 한 계정을 노린 대입은 막힌다. 대신 잠긴 동안은 진짜 주인도
 * 못 들어오므로, 영구 잠금이 아니라 시간이 지나면 저절로 풀리게 한다.
 */

/** 이만큼 연속으로 틀리면 잠근다 */
export const LOGIN_MAX_ATTEMPTS = 5;

/** 잠기는 시간 */
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

export interface LockState {
  locked: boolean;
  /** 남은 시간(분). 잠기지 않았으면 0 */
  minutesLeft: number;
}

/** 지금 잠겨 있나 */
export function lockState(lockedUntil: string | null | undefined, now = Date.now()): LockState {
  if (!lockedUntil) return { locked: false, minutesLeft: 0 };
  const until = new Date(lockedUntil).getTime();
  if (!Number.isFinite(until) || until <= now) return { locked: false, minutesLeft: 0 };
  // 올림한다. 30초 남았는데 "0분 후"라고 하면 바로 눌러 보고 또 막힌다.
  return { locked: true, minutesLeft: Math.max(1, Math.ceil((until - now) / 60000)) };
}

export interface FailureResult {
  /** users.failed_logins에 저장할 값 */
  failedLogins: number;
  /** users.locked_until에 저장할 값 */
  lockedUntil: string | null;
  /** 이번 실패로 잠겼나 */
  justLocked: boolean;
}

/**
 * 한 번 틀렸을 때 무엇을 저장할지.
 *
 * 잠글 때 횟수를 0으로 되돌린다. 잠금이 풀린 뒤 한 번만 더 틀려도 바로 다시
 * 잠기면, 오타를 낸 진짜 주인이 사실상 영영 못 들어온다.
 */
export function nextFailure(currentFailed: unknown, now = Date.now()): FailureResult {
  const n = Math.max(0, Number(currentFailed) || 0) + 1;
  if (n >= LOGIN_MAX_ATTEMPTS) {
    return { failedLogins: 0, lockedUntil: new Date(now + LOGIN_LOCK_MS).toISOString(), justLocked: true };
  }
  return { failedLogins: n, lockedUntil: null, justLocked: false };
}
