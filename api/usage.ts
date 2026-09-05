import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DAILY_LIMIT = 40;

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-flash-image': { input: 0.30, output: 30.00 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-image-2': { input: 5.00, output: 30.00 },
  'gpt-image-2-2026-04-21': { input: 5.00, output: 30.00 },
  'gpt-image-1.5': { input: 5.00, output: 40.00 },
  'gpt-image-1-mini': { input: 2.00, output: 8.00 },
  'gpt-image-1': { input: 5.00, output: 40.00 },
  'chatgpt-image-latest': { input: 5.00, output: 40.00 },
};

function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }

  let decoded: any;
  try {
    decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET!);
  } catch {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다. 다시 로그인해주세요.' });
  }

  const action = (req.query.action as string) || req.body?.action || 'track';

  if (action === 'config') {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .eq('key', 'ai_integrated_text_enabled')
      .maybeSingle();

    if (error) {
      return res.status(200).json({ aiIntegratedTextEnabled: false });
    }

    return res.status(200).json({
      aiIntegratedTextEnabled: data?.value === 'true',
    });
  }

  // ─── 광고 보고서 추이 (요약본 저장·조회 — 지난 보고서 대비 변화 비교용) ───
  if (action === 'report-save') {
    const { summary } = req.body ?? {};
    if (!summary || typeof summary !== 'object') return res.status(400).json({ error: '저장할 요약이 없습니다.' });
    const { error } = await supabase.from('ad_reports').insert({ user_id: decoded.userId, summary });
    if (error) {
      if (/ad_reports/.test(error.message || '')) {
        return res.status(400).json({ error: 'ad_reports 테이블이 없습니다. supabase-schema.sql 마이그레이션을 실행해주세요.' });
      }
      return res.status(500).json({ error: '저장 실패' });
    }
    // 사용자당 최근 24개만 보존
    try {
      const { data: old } = await supabase
        .from('ad_reports')
        .select('id')
        .eq('user_id', decoded.userId)
        .order('created_at', { ascending: false })
        .range(24, 200);
      if (old && old.length > 0) {
        await supabase.from('ad_reports').delete().in('id', old.map(r => r.id));
      }
    } catch { /* 정리 실패는 무시 */ }
    return res.status(200).json({ ok: true });
  }

  if (action === 'report-list') {
    const { data, error } = await supabase
      .from('ad_reports')
      .select('id, summary, created_at')
      .eq('user_id', decoded.userId)
      .order('created_at', { ascending: false })
      .limit(12);
    if (error) return res.status(200).json({ reports: [] });
    return res.status(200).json({ reports: data || [] });
  }

  if (action === 'report-delete') {
    const { id } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'id가 필요합니다.' });
    await supabase.from('ad_reports').delete().eq('user_id', decoded.userId).eq('id', id);
    return res.status(200).json({ ok: true });
  }

  // ─── 온보딩 (첫 사용 안내) ───
  // 완료 여부는 별도 플래그가 아니라 실제 사용 데이터로 판정한다.
  // 그래서 기존 사용자에게는 처음부터 완료 상태로 보이고, 카드가 뜨지 않는다.
  if (action === 'onboarding') {
    const since90 = new Date(Date.now() - 90 * 86400_000).toISOString();
    const [favRes, watchRes, thumbRes, userRes] = await Promise.all([
      supabase.from('sourcing_favorites').select('keyword', { count: 'exact', head: true })
        .eq('user_id', decoded.userId),
      supabase.from('sourcing_rank_watch').select('product_id', { count: 'exact', head: true })
        .eq('user_id', decoded.userId),
      supabase.from('api_calls').select('id', { count: 'exact', head: true })
        .eq('user_id', decoded.userId).like('feature', '%thumbnail%').gte('created_at', since90),
      supabase.from('users').select('onboarding_dismissed_at').eq('id', decoded.userId).maybeSingle(),
    ]);

    const steps = {
      sourcing: (favRes.count ?? 0) > 0,
      rank: (watchRes.count ?? 0) > 0,
      thumbnail: (thumbRes.count ?? 0) > 0,
    };
    const done = steps.sourcing && steps.rank && steps.thumbnail;

    return res.status(200).json({
      steps,
      done,
      dismissed: Boolean(userRes.data?.onboarding_dismissed_at),
    });
  }

  if (action === 'onboarding-dismiss') {
    await supabase.from('users')
      .update({ onboarding_dismissed_at: new Date().toISOString() })
      .eq('id', decoded.userId);
    return res.status(200).json({ ok: true });
  }

  // 사용량 호출 기록 (비용/모델 로깅)
  if (action === 'log') {
    const { feature, model, inputTokens, outputTokens } = req.body ?? {};
    if (!feature || !model) return res.status(400).json({ error: '잘못된 요청입니다.' });

    const inTok = Math.max(0, Number(inputTokens) || 0);
    const outTok = Math.max(0, Number(outputTokens) || 0);
    const cost = calcCostUsd(String(model), inTok, outTok);

    const { error } = await supabase.from('api_calls').insert({
      user_id: decoded.userId,
      feature: String(feature),
      model: String(model),
      input_tokens: inTok,
      output_tokens: outTok,
      cost_usd: cost,
    });

    if (error) return res.status(500).json({ error: '서버 오류' });
    return res.status(200).json({ ok: true });
  }

  // 기본: 일일 사용 한도 증가 및 잔여 횟수 반환
  // 관리자는 한도 제한 없음
  if (decoded.isAdmin) {
    return res.status(200).json({ remaining: 999 });
  }

  // 유료화 게이트 — billing_enforced가 켜지면 유효한 구독 없이는 기능 사용 불가
  // (JWT가 아닌 DB를 매번 확인해 해지·정지가 즉시 반영되게 한다)
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
    // past_due(재시도 중)까지는 이용 허용, paused/canceled/미구독은 차단
    if (!sub || !['trial', 'active', 'past_due'].includes(sub.status)) {
      return res.status(402).json({
        error: '구독 후 이용할 수 있습니다. [구독 관리] 탭에서 구독을 시작해주세요.',
        subscriptionRequired: true,
      });
    }
  }

  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase.rpc('increment_usage', {
    p_user_id: decoded.userId,
    p_date: today,
    p_limit: DAILY_LIMIT,
  });

  if (error) return res.status(500).json({ error: '서버 오류가 발생했습니다.' });

  if (data?.exceeded) {
    return res.status(429).json({
      error: `하루 ${DAILY_LIMIT}회 호출 한도를 초과했습니다. 내일 다시 이용해주세요.`,
    });
  }

  return res.status(200).json({ remaining: data.remaining });
}
