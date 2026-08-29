import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";
import jwt from "jsonwebtoken";

export const config = { maxDuration: 60 };

// ═══════════════════════════════════════════════════════════════════════════════
// 소싱 파인더 API v4
//
// 데이터 소스:
//  - 네이버 검색광고 API /keywordstool : 연관키워드 + 실제 월간검색량 + 광고경쟁도
//  - Bright Data Web Unlocker (실시간)  : 쿠팡 검색결과 페이지 1장 →
//      상품명·가격·평점·리뷰수·로켓여부·총 상품수 실데이터
//      (기존 스냅샷 배치 방식은 ~1시간 소요 → 실시간 동기 호출로 교체)
//
// 리뷰 수는 수집 시마다 sourcing_product_obs에 기록해 리뷰 증가속도(≒판매속도)를
// 시간이 지날수록 축적한다. 쿠팡 호출은 키워드당 24h 캐시로 비용을 억제한다.
//
// 엔드포인트: ?type=keywords&seed=… | ?type=products&keyword=…&volume=…
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 환경변수 ────────────────────────────────────────────────────────────────
const NAVER_AD_API_KEY = (process.env.NAVER_AD_API_KEY || "").trim();
const NAVER_AD_SECRET_KEY = (process.env.NAVER_AD_SECRET_KEY || "").trim();
const NAVER_AD_CUSTOMER_ID = (process.env.NAVER_AD_CUSTOMER_ID || "").trim();
const BRIGHTDATA_API_TOKEN = (process.env.BRIGHTDATA_API_TOKEN || "").trim();
const BRIGHTDATA_UNLOCKER_ZONE = (process.env.BRIGHTDATA_UNLOCKER_ZONE || "web_unlocker1").trim();

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

// ─── 캐시 (Supabase sourcing_cache 테이블, 실패해도 기능은 동작) ──────────────
interface CacheHit { payload: any; ageMs: number }

async function cacheGet(key: string): Promise<CacheHit | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("sourcing_cache")
      .select("payload, created_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (!data) return null;
    return { payload: data.payload, ageMs: Date.now() - new Date(data.created_at).getTime() };
  } catch {
    return null;
  }
}

async function cacheSet(key: string, payload: any): Promise<void> {
  if (!supabase) return;
  try {
    await supabase
      .from("sourcing_cache")
      .upsert({ cache_key: key, payload, created_at: new Date().toISOString() });
  } catch {
    /* 캐시 실패는 무시 */
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 네이버 검색광고 API (키워드 도구)
// ═══════════════════════════════════════════════════════════════════════════════
function parseQcCnt(v: any): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "");
  if (s.includes("<")) return 5; // "< 10" → 보수적으로 5
  return parseInt(s.replace(/[^0-9]/g, ""), 10) || 0;
}

