import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

// ─── 환경변수 ────────────────────────────────────────────────────────────────
const NAVER_CLIENT_ID = (process.env.NAVER_CLIENT_ID || process.env.NAVER_API_CLIENT_ID || "").trim();
const NAVER_CLIENT_SECRET = (process.env.NAVER_CLIENT_SECRET || process.env.NAVER_API_CLIENT_SECRET || "").trim();
const COUPANG_COOKIE = (process.env.COUPANG_COOKIE || "").trim();

// NAVER API HUB(NCP) 이관 대응 — 개발자센터(openapi.naver.com)가 기본값이고,
// HUB로 옮긴 뒤에는 환경변수만 바꿔 붙일 수 있게 호출 정보를 설정으로 뺐다.
const NAVER_API_BASE_URL = (process.env.NAVER_API_BASE_URL || "https://openapi.naver.com").trim().replace(/\/+$/, "");
const NAVER_APIGW_API_KEY_ID = (process.env.NAVER_APIGW_API_KEY_ID || "").trim();
const NAVER_APIGW_API_KEY = (process.env.NAVER_APIGW_API_KEY || "").trim();

function naverAuthHeaders(): Record<string, string> {
  // API HUB용 키가 설정돼 있으면 APIGW 헤더를, 아니면 개발자센터 헤더를 사용한다.
  if (NAVER_APIGW_API_KEY_ID && NAVER_APIGW_API_KEY) {
    return { "X-NCP-APIGW-API-KEY-ID": NAVER_APIGW_API_KEY_ID, "X-NCP-APIGW-API-KEY": NAVER_APIGW_API_KEY };
  }
  return { "X-Naver-Client-Id": NAVER_CLIENT_ID, "X-Naver-Client-Secret": NAVER_CLIENT_SECRET };
}

// 쿠팡은 데이터센터 IP(Vercel iad1·icn1 모두)를 403으로 차단한다.
// 국내 주거용 IP 풀을 제공하는 스크래핑 프록시를 앞단에 두면 우회할 수 있어,
// 업체에 종속되지 않도록 URL 템플릿만 환경변수로 받는다.
//   예) https://api.scraperapi.com/?api_key=KEY&country_code=kr&url={url}
//   {url} 자리에 대상 주소가 URL 인코딩되어 들어간다. {url}이 없으면 뒤에 붙인다.
const SCRAPER_PROXY_URL = (process.env.SCRAPER_PROXY_URL || "").trim();

function viaProxy(target: string): string {
  if (!SCRAPER_PROXY_URL) return target;
  return SCRAPER_PROXY_URL.includes("{url}")
    ? SCRAPER_PROXY_URL.replace("{url}", encodeURIComponent(target))
    : SCRAPER_PROXY_URL + encodeURIComponent(target);
}

function naverConfigured(): boolean {
  return !!((NAVER_CLIENT_ID && NAVER_CLIENT_SECRET) || (NAVER_APIGW_API_KEY_ID && NAVER_APIGW_API_KEY));
}

// ─── 업스트림 호출 진단 ───────────────────────────────────────────────────────
// 검색이 0건으로 끝났을 때 "네이버가 왜 실패했는지"를 구분하기 위해 모든 호출 결과를 기록한다.
interface CallDiag {
  source: "naver-shop" | "naver-datalab" | "coupang-search";
  query?: string;
  sort?: string;
  start?: number;
  status: number;
  errorCode?: string;
  errorMessage?: string;
  count: number;
}

