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
const NAVER_DATALAB_CLIENT_ID = (process.env.NAVER_DATALAB_CLIENT_ID || "").trim();
const NAVER_DATALAB_CLIENT_SECRET = (process.env.NAVER_DATALAB_CLIENT_SECRET || "").trim();
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

// 힌트는 호출당 최대 5개 — 초과분은 나눠 호출해 병합하고 중복 연관 키워드를 제거
async function callKeywordToolMerged(hints: string[]): Promise<{ ok: boolean; list: any[]; error?: string }> {
  const chunks: string[][] = [];
  for (let i = 0; i < hints.length; i += 5) chunks.push(hints.slice(i, i + 5));
  const merged: any[] = [];
  let err = "";
  for (const chunk of chunks) {
    const r = await callKeywordTool(chunk);
    if (r.ok) merged.push(...(r.list || []));
    else err = r.error || "네이버 검색광고 API 호출 실패";
  }
  const seen = new Set<string>();
  const list = merged.filter(item => {
    const k = String(item?.relKeyword || "");
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ok: list.length > 0, list, error: err };
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

// 카테고리별 관련성 어휘 — 네이버 키워드도구는 힌트와 무관한 인기 광고 키워드
// (예: 여성패션 시드에 블루투스이어폰)를 섞어 주므로, 결과 키워드가 시드 또는
// 아래 어휘 중 하나를 포함할 때만 통과시킨다.
const CATEGORY_VOCAB: Record<string, string[]> = {
  "여성패션": ["원피스", "블라우스", "가디건", "스커트", "치마", "슬랙스", "팬츠", "바지", "니트", "티셔츠", "셔츠", "자켓", "재킷", "코트", "패딩", "후드", "맨투맨", "조끼", "레깅스", "나시", "여성", "여자", "빅사이즈"],
  "남성패션": ["남자", "남성", "맨투맨", "셔츠", "슬랙스", "반팔", "긴팔", "티셔츠", "후드", "자켓", "코트", "패딩", "바지", "청바지", "조끼", "니트", "반바지", "정장", "넥타이", "벨트"],
  "뷰티": ["크림", "세럼", "에센스", "로션", "토너", "스킨", "클렌징", "폼", "팩", "선크림", "립", "틴트", "쿠션", "파운데이션", "섀도", "마스카라", "향수", "헤어", "바디", "미스트", "앰플", "필링", "밤"],
  "출산/유아": ["아기", "유아", "신생아", "젖병", "기저귀", "분유", "이유식", "아동", "키즈", "출산", "임산부", "유모차", "카시트", "턱받이", "쪽쪽이", "장난감", "물티슈"],
  "식품": ["견과", "젤리", "누룽지", "커피", "간편식", "즉석", "곤약", "쌀", "라면", "과자", "스낵", "음료", "두유", "고기", "닭", "소고기", "돼지", "과일", "김치", "반찬", "밀키트", "시리얼", "꿀", "잼", "빵", "떡"],
  "주방용품": ["프라이팬", "팬", "냄비", "밀폐용기", "용기", "수납", "조리", "주방", "텀블러", "컵", "그릇", "접시", "수저", "젓가락", "칼", "도마", "믹서", "주전자", "보온", "보냉", "식기", "수세미", "행주"],
  "생활용품": ["욕실", "세탁", "제습", "옷걸이", "슬리퍼", "수건", "타월", "휴지", "청소", "세제", "방향제", "탈취", "정리함", "바구니", "매트", "커버", "빨래", "건조대", "우산", "면봉", "화장지", "위생"],
  "홈인테리어": ["무드등", "조명", "커튼", "러그", "카페트", "수납장", "선반", "액자", "쿠션", "이불", "베개", "침구", "매트리스", "토퍼", "블라인드", "스탠드", "화분", "인테리어", "거울", "시계", "디퓨저", "캔들"],
  "가전디지털": ["이어폰", "헤드폰", "충전기", "보조배터리", "가습기", "청소기", "케이블", "거치대", "스피커", "키보드", "마우스", "모니터", "선풍기", "히터", "공기청정기", "드라이기", "면도기", "전기", "무선", "워치", "태블릿", "노트북", "카메라"],
  "스포츠/레저": ["요가", "매트", "캠핑", "등산", "자전거", "낚시", "헬스", "운동", "골프", "수영", "배드민턴", "테니스", "축구", "농구", "러닝", "트레킹", "텐트", "타프", "침낭", "스포츠", "레저"],
  "자동차용품": ["차량", "자동차", "차량용", "세차", "블랙박스", "네비", "타이어", "와이퍼", "주차", "트렁크", "핸들", "시트", "카"],
  "완구/취미": ["보드게임", "퍼즐", "프라모델", "인형", "물감", "장난감", "레고", "블록", "피규어", "색칠", "뜨개", "자수", "미니어처", "드론", "게임", "취미"],
  "문구/오피스": ["다이어리", "볼펜", "펜", "노트", "파일", "스티커", "데스크", "오피스", "문구", "형광펜", "샤프", "지우개", "메모", "포스트잇", "클립", "가위", "테이프", "달력", "플래너", "북"],
  "헬스/건강": ["폼롤러", "마사지", "보호대", "닭가슴살", "단백질", "프로틴", "쉐이크", "홍삼", "비타민", "영양제", "유산균", "오메가", "루테인", "콜라겐", "다이어트", "헬스", "찜질", "파스", "안마", "건강"],
  "반려동물": ["강아지", "고양이", "펫", "반려", "애견", "캣", "사료", "배변", "하네스", "목줄", "스크래처", "캣타워", "급식기", "급수기", "동물"],
};

// 월별 시즌 시드 — "그 달에 잘 팔리는" 키워드 기준.
// 소싱→입고→판매까지 1~2개월 걸리므로 UI는 기본으로 다음 달을 선택해 보여준다.
const MONTH_SEEDS: Record<number, string[]> = {
  1: ["방한용품", "다이어리", "홈트용품", "가습기", "설선물세트", "핫팩", "기모바지", "전기요", "목도리", "수면잠옷"],
  2: ["발렌타인초콜릿", "졸업선물", "신학기가방", "새학기문구", "환절기영양제", "꽃다발", "입학선물", "필통", "노트북가방", "텀블러"],
  3: ["신학기용품", "화이트데이선물", "봄원피스", "미세먼지마스크", "봄맞이청소용품", "봄자켓", "공기청정기", "운동화", "도시락통", "트렌치코트"],
  4: ["피크닉용품", "캠핑용품", "등산의류", "선크림", "봄자켓", "돗자리", "나들이가방", "캠핑테이블", "자외선차단모자", "원피스"],
  5: ["어버이날선물", "어린이날선물", "캠핑의자", "선풍기", "여름원피스", "카네이션", "홍삼선물세트", "키즈장난감", "반팔티", "샌들"],
  6: ["선풍기", "쿨매트", "제습기", "래쉬가드", "장마우산", "냉감이불", "서큘레이터", "여름슬리퍼", "모기장", "넥쿨러"],
  7: ["물놀이용품", "수영복", "휴가용품", "모기퇴치기", "아이스박스", "캠핑선풍기", "튜브", "비치타올", "여행용파우치", "샌들"],
  8: ["신학기가방", "쿨링용품", "책상정리용품", "가을가디건", "환절기이불", "학용품세트", "노트북받침대", "물통", "실내화", "백팩"],
  9: ["추석선물세트", "가을가디건", "트렌치코트", "등산복", "환절기영양제", "니트", "가을이불", "캠핑난로", "가을운동화", "홍삼"],
  10: ["할로윈의상", "가을캠핑용품", "전기장판", "가을부츠", "무릎담요", "니트원피스", "핫팩", "가습기", "히터", "등산스틱"],
  11: ["김장용품", "패딩", "전기히터", "수능선물", "방한용품", "김치통", "기모레깅스", "목도리", "온수매트", "장갑"],
  12: ["크리스마스선물", "트리장식", "연말파티용품", "목도리", "핫팩", "방한부츠", "새해달력", "무드등", "장식전구", "니트"],
};

// 월별 관련성 어휘 (CATEGORY_VOCAB과 같은 용도)
const MONTH_VOCAB: Record<number, string[]> = {
  1: ["방한", "다이어리", "홈트", "가습기", "설", "선물세트", "핫팩", "히터", "장갑", "목도리", "내복", "수면", "기모"],
  2: ["발렌타인", "초콜릿", "졸업", "신학기", "새학기", "문구", "책가방", "환절기", "입학", "꽃다발"],
  3: ["신학기", "입학", "화이트데이", "봄", "미세먼지", "마스크", "청소", "원피스", "황사", "사탕"],
  4: ["피크닉", "캠핑", "등산", "선크림", "봄", "자외선", "나들이", "돗자리", "자켓"],
  5: ["어버이날", "어린이날", "카네이션", "선물", "캠핑", "선풍기", "여름", "원피스", "스승"],
  6: ["선풍기", "쿨", "냉감", "제습", "래쉬가드", "장마", "우산", "여름", "아이스", "모기"],
  7: ["물놀이", "수영", "휴가", "모기", "아이스", "쿨", "여름", "캠핑", "튜브", "비치", "샌들"],
  8: ["신학기", "새학기", "가을", "쿨", "책상", "정리", "이불", "환절기", "가디건", "책가방"],
  9: ["추석", "선물세트", "가을", "가디건", "트렌치", "등산", "환절기", "긴팔", "니트"],
  10: ["할로윈", "가을", "캠핑", "전기장판", "부츠", "담요", "단풍", "등산", "니트", "기모"],
  11: ["김장", "패딩", "히터", "수능", "방한", "장갑", "전기", "난방", "내복", "목도리", "기모"],
  12: ["크리스마스", "트리", "연말", "파티", "목도리", "핫팩", "선물", "장갑", "방한", "새해", "달력"],
};

// 결과 키워드가 시드/어휘 중 하나를 포함하는지 (공백·대소문자 무시)
const buildRelevanceCheck = (tokens: string[]) => {
  const norm = tokens.map(t => t.toLowerCase().replace(/\s+/g, "")).filter(Boolean);
  return (kw: string) => {
    const k = kw.toLowerCase().replace(/\s+/g, "");
    return norm.some(t => k.includes(t));
  };
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

  // 카테고리/월별 모드: 키워드도구가 섞어 주는 무관한 인기 키워드 제거
  // (캐시에는 원본을 두고 응답 시 필터 — 어휘를 고쳐도 캐시 무효화가 필요 없다)
  const relevanceTokens = month
    ? [...MONTH_SEEDS[month], ...(MONTH_VOCAB[month] || [])]
    : category
      ? [...CATEGORY_SEEDS[category], ...(CATEGORY_VOCAB[category] || [])]
      : null;
  const applyFilters = (payload: any) => {
    let out = applyBrandFilter(payload);
    if (relevanceTokens) {
      const isRelevant = buildRelevanceCheck(relevanceTokens);
      const filtered = (out.keywords || []).filter((k: any) => isRelevant(k.keyword));
      // 과필터로 결과가 너무 줄면 원본 유지 (없는 것보단 낫다)
      if (filtered.length >= 15) out = { ...out, keywords: filtered };
    }
    return out;
  };

  const hints = month ? MONTH_SEEDS[month] : category ? CATEGORY_SEEDS[category] : [seed];
  const cacheKey = month ? `kwmon:${month}` : category ? `kwcat:${category}` : `kw:${seed.replace(/\s+/g, "")}`;
  const ttlMs = (category || month ? 24 : 12) * 3600 * 1000;

  const cached = await cacheGet(cacheKey);
  if (cached && cached.ageMs < ttlMs) {
    return res.status(200).json({ ...applyFilters(cached.payload), cached: true });
  }

  const merged = await callKeywordToolMerged(hints);
  if (!merged.ok) {
    if (cached) return res.status(200).json({ ...applyFilters(cached.payload), cached: true, stale: true });
    return res.status(502).json({ error: merged.error || "연관 키워드가 없습니다." });
  }
  const list = merged.list;

  const seedNorm = seed.replace(/\s+/g, "");
  const scoredAll = list.map(scoreKeyword).filter(k => k.keyword);
  const seedStat = category || month ? null : scoredAll.find(k => k.keyword.replace(/\s+/g, "") === seedNorm) || null;
  const related = scoredAll
    .filter(k => category || month || k.keyword.replace(/\s+/g, "") !== seedNorm)
    .sort((a, b) => b.opportunityScore - a.opportunityScore || b.monthlyVolume - a.monthlyVolume)
    .slice(0, 200);

  const payload = { seed: month ? `${month}월 시즌` : category || seed, category: category || null, month: month || null, seedStat, keywords: related };
  await cacheSet(cacheKey, payload); // 캐시에는 원본 저장, 필터는 응답 시 적용
  return res.status(200).json(applyFilters(payload));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 네이버 데이터랩 검색어 트렌드 — 월별 계절성 분석
// ratio는 요청 구간 내 상대값(최고점=100)이므로 계절성(어느 달에 뜨는지) 판단 전용.
// 절대 검색량은 검색광고 API 값을 그대로 쓴다.
// ═══════════════════════════════════════════════════════════════════════════════

function analyzeSeasonality(keyword: string, series: { period: string; ratio: number }[]) {
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  series.forEach(({ period, ratio }) => {
    const m = parseInt(String(period).slice(5, 7), 10);
    if (m >= 1 && m <= 12) byMonth[m - 1].push(ratio);
  });
  const monthlyAvg = byMonth.map(list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0));
  const maxAvg = Math.max(...monthlyAvg);
  const positives = monthlyAvg.filter(v => v > 0);
  const minAvg = positives.length ? Math.min(...positives) : 0;
  // 피크: 최고 월 평균의 85% 이상인 달들
  const peakMonths = monthlyAvg
    .map((v, i) => ({ m: i + 1, v }))
    .filter(x => maxAvg > 0 && x.v >= maxAvg * 0.85)
    .map(x => x.m);
  // 계절성 강도: 피크월/바닥월 비율 (1.0 = 계절성 없음)
  const seasonality = minAvg > 0 ? Math.round((maxAvg / minAvg) * 10) / 10 : 0;
  return { keyword, series, monthlyAvg: monthlyAvg.map(v => Math.round(v * 10) / 10), peakMonths, seasonality };
}

// 데이터랩 트렌드 조회 (7일 캐시, 5개씩 나눠 호출) — handleTrend와 브리핑이 공용
async function getTrendData(keywords: string[]): Promise<{ trends: any[]; error?: string }> {
  const TTL = 7 * 24 * 3600 * 1000;
  const results: Record<string, any> = {};
  const missing: string[] = [];
  for (const kw of keywords) {
    const cached = await cacheGet(`trend:${kw.replace(/\s+/g, "")}`);
    if (cached && cached.ageMs < TTL) results[kw] = { ...cached.payload, cached: true };
    else missing.push(kw);
  }

  let lastError = "";
  if (missing.length > 0) {
    // 지난달 말까지 만 3년치 월별 데이터
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    const start = new Date(end.getFullYear() - 3, end.getMonth() + 1, 1);
    const fmtDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    for (let i = 0; i < missing.length; i += 5) {
      const batch = missing.slice(i, i + 5);
      const dlRes = await fetch("https://openapi.naver.com/v1/datalab/search", {
        method: "POST",
        headers: {
          "X-Naver-Client-Id": NAVER_DATALAB_CLIENT_ID,
          "X-Naver-Client-Secret": NAVER_DATALAB_CLIENT_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: fmtDate(start),
          endDate: fmtDate(end),
          timeUnit: "month",
          keywordGroups: batch.map(kw => ({ groupName: kw, keywords: [kw] })),
        }),
      });
      if (!dlRes.ok) {
        const text = await dlRes.text().catch(() => "");
        lastError = `데이터랩 API 오류 (${dlRes.status}): ${text.slice(0, 200)}`;
        continue;
      }
      const data = await dlRes.json().catch(() => null);
      for (const group of data?.results || []) {
        const series = (group.data || []).map((d: any) => ({ period: String(d.period), ratio: Number(d.ratio) || 0 }));
        const analyzed = analyzeSeasonality(String(group.title), series);
        results[analyzed.keyword] = analyzed;
        await cacheSet(`trend:${analyzed.keyword.replace(/\s+/g, "")}`, analyzed);
      }
      // 검색량이 너무 적으면 데이터랩 결과에서 아예 빠진다 — 데이터 부족으로 표기
      for (const kw of batch) {
        if (!results[kw]) results[kw] = { keyword: kw, series: [], monthlyAvg: [], peakMonths: [], seasonality: 0, insufficient: true };
      }
    }
  }
  return { trends: keywords.map(kw => results[kw]).filter(Boolean), error: lastError || undefined };
}

async function handleTrend(req: VercelRequest, res: VercelResponse) {
  const raw = typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
  if (!raw) return res.status(400).json({ error: "keyword가 필요합니다." });
  if (!NAVER_DATALAB_CLIENT_ID || !NAVER_DATALAB_CLIENT_SECRET) {
    return res.status(500).json({
      error: "데이터랩 API 키가 설정되지 않았습니다. Vercel 환경변수에 NAVER_DATALAB_CLIENT_ID, NAVER_DATALAB_CLIENT_SECRET을 등록해주세요.",
    });
  }
  const keywords = raw.split(",").map(k => k.trim()).filter(Boolean).slice(0, 5);
  const { trends, error } = await getTrendData(keywords);
  if (trends.length === 0 && error) return res.status(502).json({ error });
  return res.status(200).json({ trends });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 주간 소싱 브리핑 — 다음 달 시즌 키워드 중 기회점수 상위 10개 (7일 캐시)
// ═══════════════════════════════════════════════════════════════════════════════
async function handleBriefing(_req: VercelRequest, res: VercelResponse) {
  const now = new Date();
  const targetMonth = (now.getMonth() + 1) % 12 + 1; // 다음 달 (판매 기준)
  const cacheKey = `briefing:v1:${targetMonth}`;
  const cached = await cacheGet(cacheKey);
  if (cached && cached.ageMs < 7 * 24 * 3600 * 1000) {
    return res.status(200).json({ ...cached.payload, cached: true });
  }

  // 시즌 키워드 확보 — kwmon 캐시가 있으면 재사용, 없으면 새로 수집해 캐시도 채워준다
  let list: any[] | null = null;
  const kwCache = await cacheGet(`kwmon:${targetMonth}`);
  if (kwCache && kwCache.ageMs < 24 * 3600 * 1000) {
    list = kwCache.payload?.keywords || null;
  } else if (NAVER_AD_API_KEY && NAVER_AD_SECRET_KEY && NAVER_AD_CUSTOMER_ID) {
    const merged = await callKeywordToolMerged(MONTH_SEEDS[targetMonth]);
    if (merged.ok) {
      const scoredAll = merged.list.map(scoreKeyword).filter(k => k.keyword)
        .sort((a, b) => b.opportunityScore - a.opportunityScore || b.monthlyVolume - a.monthlyVolume)
        .slice(0, 200);
      list = scoredAll;
      await cacheSet(`kwmon:${targetMonth}`, { seed: `${targetMonth}월 시즌`, category: null, month: targetMonth, seedStat: null, keywords: scoredAll });
    }
  }
  if (!list || list.length === 0) return res.status(502).json({ error: "시즌 키워드를 불러오지 못했습니다." });

  const isRelevant = buildRelevanceCheck([...MONTH_SEEDS[targetMonth], ...(MONTH_VOCAB[targetMonth] || [])]);
  const picks = list
    .filter((k: any) => !isBrandKeyword(k.keyword) && isRelevant(k.keyword) && k.monthlyVolume >= 300)
    .sort((a: any, b: any) => b.opportunityScore - a.opportunityScore || b.monthlyVolume - a.monthlyVolume)
    .slice(0, 10);

  // 계절성 검증 — 데이터랩 실패해도 브리핑 자체는 제공
  const trendByKw: Record<string, any> = {};
  if (NAVER_DATALAB_CLIENT_ID && NAVER_DATALAB_CLIENT_SECRET) {
    try {
      const { trends } = await getTrendData(picks.map((p: any) => p.keyword));
      for (const t of trends) trendByKw[t.keyword] = t;
    } catch { /* 트렌드 실패 무시 */ }
  }

  const items = picks.map((p: any) => {
    const t = trendByKw[p.keyword];
    return { ...p, peakMonths: t?.peakMonths || [], seasonality: t?.seasonality || 0 };
  });
  const payload = { month: targetMonth, generatedAt: new Date().toISOString(), items };
  await cacheSet(cacheKey, payload);
  return res.status(200).json(payload);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 쿠팡 상품 분석 — Bright Data Web Unlocker (실시간)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 원가 기록 ────────────────────────────────────────────────
// 소싱AI는 Bright Data(건당 과금)와 OpenAI(리뷰 요약)를 쓴다.
// 지금까지 이 비용이 어디에도 기록되지 않아, 가장 인기 있는 기능의
// 원가를 볼 수 없었다. api_calls에 남겨 관리자 비용 현황에서 집계한다.
const UNIT_COST_USD: Record<string, number> = {
  // 실제 요금제에 맞게 환경변수로 조정한다 (Bright Data는 플랜별로 단가가 다르다)
  "brightdata-unlocker": Number(process.env.BRIGHTDATA_COST_PER_CALL || 0.0015),
  "resend-email": Number(process.env.RESEND_COST_PER_EMAIL || 0.0004),
};

const TOKEN_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
  "gpt-4.1": { input: 2.00, output: 8.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4o": { input: 2.50, output: 10.00 },
};

/** 외부 유료 호출 1건을 기록한다. 실패해도 기능 흐름은 막지 않는다. */
async function logCost(
  userId: string | null,
  feature: string,
  model: string,
  opts: { inputTokens?: number; outputTokens?: number; units?: number } = {},
): Promise<void> {
  if (!supabase) return;
  const inTok = Math.max(0, Number(opts.inputTokens) || 0);
  const outTok = Math.max(0, Number(opts.outputTokens) || 0);

  let cost = 0;
  const unit = UNIT_COST_USD[model];
  if (unit !== undefined) {
    cost = unit * Math.max(1, Number(opts.units) || 1);
  } else {
    const price = TOKEN_PRICING[model];
    if (price) cost = (inTok * price.input + outTok * price.output) / 1_000_000;
  }

  try {
    await supabase.from("api_calls").insert({
      user_id: userId,
      feature,
      model,
      input_tokens: inTok,
      output_tokens: outTok,
      cost_usd: cost,
    });
  } catch { /* 원가 기록 실패는 무시 */ }
}

async function fetchViaUnlocker(
  targetUrl: string,
  retries = 2,
  minSize = 20000,
  cost: { userId: string | null; feature: string } = { userId: null, feature: "sourcing-unlocker" },
): Promise<{ ok: boolean; html?: string; error?: string }> {
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
      // 응답을 받은 시점에 과금된다 — 재시도도 각각 1건으로 기록한다
      await logCost(cost.userId, cost.feature, "brightdata-unlocker");

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        lastError = `Bright Data Unlocker 오류 (HTTP ${res.status}) ${body.slice(0, 300)}`;
        if (res.status >= 500 || res.status === 429) continue; // 일시 오류는 재시도
        return { ok: false, error: lastError };
      }
      const html = await res.text();
      // 빈/불완전 응답은 일시 오류로 간주하고 재시도 (정상 페이지는 수백 KB 이상)
      if (!html || html.length < minSize) {
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

// ─── 내 상품 순위 추적 ────────────────────────────────────────────────────────
// 이 키워드를 순위 추적 중인 상품이 있으면, 방금 파싱한 검색 결과에서 순위를 찾아 기록
async function recordRankObservations(keyword: string, parsed: ParsedProduct[]): Promise<void> {
  if (!supabase || parsed.length === 0) return;
  try {
    const { data: watches } = await supabase
      .from("sourcing_rank_watch")
      .select("product_id")
      .eq("keyword", keyword);
    if (!watches || watches.length === 0) return;
    const organic = parsed.filter(p => !p.isAd);
    const pids = [...new Set(watches.map(w => String(w.product_id)))];
    const rows = pids.map(pid => {
      const organicIdx = organic.findIndex(p => p.productId === pid);
      const found = parsed.find(p => p.productId === pid);
      return {
        keyword,
        product_id: pid,
        rank: organicIdx >= 0 ? organicIdx + 1 : null,
        rank_with_ads: found ? found.rank : null,
        price: found ? found.productPrice : null,
      };
    });
    await supabase.from("sourcing_rank_obs").insert(rows);
    // URL만으로 등록되어 상품명이 없는 항목은 수집 결과에서 이름을 채워준다
    for (const pid of pids) {
      const found = parsed.find(p => p.productId === pid);
      if (found?.productName) {
        await supabase.from("sourcing_rank_watch")
          .update({ product_name: found.productName.slice(0, 200) })
          .eq("product_id", pid)
          .is("product_name", null);
      }
    }
  } catch { /* 순위 기록 실패는 무시 */ }
}

// 지금 즉시 순위 확인: 최근 캐시가 있으면 캐시로, 없으면 실시간 수집(사용 한도 포함) 후 기록
async function checkRankNow(keyword: string, productId: string, decoded: any): Promise<{
  rankChecked: boolean; currentRank?: number | null; error?: string; remaining?: number | null;
}> {
  const cacheKey = `cp:v5:${keyword.replace(/\s+/g, "")}`;
  const cached = await cacheGet(cacheKey);
  let products: ParsedProduct[] | null = null;
  let remaining: number | null = null;

  if (cached && cached.ageMs < 3 * 3600 * 1000) {
    products = cached.payload?.products || null;
  } else {
    if (!BRIGHTDATA_API_TOKEN) return { rankChecked: false, error: "Bright Data 미설정" };
    // 신규 수집은 쿠팡 분석과 동일하게 일일 한도에 포함
    if (!decoded?.isAdmin && supabase) {
      try {
        const today = new Date().toISOString().split("T")[0];
        const { data, error } = await supabase.rpc("increment_feature_usage", {
          p_user_id: decoded.userId, p_date: today, p_feature: "rank", p_limit: FEATURE_LIMITS.rank,
        });
        if (!error && data?.exceeded) return { rankChecked: false, error: `순위 확인은 하루 ${FEATURE_LIMITS.rank}회까지입니다. 내일 새벽 자동 수집 시 기록됩니다.` };
        if (!error && typeof data?.remaining === "number") remaining = data.remaining;
      } catch { /* 한도 집계 실패는 기능을 막지 않음 */ }
    }
    const url = `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&channel=user&sorter=scoreDesc&listSize=60`;
    const result = await fetchViaUnlocker(url, 2, 20000, { userId: decoded?.userId ?? null, feature: "rank-check" });
    if (result.ok) {
      const p = parseCoupangSearch(result.html!);
      if (p.products.length > 0) {
        products = p.products;
        if (p.products.length >= 5) await cacheSet(cacheKey, { products: p.products, totalCount: p.totalCount });
        await recordObservations(keyword, p.products);
      }
    }
    if (!products && cached) products = cached.payload?.products || null;
  }

  if (!products || products.length === 0) {
    return { rankChecked: false, error: "검색 결과를 수집하지 못했습니다. 잠시 후 다시 시도해주세요.", remaining };
  }
  await recordRankObservations(keyword, products);
  const organic = products.filter(p => !p.isAd);
  const idx = organic.findIndex(p => p.productId === productId);
  return { rankChecked: true, currentRank: idx >= 0 ? idx + 1 : null, remaining };
}

async function handleRankWatch(req: VercelRequest, res: VercelResponse, decoded: any) {
  if (!supabase) return res.status(500).json({ error: "서버 저장소가 설정되지 않았습니다." });
  const action = typeof req.query.action === "string" ? req.query.action : "list";
  const userId = decoded.userId;

  if (action === "add") {
    const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
    const urlOrId = typeof req.query.product === "string" ? req.query.product.trim() : "";
    const productId = /^\d+$/.test(urlOrId) ? urlOrId : (urlOrId.match(/\/vp\/products\/(\d+)/)?.[1] || "");
    if (!keyword || !productId) {
      return res.status(400).json({ error: "키워드와 상품 URL(또는 상품번호)이 필요합니다. URL 예: https://www.coupang.com/vp/products/123456" });
    }
    const { count } = await supabase
      .from("sourcing_rank_watch")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count || 0) >= 20) return res.status(400).json({ error: "순위 추적은 최대 20개까지 등록할 수 있습니다." });
    const productName = typeof req.query.name === "string" ? req.query.name.trim().slice(0, 200) : "";
    const { error } = await supabase
      .from("sourcing_rank_watch")
      .upsert({ user_id: userId, keyword, product_id: productId, product_name: productName || null });
    if (error) return res.status(500).json({ error: "순위 추적 등록 실패 (Supabase에 sourcing_rank_watch 테이블을 생성했는지 확인해주세요)" });
    // 등록 즉시 현재 순위를 실시간으로 확인해 기록 (캐시 없으면 지금 수집)
    const now = await checkRankNow(keyword, productId, decoded);
    return res.status(200).json({ ok: true, productId, ...now });
  }

  // 지금 확인: 기존 추적 항목의 순위를 즉시 갱신
  if (action === "check") {
    const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
    const productId = typeof req.query.product === "string" ? req.query.product.trim() : "";
    if (!keyword || !productId) return res.status(400).json({ error: "keyword와 product가 필요합니다." });
    const now = await checkRankNow(keyword, productId, decoded);
    if (!now.rankChecked) return res.status(502).json({ error: now.error || "순위 확인 실패" });
    return res.status(200).json(now);
  }

  if (action === "remove") {
    const keyword = typeof req.query.keyword === "string" ? req.query.keyword.trim() : "";
    const productId = typeof req.query.product === "string" ? req.query.product.trim() : "";
    await supabase.from("sourcing_rank_watch").delete()
      .eq("user_id", userId).eq("keyword", keyword).eq("product_id", productId);
    return res.status(200).json({ ok: true });
  }

  // list: 등록 목록 + 각 항목의 최근 순위 이력
  const { data: watches, error } = await supabase
    .from("sourcing_rank_watch")
    .select("keyword, product_id, product_name, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: "순위 추적 목록 조회 실패 (sourcing_rank_watch 테이블 생성 필요)" });
  if (!watches || watches.length === 0) return res.status(200).json({ watches: [] });

  // 최신순으로 읽어야 이력이 쌓여 2,000행을 넘어도 최근 기록이 잘리지 않는다
  const { data: obs } = await supabase
    .from("sourcing_rank_obs")
    .select("keyword, product_id, rank, rank_with_ads, price, captured_at")
    .in("product_id", watches.map(w => w.product_id))
    .order("captured_at", { ascending: false })
    .limit(2000);

  const result = watches.map(w => {
    const history = (obs || [])
      .filter(o => o.keyword === w.keyword && o.product_id === w.product_id)
      .slice(0, 30)
      .reverse(); // 화면 표시는 과거→최신 순
    const latest = history[history.length - 1] || null;
    const prev = history.length >= 2 ? history[history.length - 2] : null;
    return {
      ...w,
      history,
      latestRank: latest ? latest.rank : undefined,
      latestAt: latest ? latest.captured_at : null,
      delta: latest && prev && latest.rank !== null && prev.rank !== null ? prev.rank - latest.rank : null,
    };
  });
  return res.status(200).json({ watches: result });
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

// 기능별 일일 한도 — 원가 편차가 커서 하나로 합치면 관리가 안 된다.
// 소싱·리뷰는 Bright Data 건당 과금, 순위 추적은 상대적으로 가볍다.
// 실제 원가 데이터를 2~4주 본 뒤 조정한다 (관리자 → 원가 현황).
const FEATURE_LIMITS: Record<string, number> = {
  sourcing: Number(process.env.LIMIT_SOURCING || 40),   // 키워드 상품 수집
  reviews: Number(process.env.LIMIT_REVIEWS || 20),     // 리뷰 수집 + GPT 요약
  rank: Number(process.env.LIMIT_RANK || 60),           // 순위 확인
};

const DAILY_LIMIT = 40; // api/usage.ts와 동일한 일일 한도 (레거시 참조용)

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
        const { data, error } = await supabase.rpc("increment_feature_usage", {
          p_user_id: decoded.userId,
          p_date: today,
          p_feature: "sourcing",
          p_limit: FEATURE_LIMITS.sourcing,
        });
        if (!error && data?.exceeded) {
          return res.status(429).json({ error: `소싱 분석은 하루 ${FEATURE_LIMITS.sourcing}회까지입니다. 내일 다시 이용해주세요. (이미 분석했던 키워드는 캐시로 계속 조회됩니다)` });
        }
        if (!error && typeof data?.remaining === "number") remaining = data.remaining;
      } catch { /* 한도 집계 실패는 기능을 막지 않음 */ }
    }
    const url = `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}&channel=user&sorter=scoreDesc&listSize=60`;
    const result = await fetchViaUnlocker(url, 2, 20000, { userId: decoded?.userId ?? null, feature: "sourcing-products" });
    if (result.ok) {
      const p = parseCoupangSearch(result.html!);
      parseDebug = p.diagnostics;
      if (p.products.length > 0) {
        parsed = { products: p.products, totalCount: p.totalCount };
        // 불완전 파싱(5개 미만)은 캐시하지 않아 재시도가 가능하도록 함
        if (p.products.length >= 5) await cacheSet(cacheKey, parsed);
        await recordObservations(keyword, p.products); // 리뷰속도 히스토리 축적
        await recordRankObservations(keyword, p.products); // 순위 추적 기록
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
// 경쟁상품 리뷰 분석 — 리뷰 수집 + GPT 요약 (불만/니즈 → 소싱·상세페이지 공략 포인트)
// ═══════════════════════════════════════════════════════════════════════════════

function parseReviews(html: string): { rating: number; text: string }[] {
  const out: { rating: number; text: string }[] = [];
  // 리뷰 본문 블록 (sdp-review 구형/신형 클래스 모두 시도)
  const blocks = html.split(/class="[^"]*(?:sdp-review__article__list\b|review-article|ReviewArticle_)[^"]*"/).slice(1);
  for (const b of blocks.slice(0, 40)) {
    const text = stripTags(
      pick(/class="[^"]*(?:review__content|review-content|ReviewContent_|article__content)[^"]*"[^>]*>([\s\S]{10,2000}?)<\/(?:div|p|span)>/, b),
    );
    const rating = parseInt(pick(/data-rating="(\d)"/, b), 10)
      || (parseFloat(pick(/width:\s*([\d.]+)%/, b)) || 0) / 20 || 0;
    if (text && text.length >= 8) out.push({ rating: Math.round(rating * 10) / 10, text: text.slice(0, 600) });
  }
  // 폴백: JSON 내 리뷰 콘텐츠 ("content":"...","rating":N 형태)
  if (out.length < 3) {
    for (const m of html.matchAll(/"(?:content|reviewContent|comment)"\s*:\s*"((?:[^"\\]|\\.){15,1500})"/g)) {
      if (out.length >= 40) break;
      try {
        const text = JSON.parse(`"${m[1]}"`).replace(/\s+/g, " ").trim();
        if (text.length >= 10 && !/^https?:/.test(text)) out.push({ rating: 0, text: text.slice(0, 600) });
      } catch { /* 개별 파싱 실패 무시 */ }
    }
  }
  return out;
}

async function summarizeReviews(productName: string, reviews: { rating: number; text: string }[], userId: string | null = null): Promise<any> {
  const apiKey = (process.env.OPENAIAPIKEY || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return { error: "OpenAI API 키가 설정되지 않았습니다." };
  const model = String(process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini");
  const sample = reviews.slice(0, 30).map((r, i) => `${i + 1}. ${r.rating > 0 ? `[${r.rating}점] ` : ""}${r.text}`).join("\n");
  const prompt = `당신은 쿠팡 셀러 코치입니다. 아래는 경쟁 상품 "${productName}"의 실제 고객 리뷰입니다.
소싱을 검토 중인 셀러를 위해 분석하세요. 반드시 아래 JSON만 반환:
{
  "oneLine": "이 상품 시장을 한 줄로 요약",
  "positives": ["고객이 만족하는 점 3~5개"],
  "complaints": ["고객 불만 3~5개 (빈도 높은 순)"],
  "needs": ["리뷰에서 드러난 숨은 니즈 2~4개"],
  "attackPoints": ["내가 이 시장에 들어갈 때 상세페이지/상품 개선으로 공략할 포인트 3~5개 (불만을 뒤집은 USP)"]
}
리뷰에 없는 내용은 지어내지 마세요.

[리뷰]
${sample}`;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return { error: `GPT 요약 실패 (HTTP ${r.status})` };
    const data = await r.json();
    await logCost(userId, "sourcing-review-summary", model, {
      inputTokens: data?.usage?.prompt_tokens,
      outputTokens: data?.usage?.completion_tokens,
    });
    return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
  } catch (e: any) {
    return { error: e?.message || "GPT 요약 실패" };
  }
}

async function handleReviews(req: VercelRequest, res: VercelResponse, decoded: any) {
  const raw = typeof req.query.product === "string" ? req.query.product.trim() : "";
  const productId = /^\d+$/.test(raw) ? raw : (raw.match(/\/vp\/products\/(\d+)/)?.[1] || "");
  const productName = typeof req.query.name === "string" ? req.query.name.trim().slice(0, 200) : "상품";
  if (!productId) return res.status(400).json({ error: "상품 URL 또는 상품번호가 필요합니다." });
  if (!BRIGHTDATA_API_TOKEN) return res.status(500).json({ error: "Bright Data API 토큰이 설정되지 않았습니다." });

  const cacheKey = `rv:v1:${productId}`;
  const cached = await cacheGet(cacheKey);
  if (cached && cached.ageMs < 7 * 24 * 3600 * 1000) {
    return res.status(200).json({ ...cached.payload, cached: true });
  }

  // 신규 수집은 사용 한도 포함 (Unlocker + GPT 비용 발생)
  let remaining: number | null = null;
  if (!decoded?.isAdmin && supabase) {
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase.rpc("increment_feature_usage", {
        p_user_id: decoded.userId, p_date: today, p_feature: "reviews", p_limit: FEATURE_LIMITS.reviews,
      });
      if (!error && data?.exceeded) return res.status(429).json({ error: `리뷰 분석은 하루 ${FEATURE_LIMITS.reviews}회까지입니다.` });
      if (!error && typeof data?.remaining === "number") remaining = data.remaining;
    } catch { /* 한도 집계 실패는 기능을 막지 않음 */ }
  }

  // ① 리뷰 전용 엔드포인트 (HTML 프래그먼트) → ② 상품 페이지 폴백
  // 함수 제한(60초) 안에 끝나도록 시도 횟수를 최소화한다: ①은 재시도 1회, ②는 재시도 없음
  let reviews: { rating: number; text: string }[] = [];
  let diag = "";
  const reviewUrl = `https://www.coupang.com/vp/product/reviews?productId=${productId}&page=1&size=30&sortBy=ORDER_SCORE_ASC&ratingSummary=true`;
  const r1 = await fetchViaUnlocker(reviewUrl, 1, 500, { userId: decoded?.userId ?? null, feature: "sourcing-reviews" });
  if (r1.ok) {
    reviews = parseReviews(r1.html!);
    if (reviews.length < 3) diag = `리뷰엔드포인트: htmlLen=${r1.html!.length}, 파싱=${reviews.length}개`;
  } else {
    diag = `리뷰엔드포인트 실패: ${r1.error}`;
  }
  if (reviews.length < 3) {
    const r2 = await fetchViaUnlocker(`https://www.coupang.com/vp/products/${productId}`, 0, 20000, { userId: decoded?.userId ?? null, feature: "sourcing-reviews" });
    if (r2.ok) {
      const more = parseReviews(r2.html!);
      if (more.length > reviews.length) reviews = more;
      diag += ` | 상품페이지: htmlLen=${r2.html!.length}, 파싱=${more.length}개`;
    } else {
      diag += ` | 상품페이지 실패: ${r2.error}`;
    }
  }

  if (reviews.length === 0) {
    return res.status(502).json({ error: `리뷰를 수집하지 못했습니다. 잠시 후 다시 시도해주세요.`, diagnostics: diag });
  }

  const summary = await summarizeReviews(productName, reviews, decoded?.userId ?? null);
  const payload = {
    productId,
    productName,
    reviewCount: reviews.length,
    samples: reviews.slice(0, 5),
    summary,
    ...(reviews.length < 3 ? { diagnostics: diag } : {}),
  };
  if (!summary?.error && reviews.length >= 3) await cacheSet(cacheKey, payload);
  return res.status(200).json({ ...payload, ...(remaining !== null ? { remaining } : {}) });
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

  // 크론이 축적한 데이터를 모아 보는 리포트: 키워드별 시장 요약 + 리뷰 증가 상위 상품
  if (action === "report") {
    const { data: favs, error } = await supabase
      .from("sourcing_favorites")
      .select("keyword, stat, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) return res.status(500).json({ error: "관심 키워드 조회 실패" });
    const kws = (favs || []).map(f => String(f.keyword));
    if (kws.length === 0) return res.status(200).json({ report: [] });

    const keyOf = (kw: string) => `cp:v5:${kw.replace(/\s+/g, "")}`;
    const { data: cacheRows } = await supabase
      .from("sourcing_cache")
      .select("cache_key, payload, created_at")
      .in("cache_key", kws.map(keyOf));
    const cacheMap = new Map((cacheRows || []).map(r => [r.cache_key, r]));

    // 키워드당 상위 10개 상품만 리뷰속도 조회 대상에 포함 (쿼리 1회로 처리)
    const perKeywordProducts = new Map<string, ParsedProduct[]>();
    const allIds: string[] = [];
    for (const kw of kws) {
      const row = cacheMap.get(keyOf(kw));
      const prods: ParsedProduct[] = (row?.payload?.products || [])
        .filter((p: any) => !p.isAd)
        .slice(0, 10);
      perKeywordProducts.set(kw, prods);
      allIds.push(...prods.map((p: any) => String(p.productId)));
    }
    const velocity = await loadReviewVelocity([...new Set(allIds)]);

    const report = (favs || []).map(f => {
      const kw = String(f.keyword);
      const row = cacheMap.get(keyOf(kw));
      const prods = perKeywordProducts.get(kw) || [];
      const reviews = prods.map(p => p.reviewCount).sort((a, b) => a - b);
      const rocket = prods.filter(p => p.deliveryType === "rocket").length;
      const movers = prods
        .map(p => {
          const v = velocity.get(String(p.productId));
          return {
            productId: p.productId,
            productName: p.productName,
            productPrice: p.productPrice,
            productUrl: p.productUrl,
            productImage: p.productImage,
            reviewCount: p.reviewCount,
            growthPerDay: v ? v.perDay : null,
            obsDays: v ? v.days : null,
          };
        })
        .filter(m => m.growthPerDay !== null && m.growthPerDay > 0)
        .sort((a, b) => (b.growthPerDay || 0) - (a.growthPerDay || 0))
        .slice(0, 3);
      return {
        keyword: kw,
        stat: f.stat || null,
        lastCrawledAt: row ? row.created_at : null,
        totalOnPage: prods.length > 0 ? (cacheMap.get(keyOf(kw))?.payload?.products || []).length : 0,
        medianReviews: reviews.length ? reviews[Math.floor(reviews.length / 2)] : null,
        rocketRatio: prods.length ? Math.round((rocket / prods.length) * 100) : null,
        movers,
      };
    });
    return res.status(200).json({ report });
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
// 이메일 알림 — 순위 급락 즉시 알림 + 주 1회 요약 (크론에서 호출)
// ═══════════════════════════════════════════════════════════════════════════════

// 이메일 발송 (Resend) — 키가 없으면 조용히 스킵 (api/billing.ts와 동일)
async function sendEmail(to: string, subject: string, html: string, userId: string | null = null): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || "no-reply@hoonpro.app", to: [to], subject, html }),
    });
    if (r.ok) await logCost(userId, "email-notify", "resend-email");
  } catch { /* 발송 실패가 수집을 막지 않도록 */ }
}

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 사용자별 순위 현황: 추적 항목마다 최근 관측 2개를 뽑아 최신 순위와 변화를 계산
async function collectRankStates() {
  if (!supabase) return [];
  const { data: watches } = await supabase
    .from("sourcing_rank_watch")
    .select("user_id, keyword, product_id, product_name");
  if (!watches || watches.length === 0) return [];
  const { data: obs } = await supabase
    .from("sourcing_rank_obs")
    .select("keyword, product_id, rank, captured_at")
    .in("product_id", [...new Set(watches.map(w => w.product_id))])
    .gte("captured_at", new Date(Date.now() - 8 * 86400000).toISOString())
    .order("captured_at", { ascending: false })
    .limit(3000);
  return watches.map(w => {
    const hist = (obs || []).filter(o => o.keyword === w.keyword && o.product_id === w.product_id);
    const latest = hist[0] || null;
    const prev = hist.find(o => latest && o.captured_at < latest.captured_at) || null;
    return { ...w, latestRank: latest ? latest.rank : undefined, prevRank: prev ? prev.rank : undefined, latestAt: latest?.captured_at || null };
  });
}

