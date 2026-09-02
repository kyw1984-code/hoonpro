import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

// ═══════════════════════════════════════════════════════════════════════════════
// 작업 보관함 — 상세페이지 기획안·썸네일 결과물을 서버에 저장해 다시 본다.
// kind: 'detail-plan' (payload={planText, plan}) | 'thumbnail' (payload={url, path})
// 썸네일 이미지는 Supabase Storage 'works' 버킷에 올리고 URL만 저장한다.
// ═══════════════════════════════════════════════════════════════════════════════

// 요청 본문은 Vercel 기본 한도(4.5MB) 내에서 처리된다 (썸네일 dataURL 포함)
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const MAX_WORKS_PER_USER = 50;
const KINDS = ['detail-plan', 'thumbnail'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: '인증이 필요합니다.' });
  let decoded: any;
  try {
    decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET!);
  } catch {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다. 다시 로그인해주세요.' });
  }

  // 유료화 게이트 — billing_enforced가 켜지면 유효한 구독 없이는 사용 불가 (api/qa.ts와 동일 기준)
  if (!decoded.isAdmin) {
    const { data: enforcedCfg } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'billing_enforced')
      .maybeSingle();
    if (enforcedCfg?.value === 'true') {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('status')
        .eq('user_id', decoded.userId)
        .maybeSingle();
      if (!sub || !['trial', 'active', 'past_due'].includes(sub.status)) {
        return res.status(402).json({
          error: '구독 후 이용할 수 있습니다. [구독 관리] 탭에서 구독을 시작해주세요.',
          subscriptionRequired: true,
        });
      }
    }
  }

  const userId = decoded.userId;
  const action = (req.query.action as string) || 'list';

  if (action === 'list') {
    const { data, error } = await supabase
      .from('saved_works')
      .select('id, kind, title, payload, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(MAX_WORKS_PER_USER);
    if (error) {
      if (/saved_works/.test(error.message || '')) {
        return res.status(400).json({ error: 'saved_works 테이블이 없습니다. supabase-schema.sql 마이그레이션을 실행해주세요.' });
      }
      return res.status(500).json({ error: '조회 실패' });
    }
    return res.status(200).json({ works: data || [] });
  }

  if (action === 'save') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { kind, title, payload, image } = req.body ?? {};
    if (!KINDS.includes(kind)) return res.status(400).json({ error: '지원하지 않는 종류입니다.' });

    const { count } = await supabase
      .from('saved_works')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    if ((count || 0) >= MAX_WORKS_PER_USER) {
      return res.status(400).json({ error: `보관함은 최대 ${MAX_WORKS_PER_USER}개까지 저장할 수 있습니다. 오래된 항목을 삭제해주세요.` });
    }

    let finalPayload: any = payload && typeof payload === 'object' ? payload : {};

    // 썸네일: dataURL 이미지를 Storage에 올리고 URL만 저장
    if (kind === 'thumbnail') {
      const m = typeof image === 'string' ? image.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/) : null;
      if (!m) return res.status(400).json({ error: '이미지 데이터가 올바르지 않습니다.' });
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 6 * 1024 * 1024) return res.status(400).json({ error: '이미지가 너무 큽니다 (6MB 이하).' });
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('works').upload(path, buf, {
        contentType: `image/${m[1]}`,
        upsert: false,
      });
      if (upErr) {
        return res.status(400).json({ error: `이미지 업로드 실패: ${upErr.message} (Storage에 'works' 버킷이 있는지 확인해주세요)` });
      }
      const { data: pub } = supabase.storage.from('works').getPublicUrl(path);
      finalPayload = { url: pub.publicUrl, path };
    }

    const { data, error } = await supabase
      .from('saved_works')
      .insert({ user_id: userId, kind, title: String(title || '').slice(0, 200) || null, payload: finalPayload })
      .select('id')
      .single();
    if (error) {
      if (/saved_works/.test(error.message || '')) {
        return res.status(400).json({ error: 'saved_works 테이블이 없습니다. supabase-schema.sql 마이그레이션을 실행해주세요.' });
      }
      return res.status(500).json({ error: '저장 실패' });
    }
    return res.status(200).json({ ok: true, id: data.id });
  }

  if (action === 'delete') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { id } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
    const { data: row } = await supabase
      .from('saved_works')
      .select('payload')
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (row?.payload?.path) {
      await supabase.storage.from('works').remove([row.payload.path]).catch(() => {});
    }
    await supabase.from('saved_works').delete().eq('user_id', userId).eq('id', id);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'action=list | save | delete 가 필요합니다.' });
}
