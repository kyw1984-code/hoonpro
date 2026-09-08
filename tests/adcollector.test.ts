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
