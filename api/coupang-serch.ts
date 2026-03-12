export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    // 쿠팡 페이지 HTML 가져오기
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      return res.status(200).json({ error: true, message: `페이지 로드 실패: ${response.status}` });
    }

    const html = await response.text();

    // HTML에서 핵심 부분만 추출 (너무 길면 Gemini 토큰 초과)
    // 상품명, 가격, 리뷰 관련 부분만 추출
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : html;

    // 스크립트, 스타일 제거
    const cleanHtml = body
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000); // 8000자로 제한

    // Gemini API로 파싱
    const geminiRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY || '',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `아래는 쿠팡 상품 페이지의 텍스트입니다. 다음 정보를 추출해서 JSON으로만 반환하세요. 다른 텍스트 없이 JSON만 반환하세요.

{
  "productName": "상품명",
  "price": 숫자만 (원 단위, 없으면 0),
  "reviewCount": 숫자만 (없으면 0),
  "rating": 숫자만 소수점 포함 (없으면 0),
  "categoryName": "카테고리명 (없으면 빈 문자열)"
}

페이지 텍스트:
${cleanHtml}`
          }]
        }],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    });

    const geminiData = await geminiRes.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    
    let parsed: any = {};
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      return res.status(200).json({ error: true, message: '데이터 파싱 실패' });
    }

    const reviewCount = Number(parsed.reviewCount) || 0;
    const price = Number(parsed.price) || 0;

    return res.status(200).json({
      productName: parsed.productName || '상품명 없음',
      price,
      reviewCount,
      rating: Number(parsed.rating) || 0,
      categoryName: parsed.categoryName || '',
      estimatedSales: reviewCount * 10,
      estimatedRevenue: reviewCount * 10 * price,
    });

  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
