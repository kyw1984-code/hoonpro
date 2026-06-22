import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAdmin(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });

  const { userId } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId 가 필요합니다.' });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  const { error } = await supabase
    .from('sourcing_users')
    .update({ status: 'rejected' })
    .eq('id', userId);

  if (error) return res.status(500).json({ error: `서버 오류: ${error.message}` });

  return res.status(200).json({ message: '회원 가입을 거절했습니다.' });
}
