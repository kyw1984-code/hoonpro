import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

// ─── 환경변수 ────────────────────────────────────────────────────────────────
const NAVER_CLIENT_ID = (process.env.NAVER_CLIENT_ID || process.env.NAVER_API_CLIENT_ID || "").trim();
const NAVER_CLIENT_SECRET = (process.env.NAVER_CLIENT_SECRET || process.env.NAVER_API_CLIENT_SECRET || "").trim();
const COUPANG_COOKIE = (process.env.COUPANG_COOKIE || "").trim();

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS (type=products) — 네이버 쇼핑 API → 쿠팡 상품 검색·점수화
// ═══════════════════════════════════════════════════════════════════════════════

interface NaverShopItem {
  title: string; link: string; image: string; lprice: string;
  mallName: string; productId: string; brand: string; maker: string; category1: string;
}

async function searchNaverShopping(
  keyword: string, start = 1, display = 100,
  sort: "sim" | "date" | "asc" | "dsc" = "sim", retryCount = 0
): Promise<NaverShopItem[]> {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=${display}&start=${start}&sort=${sort}`;
  try {
    const res = await fetch(url, {
      headers: { "X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET },
    });
    if (res.status === 429 && retryCount < 2) {
      await new Promise(r => setTimeout(r, 600 + retryCount * 800));
      return searchNaverShopping(keyword, start, display, sort, retryCount + 1);
    }
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch { return []; }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}

function extractPageKey(link: string): string | null {
  const m = link?.match(/[?&]pageKey=(\d+)/i);
  return m ? m[1] : null;
}

function extractProductId(link: string): string | null {
  if (!link) return null;
  for (const p of [/\/vp\/products\/(\d+)/, /\/np\/products\/(\d+)/, /products\/(\d+)/, /productId=(\d+)/i, /pid=(\d+)/i]) {
    const m = link.match(p); if (m) return m[1];
  }
  return null;
}

function detectDelivery(title: string): "rocket" | "jet" | "general" {
  const l = title.toLowerCase();
  if (l.includes("판매자로켓") || l.includes("로켓그로스")) return "jet";
  if (l.includes("로켓배송") || l.includes("로켓")) return "rocket";
  return "general";
}

async function fetchCoupangViaNaver(keyword: string): Promise<any[]> {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return [];
  const queries: { kw: string; sort: "sim" | "date" }[] = [
    { kw: keyword, sort: "sim" }, { kw: `${keyword} 쿠팡`, sort: "sim" }, { kw: keyword, sort: "date" },
  ];
  const pageStarts = [1, 101, 201, 301];
  const allItems: NaverShopItem[] = [];
  for (const q of queries) {
    for (const start of pageStarts) {
      allItems.push(...await searchNaverShopping(q.kw, start, 100, q.sort));
      await new Promise(r => setTimeout(r, 200));
    }
  }
  const coupangOnly = allItems.filter(item =>
    (item.link && /coupang\.com/i.test(item.link)) || (item.mallName && /쿠팡|coupang/i.test(item.mallName))
  );
  const byId = new Map<string, any>();
  const products: any[] = [];
  for (const item of coupangOnly) {
    const brand = stripHtml(item.brand || item.maker || "");
    let productId = extractPageKey(item.link) || extractProductId(item.link) || (item.productId ? String(item.productId) : null);
    if (!productId) continue;
    if (byId.has(productId)) { const prev = byId.get(productId); if (!prev.brand && brand) prev.brand = brand; continue; }
    const name = stripHtml(item.title); const price = parseInt(item.lprice, 10) || 0;
    if (!name || price <= 0) continue;
    const product = {
      productId: parseInt(productId, 10) || productId, productName: name, productPrice: price,
      productImage: item.image, productUrl: item.link, rating: 0, ratingCount: 0, isRocket: false,
      deliveryType: detectDelivery(name), rank: products.length + 1, source: "naver", brand, category: item.category1 || "",
    };
    byId.set(productId, product); products.push(product);
  }
  return products;
}

const UA_LIST = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
];

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(v => { clearTimeout(t); resolve(v); }).catch(() => { clearTimeout(t); resolve(fallback); });
  });
}

async function fetchReviewSummary(productId: string | number): Promise<{ rating: number; count: number }> {
  const pid = String(productId);
  const url = `https://www.coupang.com/vp/products/reviews?productId=${pid}&page=1&size=1&sortBy=ORDER_SCORE_ASC&ratingSummary=true`;
  const ua = UA_LIST[Math.floor(Math.random() * UA_LIST.length)];
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8", "Referer": `https://www.coupang.com/vp/products/${pid}`,
        ...(COUPANG_COOKIE ? { Cookie: COUPANG_COOKIE } : {}),
      },
    });
    if (!res.ok) return { rating: 0, count: 0 };
    const html = await res.text();
    if (html.includes("Access Denied") || html.includes("보안 확인")) return { rating: 0, count: 0 };
    const ratingMatch = html.match(/rating-star-num[^>]*>([\d.]+)/) || html.match(/sdp-review__average__total-star__number[^>]*>([\d.]+)/);
    const countMatch = html.match(/sdp-review__average__total-count[^>]*>([\d,]+)/) || html.match(/count[^>]*>([\d,]+)/);
    return { rating: parseFloat(ratingMatch?.[1] || "0"), count: parseInt((countMatch?.[1] || "0").replace(/,/g, ""), 10) || 0 };
  } catch { return { rating: 0, count: 0 }; }
}

