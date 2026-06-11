import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

// ─── Naver API 환경변수 ───────────────────────────────────────────────────────
const NAVER_CLIENT_ID = (
  process.env.NAVER_CLIENT_ID ||
  process.env.NAVER_API_CLIENT_ID ||
  ""
).trim();
const NAVER_CLIENT_SECRET = (
  process.env.NAVER_CLIENT_SECRET ||
  process.env.NAVER_API_CLIENT_SECRET ||
  ""
).trim();
const COUPANG_COOKIE = (process.env.COUPANG_COOKIE || "").trim();

// ─── Naver Shopping 검색 ─────────────────────────────────────────────────────
interface NaverShopItem {
  title: string;
  link: string;
  image: string;
  lprice: string;
  mallName: string;
  productId: string;
  brand: string;
  maker: string;
  category1: string;
}

async function searchNaverShopping(
  keyword: string,
  start = 1,
  display = 100,
  sort: "sim" | "date" | "asc" | "dsc" = "sim",
  retryCount = 0
): Promise<NaverShopItem[]> {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=${display}&start=${start}&sort=${sort}`;
  try {
    const res = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
      },
    });
    if (res.status === 429 && retryCount < 2) {
      await new Promise((r) => setTimeout(r, 600 + retryCount * 800));
      return searchNaverShopping(keyword, start, display, sort, retryCount + 1);
    }
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extractCoupangPageKey(link: string): string | null {
  const m = link?.match(/[?&]pageKey=(\d+)/i);
  return m ? m[1] : null;
}

function extractCoupangProductId(link: string): string | null {
  if (!link) return null;
  const patterns = [
    /\/vp\/products\/(\d+)/,
    /\/np\/products\/(\d+)/,
    /products\/(\d+)/,
    /productId=(\d+)/i,
    /pid=(\d+)/i,
  ];
  for (const p of patterns) {
    const m = link.match(p);
    if (m) return m[1];
  }
  return null;
}

function detectDeliveryType(title: string): "rocket" | "jet" | "general" {
  const lower = title.toLowerCase();
  if (lower.includes("판매자로켓") || lower.includes("로켓그로스")) return "jet";
  if (lower.includes("로켓배송") || lower.includes("로켓")) return "rocket";
  return "general";
}

async function fetchCoupangViaNaver(keyword: string): Promise<any[]> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return [];

  const queries: { kw: string; sort: "sim" | "date" }[] = [
    { kw: keyword, sort: "sim" },
    { kw: `${keyword} 쿠팡`, sort: "sim" },
    { kw: keyword, sort: "date" },
  ];
  const pageStarts = [1, 101, 201, 301];

  const allItems: NaverShopItem[] = [];
  for (const q of queries) {
    for (const start of pageStarts) {
      const items = await searchNaverShopping(q.kw, start, 100, q.sort);
      allItems.push(...items);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const coupangOnly = allItems.filter(
    (item) =>
      (item.link && /coupang\.com/i.test(item.link)) ||
      (item.mallName && /쿠팡|coupang/i.test(item.mallName))
  );

  const byId = new Map<string, any>();
  const products: any[] = [];
  for (const item of coupangOnly) {
    const itemBrand = stripHtml(item.brand || item.maker || "");
    let productId =
      extractCoupangPageKey(item.link) || extractCoupangProductId(item.link);
    if (!productId) {
      if (item.productId) productId = String(item.productId);
      else continue;
    }
    if (byId.has(productId)) {
      const prev = byId.get(productId);
      if (!prev.brand && itemBrand) prev.brand = itemBrand;
      continue;
    }
    const name = stripHtml(item.title);
    const price = parseInt(item.lprice, 10) || 0;
    if (!name || price <= 0) continue;

    const product = {
      productId: parseInt(productId, 10) || productId,
      productName: name,
      productPrice: price,
      productImage: item.image,
      productUrl: item.link,
      rating: 0,
      ratingCount: 0,
      isRocket: false,
      deliveryType: detectDeliveryType(name),
      rank: products.length + 1,
      source: "naver",
      brand: itemBrand,
      category: item.category1 || "",
    };
    byId.set(productId, product);
    products.push(product);
  }
  return products;
}

// ─── 리뷰수 보강 ────────────────────────────────────────────────────────────
const UA_LIST = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
];

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(fallback);
    });
  });
}

async function fetchReviewSummary(
  productId: string | number
): Promise<{ rating: number; count: number }> {
  const pid = String(productId);
  const url = `https://www.coupang.com/vp/products/reviews?productId=${pid}&page=1&size=1&sortBy=ORDER_SCORE_ASC&ratingSummary=true`;
  const ua = UA_LIST[Math.floor(Math.random() * UA_LIST.length)];
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
        Referer: `https://www.coupang.com/vp/products/${pid}`,
        ...(COUPANG_COOKIE ? { Cookie: COUPANG_COOKIE } : {}),
      },
    });
    if (!res.ok) return { rating: 0, count: 0 };
    const html = await res.text();
    if (html.includes("Access Denied") || html.includes("보안 확인"))
      return { rating: 0, count: 0 };
    const ratingMatch =
      html.match(/rating-star-num[^>]*>([\d.]+)/) ||
      html.match(/sdp-review__average__total-star__number[^>]*>([\d.]+)/);
    const countMatch =
      html.match(/sdp-review__average__total-count[^>]*>([\d,]+)/) ||
      html.match(/count[^>]*>([\d,]+)/);
    return {
      rating: parseFloat(ratingMatch?.[1] || "0"),
      count: parseInt((countMatch?.[1] || "0").replace(/,/g, ""), 10) || 0,
    };
  } catch {
    return { rating: 0, count: 0 };
  }
}

