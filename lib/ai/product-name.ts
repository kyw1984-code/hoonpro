import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { calcCostUsd } from '../../src/lib/pricing.js';
import { checkAccess } from '../../src/lib/accessGate.js';

/**
 * 제품 사진으로 훈프로 코칭 기준의 쿠팡 상품명을 만든다.
 *
 * 기준은 코칭AI 지식(강의·컨설팅 자료)에 있는 상품명 규칙이다. 그 규칙을 아래에
 * 고정 요약으로 두고, 지식 청크에서 '상품명' 관련 원문도 함께 끌어와 모델에 준다.
 * 강의 자료가 바뀌면 원문 쪽은 자동으로 따라가고, 고정 요약은 바뀐 규칙을 보고
 * 손으로 맞춘다. 두 벌을 두는 이유: 청크 검색이 빈손일 때도 기준이 비면 안 된다.
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

/** 코칭 기준에서 금지하는 것들을 걷어낸다: 특수문자·기호(1+1, ★, +, ×), 과장, 중복 공백, 40자 초과 */
function tidyName(value: string): string {
  return String(value || '')
    .replace(/[\[\]{}()<>【】★☆♥♡※!?*#@^~`'"“”‘’|\\\/+×x✕]/g, ' ')
    .replace(/\b(최고|최저가|1위|베스트|핫딜|무료배송|당일배송|정품|인기|추천|특가|세일|할인|이벤트|단독|초특가|파격)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/** 코칭AI 지식에서 상품명 규칙이 적힌 원문을 끌어온다 (제목과 함께, 3,500자까지) */
async function coachingNameRules(): Promise<string> {
  try {
    const { data } = await supabase
      .from('knowledge_chunks')
      .select('content, knowledge_docs(title)')
      .or('content.ilike.%조합형 키워드%,content.ilike.%상품명 —%,content.ilike.%상품명%순서%,content.ilike.%2-1. 상품명%,content.ilike.%상품명 최대%')
      .limit(8);
    const parts: string[] = [];
    let total = 0;
    for (const row of (data ?? []) as any[]) {
      const text = String(row.content ?? '').trim();
      if (!text) continue;
      const title = row.knowledge_docs?.title ? `[${row.knowledge_docs.title}]` : '';
      const piece = `${title}\n${text}`.slice(0, 1400);
      if (total + piece.length > 3500) break;
      parts.push(piece);
      total += piece.length;
    }
    return parts.join('\n\n');
  } catch {
    return '';
  }
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

  const bundleCount = Math.max(0, Math.round(Number(req.body?.bundleCount) || 0));
  const month = new Date(Date.now() + 9 * 3600_000).getUTCMonth() + 1; // 한국 기준 이번 달 — 계절 표기용
  const rules = await coachingNameRules();

  const instruction = `
당신은 훈프로 코칭 기준으로 쿠팡 상품명을 짓는 작성자입니다. 첨부한 제품 사진을 보고 아래 JSON만 돌려주세요.

{
  "productType": "제품 유형 (예: 맨투맨 티셔츠)",
  "attributes": ["사진에서 확인되는 속성: 소재, 핏, 디테일(라운드넥·프린팅 등), 사이즈/용량, 수량 — 보이는 것만"],
  "gender": "여성 | 여자 | 남자 | 공용 | 해당없음",
  "season": "사진과 제품으로 판단한 계절 표기 (봄·여름·가을·겨울·간절기·사계절) 또는 해당없음",
  "keywords": ["검색어(태그)에 넣을 키워드 20개 — 성별·계절·제품명·소구점을 앞뒤로 붙여 조합한 형태(예: 여성 여름 반팔티)로, 중복 없이"],
  "name": "최종 상품명",
  "candidates": ["다른 조합의 상품명 2개"]
}

[훈프로 상품명 규칙 — 반드시 이 순서와 기준]
1. 순서: ${brand ? `브랜드(${brand}) → ` : '(브랜드 있으면 맨 앞) → '}성별 → 계절 → 제품명 2개 → 소구점 → N종세트
   - 성별: 쿠팡 주 구매층이 '여성'으로 검색하므로 여성복은 '여성', 어리고 예쁜 감성이면 '여자'. 남성복은 '남자'(남성은 자동완성에 브랜드가 붙어 불리). 성별 없는 제품은 생략.
   - 계절: 지금은 ${month}월. 시점에 맞춰 적는다 (가을 전이면 '간절기', 실제 가을이면 '가을'). 계절을 타지 않는 제품은 생략.
   - 제품명 2개: 같은 뜻의 명칭 두 가지를 띄어서 나란히 (바지 팬츠 / 반팔 티셔츠 / 맨투맨 긴팔). 두 명칭으로 검색이 두 배 잡힌다.
   - 소구점: 루즈핏·라운드넥·프린팅·오버핏처럼 사진으로 확인되는 것만 1~2개. 없는 특징은 쓰지 않는다.
   - N종세트: ${bundleCount >= 2 ? `${bundleCount}종세트로 끝에 적는다 (글자로 '${bundleCount}종세트', 숫자+기호 금지)` : '세트가 아니면 적지 않는다'}.
2. 35자 이하가 가장 좋고 최대 40자(공백 포함). 길게 쓰면 역효과.
3. 색상은 상품명에 넣지 않는다 — 옵션과 겹쳐 반려된다. 색상은 keywords(태그)에만 넣는다.
4. 특수문자·기호 절대 금지: 1+1, ★, +, ×, 괄호, 슬래시, 따옴표. '이종세트'처럼 글자로 쓴다.
5. 조합형 키워드: 띄어쓰기 하나로 '반팔 티'는 '반팔'·'티'·'반팔티' 세 방향 모두 걸린다. 단, CPC가 비싼 큰 키워드(예: 패딩)를 피하려면 '패딩조끼'처럼 붙여 쓴다.
6. 과장·홍보 문구 금지: 최고, 1위, 베스트, 정품, 무료배송, 추천, 특가, 할인, 이벤트, 신상.
7. 사진으로 확인할 수 없는 사실(소재 비율, 인증, 원산지, 용량 숫자)은 지어내지 않는다. 사용자 참고 정보에 있으면 쓴다.
예) ABC 여성 간절기 니트티 라운드넥 스웨터 2종세트
${hint ? `\n[사용자 참고 정보]\n${hint}` : ''}
${rules ? `\n[훈프로 강의 원문 — 위 규칙과 다르게 적힌 것이 있으면 원문을 따른다]\n${rules}` : ''}
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
    const keywords = [...new Set((Array.isArray(parsed?.keywords) ? parsed.keywords : []).map((k: any) => String(k).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 20);
    return res.status(200).json({
      name,
      candidates: (Array.isArray(parsed?.candidates) ? parsed.candidates : []).map(tidyName).filter((c: string) => c && c !== name).slice(0, 3),
      productType: String(parsed?.productType || '').slice(0, 60),
      attributes: (Array.isArray(parsed?.attributes) ? parsed.attributes : []).map(String).slice(0, 10),
      keywords,
      rulesSource: rules ? '훈프로 강의 자료' : '기본 규칙',
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || '이미지 분석 중 오류가 났습니다.' });
  }
}
