import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body ?? {};
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요.' });

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.trim().toLowerCase())
    .single();

  if (error || !user) {
    return res.status(404).json({ error: '등록되지 않은 이메일입니다.' });
  }
  if (user.status === 'pending') {
    return res.status(403).json({ error: '승인 대기 중입니다. 관리자 승인 후 이용 가능합니다.' });
  }
  if (user.status === 'rejected') {
    return res.status(403).json({ error: '접근이 거부됐습니다. 관리자에게 문의하세요.' });
  }

  const isAdmin = user.email === process.env.ADMIN_EMAIL;
  const token = jwt.sign(
    { userId: user.id, email: user.email, name: user.name, isAdmin },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  );

  return res.status(200).json({
    token,
    user: { id: user.id, name: user.name, email: user.email, isAdmin },
  });
}
