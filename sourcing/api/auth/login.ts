import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const TRIAL_DAYS = 7;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const jwtSecret = process.env.JWT_SECRET;
  if (!supabaseUrl || !supabaseKey || !jwtSecret) {
    return res.status(500).json({
      error: `환경변수 누락: URL=${supabaseUrl ? 'OK' : '없음'}, KEY=${supabaseKey ? 'OK' : '없음'}, JWT=${jwtSecret ? 'OK' : '없음'}`,
    });
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { email } = req.body ?? {};
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요.' });

  const { data: user, error } = await supabase
    .from('sourcing_users')
    .select('*')
    .eq('email', String(email).trim().toLowerCase())
    .single();

  if (error || !user) {
    return res.status(404).json({ error: '등록되지 않은 이메일입니다. 먼저 가입해주세요.' });
  }

  const trialStartedMs = new Date(user.trial_started_at).getTime();
  const trialExpiresMs = trialStartedMs + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  if (trialExpiresMs <= Date.now()) {
    return res.status(403).json({
      error: '7일 무료 체험이 만료됐습니다. 연장은 운영자에게 문의해주세요.',
    });
  }

  const expiresInSec = Math.max(60, Math.floor((trialExpiresMs - Date.now()) / 1000));

  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
      trialStartedAt: trialStartedMs,
      trialExpiresAt: trialExpiresMs,
    },
    jwtSecret,
    { expiresIn: expiresInSec }
  );

  return res.status(200).json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
    trialExpiresAt: trialExpiresMs,
  });
}
