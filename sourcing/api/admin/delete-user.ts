import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

function verifyAdmin(req: VercelRequest): { ok: boolean; email?: string } {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return { ok: false };
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET!) as any;
    return { ok: decoded.isAdmin === true, email: decoded.email };
  } catch {
    return { ok: false };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = verifyAdmin(req);
  if (!admin.ok) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });

  const { userId } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId 가 필요합니다.' });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  // 자기 자신 삭제 방지
  const { data: target } = await supabase
    .from('sourcing_users')
    .select('email')
    .eq('id', userId)
    .single();
  if (target?.email === admin.email) {
    return res.status(400).json({ error: '본인 계정은 삭제할 수 없습니다.' });
  }

  const { error } = await supabase.from('sourcing_users').delete().eq('id', userId);
  if (error) return res.status(500).json({ error: `서버 오류: ${error.message}` });

  return res.status(200).json({ message: '회원이 삭제됐습니다.' });
}
