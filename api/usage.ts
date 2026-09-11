import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { DEFAULT_FEATURE_LIMITS, isDisabled, parseLimits } from '../src/lib/featureLimits.js';
import { calcCostUsd } from '../src/lib/pricing.js';
import { checkAccess } from '../src/lib/accessGate.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ─── 기능별 일일 한도 ─────────────────────────────────────────
// 값의 뜻과 기본값은 src/lib/featureLimits.ts 한 곳에 있다.
// 한도는 '최악의 사용자'가 적자를 만들지 않는 선이고, 평균 사용자는
// 그 15~20%만 쓰므로 실제 평균 원가는 요금의 10~15% 수준이 된다.

let limitCache: { at: number; value: Record<string, number> } | null = null;

async function loadLimits(): Promise<Record<string, number>> {
  if (limitCache && Date.now() - limitCache.at < 60_000) return limitCache.value;
  try {
    const { data } = await supabase
      .from('app_config').select('value').eq('key', 'feature_limits').maybeSingle();
    const merged = parseLimits(data?.value);
    limitCache = { at: Date.now(), value: merged };
    return merged;
  } catch {
    return DEFAULT_FEATURE_LIMITS;
  }
}

// 한도는 KST 자정에 초기화된다. UTC 날짜를 쓰면 오전 9시에 초기화돼
// 한국 사용자에게 어색하다.
function kstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 다음 초기화 시각 (KST 자정) — 화면에 안내한다 */
function nextResetIso(): string {
  const kst = new Date(Date.now() + 9 * 3600_000);
  const midnightKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1);
  return new Date(midnightKst - 9 * 3600_000).toISOString();
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
    const [favRes, watchRes, userRes, coupangRes] = await Promise.all([
      supabase.from('sourcing_favorites').select('keyword', { count: 'exact', head: true })
        .eq('user_id', decoded.userId),
      supabase.from('sourcing_rank_watch').select('product_id', { count: 'exact', head: true })
        .eq('user_id', decoded.userId),
      supabase.from('users').select('onboarding_dismissed_at').eq('id', decoded.userId).maybeSingle(),
      // 쿠팡 연동은 가장 가치가 큰 단계다. 키가 등록돼 있으면 완료다.
      supabase.from('coupang_accounts').select('user_id', { count: 'exact', head: true })
        .eq('user_id', decoded.userId),
    ]);

    const steps = {
      sourcing: (favRes.count ?? 0) > 0,
      rank: (watchRes.count ?? 0) > 0,
      coupang: (coupangRes.count ?? 0) > 0,
    };
    // 완료 판정에 썸네일이 들어 있었다. 그 기능을 내린 뒤로는 아무도 그
    // 조건을 채울 수 없어 온보딩 카드가 영원히 남았다. 쿠팡 연동으로
    // 바꾼다 — 실제로 할 수 있고, 하면 제품의 값이 가장 크게 달라진다.
    const done = steps.sourcing && steps.rank && steps.coupang;

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

  // ─── 내 사용량 (기능별 한도·잔여·초기화 시각) ───
  if (action === 'limits') {
    const limits = await loadLimits();
    const today = kstToday();

    const { data: rows } = await supabase
      .from('feature_usage')
      .select('feature, call_count')
      .eq('user_id', decoded.userId)
      .eq('date', today);

    const usedMap = new Map((rows ?? []).map(r => [r.feature, Number(r.call_count) || 0]));

    return res.status(200).json({
      resetAt: nextResetIso(),
      unlimited: Boolean(decoded.isAdmin),
      features: Object.entries(limits).map(([feature, limit]) => {
        const used = usedMap.get(feature) ?? 0;
        return {
          feature,
          limit,
          used,
          // 관리자와 무제한(음수)은 잔여를 -1로. 한도 0은 사용 중지라 잔여가 0이다
          remaining: decoded.isAdmin || limit < 0 ? -1 : Math.max(0, limit - used),
          disabled: !decoded.isAdmin && isDisabled(limit),
        };
      }),
    });
  }

  // 기본: 일일 사용 한도 증가 및 잔여 횟수 반환
  // 관리자는 한도 제한 없음
  if (decoded.isAdmin) {
    return res.status(200).json({ remaining: 999 });
  }

  // 접근 게이트 — 아직 우리 회원인가, 유료화가 켜졌다면 구독이 있는가.
  // 판정은 src/lib/accessGate.ts 한 곳에 있다. 예전에는 이 검사가 파일
  // 여섯 곳에 복사돼 있었고, 회원 상태는 아예 보지 않아 탈퇴·거절된
  // 사람이 토큰이 만료되는 7일까지 계속 쓸 수 있었다.
  const denied = await checkAccess(supabase, decoded.userId, decoded.isAdmin === true);
  if (denied) return res.status(denied.status).json(denied.body);

  const today = kstToday();
  const limits = await loadLimits();

  // 어떤 기능인지 프론트가 알려준다 (미지정이면 general)
  const rawFeature = String(req.query.feature || req.body?.feature || 'general');
  const feature = Object.prototype.hasOwnProperty.call(limits, rawFeature) ? rawFeature : 'general';
  const limit = limits[feature];

  const { data, error } = await supabase.rpc('increment_feature_usage', {
    p_user_id: decoded.userId,
    p_date: today,
    p_feature: feature,
    p_limit: limit,
  });

  if (error) return res.status(500).json({ error: '서버 오류가 발생했습니다.' });

  // 한도 0은 '오늘 다 썼다'가 아니라 '내린 기능'이다. 내일 다시 오라고 하면 거짓말이 된다
  if (isDisabled(limit)) {
    return res.status(403).json({ error: '이 기능은 현재 제공하지 않습니다.', disabled: true });
  }

  if (data?.exceeded) {
    return res.status(429).json({
      error: `이 기능은 하루 ${limit}회까지 이용할 수 있습니다. 내일 다시 이용해주세요.`,
    });
  }

  return res.status(200).json({ remaining: data.remaining });
}
