import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { keyword } = req.query;

  if (!keyword) {
    return res.status(400).json({ error: '키워드가 필요합니다.' });
  }

  const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY;
  const SECRET_KEY = process.env.COUPANG_SECRET_KEY;

  if (!ACCESS_KEY || !SECRET_KEY) {
    return res.status(500).json({ error: '서버 API 키 설정이 되어있지 않습니다.' });
  }

  const method = "GET";
  const path = `/v2/providers/openapi/apis/api/v4/products/search?keyword=${encodeURIComponent(keyword as string)}&limit=10`;
  const timestamp = new Date().toISOString().replace(/[:\-]|\.\d{3}/g, "").replace("Z", "K");
  
  const algorithm = 'sha256';
  const signature = crypto.createHmac(algorithm, SECRET_KEY)
    .update(timestamp + method + path)
    .digest('hex');

  const authorization = `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${timestamp}, signature=${signature}`;

  try {
    const response = await fetch(`https://api-gateway.coupang.com${path}`, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": authorization,
        "x-requested-with": "OPENAPI",
      }
    });

    const result = await response.json();

    if (result.data && result.data.productEntities) {
      // 프론트엔드에서 사용할 필드들을 정확히 매핑하여 전달합니다.
      const products = result.data.productEntities.map((item: any) => ({
        productId: item.productId,
        productName: item.productName,
        productPrice: item.productPrice,
        productImage: item.productImage,
        productUrl: item.productUrl, // 이 주소가 링크 생성의 핵심입니다.
        isRocket: item.isRocket,
        rating: item.rating,
        reviewCount: item.reviewCount,
      }));

      return res.status(200).json({ products });
    } else {
      return res.status(200).json({ products: [], message: '검색 결과가 없습니다.' });
    }
  } catch (error) {
    return res.status(500).json({ error: '쿠팡 API 연결 실패' });
  }
}
