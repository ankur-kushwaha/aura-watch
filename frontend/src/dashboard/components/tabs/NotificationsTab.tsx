import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  Trash2,
  Video,
  Info,
  ShieldAlert,
  Cpu,
  AlertTriangle,
  SlidersHorizontal
} from 'lucide-react';
import type { Notification, CameraStream } from '../../types';
import { fetchAlertRules, type AlertRule } from '../../../alertRulesApi';

export interface NotificationsTabProps {
  notifications: Notification[];
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onDeleteNotification: (id: string) => Promise<void>;
  onClearAllNotifications: () => Promise<void>;
  onNotificationClick: (n: Notification) => void;
  streams: CameraStream[];
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

export function NotificationsTab({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onDeleteNotification,
  onClearAllNotifications,
  onNotificationClick,
  streams
}: NotificationsTabProps) {
  const [searchParams] = useSearchParams();
  const [selectedStreamIdFilter, setSelectedStreamIdFilter] = useState('');
  const [selectedRuleIdFilter, setSelectedRuleIdFilter] = useState('');
  const [filterCategory, setFilterCategory] = useState<'all' | 'ai' | 'custom'>('all');
  const [filterUnreadOnly, setFilterUnreadOnly] = useState(false);
  const [rules, setRules] = useState<AlertRule[]>([]);

  useEffect(() => {
    const streamIdParam = searchParams.get('streamId');
    if (streamIdParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedStreamIdFilter(streamIdParam);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchAlertRules()
      .then((data) => setRules(data.rules))
      .catch((err) => console.error('Failed to load rules inside NotificationsTab', err));
  }, []);

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

  // Filter notifications
  const filteredNotifications = notifications.filter((n) => {
    // Hide system notifications entirely
    if (n.category !== 'surveillance' && !n.alertRuleId) {
      return false;
    }

    // Stream ID Filter
    if (selectedStreamIdFilter && n.streamId !== selectedStreamIdFilter) {
      return false;
    }

    // Category Filter: ai vs custom (has alertRuleId)
    if (filterCategory === 'ai' && (n.category !== 'surveillance' || n.alertRuleId)) {
      return false;
    }
    if (filterCategory === 'custom' && !n.alertRuleId) {
      return false;
    }

    // Rule Filter
    if (selectedRuleIdFilter && n.alertRuleId !== selectedRuleIdFilter) {
      return false;
    }

    // Unread Filter
    if (filterUnreadOnly && n.readAt) {
      return false;
    }

    return true;
  });

  const unreadCount = filteredNotifications.filter(n => !n.readAt).length;

  return (
    <div className="flex flex-col gap-6 w-full animate-[slideUp_0.3s_ease-out]">
      {/* Top Banner Callout */}
      <div className="glass-panel p-5 relative overflow-hidden flex flex-col gap-3">
        <div className="absolute right-0 top-0 w-[300px] h-[300px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex justify-between items-start gap-4 flex-wrap">
          <div>
            <h1 className="text-[1.35rem] font-bold text-gradient-purple">Notification Center</h1>
            <p className="text-[0.82rem] text-text-muted mt-1 leading-relaxed max-w-2xl">
              View and manage all system events, camera health issues, websocket connection logs, and custom AI security alerts in one central dashboard feed.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="btn btn-secondary py-2 px-3.5 text-[0.8rem] font-semibold flex items-center gap-1.5 shrink-0"
              >
                <CheckCheck size={14} /> Mark All Read
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (confirm('Clear all notification history? This action cannot be undone.')) {
                  onClearAllNotifications();
                }
              }}
              className="btn btn-secondary py-2 px-3 text-[0.8rem] font-semibold flex items-center gap-1.5 shrink-0 hover:text-danger hover:border-danger/30"
            >
              <Trash2 size={14} /> Clear Feed
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch flex-1">
        {/* LEFT COLUMN: Categories Submenu */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          <div className="glass-panel p-4 flex flex-col gap-4">
            <h3 className="text-[0.85rem] font-bold text-text-primary flex items-center gap-2 border-b border-border-glass pb-2 select-none">
              <SlidersHorizontal size={14} className="text-[var(--color-secondary)]" /> Filter Feed
            </h3>

            {/* Category Filter */}
            <div className="flex flex-col gap-2">
              <label className="text-[0.68rem] font-bold uppercase tracking-wider text-text-muted">Source Category</label>
              <div className="flex flex-col gap-1">
                {(['all', 'ai', 'custom'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setFilterCategory(cat)}
                    className={`text-left py-2 px-3 rounded-lg text-[0.78rem] font-semibold transition-all duration-150 border-none cursor-pointer ${filterCategory === cat
                        ? 'bg-[rgba(255,255,255,0.06)] text-white border border-border-glass'
                        : 'text-text-muted hover:text-text-secondary bg-transparent hover:bg-white/[0.01]'
                      }`}
                  >
                    {cat === 'all' && 'All Notifications'}
                    {cat === 'ai' && 'AI Security Alerts'}
                    {cat === 'custom' && 'Custom Alerts'}
                  </button>
                ))}
              </div>
            </div>

            {/* Stream Filter */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.68rem] font-bold uppercase tracking-wider text-text-muted">Filter by Camera</label>
              <select
                value={selectedStreamIdFilter}
                onChange={(e) => setSelectedStreamIdFilter(e.target.value)}
                className="bg-[#0b0f19] border border-border-glass text-[0.78rem] px-3 py-2 rounded-lg focus:border-primary text-white outline-none w-full cursor-pointer"
              >
                <option value="">All Cameras</option>
                {streams.map((stream) => (
                  <option key={stream.streamId} value={stream.streamId}>
                    {stream.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Rule Filter */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.68rem] font-bold uppercase tracking-wider text-text-muted">Filter by Alert Rule</label>
              <select
                value={selectedRuleIdFilter}
                onChange={(e) => setSelectedRuleIdFilter(e.target.value)}
                className="bg-[#0b0f19] border border-border-glass text-[0.78rem] px-3 py-2 rounded-lg focus:border-primary text-white outline-none w-full cursor-pointer"
              >
                <option value="">All Alert Rules</option>
                {rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Read/Unread Filter */}
            <label className="flex items-center gap-2 text-[0.78rem] text-text-secondary cursor-pointer select-none mt-2">
              <input
                type="checkbox"
                checked={filterUnreadOnly}
                onChange={(e) => setFilterUnreadOnly(e.target.checked)}
                className="w-3.5 h-3.5 accent-primary rounded"
              />
              Show Unread Only
            </label>
          </div>
        </div>

        {/* RIGHT COLUMN: Notifications Feed */}
        <div className="lg:col-span-9 flex flex-col gap-3">
          <div className="glass-panel p-4 flex-1 flex flex-col gap-2.5 overflow-y-auto max-h-[calc(100vh-280px)] pr-1">
            {filteredNotifications.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3 min-h-[300px]">
                <Bell size={32} className="text-text-muted opacity-30 animate-pulse" />
                <div>
                  <p className="text-[0.88rem] font-semibold text-text-secondary">No notifications found</p>
                  <p className="text-[0.78rem] text-text-muted mt-1 max-w-[240px] mx-auto leading-relaxed">
                    There are no triggered alerts matching your current filter settings.
                  </p>
                </div>
              </div>
            ) : (
              filteredNotifications.map((n) => {
                const isUnread = !n.readAt;
                const stream = streams.find((s) => s.streamId === n.streamId);
                return (
                  <div
                    key={n.id}
                    onClick={() => {
                      if (isUnread) onMarkRead(n.id);
                      onNotificationClick(n);
                    }}
                    className={`group flex items-start gap-3 rounded-lg border p-3 transition-all duration-200 cursor-pointer text-left ${isUnread
                        ? 'bg-white/[0.04] border-white/10 hover:bg-white/[0.06] shadow-[0_2px_8px_rgba(0,0,0,0.15)]'
                        : 'bg-transparent border-transparent hover:bg-white/[0.015]'
                      }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 border border-white/5 mt-0.5">
                      {getCategoryIcon(n.category, n.severity)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <p className={`text-[0.82rem] font-bold truncate leading-snug ${isUnread ? 'text-text-primary' : 'text-text-secondary'}`}>
                          {n.title}
                        </p>
                        <span className="text-[0.68rem] text-text-muted shrink-0">
                          {formatRelativeTime(n.createdAt)}
                        </span>
                      </div>
                      <p className="text-[0.76rem] text-text-muted mt-1 leading-relaxed">
                        {n.body}
                      </p>
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className={`text-[0.6rem] px-1.5 py-0.5 rounded border capitalize ${getSeverityBadgeClass(n.severity)}`}>
                          {n.category}: {n.severity}
                        </span>
                        {stream && (
                          <span className="text-[0.6rem] px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-300 bg-emerald-500/10 font-medium">
                            Camera: {stream.name}
                          </span>
                        )}
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
                          type="button"
                          onClick={() => onMarkRead(n.id)}
                          className="btn btn-secondary p-1 rounded-md text-text-muted hover:text-text-primary"
                          title="Mark read"
                        >
                          <CheckCheck size={13} />
                        </button>
                      )}
                      <button
                        type="button"
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
      </div>
    </div>
  );
}
