// 홈·순위추적·리뷰·광고분석·코칭·내 작업·구독 탭의 가짜 데이터
import { shellMocks } from './mocks.mjs';
import { coupangMocks } from './mocks-coupang.mjs';

const TODAY = '2026-09-28';
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const iso = (d, h = 3) => `${d}T0${h}:00:00Z`;
const svgImg = (label, hue) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="hsl(${hue},45%,26%)"/><text x="100" y="108" font-family="Pretendard,sans-serif" font-size="20" font-weight="700" fill="rgba(255,255,255,.85)" text-anchor="middle">${label}</text></svg>`);

// ── 순위 추적 ──
const hist = (pid, kw, ranks, price) => ranks.map((rank, i) => ({ keyword: kw, product_id: pid, rank, rank_with_ads: rank === null ? null : rank + 4, price, captured_at: iso(addDays(TODAY, -(ranks.length - 1 - i) * 2)) }));
const watches = [
  { keyword: '여자 니트티', product_id: '900', product_name: '데일리 라운드넥 니트 티셔츠', created_at: iso(addDays(TODAY, -40)), history: hist('900', '여자 니트티', [24, 21, 19, 22, 16, 14, 12, 11], 26900), latestRank: 11, latestAdRank: 15, latestAt: iso(TODAY), delta: 1, best: 11, worst: 24, outCount: 0, records: 8, price: 26900, priceDelta: -3000 },
  { keyword: '캠핑의자', product_id: '1003', product_name: '감성 우드 캠핑의자 로우체어', created_at: iso(addDays(TODAY, -30)), history: hist('1003', '캠핑의자', [18, 14, null, 10, 9, 7, 7, 6], 38500), latestRank: 6, latestAdRank: 9, latestAt: iso(TODAY), delta: 1, best: 6, worst: 18, outCount: 1, records: 8, price: 38500, priceDelta: null },
  { keyword: '기모 와이드 슬랙스', product_id: '901', product_name: '여성 기모 와이드 슬랙스', created_at: iso(addDays(TODAY, -20)), history: hist('901', '기모 와이드 슬랙스', [9, 8, 8, 10, 12, 13, 15, 14], 34900), latestRank: 14, latestAdRank: 20, latestAt: iso(TODAY), delta: -5, best: 8, worst: 15, outCount: 0, records: 8, price: 34900, priceDelta: 0 },
  { keyword: '경량 패딩 조끼', product_id: '903', product_name: '경량 패딩 조끼', created_at: iso(addDays(TODAY, -1)), history: [], latestRank: null, latestAt: null, delta: null, best: null, worst: null, outCount: 0, records: 0, price: null, priceDelta: null },
];
const competitorChanges = { days: 7, from: addDays(TODAY, -7), to: TODAY, keywords: 3, items: [
  { kind: 'price-down', keyword: '여자 니트티', productId: '55001', productName: '베이직 라운드 니트 티셔츠 가을 여성 긴팔', productUrl: 'https://www.coupang.com/vp/products/55001', priceFrom: 24900, priceTo: 19900, pricePct: -20, reviewFrom: null, reviewTo: null, reviewDelta: null, rankFrom: 6, rankTo: 3 },
  { kind: 'review-surge', keyword: '캠핑의자', productId: '55002', productName: '캠핑의자 릴렉스 체어 목받침 접이식 대형', productUrl: 'https://www.coupang.com/vp/products/55002', priceFrom: null, priceTo: null, pricePct: null, reviewFrom: 2013, reviewTo: 2094, reviewDelta: 81, rankFrom: 7, rankTo: 5 },
  { kind: 'rank-jump', keyword: '기모 와이드 슬랙스', productId: '55003', productName: '여성 기모 밴딩 와이드 슬랙스 통바지', productUrl: 'https://www.coupang.com/vp/products/55003', priceFrom: null, priceTo: null, pricePct: null, reviewFrom: 310, reviewTo: 340, reviewDelta: 30, rankFrom: 19, rankTo: 4 },
  { kind: 'price-up', keyword: '여자 니트티', productId: '55004', productName: '울 혼방 니트 티셔츠 여성 라운드넥', productUrl: 'https://www.coupang.com/vp/products/55004', priceFrom: 29900, priceTo: 33900, pricePct: 13, reviewFrom: null, reviewTo: null, reviewDelta: null, rankFrom: 4, rankTo: 8 },
] };
const competitors = (keyword) => ({ keyword, capturedAt: iso(TODAY), products: [
  { productId: '55001', productName: '베이직 라운드 니트 티셔츠 가을 여성 긴팔', rank: 1, isAd: true, price: 19900, reviewCount: 4120, rating: 4.6, deliveryType: 'rocket', isMine: false },
  { productId: '55005', productName: '여성 니트 티셔츠 가을 데일리 루즈핏', rank: 2, isAd: false, price: 22900, reviewCount: 1830, rating: 4.7, deliveryType: 'rocket', isMine: false },
  { productId: '55006', productName: '골지 니트티 여자 긴팔 베이직', rank: 3, isAd: false, price: 17900, reviewCount: 912, rating: 4.5, deliveryType: 'general', isMine: false },
  { productId: '900', productName: '데일리 라운드넥 니트 티셔츠', rank: 11, isAd: false, price: 26900, reviewCount: 214, rating: 4.7, deliveryType: 'jet', isMine: true },
  { productId: '55004', productName: '울 혼방 니트 티셔츠 여성 라운드넥', rank: 12, isAd: false, price: 33900, reviewCount: 388, rating: 4.4, deliveryType: 'general', isMine: false },
], summary: { topCount: 5, medianPrice: 22900, medianReviews: 912, rocketShare: 40, adCount: 1, pageCount: 1, me: { rank: 11, price: 26900, reviewCount: 214, isAd: false, deliveryType: 'jet' } } });

// ── 리뷰 분석 ──
const reviewSamples = [
  { rating: 5, text: '가볍고 튼튼해요. 차박할 때 트렁크에 넣고 다니기 딱 좋습니다. 등받이 각도도 편해요.' },
  { rating: 5, text: '앉았을 때 푹 꺼지지 않고 지지가 잘 돼서 오래 앉아 있어도 허리가 안 아파요.' },
  { rating: 4, text: '색상은 사진과 거의 같아요. 다만 컵홀더가 얕아서 텀블러가 흔들려요.' },
  { rating: 2, text: '팔걸이 나사가 헐거워서 며칠 쓰니 삐걱거려요. 조립 설명서도 그림이 작아요.' },
  { rating: 3, text: '무게는 가벼운데 수납 가방 지퍼가 약해 보여요. 세 번 만에 지퍼가 빠졌어요.' },
  { rating: 1, text: '다리 하나가 휘어서 왔어요. 교환은 해줬지만 처음부터 검수를 제대로 했으면.' },
];
const reviewFull = { productId: '1001', productName: '초경량 접이식 캠핑의자 릴렉스체어', reviewCount: 187, remaining: 8, samples: reviewSamples, summary: {
  oneLine: '가벼움과 편한 등받이는 만족, 나사·지퍼 내구성과 조립 설명이 공략 지점',
  positives: ['가볍고 차박·백패킹에 휴대하기 좋다 (언급 41%)', '등받이 각도가 편해 오래 앉아도 허리가 편하다', '색상·질감이 사진과 같다'],
  complaints: ['팔걸이 나사가 헐거워져 삐걱거린다 (불만 1위)', '수납 가방 지퍼가 약하다', '조립 설명서 그림이 작아 헷갈린다', '컵홀더가 얕다'],
  needs: ['텀블러가 들어가는 깊은 컵홀더', '초기 검수 후 발송 · 나사 예비분 동봉', '동영상 조립 안내'],
  attackPoints: ['상세페이지 첫 화면에 "나사 예비분 동봉 · 전수 검수" 강조', '지퍼 강화 수납가방으로 차별화', '컵홀더 깊이를 수치로 표기 (텀블러 1L 가능)', '조립 30초 영상 QR을 동봉'],
} };

// ── 광고 분석 ──
function adRows() {
  const rows = [];
  const kws = [
    ['캠핑의자', 12400, 186, 74400, 9, 215100, '검색 영역'], ['경량 캠핑의자', 6100, 98, 39200, 6, 149400, '검색 영역'], ['캠핑 릴렉스체어', 4800, 71, 28400, 4, 99600, '검색 영역'],
    ['접이식의자', 9300, 122, 48800, 3, 74700, '검색 영역'], ['낚시의자', 5200, 64, 25600, 1, 24900, '검색 영역'], ['캠핑용품', 8800, 91, 36400, 0, 0, '검색 영역'],
    ['야외의자', 3100, 15, 6000, 0, 0, '검색 영역'], ['피크닉의자', 2100, 2, 800, 0, 0, '검색 영역'], ['백패킹의자', 1900, 31, 12400, 2, 49800, '검색 영역'],
    ['-', 41000, 240, 60000, 5, 124500, '비검색 영역'],
  ];
  for (const day of [-6, -5, -4, -3, -2, -1, 0]) {
    for (const [kw, imp, clk, cost, qty, rev, place] of kws) {
      const f = 0.85 + ((day + 7) % 3) * 0.12;
      rows.push({ '날짜': addDays(TODAY, day), '캠페인명': place === '검색 영역' ? '캠핑의자_수동' : '캠핑의자_자동', '광고유형': place === '검색 영역' ? '수동 성과형' : '매출 최적화', '광고 노출 지면': place,
        '광고집행 상품명': '초경량 접이식 캠핑의자 릴렉스체어 블랙', '광고집행 옵션ID': '80011', '키워드': kw,
        '노출수': Math.round(imp * f / 7), '클릭수': Math.round(clk * f / 7), '광고비': Math.round(cost * f / 7), '총 판매수량(14일)': Math.round(qty * f / 7 + (day === 0 ? 0.4 : 0)), '총 전환매출액(14일)': Math.round(rev * f / 7), '총 전환매출액(1일)': Math.round(rev * f / 7 * 0.7) });
    }
  }
  return rows;
}
const adRaw = { report: { from: addDays(TODAY, -6), to: TODAY, columns: ['날짜', '캠페인명', '광고유형', '광고 노출 지면', '광고집행 상품명', '광고집행 옵션ID', '키워드', '노출수', '클릭수', '광고비', '총 판매수량(14일)', '총 전환매출액(14일)', '총 전환매출액(1일)'], rowCount: 70, offset: 0, hasMore: false, truncated: false, savedAt: iso(TODAY), rows: adRows() } };
const marginPreset = { from: addDays(TODAY, -29), to: TODAY, days: 30, items: [
  { vendorItemId: '80011', productName: '초경량 접이식 캠핑의자 릴렉스체어', optionName: '블랙', channel: 'growth', quantity: 124, unitPrice: 24900, couponPerUnit: 1000, unitCost: 7000, fulfillmentCost: 3650, returnRate: 2, returnShippingCost: 3000, hasCost: true },
  { vendorItemId: '80012', productName: '초경량 접이식 캠핑의자 릴렉스체어', optionName: '카키', channel: 'growth', quantity: 61, unitPrice: 24900, couponPerUnit: 1000, unitCost: 7000, fulfillmentCost: 3650, returnRate: 1.5, returnShippingCost: 3000, hasCost: true },
] };
const reportList = { reports: [
  { id: 12, row_count: 340, created_at: iso(addDays(TODAY, -21)), summary: { from: addDays(TODAY, -34), to: addDays(TODAY, -21), label: '9월 초 캠핑의자', grade: 'B', totalCost: 412000, totalRevenue: 1120000, roasPct: 271.8, totalProfit: 88000, qty: 45, starCount: 3, drainCount: 6, drainCost: 38000, basis: { unitPrice: 24900, couponPerUnit: 1000, unitCost: 7000, deliveryFee: 3650, feeRate: 11.88, returnRate: 2, returnShippingCost: 3000 } } },
] };

// ── 코칭AI ──
const qaAnswer = '상품명은 "핵심 키워드 + 속성 + 용도" 순서로 짓는 것이 기본입니다.\n\n1) 핵심 키워드를 맨 앞에: 손님이 검색하는 말(예: 캠핑의자)을 첫 자리에 둡니다. 브랜드명은 뒤로 보내세요.\n2) 속성은 검색량이 있는 것만: 경량, 접이식, 릴렉스 같이 실제로 검색되는 말을 소싱AI 검색량으로 확인해 2~3개만 넣습니다.\n3) 용도·대상으로 마무리: 차박, 백패킹, 낚시처럼 쓰임을 붙이면 롱테일 검색에 걸립니다.\n4) 피할 것: 특수문자 반복, 같은 말 중복, 40자 넘는 길이. 쿠팡은 중복 키워드를 노출에 반영하지 않습니다.\n\n예시: "경량 접이식 캠핑의자 릴렉스체어 차박 백패킹 낚시 의자"\n\n정한 상품명은 소싱AI에서 그 키워드로 쿠팡 분석을 돌려 상위 상품명과 견줘 보세요.';
const myAnswers = { answers: [{ id: 'q9', question: '로켓그로스 입고 반려가 자꾸 나는데 어떻게 해야 하나요?', admin_answer: '반려 사유 코드가 "바코드 인식 불가"면 라벨을 무광 용지로 바꾸고, "박스 규격"이면 한 변 60cm 이하로 맞추세요. 두 가지가 반려의 80%입니다. 입고 예약 화면 캡처를 건의하기로 보내주시면 같이 봐드릴게요.', answered_at: iso(addDays(TODAY, -2), 9), seen_at: null }], unseen: 1 };

// ── 내 작업 ──
const works = { works: [
  { id: 'w1', kind: 'review', title: '초경량 접이식 캠핑의자 릴렉스체어', created_at: iso(addDays(TODAY, -2)), payload: { productId: '1001', productName: reviewFull.productName, reviewCount: 187, analyzedAt: iso(addDays(TODAY, -2)), summary: reviewFull.summary, samples: reviewSamples.slice(0, 3) } },
  { id: 'w2', kind: 'sourcing', title: '캠핑의자', created_at: iso(addDays(TODAY, -8)), payload: { keyword: '캠핑의자', searchedAt: iso(addDays(TODAY, -8)), market: { competitionRate: 1.6, medianReviews: 312, avgPrice: 32900, totalOnPage: 36, rocketCount: 10 },
    products: [{ productId: '1003', productName: '감성 우드 캠핑의자 로우체어 접이식', rank: 3, productPrice: 38500, reviewCount: 231, productUrl: 'https://www.coupang.com/vp/products/1003', calculated: { opportunityScore: 81, grade: 'Great' } }, { productId: '1001', productName: '초경량 접이식 캠핑의자 릴렉스체어', rank: 1, productPrice: 29900, reviewCount: 512, productUrl: 'https://www.coupang.com/vp/products/1001', calculated: { opportunityScore: 78, grade: 'Good' } }] } },
  { id: 'w3', kind: 'sourcing', title: '여자 니트티', created_at: iso(addDays(TODAY, -15)), payload: { keyword: '여자 니트티', searchedAt: iso(addDays(TODAY, -15)), market: { competitionRate: 2.4, medianReviews: 812, avgPrice: 22900, totalOnPage: 60, rocketCount: 42 }, products: [{ productId: '55005', productName: '여성 니트 티셔츠 가을 데일리 루즈핏', rank: 2, productPrice: 22900, reviewCount: 1830, productUrl: 'https://www.coupang.com/vp/products/55005', calculated: { opportunityScore: 62, grade: 'Good' } }] } },
] };
const savedCompare = { keyword: '캠핑의자', tracked: true, capturedAt: iso(TODAY), products: [{ productId: '1003', rank: 2, price: 36900, reviewCount: 298 }, { productId: '1001', rank: 1, price: 29900, reviewCount: 580 }] };

// ── 구독 ──
const plans = [{ id: 'yearly', name: '훈프로 연간', price: 498000, chargedPrice: 547800, vat: 49800, interval: 'year' }, { id: 'monthly', name: '훈프로 월간', price: 49800, chargedPrice: 54780, vat: 4980, interval: 'month' }];
const billingActive = { billingEnforced: true, plans, plan: plans[0], subscription: { status: 'active', cardSummary: '신한 ****1234', currentPeriodEnd: '2027-03-14T00:00:00Z', nextBillingAt: '2027-03-14T00:00:00Z', cancelAtPeriodEnd: false, failCount: 0 },
  payments: [{ order_name: '훈프로 연간 구독', amount: 547800, supply_amount: 498000, vat_amount: 49800, discount: 0, status: 'paid', fail_reason: null, receipt_url: 'https://dashboard.tosspayments.com/receipt/xyz', approved_at: '2026-03-14T02:11:00Z', created_at: '2026-03-14T02:11:00Z' }],
  referralRewards: { pending: 2 }, featureLimits: { sourcing: 20, reviews: 10, rank: 30, qa: 30 } };

export const tabMocks = (r) => {
  const { path, q, method } = r;
  if (path === '/api/billing' && q.action === 'status') return billingActive;
  if (path === '/api/billing' && q.action === 'referral') return { code: 'HOON-KYW84', type: 'percent', value: 10, redeemedCount: 3, active: true, rewardAmount: 5478, rewardPending: 2 };
  if (path === '/api/billing' && q.action === 'email-pref') return { optOut: false };
  const s = shellMocks(r); if (s !== undefined) return s;
  if (path === '/api/usage') {
    if (q.action === 'onboarding') return { steps: { sourcing: true, rank: true, coupang: false }, done: false, dismissed: false };
    if (q.action === 'onboarding-dismiss') return { ok: true };
    if (q.action === 'limits') return { resetAt: new Date(Date.now() + 8 * 3600_000).toISOString(), unlimited: false, features: [{ feature: 'sourcing', limit: 20, used: 7, remaining: 13 }, { feature: 'reviews', limit: 10, used: 2, remaining: 8 }, { feature: 'rank', limit: 30, used: 12, remaining: 18 }, { feature: 'qa', limit: 30, used: 4, remaining: 26 }] };
    if (q.action === 'report-list') return reportList;
    if (q.action === 'report-get') return { report: { id: 12, summary: reportList.reports[0].summary, rows: adRows().slice(0, 30), row_count: 30, truncated: false, created_at: iso(addDays(TODAY, -21)) } };
    if (q.action === 'report-save' || q.action === 'report-delete') return { ok: true };
  }
  if (path === '/api/sourcing') {
    if (q.type === 'rankwatch' && q.action === 'list') return { watches };
    if (q.type === 'rankwatch' && q.action === 'add') return { ok: true, productId: '1002', rankChecked: true, currentRank: 12, remaining: 25, searchedTo: 60 };
    if (q.type === 'rankwatch' && q.action === 'check') return { rankChecked: true, currentRank: 5, page: 1, remaining: 24, searchedTo: 60 };
    if (q.type === 'rankwatch' && q.action === 'remove') return { ok: true };
    if (q.type === 'rankwatch' && q.action === 'competitors') return competitors(q.keyword);
    if (q.type === 'competitor-changes') return competitorChanges;
    if (q.type === 'favorites' && q.action === 'report') return { report: [{ keyword: '캠핑의자', stat: null, lastCrawledAt: iso(TODAY), totalOnPage: 36, medianReviews: 312, rocketRatio: 28, movers: [
      { productId: '1005', productName: '캠핑의자 릴렉스 체어 목받침 접이식 대형', productPrice: 33900, productUrl: 'https://www.coupang.com/vp/products/1005', productImage: svgImg('릴렉스', 330), reviewCount: 2094, growthPerDay: 5.2, obsDays: 14 },
      { productId: '1002', productName: '캠핑의자 접이식 경량 릴렉스체어 2개 세트', productPrice: 45900, productUrl: 'https://www.coupang.com/vp/products/1002', productImage: svgImg('2개 세트', 30), reviewCount: 1310, growthPerDay: 4.1, obsDays: 14 } ] },
      { keyword: '여자 니트티', stat: null, lastCrawledAt: iso(TODAY), totalOnPage: 60, medianReviews: 812, rocketRatio: 70, movers: [
      { productId: '55001', productName: '베이직 라운드 니트 티셔츠 가을 여성 긴팔', productPrice: 19900, productUrl: 'https://www.coupang.com/vp/products/55001', productImage: svgImg('니트티', 200), reviewCount: 4120, growthPerDay: 11.6, obsDays: 14 } ] }] };
    if (q.type === 'favorites' && q.action === 'add') return { ok: true };
    if (q.type === 'briefing') return { month: 11, leadMonths: 2, generatedAt: iso(TODAY), items: [{ keyword: '전기요', monthlyVolume: 184000 }, { keyword: '가습기', monthlyVolume: 96000 }, { keyword: '기모 레깅스', monthlyVolume: 61000 }, { keyword: '수면 잠옷', monthlyVolume: 44000 }] };
    if (q.type === 'reviews' && q.stage === 'collect') return { productId: '1001', productName: reviewFull.productName, reviewCount: 187, pending: true, remaining: 8, samples: reviewSamples };
    if (q.type === 'reviews') return reviewFull;
    if (q.type === 'saved-compare') return savedCompare;
  }
  if (path === '/api/works') {
    if (q.action === 'list') return works;
    if (q.action === 'save' || q.action === 'delete') return { ok: true, id: 'w-new' };
  }
  if (path === '/api/qa') {
    if (q.action === 'my-answers') return myAnswers;
    if (q.action === 'ask') return { answer: qaAnswer, matched: true, logId: 'log-1', remaining: 25 };
    if (q.action === 'feedback' || q.action === 'mark-seen') return { ok: true };
  }
  if (path === '/api/coupang') {
    if (q.action === 'sales-movers') return { from: addDays(TODAY, -7), to: addDays(TODAY, -1), prevFrom: addDays(TODAY, -14), prevTo: addDays(TODAY, -8),
      drops: [{ vendorItemId: '7001', productName: '데일리 라운드넥 니트 티셔츠', optionName: '블랙 / M', channel: 'growth', recentQty: 12, prevQty: 31, recentAmount: 322800, prevAmount: 833900, stock: 0, pct: -61, hints: ['품절 — 입고 필요'] }],
      rises: [{ vendorItemId: '7007', productName: '경량 패딩 조끼', optionName: '베이지 / L', channel: 'growth', recentQty: 22, prevQty: 9, recentAmount: 1009800, prevAmount: 413100, stock: 14, pct: 144, hints: ['재고 14개 — 곧 소진'] }] };
    if (q.action === 'goals') return { month: TODAY.slice(0, 7), revenueGoal: 30000000, profitGoal: 5000000, actual: { salesAmount: 21400000, profit: 3650000, daysPassed: 28, daysInMonth: 30, projectedSales: 22928000, projectedProfit: 3910000, adCostCoveredDays: 28 } };
    if (q.action === 'goals-save') return { ok: true, month: TODAY.slice(0, 7) };
    if (q.action === 'ad-report-raw') return adRaw;
    if (q.action === 'margin-preset') return marginPreset;
    if (q.action === 'ad-cost-save') return { ok: true, from: addDays(TODAY, -6), to: TODAY, days: 7, source: 'report', total: 2600000 };
    return coupangMocks(r);
  }
  return undefined;
};