async function enrichReviewCounts(products: any[]): Promise<void> {
  const CONCURRENCY = 4;
  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const chunk = products.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      chunk.map(async (p) => {
        if (!p?.productId) return;
        const summary = await withTimeout(
          fetchReviewSummary(p.productId),
          8000,
          { rating: 0, count: 0 }
        );
        if (summary.count > 0) {
          p.ratingCount = summary.count;
          p.rating = summary.rating;
          p.reviewEnriched = true;
        }
      })
    );
  }
}

// ─── 필터링 & 점수 계산 ──────────────────────────────────────────────────────
const BRAND_EXCLUDE = [
  "나이키","nike","아디다스","adidas","뉴발란스","new balance","푸마","puma","리복","reebok",
  "아식스","asics","미즈노","mizuno","휠라","fila","챔피언","champion","언더아머","under armour",
  "카파","kappa","폴로","polo","라코스테","lacoste","타미힐피거","tommy hilfiger","캘빈클라인","calvin klein",
  "게스","guess","리바이스","levi's","levis","버버리","burberry","구찌","gucci","유니클로","uniqlo",
  "스파오","spao","탑텐","topten","지오다노","giordano","노스페이스","north face","northface",
  "컬럼비아","columbia","디스커버리","discovery","k2","아이더","eider","블랙야크","blackyak",
  "코오롱","kolon","밀레","millet","네파","nepa","mlb","nba","nfl",
  "삼성","samsung","lg","애플","apple","샤오미","xiaomi","필립스","philips","소니","sony",
  "파나소닉","panasonic","레노버","lenovo","hp","에이수스","asus","캐논","canon","니콘","nikon",
  "다이소","daiso",
];

