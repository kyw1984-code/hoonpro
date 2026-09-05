import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

// 관리자 통합 엔드포인트 — Vercel 함수 개수 제한 대응으로 4개 함수를 action으로 통합
//   action=users        (GET)      회원 목록 + 오늘 사용량
//   action=user-action  (POST)     승인/거절/일괄승인/사용량 리셋 (세부 동작은 body.action)
//   action=stats        (GET)      API 사용량 통계 (period=today|7d|30d|all)
//   action=config       (GET/POST) 이미지 모델/품질 설정
//   action=costs        (GET/POST) 원가 현황 / 고정비 저장
//   action=limits       (GET/POST) 기능별 일일 한도 조회·저장

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
    if (action === 'costs') return await handleCosts(req, res);
    if (action === 'limits') return await handleLimits(req, res);
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

// 사업자 정보 항목 (프론트 src/lib/company.ts CompanyInfo와 일치)
const COMPANY_KEYS = ['name', 'ceo', 'bizNumber', 'mailOrderNumber', 'address', 'email', 'phone', 'effectiveDate', 'dbRegion'];

function parseCompany(raw: string | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const k of COMPANY_KEYS) if (typeof parsed[k] === 'string') out[k] = parsed[k];
    return out;
  } catch {
    return {};
  }
}

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
      .in('key', ['image_model', 'image_quality', 'ai_integrated_text_enabled', 'tab_order', 'company_info']);

    if (error) {
      if (isMissingTable(error)) {
        return res.status(200).json(isAdmin ? { ...DEFAULTS, tabOrder: null, company: {}, migrated: false } : { tabOrder: null, company: {} });
      }
      return res.status(500).json({ error: '서버 오류' });
    }

    const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    let tabOrder: string[] | null = null;
    try {
      const parsed = JSON.parse(map.tab_order || 'null');
      if (Array.isArray(parsed)) tabOrder = parsed.filter((t) => TAB_IDS.includes(t));
    } catch { /* 잘못 저장된 값은 기본 순서로 */ }

    // 사업자 정보는 법적으로 공개 표기 의무가 있는 값이라 비관리자(푸터·약관 페이지)에도 공개
    const company = parseCompany(map.company_info);

    if (!isAdmin) return res.status(200).json({ tabOrder, company });

    return res.status(200).json({
      company,
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
    const { imageModel, imageQuality, aiIntegratedTextEnabled, tabOrder, company } = req.body ?? {};
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

    if (company !== undefined) {
      if (!company || typeof company !== 'object' || Array.isArray(company)) {
        return res.status(400).json({ error: '올바르지 않은 사업자 정보입니다.' });
      }
      const { data: prev } = await supabase.from('app_config').select('value').eq('key', 'company_info').maybeSingle();
      const merged = parseCompany(prev?.value);
      for (const k of COMPANY_KEYS) {
        if (company[k] === undefined) continue;
        if (typeof company[k] !== 'string' || company[k].length > 200) {
          return res.status(400).json({ error: `사업자 정보 항목(${k})이 올바르지 않습니다.` });
        }
        merged[k] = company[k].trim();
      }
      rows.push({ key: 'company_info', value: JSON.stringify(merged), updated_at: now });
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


// ─── 원가 현황 ────────────────────────────────────────────────
// api_calls에 쌓인 외부 유료 호출을 기간별로 집계한다.
// 변동비(AI·크롤링·메일)는 실측, 고정비는 관리자가 입력한 값을 쓴다.
async function handleCosts(req: VercelRequest, res: VercelResponse) {
  // 고정비 저장 (서버·API 구독료처럼 사용량과 무관한 비용)
  if (req.method === 'POST') {
    const items = Array.isArray(req.body?.fixedCosts) ? req.body.fixedCosts : null;
    if (!items) return res.status(400).json({ error: '고정비 목록이 필요합니다.' });
    const cleaned = items.slice(0, 30).map((it: any) => ({
      label: String(it?.label ?? '').slice(0, 60),
      monthlyKrw: Math.max(0, Math.round(Number(it?.monthlyKrw) || 0)),
    })).filter((it: any) => it.label);
    const { error } = await supabase.from('app_config').upsert({
      key: 'fixed_costs', value: JSON.stringify(cleaned), updated_at: new Date().toISOString(),
    });
    if (error) return res.status(500).json({ error: '저장에 실패했습니다.' });
    return res.status(200).json({ ok: true, fixedCosts: cleaned });
  }

  const usdKrw = Math.max(1, Number(req.query.usdKrw) || Number(process.env.USD_KRW) || 1380);

  // KST 기준 경계
  const now = Date.now();
  const kstNow = new Date(now + 9 * 3600_000);
  const dayStart = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 3600_000;
  const monthStart = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), 1) - 9 * 3600_000;
  const prevMonthStart = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() - 1, 1) - 9 * 3600_000;

  const [{ data: rows }, { data: cfg }, { count: subCount }] = await Promise.all([
    supabase
      .from('api_calls')
      .select('feature, model, cost_usd, created_at, user_id')
      .gte('created_at', new Date(prevMonthStart).toISOString()),
    supabase.from('app_config').select('value').eq('key', 'fixed_costs').maybeSingle(),
    supabase.from('subscriptions').select('id', { count: 'exact', head: true })
      .in('status', ['trial', 'active', 'past_due']),
  ]);

  const bucket = () => ({ usd: 0, calls: 0, byFeature: {} as Record<string, { usd: number; calls: number }> });
  const today = bucket(), month = bucket(), prevMonth = bucket();
  const byModel: Record<string, { usd: number; calls: number }> = {};
  const byUser: Record<string, number> = {};

  for (const r of rows ?? []) {
    const t = new Date(r.created_at).getTime();
    const usd = Number(r.cost_usd || 0);
    const feature = r.feature || '(미분류)';

    const add = (b: ReturnType<typeof bucket>) => {
      b.usd += usd; b.calls += 1;
      const f = b.byFeature[feature] ?? { usd: 0, calls: 0 };
      f.usd += usd; f.calls += 1; b.byFeature[feature] = f;
    };

    if (t >= prevMonthStart && t < monthStart) { add(prevMonth); continue; }
    if (t >= monthStart) {
      add(month);
      if (t >= dayStart) add(today);
      const m = byModel[r.model || '(미상)'] ?? { usd: 0, calls: 0 };
      m.usd += usd; m.calls += 1; byModel[r.model || '(미상)'] = m;
      if (r.user_id) byUser[r.user_id] = (byUser[r.user_id] || 0) + usd;
    }
  }

  // 이번 달 원가 상위 사용자 — 한도를 정하려면 헤비유저의 실제 원가를 봐야 한다
  const topIds = Object.entries(byUser).sort((a, b) => b[1] - a[1]).slice(0, 10);
  let topUsers: any[] = [];
  if (topIds.length > 0) {
    const { data: users } = await supabase
      .from('users').select('id, name, email').in('id', topIds.map(([id]) => id));
    const nameMap = new Map((users ?? []).map(u => [u.id, u]));
    topUsers = topIds.map(([id, usd]) => ({
      id,
      name: nameMap.get(id)?.name ?? '(삭제된 회원)',
      email: nameMap.get(id)?.email ?? '',
      usd,
      krw: Math.round(usd * usdKrw),
    }));
  }

  let fixedCosts: { label: string; monthlyKrw: number }[] = [];
  try { fixedCosts = JSON.parse(cfg?.value || '[]'); } catch { fixedCosts = []; }
  const fixedTotalKrw = fixedCosts.reduce((sum, f) => sum + (Number(f.monthlyKrw) || 0), 0);

  const subscribers = subCount ?? 0;
  const monthVariableKrw = Math.round(month.usd * usdKrw);

  const shape = (b: ReturnType<typeof bucket>) => ({
    usd: b.usd,
    krw: Math.round(b.usd * usdKrw),
    calls: b.calls,
    byFeature: Object.entries(b.byFeature)
      .map(([feature, v]) => ({ feature, usd: v.usd, krw: Math.round(v.usd * usdKrw), calls: v.calls }))
      .sort((a, b2) => b2.usd - a.usd),
  });

  return res.status(200).json({
    usdKrw,
    today: shape(today),
    month: shape(month),
    prevMonth: shape(prevMonth),
    byModel: Object.entries(byModel)
      .map(([model, v]) => ({ model, usd: v.usd, krw: Math.round(v.usd * usdKrw), calls: v.calls }))
      .sort((a, b2) => b2.usd - a.usd),
    topUsers,
    fixedCosts,
    fixedTotalKrw,
    subscribers,
    // 구독자 1명당 이번 달 변동비 — 39,800원과 비교할 기준선
    perSubscriberKrw: subscribers > 0 ? Math.round(monthVariableKrw / subscribers) : 0,
    totalMonthKrw: monthVariableKrw + fixedTotalKrw,
  });
}

