// 정산AI 하위 화면 13개를 채우는 가짜 데이터. 모양은 src/lib/coupang.ts 타입을 따른다.
import { shellMocks, profitMocks } from './mocks.mjs';

const TODAY = '2026-09-28';
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const won = (n) => n.toLocaleString('ko-KR') + '원';

export const status = {
  connected: true, vendorId: 'A00123456', accessKeyMasked: 'a1b2c3******x9y8', status: 'active',
  lastSyncAt: new Date(Date.now() - 42 * 60000).toISOString(), lastSyncError: null,
  keyExpiresAt: '2027-03-01', daysToExpiry: 154, itemCount: 84, salesDays: 92, relayIp: null,
};

// ── 옵션 목록 (원가 입력·매입 원가·재고 등에서 공유) ──
const items = [
  ['7001', '데일리 라운드넥 니트 티셔츠', '블랙 / M', '900', 29900, 3000, 'growth', 128, 12400],
  ['7002', '데일리 라운드넥 니트 티셔츠', '아이보리 / M', '900', 29900, 3000, 'growth', 96, 12400],
  ['7003', '데일리 라운드넥 니트 티셔츠', '블랙 / L', '900', 29900, 3000, 'growth', 61, 12400],
  ['7004', '여성 기모 와이드 슬랙스', '차콜 / 66', '901', 34900, 0, 'growth', 84, 15100],
  ['7005', '여성 기모 와이드 슬랙스', '차콜 / 77', '901', 34900, 0, 'growth', 40, 15100],
  ['7006', '남자 반팔 나시티 4종세트', '블랙+화이트+그레이+블루 105', '902', 21900, 0, 'marketplace', 71, 9800],
  ['7007', '경량 패딩 조끼', '베이지 / L', '903', 45900, 2000, 'growth', 52, 21000],
  ['7008', '오버핏 후드 집업', '그레이 / XL', '904', 39900, 0, 'growth', 39, 0],
  ['7009', '롱원피스 3종세트', '아이보리, 블랙, 올리브 55', '905', 41200, 2000, 'growth', 33, 19600],
  ['7010', '커플 맨투맨 2장 세트', '블랙 / L', '906', 36900, 0, 'marketplace', 28, 16000],
  ['7011', '아기 내복 세트', '민트 / 90', '907', 15900, 0, 'growth', 34, 6900],
  ['7012', '여름 나시 원피스', '화이트 / FREE', '908', 25900, 0, 'growth', 2, 9000],
];
export const costRows = items.map(([vid, name, opt, sp, price, coupon, biz, sold, unitCost]) => ({
  vendorItemId: vid, productName: name, optionName: opt, sellerProductId: sp, salePrice: price, priceSource: 'detail',
  couponUnit: coupon || null, stock: 40 + sold, status: 'APPROVED', businessType: biz, resale: false, soldLast30: sold,
  unitCost, packagingCost: unitCost ? 300 : 0, shippingCost: biz === 'marketplace' && unitCost ? 3000 : 0,
  fulfillmentCost: biz === 'growth' && unitCost ? 2400 : 0, returnShippingCost: unitCost ? 6000 : 0, memo: '',
}));

// ── 진단 카드 ──
const health = {
  checkedAt: new Date().toISOString(), optionsChecked: 84,
  counts: { 'cost-missing': 2, 'thin-margin': 1, 'stock-low': 3, 'return-high': 1, idle: 1, stopped: 0 },
  items: [
    { kind: 'stock-low', severity: 'high', vendorItemId: '7001', productName: '데일리 라운드넥 니트 티셔츠', optionName: '블랙 / M', channel: 'growth', detail: '품절 · 최근 14일 41개 판매 → 하루 2.9개, 입고 권장 120개' },
    { kind: 'stock-low', severity: 'high', vendorItemId: '7004', productName: '여성 기모 와이드 슬랙스', optionName: '차콜 / 66', channel: 'growth', detail: '3일치 남음 · 하루 2.8개 · 입고 권장 90개' },
    { kind: 'stock-low', severity: 'mid', vendorItemId: '7007', productName: '경량 패딩 조끼', optionName: '베이지 / L', channel: 'growth', detail: '9일치 남음 · 하루 1.7개 · 입고 권장 60개' },
    { kind: 'cost-missing', severity: 'high', vendorItemId: '7008', productName: '오버핏 후드 집업', optionName: '그레이 / XL', channel: 'growth', detail: '30일 39개 판매 · 원가 없음 → 순이익이 1,556,100원만큼 크게 보임' },
    { kind: 'cost-missing', severity: 'mid', vendorItemId: '7012', productName: '여름 나시 원피스', optionName: '화이트 / FREE', channel: 'growth', detail: '30일 2개 판매 · 원가 없음' },
    { kind: 'thin-margin', severity: 'high', vendorItemId: '7011', productName: '아기 내복 세트', optionName: '민트 / 90', channel: 'growth', detail: '이익률 3.1% · 개당 490원 남음 → 쿠폰 1,000원이 마진을 넘음' },
    { kind: 'return-high', severity: 'mid', vendorItemId: '7009', productName: '롱원피스 3종세트', optionName: '아이보리, 블랙, 올리브 55', channel: 'growth', detail: '반품률 18% (33개 중 6개) · 사유 1위 사이즈' },
    { kind: 'idle', severity: 'low', vendorItemId: '7012', productName: '여름 나시 원피스', optionName: '화이트 / FREE', channel: 'growth', detail: '61일째 판매 없음 · 재고 42개 → 시즌 종료, 반출 또는 할인 검토' },
  ],
};

