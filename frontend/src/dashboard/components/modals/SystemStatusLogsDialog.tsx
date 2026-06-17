import { useEffect, useRef } from 'react';
import { Terminal, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import type { LogEntry } from '../../types';
import { SystemStatusLogsList } from '../SystemStatusLogsList';

export interface SystemStatusLogsDialogProps {
  open: boolean;
  onClose: () => void;
  logs: LogEntry[];
  selectedStreamId: string;
}

export function SystemStatusLogsDialog({
  open,
  onClose,
  logs,
  selectedStreamId,
}: SystemStatusLogsDialogProps) {
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !logsContainerRef.current) return;
    logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
  }, [open, logs]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="inset-0 top-0 left-0 max-w-none w-full h-full translate-x-0 translate-y-0 flex flex-col p-0 rounded-none">
        <div className="flex items-center justify-between gap-3 p-4 sm:p-5 border-b border-border-glass shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-[rgba(56,189,248,0.12)] p-2 rounded-lg shrink-0">
              <Terminal size={18} color="var(--color-secondary)" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[1.05rem]">System Status Logs</DialogTitle>
              <p className="text-[0.72rem] text-text-muted mt-0.5 truncate">
                Live edge device events for the selected camera stream
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn p-1.5 bg-transparent text-text-muted hover:text-text-primary border-none rounded-lg hover:bg-[rgba(255,255,255,0.06)] shrink-0"
            aria-label="Close logs"
          >
            <X size={18} />
          </button>
        </div>

        <div
          ref={logsContainerRef}
          className="font-mono bg-[rgba(0,0,0,0.5)] m-4 sm:m-5 flex-1 min-h-0 overflow-y-auto rounded-lg p-4 text-[0.85rem] leading-[1.5] text-[#38bdf8] border border-[rgba(255,255,255,0.05)]"
        >
          <SystemStatusLogsList logs={logs} selectedStreamId={selectedStreamId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
