import type { CoupangProduct, PriceRange, Strategy } from "../types/coupang";

// ─── HMAC-SHA256 서명 (Web Crypto API) ───────────────────────────────────────
export async function generateHmacSignature(
  secretKey: string,
  message: string
): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(message)
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildDatetime(): string {
  return (
    new Date().toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z"
  );
}

// ─── 추정 판매량 계산 ─────────────────────────────────────────────────────────
export function estimateMonthlySales(
  rank: number,
  reviewCount: number,
  price: number
): number {
  const base = Math.max(0, (10 - rank) * 180 + reviewCount * 0.4);
  const multiplier = price < 20000 ? 1.3 : price < 40000 ? 1.0 : 0.75;
  return Math.round(base * multiplier);
}

// ─── 가격 범위 계산 ───────────────────────────────────────────────────────────
export function getPriceRange(products: CoupangProduct[]): PriceRange {
  const prices = products.map((p) => p.productPrice);
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
  };
}

// ─── 전략 도출 ────────────────────────────────────────────────────────────────
export function deriveStrategies(
  products: CoupangProduct[]
): Strategy[] {
  const rocketRatio =
    products.filter((p) => p.isRocket).length / products.length;
  const priceRange = getPriceRange(products);
  const topAvgReviews =
    products.slice(0, 3).reduce((a, p) => a + p.reviewCount, 0) / 3;
  const totalEstSales = products.reduce(
    (a, p, i) => a + estimateMonthlySales(p.salesRank ?? i + 1, p.reviewCount, p.productPrice),
    0
  );

  const strategies: Strategy[] = [];

  if (rocketRatio > 0.6) {
    strategies.push({
      icon: "🚀",
      title: "로켓배송 필수 진입",
      desc: `상위 상품의 ${Math.round(rocketRatio * 100)}%가 로켓배송입니다. 로켓그로스 입점을 우선 검토하세요.`,
      color: "#ef4444",
    });
  } else {
    strategies.push({
      icon: "💡",
      title: "일반 판매 진입 가능",
      desc: `로켓 비중 ${Math.round(rocketRatio * 100)}%로 낮아 일반 판매자도 충분히 경쟁 가능한 시장입니다.`,
      color: "#14b8a6",
    });
  }

  if (priceRange.avg < 30000) {
    strategies.push({
      icon: "💰",
      title: "저가 경쟁 심화 시장",
      desc: `평균가 ${priceRange.avg.toLocaleString()}원. 가격 경쟁 대신 번들 구성·사은품으로 가치를 차별화하세요.`,
      color: "#f59e0b",
    });
  } else {
    strategies.push({
      icon: "🎯",
      title: "프리미엄 포지셔닝 가능",
      desc: `평균가 ${priceRange.avg.toLocaleString()}원. 고품질 이미지·브랜드 스토리 강조가 핵심입니다.`,
      color: "#a855f7",
    });
  }

  if (topAvgReviews < 500) {
    strategies.push({
      icon: "⭐",
      title: "리뷰 선점 기회 존재",
      desc: `상위권 평균 리뷰 ${Math.round(topAvgReviews)}개로 적습니다. 초기 리뷰 100개 확보 시 상위 노출 가능합니다.`,
      color: "#22c55e",
    });
  } else {
    strategies.push({
      icon: "📦",
      title: "리뷰 진입장벽 높음",
      desc: `상위권 평균 ${Math.round(topAvgReviews)}개. 틈새 키워드·서브카테고리 우선 진입을 추천합니다.`,
      color: "#f97316",
    });
  }

  strategies.push({
    icon: "📊",
    title: "시장 규모 추정",
    desc: `상위 상품 월 추정 판매량 ${totalEstSales.toLocaleString()}개, 거래액 약 ${Math.round((totalEstSales * priceRange.avg) / 10000).toLocaleString()}만원 규모입니다.`,
    color: "#3b82f6",
  });

  return strategies;
}

// ─── 진입 체크리스트 ──────────────────────────────────────────────────────────
export function buildChecklist(products: CoupangProduct[]): string[] {
  const priceRange = getPriceRange(products);
  const rocketCount = products.filter((p) => p.isRocket).length;
  const topAvgReviews =
    products.slice(0, 3).reduce((a, p) => a + p.reviewCount, 0) / 3;

  return [
    `가격대: ${priceRange.min.toLocaleString()}원 이하 or ${Math.round(priceRange.avg * 1.2).toLocaleString()}원 이상 프리미엄 포지셔닝`,
    `초기 리뷰 최소 ${Math.round(topAvgReviews * 0.1)}개 확보 후 광고 집행 권장`,
    rocketCount > products.length / 2
      ? "로켓그로스 입점 검토 필수"
      : "일반 판매 우선 진입 가능",
    "상품 썸네일·상세페이지 차별화 (상위 상품 대비 시각 우위 확보)",
    "롱테일 키워드 변형으로 검색 노출 다각화",
  ];
}

// ─── 목업 데이터 ──────────────────────────────────────────────────────────────
export const MOCK_PRODUCTS: CoupangProduct[] = [
  { productId: "1001", productName: "무선 블루투스 이어폰 노이즈캔슬링 프리미엄", productPrice: 45900, productImage: "", productUrl: "#", isRocket: true,  rating: 4.7, reviewCount: 3821, salesRank: 1 },
  { productId: "1002", productName: "TWS 완전무선 이어폰 저지연 게이밍",           productPrice: 29900, productImage: "", productUrl: "#", isRocket: true,  rating: 4.3, reviewCount: 1542, salesRank: 2 },
  { productId: "1003", productName: "오픈형 무선 이어폰 골전도 스포츠",            productPrice: 38000, productImage: "", productUrl: "#", isRocket: false, rating: 4.1, reviewCount:  876, salesRank: 3 },
  { productId: "1004", productName: "USB-C 유선 이어폰 고음질 Hi-Fi",             productPrice: 15900, productImage: "", productUrl: "#", isRocket: true,  rating: 4.5, reviewCount: 2103, salesRank: 4 },
  { productId: "1005", productName: "네크밴드 블루투스 이어폰 장시간 배터리",       productPrice: 22000, productImage: "", productUrl: "#", isRocket: false, rating: 3.9, reviewCount:  654, salesRank: 5 },
  { productId: "1006", productName: "어린이용 무선 이어폰 음량제한 안전설계",       productPrice: 18500, productImage: "", productUrl: "#", isRocket: true,  rating: 4.6, reviewCount: 1287, salesRank: 6 },
  { productId: "1007", productName: "ANC 노이즈캔슬링 이어폰 통화품질 우수",       productPrice: 59000, productImage: "", productUrl: "#", isRocket: false, rating: 4.4, reviewCount:  932, salesRank: 7 },
  { productId: "1008", productName: "방수 스포츠 이어폰 IPX7 달리기용",           productPrice: 32000, productImage: "", productUrl: "#", isRocket: true,  rating: 4.2, reviewCount: 1678, salesRank: 8 },
];
