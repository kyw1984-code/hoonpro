import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";
import jwt from "jsonwebtoken";

export const config = { maxDuration: 30 };

// ═══════════════════════════════════════════════════════════════════════════════
// 소싱 파인더 API v3 — 네이버 검색광고 API 단독 구성
//
// - 네이버 쇼핑검색 API: 2026-07 서비스 종료
// - 쿠팡 파트너스 API: 계정 이용 불가, 직접 크롤링은 Akamai가 서버 IP 차단
// → 네이버 검색광고 API /keywordstool 만 사용:
//   연관키워드 + 실제 월간검색량(PC/모바일) + 광고경쟁도로
//   "검색량은 많고 경쟁은 적은" 니치 키워드를 발굴한다.
//   쿠팡 로켓 비중 확인은 프론트에서 쿠팡 검색 링크로 연결(사용자 브라우저).
//
// 엔드포인트: ?type=keywords&seed=키워드
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 환경변수 ────────────────────────────────────────────────────────────────
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
  const adDepthScore = Math.min(100, Math.round(adDepth * 6.7)); // 광고 15개 → 100
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
    .slice(0, 200);

  const payload = { seed, seedStat, keywords: related };
  await cacheSet(cacheKey, payload);
  return res.status(200).json(payload);
}

// ─── 메인 핸들러 ──────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // JWT 인증 (외부 남용 시 네이버 API 한도가 소진되므로 필수)
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
  return res.status(400).json({ error: "type=keywords 가 필요합니다." });
}
