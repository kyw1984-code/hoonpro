/**
 * 광고센터 북마클릿 조립 테스트.
 *
 * 북마클릿은 함수를 toString()으로 문자열화해 실어 보낸다. 번들러가 바깥 참조를
 * 만들어 넣거나 경로 문자열이 바뀌면 판매자 브라우저에서 조용히 죽는다.
 * 여기서 그 문자열이 자기완결적인지, 실제 광고센터 경로를 담고 있는지 고정한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAdBookmarklet, ymdToIso, AD_CENTER_ORIGIN } from '../src/lib/adCollector.ts';
import { extractDailyAdCost, extractItemAdCost, rowsFromMatrix, toISODate } from '../src/lib/adcost.ts';

test('북마클릿: javascript: 주소이고 광고센터 요청 경로를 전부 담는다', () => {
  const url = buildAdBookmarklet('https://hoonproai.com');
  assert.ok(url.startsWith('javascript:'));
  const src = decodeURIComponent(url.slice('javascript:'.length));

  // 화면이 실제로 쓰는 경로·오퍼레이션
  for (const needle of [
    '/marketing-reporting/v2/graphql',
    '/marketing-reporting/v2/api/excel-report?id=',
    'GetCampaignListInBillboard',
    'requestReport(',
    'reportList(',
    'hoonpro-ad-report',
    'hoonpro-ad-ready',
    '"https://hoonproai.com"',
  ]) {
    assert.ok(src.includes(needle), `빠짐: ${needle}`);
  }

  // 바깥 모듈을 참조하면 광고센터 안에서 ReferenceError로 죽는다
  assert.ok(!/\bimport\b|\brequire\(|\bexports\./.test(src), '바깥 참조가 섞였다');
  // 문법이 유효해야 한다 — 실행은 하지 않고 파싱만 한다
  assert.doesNotThrow(() => new Function(src));
});

test('북마클릿: 광고센터 주소를 정확히 검사한다', () => {
  assert.equal(AD_CENTER_ORIGIN, 'https://advertising.coupang.com');
  const src = decodeURIComponent(buildAdBookmarklet('https://hoonproai.com').slice('javascript:'.length));
  // 따옴표 종류는 도구가 바꿀 수 있다 — 값만 본다
  assert.ok(/["']advertising\.coupang\.com["']/.test(src));
});

test('yyyyMMdd 숫자 → ISO 날짜', () => {
  assert.equal(ymdToIso(20260907), '2026-09-07');
  assert.equal(ymdToIso('20260101'), '2026-01-01');
  assert.equal(ymdToIso('2026-09-07'), '');
  assert.equal(ymdToIso(''), '');
});

// ── 헤더 줄 탐지 ───────────────────────────────────────────────
// 쿠팡 보고서는 제목 줄이 헤더 위에 온다. 첫 줄을 헤더로 읽으면 일자 열을 못 찾고
// 광고비가 기간에 균등 분배되는 쪽으로 조용히 떨어진다.
test('rowsFromMatrix: 제목 줄 아래의 헤더를 찾는다', () => {
  const rows = rowsFromMatrix([
    ['광고 보고서', null, null],
    ['기간: 2026-08-10 ~ 2026-09-08', null, null],
    [],
    ['날짜', '캠페인명', '광고비'],
    ['2026-09-06', 'A', '15,000'],
    ['2026-09-07', 'B', 20000],
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]), ['날짜', '캠페인명', '광고비']);
  const daily = extractDailyAdCost(rows);
  assert.ok(daily);
  assert.deepEqual(daily!.days, [{ date: '2026-09-06', cost: 15000 }, { date: '2026-09-07', cost: 20000 }]);
});

test('rowsFromMatrix: 헤더가 첫 줄이면 그대로', () => {
  const rows = rowsFromMatrix([['날짜', '광고비'], ['2026-09-01', 100]]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['광고비'], 100);
});

// ── 옵션별 광고비 ───────────────────────────────────────────────
test('extractItemAdCost: 날짜·옵션별로 합치고 옵션ID 없는 행은 건너뛴다', () => {
  const rows = [
    { 날짜: '2026-09-06', '광고집행 옵션ID': 111, 광고비: '1,000' },
    { 날짜: '2026-09-06', '광고집행 옵션ID': 111, 광고비: 500 },
    { 날짜: '2026-09-06', '광고집행 옵션ID': 222, 광고비: 300 },
    { 날짜: '2026-09-07', '광고집행 옵션ID': '', 광고비: 999 },
  ];
  const out = extractItemAdCost(rows)!;
  assert.deepEqual(
    out.sort((a, b) => (a.vendorItemId < b.vendorItemId ? -1 : 1)),
    [
      { date: '2026-09-06', vendorItemId: '111', cost: 1500 },
      { date: '2026-09-06', vendorItemId: '222', cost: 300 },
    ],
  );
  assert.equal(extractItemAdCost([{ 날짜: '2026-09-06', 광고비: 1 }]), null);
});

// ── 날짜 형식 ───────────────────────────────────────────────────
// 광고센터 보고서의 날짜는 20260906 처럼 구분자가 없다. 실제로 이 형식을 못 읽어
// 30일치 광고비가 통째로 균등 분배됐다.
test('toISODate: 구분자 없는 yyyyMMdd (숫자·문자열)', () => {
  assert.equal(toISODate(20260906), '2026-09-06');
  assert.equal(toISODate('20260906'), '2026-09-06');
  assert.equal(toISODate('2026-09-06'), '2026-09-06');
  assert.equal(toISODate('2026.9.6'), '2026-09-06');
  assert.equal(toISODate('20261399'), null);
  assert.equal(toISODate('abc'), null);
});
