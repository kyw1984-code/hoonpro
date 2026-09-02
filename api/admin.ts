import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

// 관리자 통합 엔드포인트 — Vercel 함수 개수 제한 대응으로 4개 함수를 action으로 통합
//   action=users        (GET)      회원 목록 + 오늘 사용량
//   action=user-action  (POST)     승인/거절/일괄승인/사용량 리셋 (세부 동작은 body.action)
//   action=stats        (GET)      API 사용량 통계 (period=today|7d|30d|all)
//   action=config       (GET/POST) 이미지 모델/품질 설정

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const isAdmin = verifyAdmin(req);
  const action = String(req.query.action || '');

  try {
    // config 조회는 탭 순서(tab_order)를 모든 사용자 화면에서 쓰므로 비관리자에게도 그 값만 공개
    if (action === 'config') return await handleConfig(req, res, isAdmin);

    if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    if (action === 'users') return await handleUsers(req, res);
    if (action === 'user-action') return await handleUserAction(req, res);
    if (action === 'stats') return await handleStats(req, res);
    return res.status(400).json({ error: '알 수 없는 action입니다.' });
  } catch (e) {
    console.error('[admin]', action, e);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
}

// ── 회원 목록 ─────────────────────────────────────────────

async function handleUsers(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

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

// ── 회원 관리 액션 (승인/거절/일괄승인/리셋) ───────────────

async function handleUserAction(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, action } = req.body ?? {};

  if (action === 'approve' || action === 'reject') {
    if (!userId) return res.status(400).json({ error: '잘못된 요청입니다.' });
    const status = action === 'approve' ? 'approved' : 'rejected';
    const { error } = await supabase.from('users').update({ status }).eq('id', userId);
    if (error) return res.status(500).json({ error: '서버 오류' });
    return res.status(200).json({ message: action === 'approve' ? '승인됐습니다.' : '거절됐습니다.' });
  }

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

// ── 사용량 통계 ───────────────────────────────────────────

interface CallRow {
  user_id: string;
  feature: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}

function startOfPeriod(period: string): string | null {
  const now = new Date();
  if (period === 'today') {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (period === '7d') {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - 6);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (period === '30d') {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - 29);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
  return null;
}

async function handleStats(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const period = String(req.query.period ?? '30d');
  const since = startOfPeriod(period);

  let query = supabase
    .from('api_calls')
    .select('user_id, feature, model, input_tokens, output_tokens, cost_usd, created_at');
  if (since) query = query.gte('created_at', since);

  const { data: calls, error } = await query;
  if (error) return res.status(500).json({ error: '서버 오류' });

  const rows: CallRow[] = (calls ?? []) as any;

  // 사용자 이름 매핑
  const userIds = Array.from(new Set(rows.map(r => r.user_id).filter(Boolean)));
  const userMap: Record<string, { name: string; email: string }> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, name, email')
      .in('id', userIds);
    for (const u of users ?? []) {
      userMap[(u as any).id] = { name: (u as any).name, email: (u as any).email };
    }
  }

  const totals = rows.reduce(
    (acc, r) => ({
      calls: acc.calls + 1,
      inputTokens: acc.inputTokens + (r.input_tokens || 0),
      outputTokens: acc.outputTokens + (r.output_tokens || 0),
      costUsd: acc.costUsd + Number(r.cost_usd || 0),
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );

  type Agg = { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  const groupBy = <K extends string>(keyFn: (r: CallRow) => K) => {
    const map: Record<string, Agg> = {};
    for (const r of rows) {
      const k = keyFn(r);
      if (!map[k]) map[k] = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      map[k].calls += 1;
      map[k].inputTokens += r.input_tokens || 0;
      map[k].outputTokens += r.output_tokens || 0;
      map[k].costUsd += Number(r.cost_usd || 0);
    }
    return map;
  };

  const byUser = groupBy(r => r.user_id || 'unknown');
  const byFeature = groupBy(r => r.feature);
  const byModel = groupBy(r => r.model);

  const userBreakdown = Object.entries(byUser).map(([userId, agg]) => ({
    userId,
    name: userMap[userId]?.name ?? '(알 수 없음)',
    email: userMap[userId]?.email ?? '',
    ...agg,
  })).sort((a, b) => b.costUsd - a.costUsd);

  const featureBreakdown = Object.entries(byFeature).map(([feature, agg]) => ({
    feature,
    ...agg,
  })).sort((a, b) => b.calls - a.calls);

  const modelBreakdown = Object.entries(byModel).map(([model, agg]) => ({
    model,
    ...agg,
  })).sort((a, b) => b.costUsd - a.costUsd);

  // 일자별 시계열 (UTC 기준 YYYY-MM-DD)
  const byDay: Record<string, Agg> = {};
  for (const r of rows) {
    const d = new Date(r.created_at).toISOString().slice(0, 10);
    if (!byDay[d]) byDay[d] = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    byDay[d].calls += 1;
    byDay[d].inputTokens += r.input_tokens || 0;
    byDay[d].outputTokens += r.output_tokens || 0;
    byDay[d].costUsd += Number(r.cost_usd || 0);
  }
  const timeline = Object.entries(byDay)
    .map(([date, agg]) => ({ date, ...agg }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return res.status(200).json({
    period,
    totals,
    userBreakdown,
    featureBreakdown,
    modelBreakdown,
    timeline,
  });
}

// ── 이미지 모델/품질 설정 ─────────────────────────────────

const ALLOWED_MODELS = [
  'gpt-image-2',
  'gpt-image-2-2026-04-21',
  'gpt-image-1.5',
  'gpt-image-1-mini',
  'gpt-image-1',
  'chatgpt-image-latest',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
  'gemini-2.5-flash-image-preview',
];
const ALLOWED_QUALITY = ['low', 'medium', 'high'];
const DEFAULTS = { imageModel: 'gpt-image-2', imageQuality: 'high', aiIntegratedTextEnabled: false };
// 탭 순서 설정에 허용되는 탭 id (App.tsx TABS와 일치해야 함)
const TAB_IDS = ['home', 'thumbnail', 'detail', 'sourcing', 'ranktracker', 'review', 'analyzer', 'qa', 'works'];

// app_config 테이블 미존재 오류 판별
function isMissingTable(error: any): boolean {
  return error?.code === '42P01' || /app_config/.test(error?.message || '');
}

async function handleConfig(req: VercelRequest, res: VercelResponse, isAdmin: boolean) {
  // 현재 설정 조회 — 탭 순서(tab_order)는 민감 정보가 아니고 모든 사용자 화면에
  // 필요하므로 비관리자에게도 그 값만 공개한다. 나머지는 관리자 전용.
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['image_model', 'image_quality', 'ai_integrated_text_enabled', 'tab_order']);

    if (error) {
      if (isMissingTable(error)) {
        return res.status(200).json(isAdmin ? { ...DEFAULTS, tabOrder: null, migrated: false } : { tabOrder: null });
      }
      return res.status(500).json({ error: '서버 오류' });
    }

    const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    let tabOrder: string[] | null = null;
    try {
      const parsed = JSON.parse(map.tab_order || 'null');
      if (Array.isArray(parsed)) tabOrder = parsed.filter((t) => TAB_IDS.includes(t));
    } catch { /* 잘못 저장된 값은 기본 순서로 */ }

    if (!isAdmin) return res.status(200).json({ tabOrder });

    return res.status(200).json({
      imageModel: ALLOWED_MODELS.includes(map.image_model) ? map.image_model : DEFAULTS.imageModel,
      imageQuality: ALLOWED_QUALITY.includes(map.image_quality) ? map.image_quality : DEFAULTS.imageQuality,
      aiIntegratedTextEnabled: map.ai_integrated_text_enabled === 'true',
      tabOrder,
      migrated: true,
    });
  }

  if (!isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });

  // 설정 변경 — 이미지 설정과 탭 순서를 각각 부분 저장할 수 있다
  if (req.method === 'POST') {
    const { imageModel, imageQuality, aiIntegratedTextEnabled, tabOrder } = req.body ?? {};
    const now = new Date().toISOString();
    const rows: { key: string; value: string; updated_at: string }[] = [];

    if (imageModel !== undefined || imageQuality !== undefined) {
      if (!ALLOWED_MODELS.includes(imageModel) || !ALLOWED_QUALITY.includes(imageQuality)) {
        return res.status(400).json({ error: '허용되지 않은 모델 또는 품질입니다.' });
      }
      rows.push(
        { key: 'image_model', value: imageModel, updated_at: now },
        { key: 'image_quality', value: imageQuality, updated_at: now },
        { key: 'ai_integrated_text_enabled', value: aiIntegratedTextEnabled === true ? 'true' : 'false', updated_at: now },
      );
    }

    if (tabOrder !== undefined) {
      if (
        !Array.isArray(tabOrder) ||
        tabOrder.some((t) => !TAB_IDS.includes(t)) ||
        new Set(tabOrder).size !== tabOrder.length
      ) {
        return res.status(400).json({ error: '올바르지 않은 탭 순서입니다.' });
      }
      rows.push({ key: 'tab_order', value: JSON.stringify(tabOrder), updated_at: now });
    }

    if (rows.length === 0) return res.status(400).json({ error: '변경할 설정이 없습니다.' });

    const { error } = await supabase.from('app_config').upsert(rows, { onConflict: 'key' });

    if (error) {
      if (isMissingTable(error)) {
        return res.status(400).json({ error: 'app_config 테이블이 없습니다. supabase-schema.sql 마이그레이션을 먼저 실행하세요.' });
      }
      return res.status(500).json({ error: '서버 오류' });
    }

    return res.status(200).json({ message: '저장됐습니다.' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
