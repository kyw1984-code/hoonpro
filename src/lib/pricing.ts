/**
 * 모델 단가 (USD / 100만 토큰) — 서버와 화면이 같은 표를 쓴다.
 *
 * 예전에는 이 표가 여섯 벌 있었다. api/qa.ts, generate-text.ts,
 * analyze-image.ts, generate-image.ts, usage.ts, 그리고 이 파일이다. 크기도
 * 4개부터 15개까지 제각각이었고, 이미 갈라져 있었다 — gemini-2.5-flash가
 * 어떤 파일에서는 0원이고 여기서는 0.30이었다. 그래서 그 파일을 거친 호출은
 * 원가가 0원으로 기록됐고, 관리자 화면의 AI 원가가 실제보다 적게 나왔다.
 *
 * 한도 0의 뜻을 뒤집을 때 다섯 곳 중 세 곳만 고쳐졌던 일과 같은 구조다.
 * 한 곳에 둔다.
 *
 * 가격 출처: https://ai.google.dev/pricing, https://openai.com/api/pricing
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Gemini text
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  // Gemini image
  'gemini-2.5-flash-image': { input: 0.30, output: 30.00 },
  'gemini-2.5-flash-image-preview': { input: 0.30, output: 30.00 },
  'gemini-3.1-flash-image': { input: 0.30, output: 30.00 },
  'gemini-3-pro-image': { input: 1.25, output: 60.00 },
  // OpenAI text
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  // GPT Image (근사치, 변동 시 수정)
  'gpt-image-2': { input: 5.00, output: 30.00 },
  'gpt-image-2-2026-04-21': { input: 5.00, output: 30.00 },
  'gpt-image-1.5': { input: 5.00, output: 40.00 },
  'gpt-image-1-mini': { input: 2.00, output: 8.00 },
  'gpt-image-1': { input: 5.00, output: 40.00 },
  'chatgpt-image-latest': { input: 5.00, output: 40.00 },
};

// USD → KRW 환율 (수동 업데이트)
export const USD_TO_KRW = 1380;

/** 표에 없는 모델 — 같은 이름으로 여러 번 경고하지 않게 기억해 둔다 */
const warnedModels = new Set<string>();

/**
 * 이 호출의 원가.
 *
 * 표에 없는 모델은 0원을 돌려주되 한 번은 알린다. 조용히 0을 돌려주면
 * 모델 이름 하나만 바뀌어도 그때부터 모든 호출이 공짜로 기록되고, 원가가
 * 안 보이는 채로 몇 달이 지난다.
 */
export function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model];
  if (!price) {
    if (model && !warnedModels.has(model)) {
      warnedModels.add(model);
      console.warn(`[원가] 단가표에 없는 모델이라 0원으로 기록합니다: ${model}`);
    }
    return 0;
  }
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(usd >= 1 ? 2 : 4)}`;
}

export function formatKrw(usd: number): string {
  const krw = Math.round(usd * USD_TO_KRW);
  return `₩${krw.toLocaleString('ko-KR')}`;
}

// 기능 라벨 (UI 표시용)
export const FEATURE_LABEL: Record<string, string> = {
  'detail-plan': '상세페이지 기획',
  'detail-image': '상세페이지 이미지',
  'thumbnail-image': '썸네일 이미지',
  'features-recommend': '핵심 특징 추천',
  'competitor-estimate': '경쟁사 데이터 추정',
  'competitor-analyze': '경쟁사 분석',
};
