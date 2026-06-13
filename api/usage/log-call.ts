import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// 이미지 생성 모델 (gpt-image-1-mini 기본)
const IMAGE_MODEL = (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1-mini').trim();

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-flash-image': { input: 0.30, output: 30.00 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gpt-image-1': { input: 8.00, output: 40.06 },
  'gpt-image-1-mini': { input: 8.00, output: 8.33 },
};

function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

function parseDataUrl(dataUrl: string) {
  const [meta, base64 = ''] = dataUrl.split(',');
  const mimeType = meta.match(/^data:(.*?);base64$/)?.[1] || 'image/png';
  return { mimeType, base64 };
}

function estimateInputTokens(prompt: string, imageCount: number): number {
  return Math.ceil(prompt.length / 3) + imageCount * 350;
}

function estimateOutputTokens(aspectRatio: string): number {
  return aspectRatio === '1:1' ? 4160 : 6240;
}

function toOpenAiSize(aspectRatio: string): string {
  // gpt-image-1 계열 지원 사이즈: 1024x1024(정사각), 1024x1536(세로)
  return aspectRatio === '1:1' ? '1024x1024' : '1024x1536';
}

// 디자이너가 만든 상세페이지 수준의 결과가 나오도록 GPT 이미지 프롬프트에 주입하는 품질 지시문
const OPENAI_QUALITY_DIRECTIVE = `
PHOTOGRAPHIC QUALITY (HIGHEST PRIORITY):
- Render as a hyper-realistic, ultra-sharp, high-resolution commercial product photograph at the level of a professional Korean e-commerce (상세페이지) studio designer.
- Emulate a full-frame mirrorless camera with an 85mm prime lens, controlled depth of field, tack-sharp focus on the product, and clean natural bokeh where appropriate.
- Professional studio lighting: soft key light, gentle fill, subtle rim light, smooth gradient falloff, realistic soft shadows and contact shadows that ground the subject.
- True-to-life color accuracy, correct white balance, natural skin tones, rich micro-detail in fabric weave, stitching, material texture, and surface finish.
- Magazine editorial / lookbook grade composition: balanced negative space, intentional framing, refined premium mood, clean copy-safe area.
- ABSOLUTELY NO TEXT, no letters, no numbers, no captions, no logos-as-text, no watermark, no UI — the Korean copy is overlaid by the app afterwards.
- STRICTLY AVOID: low-resolution or blurry output, plastic or over-smoothed skin, waxy CGI look, color banding, oversaturation, harsh flat lighting, warped product geometry, distorted hands or fingers, garbled or duplicated logos, extra limbs, and obvious AI artifacts.
`.trim();

function toOpenAiPrompt(prompt: string, aspectRatio: string): string {
  const sizeGuide = aspectRatio === '1:1'
    ? 'Create a square 1:1 premium e-commerce thumbnail composition with the product as a clear hero.'
    : 'Create a portrait vertical premium Korean e-commerce detail-page (상세페이지) composition that looks designed by a professional studio.';
  return `${sizeGuide}\n${prompt}\n\n${OPENAI_QUALITY_DIRECTIVE}`;
}

async function generateWithOpenAi(prompt: string, base64Images: string[], aspectRatio: string, model: string) {
  const apiKey = (process.env.OPENAIAPIKEY || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAIAPIKEY가 설정되지 않았습니다. Vercel 환경변수를 확인해주세요.');

  const fullPrompt = toOpenAiPrompt(prompt, aspectRatio);
  const size = toOpenAiSize(aspectRatio);
  const headers = { Authorization: `Bearer ${apiKey}` };
  let endpoint = 'https://api.openai.com/v1/images/generations';
  let body: BodyInit;

  if (base64Images.length > 0) {
    // 레퍼런스 제품 사진이 있으면 edits 엔드포인트 (색상/로고/디테일 유지)
    endpoint = 'https://api.openai.com/v1/images/edits';
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', fullPrompt);
    form.append('size', size);
    form.append('quality', 'high');
    base64Images.forEach((image, index) => {
      const parsed = parseDataUrl(image);
      const bytes = Buffer.from(parsed.base64, 'base64');
      form.append('image[]', new Blob([bytes], { type: parsed.mimeType }), `reference-${index + 1}.png`);
    });
    body = form;
  } else {
    body = JSON.stringify({ model, prompt: fullPrompt, size, quality: 'high' });
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: base64Images.length > 0 ? headers : { ...headers, 'Content-Type': 'application/json' },
    body,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'OpenAI 이미지 생성에 실패했습니다.');
  }

  const base64 = data?.data?.[0]?.b64_json;
  if (!base64) throw new Error('OpenAI 응답에 이미지 데이터가 없습니다.');

  const usage = data?.usage;
  return {
    imageUrl: `data:image/png;base64,${base64}`,
    inputTokens: usage?.input_tokens ?? estimateInputTokens(prompt, base64Images.length),
    outputTokens: usage?.output_tokens ?? estimateOutputTokens(aspectRatio),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: '인증이 필요합니다.' });

  let decoded: any;
  try {
    decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET!);
  } catch {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }

  // ─── 이미지 생성 모드 (GPT) ───────────────────────────────────────────────
  if (String(req.query.mode || '') === 'generate-image') {
    const prompt = String(req.body?.prompt || '').trim();
    const base64Images = Array.isArray(req.body?.base64Images) ? req.body.base64Images.map(String) : [];
    const aspectRatio = String(req.body?.aspectRatio || '9:16');
    if (!prompt) return res.status(400).json({ error: '프롬프트가 필요합니다.' });

    const feature = aspectRatio === '1:1' ? 'thumbnail-image' : 'detail-image';

    try {
      const result = await generateWithOpenAi(prompt, base64Images, aspectRatio, IMAGE_MODEL);

      const { error } = await supabase.from('api_calls').insert({
        user_id: decoded.userId,
        feature,
        model: IMAGE_MODEL,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_usd: calcCostUsd(IMAGE_MODEL, result.inputTokens, result.outputTokens),
      });
      if (error) return res.status(500).json({ error: '사용량 저장 중 서버 오류가 발생했습니다.' });

      return res.status(200).json({ imageUrl: result.imageUrl });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || '이미지 생성에 실패했습니다.' });
    }
  }

  // ─── 일반 사용량 로깅 모드 ────────────────────────────────────────────────
  const { feature, model, inputTokens, outputTokens } = req.body ?? {};
  if (!feature || !model) return res.status(400).json({ error: '잘못된 요청입니다.' });

  const inTok = Math.max(0, Number(inputTokens) || 0);
  const outTok = Math.max(0, Number(outputTokens) || 0);
  const cost = calcCostUsd(String(model), inTok, outTok);

  const { error } = await supabase.from('api_calls').insert({
    user_id: decoded.userId,
    feature: String(feature),
    model: String(model),
    input_tokens: inTok,
    output_tokens: outTok,
    cost_usd: cost,
  });

  if (error) return res.status(500).json({ error: '서버 오류' });

  return res.status(200).json({ ok: true });
}

export const config = { maxDuration: 120 };
