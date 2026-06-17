import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const ALLOWED_MODELS = [
  'gpt-image-2',
  'gpt-image-2-2026-04-21',
  'gpt-image-1.5',
  'gpt-image-1-mini',
  'gpt-image-1',
  'chatgpt-image-latest',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
  'gemini-2.5-flash-image-preview',
];
const ALLOWED_QUALITY = ['low', 'medium', 'high'];
const DEFAULTS = { imageModel: 'gpt-image-2', imageQuality: 'high', aiIntegratedTextEnabled: false };

function verifyAdmin(req: VercelRequest): boolean {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return false;
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET!) as any;
    return decoded.isAdmin === true;
  } catch {
    return false;
  }
}

// app_config 테이블 미존재 오류 판별
function isMissingTable(error: any): boolean {
  return error?.code === '42P01' || /app_config/.test(error?.message || '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!verifyAdmin(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });

  // 현재 설정 조회
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['image_model', 'image_quality', 'ai_integrated_text_enabled']);

    if (error) {
      if (isMissingTable(error)) {
        return res.status(200).json({ ...DEFAULTS, migrated: false });
      }
      return res.status(500).json({ error: '서버 오류' });
    }

    const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    return res.status(200).json({
      imageModel: ALLOWED_MODELS.includes(map.image_model) ? map.image_model : DEFAULTS.imageModel,
      imageQuality: ALLOWED_QUALITY.includes(map.image_quality) ? map.image_quality : DEFAULTS.imageQuality,
      aiIntegratedTextEnabled: map.ai_integrated_text_enabled === 'true',
      migrated: true,
    });
  }

  // 설정 변경
  if (req.method === 'POST') {
    const { imageModel, imageQuality, aiIntegratedTextEnabled } = req.body ?? {};
    if (!ALLOWED_MODELS.includes(imageModel) || !ALLOWED_QUALITY.includes(imageQuality)) {
      return res.status(400).json({ error: '허용되지 않은 모델 또는 품질입니다.' });
    }

    const now = new Date().toISOString();
    const { error } = await supabase.from('app_config').upsert(
      [
        { key: 'image_model', value: imageModel, updated_at: now },
        { key: 'image_quality', value: imageQuality, updated_at: now },
        { key: 'ai_integrated_text_enabled', value: aiIntegratedTextEnabled === true ? 'true' : 'false', updated_at: now },
      ],
      { onConflict: 'key' }
    );

    if (error) {
      if (isMissingTable(error)) {
        return res.status(400).json({ error: 'app_config 테이블이 없습니다. supabase-schema.sql 마이그레이션을 먼저 실행하세요.' });
      }
      return res.status(500).json({ error: '서버 오류' });
    }

    return res.status(200).json({ imageModel, imageQuality, aiIntegratedTextEnabled: aiIntegratedTextEnabled === true, message: '저장됐습니다.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
