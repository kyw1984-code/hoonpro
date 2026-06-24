import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini';
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';

const OPENAI_IMAGE_MODELS = [
  'gpt-image-2',
  'gpt-image-2-2026-04-21',
  'gpt-image-1.5',
  'gpt-image-1-mini',
  'gpt-image-1',
  'chatgpt-image-latest',
];

const GEMINI_IMAGE_MODELS = [
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
  'gemini-2.5-flash-image-preview',
];

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gemini-2.5-flash': { input: 0, output: 0 },
  'gemini-2.5-pro': { input: 0, output: 0 },
};

const CONFIG_TTL_MS = 45_000;
let cachedImageModel: string | null = null;
let cacheExpiresAt = 0;

function parseDataUrl(input: string): { mime: string; data: string } {
  const mime = input.startsWith('data:') ? input.split(';')[0].split(':')[1] : 'image/png';
  const data = input.includes(',') ? input.split(',')[1] : input;
  return { mime: mime || 'image/png', data };
}

function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

function isGeminiImageModel(model: string): boolean {
  return model.startsWith('gemini-');
}

async function getSelectedImageModel(): Promise<string> {
  const now = Date.now();
  if (cachedImageModel && now < cacheExpiresAt) return cachedImageModel;
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .eq('key', 'image_model')
      .maybeSingle();
    if (error) throw error;
    cachedImageModel = [...OPENAI_IMAGE_MODELS, ...GEMINI_IMAGE_MODELS].includes(data?.value)
      ? data.value
      : 'gpt-image-2';
    cacheExpiresAt = now + CONFIG_TTL_MS;
    return cachedImageModel;
  } catch {
    return cachedImageModel || 'gpt-image-2';
  }
}

function extractJson(text: string): any {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON 분석 응답을 파싱하지 못했습니다.');
    return JSON.parse(match[0]);
  }
}

