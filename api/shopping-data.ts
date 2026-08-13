import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 60 };

const BRIGHTDATA_API_TOKEN = (process.env.BRIGHTDATA_API_TOKEN || '').trim();
const BRIGHTDATA_COUPANG_DATASET_ID = (process.env.BRIGHTDATA_COUPANG_DATASET_ID || 'gd_mcsxmfqptpufr191p').trim();
const BRIGHTDATA_API_BASE = 'https://api.brightdata.com/datasets/v3';
const BRAND_EXCLUDE = [
  '나이키', 'nike', '아디다스', 'adidas', '뉴발란스', 'new balance', '푸마', 'puma', '리복', 'reebok',
  '아식스', 'asics', '미즈노', 'mizuno', '휠라', 'fila', '챔피언', 'champion', '언더아머', 'under armour',
  'k2', '아이더', 'eider', '블랙야크', 'blackyak', '코오롱', 'kolon', '밀레', 'millet', '네파', 'nepa',
  '삼성', 'samsung', 'lg', '애플', 'apple', '샤오미', 'xiaomi', '필립스', 'philips', '소니', 'sony',
  '갭', 'gap', '유니클로', 'uniqlo', '자라', 'zara', 'h&m', '무신사', '탑텐', 'topten', '스파오', 'spao',
];

type BrightDataRecord = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function buildCoupangSearchUrl(keyword: string) {
  return `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}`;
}

function normalizeCoupangUrl(value: string) {
  if (!value) return '';
  if (/^https:\/\/(www\.)?coupang\.com\//i.test(value) || /^https:\/\/shop\.coupang\.com\//i.test(value)) return value;
  return '';
}

function authHeaders() {
  return {
    Authorization: `Bearer ${BRIGHTDATA_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function extractRecords(payload: unknown): BrightDataRecord[] {
  if (Array.isArray(payload)) return payload.flatMap(extractRecords) as BrightDataRecord[];
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as BrightDataRecord;
  const nestedKeys = ['products', 'items', 'results', 'data', 'records'];
  const nested = nestedKeys.flatMap((key) => extractRecords(record[key]));
  return nested.length > 0 ? nested : [record];
}

function isProductUrl(url: string) {
  return /coupang\.com\/(vp|np)\/products\//i.test(url);
}

function getProductUrl(record: BrightDataRecord) {
  const candidates = [
    record.url,
    record.product_url,
    record.productUrl,
    record.link,
    record.final_url,
    record.resolved_url,
  ].map(asString).filter(Boolean);
  return candidates.find(isProductUrl) || candidates.find((url) => /coupang\.com/i.test(url)) || '';
}

function getProductName(record: BrightDataRecord) {
  return asString(record.title) || asString(record.product_title) || asString(record.productName) || asString(record.name);
}

function getDeliveryType(record: BrightDataRecord) {
  const shippingDetails = Array.isArray(record.shipping_details) ? record.shipping_details.map(asString).join(' ') : '';
  const text = `${asString(record.delivery)} ${asString(record.shipping)} ${asString(record.shipping_company)} ${shippingDetails} ${asString(record.badge)} ${asString(record.delivery_type)}`.toLowerCase();
  if (text.includes('판매자로켓') || text.includes('seller rocket') || text.includes('jet')) return 'jet';
  if (text.includes('로켓') || text.includes('rocket')) return 'rocket';
  return 'general';
}

function normalizeRecord(record: BrightDataRecord, index: number) {
  const productName = getProductName(record);
  const productUrl = getProductUrl(record);
  const productPrice = asNumber(record.final_price) || asNumber(record.price) || asNumber(record.productPrice) || asNumber(record.sale_price);
  const ratingCount = asNumber(record.reviews_count) || asNumber(record.review_count) || asNumber(record.reviews) || asNumber(record.ratingCount);
  const rating = asNumber(record.rating) || asNumber(record.star_rating);
  const brand = asString(record.brand) || asString(record.brand_name);
  const productImage = asString(record.main_image) || asString(record.image) || asString(record.image_url) || asString(record.thumbnail) || asString(record.productImage);
  const sellerName = asString(record.seller) || asString(record.seller_name) || asString(record.vendor) || asString(record.store);
  const lowerName = productName.toLowerCase();
  const lowerBrand = brand.toLowerCase();
  const hasExcludedBrand = BRAND_EXCLUDE.some((brandName) => lowerName.includes(brandName.toLowerCase()) || lowerBrand.includes(brandName.toLowerCase()));

  return {
    productId: asString(record.id) || asString(record.product_id) || asString(record.productId) || productUrl || `brightdata-${index + 1}`,
    productName,
    productPrice,
    productImage,
    productUrl,
    rating,
    ratingCount,
    reviewCount: ratingCount,
    rank: index + 1,
    salesRank: index + 1,
    deliveryType: getDeliveryType(record),
    sellerName,
    brand,
    source: 'brightdata',
    calculated: {
      saleIndex: Math.max(0, Math.round(100 - Math.log10(Math.max(1, index + 1)) * 38)),
    },
    hasExcludedBrand,
  };
}

async function triggerBrightData(inputUrl: string) {
  const url = `${BRIGHTDATA_API_BASE}/scrape?dataset_id=${encodeURIComponent(BRIGHTDATA_COUPANG_DATASET_ID)}&format=json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify([{ url: inputUrl }]),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message || data?.error || `Bright Data scrape failed: ${response.status}`);
  return data;
}

async function downloadSnapshot(snapshotId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const progressResponse = await fetch(`${BRIGHTDATA_API_BASE}/progress/${snapshotId}`, { headers: authHeaders() });
    const progress = await progressResponse.json();
    if (progress.status === 'failed') throw new Error(progress.error_message || 'Bright Data snapshot failed');
    if (progress.status === 'ready') {
      const snapshotResponse = await fetch(`${BRIGHTDATA_API_BASE}/snapshot/${snapshotId}?format=json`, { headers: authHeaders() });
      const snapshot = await snapshotResponse.json();
      if (!snapshotResponse.ok) throw new Error(snapshot?.message || snapshot?.error || 'Bright Data snapshot download failed');
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return { pending: true, snapshotId };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!BRIGHTDATA_API_TOKEN) return res.status(500).json({ error: 'BRIGHTDATA_API_TOKEN is not configured' });

  const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';
  const categoryUrl = typeof req.query.categoryUrl === 'string' ? normalizeCoupangUrl(req.query.categoryUrl.trim()) : '';
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const excludeBrands = req.query.excludeBrands !== 'false';
  if (!keyword && !categoryUrl) return res.status(400).json({ error: 'keyword or categoryUrl is required' });

  try {
    const inputUrl = categoryUrl || buildCoupangSearchUrl(keyword);
    const raw = await triggerBrightData(inputUrl);
    const payload = raw?.snapshot_id ? await downloadSnapshot(String(raw.snapshot_id)) : raw;
    if (payload?.pending) return res.status(202).json(payload);

    const products = extractRecords(payload)
      .map(normalizeRecord)
      .filter((product) => product.productName && product.productUrl && product.productPrice > 0)
      .filter((product) => !excludeBrands || !product.hasExcludedBrand)
      .slice(0, limit);

    return res.status(200).json({ provider: 'brightdata', keyword, inputUrl, products });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Bright Data error';
    return res.status(502).json({ error: message, provider: 'brightdata' });
  }
}
