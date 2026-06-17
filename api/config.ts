import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DEFAULTS = {
  aiIntegratedTextEnabled: false,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value')
      .eq('key', 'ai_integrated_text_enabled')
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({
      aiIntegratedTextEnabled: data?.value === 'true',
    });
  } catch {
    return res.status(200).json(DEFAULTS);
  }
}
