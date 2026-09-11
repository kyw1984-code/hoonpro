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
  stock: 40, sold7: 7, sold28: 28, sold14: 14, velocity: 1, daysLeft: 40, reorderQty: 0,
  risk: 'ok', coupangSold30: null, reorderMode: 'auto', ...o,
});

const brief = (o: Partial<BriefData> = {}): BriefData => ({
  orderAmount: 0, quantity: 0, prevOrderAmount: 0, byChannel: { wing: 0, growth: 0 }, topSellers: [],
  reorder: [], newInquiries: 0, newReturns: 0, leadTimeDays: 14,
  minSales14: 3, seasonalSkipped: 0,
  adGap: { lastAdDate: '2026-09-09', missingDays: 1, missingWithSales: 1, overstatedBy: 0, shouldWarn: false, never: false },
  ...o,
});

/** 광고비가 비어 있는 상태 */
const gap = (o: Partial<BriefData['adGap']> = {}): BriefData['adGap'] => ({
  lastAdDate: '2026-09-07', missingDays: 3, missingWithSales: 3,
  overstatedBy: 194000, shouldWarn: true, never: false, ...o,
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

// ── 시즌 지난 상품 빼기 ────────────────────────────────────────
// 여름 나시티가 9월에 품절인 건 사고가 아니라 계절이다. 매일 같은 목록이
// 올라오면 그 메일은 안 읽히고, 진짜 급한 품절도 함께 묻힌다.

test('시즌: 최근 판매가 끊긴 상품은 품절이어도 빼낸다', () => {
  const rows = [
    item({ vendorItemId: '여름나시티', risk: 'out', stock: 0, daysLeft: null, sold14: 0, sold28: 3 }),
    item({ vendorItemId: '가을집업', risk: 'out', stock: 0, daysLeft: null, sold14: 39, sold28: 39 }),
  ];
  assert.deepEqual(needsReorder(rows, 28, 3).map(r => r.vendorItemId), ['가을집업']);
});

// 28일에는 지난 시즌의 끝자락이 섞여 있어 이미 끝난 상품이 아직 팔리는 것처럼 보인다
test('시즌: 28일이 아니라 14일로 판단한다', () => {
  const 끝물 = item({ vendorItemId: '끝물', risk: 'out', stock: 0, daysLeft: null, sold14: 1, sold28: 20 });
  assert.equal(needsReorder([끝물], 28, 3).length, 0);
});

test('시즌: 기준을 0으로 두면 자동 판단을 끈다', () => {
  const rows = [item({ vendorItemId: 'a', risk: 'out', stock: 0, daysLeft: null, sold14: 0 })];
  assert.equal(needsReorder(rows, 28, 0).length, 1);
  assert.equal(needsReorder(rows, 28, 3).length, 0);
});

// 자동 판단은 '곧 시작될 시즌'을 알 수 없다. 겨울 상품은 9월에 안 팔리지만
// 10월 발주는 해야 한다. 손으로 고정한 규칙이 항상 우선한다.
test('시즌: always로 고정하면 판매가 없어도 알린다', () => {
  const 겨울패딩 = item({
    vendorItemId: '겨울패딩', risk: 'out', stock: 0, daysLeft: null,
    sold14: 0, sold28: 0, reorderMode: 'always',
  });
  assert.deepEqual(needsReorder([겨울패딩], 28, 3).map(r => r.vendorItemId), ['겨울패딩']);
});

test('시즌: exclude로 고정하면 잘 팔려도 빼낸다', () => {
  const 단종 = item({
    vendorItemId: '단종', risk: 'out', stock: 0, daysLeft: null,
    sold14: 50, sold28: 90, reorderMode: 'exclude',
  });
  assert.equal(needsReorder([단종], 28, 3).length, 0);
});

// always가 '급하지 않은 것까지 전부 알린다'는 뜻은 아니다. 재고가 넉넉하면
// 매일 목록에 올릴 이유가 없다.
test('시즌: always여도 급하지 않으면 알리지 않는다', () => {
  const 여유 = item({ vendorItemId: '여유', risk: 'ok', stock: 500, daysLeft: 200, sold14: 0, reorderMode: 'always' });
  assert.equal(needsReorder([여유], 28, 3).length, 0);
});

test('메일: 시즌으로 뺀 게 있으면 몇 개를 뺐는지 밝힌다', () => {
  const html = briefHtml('김', '2026-09-10', brief({
    quantity: 3, reorder: [item({ risk: 'out', daysLeft: null, sold14: 20 })],
    minSales14: 3, seasonalSkipped: 6,
  }));
  assert.ok(html.includes('6개는 시즌이 지난 것으로 보고 뺐습니다'));
});

test('메일: 뺀 게 없으면 그 말을 하지 않는다', () => {
  const html = briefHtml('김', '2026-09-10', brief({
    quantity: 3, reorder: [item({ risk: 'out', daysLeft: null, sold14: 20 })], seasonalSkipped: 0,
  }));
  assert.ok(!html.includes('시즌이 지난 것으로'));
});

// ── 광고비 공백 알림 ───────────────────────────────────────────
// 쿠팡이 광고비를 API로 주지 않아 이것만 판매자가 직접 가져와야 한다.
// 그 한 번을 잊으면 그날부터 순이익이 광고비만큼 크게 나온다.

test('광고비: 비어 있으면 얼마나 부풀려졌는지 금액으로 말한다', () => {
  const html = briefHtml('김', '2026-09-10', brief({ quantity: 5, adGap: gap() }));
  assert.ok(html.includes('광고비를 가져와 주세요'));
  assert.ok(html.includes('2026-09-07 이후로 비어 있습니다'));
  assert.ok(html.includes('194,000원쯤 크게'));
  assert.ok(html.includes('advertising.coupang.com'), '어디로 가야 하는지 알려줘야 한다');
});

test('광고비: 정상이면 아무 말도 하지 않는다', () => {
  const html = briefHtml('김', '2026-09-10', brief({ quantity: 5 }));
  assert.ok(!html.includes('광고비를 가져와 주세요'));
});

// 금액을 모를 때 0원이라고 쓰면 "광고비가 0원이구나"로 읽힌다
test('광고비: 금액을 모르면 금액 말을 빼고 사실만 알린다', () => {
  const html = briefHtml('김', '2026-09-10', brief({
    quantity: 5, adGap: gap({ never: true, lastAdDate: null, overstatedBy: 0 }),
  }));
  assert.ok(html.includes('아직 한 번도 가져오지 않았습니다'));
  assert.ok(!html.includes('0원쯤 크게'));
});

// 광고비가 비면 이 메일의 다른 숫자까지 틀린 것이 된다. 팔린 게 없어도 알려야 한다.
test('광고비: 조용한 날이어도 광고비가 비었으면 메일을 보낸다', () => {
  assert.equal(briefWorthSending(brief()), false);
  assert.equal(briefWorthSending(brief({ adGap: gap() })), true);
});

// ── 창구 구분 ────────────────────────────────────────────────────────────────
// 윙과 로켓그로스는 서로 다른 상품이고 저장되는 테이블도 다르다. 발주서만 읽으면
// 그로스가 통째로 빠진다. 그로스가 매출의 8할인 판매자에게는 메일 전체가 틀린 것이
// 되므로, 합계에 들어갔는지와 어느 쪽이 얼마인지를 함께 고정해 둔다.

test('창구: 양쪽을 다 쓰면 각각 얼마인지 밝힌다', () => {
  const html = briefHtml('김', '2026-09-10', brief({
    orderAmount: 1_570_800, quantity: 39,
    byChannel: { wing: 1_375_600, growth: 195_200 },
  }));
  assert.ok(html.includes('로켓그로스'), '그로스 금액이 없다');
  assert.ok(html.includes('195,200'), html.slice(0, 400));
  assert.ok(html.includes('1,375,600'));
});

// 한쪽만 쓰는 판매자에게 "윙 0원"은 알려 줄 것이 없는 줄이다
test('창구: 한쪽만 쓰면 구분 줄을 보이지 않는다', () => {
  const onlyWing = briefHtml('김', '2026-09-10', brief({
    orderAmount: 500_000, quantity: 10, byChannel: { wing: 500_000, growth: 0 },
  }));
  assert.ok(!onlyWing.includes('로켓그로스'));

  const onlyGrowth = briefHtml('김', '2026-09-10', brief({
    orderAmount: 500_000, quantity: 10, byChannel: { wing: 0, growth: 500_000 },
  }));
  assert.ok(!onlyGrowth.includes('로켓그로스'));
});

// 합계는 두 창구를 더한 값이어야 한다. 이게 어긋나면 카드의 큰 숫자와
// 그 아래 구분 줄이 서로 다른 말을 한다.
test('창구: 합계가 두 창구의 합과 맞는다', () => {
  const d = brief({
    orderAmount: 1_570_800, quantity: 39,
    byChannel: { wing: 1_375_600, growth: 195_200 },
  });
  assert.equal(d.byChannel.wing + d.byChannel.growth, d.orderAmount);
  assert.ok(briefHtml('김', '2026-09-10', d).includes('1,570,800'));
});
