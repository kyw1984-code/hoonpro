/**
 * 이 요청을 받아 줄 것인가 — 한 곳에서 정한다.
 *
 * 두 가지를 함께 본다.
 *
 * 1) 이 사람이 아직 우리 회원인가
 *    예전에는 users.status와 withdrawn_at을 로그인할 때만 봤다. 토큰은 7일짜리라,
 *    관리자가 회원을 거절하거나 본인이 탈퇴해도 그 토큰으로 최대 7일을 더 쓸 수
 *    있었다. 화면에는 거절됨으로 뜨는데 실제로는 계속 돈 드는 기능을 쓴다.
 *    isAdmin도 토큰에 박혀 있어, 관리자 권한을 거두려면 ADMIN_EMAIL을 바꾸고
 *    7일을 기다려야 했다.
 *
 * 2) 유료화가 켜졌다면 유효한 구독이 있는가
 *    이 검사가 파일 여섯 곳에 그대로 복사돼 있었다. 한도 0의 뜻을 뒤집을 때
 *    다섯 곳 중 세 곳만 고쳐져 사고가 났던 것과 같은 구조다.
 *
 * 조회를 병렬로 묶어 왕복 횟수는 예전과 같다.
 */

/** 구독이 살아 있다고 볼 상태 */
const LIVE_SUBSCRIPTION = ['trial', 'active', 'past_due'];

export type AccessDenial = {
  status: number;
  body: Record<string, unknown>;
};

/** 부르는 쪽이 supabase 타입에 얽매이지 않게 최소한만 요구한다 */
export interface GateRows {
  /** users 한 줄 — 못 찾으면 null */
  user: { status: string | null; withdrawn_at: string | null } | null;
  /** app_config의 billing_enforced 값 */
  billingEnforced: boolean;
  /** subscriptions 한 줄 — 없으면 null */
  subscription: { status: string | null } | null;
  /** 조회 자체가 실패했나 */
  lookupFailed?: boolean;
}

/**
 * 조회 결과를 보고 막을지 정한다. 순수 함수라 테스트로 고정할 수 있다.
 *
 * 관리자는 회원 상태만 본다. 유료화 게이트는 건너뛴다 — 운영자가 자기 서비스를
 * 구독해야 볼 수 있으면 장애 대응을 못 한다.
 */
export function decideAccess(rows: GateRows, isAdmin: boolean): AccessDenial | null {
  // 조회가 실패하면 막지 않는다. 여기서 막으면 DB가 잠깐 흔들릴 때 전원이
  // 로그아웃된 것처럼 보인다. 한도와 달리 이건 막아도 돈이 절약되지 않는다.
  if (rows.lookupFailed) return null;

  // 회원이 사라졌다 = 토큰은 유효한데 계정이 없다
  if (!rows.user) {
    return { status: 401, body: { error: '계정을 찾을 수 없습니다. 다시 로그인해주세요.', reauth: true } };
  }
  if (rows.user.withdrawn_at) {
    return { status: 401, body: { error: '탈퇴한 계정입니다.', reauth: true } };
  }
  if (rows.user.status === 'rejected') {
    return { status: 403, body: { error: '이용이 중지된 계정입니다. 문의해주세요.', reauth: true } };
  }
  if (rows.user.status === 'pending') {
    return { status: 403, body: { error: '가입 승인 대기 중입니다.', reauth: true } };
  }

  if (isAdmin) return null;

  if (rows.billingEnforced && !LIVE_SUBSCRIPTION.includes(String(rows.subscription?.status ?? ''))) {
    return {
      status: 402,
      body: {
        error: '구독 후 이용할 수 있습니다. [구독 관리] 탭에서 구독을 시작해주세요.',
        subscriptionRequired: true,
      },
    };
  }

  return null;
}

/**
 * 실제 조회까지 해서 막을지 정한다.
 *
 * supabase 클라이언트를 그대로 받는다. 타입을 any로 두는 이유는 이 파일이
 * 서버리스 함수 여러 개에서 import되는데 각자 클라이언트 타입이 조금씩
 * 다르기 때문이다. 안에서 쓰는 것은 from/select/eq뿐이다.
 */
export async function checkAccess(
  supabase: any,
  userId: string,
  isAdmin: boolean,
): Promise<AccessDenial | null> {
  if (!supabase || !userId) return null;
  try {
    const [userRes, cfgRes, subRes] = await Promise.all([
      supabase.from('users').select('status, withdrawn_at').eq('id', userId).maybeSingle(),
      supabase.from('app_config').select('value').eq('key', 'billing_enforced').maybeSingle(),
      supabase.from('subscriptions').select('status').eq('user_id', userId).maybeSingle(),
    ]);
    // 회원 조회가 실패한 것과 회원이 없는 것은 다르다. 앞은 우리 잘못이라
    // 막지 않고, 뒤는 막는다.
    if (userRes?.error) return decideAccess({ user: null, billingEnforced: false, subscription: null, lookupFailed: true }, isAdmin);
    return decideAccess({
      user: userRes?.data ?? null,
      billingEnforced: cfgRes?.data?.value === 'true',
      subscription: subRes?.data ?? null,
    }, isAdmin);
  } catch {
    // 여기서 막으면 DB가 흔들릴 때 전원이 튕긴다
    return null;
  }
}
