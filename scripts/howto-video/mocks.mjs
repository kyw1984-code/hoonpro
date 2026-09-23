// 두 화면을 채우는 가짜 데이터. 실제 API 응답 모양(src/lib/*.ts 타입)을 따른다.
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const TOKEN_KEY = 'hoonpro_token';
export function fakeToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = { userId: '00000000-0000-0000-0000-000000000001', email: 'demo@hoonpro.ai', name: '훈프로 셀러', isAdmin: false, iat: now, exp: now + 7 * 86400 };
  return `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.xxxxxxxx`;
}

const svgImg = (label, hue) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,28%)"/><stop offset="1" stop-color="hsl(${hue + 30},55%,18%)"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><text x="200" y="215" font-family="Pretendard,sans-serif" font-size="34" font-weight="700" fill="rgba(255,255,255,.85)" text-anchor="middle">${label}</text></svg>`);

export const shellMocks = ({ path, q, method }) => {
  if (path === '/api/admin' && q.action === 'config') return { tabOrder: null, hiddenTabs: [], company: {}, imageEnabled: false };
  if (path === '/api/admin' && q.action === 'notices') return { notices: [] };
  if (path === '/api/qa' && q.action === 'status') return { enabled: true, canUse: true };
  if (path === '/api/qa' && q.action === 'my-suggestions') return { replies: [], unseen: 0 };
  if (path === '/api/billing' && q.action === 'status') return { billingEnforced: false, plans: [], plan: null, subscription: null, payments: [] };
  if (path === '/api/usage' && q.action === 'limits') return { resetAt: new Date(Date.now() + 8 * 3600_000).toISOString(), unlimited: false, features: [] };
  if (path === '/api/usage' && q.action === 'onboarding') return { done: true };
  return undefined;
};

