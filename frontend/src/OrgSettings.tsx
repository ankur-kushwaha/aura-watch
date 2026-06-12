import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Sparkles,
  Fingerprint,
  Search,
  MessageSquare,
  Save,
  Loader2,
  Users,
  UserPlus,
  Trash2,
} from 'lucide-react';
import {
  fetchOrgSettings,
  updateOrgSettings,
  fetchOrgMembers,
  addOrgMember,
  removeOrgMember,
  type OrgSettings,
  type OrgMember,
  type AuthOrg,
} from './api';

interface SettingRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

function SettingRow({ icon, title, description, checked, disabled, onChange }: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-[rgba(255,255,255,0.06)] last:border-b-0">
      <div className="flex gap-3 min-w-0">
        <div className="mt-0.5 text-primary shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-[0.9rem] font-semibold text-text-primary">{title}</p>
          <p className="text-[0.78rem] text-text-muted leading-relaxed mt-0.5">{description}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
          checked ? 'bg-primary' : 'bg-[rgba(255,255,255,0.12)]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

interface OrgSettingsPageProps {
  org: AuthOrg;
  currentUserId: string;
  onBack: () => void;
  onSettingsSaved: (settings: OrgSettings) => void;
}

export default function OrgSettingsPage({
  org,
  currentUserId,
  onBack,
  onSettingsSaved,
}: OrgSettingsPageProps) {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [draft, setDraft] = useState<OrgSettings | null>(null);
  const [role, setRole] = useState<string>('member');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addName, setAddName] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addRole, setAddRole] = useState('member');

  const canEdit = role === 'owner' || role === 'admin';

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    setMembersError(null);
    try {
      const data = await fetchOrgMembers(org.id);
      setMembers(data);
    } catch (err: unknown) {
      setMembersError(err instanceof Error ? err.message : 'Failed to load members');
    } finally {
      setLoadingMembers(false);
    }
  }, [org.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchOrgSettings(org.id), fetchOrgMembers(org.id)])
      .then(([settingsData, membersData]) => {
        if (cancelled) return;
        setSettings(settingsData.settings);
        setDraft(settingsData.settings);
        setRole(settingsData.role);
        setMembers(membersData);
        setLoadingMembers(false);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org.id]);

  const hasChanges = draft && settings && JSON.stringify(draft) !== JSON.stringify(settings);

  const updateDraft = (key: keyof OrgSettings, value: boolean) => {
    if (!draft) return;
    const next = { ...draft, [key]: value };
    if (key === 'videoSummary' && !value) {
      next.semanticSearch = false;
    }
    if (key === 'semanticSearch' && value && !next.videoSummary) {
      next.videoSummary = true;
    }
    setDraft(next);
    setSaveMessage(null);
  };

  const handleSave = async () => {
    if (!draft || !canEdit) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const updated = await updateOrgSettings(org.id, draft);
      setSettings(updated);
      setDraft(updated);
      onSettingsSaved(updated);
      setSaveMessage('Settings saved.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setAddingMember(true);
    setMembersError(null);
    try {
      const payload: { email: string; name?: string; password?: string; role: string } = {
        email: addEmail.trim(),
        role: addRole,
      };
      if (addName.trim()) payload.name = addName.trim();
      if (addPassword) payload.password = addPassword;

      await addOrgMember(org.id, payload);
      setAddEmail('');
      setAddName('');
      setAddPassword('');
      setAddRole('member');
      await loadMembers();
    } catch (err: unknown) {
      setMembersError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (member: OrgMember) => {
    if (!canEdit) return;
    if (member.userId === currentUserId) return;
    if (members.length <= 1) return;
    if (!confirm(`Remove ${member.name} (${member.email}) from this organization?`)) return;

    setRemovingUserId(member.userId);
    setMembersError(null);
    try {
      await removeOrgMember(org.id, member.userId);
      await loadMembers();
    } catch (err: unknown) {
      setMembersError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setRemovingUserId(null);
    }
  };

  const canRemoveMember = (member: OrgMember) => {
    if (!canEdit) return false;
    if (member.userId === currentUserId) return false;
    if (members.length <= 1) return false;
    if (member.role === 'owner' && role !== 'owner') return false;
    return true;
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={onBack}
          className="btn btn-secondary py-2 px-3 text-[0.85rem] flex items-center gap-2"
        >
          <ArrowLeft size={16} /> Back to dashboard
        </button>
        {canEdit && draft && (
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="btn btn-primary py-2 px-4 text-[0.85rem] flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save changes
          </button>
        )}
      </div>

      <div className="glass-panel p-6 mb-6">
        <div className="mb-6">
          <h1 className="text-[1.4rem] font-bold text-gradient-purple">Organization Settings</h1>
          <p className="text-[0.85rem] text-text-muted mt-1">
            Configure features for <span className="text-text-secondary font-medium">{org.name}</span>.
            {!canEdit && ' You have read-only access.'}
          </p>
        </div>

        {loading && (
          <p className="text-[0.85rem] text-text-muted flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading settings…
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[0.85rem] text-red-300 mb-4">
            {error}
          </div>
        )}

        {saveMessage && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-[0.85rem] text-emerald-300 mb-4">
            {saveMessage}
          </div>
        )}

        {draft && !loading && (
          <div className="flex flex-col">
            <p className="text-[0.7rem] font-bold uppercase tracking-wider text-text-muted mb-2">
              Video Processing
            </p>
            <SettingRow
              icon={<Sparkles size={18} />}
              title="Video summary"
              description="Generate AI summaries when clips are uploaded. Hides summaries in the event archive when off."
              checked={draft.videoSummary}
              disabled={!canEdit}
              onChange={(v) => updateDraft('videoSummary', v)}
            />
            <SettingRow
              icon={<Fingerprint size={18} />}
              title="ReID processing"
              description="Extract person profiles from clip track events. Hides detection details in the event archive when off."
              checked={draft.reidProcessing}
              disabled={!canEdit}
              onChange={(v) => updateDraft('reidProcessing', v)}
            />

            <p className="text-[0.7rem] font-bold uppercase tracking-wider text-text-muted mb-2 mt-6">
              AI &amp; Search
            </p>
            <SettingRow
              icon={<Search size={18} />}
              title="Semantic search indexing"
              description="Index clip summaries for natural-language search. Requires video summary."
              checked={draft.semanticSearch}
              disabled={!canEdit || !draft.videoSummary}
              onChange={(v) => updateDraft('semanticSearch', v)}
            />
            <SettingRow
              icon={<MessageSquare size={18} />}
              title="Ask Camera AI"
              description="Show the AI chat tab to query footage using natural language."
              checked={draft.aiChat}
              disabled={!canEdit}
              onChange={(v) => updateDraft('aiChat', v)}
            />
          </div>
        )}
      </div>

      <div className="glass-panel p-6">
        <div className="mb-5">
          <h2 className="text-[1.1rem] font-bold flex items-center gap-2">
            <Users size={18} className="text-primary" /> Members
          </h2>
          <p className="text-[0.85rem] text-text-muted mt-1">
            Manage who has access to this organization.
          </p>
        </div>

        {membersError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[0.85rem] text-red-300 mb-4">
            {membersError}
          </div>
        )}

        {loadingMembers ? (
          <p className="text-[0.85rem] text-text-muted flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading members…
          </p>
        ) : (
          <div className="flex flex-col gap-2 mb-6">
            {members.map((member) => {
              const isSelf = member.userId === currentUserId;
              const removable = canRemoveMember(member);
              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-glass bg-[rgba(255,255,255,0.02)] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-[0.85rem] font-semibold text-text-primary truncate">
                      {member.name}
                      {isSelf && (
                        <span className="text-[0.7rem] font-normal text-text-muted ml-1.5">(you)</span>
                      )}
                    </p>
                    <p className="text-[0.75rem] text-text-muted truncate">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[0.7rem] px-2 py-0.5 rounded-full border border-border-glass text-text-secondary capitalize">
                      {member.role}
                    </span>
                    {removable ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(member)}
                        disabled={removingUserId === member.userId}
                        className="btn btn-secondary p-1.5 text-danger hover:border-danger/40"
                        title={`Remove ${member.name}`}
                      >
                        {removingUserId === member.userId ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    ) : isSelf ? (
                      <span className="text-[0.68rem] text-text-muted px-1">Cannot remove yourself</span>
                    ) : members.length <= 1 ? (
                      <span className="text-[0.68rem] text-text-muted px-1">Last member</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {canEdit && (
          <form onSubmit={handleAddMember} className="border-t border-[rgba(255,255,255,0.06)] pt-5">
            <p className="text-[0.8rem] font-semibold text-text-secondary mb-3 flex items-center gap-2">
              <UserPlus size={16} /> Add member
            </p>
            <p className="text-[0.75rem] text-text-muted mb-3 leading-relaxed">
              Add an existing user by email, or create a new account by also providing a name and password.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[0.75rem] text-text-secondary">Email</label>
                <input
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="user@example.com"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[0.75rem] text-text-secondary">Role</label>
                <select value={addRole} onChange={(e) => setAddRole(e.target.value)}>
                  <option value="viewer">Viewer</option>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  {role === 'owner' && <option value="owner">Owner</option>}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[0.75rem] text-text-secondary">Name (new users)</label>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="Full name"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[0.75rem] text-text-secondary">Password (new users)</label>
                <input
                  type="password"
                  value={addPassword}
                  onChange={(e) => setAddPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  minLength={8}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={addingMember || !addEmail.trim()}
              className="btn btn-primary py-2 px-4 text-[0.85rem] flex items-center gap-2 disabled:opacity-50"
            >
              {addingMember ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
              Add member
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
