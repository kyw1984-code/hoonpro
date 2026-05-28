import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const TRIAL_DAYS = 7;

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAdmin(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  const { data: users, error } = await supabase
    .from('sourcing_users')
    .select('id, name, phone, email, trial_started_at, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: `서버 오류: ${error.message}` });

  const now = Date.now();
  const result = (users ?? []).map((u: any) => {
    const startedMs = new Date(u.trial_started_at).getTime();
    const expiresMs = startedMs + TRIAL_DAYS * 24 * 60 * 60 * 1000;
    const remainingMs = expiresMs - now;
    return {
      ...u,
      trial_expires_at: new Date(expiresMs).toISOString(),
      remaining_days: Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24))),
      is_expired: remainingMs <= 0,
    };
  });

  return res.status(200).json(result);
}
