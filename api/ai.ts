import type { VercelRequest, VercelResponse } from '@vercel/node';
// ESM이라 상대 경로 import에는 확장자가 필요하다. 빠지면 함수가 통째로 죽는다.
import { handleGenerateImage } from '../lib/ai/generate-image.js';
import { handleAnalyzeImage } from '../lib/ai/analyze-image.js';
import { handleGenerateText } from '../lib/ai/generate-text.js';
import { handleProductName } from '../lib/ai/product-name.js';
import { handleListingAttrs, handleListingNotices } from '../lib/ai/listing-attrs.js';

// 썸네일·상세페이지 제작이 쓰는 AI 호출 셋을 한 함수로 묶는다.
//   action=generate-image  이미지 생성 (OpenAI gpt-image / Gemini image)
//   action=analyze-image   생성 결과 검수 (비전 모델)
//   action=generate-text   기획 문안·프롬프트 생성
//   action=product-name    제품 사진 → 쿠팡 상위노출 기준 상품명 (상품등록AI)
//   action=listing-attrs   제품 사진 + 카테고리 속성 목록 → 검색필터 값 (상품등록AI)
//   action=listing-notices 상세페이지 이미지 → 제공고시·옵션 (상품등록AI)
// 예전에는 파일 셋이 각각 서버리스 함수였다. Vercel Pro 한도(12개)에 걸려
// 기능을 내리면서 지웠고, 되살리며 하나로 합쳤다 — 인증·접근 게이트·한도
// 검사는 각 핸들러 안에 그대로 있다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = String(req.query.action ?? '');
  switch (action) {
    case 'generate-image': return await handleGenerateImage(req, res);
    case 'analyze-image': return await handleAnalyzeImage(req, res);
    case 'generate-text': return await handleGenerateText(req, res);
    case 'product-name': return await handleProductName(req, res);
    case 'listing-attrs': return await handleListingAttrs(req, res);
    case 'listing-notices': return await handleListingNotices(req, res);
    default: return res.status(400).json({ error: `알 수 없는 action: ${action || '(없음)'}` });
  }
}
