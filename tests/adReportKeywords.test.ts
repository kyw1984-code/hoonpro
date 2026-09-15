import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateKeywords, detectColumns, diffKeywords, isNonSearchPlatform, isSearchPlatform,
  normalizeRows, parseNum, ROAS_NOISE_PP,
} from '../src/lib/adReportKeywords.ts';

const row = (kw: string, platform: string, cost: number, clicks: number, qty: number, revenue?: number) => ({
  '키워드': kw,
  '광고 노출 지면': platform,
  '노출수': '1,000',
  '클릭수': String(clicks),
  '광고비': String(cost),
  '총 판매수량(14일)': String(qty),
  ...(revenue === undefined ? {} : { '총 전환매출액(14일)': String(revenue) }),
});

test('"비검색"이 "검색"을 품고 있어도 뒤바뀌지 않는다', () => {
  assert.equal(isSearchPlatform('검색 영역'), true);
  assert.equal(isSearchPlatform('비검색 영역'), false);
  assert.equal(isNonSearchPlatform('비검색 영역'), true);
  assert.equal(isNonSearchPlatform('검색 영역'), false);
});

test('쉼표·퍼센트·하이픈을 숫자로 읽는다', () => {
  assert.equal(parseNum('1,234'), 1234);
  assert.equal(parseNum('12%'), 12);
  assert.equal(parseNum('-'), 0);
  assert.equal(parseNum(''), 0);
  assert.equal(parseNum(null), 0);
  assert.equal(parseNum(5), 5);
});

test('열 이름 앞뒤 공백을 떼고 찾는다 — 엑셀에서 흔하다', () => {
  const rows = normalizeRows([{ ' 키워드 ': '가', '총 판매수량 ': '3' }]);
  assert.ok('키워드' in rows[0]);
  assert.equal(detectColumns(rows[0]).qty, '총 판매수량');
});

test('비검색 지면과 키워드 없는 줄은 키워드로 세지 않는다', () => {
  // '-'를 키워드로 세면 비검색 지면 전체가 '-'라는 키워드 하나로 뭉친다
  const { keywords } = aggregateKeywords([
    row('여름이불', '검색 영역', 10000, 50, 2, 40000),
    row('-', '비검색 영역', 30000, 100, 1, 20000),
    row('여름이불', '비검색 영역', 5000, 20, 0, 0),
  ], 20000);
  assert.equal(keywords.length, 1);
  assert.equal(keywords[0].keyword, '여름이불');
  assert.equal(keywords[0].cost, 10000);   // 비검색 5,000은 안 들어간다
  assert.equal(keywords[0].roasPct, 400);
});

test('전환매출 열이 없으면 판매수량 × 실결제가로 어림하고, 어림했다고 말한다', () => {
  const actual = aggregateKeywords([row('가', '검색', 1000, 10, 2, 8000)], 20418);
  assert.equal(actual.revenueMode, 'actual');
  assert.equal(actual.keywords[0].revenue, 8000);

  const est = aggregateKeywords([row('가', '검색', 1000, 10, 2)], 20418);
  assert.equal(est.revenueMode, 'estimated');
  assert.equal(est.keywords[0].revenue, 2 * 20418);
});

test('키워드 열이 아예 없으면 그렇다고 알린다', () => {
  const r = aggregateKeywords([{ '광고 노출 지면': '검색', '광고비': '100', '총 판매수량': '1' }], 10000);
  assert.equal(r.hasKeywordColumn, false);
  assert.equal(r.keywords.length, 0);
});

test('ROAS가 10%p 안쪽으로 움직인 것은 변화로 보지 않는다', () => {
  const prev = [{ keyword: '가', cost: 1000, clicks: 10, impressions: 100, qty: 1, revenue: 3000, roasPct: 300, cpc: 100 }];
  const cur = [{ keyword: '가', cost: 1000, clicks: 10, impressions: 100, qty: 1, revenue: 3050, roasPct: 305, cpc: 100 }];
  assert.ok(ROAS_NOISE_PP === 10);
  assert.equal(diffKeywords(prev, cur).rows[0].change, 'same');
});

test('돈은 더 썼는데 ROAS가 떨어진 키워드를 가장 먼저 짚는다', () => {
  const prev = [
    { keyword: '나쁨', cost: 10000, clicks: 50, impressions: 1000, qty: 2, revenue: 40000, roasPct: 400, cpc: 200 },
    { keyword: '좋음', cost: 5000, clicks: 20, impressions: 500, qty: 1, revenue: 10000, roasPct: 200, cpc: 250 },
  ];
  const cur = [
    { keyword: '나쁨', cost: 18000, clicks: 90, impressions: 2000, qty: 2, revenue: 36000, roasPct: 200, cpc: 200 },
    { keyword: '좋음', cost: 5000, clicks: 20, impressions: 500, qty: 3, revenue: 30000, roasPct: 600, cpc: 250 },
  ];
  const { summary } = diffKeywords(prev, cur);
  assert.equal(summary.worseAndCostlier.length, 1);
  assert.equal(summary.worseAndCostlier[0].keyword, '나쁨');
  assert.equal(summary.worseAndCostlier[0].costDelta, 8000);
  assert.equal(summary.improved[0].keyword, '좋음');
});

test('새로 생긴 키워드와 사라진 키워드의 광고비를 따로 센다 — 예산이 어디로 옮겨 갔나', () => {
  const prev = [{ keyword: '옛것', cost: 9000, clicks: 30, impressions: 900, qty: 1, revenue: 9000, roasPct: 100, cpc: 300 }];
  const cur = [{ keyword: '새것', cost: 12000, clicks: 40, impressions: 1200, qty: 3, revenue: 60000, roasPct: 500, cpc: 300 }];
  const { rows, summary } = diffKeywords(prev, cur);
  assert.equal(summary.added, 1);
  assert.equal(summary.removed, 1);
  assert.equal(summary.removedCost, 9000);
  assert.equal(summary.addedCost, 12000);
  assert.equal(rows.find(r => r.keyword === '새것')!.change, 'new');
  assert.equal(rows.find(r => r.keyword === '옛것')!.change, 'gone');
});

test('광고비가 큰 순으로 줄을 세운다 — 위부터 보게 된다', () => {
  const cur = [
    { keyword: '작음', cost: 1000, clicks: 5, impressions: 50, qty: 0, revenue: 0, roasPct: 0, cpc: 200 },
    { keyword: '큼', cost: 50000, clicks: 200, impressions: 5000, qty: 5, revenue: 100000, roasPct: 200, cpc: 250 },
  ];
  assert.equal(diffKeywords([], cur).rows[0].keyword, '큼');
});
