import test from 'node:test';
import assert from 'node:assert/strict';
import { CRON_JOBS, foldCronHealth, agoLabel } from '../src/lib/cronHeartbeat.ts';

const NOW = Date.parse('2026-09-14T12:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();

test('한 번도 안 돈 것과 늦은 것을 가른다', () => {
  // 갓 배포한 크론은 아직 안 돈 게 정상이다. 둘을 같은 빨간불로 묶으면
  // 진짜 멈춤을 못 알아본다.
  const none = foldCronHealth([], NOW);
  assert.equal(none.length, CRON_JOBS.length);
  assert.ok(none.every(j => j.status === 'never'));
  assert.ok(none.every(j => j.minutesAgo === null));
});

test('주기 안에 돌았으면 정상이다', () => {
  const rows = [{ job: 'coupang-sync', run_at: ago(40), ok: true }];
  const sync = foldCronHealth(rows, NOW).find(j => j.job === 'coupang-sync')!;
  assert.equal(sync.status, 'ok');
  assert.equal(sync.minutesAgo, 40);
});

test('여유 시간을 넘기면 늦은 것이다', () => {
  // 매출 동기화는 매시간 돈다. 3시간을 넘기면 멈춘 것으로 본다.
  const rows = [{ job: 'coupang-sync', run_at: ago(4 * 60), ok: true }];
  const sync = foldCronHealth(rows, NOW).find(j => j.job === 'coupang-sync')!;
  assert.equal(sync.status, 'late');
});

test('한 번의 실패로는 빨간불을 켜지 않는다 — 쿠팡 API는 자주 흔들린다', () => {
  const rows = [{ job: 'coupang-sync', run_at: ago(10), ok: false }];
  const sync = foldCronHealth(rows, NOW).find(j => j.job === 'coupang-sync')!;
  assert.equal(sync.status, 'ok');
  assert.equal(sync.lastOk, false);
  assert.equal(sync.recentFailures, 1);
});

test('연달아 실패하면 앓고 있는 것이다', () => {
  const rows = [
    { job: 'coupang-sync', run_at: ago(10), ok: false },
    { job: 'coupang-sync', run_at: ago(70), ok: false },
    { job: 'coupang-sync', run_at: ago(130), ok: true },
  ];
  const sync = foldCronHealth(rows, NOW).find(j => j.job === 'coupang-sync')!;
  assert.equal(sync.status, 'failing');
  assert.equal(sync.recentFailures, 2);
});

test('가장 최근 실행으로 판단한다 — 기록 순서가 뒤섞여 들어와도', () => {
  const rows = [
    { job: 'billing-charge', run_at: ago(3 * 24 * 60), ok: true },
    { job: 'billing-charge', run_at: ago(30), ok: true, detail: '구독 3건 갱신' },
  ];
  const b = foldCronHealth(rows, NOW).find(j => j.job === 'billing-charge')!;
  assert.equal(b.status, 'ok');
  assert.equal(b.minutesAgo, 30);
  assert.equal(b.lastDetail, '구독 3건 갱신');
});

test('자동결제가 멈추면 무엇이 멈추는지 함께 말해 준다', () => {
  const b = foldCronHealth([], NOW).find(j => j.job === 'billing-charge')!;
  assert.match(b.impact, /구독이 갱신되지 않습니다/);
});

test('지난 시간은 사람이 읽는 말로', () => {
  assert.equal(agoLabel(null), '기록 없음');
  assert.equal(agoLabel(0), '방금');
  assert.equal(agoLabel(40), '40분 전');
  assert.equal(agoLabel(150), '2시간 전');
  assert.equal(agoLabel(3 * 24 * 60), '3일 전');
});