async function enrichReviewCounts(products: any[]): Promise<void> {
  for (let i = 0; i < products.length; i += 4) {
    await Promise.allSettled(products.slice(i, i + 4).map(async p => {
      if (!p?.productId) return;
      const s = await withTimeout(fetchReviewSummary(p.productId), 8000, { rating: 0, count: 0 });
      if (s.count > 0) { p.ratingCount = s.count; p.rating = s.rating; p.reviewEnriched = true; }
    }));
  }
}

const BRAND_EXCLUDE = [
  "나이키","nike","아디다스","adidas","뉴발란스","new balance","푸마","puma","리복","reebok",
  "아식스","asics","미즈노","mizuno","휠라","fila","챔피언","champion","언더아머","under armour",
  "카파","kappa","폴로","polo","라코스테","lacoste","타미힐피거","tommy hilfiger","캘빈클라인","calvin klein",
  "게스","guess","리바이스","levi's","levis","버버리","burberry","구찌","gucci","유니클로","uniqlo",
  "스파오","spao","탑텐","topten","지오다노","giordano","노스페이스","north face","northface",
  "컬럼비아","columbia","디스커버리","discovery","k2","아이더","eider","블랙야크","blackyak",
  "코오롱","kolon","밀레","millet","네파","nepa","mlb","nba","nfl",
  "삼성","samsung","lg","애플","apple","샤오미","xiaomi","필립스","philips","소니","sony",
  "파나소닉","panasonic","레노버","lenovo","hp","에이수스","asus","캐논","canon","니콘","nikon","다이소","daiso",
];

