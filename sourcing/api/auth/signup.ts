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

  const { name, phone, email } = req.body ?? {};
  if (!name || !phone || !email) {
    return res.status(400).json({ error: '이름, 연락처, 이메일을 모두 입력해주세요.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: '올바른 이메일 형식이 아닙니다.' });
  }

  const trialStartedAt = new Date();

  const { data: user, error } = await supabase
    .from('sourcing_users')
    .insert({ name, phone, email, trial_started_at: trialStartedAt.toISOString() })
    .select('*')
    .single();

  if (error || !user) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: '이미 가입된 이메일입니다. 로그인 탭을 이용해주세요.' });
    }
    return res.status(500).json({ error: `서버 오류: ${error?.message ?? 'unknown'} (code: ${error?.code ?? '-'})` });
  }

  const trialStartedMs = new Date(user.trial_started_at).getTime();
  const trialExpiresMs = trialStartedMs + TRIAL_DAYS * 24 * 60 * 60 * 1000;
  const isAdmin = !!process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL.toLowerCase();
  // 관리자는 만료 없이 30일 토큰, 일반은 체험 만료까지
  const expiresInSec = isAdmin
    ? 30 * 24 * 60 * 60
    : Math.max(60, Math.floor((trialExpiresMs - Date.now()) / 1000));

  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
      trialStartedAt: trialStartedMs,
      trialExpiresAt: trialExpiresMs,
      isAdmin,
    },
    jwtSecret,
    { expiresIn: expiresInSec }
  );

  return res.status(201).json({
    token,
    user: { id: user.id, name: user.name, email: user.email, isAdmin },
    trialExpiresAt: trialExpiresMs,
  });
}