async function callKeywordTool(hintKeywords: string[]): Promise<{ ok: boolean; list?: any[]; error?: string }> {
  const timestamp = String(Date.now());
  const path = "/keywordstool";
  const signature = createHmac("sha256", NAVER_AD_SECRET_KEY)
    .update(`${timestamp}.GET.${path}`)
    .digest("base64");
  // 키워드도구는 공백 포함 키워드를 거부하므로 공백 제거, 힌트는 최대 5개
  const hints = hintKeywords.map(k => k.replace(/\s+/g, "")).filter(Boolean).slice(0, 5);
  const url = `https://api.searchad.naver.com${path}?hintKeywords=${encodeURIComponent(hints.join(","))}&showDetail=1`;
  try {
    const res = await fetch(url, {
      headers: {
        "X-Timestamp": timestamp,
        "X-API-KEY": NAVER_AD_API_KEY,
        "X-Customer": NAVER_AD_CUSTOMER_ID,
        "X-Signature": signature,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `네이버 검색광고 API 오류 (HTTP ${res.status}) ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    return { ok: true, list: Array.isArray(data.keywordList) ? data.keywordList : [] };
  } catch (e: any) {
    return { ok: false, error: e?.message || "네이버 검색광고 API 호출 실패" };
  }
}

// 브랜드/유통사 키워드 제외 목록 (소싱 불가 키워드) — 소문자·공백 제거 기준
const BRAND_EXCLUDE = [
  "나이키", "nike", "아디다스", "adidas", "뉴발란스", "newbalance", "푸마", "puma", "리복", "reebok",
  "아식스", "asics", "미즈노", "mizuno", "휠라", "fila", "챔피언", "언더아머", "underarmour",
  "카파", "kappa", "폴로", "polo", "라코스테", "lacoste", "타미힐피거", "tommyhilfiger",
  "캘빈클라인", "calvinklein", "게스", "guess", "리바이스", "levis", "버버리", "burberry",
  "구찌", "gucci", "샤넬", "chanel", "루이비통", "louisvuitton", "프라다", "prada",
  "유니클로", "uniqlo", "스파오", "spao", "탑텐", "topten", "지오다노", "giordano",
  "노스페이스", "northface", "컬럼비아", "columbia", "디스커버리", "discovery",
  "아이더", "eider", "블랙야크", "blackyak", "코오롱", "kolon", "밀레", "millet", "네파", "nepa",
  "mlb", "nba", "코베아", "kovea", "헬리녹스", "helinox", "스노우피크", "snowpeak",
  "삼성", "samsung", "lg전자", "엘지", "애플", "apple", "아이폰", "iphone", "갤럭시", "galaxy",
  "샤오미", "xiaomi", "필립스", "philips", "소니", "sony", "파나소닉", "panasonic",
  "레노버", "lenovo", "에이수스", "asus", "캐논", "canon", "니콘", "nikon", "다이슨", "dyson",
  "다이소", "daiso", "이케아", "ikea", "코스트코", "costco", "이마트", "emart", "홈플러스",
  "쿠팡", "coupang", "지마켓", "gmarket", "11번가", "옥션", "auction", "티몬", "위메프",
  "무신사", "musinsa", "올리브영", "oliveyoung", "알리익스프레스", "aliexpress", "테무", "temu",
  "스타벅스", "starbucks", "락앤락", "locknlock", "쿠쿠", "cuckoo", "쿠첸", "테팔", "tefal",
  "감사제", "빅세일", "브랜드위크",
];

function isBrandKeyword(keyword: string): boolean {
  const norm = keyword.toLowerCase().replace(/\s+/g, "");
  return BRAND_EXCLUDE.some(b => norm.includes(b));
}

const COMP_SCORE: Record<string, number> = { 낮음: 15, 중간: 50, 높음: 85 };

function scoreKeyword(kw: any) {
  const pc = parseQcCnt(kw.monthlyPcQcCnt);
  const mobile = parseQcCnt(kw.monthlyMobileQcCnt);
  const volume = pc + mobile;
  const clicks = Math.round((Number(kw.monthlyAvePcClkCnt) || 0) + (Number(kw.monthlyAveMobileClkCnt) || 0));
  const compIdx: string = kw.compIdx || "중간";
  const compScore = COMP_SCORE[compIdx] ?? 50;
  const adDepth = Number(kw.plAvgDepth) || 0; // 평균 노출 광고 수 — 상업적 경쟁 시그널
  const volumeScore = Math.min(100, Math.round(Math.log10(volume + 1) * 25));
  const adDepthScore = Math.min(100, Math.round(adDepth * 6.7));
  const competition = Math.min(100, Math.round(compScore * 0.7 + adDepthScore * 0.3));
  const opportunityScore = Math.max(0, Math.min(100, Math.round(volumeScore * 0.55 + (100 - competition) * 0.45)));
  const grade =
    opportunityScore >= 72 && volume >= 1000 ? "Great"
    : opportunityScore >= 60 ? "Good"
    : opportunityScore >= 45 ? "Normal"
    : "Bad";
  return {
    keyword: String(kw.relKeyword || ""),
    monthlyPcVolume: pc,
    monthlyMobileVolume: mobile,
    monthlyVolume: volume,
    monthlyClicks: clicks,
    compIdx,
    adDepth,
    volumeScore,
    competition,
    opportunityScore,
    grade,
  };
}

// 쿠팡 대표 카테고리별 시드 키워드 (시드 없이 카테고리 클릭만으로 추천 키워드 제공)
// keywordstool은 호출당 힌트 5개까지 허용 — 5개의 연관 키워드가 합쳐져 반환된다.
const CATEGORY_SEEDS: Record<string, string[]> = {
  "여성패션": ["원피스", "블라우스", "여성가디건", "롱스커트", "여성슬랙스"],
  "남성패션": ["남자반팔티", "남자슬랙스", "맨투맨", "남자셔츠", "남자반바지"],
  "뷰티": ["수분크림", "선크림", "클렌징폼", "마스크팩", "립밤"],
  "출산/유아": ["아기옷", "젖병", "기저귀가방", "아기장난감", "유아식기"],
  "식품": ["견과류", "곤약젤리", "누룽지", "캡슐커피", "간편식"],
  "주방용품": ["프라이팬", "밀폐용기", "주방수납", "조리도구", "텀블러"],
  "생활용품": ["욕실용품", "세탁바구니", "제습제", "옷걸이", "슬리퍼"],
  "홈인테리어": ["무드등", "커튼", "러그", "수납장", "벽선반"],
  "가전디지털": ["무선이어폰", "보조배터리", "가습기", "무선청소기", "휴대폰거치대"],
  "스포츠/레저": ["요가매트", "캠핑의자", "등산가방", "자전거용품", "낚시용품"],
  "자동차용품": ["차량용방향제", "차량용거치대", "세차용품", "차량수납", "차량용충전기"],
  "완구/취미": ["보드게임", "퍼즐", "프라모델", "인형", "물감세트"],
  "문구/오피스": ["다이어리", "볼펜", "데스크정리", "파일철", "스티커"],
  "헬스/건강": ["폼롤러", "마사지볼", "무릎보호대", "닭가슴살", "단백질쉐이크"],
  "반려동물": ["강아지장난감", "고양이용품", "펫방석", "강아지옷", "강아지급식기"],
};

async function handleKeywords(req: VercelRequest, res: VercelResponse) {
  const seed = typeof req.query.seed === "string" ? req.query.seed.trim() : "";
  const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
  if (!seed && !category) return res.status(400).json({ error: "seed 키워드 또는 category가 필요합니다." });
  if (category && !CATEGORY_SEEDS[category]) return res.status(400).json({ error: "지원하지 않는 카테고리입니다." });
  if (!NAVER_AD_API_KEY || !NAVER_AD_SECRET_KEY || !NAVER_AD_CUSTOMER_ID) {
    return res.status(500).json({
      error:
        "네이버 검색광고 API 키가 설정되지 않았습니다. Vercel 환경변수에 NAVER_AD_API_KEY, NAVER_AD_SECRET_KEY, NAVER_AD_CUSTOMER_ID를 등록해주세요. (searchad.naver.com → 도구 → API 사용관리에서 무료 발급)",
    });
  }

  // 시드 자체가 브랜드 검색이면 브랜드 필터를 끈다 (예: "나이키 운동화")
  const seedIsBrand = !category && isBrandKeyword(seed);
  const applyBrandFilter = (payload: any) =>
    seedIsBrand ? payload : {
      ...payload,
      keywords: (payload.keywords || []).filter((k: any) => !isBrandKeyword(k.keyword)),
    };

  const hints = category ? CATEGORY_SEEDS[category] : [seed];
  const cacheKey = category ? `kwcat:${category}` : `kw:${seed.replace(/\s+/g, "")}`;
  const ttlMs = (category ? 24 : 12) * 3600 * 1000;

  const cached = await cacheGet(cacheKey);
  if (cached && cached.ageMs < ttlMs) {
    return res.status(200).json({ ...applyBrandFilter(cached.payload), cached: true });
  }

  const result = await callKeywordTool(hints);
  if (!result.ok) {
    if (cached) return res.status(200).json({ ...applyBrandFilter(cached.payload), cached: true, stale: true });
    return res.status(502).json({ error: result.error });
  }

  const seedNorm = seed.replace(/\s+/g, "");
  const scoredAll = (result.list || []).map(scoreKeyword).filter(k => k.keyword);
  const seedStat = category ? null : scoredAll.find(k => k.keyword.replace(/\s+/g, "") === seedNorm) || null;
  const related = scoredAll
    .filter(k => category || k.keyword.replace(/\s+/g, "") !== seedNorm)
    .sort((a, b) => b.opportunityScore - a.opportunityScore || b.monthlyVolume - a.monthlyVolume)
    .slice(0, 200);

  const payload = { seed: category || seed, category: category || null, seedStat, keywords: related };
  await cacheSet(cacheKey, payload); // 캐시에는 원본 저장, 필터는 응답 시 적용
  return res.status(200).json(applyBrandFilter(payload));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 쿠팡 상품 분석 — Bright Data Web Unlocker (실시간)
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchViaUnlocker(targetUrl: string, retries = 2): Promise<{ ok: boolean; html?: string; error?: string }> {
  let lastError = "Bright Data 호출 실패";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt));
    try {
      const res = await fetch("https://api.brightdata.com/request", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${BRIGHTDATA_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ zone: BRIGHTDATA_UNLOCKER_ZONE, url: targetUrl, format: "raw" }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        lastError = `Bright Data Unlocker 오류 (HTTP ${res.status}) ${body.slice(0, 300)}`;
        if (res.status >= 500 || res.status === 429) continue; // 일시 오류는 재시도
        return { ok: false, error: lastError };
      }
      const html = await res.text();
      // 빈/불완전 응답은 일시 오류로 간주하고 재시도 (정상 페이지는 수백 KB 이상)
      if (!html || html.length < 20000) {
        lastError = `Bright Data 응답이 비정상적으로 작습니다 (len=${html?.length ?? 0}). 잠시 후 다시 시도해주세요.`;
        continue;
      }
      return { ok: true, html };
    } catch (e: any) {
      lastError = e?.message || "Bright Data 호출 실패";
    }
  }
  return { ok: false, error: lastError };
}

function pick(re: RegExp, s: string): string {
  const m = s.match(re);
  return m ? m[1] : "";
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

interface ParsedProduct {
  productId: string;
  productName: string;
  productPrice: number;
  productUrl: string;
  productImage: string;
  rating: number;
  reviewCount: number;
  deliveryType: "rocket" | "jet" | "general";
  rank: number;
  isAd: boolean;
}

function detectDelivery(s: string): ParsedProduct["deliveryType"] {
  const lower = s.toLowerCase();
  if (/logorocketmerchant|merchant_?rocket|seller_?rocket|판매자로켓|rocket_?growth|로켓그로스/.test(lower)) return "jet";
  if (/logo_rocket|rocket_logo|rocketbadge|badge\.rocket|로켓배송|rocket-fresh|logorocketfresh|rocket_wow|로켓와우|"rocket"|rocketdelivery/.test(lower)) return "rocket";
  return "general";
}

function cleanImageUrl(url: string): string {
  if (!url) return "";
  return url.startsWith("//") ? "https:" + url : url;
}

// ⓪ schema.org Product JSON — 쿠팡 신형 페이지에 포함된 표준 상품 구조화 데이터.
//    스크립트 태그 종류와 무관하게 HTML 전체에서 {"@type":"Product"...} 객체를
//    중괄호 균형 스캔으로 직접 추출한다 (마크업 변경에 가장 강함).
function extractBalancedJson(s: string, startIdx: number): string | null {
  let depth = 0, inStr = false, esc = false;
  const limit = Math.min(s.length, startIdx + 30000);
  for (let i = startIdx; i < limit; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return s.slice(startIdx, i + 1); }
    }
  }
  return null;
}

function isProductType(t: any): boolean {
  return t === "Product" || (Array.isArray(t) && t.includes("Product"));
}

function parseJsonLd(html: string): ParsedProduct[] {
  const products: ParsedProduct[] = [];
  const seen = new Set<string>();

  const pushProduct = (node: any) => {
    if (!node || typeof node !== "object" || !isProductType(node["@type"])) return;
    const url = String(node.url ?? "");
    const productId = pick(/\/vp\/products\/(\d+)/, url);
    const name = String(node.name ?? "").trim();
    const price = numFrom(node.offers?.price, node.offers?.lowPrice, node.offers?.highPrice);
    if (!productId || !name || price <= 0 || seen.has(productId)) return;
    seen.add(productId);
    const agg = node.aggregateRating || {};
    products.push({
      productId,
      productName: name,
      productPrice: price,
      productUrl: url.startsWith("http") ? url : `https://www.coupang.com/vp/products/${productId}`,
      productImage: cleanImageUrl(String(node.image ?? "")),
      rating: Number(agg.ratingValue) || 0,
      reviewCount: numFrom(agg.ratingCount, agg.reviewCount),
      deliveryType: "general", // enrichFromHtmlBlocks에서 후보정
      rank: products.length + 1,
      isAd: false,
    });
  };

  const collect = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (node["@type"] === "ItemList" && Array.isArray(node.itemListElement)) {
      node.itemListElement.forEach((e: any) => collect(e?.item ?? e));
      return;
    }
    if (node["@graph"]) { collect(node["@graph"]); return; }
    pushProduct(node);
  };

  // (a) 정식 ld+json 스크립트
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { collect(JSON.parse(m[1])); } catch { /* 잘못된 JSON 블록은 무시 */ }
  }

  // (b) 스크립트 태그와 무관하게 HTML 전체에서 Product 객체 직접 스캔
  if (products.length < 5) {
    for (const m of html.matchAll(/\{\s*"@type"\s*:\s*"Product"/g)) {
      if (products.length >= 200) break;
      const objStr = extractBalancedJson(html, m.index!);
      if (!objStr) continue;
      try { pushProduct(JSON.parse(objStr)); } catch { /* 개별 객체 파싱 실패 무시 */ }
    }
  }
  return products;
}

