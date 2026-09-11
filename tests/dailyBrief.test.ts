/**
 * 아침 브리핑 테스트.
 *
 * 매일 가는 메일이라 잘못 보내면 바로 스팸 처리된다. 그러면 결제 실패나
 * 수집 중단 같은 진짜 급한 메일까지 같이 안 보이게 된다. "보낼 만한 날인가"와
 * "정말 발주해야 하는가" 두 판단이 이 기능의 전부다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsReorder, briefWorthSending, briefHtml, type BriefData } from '../api/coupang.ts';

const item = (o: Partial<any> = {}): any => ({
  vendorItemId: 'v1', productName: '기모 후드 집업', optionName: 'L / 블랙',
  stock: 40, sold7: 7, sold28: 28, velocity: 1, daysLeft: 40, reorderQty: 0,
  risk: 'ok', coupangSold30: null, ...o,
});

const brief = (o: Partial<BriefData> = {}): BriefData => ({
  orderAmount: 0, quantity: 0, prevOrderAmount: 0, topSellers: [],
  reorder: [], newInquiries: 0, newReturns: 0, leadTimeDays: 14, ...o,
});

test('발주: 리드타임 안에 떨어지는 것만 고른다', () => {
  const rows = [
    item({ vendorItemId: 'a', daysLeft: 5 }),    // 14일 안에 떨어짐 → 대상
    item({ vendorItemId: 'b', daysLeft: 13 }),   // 경계 안쪽 → 대상
    item({ vendorItemId: 'c', daysLeft: 14 }),   // 딱 리드타임 → 대상 (지금 주문해야 겨우 맞는다)
    item({ vendorItemId: 'd', daysLeft: 15 }),   // 아직 여유 → 제외
    item({ vendorItemId: 'e', daysLeft: 200 }),  // 제외
  ];
  const picked = needsReorder(rows, 14).map(r => r.vendorItemId);
  assert.deepEqual(picked, ['a', 'b', 'c']);
});

test('발주: 급한 것부터 나온다', () => {
  const rows = [item({ vendorItemId: 'a', daysLeft: 10 }), item({ vendorItemId: 'b', daysLeft: 2 })];
  assert.deepEqual(needsReorder(rows, 14).map(r => r.vendorItemId), ['b', 'a']);
});

// 품절은 남은 일수가 0이라 리드타임 비교로는 걸리지만, 판매 속도가 0이면
// daysLeft가 null로 와서 빠질 수 있다. 품절은 어떤 경우에도 알려야 한다.
test('발주: 이미 품절이면 판매 속도와 무관하게 포함한다', () => {
  const rows = [item({ vendorItemId: 'out', risk: 'out', daysLeft: null })];
  assert.equal(needsReorder(rows, 14).length, 1);
});

// 안 팔리는 재고는 발주할 이유가 없다. 여기에 섞이면 목록이 쓸모없어진다.
test('발주: 판매가 없는 재고는 대상이 아니다', () => {
  const rows = [item({ vendorItemId: 'idle', risk: 'idle', daysLeft: null, velocity: 0 })];
  assert.deepEqual(needsReorder(rows, 14), []);
});

test('발주: 리드타임이 길면 더 많이 걸린다', () => {
  const rows = [item({ vendorItemId: 'a', daysLeft: 20 }), item({ vendorItemId: 'b', daysLeft: 35 })];
  assert.equal(needsReorder(rows, 14).length, 0);
  assert.equal(needsReorder(rows, 30).length, 1);   // 중국 소싱이면 20일도 급하다
  assert.equal(needsReorder(rows, 40).length, 2);
});

test('발주: 메일이 길어지지 않게 8개까지만', () => {
  const rows = Array.from({ length: 20 }, (_, i) => item({ vendorItemId: `v${i}`, daysLeft: i }));
  assert.equal(needsReorder(rows, 100).length, 8);
});

// 아무 일도 없던 날에 "어제 0원"을 보내면 그 메일은 곧 안 읽히고,
// 안 읽히는 메일함에는 급한 알림도 같이 묻힌다.
test('발송: 아무 일도 없던 날은 보내지 않는다', () => {
  assert.equal(briefWorthSending(brief()), false);
});

test('발송: 팔렸거나 발주할 게 있거나 문의·반품이 있으면 보낸다', () => {
  assert.equal(briefWorthSending(brief({ quantity: 1 })), true);
  assert.equal(briefWorthSending(brief({ reorder: [item()] })), true);
  assert.equal(briefWorthSending(brief({ newInquiries: 1 })), true);
  assert.equal(briefWorthSending(brief({ newReturns: 1 })), true);
});

// 판매가 0이어도 발주할 게 있으면 보낸다 — 오히려 그날이 가장 급하다.
test('발송: 판매가 없어도 발주가 급하면 보낸다', () => {
  assert.equal(briefWorthSending(brief({ quantity: 0, reorder: [item({ risk: 'out' })] })), true);
});

test('메일: 금액이 주문액임을 밝힌다', () => {
  const html = briefHtml('김대표', '2026-09-10', brief({ orderAmount: 1234000, quantity: 42 }));
  assert.ok(html.includes('1,234,000원'));
  assert.ok(html.includes('주문액'), '정산 순이익과 헷갈리지 않게 기준을 적어야 한다');
  assert.ok(html.includes('끌 수 있습니다'), '수신 거부 방법이 있어야 한다');
});

test('메일: 지난주 같은 요일과 견준다', () => {
  const up = briefHtml('김', '2026-09-10', brief({ orderAmount: 200000, quantity: 5, prevOrderAmount: 100000 }));
  assert.ok(up.includes('100%'));
  assert.ok(up.includes('▲'));
  const down = briefHtml('김', '2026-09-10', brief({ orderAmount: 50000, quantity: 5, prevOrderAmount: 100000 }));
  assert.ok(down.includes('▼'));
});

test('메일: 비교할 지난주가 없으면 지어내지 않는다', () => {
  const html = briefHtml('김', '2026-09-10', brief({ orderAmount: 200000, quantity: 5, prevOrderAmount: 0 }));
  assert.ok(html.includes('비교 없음'));
  assert.ok(!html.includes('▲'));
});

test('메일: 발주 항목에 남은 일수와 수량이 들어간다', () => {
  const html = briefHtml('김', '2026-09-10', brief({
    quantity: 3,
    reorder: [item({ daysLeft: 6, reorderQty: 120, risk: 'urgent' })],
    leadTimeDays: 30,
  }));
  assert.ok(html.includes('6일'));
  assert.ok(html.includes('120개 발주'));
  assert.ok(html.includes('리드타임 30일'));
});

test('메일: 품절은 일수 대신 품절이라고 쓴다', () => {
  const html = briefHtml('김', '2026-09-10', brief({
    quantity: 1, reorder: [item({ risk: 'out', daysLeft: null, reorderQty: 50 })],
  }));
  assert.ok(html.includes('품절'));
});

// 상품명은 판매자가 직접 지은 값이라 따옴표나 꺾쇠가 들어갈 수 있다
test('메일: 상품명의 HTML을 이스케이프한다', () => {
  const html = briefHtml('김', '2026-09-10', brief({
    quantity: 1,
    topSellers: [{ name: '<script>alert(1)</script>', qty: 1, amount: 1000 }],
  }));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('메일: 발주할 게 없으면 그 구획이 아예 없다', () => {
  const html = briefHtml('김', '2026-09-10', brief({ orderAmount: 50000, quantity: 2 }));
  assert.ok(!html.includes('지금 발주해야 할 것'));
});