function filterAndScoreProducts(
  items: any[],
  minPrice: number,
  maxPrice: number,
  searchKeyword: string = ""
) {
  const noiseKeywords = ["글루타치온","영양제","비타민","유산균","콜라겐"];
  const searchWords = searchKeyword.split(" ").filter((w) => w.length >= 2);
  const searchLower = searchKeyword.toLowerCase();
  const searchTargetsBrand = BRAND_EXCLUDE.some((b) => searchLower.includes(b.toLowerCase()));

  const filtered = items.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const price = item.productPrice || 0;
    const name = (item.productName || "").toLowerCase();
    const brand = (item.brand || "").toLowerCase();
    if (price < minPrice || price > maxPrice) return false;
    if (!searchTargetsBrand) {
      if (BRAND_EXCLUDE.some((b) => name.includes(b.toLowerCase()) || brand.includes(b.toLowerCase()))) return false;
    }
    if (brand) {
      const searchMatchesThisBrand =
        searchTargetsBrand ||
        (searchLower.length > 0 && (searchLower.includes(brand) || brand.includes(searchLower)));
      if (!searchMatchesThisBrand) return false;
    }
    if (noiseKeywords.some((n) => name.includes(n)) && !noiseKeywords.some((n) => searchKeyword.toLowerCase().includes(n))) return false;
    if (searchWords.length > 0) {
      const matchCount = searchWords.filter((w) => name.includes(w.toLowerCase())).length;
      if (matchCount === 0 && searchWords.length >= 2) return false;
    }
    return true;
  });

  const redOceans = [
    "이어폰","블루투스","텐트","캠핑텐트","마스크","생수","기저귀","충전기","케이블",
    "침대","의자","양말","물티슈","샴푸","치약","칫솔","비타민","영양제","슬리퍼",
    "텀블러","선스크린","면도기","물통","베개",
  ];

  const scored = filtered.map((item) => {
    const price = item.productPrice || 1;
    const rank = item.rank || 100;
    const ratingCount = item.ratingCount || 0;
    const rating = item.rating || 0;
    const reviewEnriched = !!item.reviewEnriched;

    let deliveryType = item.deliveryType;
    if (!deliveryType && item.isRocket) deliveryType = "rocket_fallback";
    else if (!deliveryType) deliveryType = "general";
    const isRocketType = deliveryType === "rocket" || deliveryType === "rocket_fallback";

    const reviewStrength =
      reviewEnriched && ratingCount > 0
        ? Math.min(100, Math.round(Math.log10(ratingCount + 1) * 28))
        : 0;
    const naverRankScore = Math.min(100, Math.max(2, Math.round(100 - 38 * Math.log10(Math.max(1, rank)))));
    const priceScore =
      price >= 15000 && price < 40000 ? 30 :
      price >= 40000 && price < 90000 ? 25 :
      price >= 90000 && price < 250000 ? 15 :
      price >= 250000 ? 8 : 0;
    const lowPricePenalty = price < 20000 ? 8 : 0;
    const saleIndex = reviewEnriched
      ? Math.min(100, Math.round(reviewStrength * 0.65 + naverRankScore * 0.35))
      : naverRankScore;

    const lowerName = (item.productName || "").toLowerCase();
    const isExactRed = redOceans.some((r) => lowerName === r.toLowerCase());
    const isContainsRed = redOceans.some((r) => lowerName.includes(r.toLowerCase()));

    let reviewComp = 0;
    if (ratingCount > 5000) reviewComp = 50;
    else if (ratingCount > 1000) reviewComp = 40;
    else if (ratingCount > 300) reviewComp = 28;
    else if (ratingCount > 50) reviewComp = 15;
    else if (ratingCount > 0) reviewComp = 6;
    const qualityComp = rating >= 4.5 && ratingCount > 400 ? 12 : 0;
    const deliveryComp = isRocketType ? 20 : deliveryType === "jet" ? 12 : 0;
    const priceComp = price < 15000 ? 18 : price < 35000 ? 10 : 0;
    const rankComp =
      rank <= 10 ? 35 : rank <= 30 ? 28 : rank <= 60 ? 22 :
      rank <= 100 ? 16 : rank <= 200 ? 10 : 5;
    const redOceanComp = isContainsRed ? 12 : 0;
    const competitionStrength = Math.min(100, reviewComp + qualityComp + deliveryComp + priceComp + rankComp + redOceanComp);

    const nonRocketBonus = deliveryType === "general" ? 22 : deliveryType === "jet" ? 10 : 0;
    const sourcingScore = Math.min(100, Math.round(priceScore * 1.2 + nonRocketBonus + (saleIndex / 100) * 25 - lowPricePenalty));

    let opportunityScore = Math.round(
      (saleIndex / 100) * 35 +
      (sourcingScore / 100) * 30 +
      ((100 - competitionStrength) / 100) * 35
    );

    let redOceanPenalty = 0;
    if (isExactRed) redOceanPenalty = 25;
    else if (isContainsRed) {
      const nameWords = lowerName.split(" ").filter((w: string) => w.length > 1).length;
      redOceanPenalty = Math.max(8, 22 - nameWords * 2);
    }
    opportunityScore -= redOceanPenalty + lowPricePenalty;
    opportunityScore = Math.max(0, Math.min(100, opportunityScore));

    let grade: "Great" | "Excellent" | "Good" | "Bad";
    if (opportunityScore >= 62 && saleIndex >= 45) grade = "Great";
    else if (opportunityScore >= 57) grade = "Excellent";
    else if (opportunityScore >= 45) grade = "Good";
    else grade = "Bad";

    return {
      ...item,
      deliveryType,
      reviewEnriched,
      calculated: { saleIndex, competitionStrength, sourcingScore, opportunityScore, grade, estimated: !reviewEnriched },
    };
  });

  return scored.sort((a, b) => {
    const s = b.calculated.saleIndex - a.calculated.saleIndex;
    if (s !== 0) return s;
    const o = b.calculated.opportunityScore - a.calculated.opportunityScore;
    if (o !== 0) return o;
    const r = (b.ratingCount || 0) - (a.ratingCount || 0);
    if (r !== 0) return r;
    return (a.rank || 9999) - (b.rank || 9999);
  });
}

function cleanCoupangImageUrl(imageUrl: string): string {
  if (!imageUrl) return "";
  if (imageUrl.includes("thumbnail.coupangcdn.com")) return imageUrl.split("?")[0];
  if (imageUrl.includes("ads-partners.coupang.com")) return imageUrl.split("?")[0];
  return imageUrl.startsWith("//") ? "https:" + imageUrl : imageUrl;
}

// ─── Vercel 핸들러 ───────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const keyword = typeof req.query.keyword === "string" ? req.query.keyword : "";
  const minPrice = Number(req.query.minPrice) || 15000;
  const maxPrice = Number(req.query.maxPrice) || Number.MAX_SAFE_INTEGER;

  if (!keyword) return res.status(400).json({ error: "keyword is required" });

  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return res.status(500).json({
      error: "네이버 API 키가 설정되지 않았습니다. Vercel 환경변수에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET을 등록해주세요.",
    });
  }

  try {
    let coupangData = await fetchCoupangViaNaver(keyword);
    if (coupangData.length === 0) {
      return res.status(500).json({ error: "검색 결과를 가져오지 못했습니다. 잠시 후 다시 시도해주세요." });
    }

    await enrichReviewCounts(coupangData.slice(0, 20));

    let finalResult = filterAndScoreProducts(coupangData, minPrice, maxPrice, keyword);
    finalResult = finalResult.map((p) => ({ ...p, productImage: cleanCoupangImageUrl(p.productImage) }));

    if (finalResult.length === 0) {
      return res.status(200).json({ error: "필터링 후 검색 결과가 없습니다." });
    }

    return res.status(200).json(finalResult);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "서버 오류가 발생했습니다." });
  }
}
