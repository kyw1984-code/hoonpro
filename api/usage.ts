import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DAILY_LIMIT = 60;

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-flash-image': { input: 0.30, output: 30.00 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gpt-image-1.5': { input: 5.00, output: 40.00 },
  'gpt-image-1-mini': { input: 2.00, output: 8.00 },
  'gpt-image-1': { input: 5.00, output: 40.00 },
};

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
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }

  let decoded: any;
  try {
    decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET!);
  } catch {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다. 다시 로그인해주세요.' });
  }

  const action = (req.query.action as string) || req.body?.action || 'track';

  // 사용량 호출 기록 (비용/모델 로깅)
  if (action === 'log') {
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

  // 기본: 일일 사용 한도 증가 및 잔여 횟수 반환
  // 관리자는 한도 제한 없음
  if (decoded.isAdmin) {
    return res.status(200).json({ remaining: 999 });
  }

  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase.rpc('increment_usage', {
    p_user_id: decoded.userId,
    p_date: today,
    p_limit: DAILY_LIMIT,
  });

  if (error) return res.status(500).json({ error: '서버 오류가 발생했습니다.' });

  if (data.exceeded) {
    return res.status(429).json({
      error: `하루 ${DAILY_LIMIT}회 호출 한도를 초과했습니다. 내일 다시 이용해주세요.`,
    });
  }

  return res.status(200).json({ remaining: data.remaining });
}