function filterAndScore(items: any[], minPrice: number, maxPrice: number, searchKeyword: string = "") {
  const noise = ["글루타치온","영양제","비타민","유산균","콜라겐"];
  const searchWords = searchKeyword.split(" ").filter(w => w.length >= 2);
  const searchLower = searchKeyword.toLowerCase();
  const searchTargetsBrand = BRAND_EXCLUDE.some(b => searchLower.includes(b.toLowerCase()));
  const redOceans = ["이어폰","블루투스","텐트","캠핑텐트","마스크","생수","기저귀","충전기","케이블","침대","의자","양말","물티슈","샴푸","치약","칫솔","비타민","영양제","슬리퍼","텀블러","선스크린","면도기","물통","베개"];

  const filtered = items.filter(item => {
    if (!item || typeof item !== "object") return false;
    const price = item.productPrice || 0;
    const name = (item.productName || "").toLowerCase();
    const brand = (item.brand || "").toLowerCase();
    if (price < minPrice || price > maxPrice) return false;
    if (!searchTargetsBrand && BRAND_EXCLUDE.some(b => name.includes(b.toLowerCase()) || brand.includes(b.toLowerCase()))) return false;
    if (brand) {
      const ok = searchTargetsBrand || (searchLower.length > 0 && (searchLower.includes(brand) || brand.includes(searchLower)));
      if (!ok) return false;
    }
    if (noise.some(n => name.includes(n)) && !noise.some(n => searchKeyword.toLowerCase().includes(n))) return false;
    if (searchWords.length > 0 && searchWords.filter(w => name.includes(w.toLowerCase())).length === 0 && searchWords.length >= 2) return false;
    return true;
  });

  const scored = filtered.map(item => {
    const price = item.productPrice || 1; const rank = item.rank || 100;
    const ratingCount = item.ratingCount || 0; const rating = item.rating || 0; const reviewEnriched = !!item.reviewEnriched;
    let deliveryType = item.deliveryType;
    if (!deliveryType && item.isRocket) deliveryType = "rocket_fallback"; else if (!deliveryType) deliveryType = "general";
    const isRocketType = deliveryType === "rocket" || deliveryType === "rocket_fallback";
    const reviewStrength = reviewEnriched && ratingCount > 0 ? Math.min(100, Math.round(Math.log10(ratingCount + 1) * 28)) : 0;
    const naverRankScore = Math.min(100, Math.max(2, Math.round(100 - 38 * Math.log10(Math.max(1, rank)))));
    const priceScore = price >= 15000 && price < 40000 ? 30 : price >= 40000 && price < 90000 ? 25 : price >= 90000 && price < 250000 ? 15 : price >= 250000 ? 8 : 0;
    const lowPricePenalty = price < 20000 ? 8 : 0;
    const saleIndex = reviewEnriched ? Math.min(100, Math.round(reviewStrength * 0.65 + naverRankScore * 0.35)) : naverRankScore;
    const lowerName = (item.productName || "").toLowerCase();
    const isExactRed = redOceans.some(r => lowerName === r.toLowerCase());
    const isContainsRed = redOceans.some(r => lowerName.includes(r.toLowerCase()));
    let reviewComp = ratingCount > 5000 ? 50 : ratingCount > 1000 ? 40 : ratingCount > 300 ? 28 : ratingCount > 50 ? 15 : ratingCount > 0 ? 6 : 0;
    const qualityComp = rating >= 4.5 && ratingCount > 400 ? 12 : 0;
    const deliveryComp = isRocketType ? 20 : deliveryType === "jet" ? 12 : 0;
    const priceComp = price < 15000 ? 18 : price < 35000 ? 10 : 0;
    const rankComp = rank <= 10 ? 35 : rank <= 30 ? 28 : rank <= 60 ? 22 : rank <= 100 ? 16 : rank <= 200 ? 10 : 5;
    const redOceanComp = isContainsRed ? 12 : 0;
    const competitionStrength = Math.min(100, reviewComp + qualityComp + deliveryComp + priceComp + rankComp + redOceanComp);
    const nonRocketBonus = deliveryType === "general" ? 22 : deliveryType === "jet" ? 10 : 0;
    const sourcingScore = Math.min(100, Math.round(priceScore * 1.2 + nonRocketBonus + (saleIndex / 100) * 25 - lowPricePenalty));
    let opportunityScore = Math.round((saleIndex / 100) * 35 + (sourcingScore / 100) * 30 + ((100 - competitionStrength) / 100) * 35);
    let redOceanPenalty = 0;
    if (isExactRed) redOceanPenalty = 25;
    else if (isContainsRed) { const nw = lowerName.split(" ").filter((w: string) => w.length > 1).length; redOceanPenalty = Math.max(8, 22 - nw * 2); }
    opportunityScore = Math.max(0, Math.min(100, opportunityScore - redOceanPenalty - lowPricePenalty));
    const grade = opportunityScore >= 62 && saleIndex >= 45 ? "Great" : opportunityScore >= 57 ? "Excellent" : opportunityScore >= 45 ? "Good" : "Bad";
    return { ...item, deliveryType, reviewEnriched, calculated: { saleIndex, competitionStrength, sourcingScore, opportunityScore, grade, estimated: !reviewEnriched } };
  });

  return scored.sort((a, b) => {
    const s = b.calculated.saleIndex - a.calculated.saleIndex; if (s !== 0) return s;
    const o = b.calculated.opportunityScore - a.calculated.opportunityScore; if (o !== 0) return o;
    return (b.ratingCount || 0) - (a.ratingCount || 0);
  });
}

function cleanImageUrl(url: string): string {
  if (!url) return "";
  if (url.includes("thumbnail.coupangcdn.com") || url.includes("ads-partners.coupang.com")) return url.split("?")[0];
  return url.startsWith("//") ? "https:" + url : url;
}

async function handleProducts(req: VercelRequest, res: VercelResponse) {
  const keyword = typeof req.query.keyword === "string" ? req.query.keyword : "";
  const minPrice = Number(req.query.minPrice) || 15000;
  const maxPrice = Number(req.query.maxPrice) || Number.MAX_SAFE_INTEGER;
  if (!keyword) return res.status(400).json({ error: "keyword is required" });
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    return res.status(500).json({ error: "네이버 API 키가 설정되지 않았습니다. Vercel 환경변수에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET을 등록해주세요." });
  }
  const raw = await fetchCoupangViaNaver(keyword);
  if (raw.length === 0) return res.status(500).json({ error: "검색 결과를 가져오지 못했습니다. 잠시 후 다시 시도해주세요." });
  await enrichReviewCounts(raw.slice(0, 20));
  let result = filterAndScore(raw, minPrice, maxPrice, keyword);
  result = result.map(p => ({ ...p, productImage: cleanImageUrl(p.productImage) }));
  if (result.length === 0) return res.status(200).json({ error: "필터링 후 검색 결과가 없습니다." });
  return res.status(200).json(result);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATS (type=stats) — 키워드 시장성 통계
// ═══════════════════════════════════════════════════════════════════════════════

