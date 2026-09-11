/**
 * 긴 목록 조회 분할 테스트.
 *
 * PostgREST의 .in()은 값을 전부 주소에 이어 붙인다. 수백 개가 되면 주소가
 * 상한을 넘어 요청이 통째로 거부되는데, 부르는 쪽은 대개 `|| []`로 받아
 * 넘기므로 "결과 없음"과 구분되지 않는다. 소싱 크론이 실제로 그랬다 —
 * 캐시 나이를 못 읽으면 20시간 건너뛰기가 함께 죽어 매번 다시 긁는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectIn, runIn } from '../src/lib/chunkedIn.ts';

test('조각으로 나눠 부르고 결과를 이어 붙인다', async () => {
  const seen: string[][] = [];
  const values = Array.from({ length: 250 }, (_, i) => `k${i}`);
  const r = await selectIn<{ v: string }>(values, chunk => {
    seen.push(chunk);
    return Promise.resolve({ data: chunk.map(v => ({ v })) });
  }, 100);
  assert.equal(seen.length, 3, '100씩 세 조각');
  assert.deepEqual(seen.map(c => c.length), [100, 100, 50]);
  assert.equal(r.rows.length, 250);
  assert.equal(r.failedChunks, 0);
});

test('중복과 빈 값을 걸러 낸다', async () => {
  const seen: string[][] = [];
  const r = await selectIn<{ v: string }>(['a', 'a', '', 'b', 'b', 'c'], chunk => {
    seen.push(chunk);
    return Promise.resolve({ data: chunk.map(v => ({ v })) });
  }, 100);
  assert.deepEqual(seen[0], ['a', 'b', 'c']);
  assert.equal(r.rows.length, 3);
});

test('빈 목록이면 아예 부르지 않는다', async () => {
  let called = 0;
  const r = await selectIn([], () => { called++; return Promise.resolve({ data: [] }); });
  assert.equal(called, 0);
  assert.deepEqual(r, { rows: [], failedChunks: 0 });
});

// 한 조각이 실패했다고 전부 버리면 조용한 실패로 돌아간다
test('한 조각이 실패해도 나머지는 살린다', async () => {
  let n = 0;
  const values = Array.from({ length: 30 }, (_, i) => `k${i}`);
  const r = await selectIn<{ v: string }>(values, chunk => {
    n++;
    if (n === 2) return Promise.resolve({ data: null, error: { message: 'URI too long' } });
    return Promise.resolve({ data: chunk.map(v => ({ v })) });
  }, 10);
  assert.equal(r.rows.length, 20, '세 조각 중 둘은 살았다');
  assert.equal(r.failedChunks, 1, '실패를 숨기지 않는다');
});

test('조각이 예외를 던져도 나머지는 살린다', async () => {
  let n = 0;
  const values = Array.from({ length: 30 }, (_, i) => `k${i}`);
  const r = await selectIn<{ v: string }>(values, chunk => {
    n++;
    if (n === 1) throw new Error('망 오류');
    return Promise.resolve({ data: chunk.map(v => ({ v })) });
  }, 10);
  assert.equal(r.rows.length, 20);
  assert.equal(r.failedChunks, 1);
});

test('runIn: 실행만 하고 실패 조각 수를 돌려준다', async () => {
  const seen: string[][] = [];
  let n = 0;
  const failed = await runIn(Array.from({ length: 25 }, (_, i) => `k${i}`), chunk => {
    seen.push(chunk);
    n++;
    if (n === 2) throw new Error('실패');
    return Promise.resolve(null);
  }, 10);
  assert.equal(seen.length, 3);
  assert.equal(failed, 1);
});
