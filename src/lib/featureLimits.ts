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

// ── 한도 소진 판정 ───────────────────────────────────────────────────────────

/** increment_feature_usage가 돌려주는 모양 */
export interface UsageRpcResult {
  exceeded?: boolean;
  disabled?: boolean;
  remaining?: number;
}

/**
 * 갈래마다 kind를 둔다. 허용 쪽에만 kind가 없으면 `if (!d.allow)`로 좁혀도
 * 타입이 갈라지지 않아 부르는 쪽에서 d.kind를 못 읽는다.
 */
export type QuotaDecision =
  /** 써도 된다 */
  | { allow: true; kind: 'ok'; remaining: number | null }
  /** 내린 기능이다 */
  | { allow: false; kind: 'disabled'; remaining: null }
  /** 오늘 몫을 다 썼다 */
  | { allow: false; kind: 'exceeded'; remaining: 0 }
  /** 셀 수가 없다 — 세지 못하면 내주지 않는다 */
  | { allow: false; kind: 'error'; remaining: null };

/**
 * 한도 집계 결과를 보고 내줄지 정한다.
 *
 * 핵심은 오류일 때의 처신이다. supabase.rpc는 실패해도 예외를 던지지 않고
 * { data: null, error }를 돌려준다. 그런데 부르는 쪽이 `if (!error && data.exceeded)`
 * 로 검사하고 있어서, 오류가 나면 그냥 통과했다. try/catch는 잡을 것이 없으니
 * 소용이 없었고, 로그도 남지 않았다.
 *
 * 이 기능들은 호출마다 실제 돈이 나간다. 함수 이름이 바뀌거나 DB가 잠깐
 * 붐비기만 해도 모든 사용자의 한도가 통째로 풀린다. 그래서 셀 수 없으면
 * 내주지 않는다. 잠깐 못 쓰는 쪽이, 한도 없이 돈이 나가는 쪽보다 낫다.
 *
 * 다만 무제한인 기능은 애초에 셀 것이 없으므로 오류여도 내준다. 셈이 필요
 * 없는데 셈이 안 된다고 막으면 그건 그냥 고장이다.
 */
export function decideQuota(
  limit: number,
  rpc: { data: UsageRpcResult | null; error: unknown } | null,
): QuotaDecision {
  const state = limitState(limit);
  // 내린 기능은 무엇을 세든 결론이 같다
  if (state === 'disabled') return { allow: false, kind: 'disabled', remaining: null };

  if (!rpc || rpc.error) {
    // 셀 것이 없는 기능은 셈이 안 돼도 상관없다
    if (state === 'unlimited') return { allow: true, kind: 'ok', remaining: null };
    return { allow: false, kind: 'error', remaining: null };
  }

  const data = rpc.data;
  // 오류는 아닌데 결과가 비었다 — RPC 모양이 바뀐 것이다. 이것도 셈 실패다.
  if (!data || typeof data !== 'object') {
    if (state === 'unlimited') return { allow: true, kind: 'ok', remaining: null };
    return { allow: false, kind: 'error', remaining: null };
  }

  if (data.exceeded) {
    // RPC가 '내린 기능'이라고 말하면 그 말을 따른다
    if (data.disabled) return { allow: false, kind: 'disabled', remaining: null };
    return { allow: false, kind: 'exceeded', remaining: 0 };
  }

  return { allow: true, kind: 'ok', remaining: typeof data.remaining === 'number' ? data.remaining : null };
}

/** 막혔을 때 사용자에게 보여줄 문구와 응답 코드 */
export function quotaResponse(
  decision: Extract<QuotaDecision, { allow: false }>,
  featureLabel: string,
  limit: number,
): { status: number; body: Record<string, unknown> } {
  if (decision.kind === 'disabled') {
    return {
      status: 403,
      body: { error: `${featureLabel}은(는) 현재 제공하지 않습니다.`, disabled: true },
    };
  }
  if (decision.kind === 'exceeded') {
    return {
      status: 429,
      body: { error: `${featureLabel}은(는) 하루 ${limit}회까지입니다. 내일 다시 이용해주세요.` },
    };
  }
  // 셈 실패 — 사용자 잘못이 아니므로 그렇게 말한다
  return {
    status: 503,
    body: { error: '사용량을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.', retryable: true },
  };
}
