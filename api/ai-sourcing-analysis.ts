import type { VercelRequest, VercelResponse } from '@vercel/node';

const fallback = (body: any) => ({
  score: body?.score ?? 0,
  grade: body?.grade ?? '데이터 부족',
  recommendation: body?.recommendation ?? '데이터 부족',
  reason: 'OPENAI_API_KEY가 설정되지 않아 mock 분석 결과를 반환합니다. 실제 수치가 없는 항목은 생성하지 않습니다.',
  targetCustomers: body?.targetCustomers ?? [],
  risks: body?.risks ?? ['실제 데이터 연결 전까지 시장 수치는 추정값입니다.'],
  differentiation: body?.differentiation ?? [],
  recommendedPrice: body?.recommendedPrice ?? {},
  keywords: body?.keywords ?? [],
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const input = req.body ?? {};
  if (!process.env.OPENAI_API_KEY) return res.status(200).json(fallback(input));

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
        input: [
          {
            role: 'system',
            content: '당신은 대한민국 쿠팡 전문 상품 소싱 분석가입니다. 제공된 데이터만 사용하고, 없는 숫자는 만들지 마십시오. JSON으로만 답하십시오.',
          },
          {
            role: 'user',
            content: JSON.stringify(input),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'sourcing_analysis',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                score: { type: 'number' },
                grade: { type: 'string' },
                recommendation: { type: 'string' },
                reason: { type: 'string' },
                targetCustomers: { type: 'array', items: { type: 'string' } },
                risks: { type: 'array', items: { type: 'string' } },
                differentiation: { type: 'array', items: { type: 'string' } },
                recommendedPrice: { type: 'object', additionalProperties: true },
                keywords: { type: 'array', items: { type: 'string' } },
              },
              required: ['score', 'grade', 'recommendation', 'reason', 'targetCustomers', 'risks', 'differentiation', 'recommendedPrice', 'keywords'],
            },
          },
        },
      }),
    });

    const data = await response.json();
    const text = data.output_text || data.output?.[0]?.content?.[0]?.text;
    return res.status(200).json(text ? JSON.parse(text) : fallback(input));
  } catch (error: any) {
    return res.status(200).json({ ...fallback(input), error: error.message });
  }
}
