const API_BASE = import.meta.env.DEV ? 'http://localhost:5000/api' : `${window.location.origin}/api`;

const TOKEN_KEY = 'aura-watch-token';
const ORG_KEY = 'aura-watch-org';

export interface AuthOrg {
  id: string;
  name: string;
  slug: string;
  role?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  org: AuthOrg;
  orgs: AuthOrg[];
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getStoredOrg(): AuthOrg | null {
  const raw = sessionStorage.getItem(ORG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveSession(session: AuthSession): void {
  sessionStorage.setItem(TOKEN_KEY, session.token);
  sessionStorage.setItem(ORG_KEY, JSON.stringify(session.org));
  sessionStorage.setItem('aura-watch-authenticated', 'true');
}

export function clearSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(ORG_KEY);
  sessionStorage.removeItem('aura-watch-authenticated');
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

export async function login(email: string, password: string, orgId?: string): Promise<AuthSession> {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, orgId }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Login failed');
  }

  const data = await res.json();
  const session: AuthSession = {
    token: data.token,
    user: data.user,
    org: data.org,
    orgs: data.orgs ?? [data.org],
  };
  saveSession(session);
  return session;
}

export async function register(
  email: string,
  password: string,
  name: string,
  orgName: string,
): Promise<AuthSession> {
  const res = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name, orgName }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Registration failed');
  }

  const data = await res.json();
  const session: AuthSession = {
    token: data.token,
    user: data.user,
    org: data.org,
    orgs: [data.org],
  };
  saveSession(session);
  return session;
}

export async function switchOrg(orgId: string): Promise<AuthOrg> {
  const res = await apiFetch('/auth/switch-org', {
    method: 'POST',
    body: JSON.stringify({ orgId }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to switch organization');
  }

  const data = await res.json();
  sessionStorage.setItem(TOKEN_KEY, data.token);
  sessionStorage.setItem(ORG_KEY, JSON.stringify(data.org));
  return data.org;
}

export async function fetchMe(): Promise<{ user: AuthUser; org: AuthOrg | null; orgs: AuthOrg[] }> {
  const res = await apiFetch('/auth/me');
  if (!res.ok) {
    throw new Error('Session expired');
  }
  return res.json();
}

export async function createEnrollmentToken(label?: string): Promise<{ token: string; label: string | null }> {
  const org = getStoredOrg();
  if (!org) throw new Error('No organization selected');

  const res = await apiFetch(`/orgs/${org.id}/enrollment-tokens`, {
    method: 'POST',
    body: JSON.stringify({ label }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to create enrollment token');
  }

  return res.json();
}

export { API_BASE };
