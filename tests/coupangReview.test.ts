import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewJson, describeJson } from '../src/lib/coupangReview.ts';

test('쿠팡 껍데기(rCode/rData) 안의 리뷰를 읽는다', () => {
  const raw = JSON.stringify({
    rCode: '200', rMessage: '', rData: {
      paging: { page: 1, size: 10 },
      contents: [
        { reviewId: 1, rating: 5, reviewContent: '생각보다 얇고 가벼워서 좋아요' },
        { reviewId: 2, rating: 2, reviewContent: '마감이 너덜너덜합니다 반품했어요' },
      ],
    },
  });
  assert.deepEqual(parseReviewJson(raw), [
    { rating: 5, text: '생각보다 얇고 가벼워서 좋아요' },
    { rating: 2, text: '마감이 너덜너덜합니다 반품했어요' },
  ]);
});

test('껍데기 이름이 달라도 읽는다', () => {
  const raw = JSON.stringify({ data: { list: [{ score: 4, comment: '배송이 하루 만에 왔습니다' }] } });
  assert.deepEqual(parseReviewJson(raw), [{ rating: 4, text: '배송이 하루 만에 왔습니다' }]);
});

test('같은 본문이 두 번 들어 있어도 한 번만 담는다', () => {
  const text = '색상이 사진이랑 똑같아요 만족합니다';
  const raw = JSON.stringify({ best: [{ content: text, rating: 5 }], list: [{ content: text, rating: 5 }] });
  assert.equal(parseReviewJson(raw).length, 1);
});

test('별점이 5를 넘는 숫자는 별점으로 보지 않는다', () => {
  const raw = JSON.stringify({ list: [{ content: '도움이 많이 됐습니다 감사합니다', rating: 120 }] });
  assert.equal(parseReviewJson(raw)[0].rating, 0);
});

test('짧은 문자열은 리뷰로 보지 않는다', () => {
  const raw = JSON.stringify({ list: [{ content: '좋음' }, { content: '아주 마음에 듭니다 재구매할게요' }] });
  assert.equal(parseReviewJson(raw).length, 1);
});

test('공백은 한 칸으로 정리하고 600자에서 자른다', () => {
  const raw = JSON.stringify({ list: [{ content: '  줄바꿈이\n   들어간   리뷰입니다  ' }] });
  assert.equal(parseReviewJson(raw)[0].text, '줄바꿈이 들어간 리뷰입니다');
  const long = JSON.stringify({ list: [{ content: '가'.repeat(900) }] });
  assert.equal(parseReviewJson(long)[0].text.length, 600);
});

test('JSON이 아니면 빈 배열', () => {
  assert.deepEqual(parseReviewJson('<html>Access denied</html>'), []);
  assert.deepEqual(parseReviewJson(''), []);
});

test('describeJson은 키 이름과 타입만 남긴다', () => {
  const raw = JSON.stringify({ rCode: 'RET0018', rMessage: 'not login', rData: null });
  const s = describeJson(raw);
  assert.ok(s.includes('rCode:str(7)'));
  assert.ok(s.includes('rData:null'));
  assert.ok(!s.includes('not login'), '값은 남기지 않는다');
});

test('describeJson은 JSON이 아니면 앞부분을 보여준다', () => {
  assert.ok(describeJson('<html>Sorry! Access denied</html>').startsWith('JSON 아님:'));
});

test('리뷰 API 주소는 쪽과 건수를 반영한다', async () => {
  const { reviewApiUrl, REVIEW_PAGE_SIZE } = await import('../src/lib/coupangReview.ts');
  const u = reviewApiUrl('9174862914', 2);
  assert.ok(u.includes('productId=9174862914'));
  assert.ok(u.includes(`page=2`) && u.includes(`size=${REVIEW_PAGE_SIZE}`));
  // 브라우저가 보내는 모양 그대로 — 빈 값도 붙인다
  assert.ok(u.includes('sortBy=ORDER_SCORE_ASC') && u.includes('ratings=&market='));
});
