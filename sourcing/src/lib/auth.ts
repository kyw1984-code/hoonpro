export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  trialStartedAt: number; // ms epoch
  trialExpiresAt: number; // ms epoch
}

const TOKEN_KEY = 'sourcing_token';
export const TRIAL_DAYS = 7;

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
      trialStartedAt: payload.trialStartedAt,
      trialExpiresAt: payload.trialExpiresAt,
    };
  } catch {
    removeToken();
    return null;
  }
}

export function getRemainingDays(user: AuthUser): number {
  const ms = user.trialExpiresAt - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}
