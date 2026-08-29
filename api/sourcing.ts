import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";
import jwt from "jsonwebtoken";

export const config = { maxDuration: 30 };

// ═══════════════════════════════════════════════════════════════════════════════
// 소싱 파인더 API v2
//
// 데이터 소스 (네이버 쇼핑검색 API 2026-07 종료에 따른 전면 교체):
//  - 네이버 검색광고 API /keywordstool : 연관키워드 + 실제 월간검색수 + 광고경쟁도
//  - 쿠팡 파트너스 Open API           : 상품 검색 / 카테고리 베스트 (isRocket 실데이터)
//
// 쿠팡 파트너스 검색 API는 시간당 10회 제한이 있으므로 Supabase(sourcing_cache)에
// 응답을 캐시하고, 한도 초과 시 오래된 캐시라도 반환한다.
//
// 엔드포인트: ?type=keywords | ?type=products | ?type=best
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 환경변수 ────────────────────────────────────────────────────────────────
const COUPANG_ACCESS_KEY = (process.env.COUPANG_ACCESS_KEY || "").trim();
const COUPANG_SECRET_KEY = (process.env.COUPANG_SECRET_KEY || "").trim();
const NAVER_AD_API_KEY = (process.env.NAVER_AD_API_KEY || "").trim();
const NAVER_AD_SECRET_KEY = (process.env.NAVER_AD_SECRET_KEY || "").trim();
const NAVER_AD_CUSTOMER_ID = (process.env.NAVER_AD_CUSTOMER_ID || "").trim();

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

// ─── 쿠팡 파트너스 API ────────────────────────────────────────────────────────
function coupangDatetime(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    String(now.getUTCFullYear()).slice(2) + p(now.getUTCMonth() + 1) + p(now.getUTCDate()) +
    "T" + p(now.getUTCHours()) + p(now.getUTCMinutes()) + p(now.getUTCSeconds()) + "Z"
  );
}

interface CoupangResult { ok: boolean; items?: any[]; error?: string; rateLimited?: boolean }

async function callCoupang(path: string, query: string): Promise<CoupangResult> {
  const datetime = coupangDatetime();
  const signature = createHmac("sha256", COUPANG_SECRET_KEY)
    .update(datetime + "GET" + path + query)
    .digest("hex");
  try {
    const res = await fetch(`https://api-gateway.coupang.com${path}${query ? "?" + query : ""}`, {
      headers: {
        Authorization: `CEA algorithm=HmacSHA256, access-key=${COUPANG_ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`,
        "Content-Type": "application/json;charset=UTF-8",
      },
    });
    if (res.status === 429) return { ok: false, rateLimited: true, error: "쿠팡 API 호출 한도 초과" };
    const data = await res.json().catch(() => null);
    if (!data) return { ok: false, error: `쿠팡 API 응답 오류 (HTTP ${res.status})` };
    if (data.rCode !== "0") {
      const msg = String(data.rMessage || "쿠팡 API 오류");
      const rateLimited = /limit|rate|초과|허용/i.test(msg);
      return { ok: false, rateLimited, error: msg };
    }
    const items = Array.isArray(data.data?.productData)
      ? data.data.productData
      : Array.isArray(data.data)
        ? data.data
        : [];
    return { ok: true, items };
  } catch (e: any) {
    return { ok: false, error: e?.message || "쿠팡 API 호출 실패" };
  }
}

function mapCoupangProduct(p: any, index: number) {
  return {
    productId: String(p.productId ?? index),
    productName: String(p.productName ?? ""),
    productPrice: Number(p.productPrice) || 0,
    productImage: String(p.productImage ?? ""),
    productUrl: String(p.productUrl ?? p.landingUrl ?? "#"),
    categoryName: String(p.categoryName ?? ""),
    isRocket: Boolean(p.isRocket),
    isFreeShipping: Boolean(p.isFreeShipping),
    rank: Number(p.rank) || index + 1,
  };
}

// ─── 네이버 검색광고 API (키워드 도구) ────────────────────────────────────────
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

// ─── 점수 산출 ────────────────────────────────────────────────────────────────
const COMP_SCORE: Record<string, number> = { 낮음: 15, 중간: 50, 높음: 85 };

