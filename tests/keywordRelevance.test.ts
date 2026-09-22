/**
 * 검색어 관련도 정렬 테스트.
 *
 * "여자 니트티"를 검색했으면 여자 니트티 계열이 맨 위에, 그 다음 니트티,
 * 그 다음 여자 옷 순서여야 한다. 검색량이 아무리 커도 무관한 키워드가
 * 관련 키워드 위로 올라오면 안 된다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relevanceScore, seedTokens, sortByRelevance, normalizeKeyword } from '../src/lib/keywordRelevance.ts';

test('띄어쓰기·동의어를 무시하고 같은 말로 본다', () => {
  assert.equal(normalizeKeyword('여성 니트 티셔츠'), normalizeKeyword('여자니트티'));
});

test('붙여 쓴 검색어도 성별 앞머리를 떼어 낱말로 나눈다', () => {
  assert.deepEqual(seedTokens('여자니트티'), ['여자', '니트티']);
  assert.deepEqual(seedTokens('여자 니트티'), ['여자', '니트티']);
  assert.deepEqual(seedTokens('니트티'), ['니트티']);
});

test('관련도 순서: 그대로 > 통째로 품음 > 낱말 전부 > 핵심어 > 낱말 하나 > 무관', () => {
  const seed = '여자 니트티';
  const exact = relevanceScore(seed, '여자니트티');
  // '여자니트티셔츠'는 티셔츠=티 동의어라 검색어 그대로로 본다. 통째로 품는 예는 따로 든다
  const superset = relevanceScore(seed, '여자니트티 추천');
  const allTokens = relevanceScore(seed, '니트티 여성');
  const headOnly = relevanceScore(seed, '남자니트티');
  const oneToken = relevanceScore(seed, '여자가디건');
  const none = relevanceScore(seed, '원피스');
  assert.ok(exact > superset, '검색어 그대로가 가장 위');
  assert.ok(superset > allTokens);
  assert.ok(allTokens > headOnly);
  assert.ok(headOnly > oneToken);
  assert.ok(oneToken > none);
  assert.equal(none, 0);
});

test('검색량이 커도 무관한 키워드는 관련 키워드 아래로 간다', () => {
  const rows = [
    { keyword: '원피스', monthlyVolume: 900000 },
    { keyword: '여자니트티셔츠', monthlyVolume: 3000 },
    { keyword: '니트티', monthlyVolume: 50000 },
    { keyword: '여성 니트티', monthlyVolume: 8000 },
    { keyword: '여자가디건', monthlyVolume: 120000 },
  ];
  const out = sortByRelevance('여자 니트티', rows).map(r => r.keyword);
  // 여성 니트티·여자니트티셔츠는 동의어 정규화로 검색어 그대로가 되어 검색량순
  assert.deepEqual(out, ['여성 니트티', '여자니트티셔츠', '니트티', '여자가디건', '원피스']);
});

test('같은 관련도면 검색량이 큰 쪽이 앞', () => {
  const rows = [
    { keyword: '여자니트티 추천', monthlyVolume: 100 },
    { keyword: '여자니트티셔츠', monthlyVolume: 5000 },
  ];
  const out = sortByRelevance('여자니트티', rows).map(r => r.keyword);
  assert.deepEqual(out, ['여자니트티셔츠', '여자니트티 추천']);
});
