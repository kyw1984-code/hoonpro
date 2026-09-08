/**
 * 부가세 계산 테스트.
 *
 * 요금표 가격은 공급가액이고 실제 청구액은 세액을 더한 값이다. 이 둘이 어긋나면
 * 화면에 보이는 금액과 카드에 찍히는 금액이 달라진다 — 결제 분쟁의 첫 번째 원인이다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withVat } from '../src/lib/vat.ts';

test('withVat: 공급가액에 10%를 더한다', () => {
  assert.deepEqual(withVat(39800), { supply: 39800, vat: 3980, total: 43780 });
  assert.deepEqual(withVat(59800), { supply: 59800, vat: 5980, total: 65780 });
  // 연간 (12개월치)
  assert.deepEqual(withVat(357600), { supply: 357600, vat: 35760, total: 393360 });
});

test('withVat: 원 단위로 반올림하고 음수는 0으로', () => {
  assert.deepEqual(withVat(19805), { supply: 19805, vat: 1981, total: 21786 });
  assert.deepEqual(withVat(0), { supply: 0, vat: 0, total: 0 });
  assert.deepEqual(withVat(-100), { supply: 0, vat: 0, total: 0 });
});

// 할인은 공급가액에 먼저 적용하고 그 결과에 세액을 붙인다.
// 순서를 바꾸면 세액이 할인 전 금액 기준이 되어 실제보다 많이 걷힌다.
test('withVat: 할인 뒤 공급가액에 세액을 붙인다', () => {
  const 정가 = 39800;
  const 할인 = 10000;
  const 결제 = withVat(정가 - 할인);
  assert.equal(결제.supply, 29800);
  assert.equal(결제.vat, 2980);
  assert.equal(결제.total, 32780);
  // 할인 전에 세액을 붙였다면 43,780 − 10,000 = 33,780원이 되어 1,000원 더 걷힌다
  assert.notEqual(결제.total, withVat(정가).total - 할인);
});
