export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

const TOKEN_KEY = 'hoonpro_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * JWT 페이로드를 UTF-8로 안전하게 디코딩한다.
 * atob()는 바이트를 그대로 문자로 돌려주므로 한글 이름이 깨진다
 * (예: '훈' = ED 9B 88 → 'í›ˆ'). 바이트로 되돌린 뒤 UTF-8로 해석해야 한다.
 * JWT는 base64url(-, _)을 쓰고 패딩이 생략되므로 그것도 함께 보정한다.
 */
function decodeJwtPayload(token: string): any {
  const part = token.split('.')[1];
  if (!part) throw new Error('토큰 형식이 올바르지 않습니다.');
  const base64 = part
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(part.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder('utf-8').decode(bytes));
}

export function getUser(): AuthUser | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = decodeJwtPayload(token);
    if (payload.exp * 1000 < Date.now()) {
      removeToken();
      return null;
    }
    return {
      userId: payload.userId,
      email: payload.email,
      name: payload.name,
      isAdmin: payload.isAdmin ?? false,
    };
  } catch {
    removeToken();
    return null;
  }
}

/**
 * 유료화 게이트에 막혔을 때(402) 앱 전체에 알린다.
 * 오류 문구만 띄우면 사용자가 구독 관리 탭을 직접 찾아가야 해서,
 * App이 이 이벤트를 받아 바로 이동할 수 있는 안내를 띄운다.
 */
export function notifySubscriptionRequired(message?: string): void {
  window.dispatchEvent(new CustomEvent('subscription-required', {
    detail: { message: message || '구독 후 이용할 수 있습니다.' },
  }));
}

export async function trackUsage(feature: 'image' | 'analyze' | 'general' = 'general'): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('로그인이 필요합니다.');

  const res = await fetch(`/api/usage?action=track&feature=${feature}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json();
  if (!res.ok) {
    if (res.status === 402) notifySubscriptionRequired(data.error);
    throw new Error(data.error ?? 'API 호출 한도를 초과했습니다.');
  }

  window.dispatchEvent(new CustomEvent('usage-updated', { detail: { remaining: data.remaining } }));
}

interface UsageMetadataLike {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiResponseLike {
  usageMetadata?: UsageMetadataLike;
}

export async function logApiCall(
  feature: string,
  model: string,
  response: GeminiResponseLike | null | undefined,
): Promise<void> {
  const token = getToken();
  if (!token) return;

  const meta = response?.usageMetadata ?? {};
  const inputTokens = meta.promptTokenCount ?? 0;
  const outputTokens = meta.candidatesTokenCount ?? 0;

  try {
    await fetch('/api/usage?action=log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ feature, model, inputTokens, outputTokens }),
    });
  } catch {
    // 로깅 실패는 사용자 흐름을 막지 않음
  }
}
