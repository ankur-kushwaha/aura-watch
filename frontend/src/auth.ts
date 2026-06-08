export const AUTH_USERNAME = 'admin';
export const AUTH_PASSWORD = 'aurawatch';

const AUTH_STORAGE_KEY = 'aura-watch-authenticated';

export function isLoggedIn(): boolean {
  return sessionStorage.getItem(AUTH_STORAGE_KEY) === 'true';
}

export function setLoggedIn(): void {
  sessionStorage.setItem(AUTH_STORAGE_KEY, 'true');
}

export function clearLoggedIn(): void {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
}

export function validateCredentials(username: string, password: string): boolean {
  return username === AUTH_USERNAME && password === AUTH_PASSWORD;
}
