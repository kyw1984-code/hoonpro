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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyAdmin(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });

  const { userId, action } = req.body ?? {};

  // 회원 승인/거절
  if (action === 'approve' || action === 'reject') {
    if (!userId) return res.status(400).json({ error: '잘못된 요청입니다.' });
    const status = action === 'approve' ? 'approved' : 'rejected';
    const { error } = await supabase.from('users').update({ status }).eq('id', userId);
    if (error) return res.status(500).json({ error: '서버 오류' });
    return res.status(200).json({ message: action === 'approve' ? '승인됐습니다.' : '거절됐습니다.' });
  }

  // 대기 회원 일괄 승인
  if (action === 'bulk-approve') {
    const { data, error } = await supabase
      .from('users')
      .update({ status: 'approved' })
      .eq('status', 'pending')
      .select('id');
    if (error) return res.status(500).json({ error: '서버 오류' });
    const count = data?.length ?? 0;
    return res.status(200).json({
      message: count > 0 ? `${count}명이 일괄 승인됐습니다.` : '승인 대기 중인 회원이 없습니다.',
      count,
    });
  }

  // 오늘 사용 횟수 리셋
  if (action === 'reset') {
    if (!userId) return res.status(400).json({ error: '잘못된 요청입니다.' });
    const today = new Date().toISOString().split('T')[0];
    const { error } = await supabase
      .from('api_usage')
      .update({ call_count: 0 })
      .eq('user_id', userId)
      .eq('date', today);
    if (error) return res.status(500).json({ error: '서버 오류' });
    return res.status(200).json({ message: '사용 횟수가 리셋됐습니다.' });
  }

  return res.status(400).json({ error: '잘못된 요청입니다.' });
}