function normalizeResult(raw: any, provider: 'openai' | 'gemini', model: string) {
  const warnings = Array.isArray(raw?.warnings) ? raw.warnings.map(String).filter(Boolean).slice(0, 8) : [];
  return {
    ok: raw?.ok === true && warnings.length === 0,
    warnings,
    summary: String(raw?.summary || '').slice(0, 500),
    preserveProfile: raw?.preserveProfile ? String(raw.preserveProfile).slice(0, 800) : undefined,
    regenerationHint: raw?.regenerationHint ? String(raw.regenerationHint).slice(0, 800) : undefined,
    detectedColors: Array.isArray(raw?.detectedColors) ? raw.detectedColors.map(String).slice(0, 8) : [],
    detectedSurface: ['printed', 'plain', 'unknown'].includes(raw?.detectedSurface) ? raw.detectedSurface : 'unknown',
    detectedProductCount: Number.isFinite(Number(raw?.detectedProductCount)) ? Number(raw.detectedProductCount) : undefined,
    detectedModelCount: Number.isFinite(Number(raw?.detectedModelCount)) ? Number(raw.detectedModelCount) : undefined,
    hasUnexpectedText: raw?.hasUnexpectedText === true,
    provider,
    model,
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

  const {
    image,
    referenceImages = [],
    mode = 'qa',
    productName = '',
    sectionRole = '',
    shotType = '',
    combinationCount = 1,
    genderLock = 'none',
    expectedNoText = true,
    expectedProductOnly = false,
    expectedProblemScene = false,
  } = req.body ?? {};

  if (!image || typeof image !== 'string') return res.status(400).json({ error: '분석할 이미지가 필요합니다.' });

  const selectedImageModel = await getSelectedImageModel();
  const provider: 'openai' | 'gemini' = isGeminiImageModel(selectedImageModel) ? 'gemini' : 'openai';
  const model = provider === 'gemini' ? GEMINI_VISION_MODEL : OPENAI_VISION_MODEL;
  const instruction = `
You are a strict ecommerce product-image QA inspector.
Return JSON only with:
{
  "ok": boolean,
  "warnings": string[],
  "summary": string,
  "preserveProfile": string,
  "regenerationHint": string,
  "detectedColors": string[],
  "detectedSurface": "printed" | "plain" | "unknown",
  "detectedProductCount": number,
  "detectedModelCount": number,
  "hasUnexpectedText": boolean
}

Mode: ${mode}
Product: ${productName}
Section role: ${sectionRole}
Shot type: ${shotType}
Selected bundle count: ${combinationCount}
Gender lock: ${genderLock}
Expected no added text: ${expectedNoText}
Expected product only/no person: ${expectedProductOnly}
Expected before/problem scene without current selling product: ${expectedProblemScene}

For reference analysis mode, identify exact product preservation facts: color, garment/product type, print/logo/pattern, material/surface, silhouette, and visible must-preserve details.
For QA mode, compare generated image against reference images when provided. Warn if product color changed, print/logo/pattern is missing, product became plain, model gender violates lock, bundle product/model count is too low, product is hidden/folded/draped, unwanted readable text appears, product-only section has people, or problem scene shows the current selling product.
Warnings must be short Korean labels. regenerationHint must be a concise English prompt correction.
`.trim();

  try {
    if (provider === 'gemini') {
      const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY;
      if (!geminiKey) return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });
      const parts: any[] = [{ text: instruction }];
      [...(Array.isArray(referenceImages) ? referenceImages : []), image].slice(0, 6).forEach((img) => {
        const parsed = parseDataUrl(String(img));
        parts.push({ inlineData: { mimeType: parsed.mime, data: parsed.data } });
      });
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      });
      const data: any = await geminiRes.json();
      if (!geminiRes.ok) return res.status(502).json({ error: data?.error?.message || 'Gemini 이미지 분석 실패' });
      const text = (data?.candidates?.[0]?.content?.parts || []).map((part: any) => part?.text || '').join('');
      const inputTokens = Math.max(0, Number(data?.usageMetadata?.promptTokenCount) || 0);
      const outputTokens = Math.max(0, Number(data?.usageMetadata?.candidatesTokenCount) || 0);
      try {
        await supabase.from('api_calls').insert({
          user_id: decoded.userId,
          feature: mode === 'reference' ? 'detail-reference-vision' : 'detail-image-qa',
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd: 0,
        });
      } catch (logErr) {
        console.error('Vision usage log failed:', logErr);
      }
      return res.status(200).json(normalizeResult(extractJson(text), provider, model));
    }

    const apiKey = process.env.OPENAIAPIKEY || process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENAIAPIKEY가 설정되지 않았습니다.' });
    const content: any[] = [{ type: 'text', text: instruction }];
    [...(Array.isArray(referenceImages) ? referenceImages : []), image].slice(0, 6).forEach((img) => {
      content.push({ type: 'image_url', image_url: { url: String(img) } });
    });
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Return valid JSON only. Be strict but concise.' },
          { role: 'user', content },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });
    const data: any = await openaiRes.json();
    if (!openaiRes.ok) return res.status(502).json({ error: data?.error?.message || 'OpenAI 이미지 분석 실패' });
    const text = data?.choices?.[0]?.message?.content || '';
    const inputTokens = Math.max(0, Number(data?.usage?.prompt_tokens) || 0);
    const outputTokens = Math.max(0, Number(data?.usage?.completion_tokens) || 0);
    const cost = calcCostUsd(model, inputTokens, outputTokens);
    try {
      await supabase.from('api_calls').insert({
        user_id: decoded.userId,
        feature: mode === 'reference' ? 'detail-reference-vision' : 'detail-image-qa',
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: cost,
      });
    } catch (logErr) {
      console.error('Vision usage log failed:', logErr);
    }
    return res.status(200).json(normalizeResult(extractJson(text), provider, model));
  } catch (error: any) {
    console.error('Image analysis failed:', error);
    return res.status(500).json({ error: error?.message || '이미지 분석 중 오류가 발생했습니다.' });
  }
}
