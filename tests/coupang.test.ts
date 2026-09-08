/**
 * 쿠팡 연동의 순수 계산 함수 테스트.
 * 실행: npm test
 *
 * 하한가 역산·상관·날짜 분할·시각 정규화는 돈과 직결되는데 눈으로 다시 확인하기
 * 어렵다. 회귀를 자동으로 잡기 위해 고정한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  authorization,
  couponForRow,
  dateChunks,
  definitionUnit,
  floorPriceFor,
  isActiveReturn,
  isAllowedReportHost,
  isTransient,
  lastWeekRange,
  median,
  monthEnd,
  monthsBetween,
  pearson,
  revenueHistoryQuery,
  rgDate,
  rgOrdersQuery,
  sellerProductsQuery,
  selectAll,
  sellerDiscountOf,
  signedDate,
  slope,
  toIso,
} from '../api/coupang';

test('signedDate: yyMMddTHHmmssZ 형식', () => {
  const s = signedDate();
  assert.match(s, /^\d{6}T\d{6}Z$/);
});

test('authorization: 헤더 형식과 hex 서명', () => {
  const h = authorization('GET', '/v2/x', 'a=1', 'AK', 'SK');
  assert.match(h, /^CEA algorithm=HmacSHA256, access-key=AK, signed-date=\d{6}T\d{6}Z, signature=[0-9a-f]{64}$/);
});

test('floorPriceFor: 목표 이익률을 실제로 만족한다', () => {
  const p = floorPriceFor(10_000, 10.8, 10)!;
  const margin = ((p - p * 0.108 - 10_000) / p) * 100;
  assert.ok(margin >= 10, `이익률 ${margin.toFixed(3)}%`);
  assert.equal(floorPriceFor(10_000, 60, 45), null, '수수료+목표가 100%를 넘으면 성립하지 않는다');
});

test('dateChunks: 빈틈·중복 없이 구간을 덮는다', () => {
  const c = dateChunks('2026-01-15', '2026-03-20', 30);
  assert.equal(c[0][0], '2026-01-15');
  assert.equal(c[c.length - 1][1], '2026-03-20');
  for (let i = 1; i < c.length; i++) assert.equal(addDays(c[i - 1][1], 1), c[i][0]);
  assert.deepEqual(dateChunks('2026-05-01', '2026-05-01', 30), [['2026-05-01', '2026-05-01']]);
});

test('toIso: 시간대 없는 값은 한국 시각으로 읽는다', () => {
  assert.equal(toIso('2026-09-05 14:00:00'), '2026-09-05T05:00:00.000Z');
  assert.equal(toIso('2026-09-05T14:00:00'), '2026-09-05T05:00:00.000Z');
  assert.equal(toIso('2026-09-05T14:00:00Z'), '2026-09-05T14:00:00.000Z');
  assert.equal(toIso('2026-09-05'), '2026-09-04T15:00:00.000Z');
  assert.equal(toIso(''), null);
  assert.equal(toIso('garbage'), null);
});

test('lastWeekRange: 월요일 아침 기준 지난주 월~일', () => {
  assert.deepEqual(lastWeekRange('2026-09-07'), { start: '2026-08-31', end: '2026-09-06' }); // 월
  assert.deepEqual(lastWeekRange('2026-09-09'), { start: '2026-08-31', end: '2026-09-06' }); // 수
});

test('pearson·slope: 순위가 낮을수록 많이 팔리면 음의 관계', () => {
  const ranks = [30, 25, 20, 15, 10, 5];
  const qty = [1, 2, 3, 4, 5, 6];
  const r = pearson(ranks, qty)!;
  assert.ok(r < -0.99);
  assert.ok(slope(ranks, qty)! < 0);
  assert.equal(pearson([5, 5, 5], [1, 2, 3]), null, '순위가 안 변하면 계산하지 않는다');
});

test('median: 짝수·홀수·빈 배열', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3);
  assert.equal(median([]), null);
  assert.equal(median([0, -1]), null, '0 이하는 가격이 아니다');
});

test('isActiveReturn: 취소·철회는 손실이 아니다', () => {
  assert.equal(isActiveReturn('RETURNS_COMPLETED'), true);
  assert.equal(isActiveReturn('CANCEL'), false);
  assert.equal(isActiveReturn('반품 철회'), false);
  assert.equal(isActiveReturn(null), true);
});

test('selectAll: 1000행 상한을 넘겨 끝까지 읽는다', async () => {
  // 2400행을 가진 가짜 테이블. PostgREST처럼 range로 잘라 돌려준다.
  const all = Array.from({ length: 2400 }, (_, i) => ({ i }));
  let calls = 0;
  const build = (from: number, to: number) => {
    calls++;
    return Promise.resolve({ data: all.slice(from, to + 1), error: null });
  };
  const { rows, truncated } = await selectAll<{ i: number }>(build);
  assert.equal(rows.length, 2400);
  assert.equal(truncated, false);
  assert.equal(calls, 3, '1000씩 세 번 읽는다');
  assert.equal(rows[2399].i, 2399, '마지막 행까지 들어온다');
});

test('selectAll: 마지막 페이지가 꽉 차면 한 번 더 확인한다', async () => {
  const all = Array.from({ length: 2000 }, (_, i) => ({ i }));
  const { rows, truncated } = await selectAll<{ i: number }>((f, t) =>
    Promise.resolve({ data: all.slice(f, t + 1), error: null }));
  assert.equal(rows.length, 2000);
  assert.equal(truncated, false, '빈 페이지를 확인해야 끝난 걸 안다');
});

test('selectAll: 오류는 그대로 올린다', async () => {
  await assert.rejects(
    () => selectAll(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
    /boom/,
  );
});

test('selectAll: 페이지 상한에 닿으면 truncated로 알린다', async () => {
  const { rows, truncated } = await selectAll<{ i: number }>(
    (f, t) => Promise.resolve({ data: Array.from({ length: t - f + 1 }, (_, k) => ({ i: f + k })), error: null }),
    10,
    3,
  );
  assert.equal(rows.length, 30);
  assert.equal(truncated, true);
});

// 매출내역: token이 빠지면 쿠팡이 'token cannot be null'로 거절해 매출이 0건이 된다.
// 주문은 정상이라 "왜 매출만 안 들어오지"로만 보여 원인 찾기가 오래 걸렸다.
test('매출내역 질의: 첫 조회에도 token= 을 반드시 붙인다', () => {
  const first = revenueHistoryQuery('A01653410', '2026-08-10', '2026-09-08', '');
  assert.match(first, /&token=&/, '첫 페이지에서 token이 빠지면 쿠팡이 거절한다');
  assert.equal(
    first,
    'vendorId=A01653410&recognitionDateFrom=2026-08-10&recognitionDateTo=2026-09-08&token=&maxPerPage=100',
  );

  const next = revenueHistoryQuery('A01653410', '2026-08-10', '2026-09-08', 'abc123');
  assert.match(next, /&token=abc123&/);
});

// 지급내역은 날짜 범위가 아니라 revenueRecognitionYearMonth(YYYY-MM)로만 조회된다.
// 월 목록을 잘못 만들면 정산 캘린더에 구멍이 생긴다.
test('지급내역 월 목록: 해를 넘겨도 이어진다', () => {
  assert.deepEqual(monthsBetween('2026-11-15', '2027-02-03'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(monthsBetween('2026-09-08', '2026-09-30'), ['2026-09']);
  // 끝이 시작보다 앞서도 최소 한 달은 돌려준다 (빈 배열이면 조회를 통째로 건너뛴다)
  assert.deepEqual(monthsBetween('2026-09-08', '2026-08-01'), ['2026-09']);
});

test('월 마지막 날: 윤년·12월 경계', () => {
  assert.equal(monthEnd('2026-09'), '2026-09-30');
  assert.equal(monthEnd('2026-12'), '2026-12-31');
  assert.equal(monthEnd('2024-02'), '2024-02-29');
  assert.equal(monthEnd('2026-02'), '2026-02-28');
});

// ── 상품 목록 질의 ────────────────────────────────────────────
// nextToken을 빼면 쿠팡이 오류 없이 빈 목록을 돌려준다. 그러면 '상품 0건인데
// 오류도 없음'이 되어 원가·재고·반품·가격 화면이 통째로 비는데 이유가 안 뜬다.
test('상품 목록 질의: 첫 페이지에도 nextToken을 빈 값으로 붙인다', () => {
  const first = sellerProductsQuery('A01653410', '');
  assert.ok(first.includes('nextToken='), `nextToken이 빠졌다: ${first}`);
  assert.equal(first, 'vendorId=A01653410&nextToken=&maxPerPage=100');

  const next = sellerProductsQuery('A01653410', 'tok9');
  assert.ok(next.includes('nextToken=tok9'));

  // 로켓그로스 상품은 businessTypes로 한 번 더 훑는다
  const growth = sellerProductsQuery('A01653410', '', 'rocketGrowth');
  assert.ok(growth.endsWith('&businessTypes=rocketGrowth'), growth);
});

// ── 로켓그로스 주문 질의 ──────────────────────────────────────
// 이 API만 하이픈 없는 날짜를 받고 maxPerPage를 받지 않는다. 둘 중 하나만
// 틀려도 Bad Request라 그로스 매출이 통째로 0이 된다.
test('로켓그로스 주문 질의: 하이픈 없는 날짜, maxPerPage 없음', () => {
  assert.equal(rgDate('2026-08-10'), '20260810');

  const q = rgOrdersQuery('2026-08-10', '2026-09-09', '');
  assert.equal(q, 'paidDateFrom=20260810&paidDateTo=20260909');
  assert.ok(!q.includes('maxPerPage'), `maxPerPage가 붙으면 거절당한다: ${q}`);
  assert.ok(!q.includes('-'), `날짜에 하이픈이 남아 있다: ${q}`);

  assert.equal(
    rgOrdersQuery('2026-08-10', '2026-09-09', 'tok1'),
    'paidDateFrom=20260810&paidDateTo=20260909&nextToken=tok1',
  );
});

// ── 지급내역 조회 월 ──────────────────────────────────────────
// 매출인식월은 '이번 달'까지만 조회할 수 있다. 앞선 달을 넣으면 400
// '해당월까지만 조회할 수 있습니다'로 거절당한다.
test('지급내역 월 목록: 이번 달을 넘기지 않는다', () => {
  const today = '2026-09-08';
  const months = monthsBetween(addDays(today, -120), monthEnd(today.slice(0, 7)));
  assert.equal(months[months.length - 1], '2026-09');
  assert.equal(months[0], '2026-05');
  assert.ok(!months.some(m => m > '2026-09'), months.join(','));
});

// ── 광고 보고서 주소 허용 목록 ─────────────────────────────────
// 사용자가 보낸 주소를 서버가 그대로 열면 내부망·메타데이터 주소를 찌르는 통로가 된다.
test('광고 보고서 주소: 쿠팡·쿠팡 저장소만, https 만', () => {
  assert.equal(isAllowedReportHost('https://advertising.coupang.com/x'), true);
  assert.equal(isAllowedReportHost('https://img1a.coupangcdn.com/report.xlsx'), true);
  assert.equal(isAllowedReportHost('https://cmg-report.s3.ap-northeast-2.amazonaws.com/a.xlsx?X-Amz-Signature=1'), true);
  assert.equal(isAllowedReportHost('http://advertising.coupang.com/x'), false);
  assert.equal(isAllowedReportHost('https://evil.com/coupang.com'), false);
  assert.equal(isAllowedReportHost('https://coupang.com.evil.com/'), false);
  assert.equal(isAllowedReportHost('https://169.254.169.254/latest/meta-data'), false);
  assert.equal(isAllowedReportHost('not a url'), false);
});

// ── 발주서 쿠폰 할인 ───────────────────────────────────────────
// 판매가 39,800원에 즉시할인쿠폰 10,000원이면 실제 판매가는 29,800원이다.
// 판매자 부담(즉시할인·다운로드쿠폰)만 빼고 쿠팡 부담은 빼지 않는다.
test('쿠폰 할인: 판매자 부담과 쿠팡 부담을 가른다', () => {
  assert.deepEqual(
    sellerDiscountOf({ discountPrice: 13000, instantCouponDiscount: 10000, downloadableCouponDiscount: 2000, coupangDiscount: 1000 }),
    { seller: 12000, coupang: 1000 },
  );
  // v5는 금액이 { units, nanos } 로 온다
  assert.deepEqual(
    sellerDiscountOf({ instantCouponDiscount: { units: 5000, nanos: 0 }, downloadableCouponDiscount: { units: 0, nanos: 0 }, coupangDiscount: { units: 0, nanos: 0 } }),
    { seller: 5000, coupang: 0 },
  );
  // 부담 항목이 없고 총액만 있으면 전부 판매자 부담으로 본다 — 실매출을 크게 보는 쪽이 더 나쁘다
  assert.deepEqual(sellerDiscountOf({ discountPrice: '3,000' }), { seller: 3000, coupang: 0 });
  assert.deepEqual(sellerDiscountOf({}), { seller: 0, coupang: 0 });
});

// ── 행별 쿠폰 = 단가 × 판매수량 ──────────────────────────────────
// 7개 팔린 행에 37개 주문의 쿠폰(460,600원)을 그대로 붙이면 쿠폰이 매출을 넘는다.
test('쿠폰 행 계산: 채널별 단가 × 수량, 매출을 넘지 않는다', () => {
  // 윙 주문 37개에 460,600원 → 단가 12,449원. 매출인식 7개면 87,143원
  assert.equal(couponForRow(7, 0, 460600 / 37, 0, 289800), Math.round((7 * 460600) / 37));
  // 그로스 44개 주문에 221,000원 → 5,000원 × 44
  assert.equal(couponForRow(0, 44, 0, 5000, 1601600), 220000);
  // 두 채널 섞임
  assert.equal(couponForRow(3, 2, 1000, 500, 999999), 4000);
  // 매출 상한
  assert.equal(couponForRow(10, 0, 50000, 0, 120000), 120000);
  assert.equal(couponForRow(0, 0, 100, 100, 1000), 0);
});

// ── 쿠폰 설정값 → 개당 할인 ─────────────────────────────────────
// 판매자가 아는 숫자와 맞아야 한다: 1건당 11,500원이면 2건에 23,000원.
test('definitionUnit: 정액은 그대로, 정률은 단가 × 비율(최대할인 상한)', () => {
  const fixed = { coupon_type: 'PRICE', discount: 11500, max_discount: null, status: 'APPLIED', start_at: null, end_at: null };
  assert.equal(definitionUnit([fixed], 41400, '2026-09-01', '2026-09-08'), 11500);
  assert.equal(couponForRow(2, 0, definitionUnit([fixed], 41400, '2026-09-01', '2026-09-08'), 0, 82800), 23000);
  const rate = { coupon_type: 'RATE', discount: 10, max_discount: 3000, status: 'APPLIED', start_at: null, end_at: null };
  assert.equal(definitionUnit([rate], 41400, '2026-09-01', '2026-09-08'), 3000);
  assert.equal(definitionUnit([{ ...rate, max_discount: null }], 41400, '2026-09-01', '2026-09-08'), 4140);
  // 정액 + 정률이 같이 붙으면 더한다
  assert.equal(definitionUnit([fixed, rate], 41400, '2026-09-01', '2026-09-08'), 14500);
});

test('definitionUnit: 기간 밖·종료 상태 쿠폰은 뺀다', () => {
  const base = { coupon_type: 'FIXED_WITH_QUANTITY', discount: 5000, max_discount: null, status: 'APPLIED' };
  assert.equal(definitionUnit([{ ...base, start_at: '2026-09-10T00:00:00+09:00', end_at: null }], 10000, '2026-09-01', '2026-09-08'), 0);
  assert.equal(definitionUnit([{ ...base, start_at: null, end_at: '2026-08-30T23:59:59+09:00' }], 10000, '2026-09-01', '2026-09-08'), 0);
  assert.equal(definitionUnit([{ ...base, start_at: '2026-09-05', end_at: '2026-09-06' }], 10000, '2026-09-01', '2026-09-08'), 5000);
  assert.equal(definitionUnit([{ ...base, status: 'EXPIRED', start_at: null, end_at: null }], 10000, '2026-09-01', '2026-09-08'), 0);
  assert.equal(definitionUnit([], 10000, '2026-09-01', '2026-09-08'), 0);
});

test('isTransient: 망 오류·중계 5xx만 다시 시도한다', () => {
  assert.equal(isTransient({ ok: false, status: 0 }), true);
  // 시간 상한에 걸린 호출은 이미 예산을 썼다. 다시 부르면 그만큼 또 기다린다.
  assert.equal(isTransient({ ok: false, status: 0, timedOut: true }), false);
  assert.equal(isTransient({ ok: false, status: 502, relayError: true }), true);
  assert.equal(isTransient({ ok: false, status: 502 }), false);
  assert.equal(isTransient({ ok: false, status: 400 }), false);
  assert.equal(isTransient({ ok: false, status: 401, authFailed: true }), false);
  assert.equal(isTransient({ ok: true, status: 200 }), false);
});

// ── 개당 쿠폰 상한 ──────────────────────────────────────────────
// 진짜 고침은 '할인과 수량을 같은 행에서 짝짓는 것'이다. 아래 상한은 그물이다 —
// 어떤 이유로 계산이 틀려도 개당 쿠폰이 개당 판매가를 넘지는 않게 한다.
test('쿠폰 행 계산: 개당 쿠폰은 개당 판매가를 넘지 않는다', () => {
  const unitPrice = 36_400;
  const qty = 42;
  const sales = unitPrice * qty;

  // 짝이 안 맞는 나눗셈이 만든 값(63,800)은 판매가에서 잘린다
  assert.equal(Math.min(63_800, unitPrice), unitPrice);

  // 짝을 맞춰 계산한 값은 그대로 통과한다.
  // 그로스 160행 중 수량이 있는 80행만 쓰면 1,549,200 ÷ 82 이 된다.
  const paired = Math.round(1_549_200 / 82);
  assert.ok(paired < unitPrice, '짝을 맞추면 개당 판매가 아래로 떨어진다');
  assert.equal(couponForRow(0, qty, 0, paired, sales), paired * qty);
  // 실매출이 남는다 — 쿠폰이 매출을 통째로 먹지 않는다
  assert.ok(sales - paired * qty > 0);
});
