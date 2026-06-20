import React, { useEffect, useState, useCallback } from 'react';
import {
  Bell,
  CheckCheck,
  Trash2,
  Video,
  AlertTriangle,
  Info,
  ShieldAlert,
  Cpu,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Save,
  Plus,
  Loader2,
  X,
  Volume2
} from 'lucide-react';
import { fetchOrgMembers, type OrgMember, type AuthOrg } from '../../../api';
import type { AlertRule } from '../../../alertRulesApi';
import {
  fetchAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule
} from '../../../alertRulesApi';
import type { Notification, CameraStream } from '../../types';

export interface ManageNotificationsTabProps {
  notifications: Notification[];
  onMarkRead: (id: string) => Promise<void>;
  onNotificationClick: (n: Notification) => void;
  onDeleteNotification: (id: string) => Promise<void>;
  onClearAllNotifications: () => Promise<void>;
  streams: CameraStream[];
  currentOrg: AuthOrg | null;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function ManageNotificationsTab({
  notifications,
  onMarkRead,
  onNotificationClick,
  onDeleteNotification,
  onClearAllNotifications,
  streams,
  currentOrg
}: ManageNotificationsTabProps) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loadingRules, setLoadingRules] = useState<boolean>(true);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [ruleSubTabs, setRuleSubTabs] = useState<Record<string, 'configure' | 'alerts'>>({});

  // New Rule Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleInstruction, setNewRuleInstruction] = useState('');
  const [newRuleAllStreams, setNewRuleAllStreams] = useState(true);
  const [newRuleStreamIds, setNewRuleStreamIds] = useState<string[]>([]);
  const [newRuleChannels, setNewRuleChannels] = useState<string[]>(['in_app']);
  const [newRuleUserIds, setNewRuleUserIds] = useState<string[]>([]);
  const [newRuleWebhookUrl, setNewRuleWebhookUrl] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit rule draft states
  const [editDrafts, setEditDrafts] = useState<Record<string, Partial<AlertRule>>>({});
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);

  // General Notification accordion state
  const [generalAccordionExpanded, setGeneralAccordionExpanded] = useState(false);

  const loadRules = useCallback(async () => {
    if (!currentOrg) return;
    setLoadingRules(true);
    try {
      const data = await fetchAlertRules();
      setRules(data.rules);
    } catch (err) {
      console.error('Failed to load alert rules:', err);
    } finally {
      setLoadingRules(false);
    }
  }, [currentOrg]);

  const loadMembers = useCallback(async () => {
    if (!currentOrg) return;
    try {
      const data = await fetchOrgMembers(currentOrg.id);
      setMembers(data);
    } catch (err) {
      console.error('Failed to load org members:', err);
    }
  }, [currentOrg]);

  useEffect(() => {
    loadRules();
    loadMembers();
  }, [loadRules, loadMembers]);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleName.trim() || !newRuleInstruction.trim()) return;

    setCreating(true);
    try {
      await createAlertRule({
        name: newRuleName.trim(),
        instruction: newRuleInstruction.trim(),
        allStreams: newRuleAllStreams,
        streamIds: newRuleAllStreams ? [] : newRuleStreamIds,
        channels: newRuleChannels,
        userIds: newRuleUserIds,
        webhookUrl: newRuleWebhookUrl.trim() || null,
      });

      // Reset
      setNewRuleName('');
      setNewRuleInstruction('');
      setNewRuleAllStreams(true);
      setNewRuleStreamIds([]);
      setNewRuleChannels(['in_app']);
      setNewRuleUserIds([]);
      setNewRuleWebhookUrl('');
      setShowAddForm(false);

      await loadRules();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create rule');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateRule = async (id: string) => {
    const draft = editDrafts[id];
    if (!draft) return;

    setSavingRuleId(id);
    try {
      const updated = await updateAlertRule(id, draft);
      setRules((prev) => prev.map((r) => (r.id === id ? updated.rule : r)));
      // clear draft
      setEditDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save rule changes');
    } finally {
      setSavingRuleId(null);
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      const updated = await updateAlertRule(id, { isActive: !currentActive });
      setRules((prev) => prev.map((r) => (r.id === id ? updated.rule : r)));
    } catch (err) {
      console.error('Failed to toggle rule active state:', err);
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm('Are you sure you want to delete this alert rule? This action cannot be undone.')) return;
    try {
      await deleteAlertRule(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
      if (expandedRuleId === id) setExpandedRuleId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete rule');
    }
  };

  const initDraft = (rule: AlertRule) => {
    if (editDrafts[rule.id]) return;
    setEditDrafts((prev) => ({
      ...prev,
      [rule.id]: {
        name: rule.name,
        instruction: rule.instruction,
        allStreams: rule.allStreams,
        streamIds: rule.streamIds,
        channels: rule.channels,
        userIds: rule.userIds,
        webhookUrl: rule.webhookUrl || '',
      },
    }));
  };

  const updateDraft = (ruleId: string, patch: Partial<AlertRule>) => {
    setEditDrafts((prev) => ({
      ...prev,
      [ruleId]: {
        ...(prev[ruleId] || {}),
        ...patch,
      },
    }));
  };

  const getCategoryIcon = (category: string, severity: string) => {
    const baseClass = "w-4 h-4 shrink-0";
    if (severity === 'critical') {
      return <ShieldAlert className={`${baseClass} text-red-500`} />;
    }
    switch (category) {
      case 'surveillance':
        return <Video className={`${baseClass} text-purple-400`} />;
      case 'camera':
        return <AlertTriangle className={`${baseClass} text-amber-500`} />;
      case 'device':
        return <Cpu className={`${baseClass} text-blue-400`} />;
      case 'websocket':
      default:
        return <Info className={`${baseClass} text-cyan-400`} />;
    }
  };

  const getSeverityBadgeClass = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500/20 text-red-300 border-red-500/30';
      case 'error':
        return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
      case 'warn':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      case 'info':
      default:
        return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    }
  };

  // Group notifications by rule ID
  const generalNotifications = notifications.filter((n) => !n.alertRuleId);

  return (
    <div className="flex flex-col gap-6">
      {/* Top Banner Callout */}
      <div className="glass-panel p-5 relative overflow-hidden flex flex-col gap-3">
        <div className="absolute right-0 top-0 w-[300px] h-[300px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex justify-between items-start gap-4 flex-wrap">
          <div>
            <h1 className="text-[1.35rem] font-bold text-gradient-purple">Notification Rules &amp; Logs</h1>
            <p className="text-[0.82rem] text-text-muted mt-1 leading-relaxed max-w-2xl">
              Configure custom security alert criteria using natural language. Aura Watch runs these rules through Gemini AI for every clip, routing events to target users via in-app logs, mock emails, or webhook notifications.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddForm((prev) => !prev)}
              className="btn btn-primary py-2 px-3.5 text-[0.8rem] font-semibold flex items-center gap-1.5 shrink-0"
            >
              <Plus size={15} /> Add Alert Rule
            </button>
            <button
              onClick={() => {
                if (confirm('Clear all triggered alerts?')) onClearAllNotifications();
              }}
              className="btn btn-secondary py-2 px-3 text-[0.8rem] font-semibold flex items-center gap-1.5 shrink-0 hover:text-danger hover:border-danger/30"
              title="Clear all alerts across the organization"
            >
              <Trash2 size={14} /> Clear All Alerts
            </button>
          </div>
        </div>
      </div>

      {/* Add New Rule Form Card */}
      {showAddForm && (
        <form onSubmit={handleCreateRule} className="glass-panel p-6 border border-primary/20 bg-primary/2 flex flex-col gap-4 animate-fadeIn">
          <div className="flex justify-between items-center pb-2.5 border-b border-white/5">
            <h2 className="text-[0.98rem] font-bold text-text-primary flex items-center gap-2">
              <SlidersHorizontal size={16} className="text-primary" /> Create New AI Alert Rule
            </h2>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="btn p-1 bg-transparent text-text-muted hover:text-text-primary border-none"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left Col: Core Details */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[0.78rem] text-text-secondary font-medium">Rule Name</label>
                <input
                  type="text"
                  placeholder="E.g., After-Hours Intrusion"
                  value={newRuleName}
                  onChange={(e) => setNewRuleName(e.target.value)}
                  required
                  className="w-full bg-white/[0.03] border border-border-glass rounded px-3 py-2 text-[0.8rem] text-text-primary"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[0.78rem] text-text-secondary font-medium">AI Alert Criteria (Natural Language)</label>
                <textarea
                  placeholder="E.g., Alert if a person is seen walking near the backdoor between 10pm and 6am, or if someone appears to be tampering with the window."
                  value={newRuleInstruction}
                  onChange={(e) => setNewRuleInstruction(e.target.value)}
                  required
                  rows={4}
                  className="w-full bg-white/[0.03] border border-border-glass rounded px-3 py-2 text-[0.8rem] text-text-primary leading-relaxed resize-none"
                />
                <span className="text-[0.68rem] text-text-muted">Describe the exact activity or conditions that should trigger this alert.</span>
              </div>
            </div>

            {/* Right Col: Targets & Channels */}
            <div className="flex flex-col gap-4">
              {/* Target Streams */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[0.78rem] text-text-secondary font-medium">Applies to Streams</label>
                <div className="flex items-center gap-4 mb-1">
                  <label className="flex items-center gap-2 text-[0.8rem] text-text-secondary cursor-pointer select-none">
                    <input
                      type="radio"
                      name="allStreams"
                      checked={newRuleAllStreams}
                      onChange={() => setNewRuleAllStreams(true)}
                      className="accent-primary"
                    />
                    All Camera Streams
                  </label>
                  <label className="flex items-center gap-2 text-[0.8rem] text-text-secondary cursor-pointer select-none">
                    <input
                      type="radio"
                      name="allStreams"
                      checked={!newRuleAllStreams}
                      onChange={() => setNewRuleAllStreams(false)}
                      className="accent-primary"
                    />
                    Select Specific Streams
                  </label>
                </div>

                {!newRuleAllStreams && (
                  <div className="flex flex-col gap-1.5 max-h-[100px] overflow-y-auto bg-black/20 p-2.5 rounded border border-border-glass">
                    {streams.map((stream) => (
                      <label key={stream.streamId} className="flex items-center gap-2 text-[0.75rem] text-text-secondary cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={newRuleStreamIds.includes(stream.streamId)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewRuleStreamIds([...newRuleStreamIds, stream.streamId]);
                            } else {
                              setNewRuleStreamIds(newRuleStreamIds.filter((id) => id !== stream.streamId));
                            }
                          }}
                          className="w-3.5 h-3.5 accent-[#a78bfa] rounded"
                        />
                        {stream.name} ({stream.deviceId})
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Channels & Recipients */}
              <div className="grid grid-cols-2 gap-3">
                {/* How to Notify */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.78rem] text-text-secondary font-medium">How to Notify</label>
                  <div className="flex flex-col gap-1.5">
                    {[
                      { value: 'in_app', label: 'Notification Center' },
                      { value: 'email', label: 'Send Email Alert' },
                      { value: 'webhook', label: 'Trigger Webhook' }
                    ].map((ch) => (
                      <label key={ch.value} className="flex items-center gap-2 text-[0.75rem] text-text-secondary cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={newRuleChannels.includes(ch.value)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewRuleChannels([...newRuleChannels, ch.value]);
                            } else {
                              setNewRuleChannels(newRuleChannels.filter((c) => c !== ch.value));
                            }
                          }}
                          className="w-3.5 h-3.5 accent-[#a78bfa]"
                        />
                        {ch.label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Who to Notify */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.78rem] text-text-secondary font-medium">Who to Notify</label>
                  <div className="flex flex-col gap-1.5 max-h-[90px] overflow-y-auto pr-1">
                    {members.map((member) => (
                      <label key={member.userId} className="flex items-center gap-2 text-[0.75rem] text-text-secondary cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={newRuleUserIds.includes(member.userId)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewRuleUserIds([...newRuleUserIds, member.userId]);
                            } else {
                              setNewRuleUserIds(newRuleUserIds.filter((uid) => uid !== member.userId));
                            }
                          }}
                          className="w-3.5 h-3.5 accent-[#a78bfa]"
                        />
                        {member.name}
                      </label>
                    ))}
                    {members.length === 0 && (
                      <span className="text-[0.7rem] text-text-muted italic">No recipients available.</span>
                    )}
                  </div>
                  <span className="text-[0.65rem] text-text-muted mt-0.5">Empty defaults to all members.</span>
                </div>
              </div>

              {/* Webhook Url overrides */}
              {newRuleChannels.includes('webhook') && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.78rem] text-text-secondary font-medium">Webhook URL Override</label>
                  <input
                    type="url"
                    placeholder="https://yourserver.com/endpoint"
                    value={newRuleWebhookUrl}
                    onChange={(e) => setNewRuleWebhookUrl(e.target.value)}
                    className="w-full bg-white/[0.03] border border-border-glass rounded px-3 py-1.5 text-[0.78rem] text-text-primary"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t border-white/5">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="btn btn-secondary py-1.5 px-4 text-[0.8rem] font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="btn btn-primary py-1.5 px-5 text-[0.8rem] font-semibold flex items-center gap-1.5"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Create Rule
            </button>
          </div>
        </form>
      )}

      {/* Rules list accordion container */}
      <div className="flex flex-col gap-3">
        <h2 className="text-[0.98rem] font-bold text-text-primary flex items-center gap-2 mb-1 px-1">
          <Bell size={17} className="text-primary" /> Active Alert Rules ({rules.length})
        </h2>

        {loadingRules ? (
          <div className="glass-panel p-12 flex flex-col items-center justify-center gap-3">
            <Loader2 size={24} className="text-primary animate-spin" />
            <p className="text-[0.8rem] text-text-muted">Loading rules configuration...</p>
          </div>
        ) : rules.length === 0 ? (
          <div className="glass-panel p-10 text-center flex flex-col items-center gap-3">
            <Bell size={32} className="text-text-muted opacity-30" />
            <div>
              <p className="text-[0.88rem] font-semibold text-text-secondary">No custom rules configured</p>
              <p className="text-[0.78rem] text-text-muted mt-1 max-w-sm mx-auto">
                Define custom alerts to instruct Gemini AI on specific activities to classify and log. Click the "Add Alert Rule" button at the top to start.
              </p>
            </div>
          </div>
        ) : (
          rules.map((rule) => {
            const isExpanded = expandedRuleId === rule.id;
            const subTab = ruleSubTabs[rule.id] || 'configure';
            const ruleNotifications = notifications.filter((n) => n.alertRuleId === rule.id);
            const unreadCount = ruleNotifications.filter((n) => !n.readAt).length;

            // Setup draft defaults if expanded
            if (isExpanded) initDraft(rule);
            const draft = editDrafts[rule.id] || {};

            return (
              <div
                key={rule.id}
                className={`glass-panel border overflow-hidden transition-all duration-300 ${
                  isExpanded ? 'border-primary/30 ring-1 ring-primary/10 shadow-lg' : 'border-border-glass hover:border-white/10'
                }`}
              >
                {/* Accordion Header */}
                <div
                  onClick={() => setExpandedRuleId(isExpanded ? null : rule.id)}
                  className="p-4 sm:p-4.5 flex items-center justify-between gap-4 cursor-pointer select-none hover:bg-white/[0.01] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        rule.isActive
                          ? 'bg-purple-500/10 text-purple-400 border border-purple-500/15'
                          : 'bg-white/5 text-text-muted border border-white/5'
                      }`}
                    >
                      <Bell size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h3 className="text-[0.88rem] font-bold text-text-primary truncate">
                          {rule.name}
                        </h3>
                        <span className={`text-[0.65rem] px-2 py-0.5 rounded border capitalize ${
                          rule.isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/5 text-text-muted border-white/5'
                        }`}>
                          {rule.isActive ? 'Active' : 'Disabled'}
                        </span>
                        {rule.allStreams ? (
                          <span className="text-[0.65rem] px-1.5 py-0.5 rounded border border-blue-500/20 text-blue-300 bg-blue-500/5 font-medium">
                            All Streams
                          </span>
                        ) : (
                          <span className="text-[0.65rem] px-1.5 py-0.5 rounded border border-indigo-500/20 text-indigo-300 bg-indigo-500/5 font-medium">
                            {rule.streamIds.length} stream(s)
                          </span>
                        )}
                        {ruleNotifications.length > 0 && (
                          <span className="text-[0.65rem] px-1.5 py-0.5 rounded border border-purple-500/20 text-purple-300 bg-purple-500/5 font-medium flex items-center gap-1">
                            <Volume2 size={10} />
                            {ruleNotifications.length} triggered
                            {unreadCount > 0 && ` (${unreadCount} unread)`}
                          </span>
                        )}
                      </div>
                      <p className="text-[0.76rem] text-text-muted mt-1 truncate max-w-[280px] sm:max-w-[480px]">
                        {rule.instruction}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {/* Status switch */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.isActive}
                      onClick={() => handleToggleActive(rule.id, rule.isActive)}
                      className={`relative w-9 h-5 rounded-full transition-colors duration-200 border-none cursor-pointer ${
                        rule.isActive ? 'bg-primary' : 'bg-[rgba(255,255,255,0.12)]'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                          rule.isActive ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    {/* Expand icon */}
                    <div onClick={() => setExpandedRuleId(isExpanded ? null : rule.id)} className="text-text-muted hover:text-text-primary p-1">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>
                </div>

                {/* Accordion Body */}
                {isExpanded && (
                  <div className="border-t border-border-glass bg-[rgba(0,0,0,0.15)] animate-slideDown">
                    {/* Nested Tabs Bar */}
                    <div className="flex border-b border-border-glass px-4 pt-2 gap-2 bg-white/[0.01]">
                      <button
                        onClick={() => setRuleSubTabs((prev) => ({ ...prev, [rule.id]: 'configure' }))}
                        className={`px-3 py-2 text-[0.78rem] font-semibold border-b-2 border-transparent transition-all outline-none ${
                          subTab === 'configure'
                            ? 'border-primary text-primary'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        Configure Rule
                      </button>
                      <button
                        onClick={() => setRuleSubTabs((prev) => ({ ...prev, [rule.id]: 'alerts' }))}
                        className={`px-3 py-2 text-[0.78rem] font-semibold border-b-2 border-transparent transition-all outline-none flex items-center gap-1.5 ${
                          subTab === 'alerts'
                            ? 'border-primary text-primary'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        Triggered Alerts
                        {unreadCount > 0 && (
                          <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                        )}
                      </button>
                    </div>

                    {/* Tab Panels */}
                    <div className="p-4 sm:p-5">
                      {subTab === 'configure' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4.5">
                          {/* Configure Col Left */}
                          <div className="flex flex-col gap-3.5">
                            <div className="flex flex-col gap-1">
                              <label className="text-[0.75rem] text-text-secondary font-medium">Rule Name</label>
                              <input
                                type="text"
                                value={draft.name ?? ''}
                                onChange={(e) => updateDraft(rule.id, { name: e.target.value })}
                                className="bg-white/[0.02] border border-border-glass rounded px-2.5 py-1.5 text-[0.78rem] text-text-primary"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[0.75rem] text-text-secondary font-medium">AI Alert Criteria</label>
                              <textarea
                                value={draft.instruction ?? ''}
                                onChange={(e) => updateDraft(rule.id, { instruction: e.target.value })}
                                rows={3}
                                className="bg-white/[0.02] border border-border-glass rounded px-2.5 py-1.5 text-[0.78rem] text-text-primary leading-relaxed resize-none"
                              />
                            </div>
                            {/* Actions block */}
                            <div className="flex gap-2 items-center mt-2.5">
                              <button
                                onClick={() => handleUpdateRule(rule.id)}
                                disabled={savingRuleId === rule.id}
                                className="btn btn-primary py-1.5 px-4 text-[0.75rem] font-bold flex items-center gap-1.5"
                              >
                                {savingRuleId === rule.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Save size={13} />
                                )}
                                Save Rule
                              </button>
                              <button
                                onClick={() => handleDeleteRule(rule.id)}
                                className="btn btn-secondary py-1.5 px-3 text-[0.75rem] font-bold text-danger border-none hover:bg-red-500/10 hover:text-red-400"
                              >
                                Delete Rule
                              </button>
                            </div>
                          </div>

                          {/* Configure Col Right */}
                          <div className="flex flex-col gap-3.5">
                            {/* Camera Stream selection */}
                            <div className="flex flex-col gap-1">
                              <label className="text-[0.75rem] text-text-secondary font-medium">Applies to Streams</label>
                              <div className="flex gap-4.5 mb-1.5">
                                <label className="flex items-center gap-1.5 text-[0.75rem] text-text-secondary cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`allStreams_${rule.id}`}
                                    checked={draft.allStreams === true}
                                    onChange={() => updateDraft(rule.id, { allStreams: true })}
                                    className="accent-primary"
                                  />
                                  All Streams
                                </label>
                                <label className="flex items-center gap-1.5 text-[0.75rem] text-text-secondary cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`allStreams_${rule.id}`}
                                    checked={draft.allStreams === false}
                                    onChange={() => updateDraft(rule.id, { allStreams: false })}
                                    className="accent-primary"
                                  />
                                  Specific Streams
                                </label>
                              </div>

                              {draft.allStreams === false && (
                                <div className="flex flex-col gap-1.5 max-h-[85px] overflow-y-auto bg-black/20 p-2.5 rounded border border-border-glass">
                                  {streams.map((stream) => (
                                    <label key={stream.streamId} className="flex items-center gap-2 text-[0.72rem] text-text-secondary cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={(draft.streamIds || []).includes(stream.streamId)}
                                        onChange={(e) => {
                                          const current = draft.streamIds || [];
                                          if (e.target.checked) {
                                            updateDraft(rule.id, { streamIds: [...current, stream.streamId] });
                                          } else {
                                            updateDraft(rule.id, { streamIds: current.filter((id) => id !== stream.streamId) });
                                          }
                                        }}
                                        className="w-3.5 h-3.5 accent-[#a78bfa] rounded"
                                      />
                                      {stream.name} ({stream.deviceId})
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Custom Channels */}
                            <div className="grid grid-cols-2 gap-3.5">
                              {/* How to Notify */}
                              <div className="flex flex-col gap-1">
                                <label className="text-[0.75rem] text-text-secondary font-medium">Notification Channels</label>
                                <div className="flex flex-col gap-1.5">
                                  {[
                                    { value: 'in_app', label: 'Notification Center' },
                                    { value: 'email', label: 'Send Email Alert' },
                                    { value: 'webhook', label: 'Trigger Webhook' }
                                  ].map((ch) => (
                                    <label key={ch.value} className="flex items-center gap-2 text-[0.72rem] text-text-secondary cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={(draft.channels || []).includes(ch.value)}
                                        onChange={(e) => {
                                          const current = draft.channels || [];
                                          if (e.target.checked) {
                                            updateDraft(rule.id, { channels: [...current, ch.value] });
                                          } else {
                                            updateDraft(rule.id, { channels: current.filter((c) => c !== ch.value) });
                                          }
                                        }}
                                        className="w-3.5 h-3.5 accent-[#a78bfa]"
                                      />
                                      {ch.label}
                                    </label>
                                  ))}
                                </div>
                              </div>

                              {/* Recipients selection */}
                              <div className="flex flex-col gap-1">
                                <label className="text-[0.75rem] text-text-secondary font-medium">Target Recipients</label>
                                <div className="flex flex-col gap-1.5 max-h-[85px] overflow-y-auto pr-1">
                                  {members.map((member) => (
                                    <label key={member.userId} className="flex items-center gap-2 text-[0.72rem] text-text-secondary cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={(draft.userIds || []).includes(member.userId)}
                                        onChange={(e) => {
                                          const current = draft.userIds || [];
                                          if (e.target.checked) {
                                            updateDraft(rule.id, { userIds: [...current, member.userId] });
                                          } else {
                                            updateDraft(rule.id, { userIds: current.filter((uid) => uid !== member.userId) });
                                          }
                                        }}
                                        className="w-3.5 h-3.5 accent-[#a78bfa]"
                                      />
                                      {member.name}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {/* Webhook Url input */}
                            {(draft.channels || []).includes('webhook') && (
                              <div className="flex flex-col gap-1">
                                <label className="text-[0.75rem] text-text-secondary font-medium">Webhook URL Override</label>
                                <input
                                  type="url"
                                  value={draft.webhookUrl || ''}
                                  onChange={(e) => updateDraft(rule.id, { webhookUrl: e.target.value })}
                                  placeholder="https://yourserver.com/endpoint"
                                  className="bg-white/[0.02] border border-border-glass rounded px-2.5 py-1.5 text-[0.78rem] text-text-primary"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* Triggered Alerts sub-tab */
                        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
                          {ruleNotifications.length === 0 ? (
                            <p className="text-[0.78rem] text-text-muted italic py-4 text-center">
                              No triggered notifications generated for this rule.
                            </p>
                          ) : (
                            ruleNotifications.map((n) => {
                              const isUnread = !n.readAt;
                              return (
                                <div
                                  key={n.id}
                                  onClick={() => {
                                    if (isUnread) onMarkRead(n.id);
                                    onNotificationClick(n);
                                  }}
                                  className={`group flex items-start gap-3 rounded-lg border p-2.5 transition-all duration-200 cursor-pointer text-left ${
                                    isUnread
                                      ? 'bg-white/[0.04] border-white/10 hover:bg-white/[0.06]'
                                      : 'bg-transparent border-transparent hover:bg-white/[0.015]'
                                  }`}
                                >
                                  <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 border border-white/5 mt-0.5">
                                    {getCategoryIcon(n.category, n.severity)}
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start gap-2">
                                      <p className={`text-[0.8rem] font-bold truncate leading-snug ${isUnread ? 'text-text-primary' : 'text-text-secondary'}`}>
                                        {n.title}
                                      </p>
                                      <span className="text-[0.68rem] text-text-muted shrink-0">
                                        {formatRelativeTime(n.createdAt)}
                                      </span>
                                    </div>
                                    <p className="text-[0.74rem] text-text-muted line-clamp-1 mt-0.5 leading-relaxed">
                                      {n.body}
                                    </p>
                                    <div className="flex items-center gap-1.5 mt-1">
                                      <span className={`text-[0.6rem] px-1.5 py-0.5 rounded border capitalize ${getSeverityBadgeClass(n.severity)}`}>
                                        {n.severity}
                                      </span>
                                      {n.riskLevel && (
                                        <span className="text-[0.6rem] px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-300 bg-purple-500/10 uppercase font-semibold">
                                          {n.riskLevel} risk
                                        </span>
                                      )}
                                      {n.clipId && (
                                        <span className="text-[0.6rem] px-1.5 py-0.5 rounded border border-cyan-500/30 text-cyan-300 bg-cyan-500/5 font-medium inline-flex items-center gap-0.5">
                                          <Video size={9} /> View Footage
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="shrink-0 self-center flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                                    {isUnread && (
                                      <button
                                        onClick={() => onMarkRead(n.id)}
                                        className="btn btn-secondary p-1 rounded-md text-text-muted hover:text-text-primary"
                                        title="Mark read"
                                      >
                                        <CheckCheck size={13} />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => onDeleteNotification(n.id)}
                                      className="btn btn-secondary p-1 rounded-md text-text-muted hover:text-danger hover:border-danger/30"
                                      title="Delete notification"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* General System Notifications Feed Accordion */}
      <div className="glass-panel border border-border-glass overflow-hidden mt-2">
        <div
          onClick={() => setGeneralAccordionExpanded(!generalAccordionExpanded)}
          className="p-4 flex items-center justify-between cursor-pointer select-none hover:bg-white/[0.01] transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white/5 border border-white/5 text-text-muted shrink-0">
              <Cpu size={16} />
            </div>
            <div>
              <h3 className="text-[0.88rem] font-bold text-text-primary flex items-center gap-2">
                System &amp; Device Notifications ({generalNotifications.length})
              </h3>
              <p className="text-[0.72rem] text-text-muted mt-0.5">
                Technical logs, heartbeats, websocket connections, and generic camera errors.
              </p>
            </div>
          </div>
          <div className="text-text-muted hover:text-text-primary p-1">
            {generalAccordionExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>

        {generalAccordionExpanded && (
          <div className="border-t border-border-glass bg-[rgba(0,0,0,0.15)] p-4 sm:p-5 animate-slideDown">
            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
              {generalNotifications.length === 0 ? (
                <p className="text-[0.78rem] text-text-muted italic py-4 text-center">
                  No system or device notifications log.
                </p>
              ) : (
                generalNotifications.map((n) => {
                  const isUnread = !n.readAt;
                  return (
                    <div
                      key={n.id}
                      onClick={() => {
                        if (isUnread) onMarkRead(n.id);
                        onNotificationClick(n);
                      }}
                      className={`group flex items-start gap-3 rounded-lg border p-2.5 transition-all duration-200 cursor-pointer text-left ${
                        isUnread
                          ? 'bg-white/[0.04] border-white/10 hover:bg-white/[0.06]'
                          : 'bg-transparent border-transparent hover:bg-white/[0.015]'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 border border-white/5 mt-0.5">
                        {getCategoryIcon(n.category, n.severity)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2">
                          <p className={`text-[0.8rem] font-bold truncate leading-snug ${isUnread ? 'text-text-primary' : 'text-text-secondary'}`}>
                            {n.title}
                          </p>
                          <span className="text-[0.68rem] text-text-muted shrink-0">
                            {formatRelativeTime(n.createdAt)}
                          </span>
                        </div>
                        <p className="text-[0.74rem] text-text-muted line-clamp-1 mt-0.5 leading-relaxed">
                          {n.body}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`text-[0.6rem] px-1.5 py-0.5 rounded border capitalize ${getSeverityBadgeClass(n.severity)}`}>
                            {n.category}: {n.severity}
                          </span>
                        </div>
                      </div>

                      <div className="shrink-0 self-center flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        {isUnread && (
                          <button
                            onClick={() => onMarkRead(n.id)}
                            className="btn btn-secondary p-1 rounded-md text-text-muted hover:text-text-primary"
                            title="Mark read"
                          >
                            <CheckCheck size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => onDeleteNotification(n.id)}
                          className="btn btn-secondary p-1 rounded-md text-text-muted hover:text-danger hover:border-danger/30"
                          title="Delete notification"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