function parseUpstreamError(body: string): { errorCode?: string; errorMessage?: string } {
  try {
    const j = JSON.parse(body);
    return {
      errorCode: j.errorCode || j.rCode || undefined,
      errorMessage: j.errorMessage || j.rMessage || j.message || undefined,
    };
  } catch {
    return { errorMessage: body.slice(0, 200) || undefined };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS (type=products) — 네이버 쇼핑 API → 쿠팡 상품 검색·점수화
// ═══════════════════════════════════════════════════════════════════════════════

interface NaverShopItem {
  title: string; link: string; image: string; lprice: string;
  mallName: string; productId: string; brand: string; maker: string; category1: string;
}

async function searchNaverShopping(
  keyword: string, start = 1, display = 100,
  sort: "sim" | "date" | "asc" | "dsc" = "sim", diags: CallDiag[] = [], retryCount = 0
): Promise<NaverShopItem[]> {
  const url = `${NAVER_API_BASE_URL}/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=${display}&start=${start}&sort=${sort}`;
  try {
    const res = await fetch(url, { headers: naverAuthHeaders() });
    if (res.status === 429 && retryCount < 2) {
      await new Promise(r => setTimeout(r, 600 + retryCount * 800));
      return searchNaverShopping(keyword, start, display, sort, diags, retryCount + 1);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      diags.push({ source: "naver-shop", query: keyword, sort, start, status: res.status, count: 0, ...parseUpstreamError(body) });
      return [];
    }
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    diags.push({ source: "naver-shop", query: keyword, sort, start, status: res.status, count: items.length });
    return items;
  } catch (e: any) {
    diags.push({ source: "naver-shop", query: keyword, sort, start, status: 0, count: 0, errorMessage: e?.message || "fetch failed" });
    return [];
  }
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

// 더 호출해봐야 같은 이유로 실패할 응답들 — 남은 페이지 요청을 중단한다.
function isFatalNaverDiag(d: CallDiag): boolean {
  return d.status === 401 || d.status === 403 || d.status === 404 || d.errorCode === "SE05";
}

async function fetchCoupangViaNaver(keyword: string, diags: CallDiag[]): Promise<any[]> {
  if (!naverConfigured()) return [];
  const queries: { kw: string; sort: "sim" | "date" }[] = [
    { kw: keyword, sort: "sim" }, { kw: `${keyword} 쿠팡`, sort: "sim" }, { kw: keyword, sort: "date" },
  ];
  const pageStarts = [1, 101, 201, 301];
  const allItems: NaverShopItem[] = [];
  outer: for (const q of queries) {
    for (const start of pageStarts) {
      allItems.push(...await searchNaverShopping(q.kw, start, 100, q.sort, diags));
      const last = diags[diags.length - 1];
      // 인증 실패·API 미제공은 재시도해도 동일하므로 즉시 중단(불필요한 12회 왕복 방지)
      if (last && isFatalNaverDiag(last)) break outer;
      // start 값이 허용 범위를 벗어나면 다음 페이지는 더 볼 필요가 없다
      if (last && last.errorCode === "SE03") break;
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

// ─── 상품 소스: 쿠팡 검색 결과 파싱 ──────────────────────────────────────────
// 네이버 쇼핑 검색 API 종료 후의 상품 목록 경로.
// SCRAPER_PROXY_URL 없이 직접 호출하면 쿠팡이 403을 돌려주므로 사실상 프록시 필수.

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).trim();
}

function firstMatch(block: string, patterns: RegExp[]): string | null {
  for (const p of patterns) { const m = block.match(p); if (m) return m[1]; }
  return null;
}

// 쿠팡 검색 HTML은 상품 하나가 data-product-id를 가진 <li>로 반복된다.
// 클래스명이 자주 바뀌므로 항목마다 여러 패턴을 순서대로 시도한다.
function parseCoupangSearchHtml(html: string): { products: any[]; parseNote: string } {
  const blocks = html.split(/<li[^>]*data-product-id=/i).slice(1);
  if (blocks.length === 0) return { products: [], parseNote: "data-product-id 항목을 찾지 못함" };

  const products: any[] = [];
  const seen = new Set<string>();
  for (const [i, chunk] of blocks.entries()) {
    const idMatch = chunk.match(/^["']?(\d+)["']?/);
    if (!idMatch) continue;
    const productId = idMatch[1];
    if (seen.has(productId)) continue;

    const block = chunk.slice(0, 6000);
    const rawName = firstMatch(block, [
      /class="[^"]*\bname\b[^"]*"[^>]*>([^<]+)</i,
      /<img[^>]+alt="([^"]+)"/i,
      /class="[^"]*product-name[^"]*"[^>]*>([^<]+)</i,
    ]);
    const rawPrice = firstMatch(block, [
      /class="[^"]*price-value[^"]*"[^>]*>([\d,]+)/i,
      /class="[^"]*\bprice\b[^"]*"[^>]*>[\s\S]{0,80}?([\d,]{3,})\s*원/i,
      /"salePrice"\s*:\s*(\d+)/i,
    ]);
    if (!rawName || !rawPrice) continue;

    const price = parseInt(rawPrice.replace(/,/g, ""), 10) || 0;
    const name = decodeEntities(rawName);
    if (!name || price <= 0) continue;

    const image = firstMatch(block, [/<img[^>]+src="([^"]+)"/i, /<img[^>]+data-img-src="([^"]+)"/i]) || "";
    const rating = parseFloat(firstMatch(block, [/class="[^"]*\brating\b[^"]*"[^>]*>([\d.]+)/i]) || "0") || 0;
    const ratingCount = parseInt((firstMatch(block, [
      /class="[^"]*rating-total-count[^"]*"[^>]*>\(?([\d,]+)/i,
      /리뷰\s*\(?([\d,]+)/i,
    ]) || "0").replace(/,/g, ""), 10) || 0;

    const isRocketFresh = /로켓프레시/.test(block);
    const isJet = /판매자로켓|로켓그로스/.test(block);
    const isRocket = /로켓배송|badge[^"]*rocket|rocket-logo/i.test(block);
    const deliveryType = isJet ? "jet" : (isRocket || isRocketFresh) ? "rocket" : "general";

    seen.add(productId);
    products.push({
      productId, productName: name, productPrice: price,
      productImage: image.startsWith("//") ? "https:" + image : image,
      productUrl: `https://www.coupang.com/vp/products/${productId}`,
      rating, ratingCount, reviewEnriched: ratingCount > 0,
      isRocket: deliveryType !== "general", deliveryType,
      rank: i + 1, source: "coupang-search", brand: "", category: "",
    });
  }
  return {
    products,
    parseNote: `블록 ${blocks.length}개 중 ${products.length}개 파싱`,
  };
}

async function fetchCoupangSearch(keyword: string, diags: CallDiag[], pages = 2): Promise<any[]> {
  const all: any[] = [];
  const seenIds = new Set<string>();
  for (let page = 1; page <= pages; page++) {
    const target = `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&channel=user&listSize=72&page=${page}`;
    try {
      const res: any = await withTimeout(fetch(viaProxy(target), { headers: BROWSER_HEADERS }) as any, 20000, null);
      if (!res) { diags.push({ source: "coupang-search", query: `page ${page}`, status: 0, count: 0, errorMessage: "timeout(20s)" }); break; }
      const body = await res.text();
      if (!res.ok || /Access Denied|Request Rejected/i.test(body)) {
        diags.push({
          source: "coupang-search", query: `page ${page}`, status: res.status, count: 0,
          errorMessage: SCRAPER_PROXY_URL ? "프록시를 거쳤지만 쿠팡이 차단함" : "쿠팡이 데이터센터 IP를 차단함 (SCRAPER_PROXY_URL 미설정)",
        });
        break;
      }
      const { products, parseNote } = parseCoupangSearchHtml(body);
      diags.push({ source: "coupang-search", query: `page ${page}`, status: res.status, count: products.length, errorMessage: products.length === 0 ? parseNote : undefined });
      if (products.length === 0) break;
      const fresh = products.filter(p => !seenIds.has(p.productId));
      fresh.forEach(p => seenIds.add(p.productId));
      // 같은 목록이 반복되면 더 넘길 페이지가 없다는 뜻
      if (fresh.length === 0) break;
      all.push(...fresh);
    } catch (e: any) {
      diags.push({ source: "coupang-search", query: `page ${page}`, status: 0, count: 0, errorMessage: e?.message || "fetch failed" });
      break;
    }
  }
  return all.map((p, i) => ({ ...p, rank: i + 1 }));
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
    const res = await fetch(viaProxy(url), {
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

// 업스트림 실패 원인을 사용자가 조치할 수 있는 문구로 변환한다.
function describeSearchFailure(diags: CallDiag[]): { status: number; reason: string; error: string } {
  const naver = diags.filter(d => d.source === "naver-shop");
  const coupang = diags.filter(d => d.source === "coupang-search");
  const hasNaverOk = naver.some(d => d.status === 200);

  // 쿠팡이 차단한 경우 — 지금 구조에서 가장 흔한 실패
  const cpBlocked = coupang.find(d => d.status === 403 || d.status === 0);
  if (cpBlocked && !hasNaverOk) {
    return {
      status: 502, reason: SCRAPER_PROXY_URL ? "coupang_blocked_via_proxy" : "coupang_blocked_no_proxy",
      error: SCRAPER_PROXY_URL
        ? "쿠팡이 프록시 요청까지 차단했습니다. 프록시 설정(국가·주거용 IP 옵션)을 확인해주세요."
        : "쿠팡이 서버 IP를 차단해 상품을 가져올 수 없습니다. SCRAPER_PROXY_URL 환경변수에 국내 IP 프록시를 설정해주세요.",
    };
  }
  // 응답은 받았는데 파싱이 0건 — 쿠팡 HTML 구조 변경 신호
  const cpParseFail = coupang.find(d => d.status === 200 && d.count === 0);
  if (cpParseFail) {
    return {
      status: 502, reason: "coupang_parse_failed",
      error: `쿠팡 응답을 받았지만 상품을 추출하지 못했습니다 (${cpParseFail.errorMessage || "구조 변경 의심"}). 파서 점검이 필요합니다.`,
    };
  }

  const unavailable = naver.find(d => d.errorCode === "SE05" || d.status === 404);
  if (unavailable) {
    return {
      status: 502, reason: "naver_shop_api_unavailable",
      error: "네이버 쇼핑 검색 API가 더 이상 제공되지 않습니다 (SE05: 존재하지 않는 검색 api). 상품 검색용 데이터 소스를 다시 연결해야 합니다.",
    };
  }
  if (naver.some(d => d.status === 401 || d.status === 403)) {
    return {
      status: 502, reason: "naver_auth_failed",
      error: "네이버 API 인증에 실패했습니다. Vercel 환경변수의 네이버 키 설정을 확인해주세요.",
    };
  }
  if (naver.some(d => d.status === 429)) {
    return { status: 503, reason: "naver_rate_limited", error: "네이버 API 호출 한도를 초과했습니다. 잠시 후 다시 시도해주세요." };
  }
  if (hasNaverOk) {
    return { status: 200, reason: "no_coupang_items", error: "네이버 검색 결과에 쿠팡 상품이 없습니다. 다른 키워드로 시도해보세요." };
  }
  return { status: 502, reason: "upstream_failed", error: "검색 결과를 가져오지 못했습니다. 잠시 후 다시 시도해주세요." };
}

async function handleProducts(req: VercelRequest, res: VercelResponse) {
  const keyword = typeof req.query.keyword === "string" ? req.query.keyword : "";
  const minPrice = Number(req.query.minPrice) || 15000;
  const maxPrice = Number(req.query.maxPrice) || Number.MAX_SAFE_INTEGER;
  const wantDebug = req.query.debug === "1";
  if (!keyword) return res.status(400).json({ error: "keyword is required" });

  const diags: CallDiag[] = [];
  // 1순위: 쿠팡 검색 결과 직접 수집 (프록시 경유)
  let raw = await fetchCoupangSearch(keyword, diags);
  // 2순위: 네이버 쇼핑 검색 API — 현재 종료 상태지만 복구·이관 시 자동으로 다시 쓰인다
  if (raw.length === 0 && naverConfigured()) raw = await fetchCoupangViaNaver(keyword, diags);

  if (raw.length === 0) {
    const f = describeSearchFailure(diags);
    return res.status(f.status).json({ error: f.error, reason: f.reason, ...(wantDebug ? { debug: diags } : {}) });
  }

  // 쿠팡 검색 결과에는 평점·리뷰수가 이미 들어있다 — 없는 것만 개별 보강
  const needReview = raw.filter(p => !p.reviewEnriched).slice(0, 20);
  if (needReview.length > 0) await enrichReviewCounts(needReview);
  let result = filterAndScore(raw, minPrice, maxPrice, keyword);
  result = result.map(p => ({ ...p, productImage: cleanImageUrl(p.productImage) }));
  if (result.length === 0) {
    return res.status(200).json({ error: "필터링 후 검색 결과가 없습니다.", reason: "filtered_out", ...(wantDebug ? { debug: diags } : {}) });
  }
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
  let trendSource: "naver" | "fallback" = "fallback";
  const trendDiags: CallDiag[] = [];
  if (naverConfigured()) {
    try {
      const today = new Date(); const lastYear = new Date(); lastYear.setFullYear(today.getFullYear() - 1);
      const naverRes = await fetch(`${NAVER_API_BASE_URL}/v1/datalab/search`, {
        method: "POST",
        headers: { ...naverAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: lastYear.toISOString().split("T")[0], endDate: today.toISOString().split("T")[0], timeUnit: "month", keywordGroups: [{ groupName: keyword, keywords: [keyword] }] }),
      });
      if (naverRes.ok) {
        const data = await naverRes.json();
        const results = data.results?.[0]?.data || [];
        trendDiags.push({ source: "naver-datalab", query: keyword, status: naverRes.status, count: results.length });
        if (results.length > 0) {
          trendData = results.map((d: any) => Math.floor(searchVolume * (Math.max(d.ratio, 5) / 100)));
          while (trendData.length < 12) trendData.unshift(Math.floor(searchVolume * 0.3));
          if (trendData.length > 12) trendData = trendData.slice(-12);
          trendSource = "naver";
        }
      } else {
        const body = await naverRes.text().catch(() => "");
        trendDiags.push({ source: "naver-datalab", query: keyword, status: naverRes.status, count: 0, ...parseUpstreamError(body) });
      }
    } catch (e: any) {
      trendDiags.push({ source: "naver-datalab", query: keyword, status: 0, count: 0, errorMessage: e?.message || "fetch failed" });
    }
  }

  if (!trendData || trendData.length === 0) {
    trendData = Array.from({ length: 12 }, (_, i) => Math.floor(searchVolume * (Math.sin((hash + i) * 0.5) * 0.3 + 1) * 0.8));
  }

  const marketTrend = searchVolume > 30000 ? "Volume Burst" : grade === "Excellent" ? "Niche Gold" : "Steady Growth";
  return res.status(200).json({
    keyword, searchVolume, totalProducts, competitionRate: parseFloat(competitionRate), grade,
    averagePrice: baseAvgPrice, minPrice, maxPrice, trendData, trendSource, marketTrend,
    top10VolumeIndex: Math.floor((hash % 30) * 5 + 30),
    ...(req.query.debug === "1" ? { debug: trendDiags } : {}),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIAG (type=diag) — 업스트림 API 상태 점검 (키 값은 노출하지 않음)
// ═══════════════════════════════════════════════════════════════════════════════

async function probeNaver(label: string, url: string, diags: CallDiag[], init?: RequestInit) {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { ...naverAuthHeaders(), ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    });
    const body = await r.text();
    let count = 0;
    try {
      const j = JSON.parse(body);
      count = (j.items || j.results?.[0]?.data || []).length;
    } catch {}
    diags.push({ source: "naver-shop", query: label, status: r.status, count, ...(r.ok ? {} : parseUpstreamError(body)) });
  } catch (e: any) {
    diags.push({ source: "naver-shop", query: label, status: 0, count: 0, errorMessage: e?.message });
  }
}

async function handleDiag(_req: VercelRequest, res: VercelResponse) {
  const diags: CallDiag[] = [];
  const hasNaver = naverConfigured();

  if (hasNaver) {
    // 검색 API 중 어떤 vertical이 남아있는지 확인
    // movie는 이미 종료된 것이 확실한 API — SE05가 "종료" 신호인지 판별하는 대조군
    const q = encodeURIComponent("테스트");
    for (const v of [
      "shop", "blog", "news", "book", "image", "webkr",
      "local", "kin", "cafearticle", "encyc", "doc", "adult", "errata", "movie",
    ]) {
      await probeNaver(`search/${v}.json`, `${NAVER_API_BASE_URL}/v1/search/${v}.json?query=${q}&display=1`, diags);
    }
    // 쇼핑 검색이 "이름만 바뀐" 것인지 확인 — 있을 법한 대체 명칭들
    for (const [label, path] of [
      ["search/shop.xml", `/v1/search/shop.xml?query=${q}&display=1`],
      ["search/shopping.json", `/v1/search/shopping.json?query=${q}&display=1`],
      ["search/product.json", `/v1/search/product.json?query=${q}&display=1`],
      ["search/goods.json", `/v1/search/goods.json?query=${q}&display=1`],
      ["search/shop (확장자 없음)", `/v1/search/shop?query=${q}&display=1`],
      ["v2 search/shop.json", `/v2/search/shop.json?query=${q}&display=1`],
    ] as const) {
      await probeNaver(label, `${NAVER_API_BASE_URL}${path}`, diags);
    }
    // 검색어 트렌드(데이터랩)
    const today = new Date(); const lastMonth = new Date(); lastMonth.setMonth(today.getMonth() - 1);
    await probeNaver("datalab/search (검색어 트렌드)", `${NAVER_API_BASE_URL}/v1/datalab/search`, diags, {
      method: "POST",
      body: JSON.stringify({
        startDate: lastMonth.toISOString().split("T")[0], endDate: today.toISOString().split("T")[0],
        timeUnit: "month", keywordGroups: [{ groupName: "테스트", keywords: ["테스트"] }],
      }),
    });
    // 쇼핑인사이트
    await probeNaver("datalab/shopping/categories (쇼핑인사이트)", `${NAVER_API_BASE_URL}/v1/datalab/shopping/categories`, diags, {
      method: "POST",
      body: JSON.stringify({
        startDate: lastMonth.toISOString().split("T")[0], endDate: today.toISOString().split("T")[0],
        timeUnit: "month", category: [{ name: "패션의류", param: ["50000000"] }],
      }),
    });
  }

  return res.status(200).json({
    env: {
      naverConfigured: hasNaver,
      naverBaseUrl: NAVER_API_BASE_URL,
      naverAuthMode: NAVER_APIGW_API_KEY_ID && NAVER_APIGW_API_KEY ? "apigw (API HUB)" : "client-id/secret (개발자센터)",
      naverIdLength: NAVER_CLIENT_ID.length,
      naverSecretLength: NAVER_CLIENT_SECRET.length,
      coupangCookieConfigured: !!COUPANG_COOKIE,
    },
    calls: diags,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROBE (type=probe) — 쇼핑 검색 API 대체 후보 경로들의 실제 응답 확인
// 쇼핑 검색 API 종료 후 상품 목록을 어디서 가져올 수 있는지 실측하기 위한 임시 도구.
// ═══════════════════════════════════════════════════════════════════════════════

const BROWSER_HEADERS = {
  "User-Agent": UA_LIST[0],
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
  "Upgrade-Insecure-Requests": "1",
};

function analyzeBody(body: string) {
  const productIds = new Set((body.match(/\/vp\/products\/(\d+)/g) || []).map(m => m.split("/").pop()!));
  return {
    bytes: body.length,
    blocked: /Access Denied|보안 확인|Request Rejected|captcha|akamai/i.test(body),
    coupangProductLinks: productIds.size,
    sampleProductId: [...productIds][0] || null,
    snippet: body.slice(0, 160).replace(/\s+/g, " "),
  };
}

async function probeUrl(label: string, url: string, init: RequestInit, out: any[]) {
  const started = Date.now();
  try {
    const r: any = await withTimeout(fetch(url, init) as any, 9000, null);
    if (!r) { out.push({ label, url, status: 0, note: "timeout(9s)" }); return; }
    const body = await r.text();
    out.push({ label, url, status: r.status, contentType: r.headers.get("content-type"), ms: Date.now() - started, ...analyzeBody(body) });
  } catch (e: any) {
    out.push({ label, url, status: 0, ms: Date.now() - started, note: e?.message || "fetch failed" });
  }
}

async function handleProbe(req: VercelRequest, res: VercelResponse) {
  const keyword = (typeof req.query.keyword === "string" && req.query.keyword) || "요가매트";
  const q = encodeURIComponent(keyword);
  const out: any[] = [];

  // A. 살아있는 네이버 검색 vertical로 쿠팡 상품 URL을 건질 수 있는지
  if (naverConfigured()) {
    for (const [label, url] of [
      ["naver webkr (쿠팡)", `${NAVER_API_BASE_URL}/v1/search/webkr.json?query=${encodeURIComponent(keyword + " 쿠팡")}&display=50`],
      ["naver image (쿠팡)", `${NAVER_API_BASE_URL}/v1/search/image.json?query=${encodeURIComponent(keyword + " 쿠팡")}&display=50`],
    ] as const) {
      await probeUrl(label, url, { headers: naverAuthHeaders() }, out);
    }
  }

  // B. 쿠팡 자체 페이지 접근 가능 여부 (직접 / 프록시 경유)
  const cpSearch = `https://www.coupang.com/np/search?q=${q}&channel=user&listSize=72`;
  await probeUrl("coupang 검색 HTML (직접)", cpSearch, { headers: BROWSER_HEADERS }, out);
  await probeUrl("coupang 모바일 검색 (직접)", `https://m.coupang.com/nm/search?q=${q}`, { headers: BROWSER_HEADERS }, out);
  if (SCRAPER_PROXY_URL) {
    await probeUrl("coupang 검색 HTML (프록시)", viaProxy(cpSearch), { headers: BROWSER_HEADERS }, out);
    // 프록시가 뚫렸다면 파서가 실제로 상품을 뽑아내는지까지 확인
    const parseDiags: CallDiag[] = [];
    const parsed = await fetchCoupangSearch(keyword, parseDiags, 1);
    out.push({ label: "파서 결과", parsedProducts: parsed.length, sample: parsed[0] || null, diags: parseDiags });
  }

  // C. 네이버 쇼핑 웹 내부 API
  await probeUrl("네이버쇼핑 웹 내부 API",
    `https://search.shopping.naver.com/api/search/all?query=${q}&pagingIndex=1&pagingSize=40&productSet=total`,
    { headers: { ...BROWSER_HEADERS, Accept: "application/json", Referer: `https://search.shopping.naver.com/search/all?query=${q}` } }, out);

  return res.status(200).json({ keyword, proxyConfigured: !!SCRAPER_PROXY_URL, results: out });
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
  if (type === "diag") return handleDiag(req, res);
  if (type === "probe") return handleProbe(req, res);
  return res.status(400).json({ error: "type=products 또는 type=stats 가 필요합니다." });
}
