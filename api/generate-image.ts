import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// GPT Image 1.5 Medium 설정 (환경변수로 덮어쓰기 가능)
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5';
const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';

// gpt-image 단가(USD per 1M tokens, medium 기준 근사치) - 변동 시 수정
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-image-1.5': { input: 5.0, output: 40.0 },
  'gpt-image-1': { input: 5.0, output: 40.0 },
};

function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

// 앱의 9:16 / 1:1 비율을 OpenAI 지원 사이즈로 매핑
function mapSize(aspectRatio: string): string {
  switch (aspectRatio) {
    case '1:1':
      return '1024x1024';
    case '16:9':
      return '1536x1024';
    case '9:16':
    default:
      return '1024x1536';
  }
}

// 상세페이지/썸네일 공통 상업 사진 품질 키워드 (V2.1 프롬프트 규칙 기반)
const COMMERCIAL_QUALITY_KEYWORDS = [
  'photorealistic',
  'commercial product photography',
  'premium e-commerce visual',
  'natural lighting',
  'ultra realistic texture',
  'high-end advertising',
  'realistic shadows',
  'Korean e-commerce style',
  'high conversion design',
  'luxury branding',
].join(', ');

function parseDataUrl(input: string): { mime: string; buffer: Buffer } {
  const mime = input.startsWith('data:') ? input.split(';')[0].split(':')[1] : 'image/png';
  const base64Data = input.includes(',') ? input.split(',')[1] : input;
  return { mime: mime || 'image/png', buffer: Buffer.from(base64Data, 'base64') };
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' });

  const { prompt, images, aspectRatio, feature } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: '프롬프트가 필요합니다.' });
  }

  const size = mapSize(String(aspectRatio || '9:16'));
  const finalPrompt = `${prompt}\n\nQuality direction: ${COMMERCIAL_QUALITY_KEYWORDS}.`;
  const referenceImages: string[] = Array.isArray(images) ? images.filter(Boolean) : [];

  try {
    let openaiRes: Response;

    if (referenceImages.length > 0) {
      // 레퍼런스 제품 이미지가 있으면 편집(edit) 엔드포인트 사용
      const form = new FormData();
      form.append('model', OPENAI_IMAGE_MODEL);
      form.append('prompt', finalPrompt);
      form.append('quality', OPENAI_IMAGE_QUALITY);
      form.append('size', size);
      form.append('n', '1');
      referenceImages.forEach((img, idx) => {
        const { mime, buffer } = parseDataUrl(img);
        const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
        form.append('image[]', new Blob([buffer], { type: mime }), `reference-${idx}.${ext}`);
      });

      openaiRes = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } else {
      // 레퍼런스가 없으면 생성(generation) 엔드포인트 사용
      openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENAI_IMAGE_MODEL,
          prompt: finalPrompt,
          quality: OPENAI_IMAGE_QUALITY,
          size,
          n: 1,
        }),
      });
    }

    const data: any = await openaiRes.json();
    if (!openaiRes.ok) {
      console.error('OpenAI image error:', data);
      return res.status(502).json({ error: data?.error?.message || 'OpenAI 이미지 생성에 실패했습니다.' });
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return res.status(502).json({ error: '이미지 데이터가 응답에 없습니다.' });

    const inputTokens = Math.max(0, Number(data?.usage?.input_tokens) || 0);
    const outputTokens = Math.max(0, Number(data?.usage?.output_tokens) || 0);
    const cost = calcCostUsd(OPENAI_IMAGE_MODEL, inputTokens, outputTokens);

    // 사용량 로깅 (실패해도 응답은 정상 반환)
    try {
      await supabase.from('api_calls').insert({
        user_id: decoded.userId,
        feature: String(feature || (aspectRatio === '1:1' ? 'thumbnail-image' : 'detail-image')),
        model: OPENAI_IMAGE_MODEL,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: cost,
      });
    } catch (logErr) {
      console.error('Usage log failed:', logErr);
    }

    return res.status(200).json({
      image: `data:image/png;base64,${b64}`,
      model: OPENAI_IMAGE_MODEL,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    });
  } catch (error: any) {
    console.error('Image generation failed:', error);
    return res.status(500).json({ error: error?.message || '서버 오류' });
  }
}