// ── 주문 시간대 ──
function orderHours(days) {
  const byHour = Array.from({ length: 24 }, (_, hour) => {
    const w = hour < 7 ? 0.2 : hour < 12 ? 0.8 : hour < 18 ? 1.0 : hour < 23 ? 1.9 : 0.9;
    const quantity = Math.round(w * 9 * (days / 28)) + (hour === 21 || hour === 22 ? 6 : 0);
    return { hour, quantity, amount: quantity * 31000 };
  });
  const byWeekday = [1.25, 0.9, 0.85, 0.9, 0.95, 1.05, 1.3].map((w, weekday) => { const quantity = Math.round(w * 38 * (days / 28)); return { weekday, quantity, amount: quantity * 31000 }; });
  const grid = byWeekday.map(d => byHour.map(h => Math.round((h.quantity * d.quantity) / 260)));
  const total = byHour.reduce((a, h) => a + h.quantity, 0);
  const peak = [...byHour].sort((a, b) => b.quantity - a.quantity).slice(0, 3);
  return { from: addDays(TODAY, -days + 1), to: TODAY, days, byHour, byWeekday, grid, peakHours: peak.map(p => p.hour).sort((a, b) => a - b), peakShare: Math.round((peak.reduce((a, p) => a + p.quantity, 0) / total) * 100), peakWeekday: 6 };
}

// ── 변경 효과 ──
const experiments = {
  today: TODAY,
  items: [
    { id: 'e1', productId: '900', productName: '데일리 라운드넥 니트 티셔츠', kind: 'price', note: '29,900 → 26,900 (쿠폰 3,000원 대신 판매가 인하)', changedOn: addDays(TODAY, -9), windowDays: 7, linked: 3, costKnown: true,
      before: { days: 7, quantity: 61, salesAmount: 1823900, adCost: 210000, profit: 486000 }, after: { days: 7, quantity: 88, salesAmount: 2367200, adCost: 214000, profit: 577000 },
      window: { beforeFrom: addDays(TODAY, -16), beforeTo: addDays(TODAY, -10), afterFrom: addDays(TODAY, -9), afterTo: addDays(TODAY, -3), complete: true },
      ranks: [{ keyword: '여자 니트티', before: 18.4, after: 11.2 }, { keyword: '라운드넥 니트', before: 7.1, after: 5.3 }],
      verdict: { tone: 'good', headline: '판매 +44% · 매출 +30% · 순이익 +19% (하루 평균) · 순위 상승', detail: '순이익이 늘었습니다. 이 변경은 유지할 만합니다.' } },
    { id: 'e2', productId: '903', productName: '경량 패딩 조끼', kind: 'thumbnail', note: '썸네일 흰 배경 → 착용컷', changedOn: addDays(TODAY, -2), windowDays: 7, linked: 1, costKnown: true,
      before: { days: 7, quantity: 12, salesAmount: 550800, adCost: 80000, profit: 131000 }, after: { days: 2, quantity: 5, salesAmount: 229500, adCost: 22000, profit: 58000 },
      window: { beforeFrom: addDays(TODAY, -9), beforeTo: addDays(TODAY, -3), afterFrom: addDays(TODAY, -2), afterTo: TODAY, complete: false },
      ranks: [], verdict: { tone: 'na', headline: '바꾼 지 2일째 — 3일은 지나야 판단합니다', detail: '하루 이틀은 요일과 우연에 흔들립니다. 조금 더 기다리세요.' } },
    { id: 'e3', productId: '905', productName: '롱원피스 3종세트', kind: 'coupon', note: '즉시할인 쿠폰 2,000원 → 4,000원', changedOn: addDays(TODAY, -20), windowDays: 7, linked: 2, costKnown: true,
      before: { days: 7, quantity: 9, salesAmount: 370800, adCost: 60000, profit: 96000 }, after: { days: 7, quantity: 13, salesAmount: 509600, adCost: 61000, profit: 71000 },
      window: { beforeFrom: addDays(TODAY, -27), beforeTo: addDays(TODAY, -21), afterFrom: addDays(TODAY, -20), afterTo: addDays(TODAY, -14), complete: true },
      ranks: [{ keyword: '롱원피스 세트', before: 24.0, after: 21.5 }],
      verdict: { tone: 'bad', headline: '판매 +44% · 매출 +37% · 순이익 −26% (하루 평균) · 순위 상승', detail: '판매는 늘었지만 순이익은 줄었습니다. 할인 폭이 마진을 넘어섰을 수 있습니다.' } },
  ],
};
const myProducts = { products: [
  { productId: '900', productName: '데일리 라운드넥 니트 티셔츠', optionCount: 3, quantity: 285, salesAmount: 8521500 },
  { productId: '901', productName: '여성 기모 와이드 슬랙스', optionCount: 2, quantity: 124, salesAmount: 4327600 },
  { productId: '903', productName: '경량 패딩 조끼', optionCount: 1, quantity: 52, salesAmount: 2386800 },
  { productId: '905', productName: '롱원피스 3종세트', optionCount: 2, quantity: 33, salesAmount: 1359600 },
] };