// ── 기능별 일일 한도 ──────────────────────────────────────
// 한도 값 자체는 app_config.feature_limits에 저장하고, api/usage.ts와
// api/sourcing.ts가 60초 캐시로 읽어 간다. (키는 세 곳이 동일해야 한다)
//
// 이 화면의 목적은 "한도 × 실측 단가 = 최악의 경우 월 원가"를 요금(39,800원)과
// 나란히 보여주는 것이다. 단가는 추정이 아니라 api_calls 30일치 실측으로 뽑는다.

const PRICE_KRW = 39800;

const LIMIT_META: {
  key: string; label: string; hint: string; fallbackKrw: number; calls: string[];
}[] = [
  { key: 'image', label: '이미지 생성', hint: '썸네일·상세페이지 이미지 1장', fallbackKrw: 7,
    calls: ['thumbnail-image', 'detail-image'] },
  { key: 'qa', label: '훈프로 코칭AI', hint: '질문 1건', fallbackKrw: 5,
    calls: ['qa-ask'] },
  { key: 'sourcing', label: '소싱AI 상품 수집', hint: '키워드 수집 1회', fallbackKrw: 3,
    calls: ['sourcing-products', 'sourcing-cron'] },
  { key: 'reviews', label: '리뷰 수집·요약', hint: '상품 1개', fallbackKrw: 12,
    calls: ['sourcing-reviews', 'sourcing-review-summary'] },
  { key: 'rank', label: '순위 확인', hint: '조회 1회', fallbackKrw: 3,
    calls: ['rank-check'] },
  { key: 'analyze', label: '경쟁상품 분석', hint: '분석 1회', fallbackKrw: 3,
    calls: ['competitor-analyze', 'competitor-estimate'] },
  { key: 'inquiry', label: '고객문의 답변 초안', hint: '문의 1건', fallbackKrw: 2,
    calls: ['coupang-inquiry-draft'] },
  // 나머지 호출(기획·문구 생성, 이미지 검수 등)은 전부 여기로 모인다
  { key: 'general', label: '기타 AI 작업', hint: '기획·문구·이미지 검수 등', fallbackKrw: 1, calls: [] },
];

