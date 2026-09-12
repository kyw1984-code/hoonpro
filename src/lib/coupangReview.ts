/**
 * 쿠팡 리뷰 응답을 읽는다.
 *
 * 쿠팡이 리뷰 창구를 바꿨다. 예전 주소(/vp/product/reviews)는 HTML 조각을
 * 돌려줬고 지금은 "The api will be deprecated" 한 줄만 온다. 새 주소는
 * /next-api/review이고 JSON을 돌려준다.
 *
 * 그래서 클래스 이름을 찾아 긁는 대신 JSON을 읽는데, 응답의 정확한 생김새에
 * 기대지 않는다. 키 이름 하나가 바뀌어도 조용히 0건이 되는 파서는 이미 한 번
 * 겪었다. 대신 트리를 훑으며 "리뷰 본문처럼 생긴 문자열"을 가진 객체를 줍는다.
 * 껍데기가 rData든 data든 contents든 상관없이 걸린다.
 */

/** 리뷰 본문이 들어 있을 만한 키 */
const TEXT_KEYS = ['reviewContent', 'content', 'comment', 'reviewBody', 'body'];

/** 별점이 들어 있을 만한 키 */
const RATING_KEYS = ['rating', 'ratingScore', 'reviewRating', 'score', 'star'];

/** 너무 짧은 것은 리뷰가 아니다 (안내 문구, 라벨 따위) */
const MIN_TEXT = 8;

/** 한 번에 가져갈 최대 건수 */
const MAX_REVIEWS = 40;

/** 트리가 깊어도 이 아래로는 안 내려간다 */
const MAX_DEPTH = 10;

export interface ParsedReview {
  /** 0이면 별점을 못 찾은 것 */
  rating: number;
  text: string;
}

export function parseReviewJson(raw: string): ParsedReview[] {
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch {
    return [];
  }

  const out: ParsedReview[] = [];
  // 같은 리뷰가 목록과 요약에 두 번 들어 있는 경우가 있다
  const seen = new Set<string>();

  const walk = (node: unknown, depth: number): void => {
    if (out.length >= MAX_REVIEWS || depth > MAX_DEPTH || node === null) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;

    const obj = node as Record<string, unknown>;
    const key = TEXT_KEYS.find(k => typeof obj[k] === 'string' && (obj[k] as string).trim().length >= MIN_TEXT);
    if (key) {
      const text = String(obj[key]).replace(/\s+/g, ' ').trim().slice(0, 600);
      if (text && !seen.has(text)) {
        seen.add(text);
        out.push({ rating: pickRating(obj), text });
      }
    }
    for (const child of Object.values(obj)) walk(child, depth + 1);
  };

  walk(root, 0);
  return out;
}

function pickRating(obj: Record<string, unknown>): number {
  for (const k of RATING_KEYS) {
    const v = Number(obj[k]);
    // 5점 만점을 벗어나면 별점이 아니다 (리뷰 번호나 도움돼요 수일 수 있다)
    if (Number.isFinite(v) && v > 0 && v <= 5) return Math.round(v * 10) / 10;
  }
  return 0;
}

/**
 * 한 건도 못 뽑았을 때 응답이 어떻게 생겼는지 한 줄로 적는다.
 *
 * 길이만 알면 "리뷰가 없는 상품"과 "읽는 법이 바뀐 상품"이 똑같아 보인다.
 * 값은 빼고 키 이름과 타입만 남긴다 — 리뷰 본문은 로그에 남기지 않는다.
 */
export function describeJson(raw: string, maxDepth = 4): string {
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch {
    return `JSON 아님: ${raw.slice(0, 200)}`;
  }
  const shape = (node: unknown, depth: number): string => {
    if (node === null) return 'null';
    if (Array.isArray(node)) return node.length === 0 ? '[]' : `[${node.length}]${depth < maxDepth ? shape(node[0], depth + 1) : ''}`;
    if (typeof node === 'object') {
      if (depth >= maxDepth) return '{…}';
      const keys = Object.keys(node as object);
      const shown = keys.slice(0, 25).map(k => `${k}:${shape((node as any)[k], depth + 1)}`);
      return `{${shown.join(',')}${keys.length > 25 ? ',…' : ''}}`;
    }
    if (typeof node === 'string') return `str(${node.length})`;
    return typeof node;
  };
  return shape(root, 0);
}