// ── 매입 원가 ──
const purchases = {
  rows: [
    { id: 'p1', vendorItemId: '7001', vendorItemIds: ['7001', '7002', '7003'], productName: '데일리 라운드넥 니트 티셔츠', optionName: '옵션 3개 전체', purchasedOn: addDays(TODAY, -21), qty: 300, unitPriceCny: 38, fxRate: 190.5, domesticShipCny: 60, intlShipKrw: 360000, customsKrw: 0, vatKrw: 235000, otherKrw: 15000, includeVat: false, memo: '1688 주문 8823…', total: 2557230, unit: 8524 },
    { id: 'p2', vendorItemId: '7004', vendorItemIds: ['7004', '7005'], productName: '여성 기모 와이드 슬랙스', optionName: '옵션 2개 전체', purchasedOn: addDays(TODAY, -35), qty: 150, unitPriceCny: 62, fxRate: 189.2, domesticShipCny: 40, intlShipKrw: 240000, customsKrw: 118000, vatKrw: 195000, otherKrw: 0, includeVat: false, memo: '', total: 2125080, unit: 14167 },
  ],
  summary: [
    { productName: '데일리 라운드넥 니트 티셔츠', optionCount: 3, vendorItemIds: ['7001', '7002', '7003'], records: 1, totalQty: 300, avgUnitCost: 8524, avgUnitCostMax: 8524, currentUnitCost: 12400, currentMixed: false, needsApply: true, lastPurchasedOn: addDays(TODAY, -21), options: [] },
    { productName: '여성 기모 와이드 슬랙스', optionCount: 2, vendorItemIds: ['7004', '7005'], records: 1, totalQty: 150, avgUnitCost: 14167, avgUnitCostMax: 14167, currentUnitCost: 14167, currentMixed: false, needsApply: false, lastPurchasedOn: addDays(TODAY, -35), options: [] },
  ],
};

