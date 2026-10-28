import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { calcCostUsd } from '../../src/lib/pricing.js';
import { checkAccess } from '../../src/lib/accessGate.js';

/**
 * 상세페이지 자동 제작(의류 템플릿)의 기획·문안.
 *
 * 이미지 생성 모델은 쓰지 않는다. 판매자가 올린 사진을 재료로 쓰고, 여기서는
 * 텍스트(+사진 2장 저해상)로 헤드라인·포인트 3개·디테일 캡션·사이즈표·소재·
 * 세탁 문구만 짠다. 그리는 것은 브라우저 캔버스(src/lib/detailTemplate.ts)다.
 * 한 상세페이지에 드는 API 비용이 10원 안팎이 되는 이유다.
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
const str = (v: any, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v: any, n: number, max: number) => (Array.isArray(v) ? v : []).map((x: any) => str(x, max)).filter(Boolean).slice(0, n);

export async function handleDetailPlan(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: '인증이 필요합니다.' });
  let decoded: any;
  try { decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET!); } catch { return res.status(401).json({ error: '유효하지 않은 토큰입니다.' }); }
  const denied = await checkAccess(supabase, decoded.userId, decoded.isAdmin === true);
  if (denied) return res.status(denied.status).json(denied.body);

  const images: string[] = Array.isArray(req.body?.images) ? req.body.images.map(String).filter(Boolean).slice(0, 3) : [];
  const productName = str(req.body?.productName, 120);
  const brand = str(req.body?.brand, 50);
  const filters = (req.body?.filters && typeof req.body.filters === 'object') ? req.body.filters as Record<string, string> : {};
  const colors = list(req.body?.colors, 10, 20);
  const sizes = list(req.body?.sizes, 8, 10);
  const material = str(req.body?.material, 80);
  const imageCount = Math.max(1, Math.min(10, Number(req.body?.imageCount) || images.length || 1));
  if (!productName) return res.status(400).json({ error: '상품명이 필요합니다.' });

  const apiKey = process.env.OPENAIAPIKEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAIAPIKEY가 설정되지 않았습니다.' });

  const filterLines = Object.entries(filters).filter(([, v]) => String(v ?? '').trim()).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  const instruction = `
당신은 쿠팡 의류 상세페이지를 만드는 디자이너 겸 카피라이터입니다. 아래 정보와 제품 사진으로 상세페이지 문안을 JSON으로만 돌려주세요.

상품명: ${productName}
브랜드: ${brand || '(없음)'}
${filterLines ? `확인된 속성:\n${filterLines}` : ''}
색상 옵션: ${colors.join(', ') || '(없음)'}
사이즈 옵션: ${sizes.join(', ') || '(없음)'}
소재: ${material || '(미확인)'}
올린 사진 수: ${imageCount}장 (0번이 대표)

{
  "headline": "인트로 헤드라인 (12자 이내, 1줄)",
  "subline": "인트로 보조 문구 (22자 이내)",
  "target": "이런 분께 (18자 이내)",
  "points": [ { "title": "포인트 제목 (10자 이내)", "desc": "설명 (36자 이내, 구어체 존댓말)", "imageIndex": 0 }, {...}, {...} ],
  "detailCaptions": ["디테일 컷 캡션 (12자 이내)", "..."],
  "fit": "핏·착용감 한 줄 (30자 이내)",
  "sizeTable": { "columns": ["총장", "가슴단면", "어깨너비", "소매길이"], "rows": [ { "size": "M", "values": [68, 55, 50, 61] } ], "note": "단면 기준, 측정 방법에 따라 1~3cm 오차" },
  "material": "소재 표기 (예: 아크릴 70% 면 30%)",
  "care": ["세탁·취급 주의 3~4개, 각 18자 이내"],
  "season": "추천 계절 (예: 가을·겨울)",
  "shots": ["4 English photo directions, one per line: 0 hero full-body model shot, 1 model shot for point 1, 2 close-up detail for point 2, 3 back or side view for point 3"]
}

[규칙]
- 문구는 실제 쿠팡 상위 상세페이지처럼 짧고 구체적인 구어체 존댓말. 과장(최고·1위·완벽)과 특수문자 금지.
- points는 정확히 3개. imageIndex는 0~${imageCount - 1} 중 그 포인트를 가장 잘 보여줄 사진 번호(서로 다르게, 0번 제외 우선).
- detailCaptions는 ${Math.max(0, Math.min(4, imageCount - 1))}개 — 1번부터 순서대로 사진마다 하나.
- shots: 정확히 4개, 영어 한 문장씩(장소·분위기·포즈·카메라 거리). 0번은 가을/겨울 등 계절에 맞는 실내외 배경의 전신 모델컷, 1번은 포인트 1을 보여주는 다른 포즈, 2번은 포인트 2를 보여주는 근접 디테일(소재·마감), 3번은 뒷면 또는 측면 전신. 모두 같은 모델·같은 장소 계열로.
- sizeTable: 사이즈 옵션이 있으면 그 사이즈대로 행을 만든다. 실측값을 모르므로 이 제품 유형의 한국 표준 치수(cm)를 넣고 note에 "표준 치수 — 실측값으로 수정하세요"를 포함한다. 열은 제품 유형에 맞게(상의: 총장·가슴단면·어깨너비·소매길이 / 하의: 총장·허리단면·밑위·허벅지단면·밑단단면). 사이즈 옵션이 없으면 FREE 한 줄.
- material이 미확인이면 사진으로 추정하지 말고 "상세페이지 참조"로 둔다.
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
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
    });
    const data: any = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || '상세페이지 기획 실패' });
    const p = extractJson(data?.choices?.[0]?.message?.content || '');
    const inputTokens = Math.max(0, Number(data?.usage?.prompt_tokens) || 0);
    const outputTokens = Math.max(0, Number(data?.usage?.completion_tokens) || 0);
    try {
      await supabase.from('api_calls').insert({
        user_id: decoded.userId, feature: 'listing-detail-plan', model: OPENAI_VISION_MODEL,
        input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: calcCostUsd(OPENAI_VISION_MODEL, inputTokens, outputTokens),
      });
    } catch { /* 기록 실패는 삼킨다 */ }

    const points = (Array.isArray(p?.points) ? p.points : []).slice(0, 3).map((pt: any, i: number) => ({
      title: str(pt?.title, 14) || `포인트 ${i + 1}`,
      desc: str(pt?.desc, 48),
      imageIndex: Math.max(0, Math.min(imageCount - 1, Number(pt?.imageIndex) || 0)),
    }));
    while (points.length < 3) points.push({ title: `포인트 ${points.length + 1}`, desc: '', imageIndex: 0 });
    const cols = list(p?.sizeTable?.columns, 6, 10);
    const rows = (Array.isArray(p?.sizeTable?.rows) ? p.sizeTable.rows : []).slice(0, 8).map((row: any) => ({
      size: str(row?.size, 10) || 'FREE',
      values: (Array.isArray(row?.values) ? row.values : []).slice(0, cols.length).map((v: any) => str(v, 8)),
    }));
    return res.status(200).json({
      headline: str(p?.headline, 16) || productName.slice(0, 16),
      subline: str(p?.subline, 28),
      target: str(p?.target, 22),
      points,
      detailCaptions: list(p?.detailCaptions, 4, 16),
      fit: str(p?.fit, 36),
      sizeTable: { columns: cols.length ? cols : ['총장', '가슴단면', '어깨너비', '소매길이'], rows, note: str(p?.sizeTable?.note, 60) || '단면 기준, 측정 방법에 따라 1~3cm 오차가 있을 수 있습니다' },
      material: str(p?.material, 60) || material || '상세페이지 참조',
      care: list(p?.care, 4, 22),
      season: str(p?.season, 12),
      shots: list(p?.shots, 4, 240),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || '상세페이지 기획 중 오류가 났습니다.' });
  }
}