// 순위 급락(5계단↑ 하락 또는 20위 이내 → 순위권 밖) 시 소유자에게 즉시 메일
async function sendRankAlerts(): Promise<number> {
  if (!supabase) return 0;
  const states = await collectRankStates();
  const alerts = states.filter(s => {
    if (s.latestRank === undefined || s.prevRank === undefined) return false;
    if (s.prevRank !== null && s.latestRank === null && s.prevRank <= 20) return true; // 순위권 이탈
    if (s.prevRank !== null && s.latestRank !== null && s.latestRank - s.prevRank >= 5) return true; // 5계단↑ 하락
    return false;
  });
  if (alerts.length === 0) return 0;

  const byUser = new Map<string, typeof alerts>();
  for (const a of alerts) {
    if (!byUser.has(a.user_id)) byUser.set(a.user_id, []);
    byUser.get(a.user_id)!.push(a);
  }
  const { data: users } = await supabase.from("users").select("id, email, name, email_opt_out").in("id", [...byUser.keys()]);
  let sent = 0;
  for (const [uid, list] of byUser) {
    if (sent >= 50) break;
    const u = (users || []).find(x => x.id === uid);
    if (!u?.email || u.email_opt_out) continue; // 수신 거부 존중
    const rows = list.map(a =>
      `<li><b>"${esc(a.keyword)}"</b> — ${esc(a.product_name || `상품 ${a.product_id}`)}: ` +
      `${a.prevRank === null ? "순위권 밖" : `${a.prevRank}위`} → <b style="color:#b4342b">${a.latestRank === null ? "순위권(60위) 밖" : `${a.latestRank}위`}</b></li>`,
    ).join("");
    await sendEmail(
      u.email,
      "[훈프로] 내 상품 순위가 하락했습니다",
      `<p>${esc(u.name || "")}님, 추적 중인 상품의 검색 순위가 하락했습니다.</p><ul>${rows}</ul>` +
      `<p>순위 하락은 보통 경쟁 상품의 광고 강화나 리뷰 역전이 원인입니다. 훈프로의 [순위 추적]과 [광고 성과 분석]에서 원인을 점검해보세요.</p>` +
      '<p style="color:#888;font-size:12px">알림 메일은 훈프로 앱의 [구독 관리] 탭에서 언제든 끌 수 있습니다.</p>',
    );
    sent += 1;
  }
  return sent;
}

