/**
 * 1688 매입 개당 원가 테스트.
 * 환율·배송비·관세가 개당으로 제대로 나뉘고, 부가세는 설정에 따라 들고 나야 한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landedTotal, landedUnit, weightedUnitCost, type PurchaseInput } from '../src/lib/landedCost.ts';

const base: PurchaseInput = {
  qty: 100, unitPriceCny: 20, fxRate: 190, domesticShipCny: 50,
  intlShipKrw: 120000, customsKrw: 30000, vatKrw: 45000, otherKrw: 5000, includeVat: false,
};

test('총액 = (위안 단가×수량 + 중국배송비)×환율 + 원화 비용, 부가세는 기본 제외', () => {
  // (20×100 + 50)×190 = 389,500 + 120,000 + 30,000 + 5,000 = 544,500
  assert.equal(landedTotal(base), 544500);
  assert.equal(landedUnit(base), 5445);
});

test('간이과세자면 부가세를 원가에 넣는다', () => {
  assert.equal(landedTotal({ ...base, includeVat: true }), 544500 + 45000);
});

test('수량 0이면 개당 원가 0, 가중평균에서도 빠진다', () => {
  assert.equal(landedUnit({ ...base, qty: 0 }), 0);
  assert.equal(weightedUnitCost([{ ...base, qty: 0 }]), null);
});

test('가중평균은 총액 ÷ 총수량이다 (단순 평균이 아니다)', () => {
  const a: PurchaseInput = { ...base, qty: 100 };                   // 5,445원
  const b: PurchaseInput = { ...base, qty: 300, fxRate: 200, intlShipKrw: 300000, customsKrw: 0, otherKrw: 0 };
  // b: (20×300+50)×200 = 1,210,000 + 300,000 = 1,510,000 → 개당 5,033
  assert.equal(landedUnit(b), 5033);
  // 합: (544,500 + 1,510,000) / 400 = 5,136
  assert.equal(weightedUnitCost([a, b]), 5136);
});