// ── 정산 캘린더 + 정산서 대조 ──
function settlement() {
  const days = [];
  const push = (date, type, amount, status) => { let d = days.find(x => x.date === date); if (!d) { d = { date, amount: 0, items: [] }; days.push(d); } d.amount += amount; d.items.push({ type, amount, status }); };
  // 매주 수요일 윙 주정산, 매월 15일 그로스 월정산
  for (let i = -40; i <= 45; i++) { const date = addDays(TODAY, i); const wk = new Date(date + 'T00:00:00Z').getUTCDay(); if (wk === 3) push(date, '주정산', 1080000 + ((i * 7919) % 400000), date < TODAY ? '지급완료' : '지급예정'); if (date.endsWith('-15')) push(date, '로켓그로스 월정산', 4620000 + ((i * 3571) % 900000), date < TODAY ? '지급완료' : '지급예정'); }
  days.sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = days.filter(d => d.date >= TODAY);
  const in7 = upcoming.filter(d => d.date <= addDays(TODAY, 7)).reduce((a, d) => a + d.amount, 0);
  const in30 = upcoming.filter(d => d.date <= addDays(TODAY, 30)).reduce((a, d) => a + d.amount, 0);
  const paid = days.filter(d => d.date < TODAY).reduce((a, d) => a + d.amount, 0);
  const weekly = []; for (let w = -8; w < 0; w++) weekly.push({ weekStart: addDays(TODAY, w * 7), amount: 2100000 + ((w * 104729) % 700000 + 700000) % 700000 });
  return { today: TODAY, days, totals: { paid, upcoming: upcoming.reduce((a, d) => a + d.amount, 0), in7, in30, unscheduled: 0, weeklyAverage: Math.round(weekly.reduce((a, w) => a + w.amount, 0) / weekly.length), weeksObserved: 8 }, weekly };
}
const settlementCheck = { feeRate: 11.88, rows: [
  { month: '2026-09', marketSettlement: 1420000, growthSettlement: 5100000, growthNet: 5100000, coupangPaid: null, actual: null, returnQuantity: 2, ours: 1420000, reference: null, referenceSource: null, diff: null, diffRate: null, impliedGrowthFeeRate: null, verdict: 'pending', scope: 'market', salesCovered: true, recognitionComplete: false, pendingLast: 410000, note: null },
  { month: '2026-08', marketSettlement: 1120000, growthSettlement: 4200000, growthNet: 4200000, coupangPaid: 1110000, actual: null, returnQuantity: 3, ours: 1120000, reference: 1110000, referenceSource: 'coupang', diff: 10000, diffRate: 0.9, impliedGrowthFeeRate: null, verdict: 'ok', scope: 'market', salesCovered: true, recognitionComplete: true, pendingLast: 333000, note: null },
  { month: '2026-07', marketSettlement: 1380000, growthSettlement: 3900000, growthNet: 3900000, coupangPaid: 1298000, actual: 5180000, returnQuantity: 5, ours: 5280000, reference: 5180000, referenceSource: 'actual', diff: 100000, diffRate: 1.9, impliedGrowthFeeRate: 12.4, verdict: 'watch', scope: 'all', salesCovered: true, recognitionComplete: true, pendingLast: 0, note: '반품 2건 정산 지연' },
  { month: '2026-06', marketSettlement: 990000, growthSettlement: 3600000, growthNet: 3600000, coupangPaid: 986000, actual: 4580000, returnQuantity: 4, ours: 4590000, reference: 4580000, referenceSource: 'actual', diff: 10000, diffRate: 0.2, impliedGrowthFeeRate: 11.9, verdict: 'ok', scope: 'all', salesCovered: true, recognitionComplete: true, pendingLast: 0, note: null },
] };

// ── 재고 예측 ──
const invRow = (vid, name, opt, stock, sold7, sold28, risk, mode = 'auto') => { const velocity = Math.round((sold28 / 28) * 10) / 10; const daysLeft = velocity > 0 ? Math.round(stock / velocity) : null; return { vendorItemId: vid, productName: name, optionName: opt, stock, sold7, sold28, sold14: Math.round(sold28 / 2), velocity, daysLeft, reorderQty: velocity > 0 ? Math.max(0, Math.ceil(velocity * 44 - stock)) : 0, risk, coupangSold30: sold28 + 3, reorderMode: mode }; };
const inventory = { leadTimeDays: 14, coverDays: 30, counts: { out: 1, urgent: 2, watch: 2, ok: 5, idle: 1, excess: 1 }, rows: [
  invRow('7001', '데일리 라운드넥 니트 티셔츠', '블랙 / M', 0, 31, 128, 'out'),
  invRow('7004', '여성 기모 와이드 슬랙스', '차콜 / 66', 8, 22, 84, 'urgent'),
  invRow('7007', '경량 패딩 조끼', '베이지 / L', 14, 13, 52, 'urgent'),
  invRow('7002', '데일리 라운드넥 니트 티셔츠', '아이보리 / M', 38, 24, 96, 'watch'),
  invRow('7009', '롱원피스 3종세트', '아이보리, 블랙, 올리브 55', 15, 8, 33, 'watch'),
  invRow('7006', '남자 반팔 나시티 4종세트', '블랙+화이트+그레이+블루 105', 140, 16, 71, 'ok'),
  invRow('7010', '커플 맨투맨 2장 세트', '블랙 / L', 90, 7, 28, 'ok'),
  invRow('7011', '아기 내복 세트', '민트 / 90', 120, 9, 34, 'ok'),
  invRow('7003', '데일리 라운드넥 니트 티셔츠', '블랙 / L', 95, 15, 61, 'ok'),
  invRow('7008', '오버핏 후드 집업', '그레이 / XL', 130, 10, 39, 'ok'),
  invRow('7012', '여름 나시 원피스', '화이트 / FREE', 42, 0, 2, 'idle', 'exclude'),
  invRow('7005', '여성 기모 와이드 슬랙스', '차콜 / 77', 420, 9, 40, 'excess'),
] };