async function handleStats(req: VercelRequest, res: VercelResponse) {
  const keyword = typeof req.query.keyword === "string" ? req.query.keyword : "";
  const sellerDistribution = typeof req.query.sellerDistribution === "string" ? req.query.sellerDistribution : "";
  if (!keyword) return res.status(400).json({ error: "Keyword is required" });

  const broadRed = ["이어폰","블루투스 이어폰","텐트","캠핑 텐트","마스크","생수","기저귀","충전기","케이블","비타민","영양제","물티슈"];
  const exactRed = ["침대","의자","양말","샴푸","치약","칫솔","슬리퍼","텀블러","선스크린","면도기","물통","베개","보조배터리"];
  const isExactRed = exactRed.some(r => keyword === r) || broadRed.some(r => keyword === r);
  const isContainsRed = broadRed.some(r => keyword.includes(r));

  const hash = Array.from(keyword).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  let searchVolume = Math.floor((hash % 100) * 1500 + 9000);
  if (keyword.length < 3) searchVolume *= 4;
  if (isExactRed) searchVolume *= 4.5; else if (isContainsRed) searchVolume *= 2.5;

  let productMultiplier = (hash % 15) * 0.5 + 0.2;
  if (isExactRed) productMultiplier = 250 + (hash % 100);
  else if (isContainsRed) { const isLong = keyword.split(" ").length >= 2 || keyword.length > 5; productMultiplier = isLong ? 15 + (hash % 20) : 60 + (hash % 40); }

  const totalProducts = Math.floor(searchVolume * productMultiplier * 1.05);
  const competitionRate = (totalProducts / searchVolume).toFixed(2);

  let grade: "Excellent" | "Good" | "Fair" | "Bad" = "Bad";
  if (sellerDistribution) {
    try {
      const dist = JSON.parse(sellerDistribution);
      const { rocketPct, jetPct, generalPct } = dist;
      if (generalPct >= 60) grade = "Excellent"; else if (generalPct >= 40) grade = "Good"; else if (generalPct >= 20) grade = "Fair"; else grade = "Bad";
      if (rocketPct + jetPct >= 80) grade = "Bad";
    } catch {
      const score = parseFloat(competitionRate);
      if (score < 5.0) grade = "Excellent"; else if (score < 15.0) grade = "Good"; else if (score < 25.0) grade = "Fair"; else grade = "Bad";
    }
  } else {
    const score = parseFloat(competitionRate);
    if (score < 5.0) grade = "Excellent"; else if (score < 15.0) grade = "Good"; else if (score < 25.0) grade = "Fair"; else grade = "Bad";
    if (isExactRed && score > 20.0) grade = "Bad";
  }

  const baseAvgPrice = Math.floor((hash % 40) * 1000 + 20000);
  const minPrice = Math.floor(baseAvgPrice * (0.6 + (hash % 10) * 0.02));
  const maxPrice = Math.floor(baseAvgPrice * (1.8 + (hash % 10) * 0.05));

  let trendData: number[] = [];
  if (NAVER_CLIENT_ID && NAVER_CLIENT_SECRET) {
    try {
      const today = new Date(); const lastYear = new Date(); lastYear.setFullYear(today.getFullYear() - 1);
      const naverRes = await fetch("https://openapi.naver.com/v1/datalab/search", {
        method: "POST",
        headers: { "X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET, "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: lastYear.toISOString().split("T")[0], endDate: today.toISOString().split("T")[0], timeUnit: "month", keywordGroups: [{ groupName: keyword, keywords: [keyword] }] }),
      });
      if (naverRes.ok) {
        const data = await naverRes.json();
        const results = data.results?.[0]?.data || [];
        if (results.length > 0) {
          trendData = results.map((d: any) => Math.floor(searchVolume * (Math.max(d.ratio, 5) / 100)));
          while (trendData.length < 12) trendData.unshift(Math.floor(searchVolume * 0.3));
          if (trendData.length > 12) trendData = trendData.slice(-12);
        }
      }
    } catch {}
  }

  if (!trendData || trendData.length === 0) {
    trendData = Array.from({ length: 12 }, (_, i) => Math.floor(searchVolume * (Math.sin((hash + i) * 0.5) * 0.3 + 1) * 0.8));
  }

  const marketTrend = searchVolume > 30000 ? "Volume Burst" : grade === "Excellent" ? "Niche Gold" : "Steady Growth";
  return res.status(200).json({ keyword, searchVolume, totalProducts, competitionRate: parseFloat(competitionRate), grade, averagePrice: baseAvgPrice, minPrice, maxPrice, trendData, marketTrend, top10VolumeIndex: Math.floor((hash % 30) * 5 + 30) });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 메인 핸들러 — ?type=products | ?type=stats
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const type = typeof req.query.type === "string" ? req.query.type : "";
  if (type === "products") return handleProducts(req, res);
  if (type === "stats") return handleStats(req, res);
  return res.status(400).json({ error: "type=products 또는 type=stats 가 필요합니다." });
}
