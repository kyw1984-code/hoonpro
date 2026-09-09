/**
 * 기능별 일일 한도 — 서버·화면·테스트가 같은 규칙을 쓴다.
 *
 * 값의 뜻:
 *   0    = 사용 중지 (기능을 내릴 때)
 *   음수 = 무제한
 *   양수 = 하루 그 횟수까지
 *
 * 예전에는 0이 무제한이었다. 기능을 끄려고 0을 넣으면 정반대로 무제한이 되는
 * 함정이라 뒤집었는데, 그때 같은 판정이 파일 다섯 곳에 복사돼 있어서 세 곳만
 * 고쳐졌다. 남은 곳은 무제한(-1)을 0으로 뭉개 코칭AI를 아예 막아 버렸다.
 * 규칙이 한 곳에 있으면 그런 어긋남이 생기지 않는다.
 */

/** 사용 중지 */
export const LIMIT_DISABLED = 0;
/** 무제한 */
export const LIMIT_UNLIMITED = -1;

/** 한 사람이 하루에 부를 수 있는 최대치 — 실수로 큰 값을 넣어도 여기서 걸린다 */
const LIMIT_MAX = 100000;

/**
 * 기본값. 세 API가 각자 복사해 두고 있었고, 그러다 sourcing 쪽에서 inquiry가
 * 빠져 있었다. 한 곳에 둔다.
 */
export const DEFAULT_FEATURE_LIMITS: Record<string, number> = {
  image: 0,      // 썸네일·상세페이지 이미지 — 내린 기능이라 0(사용 중지)
  qa: 100,       // 코칭AI — 사실상 무제한, 스크립트 남용만 차단
  sourcing: 60,  // 소싱 상품 수집
  reviews: 20,   // 리뷰 수집 + GPT 요약
  rank: 100,     // 순위 확인 — 깊은 조회가 검색 페이지를 최대 5장까지 넘기고
                 //             페이지마다 1회씩 세므로 40이면 하루 8번뿐이다
  analyze: 40,   // 경쟁상품·이미지 분석
  inquiry: 60,   // 쿠팡 고객문의 답변 초안 (건당 약 2원)
  general: 200,  // 기획·문구 생성, 이미지 검수 등 내부 호출
};

/**
 * 저장된 값 하나를 한도로 다듬는다.
 *
 * Number(null)과 Number('')은 0이다. 값을 안 보낸 항목이 '사용 중지'로 저장되면
 * 기능이 통째로 꺼지므로, 빈 값은 숫자로 치지 않고 기본값으로 돌린다.
 */
export function clampLimit(raw: unknown, fallback: number): number {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  // 음수는 전부 무제한(-1)으로 모은다. 0은 살려 둬야 '사용 중지'가 된다.
  return Math.min(LIMIT_MAX, Math.max(LIMIT_UNLIMITED, Math.round(n)));
}

export type LimitState = 'disabled' | 'unlimited' | 'counted';

/** 이 한도가 무엇을 뜻하는지 — 문구와 응답 코드를 여기에 맞춘다 */
export function limitState(limit: number): LimitState {
  if (limit === 0) return 'disabled';
  return limit < 0 ? 'unlimited' : 'counted';
}

/** 사용 중지된 기능인가 */
export function isDisabled(limit: number): boolean {
  return limitState(limit) === 'disabled';
}

/**
 * app_config에 저장된 JSON을 기본값 위에 얹는다.
 * 모르는 키는 버린다 — 오타 하나로 없는 기능의 한도가 생기지 않게 한다.
 */
export function mergeLimits(
  stored: unknown,
  defaults: Record<string, number> = DEFAULT_FEATURE_LIMITS,
): Record<string, number> {
  const merged = { ...defaults };
  if (!stored || typeof stored !== 'object') return merged;
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    if (k in merged) merged[k] = clampLimit(v, merged[k]);
  }
  return merged;
}

/** app_config에서 읽은 문자열을 그대로 넘겨도 되게 */
export function parseLimits(
  value: string | null | undefined,
  defaults: Record<string, number> = DEFAULT_FEATURE_LIMITS,
): Record<string, number> {
  if (!value) return { ...defaults };
  try {
    return mergeLimits(JSON.parse(value), defaults);
  } catch {
    return { ...defaults };
  }
}