// JSON에 없는 배송유형/광고 여부(+누락된 리뷰)를 상품 li 블록에서 productId 매칭으로 보강
function enrichFromHtmlBlocks(products: ParsedProduct[], html: string): void {
  const blocks = html.split(/<li[^>]*class="[^"]*ProductUnit_productUnit__/).slice(1);
  const byId = new Map<string, string>();
  for (const b of blocks) {
    const pid = pick(/\/vp\/products\/(\d+)/, b);
    if (pid && !byId.has(pid)) byId.set(pid, b);
  }
  for (const p of products) {
    const b = byId.get(p.productId);
    if (!b) continue;
    p.deliveryType = detectDelivery(b);
    p.isAd = /AdMark_|ad-badge|sponsored/i.test(b);
    if (p.reviewCount === 0 && /rating/i.test(b)) {
      const rc = parseInt((pick(/ProductRating_ratingCount__[^"]*"[^>]*>[\s\S]{0,30}?([\d,]+)/, b) || pick(/\(\s*([\d,]+)\s*\)/, b)).replace(/,/g, ""), 10) || 0;
      if (rc > 0) p.reviewCount = rc;
      const starPct = parseFloat(pick(/width:\s*([\d.]+)%/, b)) || 0;
      if (p.rating === 0 && starPct > 0 && starPct <= 100) p.rating = Math.round((starPct / 20) * 10) / 10;
    }
  }
}

