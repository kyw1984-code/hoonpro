import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { calcCostUsd } from '../../src/lib/pricing.js';
import { checkAccess } from '../../src/lib/accessGate.js';

/**
 * 카테고리 검색필터(속성) 자동 입력.
 *
 * 쿠팡은 카테고리마다 검색필터 항목이 다르다 — 의류는 핏·소매길이·넥라인·패턴·
 * 시즌, 텀블러는 용량·재질·뚜껑형태 식이다. 항목 이름은 카테고리 메타 API가
 * 주므로, 그 목록과 제품 사진을 비전 모델에 넘겨 "사진으로 확인되는 것만"
 * 채운다. 확인 안 되는 항목은 비워 두고 판매자가 고르게 한다.
 */

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini';

function extractJson(text: string): any {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  try { return JSON.parse(clean); } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('응답을 읽지 못했습니다.');
    return JSON.parse(m[0]);
  }
}

export async function handleListingAttrs(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: '인증이 필요합니다.' });
  let decoded: any;
  try { decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET!); } catch { return res.status(401).json({ error: '유효하지 않은 토큰입니다.' }); }
  const denied = await checkAccess(supabase, decoded.userId, decoded.isAdmin === true);
  if (denied) return res.status(denied.status).json(denied.body);

  const images: string[] = Array.isArray(req.body?.images) ? req.body.images.map(String).filter(Boolean).slice(0, 3) : [];
  const attrs: Array<{ name: string; dataType?: string; basicUnit?: string }> = Array.isArray(req.body?.attributes)
    ? req.body.attributes.filter((a: any) => a && typeof a.name === 'string').slice(0, 40)
    : [];
  const productName = String(req.body?.productName ?? '').slice(0, 120);
  const hint = String(req.body?.hint ?? '').slice(0, 500);
  if (images.length === 0) return res.status(400).json({ error: '제품 사진이 필요합니다.' });
  if (attrs.length === 0) return res.status(200).json({ values: {}, filled: 0 });

  const apiKey = process.env.OPENAIAPIKEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAIAPIKEY가 설정되지 않았습니다.' });

  const month = new Date(Date.now() + 9 * 3600_000).getUTCMonth() + 1;
  const list = attrs.map(a => `- ${a.name}${a.basicUnit ? ` (단위: ${a.basicUnit})` : ''}${a.dataType ? ` [${a.dataType}]` : ''}`).join('\n');
  const instruction = `
당신은 쿠팡 상품 등록 담당자입니다. 첨부한 제품 사진을 보고 아래 검색필터 항목의 값을 채워 JSON만 돌려주세요.

상품명: ${productName || '(미입력)'}
${hint ? `참고 정보: ${hint}\n` : ''}지금은 ${month}월입니다.

[검색필터 항목 — 쿠팡이 이 카테고리에 정한 이름 그대로]
${list}

[규칙]
- 출력: {"values": {"항목명": "값", ...}} — 항목명은 위 목록의 이름을 글자 그대로 쓴다.
- 사진이나 상품명·참고 정보로 확인되는 항목만 채운다. 확인 안 되면 그 항목은 아예 넣지 않는다 (추측 금지).
- 값은 쿠팡 검색필터에서 소비자가 고르는 흔한 표기로 짧게: 핏 → 오버핏/레귤러핏/슬림핏, 소매기장 → 긴소매/반소매, 넥라인 → 라운드넥/브이넥, 패턴 → 무지/스트라이프/프린팅, 시즌 → 봄/여름/가을/겨울/사계절, 소재 → 면/폴리에스터/니트 등.
- 단위가 있는 항목은 숫자만 (예: 용량 500, 길이 70). 단위는 적지 않는다.
- 색상 항목은 사진에 한 가지 색만 보일 때만 채운다.
`.trim();

  const content: any[] = [{ type: 'text', text: instruction }];
  images.forEach(img => content.push({ type: 'image_url', image_url: { url: img, detail: 'low' } }));

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_VISION_MODEL,
        messages: [{ role: 'system', content: 'Return valid JSON only.' }, { role: 'user', content }],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
    const data: any = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || '이미지 분석 실패' });
    const parsed = extractJson(data?.choices?.[0]?.message?.content || '');
    const inputTokens = Math.max(0, Number(data?.usage?.prompt_tokens) || 0);
    const outputTokens = Math.max(0, Number(data?.usage?.completion_tokens) || 0);
    try {
      await supabase.from('api_calls').insert({
        user_id: decoded.userId, feature: 'listing-attributes', model: OPENAI_VISION_MODEL,
        input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: calcCostUsd(OPENAI_VISION_MODEL, inputTokens, outputTokens),
      });
    } catch { /* 기록 실패는 삼킨다 */ }

    // 쿠팡이 정한 항목 이름에 있는 것만, 값은 60자까지
    const allowed = new Set(attrs.map(a => a.name));
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed?.values ?? {})) {
      const key = String(k).trim();
      const val = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (allowed.has(key) && val && !/^(없음|모름|해당없음|확인불가|-)$/.test(val)) values[key] = val;
    }
    return res.status(200).json({ values, filled: Object.keys(values).length, total: attrs.length });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || '검색필터 분석 중 오류가 났습니다.' });
  }
}