// ── 재고 대조 ──
const reconcile = { counts: { tracked: 4, short: 1, over: 1, pendingQty: 200 }, rows: [
  { vendorItemId: '7001', productName: '데일리 라운드넥 니트 티셔츠', optionName: '블랙 / M', stock: 0, stockSyncedAt: new Date().toISOString(), coupangSold30: 131, hasBaseline: true, baselineQty: 120, startDate: addDays(TODAY, -45), orderedTotal: 300, receivedTotal: 100, pendingQty: 200, receivedAfter: 100, soldAfter: 212, expected: 8, diff: -8, status: 'short',
    records: [{ id: 'r1', kind: 'baseline', orderedAt: null, orderedQty: null, receivedAt: addDays(TODAY, -45), receivedQty: 120, memo: '시작 기준' }, { id: 'r2', kind: 'inbound', orderedAt: addDays(TODAY, -30), orderedQty: 300, receivedAt: addDays(TODAY, -12), receivedQty: 100, memo: '1차 입고 100, 나머지 입고 대기' }],
    snapshots: Array.from({ length: 8 }, (_, i) => ({ date: addDays(TODAY, -28 + i * 4), qty: Math.max(0, 96 - i * 14) })) },
  { vendorItemId: '7004', productName: '여성 기모 와이드 슬랙스', optionName: '차콜 / 66', stock: 8, stockSyncedAt: new Date().toISOString(), coupangSold30: 87, hasBaseline: true, baselineQty: 60, startDate: addDays(TODAY, -40), orderedTotal: 150, receivedTotal: 150, pendingQty: 0, receivedAfter: 150, soldAfter: 198, expected: 12, diff: -4, status: 'short',
    records: [{ id: 'r3', kind: 'baseline', orderedAt: null, orderedQty: null, receivedAt: addDays(TODAY, -40), receivedQty: 60, memo: '' }, { id: 'r4', kind: 'inbound', orderedAt: addDays(TODAY, -35), orderedQty: 150, receivedAt: addDays(TODAY, -20), receivedQty: 150, memo: '' }], snapshots: [] },
  { vendorItemId: '7006', productName: '남자 반팔 나시티 4종세트', optionName: '블랙+화이트+그레이+블루 105', stock: 140, stockSyncedAt: new Date().toISOString(), coupangSold30: 74, hasBaseline: true, baselineQty: 200, startDate: addDays(TODAY, -50), orderedTotal: 0, receivedTotal: 0, pendingQty: 0, receivedAfter: 0, soldAfter: 66, expected: 134, diff: 6, status: 'over',
    records: [{ id: 'r5', kind: 'baseline', orderedAt: null, orderedQty: null, receivedAt: addDays(TODAY, -50), receivedQty: 200, memo: '' }], snapshots: [] },
  { vendorItemId: '7010', productName: '커플 맨투맨 2장 세트', optionName: '블랙 / L', stock: 90, stockSyncedAt: new Date().toISOString(), coupangSold30: 30, hasBaseline: true, baselineQty: 120, startDate: addDays(TODAY, -50), orderedTotal: 0, receivedTotal: 0, pendingQty: 0, receivedAfter: 0, soldAfter: 30, expected: 90, diff: 0, status: 'match', records: [{ id: 'r6', kind: 'baseline', orderedAt: null, orderedQty: null, receivedAt: addDays(TODAY, -50), receivedQty: 120, memo: '' }], snapshots: [] },
  { vendorItemId: '7007', productName: '경량 패딩 조끼', optionName: '베이지 / L', stock: 14, stockSyncedAt: new Date().toISOString(), coupangSold30: 55, hasBaseline: false, baselineQty: null, startDate: null, orderedTotal: 0, receivedTotal: 0, pendingQty: 0, receivedAfter: 0, soldAfter: 0, expected: null, diff: null, status: 'nobase', records: [], snapshots: [] },
] };

