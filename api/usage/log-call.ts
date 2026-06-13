import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Modality } from '@google/genai';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-flash-image': { input: 0.30, output: 30.00 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gpt-image-2': { input: 8.00, output: 30.00 },
  'gpt-image-1.5': { input: 8.00, output: 32.05 },
  'gpt-image-1': { input: 8.00, output: 40.06 },
  'gpt-image-1-mini': { input: 8.00, output: 8.33 },
};

const DEFAULT_IMAGE_SETTINGS = {
  provider: 'gemini',
  model: 'gemini-2.5-flash-image',
};

const IMAGE_MODEL_PROVIDER: Record<string, 'gemini' | 'openai'> = {
  'gemini-2.5-flash-image': 'gemini',
  'gpt-image-2': 'openai',
  'gpt-image-1.5': 'openai',
  'gpt-image-1': 'openai',
  'gpt-image-1-mini': 'openai',
};

function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

function normalizeImageSettings(value: any) {
  const model = String(value?.model || DEFAULT_IMAGE_SETTINGS.model);
  const provider = IMAGE_MODEL_PROVIDER[model];
  if (!provider) return DEFAULT_IMAGE_SETTINGS;
  return { provider, model };
}

async function getImageSettings() {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'image_generation')
      .maybeSingle();
    if (error) throw error;
    return normalizeImageSettings(data?.value);
  } catch {
    return DEFAULT_IMAGE_SETTINGS;
  }
}

function parseDataUrl(dataUrl: string) {
  const [meta, base64 = ''] = dataUrl.split(',');
  const mimeType = meta.match(/^data:(.*?);base64$/)?.[1] || 'image/png';
  return { mimeType, base64 };
}

function estimateInputTokens(prompt: string, imageCount: number): number {
  return Math.ceil(prompt.length / 3) + imageCount * 350;
}

function estimateOutputTokens(aspectRatio: string, model?: string): number {
  if (model && ['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'].includes(model)) {
    return aspectRatio === '1:1' ? 4160 : 6240;
  }
  if (aspectRatio === '1:1') return 1100;
  if (aspectRatio === '4:5') return 1400;
  if (aspectRatio === '3:4') return 1500;
  return 1650;
}

function toOpenAiSize(aspectRatio: string): string {
  if (aspectRatio === '1:1') return '1024x1024';
  return '1024x1536';
}

function toOpenAiPrompt(prompt: string, aspectRatio: string): string {
  const sizeGuide = aspectRatio === '1:1'
    ? 'Create a square 1:1 e-commerce thumbnail composition.'
    : 'Create a portrait vertical e-commerce detail-page composition.';
  return `${sizeGuide}\n${prompt}`;
}

async function generateWithGemini(prompt: string, base64Images: string[], aspectRatio: string, model: string) {
  const apiKey = (
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.VITE_GOOGLE_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    ''
  ).trim();
  if (!apiKey) throw new Error('Gemini API 키가 설정되지 않았습니다.');

  const ai = new GoogleGenAI({ apiKey });
  const parts: any[] = [];
  for (const image of base64Images) {
    const parsed = parseDataUrl(image);
    parts.push({ inlineData: { data: parsed.base64, mimeType: parsed.mimeType } });
  }

  const taskInstruction = aspectRatio !== '1:1'
    ? 'Generate a polished vertical Korean e-commerce detail-page visual in a refined editorial AI-image style. The image should feel like a premium product story page, not a generic ad banner.'
    : 'Generate a high-quality product image.';
  parts.push({ text: `${taskInstruction} ${prompt}. Aspect ratio: ${aspectRatio}.` });

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      responseModalities: [Modality.IMAGE, Modality.TEXT],
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData) {
      return {
        imageUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        inputTokens: response.usageMetadata?.promptTokenCount ?? estimateInputTokens(prompt, base64Images.length),
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? estimateOutputTokens(aspectRatio, model),
      };
    }
  }

  throw new Error('이미지 데이터가 응답에 없습니다.');
}

async function generateWithOpenAi(prompt: string, base64Images: string[], aspectRatio: string, model: string) {
  const apiKey = (process.env.OPENAIAPIKEY || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAIAPIKEY가 설정되지 않았습니다.');

  const fullPrompt = toOpenAiPrompt(prompt, aspectRatio);
  const size = toOpenAiSize(aspectRatio);
  const headers = { Authorization: `Bearer ${apiKey}` };
  let endpoint = 'https://api.openai.com/v1/images/generations';
  let body: BodyInit;

  if (base64Images.length > 0) {
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
    outputTokens: usage?.output_tokens ?? estimateOutputTokens(aspectRatio, model),
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

  if (String(req.query.mode || '') === 'generate-image') {
    const prompt = String(req.body?.prompt || '').trim();
    const base64Images = Array.isArray(req.body?.base64Images) ? req.body.base64Images.map(String) : [];
    const aspectRatio = String(req.body?.aspectRatio || '1:1');
    if (!prompt) return res.status(400).json({ error: '프롬프트가 필요합니다.' });

    const settings = await getImageSettings();
    const feature = aspectRatio === '1:1' ? 'thumbnail-image' : 'detail-image';

    try {
      const result = settings.provider === 'openai'
        ? await generateWithOpenAi(prompt, base64Images, aspectRatio, settings.model)
        : await generateWithGemini(prompt, base64Images, aspectRatio, settings.model);

      const { error } = await supabase.from('api_calls').insert({
        user_id: decoded.userId,
        feature,
        model: settings.model,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_usd: calcCostUsd(settings.model, result.inputTokens, result.outputTokens),
      });
      if (error) return res.status(500).json({ error: '사용량 저장 중 서버 오류가 발생했습니다.' });

      return res.status(200).json({ imageUrl: result.imageUrl, settings });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || '이미지 생성에 실패했습니다.', settings });
    }
  }

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
