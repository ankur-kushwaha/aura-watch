import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ScrollText, X } from 'lucide-react';
import { apiFetch } from '../../../api';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import type { LogEntry } from '../../types';

export interface DeviceLogsDialogProps {
  device: { deviceId: string; name: string } | null;
  onClose: () => void;
  registerLiveLogSink?: (sink: ((entry: LogEntry) => void) | null) => void;
}

export function DeviceLogsDialog({ device, onClose, registerLiveLogSink }: DeviceLogsDialogProps) {
  const [journalLogs, setJournalLogs] = useState('');
  const [loadingJournal, setLoadingJournal] = useState(false);
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!device) {
      setJournalLogs('');
      setLiveLogs([]);
      registerLiveLogSink?.(null);
      return;
    }

    setLiveLogs([]);
    void fetchJournalLogs(device.deviceId);

    registerLiveLogSink?.((entry) => {
      setLiveLogs((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.message === entry.message && last.timestamp === entry.timestamp) {
          return prev;
        }
        return [...prev, entry];
      });
    });

    return () => registerLiveLogSink?.(null);
  }, [device, fetchJournalLogs, registerLiveLogSink]);

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [liveLogs]);

  return (
    <Dialog open={!!device} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[720px] p-6 flex flex-col gap-4 max-h-[85vh]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-[rgba(124,58,237,0.15)] p-2 rounded-lg">
              <ScrollText size={18} color="var(--color-primary)" />
            </div>
            <div>
              <DialogTitle>Device Logs — {device?.name}</DialogTitle>
              <p className="text-[0.72rem] text-text-muted mt-0.5">{device?.deviceId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => device && void fetchJournalLogs(device.deviceId)}
              disabled={loadingJournal}
              className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md flex items-center gap-1"
            >
              <RefreshCw size={12} className={loadingJournal ? 'animate-spin' : ''} />
              Refresh Journal
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

        <div className="flex flex-col gap-3 min-h-0 flex-1 overflow-hidden">
          <div>
            <h3 className="text-[0.8rem] font-semibold text-text-secondary mb-2">Service Journal (aura-watch-edge)</h3>
            <div className="font-mono bg-[rgba(0,0,0,0.5)] rounded-lg p-3 text-[0.75rem] leading-[1.4] text-[#a5b4fc] h-[180px] overflow-y-auto border border-[rgba(255,255,255,0.05)] whitespace-pre-wrap">
              {loadingJournal ? (
                <span className="text-text-muted">Loading journal logs...</span>
              ) : journalLogs ? (
                journalLogs
              ) : (
                <span className="text-text-muted">No journal logs available.</span>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 flex flex-col">
            <h3 className="text-[0.8rem] font-semibold text-text-secondary mb-2">Live Agent Logs</h3>
            <div
              ref={logsContainerRef}
              className="font-mono bg-[rgba(0,0,0,0.5)] rounded-lg p-3 text-[0.75rem] leading-[1.4] text-[#38bdf8] flex-1 min-h-[140px] max-h-[220px] overflow-y-auto border border-[rgba(255,255,255,0.05)]"
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
