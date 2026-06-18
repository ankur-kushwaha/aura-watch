import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, FileText, RefreshCw, ScrollText, Terminal, X } from 'lucide-react';
import { apiFetch } from '../../../api';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import type { DeviceEvent, LogEntry } from '../../types';

export interface DeviceLogsDialogProps {
  device: { deviceId: string; name: string } | null;
  onClose: () => void;
  registerLiveLogSink?: (sink: ((entry: LogEntry) => void) | null) => void;
  registerLiveEventSink?: (sink: ((event: DeviceEvent) => void) | null) => void;
}

function severityClass(severity: string): string {
  if (severity === 'error') return 'text-rose-400';
  if (severity === 'warn') return 'text-amber-300';
  return 'text-emerald-300';
}

interface DeviceLogsPanelProps {
  device: { deviceId: string; name: string };
  onClose: () => void;
  registerLiveLogSink?: (sink: ((entry: LogEntry) => void) | null) => void;
  registerLiveEventSink?: (sink: ((event: DeviceEvent) => void) | null) => void;
}

function DeviceLogsPanel({
  device,
  onClose,
  registerLiveLogSink,
  registerLiveEventSink,
}: DeviceLogsPanelProps) {
  const [journalLogs, setJournalLogs] = useState('');
  const [loadingJournal, setLoadingJournal] = useState(false);
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);
  const [savedEvents, setSavedEvents] = useState<DeviceEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [activeTab, setActiveTab] = useState<'events' | 'journal' | 'live'>('events');
  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const eventsContainerRef = useRef<HTMLDivElement | null>(null);

  const fetchSavedEvents = useCallback(async (deviceId: string) => {
    setLoadingEvents(true);
    try {
      const res = await apiFetch(`/devices/${deviceId}/events?limit=100`);
      const data = await res.json();
      if (res.ok) {
        setSavedEvents(data.events || []);
      } else {
        setSavedEvents([]);
      }
    } catch (err) {
      console.error('Failed to fetch saved device events', err);
      setSavedEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  const fetchJournalLogs = useCallback(async (deviceId: string) => {
    setLoadingJournal(true);
    try {
      const res = await apiFetch(`/devices/${deviceId}/logs?lines=200`);
      const data = await res.json();
      if (res.ok) {
        setJournalLogs(data.logs || '');
      } else {
        setJournalLogs(data.error || 'Failed to fetch journal logs');
      }
    } catch (err) {
      console.error('Failed to fetch journal logs', err);
      setJournalLogs('Failed to fetch journal logs');
    } finally {
      setLoadingJournal(false);
    }
  }, []);

  const refreshAll = useCallback(async (deviceId: string) => {
    await Promise.all([fetchJournalLogs(deviceId), fetchSavedEvents(deviceId)]);
  }, [fetchJournalLogs, fetchSavedEvents]);

  useEffect(() => {
    const deviceId = device.deviceId;
    const timer = window.setTimeout(() => {
      void refreshAll(deviceId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [device.deviceId, refreshAll]);

  useEffect(() => {
    registerLiveLogSink?.((entry) => {
      setLiveLogs((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.message === entry.message && last.timestamp === entry.timestamp) {
          return prev;
        }
        return [...prev, entry];
      });
    });

    registerLiveEventSink?.((event) => {
      setSavedEvents((prev) => {
        if (prev.some((existing) => existing.id === event.id)) {
          return prev;
        }
        return [event, ...prev].slice(0, 100);
      });
    });

    return () => {
      registerLiveLogSink?.(null);
      registerLiveEventSink?.(null);
    };
  }, [device.deviceId, registerLiveLogSink, registerLiveEventSink]);

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [liveLogs, activeTab]);

  useEffect(() => {
    if (eventsContainerRef.current) {
      eventsContainerRef.current.scrollTop = 0;
    }
  }, [savedEvents, activeTab]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-[rgba(124,58,237,0.15)] p-2 rounded-lg">
            <ScrollText size={18} color="var(--color-primary)" />
          </div>
          <div>
            <DialogTitle>Device Logs — {device.name}</DialogTitle>
            <p className="text-[0.72rem] text-text-muted mt-0.5">{device.deviceId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshAll(device.deviceId)}
            disabled={loadingJournal || loadingEvents}
            className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md flex items-center gap-1"
          >
            <RefreshCw size={12} className={loadingJournal || loadingEvents ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn p-1.5 bg-transparent text-text-muted hover:text-text-primary border-none rounded-lg hover:bg-[rgba(255,255,255,0.06)]"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="h-px bg-[rgba(255,255,255,0.07)]" />

      <div className="flex flex-col gap-4 min-h-0 flex-1 overflow-hidden">
        {/* Navigation Tabs */}
        <div className="flex gap-2 bg-[rgba(255,255,255,0.02)] p-1 rounded-lg border border-border-glass w-fit overflow-x-auto">
          <button
            onClick={() => setActiveTab('events')}
            className={`py-1.5 px-3 rounded-md text-[0.8rem] font-semibold flex items-center gap-1.5 transition-all duration-200 border-none outline-none whitespace-nowrap shrink-0 ${
              activeTab === 'events'
                ? 'bg-primary text-white shadow-[0_2px_8px_var(--color-primary-glow)]'
                : 'text-text-secondary hover:text-text-primary bg-transparent cursor-pointer'
            }`}
          >
            <Activity size={14} />
            Saved Events
          </button>
          <button
            onClick={() => setActiveTab('journal')}
            className={`py-1.5 px-3 rounded-md text-[0.8rem] font-semibold flex items-center gap-1.5 transition-all duration-200 border-none outline-none whitespace-nowrap shrink-0 ${
              activeTab === 'journal'
                ? 'bg-primary text-white shadow-[0_2px_8px_var(--color-primary-glow)]'
                : 'text-text-secondary hover:text-text-primary bg-transparent cursor-pointer'
            }`}
          >
            <FileText size={14} />
            Service Journal
          </button>
          <button
            onClick={() => setActiveTab('live')}
            className={`py-1.5 px-3 rounded-md text-[0.8rem] font-semibold flex items-center gap-1.5 transition-all duration-200 border-none outline-none whitespace-nowrap shrink-0 ${
              activeTab === 'live'
                ? 'bg-primary text-white shadow-[0_2px_8px_var(--color-primary-glow)]'
                : 'text-text-secondary hover:text-text-primary bg-transparent cursor-pointer'
            }`}
          >
            <Terminal size={14} />
            Live Logs
          </button>
        </div>

        {/* Tab content panel */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {activeTab === 'events' && (
            <div
              ref={eventsContainerRef}
              className="font-mono bg-[rgba(0,0,0,0.5)] rounded-lg p-3 text-[0.75rem] leading-[1.4] flex-1 overflow-y-auto border border-[rgba(255,255,255,0.05)]"
            >
              {loadingEvents ? (
                <span className="text-text-muted">Loading saved events...</span>
              ) : savedEvents.length === 0 ? (
                <span className="text-text-muted">
                  No saved events yet. Camera issues, software updates, and connectivity events are recorded here automatically.
                </span>
              ) : (
                savedEvents.map((event) => (
                  <div key={event.id} className="mb-2 pb-2 border-b border-[rgba(255,255,255,0.04)] last:border-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="text-text-muted">
                        [{new Date(event.createdAt).toLocaleString()}]
                      </span>
                      <span className={`uppercase text-[0.65rem] tracking-wide ${severityClass(event.severity)}`}>
                        {event.severity}
                      </span>
                      <span className="text-[0.65rem] text-text-muted">{event.category}</span>
                      <span className="text-[0.65rem] text-text-muted">{event.eventType}</span>
                    </div>
                    <span className={severityClass(event.severity)}>{event.message}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'journal' && (
            <div className="font-mono bg-[rgba(0,0,0,0.5)] rounded-lg p-3 text-[0.75rem] leading-[1.4] text-[#a5b4fc] flex-1 overflow-y-auto border border-[rgba(255,255,255,0.05)] whitespace-pre-wrap">
              {loadingJournal ? (
                <span className="text-text-muted">Loading journal logs...</span>
              ) : journalLogs ? (
                journalLogs
              ) : (
                <span className="text-text-muted">No journal logs available.</span>
              )}
            </div>
          )}

          {activeTab === 'live' && (
            <div
              ref={logsContainerRef}
              className="font-mono bg-[rgba(0,0,0,0.5)] rounded-lg p-3 text-[0.75rem] leading-[1.4] text-[#38bdf8] flex-1 overflow-y-auto border border-[rgba(255,255,255,0.05)]"
            >
              {liveLogs.length === 0 ? (
                <span className="text-text-muted">Waiting for live log events from device...</span>
              ) : (
                liveLogs.map((log, index) => (
                  <div key={index} className="mb-1">
                    <span className="text-text-muted mr-2">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                    <span>{log.message}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function DeviceLogsDialog({ device, onClose, registerLiveLogSink, registerLiveEventSink }: DeviceLogsDialogProps) {
  return (
    <Dialog open={!!device} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[720px] p-6 flex flex-col gap-4 max-h-[85vh]">
        {device ? (
          <DeviceLogsPanel
            key={device.deviceId}
            device={device}
            onClose={onClose}
            registerLiveLogSink={registerLiveLogSink}
            registerLiveEventSink={registerLiveEventSink}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
