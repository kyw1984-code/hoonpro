import crypto from 'crypto';

const COUPANG_ACCESS_KEY = process.env.COUPANG_ACCESS_KEY || '';
const COUPANG_SECRET_KEY = process.env.COUPANG_SECRET_KEY || '';

function generateHmacSignature(
  method: string,
  path: string,
  datetime: string,
  secretKey: string
): string {
  const message = datetime + method + path;
  return crypto.createHmac('sha256', secretKey).update(message).digest('hex');
}

function getDatetime(): string {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { productId } = req.body;
  if (!productId) return res.status(400).json({ error: 'productId is required' });

  try {
    const method = 'GET';
    const path = `/v2/providers/affiliate_open_api/apis/openapi/products/search?keyword=${productId}&limit=1`;
    const datetime = getDatetime();
    const signature = generateHmacSignature(method, path, datetime, COUPANG_SECRET_KEY);

    const authorization = `CEA algorithm=HmacSHA256, access-key=${COUPANG_ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`;

    const response = await fetch(`https://api.coupang.com${path}`, {
      method,
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    // 첫 번째 상품 데이터 추출
    const product = data?.data?.productData?.[0];
    if (!product) {
      return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
    }

    return res.status(200).json({
      productId: product.productId,
      productName: product.productName,
      price: product.productPrice,
      reviewCount: product.reviewCount ?? 0,
      rating: product.rating ?? 0,
      categoryName: product.categoryName ?? '',
      imageUrl: product.productImage ?? '',
      productUrl: product.productUrl ?? '',
      // 추정 데이터
      estimatedSales: (product.reviewCount ?? 0) * 10,
      estimatedRevenue: (product.reviewCount ?? 0) * 10 * product.productPrice,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
