/**
 * 표시 헬퍼 테스트.
 *
 * pct라는 이름의 함수가 화면마다 따로 있었고 계약이 서로 반대였다. 공용
 * 함수는 12.5를 받아 "12.5%"를 내고, 반품 화면의 지역 함수는 0.125를 받아
 * 같은 값을 냈다. 같은 반품 화면 안에서 형제 컴포넌트 둘이 그 상태였다.
 * 한 줄을 옮겨 붙이면 숫자가 100배 어긋나는데 타입 오류도 안 난다.
 *
 * 이제 이름을 나눴다. 두 계약을 여기서 못 박아 둔다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { won, pct, ratioPct } from '../src/lib/coupang.ts';

test('pct: 이미 퍼센트인 값을 받는다', () => {
  assert.equal(pct(12.5), '12.5%');
  assert.equal(pct(100), '100.0%');
  assert.equal(pct(7.7, 1), '7.7%');
});

test('ratioPct: 비율을 받는다', () => {
  assert.equal(ratioPct(0.125), '12.5%');
  assert.equal(ratioPct(0.077), '7.7%');
  assert.equal(ratioPct(1), '100.0%');
});

// 둘을 바꿔 쓰면 100배 어긋난다. 그게 이 테스트의 이유다.
test('pct와 ratioPct는 100배 차이가 난다', () => {
  assert.equal(pct(7.7), ratioPct(0.077));
  assert.notEqual(pct(0.077), ratioPct(0.077));
});

test('빈 값은 둘 다 대시', () => {
  for (const f of [pct, ratioPct, won]) {
    assert.equal(f(null), '-');
    assert.equal(f(undefined), '-');
    assert.equal(f(NaN), '-');
  }
});

test('won: 반올림하고 천단위를 끊는다', () => {
  assert.equal(won(1375600), '1,375,600원');
  assert.equal(won(12345.678), '12,346원');
  assert.equal(won(0), '0원');
});
