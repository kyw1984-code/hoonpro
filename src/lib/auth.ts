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

export function getUser(): AuthUser | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
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

export async function trackUsage(): Promise<void> {
  const token = getToken();
  if (!token) throw new Error('로그인이 필요합니다.');

  const res = await fetch('/api/usage?action=track', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'API 호출 한도를 초과했습니다.');

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