const LIMIT_DEFAULTS: Record<string, number> = {
  image: 40, qa: 100, sourcing: 60, reviews: 20, rank: 40, analyze: 40, inquiry: 60, general: 200,
};

/** api_calls.feature → 한도 키 (매핑이 없으면 general) */
function limitKeyOfCall(feature: string): string {
  for (const m of LIMIT_META) {
    if (m.calls.includes(feature)) return m.key;
  }
  return 'general';
}

async function handleLimits(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    const input = req.body?.limits;
    if (!input || typeof input !== 'object') {
      return res.status(400).json({ error: '한도 값이 필요합니다.' });
    }
    const saved: Record<string, number> = {};
    for (const m of LIMIT_META) {
      const raw = (input as any)[m.key];
      const n = Number(raw);
      // 0 = 무제한. 값이 없으면 기본값을 그대로 저장해 화면과 DB가 어긋나지 않게 한다.
      saved[m.key] = Number.isFinite(n) ? Math.min(100000, Math.max(0, Math.round(n))) : LIMIT_DEFAULTS[m.key];
    }
    const { error } = await supabase.from('app_config').upsert({
      key: 'feature_limits', value: JSON.stringify(saved), updated_at: new Date().toISOString(),
    });
    if (error) return res.status(500).json({ error: '저장에 실패했습니다.' });
    return res.status(200).json({ ok: true, limits: saved });
  }

  const usdKrw = Math.max(1, Number(req.query.usdKrw) || Number(process.env.USD_KRW) || 1380);
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const sinceDate = new Date(Date.now() - 30 * 86400_000 + 9 * 3600_000).toISOString().slice(0, 10);

  const [{ data: cfg }, { data: calls }, { data: usage }] = await Promise.all([
    supabase.from('app_config').select('value').eq('key', 'feature_limits').maybeSingle(),
    supabase.from('api_calls').select('feature, cost_usd').gte('created_at', since),
    supabase.from('feature_usage').select('feature, call_count').gte('date', sinceDate),
  ]);

  let stored: Record<string, any> = {};
  try { stored = JSON.parse(cfg?.value || '{}'); } catch { stored = {}; }

  // 실측 단가 = (해당 기능이 30일간 쓴 비용) ÷ (같은 기간 소모한 한도 횟수)
  const costUsd: Record<string, number> = {};
  for (const c of calls ?? []) {
    const k = limitKeyOfCall(c.feature || '');
    costUsd[k] = (costUsd[k] || 0) + Number(c.cost_usd || 0);
  }
  const units: Record<string, number> = {};
  for (const u of usage ?? []) {
    units[u.feature] = (units[u.feature] || 0) + (Number(u.call_count) || 0);
  }

  const features = LIMIT_META.map((m) => {
    const limit = Number.isFinite(Number(stored[m.key]))
      ? Math.max(0, Math.round(Number(stored[m.key])))
      : LIMIT_DEFAULTS[m.key];
    const unit = units[m.key] || 0;
    const krw30d = (costUsd[m.key] || 0) * usdKrw;
    // 표본이 너무 적으면 실측을 믿지 않고 초기 추정치를 쓴다
    const measured = unit >= 20;
    const unitKrw = measured ? krw30d / unit : m.fallbackKrw;
    return {
      key: m.key,
      label: m.label,
      hint: m.hint,
      limit,
      defaultLimit: LIMIT_DEFAULTS[m.key],
      unitKrw: Math.round(unitKrw * 10) / 10,
      measured,
      units30d: unit,
      cost30dKrw: Math.round(krw30d),
      // 한 사람이 한도를 매일 다 쓴다고 가정한 월 원가
      worstCaseKrw: Math.round(limit * 30 * unitKrw),
    };
  });

  const worstCaseTotalKrw = features.reduce((s, f) => s + f.worstCaseKrw, 0);

  return res.status(200).json({
    usdKrw,
    priceKrw: PRICE_KRW,
    resetLabel: '매일 0시 (KST)',
    features,
    worstCaseTotalKrw,
    worstCasePct: Math.round((worstCaseTotalKrw / PRICE_KRW) * 100),
  });
}
