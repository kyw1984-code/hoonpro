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

  const { userId, days } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId 가 필요합니다.' });
  const addDays = Number(days);
  if (!Number.isFinite(addDays) || addDays === 0) {
    return res.status(400).json({ error: 'days 는 0이 아닌 숫자여야 합니다.' });
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  // 현재 trial_started_at + addDays 로 이동 (음수면 단축)
  const { data: user, error: fetchErr } = await supabase
    .from('sourcing_users')
    .select('trial_started_at')
    .eq('id', userId)
    .single();

  if (fetchErr || !user) return res.status(404).json({ error: '회원을 찾을 수 없습니다.' });

  const currentStartMs = new Date(user.trial_started_at).getTime();
  const newStartMs = currentStartMs + addDays * 24 * 60 * 60 * 1000;
  const newStartIso = new Date(newStartMs).toISOString();

  const { error: updErr } = await supabase
    .from('sourcing_users')
    .update({ trial_started_at: newStartIso })
    .eq('id', userId);

  if (updErr) return res.status(500).json({ error: `서버 오류: ${updErr.message}` });

  return res.status(200).json({
    message: `체험 기간을 ${addDays > 0 ? `+${addDays}` : addDays}일 조정했습니다.`,
    trial_started_at: newStartIso,
  });
}
