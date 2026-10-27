import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { calcCostUsd } from '../../src/lib/pricing.js';
import { checkAccess } from '../../src/lib/accessGate.js';

/**
 * 제품 사진으로 쿠팡 상위노출 기준의 상품명을 만든다.
 *
 * 쿠팡 검색은 상품명의 앞쪽 단어를 더 무겁게 보고, 브랜드·제품 유형·핵심 속성
 * (소재/용량/사이즈/색상/수량)·용도 순으로 적은 이름이 잘 걸린다. 특수문자,
 * 과장 문구, 같은 단어 반복은 노출에 불리하고 승인 반려 사유가 되기도 한다.
 * 사진을 보고 제품 유형과 눈에 보이는 속성을 뽑은 뒤 그 규칙대로 조립한다.
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

/** 쿠팡이 싫어하는 것들을 걷어낸다: 특수문자, 과장, 중복 공백, 100자 초과 */
function tidyName(value: string): string {
  return String(value || '')
    .replace(/[\[\]{}()<>【】★☆♥♡※!?*#@^~`'"“”‘’|\\\/]/g, ' ')
    .replace(/\b(최고|최저가|1위|베스트|핫딜|무료배송|당일배송|정품|인기|추천|특가|세일|할인|이벤트|단독|초특가|파격)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

export async function handleProductName(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: '인증이 필요합니다.' });
  let decoded: any;
  try { decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET!); } catch { return res.status(401).json({ error: '유효하지 않은 토큰입니다.' }); }
  const denied = await checkAccess(supabase, decoded.userId, decoded.isAdmin === true);
  if (denied) return res.status(denied.status).json(denied.body);

  const images: string[] = Array.isArray(req.body?.images) ? req.body.images.map(String).filter(Boolean).slice(0, 4) : [];
  if (images.length === 0) return res.status(400).json({ error: '제품 사진이 필요합니다.' });
  const brand = String(req.body?.brand ?? '').trim().slice(0, 50);
  const hint = String(req.body?.hint ?? '').trim().slice(0, 300);

  const apiKey = process.env.OPENAIAPIKEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAIAPIKEY가 설정되지 않았습니다.' });

  const instruction = `
당신은 쿠팡 검색 상위노출을 전문으로 하는 상품명 작성자입니다. 첨부한 제품 사진을 보고 아래 JSON만 돌려주세요.

{
  "productType": "제품 유형 (예: 스테인리스 텀블러)",
  "attributes": ["사진에서 확인되는 속성: 소재, 색상, 용량/사이즈, 수량, 형태, 기능 — 보이는 것만"],
  "useCases": ["주요 용도·사용 상황 2~3개"],
  "keywords": ["구매자가 검색창에 칠 법한 키워드 8~12개, 검색량 많을 순"],
  "name": "최종 상품명",
  "candidates": ["다른 조합의 상품명 2개"]
}

[상품명 규칙 — 쿠팡 상위노출·승인 기준]
- 순서: ${brand ? `브랜드(${brand}) → ` : ''}제품 유형 → 핵심 속성(소재·용량·사이즈·색상·수량) → 용도/대상. 검색이 가장 많이 되는 단어가 앞에 오게.
- 50~80자(공백 포함). 띄어쓰기로만 구분하고 특수문자·괄호·이모지·따옴표를 쓰지 않는다.
- 같은 단어 반복 금지. 동의어는 하나만(예: '텀블러 보온병 물병' 중 핵심 하나 + 보조 하나).
- 과장·홍보 문구 금지: 최고, 1위, 베스트, 정품, 무료배송, 추천, 특가, 할인, 이벤트.
- 사진으로 확인할 수 없는 사실(용량 숫자, 인증, 원산지)은 지어내지 않는다. 사용자가 적은 참고 정보에 있으면 쓴다.
- 색상·사이즈처럼 옵션으로 갈릴 속성은 옵션이 여럿이면 상품명에서 뺀다. 사진에 한 가지만 보이면 넣는다.
${hint ? `\n[사용자 참고 정보]\n${hint}` : ''}
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
        temperature: 0.3,
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
        user_id: decoded.userId, feature: 'listing-product-name', model: OPENAI_VISION_MODEL,
        input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: calcCostUsd(OPENAI_VISION_MODEL, inputTokens, outputTokens),
      });
    } catch { /* 기록 실패는 삼킨다 */ }

    const name = tidyName(parsed?.name);
    if (!name) return res.status(502).json({ error: '상품명을 만들지 못했습니다. 사진을 바꿔 다시 시도해주세요.' });
    return res.status(200).json({
      name,
      candidates: (Array.isArray(parsed?.candidates) ? parsed.candidates : []).map(tidyName).filter((c: string) => c && c !== name).slice(0, 3),
      productType: String(parsed?.productType || '').slice(0, 60),
      attributes: (Array.isArray(parsed?.attributes) ? parsed.attributes : []).map(String).slice(0, 10),
      keywords: (Array.isArray(parsed?.keywords) ? parsed.keywords : []).map(String).slice(0, 12),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || '이미지 분석 중 오류가 났습니다.' });
  }
}