// ── 반품 ──
const returnReasons = {
  from: addDays(TODAY, -89), to: TODAY, total: 41, totalQuantity: 44, sellerFault: 19, totalSold: 1240, returnRate: 0.033, cancelledCount: 3,
  categories: [
    { category: 'size', label: '사이즈', count: 14, quantity: 15, share: 0.34, actionable: true, advice: '상세페이지 상단에 실측 표와 모델 체형(키·몸무게)을 넣고, 옵션명에 "크게 나옴/정사이즈"를 적으세요.', samples: ['생각보다 커요', '66인데 77 같아요', '기장이 길어요'] },
    { category: 'changed', label: '단순 변심', count: 11, quantity: 12, share: 0.27, actionable: false, advice: '줄이기 어려운 유형입니다. 반품 배송비 정책만 확인하세요.', samples: ['마음에 안 들어요', '다른 곳에서 샀어요'] },
    { category: 'mismatch', label: '사진과 다름', count: 8, quantity: 8, share: 0.2, actionable: true, advice: '색상별 실물 사진과 원단 접사를 넣으세요. 보정 강한 화보컷 한 장이 반품을 만듭니다.', samples: ['색이 사진보다 어두워요', '원단이 얇아요'] },
    { category: 'defect', label: '불량·파손', count: 5, quantity: 6, share: 0.12, actionable: true, advice: '입고 검수 항목에 봉제·오염을 추가하세요. 같은 로트에서 반복되면 거래처에 교환 요청.', samples: ['실밥이 풀려 있어요', '얼룩'] },
    { category: 'other', label: '기타', count: 3, quantity: 3, share: 0.07, actionable: false, advice: '', samples: [] },
  ],
  products: [
    { productName: '롱원피스 3종세트', returnCount: 9, returnQuantity: 9, sold: 52, returnRate: 0.17, sellerFault: 6, topCategory: { category: 'size', label: '사이즈', count: 6, share: 0.67, advice: '실측 표와 체형별 추천 사이즈를 상단에.' }, categories: [] },
    { productName: '여성 기모 와이드 슬랙스', returnCount: 8, returnQuantity: 8, sold: 130, returnRate: 0.06, sellerFault: 5, topCategory: { category: 'size', label: '사이즈', count: 5, share: 0.63, advice: '허리·밑위 실측을 옵션별로.' }, categories: [] },
    { productName: '데일리 라운드넥 니트 티셔츠', returnCount: 7, returnQuantity: 8, sold: 300, returnRate: 0.03, sellerFault: 3, topCategory: { category: 'mismatch', label: '사진과 다름', count: 3, share: 0.43, advice: '색상별 실물컷 추가.' }, categories: [] },
  ],
};
const returns = (days) => ({ from: addDays(TODAY, -days + 1), to: TODAY, missingReturnCost: 1,
  totals: { count: days === 30 ? 14 : 41, quantity: days === 30 ? 15 : 44, soldQuantity: days === 30 ? 612 : 1240, returnRate: days === 30 ? 2.4 : 3.5, shippingLoss: days === 30 ? 66000 : 198000, sellerFaultCount: days === 30 ? 7 : 19, exchangeCount: days === 30 ? 2 : 6, cancelledCount: days === 30 ? 1 : 3 },
  reasons: [{ reason: '사이즈가 맞지 않음', count: 5, share: 36 }, { reason: '단순 변심', count: 4, share: 29 }, { reason: '상품이 설명과 다름', count: 3, share: 21 }, { reason: '상품 불량', count: 2, share: 14 }],
  rows: [
    { vendorItemId: '7009', productName: '롱원피스 3종세트', optionName: '아이보리, 블랙, 올리브 55', count: 4, quantity: 4, soldQuantity: 33, returnRate: 12.1, shippingLoss: 24000, sellerFaultCount: 3, topReason: '사이즈가 맞지 않음', costEntered: true },
    { vendorItemId: '7004', productName: '여성 기모 와이드 슬랙스', optionName: '차콜 / 66', count: 3, quantity: 3, soldQuantity: 84, returnRate: 3.6, shippingLoss: 18000, sellerFaultCount: 2, topReason: '사이즈가 맞지 않음', costEntered: true },
    { vendorItemId: '7001', productName: '데일리 라운드넥 니트 티셔츠', optionName: '블랙 / M', count: 3, quantity: 4, soldQuantity: 128, returnRate: 2.3, shippingLoss: 18000, sellerFaultCount: 1, topReason: '단순 변심', costEntered: true },
    { vendorItemId: '7008', productName: '오버핏 후드 집업', '옵션': '', optionName: '그레이 / XL', count: 2, quantity: 2, soldQuantity: 39, returnRate: 5.1, shippingLoss: 0, sellerFaultCount: 1, topReason: '상품이 설명과 다름', costEntered: false },
  ] });

