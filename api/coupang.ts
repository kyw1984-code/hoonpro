import crypto from 'crypto';

const COUPANG_ACCESS_KEY = process.env.COUPANG_ACCESS_KEY || '';
const COUPANG_SECRET_KEY = process.env.COUPANG_SECRET_KEY || '';

function generateHmac(method: string, url: string, secretKey: string, accessKey: string): string {
  const [path, ...queryParts] = url.split('?');
  const query = queryParts.length > 0 ? queryParts[0] : '';

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = pad(now.getUTCMonth() + 1);
  const dd = pad(now.getUTCDate());
  const HH = pad(now.getUTCHours());
  const MM = pad(now.getUTCMinutes());
  const SS = pad(now.getUTCSeconds());
  const datetimeGMT = `${yy}${mm}${dd}T${HH}${MM}${SS}Z`;

  const message = datetimeGMT + method + path + query;
  const signature = crypto
    .createHmac('sha256', Buffer.from(secretKey, 'utf-8'))
    .update(Buffer.from(message, 'utf-8'))
    .digest('hex');

  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetimeGMT}, signature=${signature}`;
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
    const DOMAIN = 'https://api-gateway.coupang.com';
    const method = 'GET';
    const urlPath = `/v2/providers/affiliate_open_api/apis/openapi/v1/products/${productId}`;
    const authorization = generateHmac(method, urlPath, COUPANG_SECRET_KEY, COUPANG_ACCESS_KEY);

    const response = await fetch(DOMAIN + urlPath, {
      method,
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    console.log('Coupang raw response:', JSON.stringify(data));

    // 응답 구조 유연하게 처리
    const product = data?.data ?? data?.product ?? data ?? {};

    // ✅ 모든 필드에 기본값 보장
    const reviewCount = Number(product.reviewCount ?? product.review_count ?? 0);
    const price = Number(product.salePrice ?? product.sale_price ?? product.productPrice ?? product.originalPrice ?? 0);
    const rating = Number(product.rating ?? product.totalScore ?? 0);

    return res.status(200).json({
      productId: String(product.productId ?? product.id ?? productId),
      productName: String(product.productName ?? product.name ?? '상품명 없음'),
      price,
      reviewCount,
      rating,
      categoryName: String(product.categoryName ?? product.category ?? ''),
      imageUrl: String(product.mainImageUrl ?? product.imageUrl ?? product.productImage ?? ''),
      productUrl: `https://www.coupang.com/vp/products/${productId}`,
      estimatedSales: reviewCount * 10,
      estimatedRevenue: reviewCount * 10 * price,
    });

  } catch (error: any) {
    console.error('Server error:', error);
    return res.status(500).json({ error: error.message });
  }
}
