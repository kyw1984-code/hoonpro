import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DEFAULT_IMAGE_SETTINGS = {
  provider: 'gemini',
  model: 'gemini-2.5-flash-image',
};

const IMAGE_MODEL_PROVIDER: Record<string, 'gemini' | 'openai'> = {
  'gemini-2.5-flash-image': 'gemini',
  'gpt-image-2': 'openai',
};

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

function normalizeImageSettings(value: any) {
  const model = String(value?.model || DEFAULT_IMAGE_SETTINGS.model);
  const provider = IMAGE_MODEL_PROVIDER[model];
  if (!provider) return DEFAULT_IMAGE_SETTINGS;
  return { provider, model };
}

async function fetchImageSettings() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'image_generation')
    .maybeSingle();

  if (error) throw error;
  return normalizeImageSettings(data?.value);
}

async function handleImageSettings(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    try {
      const settings = await fetchImageSettings();
      return res.status(200).json({ settings });
    } catch (error: any) {
      if (String(error?.message || '').includes('app_settings')) {
        return res.status(200).json({
          settings: DEFAULT_IMAGE_SETTINGS,
          warning: 'app_settings 테이블이 없어 기본값을 사용 중입니다. supabase-schema.sql을 적용하면 저장할 수 있습니다.',
        });
      }
      return res.status(500).json({ error: '설정을 불러오지 못했습니다.' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const settings = normalizeImageSettings(req.body?.settings ?? req.body);
  try {
    const { error } = await supabase
      .from('app_settings')
      .upsert({
        key: 'image_generation',
        value: settings,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

    if (error) throw error;
    return res.status(200).json({ settings, message: '이미지 생성 모델 설정을 저장했습니다.' });
  } catch (error: any) {
    if (String(error?.message || '').includes('app_settings')) {
      return res.status(500).json({ error: 'app_settings 테이블이 없습니다. supabase-schema.sql을 먼저 적용해주세요.' });
    }
    return res.status(500).json({ error: '설정을 저장하지 못했습니다.' });
  }
}

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!verifyAdmin(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });

  if (String(req.query.mode || '') === 'image-settings') {
    return handleImageSettings(req, res);
  }

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

  // 전체 합계
  const totals = rows.reduce(
    (acc, r) => ({
      calls: acc.calls + 1,
      inputTokens: acc.inputTokens + (r.input_tokens || 0),
      outputTokens: acc.outputTokens + (r.output_tokens || 0),
      costUsd: acc.costUsd + Number(r.cost_usd || 0),
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );

  // 그룹 집계 헬퍼
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