// ── 고객문의 ──
const inquiries = { inquiries: [
  { inquiryId: 'q1', vendorItemId: '7004', productName: '여성 기모 와이드 슬랙스', content: '66 사이즈 허리 실측이 몇 cm인가요? 평소 27인치 입어요. 그리고 기모라 두꺼운가요?', customerName: '김*희', inquiredAt: new Date(Date.now() - 3 * 3600_000).toISOString(), answered: false, draft: null, draftAt: null, repliedAt: null },
  { inquiryId: 'q2', vendorItemId: '7001', productName: '데일리 라운드넥 니트 티셔츠', content: '블랙 M 재입고 언제 되나요?', customerName: '박*수', inquiredAt: new Date(Date.now() - 9 * 3600_000).toISOString(), answered: false, draft: null, draftAt: null, repliedAt: null },
  { inquiryId: 'q3', vendorItemId: '7007', productName: '경량 패딩 조끼', content: '세탁기 돌려도 되나요?', customerName: '이*정', inquiredAt: new Date(Date.now() - 30 * 3600_000).toISOString(), answered: true, draft: null, draftAt: null, repliedAt: new Date(Date.now() - 28 * 3600_000).toISOString() },
] };
const inquiryDraft = '안녕하세요, 고객님. 문의 주셔서 감사합니다.\n\n66 사이즈 허리 실측은 단면 36cm(둘레 72cm)이며 밴딩이 있어 27인치까지 편하게 착용하실 수 있습니다. 안감은 얇은 기모라 두껍지 않고 가을·초겨울에 알맞은 두께입니다.\n\n추가로 궁금하신 점이 있으면 언제든 문의해 주세요. 감사합니다.';

// ── 순위·매출 ──
function rankRevenue() {
  const series = Array.from({ length: 30 }, (_, i) => { const rank = Math.max(3, Math.round(24 - i * 0.5 + Math.sin(i) * 2)); const quantity = Math.max(0, Math.round(14 - rank * 0.35 + Math.cos(i) * 1.5)); return { date: addDays(TODAY, -29 + i), rank, quantity, amount: quantity * 29900 }; });
  return { minPairs: 7, items: [
    { keyword: '여자 니트티', productId: '900', productName: '데일리 라운드넥 니트 티셔츠', status: 'ok', days: 30, correlation: 0.82, perStepQty: 0.9, weeklyRevenuePerStep: 188000, avgPrice: 29900, latestRank: 11, series },
    { keyword: '기모 와이드 슬랙스', productId: '901', productName: '여성 기모 와이드 슬랙스', status: 'ok', days: 30, correlation: 0.64, perStepQty: 0.5, weeklyRevenuePerStep: 122000, avgPrice: 34900, latestRank: 9, series: series.map(s => ({ ...s, rank: Math.max(2, s.rank - 3), amount: s.quantity * 34900 })) },
    { keyword: '경량 패딩 조끼', productId: '903', productName: '경량 패딩 조끼', status: 'few-days', days: 4, correlation: null, perStepQty: null, weeklyRevenuePerStep: null, avgPrice: 45900, latestRank: 31, series: series.slice(-4) },
  ] };
}

