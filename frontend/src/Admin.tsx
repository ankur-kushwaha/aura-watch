import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Cpu,
  ExternalLink,
  Eye,
  Loader2,
  LogOut,
  Shield,
  Sparkles,
  Fingerprint,
  Search,
  MessageSquare,
  Users,
} from 'lucide-react';
import {
  adminLogin,
  adminLogout,
  fetchAdminOrg,
  fetchAdminOrgs,
  impersonateOrg,
  isAdminLoggedIn,
  type AdminOrgDetail,
  type AdminOrgSummary,
} from './adminApi';
import type { OrgSettings } from './api';

function AdminLogin() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await adminLogin(password);
      navigate('/admin/orgs', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative">
      <Link to="/" className="absolute top-6 left-6 btn btn-secondary text-[0.85rem] py-2 px-3">
        <ArrowLeft size={16} />
        Back
      </Link>
      <div className="glass-panel w-full max-w-[420px] p-8">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="bg-primary p-3 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(124,58,237,0.2)] mb-4">
            <Shield size={28} color="white" />
          </div>
          <h1 className="text-gradient-purple text-[1.75rem] font-extrabold mb-1">Super Admin</h1>
          <p className="text-[0.85rem] text-text-muted">View all organizations and impersonate org admins</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="admin-password" className="text-[0.8rem] text-text-secondary">
              Admin password
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter admin password"
              autoComplete="current-password"
              required
              disabled={submitting}
            />
          </div>

          {error && (
            <p className="text-[0.8rem] text-danger bg-[rgba(244,63,94,0.1)] border border-[rgba(244,63,94,0.25)] rounded-lg py-2 px-3">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary w-full mt-2" disabled={submitting}>
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
            Enter admin console
          </button>
        </form>
      </div>
    </div>
  );
}

function SettingsReadOnly({ settings }: { settings: OrgSettings }) {
  const rows = [
    {
      icon: <Sparkles size={18} />,
      title: 'Video summaries',
      description: 'AI-generated descriptions for recorded clips.',
      enabled: settings.videoSummary,
    },
    {
      icon: <Search size={18} />,
      title: 'Semantic search',
      description: 'Index clips for natural-language search.',
      enabled: settings.semanticSearch,
    },
    {
      icon: <MessageSquare size={18} />,
      title: 'AI chat',
      description: 'Ask questions about your footage.',
      enabled: settings.aiChat,
    },
    {
      icon: <Fingerprint size={18} />,
      title: 'ReID processing',
      description: 'Person re-identification across cameras.',
      enabled: settings.reidProcessing,
    },
  ];

  return (
    <div className="divide-y divide-[rgba(255,255,255,0.06)]">
      {rows.map((row) => (
        <div key={row.title} className="flex items-start justify-between gap-4 py-4">
          <div className="flex gap-3 min-w-0">
            <div className="mt-0.5 text-primary shrink-0">{row.icon}</div>
            <div className="min-w-0">
              <p className="text-[0.9rem] font-semibold text-text-primary">{row.title}</p>
              <p className="text-[0.78rem] text-text-muted leading-relaxed mt-0.5">{row.description}</p>
            </div>
          </div>
          <span
            className={`shrink-0 text-[0.75rem] font-semibold px-2.5 py-1 rounded-full ${
              row.enabled
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : 'bg-[rgba(255,255,255,0.06)] text-text-muted border border-[rgba(255,255,255,0.08)]'
            }`}
          >
            {row.enabled ? 'On' : 'Off'}
          </span>
        </div>
      ))}
    </div>
  );
}

function AdminOrgList() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<AdminOrgSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrgs(await fetchAdminOrgs());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleLogout = () => {
    adminLogout();
    navigate('/admin', { replace: true });
  };

  return (
    <div className="min-h-screen p-6">
      <header className="glass-panel p-5 px-6 flex justify-between items-center mb-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="bg-primary p-2.5 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(124,58,237,0.2)]">
            <Shield size={22} color="white" />
          </div>
          <div>
            <h1 className="text-gradient-purple text-[1.4rem] font-extrabold">Super Admin</h1>
            <p className="text-[0.8rem] text-text-muted">All organizations</p>
          </div>
        </div>
        <button type="button" onClick={handleLogout} className="btn btn-secondary py-1.5 px-3 text-[0.8rem]">
          <LogOut size={14} /> Logout
        </button>
      </header>

      <div className="max-w-6xl mx-auto">
        {loading && (
          <p className="text-text-muted flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading organizations…
          </p>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[0.85rem] text-red-300 mb-4">
            {error}
          </div>
        )}
        {!loading && !error && orgs.length === 0 && (
          <p className="text-text-muted">No organizations found.</p>
        )}
        {!loading && orgs.length > 0 && (
          <div className="glass-panel overflow-hidden">
            <table className="w-full text-left text-[0.85rem]">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.08)] text-text-muted">
                  <th className="py-3 px-4 font-medium">Organization</th>
                  <th className="py-3 px-4 font-medium">Slug</th>
                  <th className="py-3 px-4 font-medium">Members</th>
                  <th className="py-3 px-4 font-medium">Devices</th>
                  <th className="py-3 px-4 font-medium">Created</th>
                  <th className="py-3 px-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => (
                  <tr
                    key={org.id}
                    className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.02)]"
                  >
                    <td className="py-3 px-4 font-medium text-text-primary">{org.name}</td>
                    <td className="py-3 px-4 text-text-muted">{org.slug}</td>
                    <td className="py-3 px-4 text-text-secondary">{org.memberCount}</td>
                    <td className="py-3 px-4 text-text-secondary">{org.deviceCount}</td>
                    <td className="py-3 px-4 text-text-muted">
                      {new Date(org.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/orgs/${org.id}`)}
                        className="btn btn-secondary py-1.5 px-3 text-[0.78rem]"
                      >
                        <Eye size={14} /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminOrgDetail() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [org, setOrg] = useState<AdminOrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAdminOrg(orgId)
      .then((data) => {
        if (!cancelled) setOrg(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load organization');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const openAsAdmin = async (path: string) => {
    if (!orgId) return;
    setImpersonating(true);
    setError(null);
    try {
      await impersonateOrg(orgId);
      navigate(path, { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to impersonate');
      setImpersonating(false);
    }
  };

  if (!orgId) {
    return <Navigate to="/admin/orgs" replace />;
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto">
        <button
          type="button"
          onClick={() => navigate('/admin/orgs')}
          className="btn btn-secondary py-2 px-3 text-[0.85rem] flex items-center gap-2 mb-6"
        >
          <ArrowLeft size={16} /> All organizations
        </button>

        {loading && (
          <p className="text-text-muted flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading organization…
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[0.85rem] text-red-300 mb-4">
            {error}
          </div>
        )}

        {org && !loading && (
          <>
            <div className="glass-panel p-6 mb-6">
              <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="bg-primary/20 p-2.5 rounded-xl text-primary">
                    <Building2 size={22} />
                  </div>
                  <div>
                    <h1 className="text-[1.4rem] font-bold text-gradient-purple">{org.name}</h1>
                    <p className="text-[0.85rem] text-text-muted">
                      {org.slug} · {org.memberCount} members · {org.deviceCount} devices
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={impersonating}
                    onClick={() => openAsAdmin('/app/events')}
                    className="btn btn-primary py-2 px-4 text-[0.85rem] flex items-center gap-2"
                  >
                    {impersonating ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <ExternalLink size={16} />
                    )}
                    Open app as admin
                  </button>
                  <button
                    type="button"
                    disabled={impersonating}
                    onClick={() => openAsAdmin('/app/settings')}
                    className="btn btn-secondary py-2 px-4 text-[0.85rem] flex items-center gap-2"
                  >
                    <Cpu size={16} /> Open settings UI
                  </button>
                </div>
              </div>
              <p className="text-[0.78rem] text-text-muted">
                Impersonation signs you in as the org&apos;s owner or admin so you see the same UI they would.
              </p>
            </div>

            <div className="glass-panel p-6 mb-6">
              <h2 className="text-[1.1rem] font-bold text-text-primary mb-1">Feature settings</h2>
              <p className="text-[0.8rem] text-text-muted mb-4">Read-only view of organization feature flags.</p>
              <SettingsReadOnly settings={org.settings} />
            </div>

            <div className="glass-panel p-6">
              <div className="flex items-center gap-2 mb-4">
                <Users size={18} className="text-primary" />
                <h2 className="text-[1.1rem] font-bold text-text-primary">Members</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[0.85rem]">
                  <thead>
                    <tr className="border-b border-[rgba(255,255,255,0.08)] text-text-muted">
                      <th className="py-2 px-3 font-medium">Name</th>
                      <th className="py-2 px-3 font-medium">Email</th>
                      <th className="py-2 px-3 font-medium">Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {org.members.map((member) => (
                      <tr key={member.id} className="border-b border-[rgba(255,255,255,0.04)]">
                        <td className="py-2.5 px-3 text-text-primary">{member.name}</td>
                        <td className="py-2.5 px-3 text-text-muted">{member.email}</td>
                        <td className="py-2.5 px-3">
                          <span className="text-[0.75rem] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25">
                            {member.role}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AdminProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAdminLoggedIn()) {
    return <Navigate to="/admin" replace />;
  }
  return children;
}

export default function Admin() {
  return (
    <Routes>
      <Route
        path="/"
        element={isAdminLoggedIn() ? <Navigate to="/admin/orgs" replace /> : <AdminLogin />}
      />
      <Route
        path="/orgs"
        element={
          <AdminProtectedRoute>
            <AdminOrgList />
          </AdminProtectedRoute>
        }
      />
      <Route
        path="/orgs/:orgId"
        element={
          <AdminProtectedRoute>
            <AdminOrgDetail />
          </AdminProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
