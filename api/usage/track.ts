import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DAILY_LIMIT = 30;

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