// ① 신형 마크업 (2024~ CSS 모듈: li.ProductUnit_productUnit__*)
function parseProductUnits(html: string): ParsedProduct[] {
  const products: ParsedProduct[] = [];
  const blocks = html.split(/<li[^>]*class="[^"]*ProductUnit_productUnit__/).slice(1);
  let rank = 0;
  for (const block of blocks) {
    const href = pick(/href="(\/vp\/products\/[^"]+)"/, block);
    const productId = pick(/\/vp\/products\/(\d+)/, href || block) || pick(/data-id="(\d+)"/, block);
    if (!productId) continue;
    const name = stripTags(pick(/ProductUnit_productName__[^"]*"[^>]*>([\s\S]*?)<\/div>/, block))
      || stripTags(pick(/<img[^>]+alt="([^"]{4,200})"/, block));
    const price = parseInt(stripTags(pick(/Price_priceValue__[^"]*"[^>]*>([\s\S]*?)<\/strong>/, block)).replace(/[^0-9]/g, ""), 10)
      || parseInt(pick(/"price"\s*:\s*"?([\d,]+)/, block).replace(/,/g, ""), 10) || 0;
    if (!name || price <= 0) continue;
    const starPct = parseFloat(pick(/ProductRating_star__[^"]*"[^>]*width:\s*([\d.]+)%/, block)) || 0;
    const rating = starPct > 0 ? Math.round((starPct / 20) * 10) / 10 : 0;
    const reviewCount = parseInt(pick(/ProductRating_ratingCount__[^"]*"[^>]*>[\s\S]{0,30}?([\d,]+)/, block).replace(/,/g, ""), 10) || 0;
    const image = cleanImageUrl(pick(/<img[^>]+src="([^"]*coupangcdn[^"]+)"/, block) || pick(/<img[^>]+src="([^"]+)"/, block));
    const isAd = /AdMark_|ad-badge|sponsored/i.test(block);
    rank += 1;
    products.push({
      productId,
      productName: name,
      productPrice: price,
      productUrl: href ? `https://www.coupang.com${href.replace(/&amp;/g, "&")}` : `https://www.coupang.com/vp/products/${productId}`,
      productImage: image,
      rating,
      reviewCount,
      deliveryType: detectDelivery(block),
      rank,
      isAd,
    });
  }
  return products;
}

// ② 구형 마크업 (li.search-product)
function parseLegacyMarkup(html: string): ParsedProduct[] {
  const products: ParsedProduct[] = [];
  const blocks = html.split(/<li[^>]*class="search-product[\s"]/).slice(1);
  let rank = 0;
  for (const block of blocks) {
    const href = pick(/href="(\/vp\/products\/[^"]+)"/, block);
    const productId = pick(/data-product-id="(\d+)"/, block) || pick(/\/vp\/products\/(\d+)/, href || block);
    if (!productId) continue;
    const name = stripTags(pick(/class="name"[^>]*>([\s\S]*?)<\//, block));
    const price = parseInt(pick(/class="price-value"[^>]*>([\d,]+)/, block).replace(/,/g, ""), 10) || 0;
    if (!name || price <= 0) continue;
    const rating = parseFloat(pick(/class="rating"[^>]*>([\d.]+)/, block)) || 0;
    const reviewCount = parseInt(pick(/class="rating-total-count"[^>]*>\s*\(?\s*([\d,]+)/, block).replace(/,/g, ""), 10) || 0;
    const image = cleanImageUrl(pick(/<img[^>]+(?:data-img-src|src)="([^"]+thumbnail[^"]+)"/, block) || pick(/<img[^>]+src="([^"]+)"/, block));
    const isAd = /search-product__ad-badge|AdMark|class="ad-badge/i.test(block);
    rank += 1;
    products.push({
      productId,
      productName: name,
      productPrice: price,
      productUrl: href ? `https://www.coupang.com${href.replace(/&amp;/g, "&")}` : `https://www.coupang.com/vp/products/${productId}`,
      productImage: image,
      rating,
      reviewCount,
      deliveryType: detectDelivery(block),
      rank,
      isAd,
    });
  }
  return products;
}

// ③ 내장 JSON (__NEXT_DATA__ 등) — 상품 배열을 재귀 탐색으로 발굴
function numFrom(...vals: any[]): number {
  for (const v of vals) {
    if (typeof v === "number" && v > 0) return v;
    if (typeof v === "string") {
      const n = parseInt(v.replace(/[^0-9]/g, ""), 10);
      if (n > 0) return n;
    }
  }
  return 0;
}

function parseEmbeddedJson(html: string): ParsedProduct[] {
  const scripts: string[] = [];
  const nextData = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextData) scripts.push(nextData[1]);
  for (const s of scripts) {
    let root: any;
    try { root = JSON.parse(s); } catch { continue; }
    const candidates: any[][] = [];
    const walk = (node: any, depth: number) => {
      if (depth > 25 || node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        const good = node.filter(x => x && typeof x === "object" && (x.productId ?? x.id) && (x.productName ?? x.title ?? x.name));
        if (good.length >= 3) candidates.push(good);
        for (const v of node) walk(v, depth + 1);
      } else {
        for (const k of Object.keys(node)) walk(node[k], depth + 1);
      }
    };
    walk(root, 0);
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => b.length - a.length);
    const items = candidates[0];
    const products: ParsedProduct[] = [];
    let rank = 0;
    for (const it of items) {
      const productId = String(it.productId ?? it.id ?? "");
      const name = String(it.productName ?? it.title ?? it.name ?? "").trim();
      const price = numFrom(it.salePrice, it.salesPrice, it.price, it.discountedPrice, it.finalPrice,
        it.priceInfo?.salePrice, it.price?.salePrice, it.price?.value, it.unitPrice);
      if (!productId || !name || price <= 0) continue;
      const itStr = JSON.stringify(it);
      rank += 1;
      products.push({
        productId,
        productName: name,
        productPrice: price,
        productUrl: typeof it.productUrl === "string" && it.productUrl.startsWith("http")
          ? it.productUrl
          : `https://www.coupang.com/vp/products/${productId}`,
        productImage: cleanImageUrl(String(it.imageUrl ?? it.image ?? it.thumbnailUrl ?? it.imagePath ?? "")),
        rating: Number(it.ratingAverage ?? it.rating ?? it.ratingScore ?? 0) || 0,
        reviewCount: numFrom(it.ratingCount, it.reviewCount, it.ratingTotalCount),
        deliveryType: detectDelivery(itStr),
        rank,
        isAd: Boolean(it.isAd || it.adId || it.adProduct),
      });
    }
    if (products.length > 0) return products;
  }
  return [];
}

function parseCoupangSearch(html: string): { products: ParsedProduct[]; totalCount: number; diagnostics: string } {
  // 총 검색결과 건수 (베스트에포트)
  let totalCount = 0;
  const tc =
    html.match(/검색결과[\s\S]{0,120}?([\d,]{2,12})\s*[건개]/) ||
    html.match(/총\s*<[^>]+>([\d,]+)<[^>]+>\s*[건개]/) ||
    html.match(/"totalCount"\s*:\s*(\d+)/) ||
    html.match(/"searchResultCount"\s*:\s*(\d+)/);
  if (tc) totalCount = parseInt(tc[1].replace(/,/g, ""), 10) || 0;

  // schema.org JSON → 신형 마크업 → 구형 마크업 → 내장 JSON 순으로 시도
  let strategy = "jsonld";
  let products = parseJsonLd(html);
  if (products.length > 0) enrichFromHtmlBlocks(products, html);
  if (products.length === 0) { products = parseProductUnits(html); strategy = "productUnit"; }
  if (products.length === 0) { products = parseLegacyMarkup(html); strategy = "legacy"; }
  if (products.length === 0) { products = parseEmbeddedJson(html); strategy = "nextData"; }

  const count = (re: RegExp) => (html.match(re) || []).length;
  let diagnostics = "";
  if (products.length < 5) {
    const idx = html.search(/\{\s*"@type"\s*:\s*"Product"/);
    const excerpt = idx >= 0
      ? html.slice(idx, idx + 500).replace(/\s+/g, " ")
      : (() => { const i2 = html.indexOf("/vp/products/"); return i2 >= 0 ? html.slice(Math.max(0, i2 - 250), i2 + 250).replace(/\s+/g, " ") : html.slice(0, 300); })();
    diagnostics =
      `전략=${strategy}, 상품=${products.length}개 — htmlLen=${html.length}, ` +
      `ldScript=${count(/type="application\/ld\+json"/g)}, ProductJSON=${count(/\{\s*"@type"\s*:\s*"Product"/g)}, ` +
      `ProductUnit=${count(/ProductUnit_productUnit__/g)}, vp링크=${count(/\/vp\/products\/\d+/g)}, ` +
      `차단여부=${/access denied|보안 확인|captcha/i.test(html)}\n[구조 샘플] ${excerpt.slice(0, 450)}`;
  }
  return { products, totalCount, diagnostics };
}

// ─── 리뷰 증가속도 (관측 기록 기반) ───────────────────────────────────────────
async function recordObservations(keyword: string, products: ParsedProduct[]): Promise<void> {
  if (!supabase || products.length === 0) return;
  try {
    await supabase.from("sourcing_product_obs").insert(
      products.map(p => ({
        product_id: p.productId,
        keyword,
        review_count: p.reviewCount,
        price: p.productPrice,
      })),
    );
  } catch {
    /* 관측 기록 실패는 무시 */
  }
}

async function loadReviewVelocity(productIds: string[]): Promise<Map<string, { perDay: number; days: number }>> {
  const map = new Map<string, { perDay: number; days: number }>();
  if (!supabase || productIds.length === 0) return map;
  try {
    const { data } = await supabase
      .from("sourcing_product_obs")
      .select("product_id, review_count, captured_at")
      .in("product_id", productIds)
      .order("captured_at", { ascending: true })
      .limit(3000);
    if (!data) return map;
    const first = new Map<string, { count: number; at: number }>();
    const last = new Map<string, { count: number; at: number }>();
    for (const row of data) {
      const at = new Date(row.captured_at).getTime();
      if (!first.has(row.product_id)) first.set(row.product_id, { count: row.review_count, at });
      last.set(row.product_id, { count: row.review_count, at });
    }
    for (const [pid, f] of first) {
      const l = last.get(pid)!;
      const days = (l.at - f.at) / 86400000;
      if (days >= 2) {
        const delta = Math.max(0, l.count - f.count);
        map.set(pid, { perDay: Math.round((delta / days) * 10) / 10, days: Math.round(days) });
      }
    }
  } catch {
    /* 속도 계산 실패는 무시 */
  }
  return map;
}

// ─── 점수 산출 (실데이터) ─────────────────────────────────────────────────────
function scoreProducts(parsed: ParsedProduct[], keywordVolume: number, totalCount: number) {
  const organic = parsed.filter(p => !p.isAd);
  const total = organic.length;
  const rocketCount = organic.filter(p => p.deliveryType === "rocket").length;
  const jetCount = organic.filter(p => p.deliveryType === "jet").length;
  const generalCount = total - rocketCount - jetCount;
  const rocketRatio = total > 0 ? Math.round((rocketCount / total) * 100) : 0;

  const reviews = organic.map(p => p.reviewCount).sort((a, b) => a - b);
  const medianReviews = reviews.length ? reviews[Math.floor(reviews.length / 2)] : 0;
  const maxReviews = reviews.length ? reviews[reviews.length - 1] : 0;
  const prices = organic.map(p => p.productPrice);
  const avgPrice = prices.length ? Math.round(prices.reduce((s, v) => s + v, 0) / prices.length) : 0;

  const competitionRate =
    keywordVolume > 0 && totalCount > 0 ? Math.round((totalCount / keywordVolume) * 100) / 100 : null;

  const scored = organic.map(p => {
    // 수요 검증: 리뷰 수 로그 스케일 (30개 → 37, 300개 → 62, 3천개 → 87)
    const demandScore = Math.min(100, Math.round(Math.log10(p.reviewCount + 1) * 25));
    // 진입 용이성: 로켓(직매입) 직접경쟁 여부
    const entryEase = p.deliveryType === "rocket" ? 15 : p.deliveryType === "jet" ? 55 : 80;
    const price = p.productPrice;
    const priceFit =
      price >= 15000 && price < 40000 ? 100
      : price >= 40000 && price < 90000 ? 80
      : price >= 8000 && price < 15000 ? 55
      : price >= 90000 && price < 250000 ? 50
      : 25;
    const opportunityScore = Math.round(demandScore * 0.45 + entryEase * 0.35 + priceFit * 0.2);
    const grade =
      opportunityScore >= 68 && p.reviewCount >= 30 ? "Great"
      : opportunityScore >= 55 ? "Good"
      : opportunityScore >= 40 ? "Normal"
      : "Bad";
    return { ...p, calculated: { demandScore, entryEase, priceFit, opportunityScore, grade } };
  });

  scored.sort((a, b) => b.calculated.opportunityScore - a.calculated.opportunityScore || a.rank - b.rank);

  // 시장 판정: 로켓 비중 기본 + 경쟁강도(상품수/검색량)로 보정
  let verdictLevel = rocketRatio <= 25 ? 3 : rocketRatio <= 45 ? 2 : rocketRatio <= 65 ? 1 : 0;
  if (competitionRate !== null) {
    if (competitionRate >= 10) verdictLevel = Math.max(0, verdictLevel - 1);
    else if (competitionRate <= 1.5) verdictLevel = Math.min(3, verdictLevel + 1);
  }
  const entryVerdict = (["Bad", "Fair", "Good", "Excellent"] as const)[verdictLevel];

  const market = {
    totalOnPage: total,
    rocketCount,
    jetCount,
    generalCount,
    rocketRatio,
    totalProducts: totalCount,
    keywordVolume,
    competitionRate,
    medianReviews,
    maxReviews,
    avgPrice,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    entryVerdict,
  };
  return { products: scored, market };
}

async function handleProducts(req: VercelRequest, res: VercelResponse) {
  const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
  const keywordVolume = Number(req.query.volume) || 0;
  if (!keyword) return res.status(400).json({ error: "keyword가 필요합니다." });
  if (!BRIGHTDATA_API_TOKEN) {
    return res.status(500).json({
      error:
        "Bright Data API 토큰이 설정되지 않았습니다. Vercel 환경변수에 BRIGHTDATA_API_TOKEN을 등록하고, brightdata.com 대시보드에서 Web Unlocker 존을 만든 뒤 존 이름을 BRIGHTDATA_UNLOCKER_ZONE에 등록해주세요.",
    });
  }

  const cacheKey = `cp:v5:${keyword.replace(/\s+/g, "")}`;
  const cached = await cacheGet(cacheKey);
  let parsed: { products: ParsedProduct[]; totalCount: number } | null = null;
  let servedFrom: "fresh" | "cache" | "stale" = "fresh";
  let parseDebug = "";

  if (cached && cached.ageMs < 24 * 3600 * 1000) {
    parsed = cached.payload;
    servedFrom = "cache";
  } else {
    const url = `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&channel=user&sorter=scoreDesc&listSize=60`;
    const result = await fetchViaUnlocker(url);
    if (result.ok) {
      const p = parseCoupangSearch(result.html!);
      parseDebug = p.diagnostics;
      if (p.products.length > 0) {
        parsed = { products: p.products, totalCount: p.totalCount };
        // 불완전 파싱(5개 미만)은 캐시하지 않아 재시도가 가능하도록 함
        if (p.products.length >= 5) await cacheSet(cacheKey, parsed);
        await recordObservations(keyword, p.products); // 리뷰속도 히스토리 축적
      } else if (cached) {
        parsed = cached.payload;
        servedFrom = "stale";
      } else {
        return res.status(502).json({ error: `쿠팡 페이지 파싱 실패. ${p.diagnostics}` });
      }
    } else if (cached) {
      parsed = cached.payload;
      servedFrom = "stale";
    } else {
      return res.status(502).json({ error: result.error });
    }
  }

  if (!parsed || parsed.products.length === 0) {
    return res.status(200).json({ keyword, products: [], market: null, error: "검색 결과가 없습니다." });
  }

  const { products, market } = scoreProducts(parsed.products, keywordVolume, parsed.totalCount);
  const velocity = await loadReviewVelocity(products.map(p => p.productId));
  const withVelocity = products.map(p => {
    const v = velocity.get(p.productId);
    return { ...p, reviewGrowthPerDay: v ? v.perDay : null, obsDays: v ? v.days : null };
  });

  return res.status(200).json({ keyword, products: withVelocity, market, servedFrom, ...(parseDebug ? { parseDebug } : {}) });
}

// ─── 메인 핸들러 ──────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // JWT 인증 (외부 남용 시 네이버/Bright Data 비용이 발생하므로 필수)
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  try {
    jwt.verify(auth.slice(7), process.env.JWT_SECRET!);
  } catch {
    return res.status(401).json({ error: "유효하지 않은 토큰입니다. 다시 로그인해주세요." });
  }

  const type = typeof req.query.type === "string" ? req.query.type : "";
  if (type === "keywords") return handleKeywords(req, res);
  if (type === "products") return handleProducts(req, res);
  return res.status(400).json({ error: "type=keywords | products 가 필요합니다." });
}
