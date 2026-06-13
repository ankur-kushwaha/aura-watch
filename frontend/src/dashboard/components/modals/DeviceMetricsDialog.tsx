import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, X } from 'lucide-react';
import { apiFetch } from '../../../api';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import type { DeviceSystemMetrics } from '../../types';
import { formatBytes, formatPercent, formatUptime } from '../../utils/format';

export interface DeviceMetricsDialogProps {
  device: { deviceId: string; name: string } | null;
  onClose: () => void;
}

export function DeviceMetricsDialog({ device, onClose }: DeviceMetricsDialogProps) {
  const [metrics, setMetrics] = useState<DeviceSystemMetrics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchMetrics = useCallback(async (deviceId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/devices/${deviceId}/metrics`);
      const data = await res.json();
      if (res.ok) {
        setMetrics(data.metrics || null);
        if (!data.metrics) {
          setError('No metrics returned from device.');
        }
      } else {
        setMetrics(null);
        setError(data.error || 'Failed to fetch device metrics');
      }
    } catch (err) {
      console.error('Failed to fetch device metrics', err);
      setMetrics(null);
      setError('Failed to fetch device metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!device) {
      setMetrics(null);
      setError('');
      return;
    }
    void fetchMetrics(device.deviceId);
  }, [device, fetchMetrics]);

  return (
    <Dialog open={!!device} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[560px] p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-[rgba(124,58,237,0.15)] p-2 rounded-lg">
              <Activity size={18} color="var(--color-primary)" />
            </div>
            <div>
              <DialogTitle>Device Metrics — {device?.name}</DialogTitle>
              <p className="text-[0.72rem] text-text-muted mt-0.5">{device?.deviceId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => device && void fetchMetrics(device.deviceId)}
              disabled={loading}
              className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md flex items-center gap-1"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
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

        {loading && !metrics ? (
          <div className="text-text-muted text-[0.85rem] py-8 text-center">Fetching metrics from device...</div>
        ) : error ? (
          <div className="text-danger text-[0.85rem] py-6 text-center">{error}</div>
        ) : metrics ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-[0.78rem]">
              <div className="rounded-lg border border-border-glass bg-[rgba(255,255,255,0.02)] p-3">
                <div className="text-text-muted text-[0.68rem] uppercase tracking-wide">Hostname</div>
                <div className="font-medium mt-1 truncate">{metrics.hostname || '—'}</div>
              </div>
              <div className="rounded-lg border border-border-glass bg-[rgba(255,255,255,0.02)] p-3">
                <div className="text-text-muted text-[0.68rem] uppercase tracking-wide">Uptime</div>
                <div className="font-medium mt-1">{formatUptime(metrics.uptime_seconds)}</div>
              </div>
            </div>

            <div className="rounded-lg border border-border-glass bg-[rgba(255,255,255,0.02)] p-3.5">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[0.8rem] font-semibold text-text-secondary">CPU</span>
                <span className="text-[0.78rem] text-text-primary">
                  {metrics.cpu_percent != null ? `${metrics.cpu_percent}%` : '—'}
                  {metrics.cpu_count ? ` • ${metrics.cpu_count} cores` : ''}
                </span>
              </div>
              <div className="h-2 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, metrics.cpu_percent ?? 0))}%` }}
                />
              </div>
              {metrics.load_avg && (
                <p className="text-[0.68rem] text-text-muted mt-2">
                  Load avg: {metrics.load_avg.map((v: number) => v.toFixed(2)).join(' / ')}
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border-glass bg-[rgba(255,255,255,0.02)] p-3.5">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[0.8rem] font-semibold text-text-secondary">RAM</span>
                <span className="text-[0.78rem] text-text-primary">
                  {formatBytes(metrics.memory_used_bytes)} / {formatBytes(metrics.memory_total_bytes)}
                  {' '}({formatPercent(metrics.memory_used_bytes, metrics.memory_total_bytes)})
                </span>
              </div>
              <div className="h-2 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(
                        0,
                        ((metrics.memory_used_bytes ?? 0) / Math.max(metrics.memory_total_bytes ?? 1, 1)) * 100,
                      ),
                    )}%`,
                  }}
                />
              </div>
              <p className="text-[0.68rem] text-text-muted mt-2">
                Available: {formatBytes(metrics.memory_available_bytes)}
              </p>
            </div>

            {(metrics.swap_total_bytes ?? 0) > 0 && (
              <div className="rounded-lg border border-border-glass bg-[rgba(255,255,255,0.02)] p-3.5">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[0.8rem] font-semibold text-text-secondary">Swap</span>
                  <span className="text-[0.78rem] text-text-primary">
                    {formatBytes(metrics.swap_used_bytes)} / {formatBytes(metrics.swap_total_bytes)}
                    {' '}({formatPercent(metrics.swap_used_bytes, metrics.swap_total_bytes)})
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-all duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          ((metrics.swap_used_bytes ?? 0) / Math.max(metrics.swap_total_bytes ?? 1, 1)) * 100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="rounded-lg border border-border-glass bg-[rgba(255,255,255,0.02)] p-3.5">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[0.8rem] font-semibold text-text-secondary">Disk (/)</span>
                <span className="text-[0.78rem] text-text-primary">
                  {formatBytes(metrics.disk_used_bytes)} / {formatBytes(metrics.disk_total_bytes)}
                  {' '}({formatPercent(metrics.disk_used_bytes, metrics.disk_total_bytes)})
                </span>
              </div>
              <div className="h-2 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-sky-400 transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(
                        0,
                        ((metrics.disk_used_bytes ?? 0) / Math.max(metrics.disk_total_bytes ?? 1, 1)) * 100,
                      ),
                    )}%`,
                  }}
                />
              </div>
              <p className="text-[0.68rem] text-text-muted mt-2">
                Free: {formatBytes(metrics.disk_free_bytes)}
              </p>
            </div>

            {metrics.platform && (
              <p className="text-[0.68rem] text-text-muted text-center">{metrics.platform}</p>
            )}
          </div>
        ) : (
          <div className="text-text-muted text-[0.85rem] py-6 text-center">No metrics available.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