// ── 가격 관리 ──
const priceRules = { autoApplyMaxChangePct: 10, rows: [
  { vendorItemId: '7001', productName: '데일리 라운드넥 니트 티셔츠', optionName: '블랙 / M', currentPrice: 26900, unitCost: 15100, commissionRate: 10.8, floorPrice: 25300, marketPrice: 27400, suggestedPrice: null, reason: '하한가 위 · 시장가와 비슷', belowFloor: false, enabled: true, autoApply: false, minMarginRate: 15, minPrice: null, maxPrice: null, targetKeyword: '여자 니트티', costEntered: true },
  { vendorItemId: '7011', productName: '아기 내복 세트', optionName: '민트 / 90', currentPrice: 15900, unitCost: 9600, commissionRate: 10.8, floorPrice: 16700, marketPrice: 17900, suggestedPrice: 16900, reason: '현재가가 마진 하한(16,700원) 아래 · 시장가 17,900원', belowFloor: true, enabled: true, autoApply: false, minMarginRate: 15, minPrice: null, maxPrice: 18900, targetKeyword: '아기 내복', costEntered: true },
  { vendorItemId: '7009', productName: '롱원피스 3종세트', optionName: '아이보리, 블랙, 올리브 55', currentPrice: 41200, unitCost: 21900, commissionRate: 10.8, floorPrice: 38200, marketPrice: 39800, suggestedPrice: 39900, reason: '시장가보다 3.5% 높음 · 하한가 여유 있음', belowFloor: false, enabled: true, autoApply: true, minMarginRate: 12, minPrice: 38000, maxPrice: null, targetKeyword: '롱원피스 세트', costEntered: true },
  { vendorItemId: '7008', productName: '오버핏 후드 집업', optionName: '그레이 / XL', currentPrice: 39900, unitCost: 0, commissionRate: 10.8, floorPrice: null, marketPrice: 37900, suggestedPrice: null, reason: '원가가 없어 하한가를 계산할 수 없음', belowFloor: false, enabled: false, autoApply: false, minMarginRate: 10, minPrice: null, maxPrice: null, targetKeyword: null, costEntered: false },
], logs: [
  { vendor_item_id: '7009', old_price: 42900, new_price: 41200, reason: '시장가 대비 5% 이상 높음', applied: true, error: null, created_at: new Date(Date.now() - 2 * 86400_000).toISOString() },
  { vendor_item_id: '7011', old_price: 14900, new_price: 15900, reason: '마진 하한 아래', applied: true, error: null, created_at: new Date(Date.now() - 6 * 86400_000).toISOString() },
] };

// ── 연동 설정 ──
const briefSettings = { enabled: true, leadTimeDays: 14, minSales14: 3 };
const reports = { reports: [-1, -2, -3, -4].map(w => ({ period_start: addDays(TODAY, w * 7 - 6), period_end: addDays(TODAY, w * 7), sent_at: addDays(TODAY, w * 7 + 1) + 'T08:00:00Z',
  summary: { quantity: 150 + w * 6, salesAmount: 4650000 + w * 180000, profit: 1310000 + w * 60000, marginRate: 28 + w * 0.4, returnCount: 4, prevSalesAmount: 4470000 + w * 180000, prevProfit: 1250000 + w * 60000, adCost: 480000, incoming: 2, missingCost: w === -1 ? 1 : 0 } })) };

export const coupangMocks = (r) => {
  const s = shellMocks(r); if (s !== undefined) return s;
  const { path, q, body } = r;
  if (path === '/api/sourcing' && q.type === 'rankwatch' && q.action === 'check') return { currentRank: 11, page: 1, searchedTo: 5 };
  if (path !== '/api/coupang') return undefined;
  switch (q.action) {
    case 'status': return status;
    case 'health-check': return health;
    case 'order-hours': return orderHours(Number(q.days) || 28);
    case 'experiments': return experiments;
    case 'experiment-save': return { ok: true, id: 'e-new' };
    case 'experiment-delete': return { ok: true };
    case 'my-products': return myProducts;
    case 'purchases': return purchases;
    case 'purchase-save': return { ok: true, id: 'p-new', appliedUnitCost: 8524, optionCount: (body?.vendorItemIds ?? []).length || 1 };
    case 'purchase-apply': return { ok: true, appliedUnitCost: 8524 };
    case 'purchase-delete': return { ok: true, appliedUnitCost: null };
    case 'fx-rate': return { rate: 190.5, fetchedAt: new Date().toISOString(), stale: false };
    case 'costs': return { rows: costRows };
    case 'cost-save': return { ok: true, saved: (body?.items ?? []).length };
    case 'settlement': return settlement();
    case 'settlement-check': return settlementCheck;
    case 'settlement-check-save': return { ok: true };
    case 'inventory': return inventory;
    case 'reorder-rule': return { ok: true, vendorItemId: body?.vendorItemId, mode: body?.mode };
    case 'growth-reconcile': return reconcile;
    case 'growth-inbound-save': return { ok: true, id: 'r-new' };
    case 'growth-inbound-delete': return { ok: true };
    case 'return-reasons': return returnReasons;
    case 'returns': return returns(Number(q.days) || 30);
    case 'inquiries': return inquiries;
    case 'inquiry-draft': return { ok: true, draft: inquiryDraft, remaining: 41 };
    case 'inquiry-reply': return { ok: true };
    case 'rank-revenue': return rankRevenue();
    case 'price-rules': return priceRules;
    case 'price-rule-save': return { ok: true, saved: (body?.items ?? []).length };
    case 'price-apply': return { ok: true };
    case 'brief-settings': return briefSettings;
    case 'reports': return reports;
    case 'key-delete': return { ok: true };
    case 'sync': return { ok: true, summary: {} };
    default: return profitMocks(r);
  }
};
