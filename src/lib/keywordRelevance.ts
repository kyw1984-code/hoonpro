/**
 * 검색어와 연관 키워드의 관련도.
 *
 * 네이버 키워드도구는 "여자 니트티"를 넣으면 "여자니트티셔츠"부터
 * "가디건", "원피스"까지 200개를 한꺼번에 돌려준다. 이걸 기회점수순으로만
 * 늘어놓으면 검색어와 가장 가까운 키워드가 40번째 줄에 가 있고, 셀러는
 * 자기가 찾던 말을 표에서 다시 찾아야 한다.
 *
 * 그래서 검색어를 낱말로 쪼개고, 각 키워드가 그 낱말을 얼마나 품고 있는지로
 * 점수를 매긴다. 같은 점수 안에서는 검색량이 큰 쪽을 앞에 둔다.
 */

/** 서로 바꿔 써도 같은 뜻으로 보는 낱말. 정규화 때 앞쪽 표기로 통일한다 */
const SYNONYMS: [string, string][] = [
  ['여성', '여자'],
  ['남성', '남자'],
  ['유아', '아기'],
  ['아가', '아기'],
  ['티셔츠', '티'],
  ['반팔티', '반팔'],
];

/** 붙여 쓴 검색어에서 떼어낼 수 있는 앞머리. "여자니트티" → 여자 + 니트티 */
const PREFIXES = ['여자', '남자', '아기', '키즈', '주니어', '커플', '남녀', '성인'];

export function normalizeKeyword(s: string): string {
  let out = s.toLowerCase().replace(/\s+/g, '');
  for (const [from, to] of SYNONYMS) out = out.split(from).join(to);
  return out;
}

/** 검색어를 낱말로. 띄어쓰기가 없으면 앞머리(성별·연령)만 떼어 본다 */
export function seedTokens(seed: string): string[] {
  const parts = seed.trim().split(/\s+/).map(normalizeKeyword).filter(Boolean);
  if (parts.length !== 1) return parts;
  const only = parts[0];
  for (const p of PREFIXES) {
    if (only.startsWith(p) && only.length - p.length >= 2) return [p, only.slice(p.length)];
  }
  return parts;
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** 두 글자 겹침 비율(0~1). "니트티"와 "니트탑"처럼 낱말로는 못 잡는 닮음을 본다 */
function dice(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}

/**
 * 0~200. 클수록 검색어에 가깝다.
 *   검색어 그대로            200
 *   검색어를 통째로 품음     100+  (여자니트티 → 여자니트티셔츠)
 *   낱말을 전부 품음          60+  (여자니트티 → 니트티여자, 여성니트티)
 *   마지막 낱말(핵심어) 품음  40+  (여자니트티 → 니트티, 남자니트티)
 *   낱말 하나라도 품음        10+  (여자니트티 → 여자가디건)
 * 여기에 글자 겹침을 최대 20점 더한다.
 */
export function relevanceScore(seed: string, keyword: string): number {
  const s = normalizeKeyword(seed);
  const k = normalizeKeyword(keyword);
  if (!s || !k) return 0;
  if (s === k) return 200;
  const tokens = seedTokens(seed);
  const head = tokens[tokens.length - 1];
  let score = 0;
  if (k.includes(s)) score = 100;
  else if (tokens.length > 1 && tokens.every(t => k.includes(t))) score = 60;
  else if (head && k.includes(head)) score = 40;
  else if (tokens.some(t => t.length >= 2 && k.includes(t))) score = 10;
  return score + Math.round(dice(s, k) * 20);
}

/** 관련도 내림차순, 같으면 검색량 내림차순 */
export function sortByRelevance<T extends { keyword: string; monthlyVolume: number }>(seed: string, list: T[]): T[] {
  const scored = list.map(k => ({ k, r: relevanceScore(seed, k.keyword) }));
  scored.sort((a, b) => b.r - a.r || b.k.monthlyVolume - a.k.monthlyVolume);
  return scored.map(x => x.k);
}
