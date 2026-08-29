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

// 브랜드/유통사 키워드 제외 목록 (소싱 불가 키워드) — 소문자·공백 제거 기준 부분일치.
// 일반 명사와 겹치는 토큰(예: 캐리어, 레이저, 보스, 대상)은 오탐 방지를 위해 제외했음.
const BRAND_EXCLUDE = [
  // 스포츠/글로벌 패션
  "나이키", "nike", "아디다스", "adidas", "뉴발란스", "newbalance", "푸마", "puma", "리복", "reebok",
  "아식스", "asics", "미즈노", "mizuno", "휠라", "fila", "챔피언", "언더아머", "underarmour",
  "카파", "kappa", "폴로", "polo", "라코스테", "lacoste", "타미힐피거", "tommyhilfiger",
  "캘빈클라인", "calvinklein", "게스", "guess", "리바이스", "levis", "버버리", "burberry",
  "구찌", "gucci", "샤넬", "chanel", "루이비통", "louisvuitton", "프라다", "prada", "디올", "dior",
  "몽클레르", "moncler", "스톤아일랜드", "스케쳐스", "skechers", "크록스", "crocs", "반스", "vans",
  "컨버스", "converse", "뉴에라", "newera", "스투시", "stussy", "커버낫", "covernat", "널디", "nerdy",
  "mlb", "nba", "데상트", "descente", "르꼬끄", "험멜", "hummel", "프로스펙스", "prospecs",
  // 국내 패션/SPA
  "유니클로", "uniqlo", "스파오", "spao", "탑텐", "topten", "지오다노", "giordano", "폴햄", "polham",
  "빈폴", "beanpole", "헤지스", "hazzys", "웨스트우드", "westwood", "프로젝트엠", "projectm",
  "티비제이", "에잇세컨즈", "8seconds", "지프", "jeep", "내셔널지오그래픽", "nationalgeographic",
  "코닥", "kodak", "말본", "malbon", "타이틀리스트", "titleist", "캘러웨이", "callaway",
  "테일러메이드", "taylormade", "오클리", "oakley", "레이밴", "rayban", "젠틀몬스터",
  // 아웃도어/캠핑
  "노스페이스", "northface", "컬럼비아", "columbia", "디스커버리", "discovery", "아이더", "eider",
  "블랙야크", "blackyak", "코오롱", "kolon", "밀레", "millet", "네파", "nepa", "케이투",
  "몽벨", "montbell", "콜핑", "kolping", "트렉스타", "treksta", "레드페이스", "redface", "센터폴",
  "아크테릭스", "arcteryx", "파타고니아", "patagonia", "살로몬", "salomon", "마무트", "mammut",
  "호카", "hoka", "코베아", "kovea", "헬리녹스", "helinox", "스노우피크", "snowpeak",
  "콜맨", "coleman", "노르디스크", "nordisk", "미니멀웍스", "카즈미", "kazmi", "네이처하이크", "naturehike",
  // 뷰티
  "설화수", "헤라", "라네즈", "이니스프리", "미샤", "에뛰드", "클리오", "아이오페", "닥터지",
  "메디힐", "토리든", "라운드랩", "아누아", "닥터자르트", "바닐라코", "에스티로더", "랑콤", "lancome",
  "키엘", "kiehl", "록시땅", "loccitane", "아벤느", "avene", "라로슈포제", "세타필", "cetaphil", "아모레",
  // 식품
  "오뚜기", "농심", "삼양", "풀무원", "비비고", "씨제이", "해태", "롯데", "오리온", "동원",
  "청정원", "샘표", "정관장", "종근당", "광동제약", "코카콜라", "펩시", "델몬트", "서울우유",
  "매일유업", "남양유업", "네스프레소", "nespresso", "스타벅스", "starbucks", "로얄캐닌", "royalcanin",
  // 주방/생활
  "락앤락", "locknlock", "쿠쿠", "cuckoo", "쿠첸", "테팔", "tefal", "해피콜", "키친아트",
  "휘슬러", "fissler", "쿠진아트", "cuisinart", "스탠리", "stanley", "써모스", "thermos",
  "조지루시", "도루코", "크리넥스", "유한킴벌리", "깨끗한나라",
  // 가전/디지털
  "삼성", "samsung", "엘지", "lg전자", "애플", "apple", "아이폰", "iphone", "갤럭시", "galaxy",
  "샤오미", "xiaomi", "필립스", "philips", "소니", "sony", "파나소닉", "panasonic", "다이슨", "dyson",
  "로지텍", "logitech", "razer", "벤큐", "benq", "마샬", "marshall", "브리츠", "britz",
  "벨킨", "belkin", "앤커", "anker", "샌디스크", "sandisk", "캐논", "canon", "니콘", "nikon",
  "레노버", "lenovo", "에이수스", "asus", "위니아", "딤채", "신일전자",
  // 유통/플랫폼/행사
  "다이소", "daiso", "이케아", "ikea", "코스트코", "costco", "이마트", "emart", "홈플러스",
  "쿠팡", "coupang", "지마켓", "gmarket", "11번가", "옥션", "auction", "티몬", "위메프",
  "무신사", "musinsa", "올리브영", "oliveyoung", "알리익스프레스", "aliexpress", "테무", "temu",
  "감사제", "빅세일", "브랜드위크", "브랜드데이",
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

// 월별 시즌 시드 — "그 달에 잘 팔리는" 키워드 기준.
// 소싱→입고→판매까지 1~2개월 걸리므로 UI는 기본으로 다음 달을 선택해 보여준다.
const MONTH_SEEDS: Record<number, string[]> = {
  1: ["방한용품", "다이어리", "홈트용품", "가습기", "설선물세트"],
  2: ["발렌타인초콜릿", "졸업선물", "신학기가방", "새학기문구", "환절기영양제"],
  3: ["신학기용품", "화이트데이선물", "봄원피스", "미세먼지마스크", "봄맞이청소용품"],
  4: ["피크닉용품", "캠핑용품", "등산의류", "선크림", "봄자켓"],
  5: ["어버이날선물", "어린이날선물", "캠핑의자", "선풍기", "여름원피스"],
  6: ["선풍기", "쿨매트", "제습기", "래쉬가드", "장마우산"],
  7: ["물놀이용품", "수영복", "휴가용품", "모기퇴치기", "아이스박스"],
  8: ["신학기가방", "쿨링용품", "책상정리용품", "가을가디건", "환절기이불"],
  9: ["추석선물세트", "가을가디건", "트렌치코트", "등산복", "환절기영양제"],
  10: ["할로윈의상", "가을캠핑용품", "전기장판", "가을부츠", "무릎담요"],
  11: ["김장용품", "패딩", "전기히터", "수능선물", "방한용품"],
  12: ["크리스마스선물", "트리장식", "연말파티용품", "목도리", "핫팩"],
};

async function handleKeywords(req: VercelRequest, res: VercelResponse) {
  const seed = typeof req.query.seed === "string" ? req.query.seed.trim() : "";
  const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
  const monthRaw = typeof req.query.month === "string" ? parseInt(req.query.month, 10) : 0;
  const month = monthRaw >= 1 && monthRaw <= 12 ? monthRaw : 0;
  if (!seed && !category && !month) return res.status(400).json({ error: "seed 키워드, category 또는 month가 필요합니다." });
  if (category && !CATEGORY_SEEDS[category]) return res.status(400).json({ error: "지원하지 않는 카테고리입니다." });
  if (!NAVER_AD_API_KEY || !NAVER_AD_SECRET_KEY || !NAVER_AD_CUSTOMER_ID) {
    return res.status(500).json({
      error:
        "네이버 검색광고 API 키가 설정되지 않았습니다. Vercel 환경변수에 NAVER_AD_API_KEY, NAVER_AD_SECRET_KEY, NAVER_AD_CUSTOMER_ID를 등록해주세요. (searchad.naver.com → 도구 → API 사용관리에서 무료 발급)",
    });
  }

  // 시드 자체가 브랜드 검색이면 브랜드 필터를 끈다 (예: "나이키 운동화")
  const seedIsBrand = !category && !month && isBrandKeyword(seed);
  const applyBrandFilter = (payload: any) =>
    seedIsBrand ? payload : {
      ...payload,
      keywords: (payload.keywords || []).filter((k: any) => !isBrandKeyword(k.keyword)),
    };

  const hints = month ? MONTH_SEEDS[month] : category ? CATEGORY_SEEDS[category] : [seed];
  const cacheKey = month ? `kwmon:${month}` : category ? `kwcat:${category}` : `kw:${seed.replace(/\s+/g, "")}`;
  const ttlMs = (category || month ? 24 : 12) * 3600 * 1000;

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
  const seedStat = category || month ? null : scoredAll.find(k => k.keyword.replace(/\s+/g, "") === seedNorm) || null;
  const related = scoredAll
    .filter(k => category || month || k.keyword.replace(/\s+/g, "") !== seedNorm)
    .sort((a, b) => b.opportunityScore - a.opportunityScore || b.monthlyVolume - a.monthlyVolume)
    .slice(0, 200);

  const payload = { seed: month ? `${month}월 시즌` : category || seed, category: category || null, month: month || null, seedStat, keywords: related };
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
function scoreProducts(parsed: ParsedProduct[], keywordVolume: number, totalCount: number, searchKeyword = "") {
  const organic = parsed.filter(p => !p.isAd);
  // 검색 키워드 자체가 브랜드면 브랜드 표시를 하지 않는다 (의도적 브랜드 조사)
  const searchTargetsBrand = isBrandKeyword(searchKeyword);
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
    const isBrand = !searchTargetsBrand && isBrandKeyword(p.productName);
    return { ...p, isBrand, calculated: { demandScore, entryEase, priceFit, opportunityScore, grade } };
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

const DAILY_LIMIT = 40; // api/usage.ts와 동일한 일일 한도

async function handleProducts(req: VercelRequest, res: VercelResponse, decoded: any) {
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

  let remaining: number | null = null;
  if (cached && cached.ageMs < 24 * 3600 * 1000) {
    parsed = cached.payload;
    servedFrom = "cache";
  } else {
    // 신규 수집(외부 비용 발생)만 일일 사용 한도에 포함 — 캐시 조회는 무료
    if (!decoded?.isAdmin && supabase) {
      try {
        const today = new Date().toISOString().split("T")[0];
        const { data, error } = await supabase.rpc("increment_usage", {
          p_user_id: decoded.userId,
          p_date: today,
          p_limit: DAILY_LIMIT,
        });
        if (!error && data?.exceeded) {
          return res.status(429).json({ error: `하루 ${DAILY_LIMIT}회 호출 한도를 초과했습니다. 내일 다시 이용해주세요. (이미 분석했던 키워드는 캐시로 계속 조회됩니다)` });
        }
        if (!error && typeof data?.remaining === "number") remaining = data.remaining;
      } catch { /* 한도 집계 실패는 기능을 막지 않음 */ }
    }
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

  const { products, market } = scoreProducts(parsed.products, keywordVolume, parsed.totalCount, keyword);
  const velocity = await loadReviewVelocity(products.map(p => p.productId));
  const withVelocity = products.map(p => {
    const v = velocity.get(p.productId);
    return { ...p, reviewGrowthPerDay: v ? v.perDay : null, obsDays: v ? v.days : null };
  });

  return res.status(200).json({
    keyword, products: withVelocity, market, servedFrom,
    ...(remaining !== null ? { remaining } : {}),
    ...(parseDebug ? { parseDebug } : {}),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 관심 키워드 (서버 저장 — 크론 자동 추적의 대상)
// ═══════════════════════════════════════════════════════════════════════════════
async function handleFavorites(req: VercelRequest, res: VercelResponse, decoded: any) {
  if (!supabase) return res.status(500).json({ error: "서버 저장소가 설정되지 않았습니다." });
  const action = typeof req.query.action === "string" ? req.query.action : "list";
  const userId = decoded.userId;

  if (action === "list") {
    const { data, error } = await supabase
      .from("sourcing_favorites")
      .select("keyword, stat")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) return res.status(500).json({ error: "관심 키워드 조회 실패" });
    return res.status(200).json({ favorites: data || [] });
  }

  const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
  if (!keyword) return res.status(400).json({ error: "keyword가 필요합니다." });

  if (action === "add") {
    let stat: any = null;
    try { stat = JSON.parse(String(req.query.stat || "null")); } catch { /* stat 없이도 저장 */ }
    const { error } = await supabase
      .from("sourcing_favorites")
      .upsert({ user_id: userId, keyword, stat });
    if (error) return res.status(500).json({ error: "관심 키워드 저장 실패" });
    return res.status(200).json({ ok: true });
  }
  if (action === "remove") {
    await supabase.from("sourcing_favorites").delete().eq("user_id", userId).eq("keyword", keyword);
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ error: "action=list | add | remove 가 필요합니다." });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 크론: 관심 키워드 자동 재수집 → 리뷰 증가속도(판매속도) 자동 축적
// Vercel Cron이 매일 호출 (vercel.json). 실행당 최대 6개 키워드,
// 20시간 이내 수집된 키워드는 건너뛰므로 비용이 자연히 상한된다.
// ═══════════════════════════════════════════════════════════════════════════════
async function handleCron(req: VercelRequest, res: VercelResponse) {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!supabase || !BRIGHTDATA_API_TOKEN) {
    return res.status(200).json({ ok: false, reason: "supabase 또는 Bright Data 미설정" });
  }

  const { data: favs } = await supabase.from("sourcing_favorites").select("keyword").limit(1000);
  const keywords = [...new Set((favs || []).map(f => String(f.keyword)))];

  let crawled = 0;
  const results: string[] = [];
  for (const kw of keywords) {
    if (crawled >= 6) break; // maxDuration(60s) 내에서 안전한 상한
    const cacheKey = `cp:v5:${kw.replace(/\s+/g, "")}`;
    const cached = await cacheGet(cacheKey);
    if (cached && cached.ageMs < 20 * 3600 * 1000) continue; // 오늘 이미 수집됨
    const url = `https://www.coupang.com/np/search?q=${encodeURIComponent(kw)}&channel=user&sorter=scoreDesc&listSize=60`;
    const result = await fetchViaUnlocker(url, 1);
    if (!result.ok) { results.push(`${kw}: 실패`); continue; }
    const p = parseCoupangSearch(result.html!);
    if (p.products.length >= 5) {
      await cacheSet(cacheKey, { products: p.products, totalCount: p.totalCount });
      await recordObservations(kw, p.products);
      crawled++;
      results.push(`${kw}: ${p.products.length}개`);
    } else {
      results.push(`${kw}: 파싱 ${p.products.length}개`);
    }
  }
  return res.status(200).json({ ok: true, totalFavorites: keywords.length, crawled, results });
}

// ─── 메인 핸들러 ──────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const type = typeof req.query.type === "string" ? req.query.type : "";

  // 크론은 CRON_SECRET으로 자체 인증
  if (type === "cron") return handleCron(req, res);

  // JWT 인증 (외부 남용 시 네이버/Bright Data 비용이 발생하므로 필수)
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  let decoded: any;
  try {
    decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET!);
  } catch {
    return res.status(401).json({ error: "유효하지 않은 토큰입니다. 다시 로그인해주세요." });
  }

  if (type === "keywords") return handleKeywords(req, res);
  if (type === "products") return handleProducts(req, res, decoded);
  if (type === "favorites") return handleFavorites(req, res, decoded);
  return res.status(400).json({ error: "type=keywords | products | favorites 가 필요합니다." });
}
