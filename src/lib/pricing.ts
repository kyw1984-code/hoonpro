// Gemini 모델 단가 (USD per 1M tokens)
// 가격이 바뀌면 이 표만 업데이트하면 됩니다.
// https://ai.google.dev/pricing
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-flash-image': { input: 0.30, output: 30.00 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  // OpenAI text
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
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

export function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model];
  if (!price) return 0;
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
