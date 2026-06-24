import { useState } from 'react';
import { X, CheckCheck, Video, AlertTriangle, Info, ShieldAlert, Cpu, Bell } from 'lucide-react';
import type { Notification } from '../types';

export interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: Notification[];
  loading: boolean;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onNotificationClick: (n: Notification) => void;
  onViewAll?: () => void;
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

export function NotificationDrawer({
  isOpen,
  onClose,
  notifications,
  loading,
  onMarkAllRead,
  onMarkRead,
  onNotificationClick,
  onViewAll,
}: NotificationDrawerProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'ai' | 'custom' | 'system'>('all');

  if (!isOpen) return null;

  const filteredNotifications = notifications.filter((n) => {
    if (activeTab === 'ai') {
      return n.category === 'surveillance' && !n.alertRuleId;
    }
    if (activeTab === 'custom') {
      return !!n.alertRuleId;
    }
    if (activeTab === 'system') {
      return n.category !== 'surveillance' && !n.alertRuleId;
    }
    return true;
  });

  const unreadCount = filteredNotifications.filter((n) => !n.readAt).length;

  const getCategoryIcon = (category: string, severity: string) => {
    const baseClass = "w-5 h-5 shrink-0";
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

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90] transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="fixed top-0 right-0 h-full w-full sm:w-[440px] bg-[#0c0c14]/95 border-l border-white/10 shadow-[-10px_0_30px_rgba(0,0,0,0.6)] z-[100] flex flex-col transition-transform duration-300 overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between bg-white/[0.01]">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[1.15rem] font-bold text-text-primary">Notifications</h2>
            {unreadCount > 0 && (
              <span className="bg-primary/20 text-primary border border-primary/30 px-2 py-0.5 rounded-full text-[0.7rem] font-semibold">
                {unreadCount} unread
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="btn btn-secondary px-2.5 py-1.5 text-[0.75rem] flex items-center gap-1.5 hover:bg-white/5 transition-colors border-none"
                title="Mark all as read"
              >
                <CheckCheck size={14} />
                <span className="hidden sm:inline">Mark all read</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary p-1.5 hover:bg-white/5 transition-colors border-none"
              aria-label="Close notifications panel"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        
        {/* Tabs */}
        <div className="flex border-b border-white/10 bg-white/[0.01] px-4 py-2 gap-1 select-none">
          {(['all', 'ai', 'custom', 'system'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 text-center py-1.5 rounded-lg text-[0.75rem] font-semibold transition-all duration-150 border border-transparent cursor-pointer ${
                activeTab === tab
                  ? 'bg-white/[0.06] text-white border-white/10'
                  : 'text-text-muted hover:text-text-secondary bg-transparent hover:bg-white/[0.01]'
              }`}
            >
              {tab === 'all' && 'All'}
              {tab === 'ai' && 'AI Alerts'}
              {tab === 'custom' && 'Custom'}
              {tab === 'system' && 'System'}
            </button>
          ))}
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 flex flex-col gap-2.5">
          {loading && filteredNotifications.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-[0.8rem] text-text-muted">Loading notifications...</p>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-text-muted">
                <Video size={24} className="opacity-40" />
              </div>
              <div>
                <p className="text-[0.9rem] font-semibold text-text-secondary">All caught up!</p>
                <p className="text-[0.78rem] text-text-muted mt-1 max-w-[240px]">
                  {activeTab === 'all' && 'Surveillance alerts and device health notifications will appear here.'}
                  {activeTab === 'ai' && 'AI surveillance alerts (such as watchlists) will appear here.'}
                  {activeTab === 'custom' && 'Custom alert rule notifications will appear here.'}
                  {activeTab === 'system' && 'System status logs and device warnings will appear here.'}
                </p>
              </div>
            </div>
          ) : (
            filteredNotifications.map((n) => {
              const isUnread = !n.readAt;
              return (
                <div
                  key={n.id}
                  onClick={() => {
                    if (isUnread) {
                      onMarkRead(n.id);
                    }
                    onNotificationClick(n);
                  }}
                  className={`group relative rounded-xl border p-3.5 flex gap-3.5 transition-all duration-200 cursor-pointer text-left ${
                    isUnread
                      ? 'bg-white/[0.04] border-white/10 hover:bg-white/[0.06] shadow-sm'
                      : 'bg-transparent border-transparent hover:bg-white/[0.02]'
                  }`}
                >
                  {/* Left Icon with color indicator */}
                  <div className="relative">
                    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/5 shadow-inner">
                      {getCategoryIcon(n.category, n.severity)}
                    </div>
                    {isUnread && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full shadow-[0_0_8px_var(--color-primary)] border border-[#0c0c14]" />
                    )}
                  </div>

                  {/* Main Info */}
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex justify-between items-start gap-2">
                      <p className={`text-[0.85rem] leading-snug font-bold truncate transition-colors ${
                        isUnread ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'
                      }`}>
                        {n.title}
                      </p>
                      <span className="text-[0.7rem] text-text-muted shrink-0 mt-0.5">
                        {formatRelativeTime(n.createdAt)}
                      </span>
                    </div>

                    <p className="text-[0.78rem] text-text-muted leading-relaxed line-clamp-2">
                      {n.body}
                    </p>

                    {/* Meta info tags */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className={`text-[0.65rem] px-2 py-0.5 rounded border capitalize ${getSeverityBadgeClass(n.severity)}`}>
                        {n.severity}
                      </span>
                      {n.category === 'surveillance' && n.riskLevel && (
                        <span className={`text-[0.65rem] px-2 py-0.5 rounded border border-purple-500/30 text-purple-300 bg-purple-500/10 uppercase font-semibold`}>
                          {n.riskLevel} risk
                        </span>
                      )}
                      {n.clipId && (
                        <span className="text-[0.65rem] px-2 py-0.5 rounded border border-cyan-500/30 text-cyan-300 bg-cyan-500/10 inline-flex items-center gap-1 font-medium">
                          <Video size={10} className="text-cyan-400 shrink-0" />
                          View Clip
                        </span>
                      )}
                      {n.triggeredByInstruction && (
                        <span
                          className="text-[0.65rem] px-2 py-0.5 rounded border border-indigo-500/30 text-indigo-300 bg-indigo-500/10 truncate max-w-[200px]"
                          title={`Triggered by rule: "${n.triggeredByInstruction}"`}
                        >
                          Rule: "{n.triggeredByInstruction}"
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {onViewAll && (
          <div className="p-4 border-t border-white/10 bg-white/[0.01] flex justify-center shrink-0">
            <button
              type="button"
              onClick={onViewAll}
              className="w-full btn btn-primary py-2 text-[0.8rem] text-center font-semibold rounded-lg flex items-center justify-center gap-2"
            >
              <Bell size={14} />
              View All in Notification Center
            </button>
          </div>
        )}
      </div>
    </>
  );
}