// ── 소싱AI ─────────────────────────────────────────────────
const kw = (keyword, volume, pc, clicks, comp, adDepth, score, grade) => ({
  keyword, monthlyPcVolume: pc, monthlyMobileVolume: volume - pc, monthlyVolume: volume, monthlyClicks: clicks,
  compIdx: comp, adDepth, volumeScore: Math.min(100, Math.round(Math.log10(volume + 1) * 25)),
  competition: comp === '낮음' ? 28 : comp === '중간' ? 52 : 78, opportunityScore: score, grade,
});
export const SEED = '캠핑의자';
const seedStat = kw('캠핑의자', 29940, 4200, 812, '중간', 15, 72, 'Good');
const keywords = [
  kw('캠핑의자 추천', 8120, 980, 260, '중간', 12, 74, 'Great'),
  kw('경량 캠핑의자', 6740, 720, 214, '낮음', 8, 79, 'Great'),
  kw('캠핑의자 접이식', 5310, 610, 171, '중간', 14, 68, 'Good'),
  kw('릴렉스 캠핑의자', 4880, 540, 150, '낮음', 7, 77, 'Great'),
  kw('캠핑 릴렉스체어', 4120, 470, 133, '중간', 11, 66, 'Good'),
  kw('캠핑의자 2인', 2960, 330, 92, '낮음', 6, 71, 'Good'),
  kw('감성 캠핑의자', 2410, 260, 78, '중간', 13, 61, 'Good'),
  kw('캠핑의자 세트', 2180, 240, 70, '높음', 21, 44, 'Bad'),
  kw('낚시의자', 12400, 1500, 390, '높음', 24, 41, 'Bad'),
  kw('캠핑 테이블', 21800, 2900, 640, '높음', 26, 38, 'Bad'),
  kw('캠핑 로우체어', 3120, 340, 101, '낮음', 9, 73, 'Great'),
  kw('캠핑의자 우드', 1870, 210, 60, '낮음', 5, 69, 'Good'),
  kw('접이식의자', 15600, 2200, 470, '높음', 22, 42, 'Bad'),
  kw('아웃도어 체어', 2640, 300, 84, '중간', 10, 62, 'Good'),
  kw('캠핑의자 등받이', 1420, 160, 46, '낮음', 4, 64, 'Good'),
  kw('피크닉의자', 3980, 450, 128, '중간', 12, 58, 'Normal'),
  kw('백패킹 의자', 2210, 250, 71, '낮음', 6, 70, 'Good'),
  kw('캠핑의자 쿠션', 960, 100, 30, '낮음', 3, 55, 'Normal'),
  kw('캠핑 스툴', 1780, 190, 57, '중간', 9, 57, 'Normal'),
  kw('차박 의자', 1330, 150, 43, '낮음', 5, 63, 'Good'),
];
const products = [
  ['1001', '초경량 접이식 캠핑의자 릴렉스체어 등받이 캠핑 낚시 의자', 29900, 4.7, 512, 'general', 1, 2.4, 78, 'Good', 200],
  ['1002', '캠핑의자 접이식 경량 릴렉스체어 2개 세트 휴대용', 45900, 4.6, 1284, 'rocket', 2, 4.1, 64, 'Good', 30],
  ['1003', '감성 우드 캠핑의자 로우체어 접이식 원목 팔걸이', 38500, 4.8, 231, 'general', 3, 1.6, 81, 'Great', 120],
  ['1004', '백패킹 초경량 캠핑의자 알루미늄 미니 체어', 24900, 4.5, 89, 'general', 4, 0.9, 74, 'Good', 60],
  ['1005', '캠핑의자 릴렉스 체어 목받침 접이식 대형 낚시 의자', 33900, 4.6, 2013, 'rocket', 5, 5.2, 52, 'Normal', 330],
  ['1006', '차박 캠핑 로우체어 감성 의자 등받이 쿠션 포함', 27900, 4.7, 158, 'jet', 6, 1.2, 76, 'Good', 90],
  ['1007', '경량 접이식 캠핑의자 스틸 프레임 컵홀더 등산 낚시', 19900, 4.4, 421, 'general', 7, 2.0, 69, 'Good', 15],
  ['1008', '캠핑 릴렉스체어 각도조절 리클라이너 접이식 안락의자', 59000, 4.8, 77, 'general', 8, 0.7, 71, 'Good', 270],
  ['1009', '캠핑의자 2인용 러브체어 접이식 커플 의자', 64900, 4.5, 143, 'general', 9, 1.1, 66, 'Good', 40],
  ['1010', '피크닉 캠핑 스툴 접이식 미니 의자 휴대용', 12900, 4.3, 668, 'rocket', 10, 3.3, 48, 'Normal', 180],
  ['1011', '아웃도어 체어 캠핑의자 등받이 컵홀더 접이식 경량', 22900, 4.6, 305, 'general', 11, 1.8, 72, 'Good', 100],
  ['1012', '캠핑의자 우드 암레스트 감성 캠핑 접이식 체어', 41900, 4.7, 52, 'general', 12, 0.5, 67, 'Good', 250],
].map(([id, name, price, rating, reviews, delivery, rank, growth, score, grade, hue]) => ({
  productId: id, productName: name, productPrice: price, productUrl: `https://www.coupang.com/vp/products/${id}`,
  productImage: svgImg(name.split(' ').slice(0, 2).join(' '), hue), rating, reviewCount: reviews, deliveryType: delivery,
  rank, isAd: false, organicRank: rank, isBrand: false, reviewGrowthPerDay: growth, obsDays: 14, offCategory: null,
  setCount: 1, unitPrice: price,
  calculated: {
    demandScore: Math.min(100, 40 + Math.round(Math.log10(reviews + 1) * 18)), entryEase: delivery === 'rocket' ? 45 : 72,
    priceFit: 70, opportunityScore: score, marketScore: 74, grade,
    reasons: [`리뷰 ${reviews.toLocaleString()}개로 수요 검증`, delivery === 'rocket' ? '로켓배송 상품 — 가격·리뷰 경쟁 필요' : '일반배송 셀러 진입 가능', '가격대 평균과 비슷'],
    fitScore: null,
  },
}));
const market = {
  totalOnPage: 36, rocketCount: 10, jetCount: 6, generalCount: 20, rocketRatio: 28, totalProducts: 48210, keywordVolume: 29940,
  competitionRate: 1.6, medianReviews: 312, maxReviews: 8841, avgPrice: 32900, minPrice: 12900, maxPrice: 89000,
  entryVerdict: 'Good', unitMedianPrice: 29900, setRatio: 8,
};