// 주 1회(월요일 새벽 KST) 요약: 내 상품 순위 현황 + 이번 주 추천 소싱 키워드
async function sendWeeklyDigest(): Promise<number> {
  if (!supabase) return 0;
  const states = await collectRankStates();
  const byUser = new Map<string, typeof states>();
  for (const s of states) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
    byUser.get(s.user_id)!.push(s);
  }
  if (byUser.size === 0) return 0;

  // 이번 주 추천 키워드 (브리핑 캐시 재사용)
  const nextMonth = (new Date().getMonth() + 1) % 12 + 1;
  const briefing = await cacheGet(`briefing:v1:${nextMonth}`);
  const picks: any[] = (briefing?.payload?.items || []).slice(0, 5);
  const pickHtml = picks.length
    ? `<p><b>이번 주 추천 소싱 키워드 (${nextMonth}월 판매 준비)</b></p><ul>` +
      picks.map(p => `<li>${esc(p.keyword)} — 월 검색량 ${Number(p.monthlyVolume).toLocaleString()}</li>`).join("") + "</ul>"
    : "";

  const { data: users } = await supabase.from("users").select("id, email, name, email_opt_out").in("id", [...byUser.keys()]);
  let sent = 0;
  for (const [uid, list] of byUser) {
    if (sent >= 100) break;
    const u = (users || []).find(x => x.id === uid);
    if (!u?.email || u.email_opt_out) continue; // 수신 거부 존중
    const rows = list.slice(0, 15).map(s => {
      const cur = s.latestRank === undefined ? "기록 대기" : s.latestRank === null ? "60위 밖" : `${s.latestRank}위`;
      const delta = s.prevRank !== undefined && s.prevRank !== null && s.latestRank !== undefined && s.latestRank !== null
        ? (s.prevRank - s.latestRank > 0 ? ` (▲${s.prevRank - s.latestRank})` : s.prevRank - s.latestRank < 0 ? ` (▼${s.latestRank - s.prevRank})` : "")
        : "";
      return `<li><b>"${esc(s.keyword)}"</b> ${esc(s.product_name || `상품 ${s.product_id}`)} — <b>${cur}</b>${delta}</li>`;
    }).join("");
    await sendEmail(
      u.email,
      "[훈프로] 주간 리포트 — 내 상품 순위와 이번 주 추천 키워드",
      `<p>${esc(u.name || "")}님, 이번 주 훈프로 요약입니다.</p>` +
      `<p><b>내 상품 순위 현황</b></p><ul>${rows}</ul>${pickHtml}` +
      `<p>자세한 내용은 훈프로 앱의 홈 대시보드에서 확인하세요.</p>` +
      '<p style="color:#888;font-size:12px">알림 메일은 훈프로 앱의 [구독 관리] 탭에서 언제든 끌 수 있습니다.</p>',
    );
    sent += 1;
  }
  return sent;
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

  // 저장 공간 정리 — 캐시 30일, 리뷰 관측 기록 90일 보존 (무한 성장 방지)
  try {
    await supabase.from("sourcing_cache").delete().lt("created_at", new Date(Date.now() - 30 * 86400000).toISOString());
    await supabase.from("sourcing_product_obs").delete().lt("captured_at", new Date(Date.now() - 90 * 86400000).toISOString());
    await supabase.from("sourcing_rank_obs").delete().lt("captured_at", new Date(Date.now() - 180 * 86400000).toISOString());
  } catch { /* 정리 실패는 수집을 막지 않음 */ }

  const { data: favs } = await supabase.from("sourcing_favorites").select("keyword").limit(1000);
  // 순위 추적 키워드도 매일 수집 대상에 포함 (순위 이력이 자동으로 쌓인다)
  let rankKws: string[] = [];
  try {
    const { data: rw } = await supabase.from("sourcing_rank_watch").select("keyword").limit(1000);
    rankKws = (rw || []).map(r => String(r.keyword));
  } catch { /* 테이블 미생성 시 무시 */ }
  const keywords = [...new Set([...rankKws, ...(favs || []).map(f => String(f.keyword))])];

  // 형평성: 캐시가 없거나 가장 오래된 키워드부터 수집 — 관심 키워드 전체가 순환된다
  const keyOf = (kw: string) => `cp:v5:${kw.replace(/\s+/g, "")}`;
  const ageMap = new Map<string, number>();
  try {
    const { data: cacheRows } = await supabase
      .from("sourcing_cache")
      .select("cache_key, created_at")
      .in("cache_key", keywords.map(keyOf));
    for (const r of cacheRows || []) ageMap.set(r.cache_key, new Date(r.created_at).getTime());
  } catch { /* 정렬 실패 시 원래 순서 유지 */ }
  keywords.sort((a, b) => (ageMap.get(keyOf(a)) ?? 0) - (ageMap.get(keyOf(b)) ?? 0));

  // 시간 기반 상한: 60초 제한 안에서 최대한 수집 (구 6개 고정 → 보통 10개 이상 처리)
  const cronStart = Date.now();
  const CRON_BUDGET_MS = 45_000;
  const CRON_MAX = 15;
  let crawled = 0;
  const results: string[] = [];
  for (const kw of keywords) {
    if (crawled >= CRON_MAX || Date.now() - cronStart > CRON_BUDGET_MS) break;
    const cacheKey = keyOf(kw);
    const cachedAt = ageMap.get(cacheKey);
    if (cachedAt && Date.now() - cachedAt < 20 * 3600 * 1000) continue; // 오늘 이미 수집됨
    const url = `https://www.coupang.com/np/search?q=${encodeURIComponent(kw)}&channel=user&sorter=scoreDesc&listSize=60`;
    const result = await fetchViaUnlocker(url, 1, 20000, { userId: null, feature: "sourcing-cron" });
    if (!result.ok) { results.push(`${kw}: 실패`); continue; }
    const p = parseCoupangSearch(result.html!);
    if (p.products.length >= 5) {
      await cacheSet(cacheKey, { products: p.products, totalCount: p.totalCount });
      await recordObservations(kw, p.products);
      await recordRankObservations(kw, p.products);
      crawled++;
      results.push(`${kw}: ${p.products.length}개`);
    } else {
      results.push(`${kw}: 파싱 ${p.products.length}개`);
    }
  }
  // ── 이메일 알림: 순위 급락 즉시 + 일요일(UTC, KST 월요일 새벽)엔 주간 요약 ──
  let alertMails = 0;
  let weeklyMails = 0;
  try { alertMails = await sendRankAlerts(); } catch { /* 알림 실패는 수집 결과에 영향 없음 */ }
  if (new Date().getUTCDay() === 0) {
    try { weeklyMails = await sendWeeklyDigest(); } catch { /* 동일 */ }
  }

  return res.status(200).json({ ok: true, totalFavorites: keywords.length, crawled, results, alertMails, weeklyMails });
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

  // 유료화 게이트 — billing_enforced가 켜지면 유효한 구독 없이는 사용 불가 (api/qa.ts와 동일 기준)
  if (!decoded.isAdmin && supabase) {
    const { data: enforcedCfg } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", "billing_enforced")
      .maybeSingle();
    if (enforcedCfg?.value === "true") {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("user_id", decoded.userId)
        .maybeSingle();
      if (!sub || !["trial", "active", "past_due"].includes(sub.status)) {
        return res.status(402).json({
          error: "구독 후 이용할 수 있습니다. [구독 관리] 탭에서 구독을 시작해주세요.",
          subscriptionRequired: true,
        });
      }
    }
  }

  if (type === "keywords") return handleKeywords(req, res);
  if (type === "trend") return handleTrend(req, res);
  if (type === "briefing") return handleBriefing(req, res);
  if (type === "products") return handleProducts(req, res, decoded);
  if (type === "reviews") return handleReviews(req, res, decoded);
  if (type === "favorites") return handleFavorites(req, res, decoded);
  if (type === "rankwatch") return handleRankWatch(req, res, decoded);
  return res.status(400).json({ error: "type=keywords | trend | briefing | products | reviews | favorites | rankwatch 가 필요합니다." });
}
