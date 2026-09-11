/**
 * 모델 단가 테스트.
 *
 * 이 표가 여섯 벌로 흩어져 있었고 이미 갈라져 있었다. gemini-2.5-flash가
 * 어떤 파일에서는 0원이라, 그 파일을 거친 호출은 원가가 0으로 기록됐다.
 * 관리자 화면의 AI 원가가 실제보다 적게 나오면 요금을 잘못 정하게 된다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcCostUsd, MODEL_PRICING } from '../src/lib/pricing.ts';

test('원가: 입력·출력 토큰에 각각 단가를 곱한다', () => {
  // gpt-4.1-mini: 입력 0.40, 출력 1.60 (100만 토큰당)
  assert.equal(calcCostUsd('gpt-4.1-mini', 1_000_000, 0), 0.40);
  assert.equal(calcCostUsd('gpt-4.1-mini', 0, 1_000_000), 1.60);
  assert.equal(calcCostUsd('gpt-4.1-mini', 500_000, 500_000), 1.00);
});

// 실제로 쓰는 모델이 표에 없으면 그 기능의 원가가 통째로 안 보인다
test('원가: 실제로 부르는 모델이 전부 표에 있다', () => {
  const used = [
    'gpt-4.1-mini',                    // qa, generate-text, analyze-image 기본
    'text-embedding-3-small',          // qa 임베딩
    'gpt-image-2',                     // generate-image 기본
    'gemini-2.5-flash',                // gemini 경로 텍스트
    'gemini-2.5-pro',
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image',
    'gemini-3-pro-image',
  ];
  for (const m of used) {
    assert.ok(MODEL_PRICING[m], `${m}이(가) 단가표에 없다`);
  }
});

// 0원짜리 항목이 있으면 그 모델을 쓰는 동안 원가가 안 보인다
test('원가: 0원으로 적힌 모델이 없다', () => {
  for (const [m, p] of Object.entries(MODEL_PRICING)) {
    // 임베딩은 출력 토큰이 없다
    if (m === 'text-embedding-3-small') { assert.ok(p.input > 0, m); continue; }
    assert.ok(p.input > 0 && p.output > 0, `${m}: 입력 ${p.input} 출력 ${p.output}`);
  }
});

test('원가: 모르는 모델은 0원이지만 조용하지는 않다', () => {
  const warned: string[] = [];
  const orig = console.warn;
  console.warn = (m: string) => warned.push(String(m));
  try {
    assert.equal(calcCostUsd('gpt-9-turbo', 1000, 1000), 0);
    assert.equal(warned.length, 1, '경고가 안 나왔다');
    assert.ok(warned[0].includes('gpt-9-turbo'));
    // 같은 모델로 또 불러도 한 번만 알린다
    calcCostUsd('gpt-9-turbo', 1000, 1000);
    assert.equal(warned.length, 1, '같은 모델을 두 번 알렸다');
  } finally {
    console.warn = orig;
  }
});

test('원가: 0토큰이면 0원', () => {
  assert.equal(calcCostUsd('gpt-4.1-mini', 0, 0), 0);
});