export const sourcingMocks = (r) => {
  const s = shellMocks(r); if (s !== undefined) return s;
  const { path, q } = r;
  if (path !== '/api/sourcing' && path !== '/api/coupang') return undefined;
  if (q.type === 'briefing') return { month: 11, leadMonths: 1, generatedAt: new Date().toISOString(), items: [] };
  if (q.type === 'keywords') return { seed: SEED, category: null, month: null, seedStat, keywords, cached: false };
  if (q.type === 'products') return { keyword: SEED, servedFrom: 'fresh', remaining: 27, market, products, myProducts: [] };
  if (q.type === 'trend') return { trends: [{ keyword: q.keyword, series: [], monthlyAvg: [22, 24, 38, 61, 78, 70, 66, 74, 69, 88, 52, 30], peakMonths: [5, 10], seasonality: 2.4 }] };
  if (q.type === 'rankwatch' && q.action === 'changes') return { keyword: SEED, from: '2026-09-15', to: '2026-09-22', days: 7,
    priceChanges: [{ productId: '1002', productName: '캠핑의자 접이식 경량 릴렉스체어 2개 세트', priceFrom: 49900, priceTo: 45900, changePct: -8, rankFrom: 4, rankTo: 2 }],
    newcomers: [{ productId: '1012', productName: '캠핑의자 우드 암레스트 감성 캠핑 접이식 체어', rank: 12, price: 41900, reviewCount: 52, isAd: false }],
    surging: [{ productId: '1005', productName: '캠핑의자 릴렉스 체어 목받침 접이식 대형', reviewsAdded: 36, perDay: 5.2, rankFrom: 7, rankTo: 5, isAd: false, adSuspect: false }],
    gone: [] };
  if (q.type === 'rankwatch' && q.action === 'add') return { ok: true, productId: q.product };
  if (q.type === 'rankwatch' && q.action === 'list') return { items: [] };
  if (q.type === 'favorites') return { items: [] };
  if (path === '/api/coupang' && q.action === 'my-rates') return { hasData: true, from: '2026-07-25', to: '2026-09-22',
    rates: { commission: 0.108, ad: 0.094, returns: 0.021, coupon: 0.038, basis: { orders: 1420, salesAmount: 41200000, from: '2026-07-25', to: '2026-09-22' } },
    totals: { salesAmount: 41200000, netSales: 39630000, commission: 4450000, adCost: 3870000, returnAmount: 865000, couponDiscount: 1570000, quantity: 1420 } };
  return undefined;
};

