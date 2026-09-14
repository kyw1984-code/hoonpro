/**
 * 기능별 일일 한도 규칙 테스트.
 *
 * 이 값 하나가 기능을 켜고 끈다. 0을 '무제한'에서 '사용 중지'로 뒤집을 때
 * 같은 판정이 파일 다섯 곳에 복사돼 있어 세 곳만 고쳐졌고, 남은 곳은 무제한(-1)을
 * 0으로 뭉개 코칭AI를 통째로 막았다. 규칙을 한 곳에 모았으니 여기서 지킨다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampLimit,
  decideQuota,
  DEFAULT_FEATURE_LIMITS,
  isDisabled,
  limitState,
  mergeLimits,
  parseLimits,
  quotaResponse,
} from '../src/lib/featureLimits.ts';

test('limitState: 0은 사용 중지, 음수는 무제한, 양수는 횟수', () => {
  assert.equal(limitState(0), 'disabled');
  assert.equal(limitState(-1), 'unlimited');
  assert.equal(limitState(-99), 'unlimited');
  assert.equal(limitState(40), 'counted');
  assert.equal(isDisabled(0), true);
  assert.equal(isDisabled(-1), false);
  assert.equal(isDisabled(40), false);
});

// 무제한을 0으로 뭉개면 정반대로 '사용 중지'가 된다. 실제로 그렇게 막혔었다.
test('clampLimit: 음수는 무제한(-1)으로 모으고 0은 그대로 둔다', () => {
  assert.equal(clampLimit(-1, 100), -1);
  assert.equal(clampLimit(-500, 100), -1);
  assert.equal(clampLimit(0, 100), 0);   // 0은 '사용 중지'라 살려 둬야 한다
  assert.equal(clampLimit(40, 100), 40);
  assert.equal(clampLimit('40', 100), 40);
  assert.equal(clampLimit(40.6, 100), 41);
});

// Number(null)과 Number('')은 0이다. 값을 안 보낸 항목이 0으로 저장되면
// 기능이 통째로 꺼진다 — 관리자 화면이 키 하나를 빠뜨리면 바로 사고가 난다.
test('clampLimit: 빈 값은 0이 아니라 기본값이다', () => {
  assert.equal(clampLimit(null, 100), 100);
  assert.equal(clampLimit(undefined, 100), 100);
  assert.equal(clampLimit('', 100), 100);
  assert.equal(clampLimit('abc', 100), 100);
  assert.equal(clampLimit(NaN, 100), 100);
});

test('clampLimit: 터무니없이 큰 값은 잘라 낸다', () => {
  assert.equal(clampLimit(9e9, 100), 100000);
});

test('mergeLimits: 저장값을 기본값 위에 얹고 모르는 키는 버린다', () => {
  const merged = mergeLimits({ rank: 100, image: 0, 형편없는키: 5 });
  assert.equal(merged.rank, 100);
  assert.equal(merged.image, 0);
  assert.equal(merged.qa, DEFAULT_FEATURE_LIMITS.qa);
  assert.equal('형편없는키' in merged, false);
});

test('mergeLimits: 기본값을 건드리지 않는다', () => {
  const before = DEFAULT_FEATURE_LIMITS.rank;
  const merged = mergeLimits({ rank: 7 });
  merged.rank = 999;
  assert.equal(DEFAULT_FEATURE_LIMITS.rank, before);
});

test('parseLimits: 깨진 JSON이나 빈 값이면 기본값으로 간다', () => {
  assert.deepEqual(parseLimits(null), DEFAULT_FEATURE_LIMITS);
  assert.deepEqual(parseLimits(''), DEFAULT_FEATURE_LIMITS);
  assert.deepEqual(parseLimits('{'), DEFAULT_FEATURE_LIMITS);
  assert.deepEqual(parseLimits('null'), DEFAULT_FEATURE_LIMITS);
  assert.equal(parseLimits('{"rank":100}').rank, 100);
});

// 관리자 화면에서 [무제한]을 켜면 -1이 저장된다. 그 값이 서버를 한 바퀴 돌아
// 다시 무제한으로 읽혀야 한다 — 이 왕복이 깨져서 코칭AI가 막혔었다.
test('무제한 설정이 한 바퀴 돌아도 무제한으로 남는다', () => {
  const saved = clampLimit(-1, DEFAULT_FEATURE_LIMITS.qa);
  const read = parseLimits(JSON.stringify({ qa: saved })).qa;
  assert.equal(limitState(read), 'unlimited');
});

test('내린 기능은 한 바퀴 돌아도 사용 중지로 남는다', () => {
  const saved = clampLimit(0, DEFAULT_FEATURE_LIMITS.image);
  const read = parseLimits(JSON.stringify({ image: saved })).image;
  assert.equal(limitState(read), 'disabled');
});

test('기본값: 이미지 생성은 내린 기능이고 순위 확인은 페이지 단위다', () => {
  assert.equal(DEFAULT_FEATURE_LIMITS.image, 0);
  // 깊은 조회가 한 번에 최대 5페이지를 쓴다. 40이면 하루 8번뿐이라 100으로 둔다.
  assert.ok(DEFAULT_FEATURE_LIMITS.rank >= 100);
});

// ── 한도 소진 판정 ───────────────────────────────────────────────────────────
// supabase.rpc는 실패해도 예외를 던지지 않고 { data: null, error }를 돌려준다.
// 부르는 쪽이 `if (!error && data.exceeded)`로 검사하고 있어서, 오류가 나면
// 그냥 통과했다. 이 기능들은 호출마다 실제 돈이 나간다.

const okRpc = (remaining: number) => ({ data: { exceeded: false, remaining }, error: null });
const overRpc = { data: { exceeded: true, remaining: 0 }, error: null };
const errRpc = { data: null, error: { message: 'function does not exist' } };

test('한도 판정: 정상이면 남은 횟수를 돌려준다', () => {
  const d = decideQuota(60, okRpc(41));
  assert.equal(d.allow, true);
  assert.equal(d.remaining, 41);
});

test('한도 판정: 다 쓰면 막는다', () => {
  const d = decideQuota(60, overRpc);
  assert.equal(d.allow, false);
  assert.equal(d.kind, 'exceeded');
});

// 내린 기능은 "내일 다시 오라"가 아니라 "제공하지 않는다"여야 한다
test('한도 판정: 0은 내린 기능이다', () => {
  const d = decideQuota(0, okRpc(99));
  assert.equal(d.allow, false);
  assert.equal(d.kind, 'disabled');
});

// 이것이 이 파일의 이유다. 셀 수 없으면 내주지 않는다.
test('한도 판정: 집계가 실패하면 막는다 — 통과시키면 한도가 통째로 풀린다', () => {
  const d = decideQuota(60, errRpc);
  assert.equal(d.allow, false);
  assert.equal(d.kind, 'error');
});

test('한도 판정: rpc 결과가 비어도 막는다', () => {
  assert.equal(decideQuota(60, { data: null, error: null }).allow, false);
  assert.equal(decideQuota(60, null).allow, false);
});

// 셀 것이 없는데 셈이 안 된다고 막으면 그건 그냥 고장이다
test('한도 판정: 무제한은 집계가 실패해도 내준다', () => {
  assert.equal(decideQuota(-1, errRpc).allow, true);
  assert.equal(decideQuota(-1, { data: null, error: null }).allow, true);
});

// 내린 기능은 집계 결과와 무관하게 결론이 같다
test('한도 판정: 내린 기능은 집계가 실패해도 막는다', () => {
  const d = decideQuota(0, errRpc);
  assert.equal(d.allow, false);
  assert.equal(d.kind, 'disabled');
});

// RPC가 스스로 '내린 기능'이라고 말하면 그 말을 따른다
test('한도 판정: RPC가 disabled라고 하면 그대로 전한다', () => {
  const d = decideQuota(5, { data: { exceeded: true, disabled: true }, error: null });
  assert.equal(d.kind, 'disabled');
});

test('한도 응답: 갈래마다 다른 상태코드를 준다', () => {
  const disabled = quotaResponse({ allow: false, kind: 'disabled', remaining: null }, '코칭AI', 0);
  assert.equal(disabled.status, 403);
  assert.equal(disabled.body.disabled, true);

  const exceeded = quotaResponse({ allow: false, kind: 'exceeded', remaining: 0 }, '소싱 분석', 60);
  assert.equal(exceeded.status, 429);
  assert.ok(String(exceeded.body.error).includes('60'));

  // 셈 실패는 사용자 잘못이 아니다. 429로 주면 "내가 다 썼나" 하고 오해한다.
  const err = quotaResponse({ allow: false, kind: 'error', remaining: null }, '소싱 분석', 60);
  assert.equal(err.status, 503);
  assert.equal(err.body.retryable, true);
});
