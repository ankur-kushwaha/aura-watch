import { API_BASE, saveSession, clearSession, type AuthSession, type OrgSettings } from './api';

const ADMIN_TOKEN_KEY = 'aura-watch-admin-token';
const IMPERSONATING_KEY = 'aura-watch-impersonating';

export interface AdminOrgSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberCount: number;
  deviceCount: number;
  settings: OrgSettings;
}

export interface AdminOrgMember {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface AdminOrgDetail extends AdminOrgSummary {
  members: AdminOrgMember[];
}

export function getAdminToken(): string | null {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

export function saveAdminToken(token: string): void {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

export function isAdminLoggedIn(): boolean {
  return !!getAdminToken();
}

export function isImpersonating(): boolean {
  return sessionStorage.getItem(IMPERSONATING_KEY) === 'true';
}

function setImpersonating(value: boolean): void {
  if (value) {
    sessionStorage.setItem(IMPERSONATING_KEY, 'true');
  } else {
    sessionStorage.removeItem(IMPERSONATING_KEY);
  }
}

export function exitImpersonation(): void {
  clearSession();
  setImpersonating(false);
}

async function adminFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getAdminToken();
  const headers = new Headers(options.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

export async function adminLogin(password: string): Promise<void> {
  const res = await adminFetch('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Invalid admin password');
  }

  const data = await res.json();
  saveAdminToken(data.token);
}

export async function fetchAdminOrgs(): Promise<AdminOrgSummary[]> {
  const res = await adminFetch('/admin/orgs');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to load organizations');
  }
  return res.json();
}

export async function fetchAdminOrg(orgId: string): Promise<AdminOrgDetail> {
  const res = await adminFetch(`/admin/orgs/${orgId}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to load organization');
  }
  return res.json();
}

export async function impersonateOrg(orgId: string): Promise<AuthSession> {
  const res = await adminFetch(`/admin/orgs/${orgId}/impersonate`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to impersonate organization');
  }

  const data = await res.json();
  const session: AuthSession = {
    token: data.token,
    user: data.user,
    org: data.org,
    orgs: data.orgs ?? [data.org],
  };
  setImpersonating(true);
  saveSession(session);
  return session;
}

export function adminLogout(): void {
  clearAdminToken();
  exitImpersonation();
}