// ── 정산AI › 순이익 ─────────────────────────────────────────
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const TODAY = '2026-09-22';
const FROM = addDays(TODAY, -29);
function makeDaily() {
  const out = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 30; i++) {
    const date = addDays(FROM, i);
    const wk = new Date(date + 'T00:00:00Z').getUTCDay();
    const base = 18 + Math.round(rnd() * 10) + (wk === 0 || wk === 6 ? 6 : 0) + (i > 20 ? 5 : 0);
    const salesAmount = base * 30100;
    const commission = Math.round(salesAmount * 0.105);
    const adCost = 52000 + Math.round(rnd() * 30000);
    const profit = Math.round(salesAmount - commission - base * 15800 - adCost - 4000);
    out.push({ date, quantity: base, salesAmount, commission, profit, adCost });
  }
  return out;
}
const daily = makeDaily();
const T = daily.reduce((a, d) => ({ q: a.q + d.quantity, s: a.s + d.salesAmount, c: a.c + d.commission, p: a.p + d.profit, ad: a.ad + d.adCost }), { q: 0, s: 0, c: 0, p: 0, ad: 0 });
const row = (id, name, opt, qty, price, unitCost, ad, channel, ret = 0, coupon = 0, costEntered = true) => {
  const salesAmount = qty * price; const commission = Math.round(salesAmount * 0.105); const unitCostTotal = costEntered ? qty * unitCost : 0;
  const returnCost = ret * 4000; const profit = salesAmount - commission - unitCostTotal - ad - returnCost - coupon;
  return { vendorItemId: id, productName: name, optionName: opt, quantity: qty, salesAmount, commission, settlementAmount: salesAmount - commission,
    couponDiscount: coupon, adCost: ad, channel, returnAmount: ret * price, unitCostTotal, returnCount: ret, returnCost, profit,
    marginRate: Math.round((profit / salesAmount) * 1000) / 10, costEntered, stock: 40 + qty, salePrice: price };
};
const rows = [
  row('7001', '데일리 라운드넥 니트 티셔츠', '블랙 / M', 128, 29900, 12400, 310000, 'growth', 2, 128000),
  row('7002', '데일리 라운드넥 니트 티셔츠', '아이보리 / M', 96, 29900, 12400, 240000, 'growth', 1, 96000),
  row('7003', '여성 기모 와이드 슬랙스', '차콜 / 66', 84, 34900, 15100, 260000, 'growth', 3, 0),
  row('7004', '남자 반팔 나시티 4종세트', '블랙+화이트+그레이+블루 105', 71, 21900, 9800, 120000, 'marketplace', 1, 0),
  row('7005', '경량 패딩 조끼', '베이지 / L', 52, 45900, 21000, 210000, 'growth', 2, 104000),
  row('7006', '스트라이프 긴팔 단가라 티셔츠', '네이비 / FREE', 47, 19900, 8600, 60000, 'marketplace', 0, 0),
  row('7007', '오버핏 후드 집업', '그레이 / XL', 39, 39900, 0, 150000, 'growth', 1, 0, false),
  row('7008', '롱원피스 3종세트', '아이보리, 블랙, 올리브 55', 33, 41200, 19600, 90000, 'growth', 1, 66000),
  row('7009', '커플 맨투맨 2장 세트', '블랙 / L', 28, 36900, 16000, 70000, 'marketplace', 0, 0),
  row('7010', '아기 내복 세트', '민트 / 90', 34, 15900, 6900, 20000, 'growth', 0, 0),
];
const totalsRows = rows.reduce((a, r) => ({ quantity: a.quantity + r.quantity, salesAmount: a.salesAmount + r.salesAmount, commission: a.commission + r.commission,
  unitCostTotal: a.unitCostTotal + r.unitCostTotal, returnCount: a.returnCount + r.returnCount, returnCost: a.returnCost + r.returnCost,
  returnAmount: a.returnAmount + r.returnAmount, profit: a.profit + r.profit, couponDiscount: a.couponDiscount + r.couponDiscount, adCost: a.adCost + r.adCost }),
  { quantity: 0, salesAmount: 0, commission: 0, unitCostTotal: 0, returnCount: 0, returnCost: 0, returnAmount: 0, profit: 0, couponDiscount: 0, adCost: 0 });
