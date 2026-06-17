import type { LogEntry } from '../types';

function logLineClass(message: string): string | undefined {
  if (/\[Detector Error\]|WebSocket|stream lost|failed|error|timed out/i.test(message)) {
    return 'text-rose-400';
  }
  if (/stalled|retry|reconnect|cooldown/i.test(message)) {
    return 'text-amber-300';
  }
  return undefined;
}

export interface SystemStatusLogsListProps {
  logs: LogEntry[];
  selectedStreamId: string;
  className?: string;
}

export function SystemStatusLogsList({ logs, selectedStreamId, className }: SystemStatusLogsListProps) {
  if (logs.length === 0) {
    return (
      <div className={`text-text-muted text-[0.8rem] ${className ?? ''}`}>
        {selectedStreamId
          ? 'Waiting for edge device events... (camera errors, reconnects, and clip activity appear here)'
          : 'Select a camera stream to view logs.'}
      </div>
    );
  }

  return (
    <>
      {logs.map((log, index) => (
        <div key={index} className="mb-1">
          <span className="text-text-muted mr-2">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
          <span className={logLineClass(log.message)}>{log.message}</span>
        </div>
      ))}
    </>
  );
}
