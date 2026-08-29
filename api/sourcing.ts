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
    .slice(0, 200);

  const payload = { seed, seedStat, keywords: related };
  await cacheSet(cacheKey, payload);
  return res.status(200).json(payload);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 쿠팡 상품 분석 — Bright Data Web Unlocker (실시간)
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchViaUnlocker(targetUrl: string): Promise<{ ok: boolean; html?: string; error?: string }> {
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
      return { ok: false, error: `Bright Data Unlocker 오류 (HTTP ${res.status}) ${body.slice(0, 300)}` };
    }
    return { ok: true, html: await res.text() };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Bright Data 호출 실패" };
  }
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

function parseCoupangSearch(html: string): { products: ParsedProduct[]; totalCount: number; diagnostics: string } {
  const products: ParsedProduct[] = [];

  // 총 검색결과 건수 (베스트에포트)
  let totalCount = 0;
  const tc =
    html.match(/검색결과[\s\S]{0,120}?([\d,]{2,12})\s*건/) ||
    html.match(/총\s*<[^>]+>([\d,]+)<[^>]+>\s*건/) ||
    html.match(/"totalCount"\s*:\s*(\d+)/);
  if (tc) totalCount = parseInt(tc[1].replace(/,/g, ""), 10) || 0;

  // 상품 리스트: <li class="search-product ..."> 블록 단위로 분리
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
    let image = pick(/<img[^>]+(?:data-img-src|src)="([^"]+thumbnail[^"]+)"/, block) || pick(/<img[^>]+src="([^"]+)"/, block);
    if (image.startsWith("//")) image = "https:" + image;
    const isAd = /search-product__ad-badge|AdMark|class="ad-badge/i.test(block);
    const lower = block.toLowerCase();
    const deliveryType: ParsedProduct["deliveryType"] =
      /logorocketmerchant|merchant_?rocket|판매자로켓/.test(lower) ? "jet"
      : /logo_rocket|rocket_logo|rocketbadge|badge\.rocket|로켓배송|rocket-fresh|logorocketfresh/.test(lower) ? "rocket"
      : "general";
    rank += 1;
    products.push({
      productId,
      productName: name,
      productPrice: price,
      productUrl: href ? `https://www.coupang.com${href.replace(/&amp;/g, "&")}` : `https://www.coupang.com/vp/products/${productId}`,
      productImage: image,
      rating,
      reviewCount,
      deliveryType,
      rank,
      isAd,
    });
  }

  const diagnostics = products.length === 0
    ? `파싱 결과 0개 — htmlLen=${html.length}, productList마커=${html.includes("productList")}, 차단여부=${/access denied|보안 확인|captcha/i.test(html)}`
    : "";
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

  const cacheKey = `cp:v4:${keyword.replace(/\s+/g, "")}`;
  const cached = await cacheGet(cacheKey);
  let parsed: { products: ParsedProduct[]; totalCount: number } | null = null;
  let servedFrom: "fresh" | "cache" | "stale" = "fresh";

  if (cached && cached.ageMs < 24 * 3600 * 1000) {
    parsed = cached.payload;
    servedFrom = "cache";
  } else {
    const url = `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&channel=user&sorter=scoreDesc&listSize=60`;
    const result = await fetchViaUnlocker(url);
    if (result.ok) {
      const p = parseCoupangSearch(result.html!);
      if (p.products.length > 0) {
        parsed = { products: p.products, totalCount: p.totalCount };
        await cacheSet(cacheKey, parsed);
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

  return res.status(200).json({ keyword, products: withVelocity, market, servedFrom });
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
