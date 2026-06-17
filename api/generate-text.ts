import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DEFAULT_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini';
const DEFAULT_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';

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
let cachedModelConfig: { imageModel: string } | null = null;
let cacheExpiresAt = 0;

async function getSelectedImageModel(): Promise<string> {
  const now = Date.now();
  if (cachedModelConfig && now < cacheExpiresAt) return cachedModelConfig.imageModel;
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .eq('key', 'image_model')
      .maybeSingle();
    if (error) throw error;
    const imageModel = [...OPENAI_IMAGE_MODELS, ...GEMINI_IMAGE_MODELS].includes(data?.value)
      ? data.value
      : DEFAULT_IMAGE_MODEL;
    cachedModelConfig = { imageModel };
    cacheExpiresAt = now + CONFIG_TTL_MS;
    return imageModel;
  } catch {
    return cachedModelConfig?.imageModel || DEFAULT_IMAGE_MODEL;
  }
}

function isGeminiModel(model: string): boolean {
  return model.startsWith('gemini-');
}

function mapGeminiTextModel(selectedImageModel: string): string {
  if (selectedImageModel === 'gemini-3-pro-image') return process.env.GEMINI_TEXT_MODEL_PRO || 'gemini-2.5-pro';
  return process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
}

function extractGeminiText(data: any): string {
  return (data?.candidates?.[0]?.content?.parts || [])
    .map((part: any) => part?.text || '')
    .join('')
    .trim();
}

function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
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

  const { prompt, feature, mode } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: '프롬프트가 필요합니다.' });
  }

  const selectedImageModel = await getSelectedImageModel();
  const useGemini = isGeminiModel(selectedImageModel);
  const model = useGemini ? mapGeminiTextModel(selectedImageModel) : String(process.env.OPENAI_TEXT_MODEL || DEFAULT_TEXT_MODEL);
  const wantsJson = mode === 'json';

  try {
    if (useGemini) {
      const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY;
      if (!geminiKey) return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' });
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `${wantsJson ? 'Return valid JSON only. ' : 'Return concise Korean text only. '}${prompt}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            ...(wantsJson ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      });
      const data: any = await geminiRes.json();
      if (!geminiRes.ok) {
        const detail = data?.error?.message || `Gemini 텍스트 생성 실패 (HTTP ${geminiRes.status})`;
        console.error('Gemini text error:', JSON.stringify(data));
        return res.status(geminiRes.status === 429 ? 429 : 502).json({ error: detail });
      }
      const text = extractGeminiText(data);
      if (!text) return res.status(502).json({ error: 'Gemini 텍스트 응답이 비어 있습니다.' });
      const inputTokens = Math.max(0, Number(data?.usageMetadata?.promptTokenCount) || 0);
      const outputTokens = Math.max(0, Number(data?.usageMetadata?.candidatesTokenCount) || 0);
      try {
        await supabase.from('api_calls').insert({
          user_id: decoded.userId,
          feature: String(feature || 'gemini-text'),
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd: 0,
        });
      } catch (logErr) {
        console.error('Gemini text usage log failed:', logErr);
      }
      return res.status(200).json({
        text,
        model,
        provider: 'gemini',
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      });
    }

    const apiKey = process.env.OPENAIAPIKEY || process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENAIAPIKEY가 설정되지 않았습니다.' });

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: wantsJson
              ? 'You are a precise Korean e-commerce strategist. Return valid JSON only.'
              : 'You are a precise Korean e-commerce copywriter. Return concise Korean text only.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        ...(wantsJson ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    const data: any = await openaiRes.json();
    if (!openaiRes.ok) {
      const detail = data?.error?.message || `OpenAI 텍스트 생성 실패 (HTTP ${openaiRes.status})`;
      console.error('OpenAI text error:', JSON.stringify(data));
      return res.status(openaiRes.status === 429 ? 429 : 502).json({ error: detail });
    }

    const text = data?.choices?.[0]?.message?.content;
    if (!text) return res.status(502).json({ error: '텍스트 응답이 비어 있습니다.' });

    const inputTokens = Math.max(0, Number(data?.usage?.prompt_tokens) || 0);
    const outputTokens = Math.max(0, Number(data?.usage?.completion_tokens) || 0);
    const cost = calcCostUsd(model, inputTokens, outputTokens);

    try {
      await supabase.from('api_calls').insert({
        user_id: decoded.userId,
        feature: String(feature || 'gpt-text'),
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: cost,
      });
    } catch (logErr) {
      console.error('Text usage log failed:', logErr);
    }

    return res.status(200).json({
      text,
      model,
      provider: 'openai',
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    });
  } catch (error: any) {
    console.error('OpenAI text generation failed:', error);
    return res.status(500).json({ error: error?.message || '서버 오류' });
  }
}