const profitResponse = {
  from: FROM, to: TODAY, missingCost: 1, costCoverage: 90, adCostHint: T.ad,
  totals: { ...totalsRows, settlementAmount: totalsRows.salesAmount - totalsRows.commission, marginRate: Math.round((totalsRows.profit / totalsRows.salesAmount) * 1000) / 10 },
  rows,
  coupon: { orderAmount: totalsRows.salesAmount + totalsRows.couponDiscount, sellerDiscount: totalsRows.couponDiscount, coupangDiscount: 0, orderQuantity: totalsRows.quantity },
  couponList: [{ couponId: 'c1', name: '가을 신상 즉시할인', type: 'PRICE', status: 'APPLIED', discount: 1000, startAt: '2026-09-01', endAt: '2026-09-30' }],
  channels: { marketplace: { quantity: 146, salesAmount: 4488400 }, growth: { quantity: totalsRows.quantity - 146, salesAmount: totalsRows.salesAmount - 4488400 } },
  daily,
  adCost: { total: T.ad, coveredDays: 30, spanDays: 30, estimatedDays: 0 },
  previous: { from: addDays(FROM, -30), to: addDays(FROM, -1), salesAmount: Math.round(totalsRows.salesAmount * 0.87), quantity: Math.round(totalsRows.quantity * 0.88), commission: Math.round(totalsRows.commission * 0.87), profit: Math.round(totalsRows.profit * 0.74), hasData: true },
};
const monthRow = (month, sales, profit, qty, prev) => ({ month, quantity: qty, salesAmount: sales, couponDiscount: Math.round(sales * 0.03), commission: Math.round(sales * 0.105),
  unitCost: Math.round(sales * 0.44), returnCost: Math.round(qty * 0.02) * 4000, returnAmount: Math.round(sales * 0.02), adCost: Math.round(sales * 0.09), profit,
  marginRate: Math.round((profit / sales) * 1000) / 10, hasData: true, prevMonth: prev, salesDelta: null, profitDelta: null, marginRateDelta: null, driver: null });
const monthly = [
  monthRow('2026-04', 14200000, 3100000, 470, null), monthRow('2026-05', 16800000, 3900000, 560, '2026-04'),
  monthRow('2026-06', 15100000, 3300000, 505, '2026-05'), monthRow('2026-07', 17900000, 4200000, 590, '2026-06'),
  monthRow('2026-08', 19400000, 4900000, 640, '2026-07'), monthRow('2026-09', 15300000, 4400000, 512, '2026-08'),
];
for (let i = 1; i < monthly.length; i++) { const a = monthly[i], b = monthly[i - 1]; a.salesDelta = a.salesAmount - b.salesAmount; a.profitDelta = a.profit - b.profit; a.marginRateDelta = Math.round((a.marginRate - b.marginRate) * 10) / 10; a.driver = { key: 'sales', label: '매출', delta: a.salesDelta }; }

export const profitMocks = (r) => {
  const s = shellMocks(r); if (s !== undefined) return s;
  const { path, q } = r;
  if (path !== '/api/coupang') return undefined;
  if (q.action === 'status') return { connected: true, vendorId: 'A00123456', accessKeyMasked: 'a1b2c3******x9y8', status: 'active', lastSyncAt: new Date(Date.now() - 42 * 60000).toISOString(), lastSyncError: null, keyExpiresAt: '2027-03-01', daysToExpiry: 160, itemCount: 84, salesDays: 92, relayIp: null };
  if (q.action === 'profit') return profitResponse;
  if (q.action === 'ad-costs') return { from: addDays(TODAY, -399), to: TODAY, days: daily.map(d => ({ date: d.date, cost: d.adCost, source: 'report' })), total: T.ad, spanDays: 30 };
  if (q.action === 'profit-monthly') return { rows: monthly, thisMonth: '2026-09', today: TODAY };
  if (q.action === 'coupon-effect') return { from: addDays(TODAY, -89), to: TODAY, best: { couponId: 'c1', name: '가을 신상 즉시할인', discount: 1000 },
    segments: [
      { couponId: null, name: '쿠폰 없음', discount: 0, type: null, start: '2026-06-25', end: '2026-08-31', days: 68, quantity: 1210, salesAmount: 36400000, profit: 8900000, couponDiscount: 0, perDayQuantity: 17.8, perDayProfit: 130900, profitPerUnit: 7355, marginRate: 24.5, overlapped: false },
      { couponId: 'c1', name: '가을 신상 즉시할인', discount: 1000, type: 'PRICE', start: '2026-09-01', end: '2026-09-22', days: 22, quantity: 512, salesAmount: 15300000, profit: 4400000, couponDiscount: 512000, perDayQuantity: 23.3, perDayProfit: 200000, profitPerUnit: 8594, marginRate: 28.8, overlapped: false },
    ] };
  if (q.action === 'sales-movers' || q.action === 'goals') return { __status: 403, error: '준비 중인 기능입니다.' };
  return undefined;
};