function scoreKeyword(kw: any) {
  const pc = parseQcCnt(kw.monthlyPcQcCnt);
  const mobile = parseQcCnt(kw.monthlyMobileQcCnt);
  const volume = pc + mobile;
  const clicks = Math.round((Number(kw.monthlyAvePcClkCnt) || 0) + (Number(kw.monthlyAveMobileClkCnt) || 0));
  const compIdx: string = kw.compIdx || "중간";
  const compScore = COMP_SCORE[compIdx] ?? 50;
  const adDepth = Number(kw.plAvgDepth) || 0; // 평균 노출 광고 수 (0~15+) — 상업적 경쟁 시그널
  // 검색량 점수: 로그 스케일 (1천 → 75, 1만 → 100)
  const volumeScore = Math.min(100, Math.round(Math.log10(volume + 1) * 25));
  const adDepthScore = Math.min(100, Math.round(adDepth * 6.7)); // 15개 → 100
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

function scoreProducts(items: any[], minPrice: number, maxPrice: number, keywordVolume = 0) {
  const products = items.map(mapCoupangProduct).filter(p => p.productName && p.productPrice > 0);
  const total = products.length;
  const rocketCount = products.filter(p => p.isRocket).length;
  const rocketRatio = total > 0 ? rocketCount / total : 0;

  const inRange = products.filter(p => p.productPrice >= minPrice && p.productPrice <= maxPrice);
  const scored = inRange.map(p => {
    // 노출 점수: 쿠팡 검색/베스트 순위 기반 (1위 100 → 100위 24)
    const exposureScore = Math.min(100, Math.max(5, Math.round(100 - 38 * Math.log10(Math.max(1, p.rank)))));
    // 진입 용이성: 로켓배송(쿠팡 직매입)과의 직접 경쟁 여부가 핵심
    const entryEase = p.isRocket ? 15 : 80;
    // 가격 적합도: 마진 확보 가능한 소싱 스윗스팟
    const price = p.productPrice;
    const priceFit =
      price >= 15000 && price < 40000 ? 100
      : price >= 40000 && price < 90000 ? 80
      : price >= 8000 && price < 15000 ? 55
      : price >= 90000 && price < 250000 ? 50
      : 25;
    const opportunityScore = Math.round(entryEase * 0.4 + exposureScore * 0.35 + priceFit * 0.25);
    const grade =
      opportunityScore >= 70 ? "Great"
      : opportunityScore >= 55 ? "Good"
      : opportunityScore >= 40 ? "Normal"
      : "Bad";
    return { ...p, calculated: { exposureScore, entryEase, priceFit, opportunityScore, grade } };
  });

  scored.sort((a, b) => b.calculated.opportunityScore - a.calculated.opportunityScore || a.rank - b.rank);

  const prices = inRange.map(p => p.productPrice);
  const avgPrice = prices.length ? Math.round(prices.reduce((s, v) => s + v, 0) / prices.length) : 0;
  const market = {
    totalCollected: total,
    inPriceRange: inRange.length,
    rocketCount,
    generalCount: total - rocketCount,
    rocketRatio: Math.round(rocketRatio * 100),
    avgPrice,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    keywordVolume,
    // 시장 진입 판정: 로켓(쿠팡 직매입) 비중이 낮을수록 위탁/사입 셀러 기회
    entryVerdict:
      rocketRatio <= 0.3 ? "Excellent"
      : rocketRatio <= 0.5 ? "Good"
      : rocketRatio <= 0.7 ? "Fair"
      : "Bad",
  };
  return { products: scored, market };
}

// ─── 핸들러: 키워드 발굴 ──────────────────────────────────────────────────────
async function handleKeywords(req: VercelRequest, res: VercelResponse) {
  const seed = typeof req.query.seed === "string" ? req.query.seed.trim() : "";
  if (!seed) return res.status(400).json({ error: "seed 키워드가 필요합니다." });
  if (!NAVER_AD_API_KEY || !NAVER_AD_SECRET_KEY || !NAVER_AD_CUSTOMER_ID) {
    return res.status(500).json({
      error:
        "네이버 검색광고 API 키가 설정되지 않았습니다. Vercel 환경변수에 NAVER_AD_API_KEY, NAVER_AD_SECRET_KEY, NAVER_AD_CUSTOMER_ID를 등록해주세요. (searchad.naver.com → 도구 → API 사용관리에서 무료 발급)",
    });
  }

  const cacheKey = `kw:${seed.replace(/\s+/g, "")}`;
  const cached = await cacheGet(cacheKey);
  if (cached && cached.ageMs < 12 * 3600 * 1000) {
    return res.status(200).json({ ...cached.payload, cached: true });
  }

  const result = await callKeywordTool([seed]);
  if (!result.ok) {
    if (cached) return res.status(200).json({ ...cached.payload, cached: true, stale: true });
    return res.status(502).json({ error: result.error });
  }

  const seedNorm = seed.replace(/\s+/g, "");
  const scoredAll = (result.list || []).map(scoreKeyword).filter(k => k.keyword);
  const seedStat = scoredAll.find(k => k.keyword.replace(/\s+/g, "") === seedNorm) || null;
  const related = scoredAll
    .filter(k => k.keyword.replace(/\s+/g, "") !== seedNorm)
    .sort((a, b) => b.opportunityScore - a.opportunityScore || b.monthlyVolume - a.monthlyVolume)
    .slice(0, 150);

  const payload = { seed, seedStat, keywords: related };
  await cacheSet(cacheKey, payload);
  return res.status(200).json(payload);
}

// ─── 핸들러: 쿠팡 상품 분석 ───────────────────────────────────────────────────
async function handleProducts(req: VercelRequest, res: VercelResponse) {
  const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
  const minPrice = Number(req.query.minPrice) || 0;
  const maxPrice = Number(req.query.maxPrice) || Number.MAX_SAFE_INTEGER;
  const keywordVolume = Number(req.query.volume) || 0;
  if (!keyword) return res.status(400).json({ error: "keyword가 필요합니다." });
  if (!COUPANG_ACCESS_KEY || !COUPANG_SECRET_KEY) {
    return res.status(500).json({
      error:
        "쿠팡 파트너스 API 키가 설정되지 않았습니다. Vercel 환경변수에 COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY를 등록해주세요. (partners.coupang.com → 추가기능 → Open API)",
    });
  }

  const cacheKey = `cp:search:${keyword}`;
  const cached = await cacheGet(cacheKey);
  let items: any[] | null = null;
  let servedFrom: "fresh" | "cache" | "stale" = "fresh";

  if (cached && cached.ageMs < 24 * 3600 * 1000) {
    items = cached.payload;
    servedFrom = "cache";
  } else {
    const path = "/v2/providers/affiliate_open_api/apis/openapi/products/search";
    const query = `keyword=${encodeURIComponent(keyword)}&limit=100`;
    const result = await callCoupang(path, query);
    if (result.ok) {
      items = result.items!;
      await cacheSet(cacheKey, items);
    } else if (cached) {
      items = cached.payload; // 한도 초과 등 → 오래된 캐시라도 제공
      servedFrom = "stale";
    } else if (result.rateLimited) {
      return res.status(429).json({
        error: "쿠팡 파트너스 검색 API 호출 한도(시간당 10회)를 초과했습니다. 잠시 후 다시 시도해주세요. 이미 검색했던 키워드는 캐시에서 바로 조회됩니다.",
      });
    } else {
      return res.status(502).json({ error: result.error });
    }
  }

  if (!items || items.length === 0) {
    return res.status(200).json({ products: [], market: null, error: "검색 결과가 없습니다." });
  }

  const { products, market } = scoreProducts(items, minPrice, maxPrice, keywordVolume);
  return res.status(200).json({ keyword, products, market, servedFrom });
}

// ─── 핸들러: 카테고리 베스트셀러 ──────────────────────────────────────────────
const BEST_CATEGORY_IDS = new Set([
  "1001", "1002", "1010", "1011", "1012", "1013", "1014", "1015", "1016",
  "1017", "1018", "1019", "1020", "1021", "1024", "1025", "1026", "1029", "1030",
]);

async function handleBest(req: VercelRequest, res: VercelResponse) {
  const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : "";
  if (!BEST_CATEGORY_IDS.has(categoryId)) {
    return res.status(400).json({ error: "유효한 categoryId가 필요합니다." });
  }
  if (!COUPANG_ACCESS_KEY || !COUPANG_SECRET_KEY) {
    return res.status(500).json({ error: "쿠팡 파트너스 API 키가 설정되지 않았습니다. (COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY)" });
  }

  const cacheKey = `cp:best:${categoryId}`;
  const cached = await cacheGet(cacheKey);
  let items: any[] | null = null;
  let servedFrom: "fresh" | "cache" | "stale" = "fresh";

  if (cached && cached.ageMs < 12 * 3600 * 1000) {
    items = cached.payload;
    servedFrom = "cache";
  } else {
    const path = `/v2/providers/affiliate_open_api/apis/openapi/products/bestcategories/${categoryId}`;
    const result = await callCoupang(path, "limit=100");
    if (result.ok) {
      items = result.items!;
      await cacheSet(cacheKey, items);
    } else if (cached) {
      items = cached.payload;
      servedFrom = "stale";
    } else {
      return res.status(502).json({ error: result.error });
    }
  }

  if (!items || items.length === 0) {
    return res.status(200).json({ products: [], market: null, error: "베스트 상품이 없습니다." });
  }

  const { products, market } = scoreProducts(items, 0, Number.MAX_SAFE_INTEGER);
  return res.status(200).json({ categoryId, products, market, servedFrom });
}

// ─── 메인 핸들러 ──────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // JWT 인증 (외부 남용 시 쿠팡/네이버 API 한도가 소진되므로 필수)
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
  if (type === "best") return handleBest(req, res);
  return res.status(400).json({ error: "type=keywords | products | best 가 필요합니다." });
}
