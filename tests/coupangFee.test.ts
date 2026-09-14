import test from 'node:test';
import assert from 'node:assert/strict';
import { COUPANG_FEE_RATE_PCT, coupangCommission } from '../src/lib/coupangFee.ts';

test('수수료율은 10.8%(부가세 별도)의 부가세 포함 값이다', () => {
  // 10.8 * 1.1은 부동소수점 때문에 11.880000000000003이 된다.
  // 상수는 11.88로 박아 두고, 여기서는 그 값이 맞는지만 본다.
  assert.equal(COUPANG_FEE_RATE_PCT, 11.88);
  assert.ok(Math.abs(COUPANG_FEE_RATE_PCT - 10.8 * 1.1) < 1e-9);
});

test('수수료는 쿠폰을 뺀 실결제액에 붙는다', () => {
  // 주문단가 36,400 · 개당쿠폰 15,982 → 실결제 20,418
  assert.equal(coupangCommission(20418), 2426);
  // 주문금액에 그대로 곱하면 4,324원이 되어 1,898원이 더 걷힌 것으로 잡힌다.
  // 쿠폰을 많이 쓰는 판매자일수록 이 차이가 커진다.
  assert.equal(coupangCommission(36400), 4324);
});

test('음수는 0으로 본다 — 쿠폰이 판매가를 넘어도 수수료가 음수가 되지 않는다', () => {
  assert.equal(coupangCommission(-5000), 0);
  assert.equal(coupangCommission(0), 0);
});
