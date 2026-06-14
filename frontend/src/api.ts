const API_BASE = import.meta.env.DEV ? 'http://localhost:5000/api' : `${window.location.origin}/api`;

const TOKEN_KEY = 'aura-watch-token';
const ORG_KEY = 'aura-watch-org';

export interface AuthOrg {
  id: string;
  name: string;
  slug: string;
  role?: string;
}

export interface OrgSettings {
  videoSummary: boolean;
  semanticSearch: boolean;
  aiChat: boolean;
  reidProcessing: boolean;
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  videoSummary: true,
  semanticSearch: true,
  aiChat: true,
  reidProcessing: true,
};

export interface OrgMember {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
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

export async function fetchMe(): Promise<{
  user: AuthUser;
  org: AuthOrg | null;
  orgs: AuthOrg[];
  settings: OrgSettings | null;
}> {
  const res = await apiFetch('/auth/me');
  if (!res.ok) {
    throw new Error('Session expired');
  }
  return res.json();
}

export async function fetchOrgSettings(orgId: string): Promise<{ settings: OrgSettings; role: string }> {
  const res = await apiFetch(`/orgs/${orgId}/settings`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch organization settings');
  }
  return res.json();
}

export async function updateOrgSettings(
  orgId: string,
  settings: Partial<OrgSettings>,
): Promise<OrgSettings> {
  const res = await apiFetch(`/orgs/${orgId}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update organization settings');
  }
  const data = await res.json();
  return data.settings;
}

export async function fetchOrgMembers(orgId: string): Promise<OrgMember[]> {
  const res = await apiFetch(`/orgs/${orgId}/members`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch organization members');
  }
  return res.json();
}

export async function addOrgMember(
  orgId: string,
  payload: { email: string; name?: string; password?: string; role?: string },
): Promise<OrgMember> {
  const res = await apiFetch(`/orgs/${orgId}/members`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to add organization member');
  }
  return res.json();
}

export async function removeOrgMember(orgId: string, userId: string): Promise<void> {
  const res = await apiFetch(`/orgs/${orgId}/members/${userId}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to remove organization member');
  }
}

export async function generateClipAiSummary(clipId: string): Promise<ClipAiSummaryResult> {
  const res = await apiFetch(`/clips/${clipId}/ai-summary`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to generate AI summary');
  }
  return res.json();
}

export { API_BASE };
