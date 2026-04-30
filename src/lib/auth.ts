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

  const res = await fetch('/api/usage/track', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'API 호출 한도를 초과했습니다.');

  window.dispatchEvent(new CustomEvent('usage-updated', { detail: { remaining: data.remaining } }));
}
