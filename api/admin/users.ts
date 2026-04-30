import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

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

  const today = new Date().toISOString().split('T')[0];

  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, phone, email, status, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: '서버 오류' });

  const { data: usages } = await supabase
    .from('api_usage')
    .select('user_id, call_count')
    .eq('date', today);

  const usageMap: Record<string, number> = {};
  for (const u of usages ?? []) {
    usageMap[u.user_id] = u.call_count;
  }

  const result = (users ?? []).map((u: any) => ({
    ...u,
    today_calls: usageMap[u.id] ?? 0,
  }));

  return res.status(200).json(result);
}
