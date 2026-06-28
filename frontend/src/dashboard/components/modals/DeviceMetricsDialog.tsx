import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, X, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../../../api';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import type { DeviceEvent, DeviceSystemMetrics } from '../../types';
import { formatBytes, formatPercent, formatUptime } from '../../utils/format';

interface UptimeTimelineSlot {
  label: string;
  status: 'online' | 'warning' | 'offline';
  message: string;
  eventsCount: number;
  events: DeviceEvent[];
}

function buildUptimeTimeline(events: DeviceEvent[], now: number): UptimeTimelineSlot[] {
  const slots: UptimeTimelineSlot[] = [];
  for (let i = 23; i >= 0; i--) {
    const targetTime = new Date(now - i * 60 * 60 * 1000);
    const hourStart = new Date(targetTime.getFullYear(), targetTime.getMonth(), targetTime.getDate(), targetTime.getHours(), 0, 0);
    const hourEnd = new Date(targetTime.getFullYear(), targetTime.getMonth(), targetTime.getDate(), targetTime.getHours(), 59, 59);

    const slotEvents = events.filter((e) => {
      const d = new Date(e.createdAt);
      return d >= hourStart && d <= hourEnd;
    });

    const healthEvents = slotEvents.filter((e) => e.eventType === 'health_check');
    const otherEvents = slotEvents.filter((e) => e.eventType !== 'health_check');

    let status: UptimeTimelineSlot['status'] = 'online';
    let message = 'Healthy connection, no incidents';

    const hasOffline = otherEvents.some((e) =>
      /disconnect|offline|heartbeat timed out/i.test(e.message) || e.eventType === 'websocket_error',
    ) || (healthEvents.length > 0 && healthEvents.every((e) => e.detail?.ws === 'down'));
    const hasRecovery = otherEvents.some((e) =>
      /reconnect|connected|recovered/i.test(e.message),
    );

    let avgCpu = 0;
    if (healthEvents.length > 0) {
      const cpus = healthEvents
        .map((e) => e.detail?.cpu)
        .filter((c): c is number => typeof c === 'number');
      if (cpus.length > 0) {
        avgCpu = Math.round(cpus.reduce((a, b) => a + b, 0) / cpus.length);
      }
    }

    if (hasOffline) {
      status = 'offline';
      message = 'Connection lost / offline event';
    } else if (
      otherEvents.some((e) => e.severity === 'warn' || e.severity === 'error')
      || (hasRecovery && otherEvents.length > 1)
      || healthEvents.some((e) => e.severity === 'warn')
    ) {
      status = 'warning';
      message = avgCpu > 0 ? `Unstable • Avg CPU: ${avgCpu}%` : 'High jitter / connection unstable';
    } else if (avgCpu > 0) {
      message = `Healthy • Avg CPU: ${avgCpu}%`;
    }

    slots.push({
      label: `${hourStart.getHours().toString().padStart(2, '0')}:00`,
      status,
      message,
      eventsCount: slotEvents.length,
      events: slotEvents,
    });
  }
  return slots;
}

export interface DeviceMetricsDialogProps {
  device: { deviceId: string; name: string } | null;
  onClose: () => void;
}

export function DeviceMetricsDialog({ device, onClose }: DeviceMetricsDialogProps) {
  const [metrics, setMetrics] = useState<DeviceSystemMetrics | null>(null);
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [pingLatency, setPingLatency] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hoveredHour, setHoveredHour] = useState<UptimeTimelineSlot | null>(null);
  const [timelineAnchor, setTimelineAnchor] = useState(() => Date.now());
  const deviceId = device?.deviceId ?? null;
  const [activeDeviceId, setActiveDeviceId] = useState(deviceId);

  if (deviceId !== activeDeviceId) {
    setActiveDeviceId(deviceId);
    if (!deviceId) {
      setMetrics(null);
      setEvents([]);
      setPingLatency(null);
      setError('');
      setHoveredHour(null);
    }
  }

  const fetchMetricsAndEvents = useCallback(async (targetDeviceId: string) => {
    setLoading(true);
    setError('');
    const startTime = Date.now();
    try {
      const [resMetrics, resEvents] = await Promise.all([
        apiFetch(`/devices/${targetDeviceId}/metrics`),
        apiFetch(`/devices/${targetDeviceId}/events?limit=300`),
      ]);

      const latency = Date.now() - startTime;
      setPingLatency(latency);
      setTimelineAnchor(Date.now());

      if (resMetrics.ok) {
        const dataMetrics = await resMetrics.json();
        setMetrics(dataMetrics.metrics || null);
        if (!dataMetrics.metrics) {
          console.warn('No platform metrics returned');
        }
      } else {
        const dataMetrics = await resMetrics.json().catch(() => ({}));
        setError(dataMetrics.error || 'Failed to fetch device metrics');
      }

      if (resEvents.ok) {
        const dataEvents = await resEvents.json();
        setEvents(dataEvents.events || []);
      }
    } catch (err) {
      console.error('Failed to fetch metrics and events', err);
      setError('Connection to edge device timed out.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!device) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load metrics when device dialog opens
    void fetchMetricsAndEvents(device.deviceId);
  }, [device, fetchMetricsAndEvents]);

  const timelineSlots = useMemo(
    () => buildUptimeTimeline(events, timelineAnchor),
    [events, timelineAnchor],
  );
  const healthyCount = timelineSlots.filter(s => s.status === 'online').length;
  const uptimePercentage = Math.round((healthyCount / 24) * 100);

  // Generate coordinates for SVG CPU Usage Chart
  const generateSvgChartPoints = () => {
    const width = 480;
    const height = 80;
    const padding = 10;
    const pointsCount = timelineSlots.length;
    const step = (width - padding * 2) / (pointsCount - 1);

    const points = timelineSlots.map((slot, idx) => {
      const x = padding + idx * step;
      let cpuValue = 0;

      // Find average CPU for this slot from events
      const healthEvents = slot.events.filter(e => e.eventType === 'health_check');
      if (healthEvents.length > 0) {
        const cpus = healthEvents.map(e => e.detail?.cpu).filter((c): c is number => typeof c === 'number');
        if (cpus.length > 0) {
          cpuValue = cpus.reduce((a, b) => a + b, 0) / cpus.length;
        }
      }

      // Map CPU (0 to 100%) to Y coordinate (height - padding to padding)
      const maxVal = 100;
      const y = height - padding - (cpuValue / maxVal) * (height - padding * 2);
      return { x, y, value: cpuValue, slot };
    });

    const pathData = points.reduce((acc, p, idx) => {
      return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, '');

    // Path for gradient area underneath the line
    const areaData = points.length > 0 
      ? `${pathData} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`
      : '';

    return { points, pathData, areaData };
  };

  const chartData = generateSvgChartPoints();

  return (
    <Dialog open={!!device} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[560px] p-6 flex flex-col gap-4 bg-[#0b0f19] border border-border-glass text-text-primary rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-[rgba(6,182,212,0.15)] p-2 rounded-lg">
              <Activity size={18} className="text-[#06B6D4]" />
            </div>
            <div className="text-left">
              <DialogTitle className="text-[1.1rem] font-bold text-white">Device Health & Metrics</DialogTitle>
              <p className="text-[0.72rem] text-text-muted mt-0.5 font-mono">{device?.name} ({device?.deviceId})</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => device && void fetchMetricsAndEvents(device.deviceId)}
              disabled={loading}
              className="btn py-1.5 px-3 border border-border-glass bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.07)] text-text-secondary hover:text-white rounded-lg text-[0.75rem] font-bold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn p-1.5 bg-transparent text-text-muted hover:text-white border-none rounded-lg hover:bg-[rgba(255,255,255,0.06)] cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="h-px bg-border-glass shrink-0" />

        {loading && !metrics && !events.length ? (
          <div className="text-text-muted text-[0.85rem] py-12 text-center flex flex-col items-center gap-2">
            <RefreshCw size={24} className="animate-spin text-primary" />
            <span>Establishing connection with edge device...</span>
          </div>
        ) : error && !metrics && !events.length ? (
          <div className="text-[#EF4444] text-[0.85rem] py-12 text-center flex flex-col items-center gap-2">
            <ShieldAlert size={24} />
            <span>{error}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-5 overflow-y-auto max-h-[70vh] pr-1 text-left">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-[#EF4444] text-[0.78rem] flex items-center gap-2 shrink-0">
                <ShieldAlert size={14} />
                <span>{error}</span>
              </div>
            )}
            {/* Ping / Latency Metrics Banner */}
            <div className="grid grid-cols-3 gap-3 text-[0.78rem]">
              <div className="rounded-xl border border-border-glass bg-[rgba(15,23,42,0.45)] p-3">
                <div className="text-text-muted text-[0.65rem] font-bold uppercase tracking-wider">Live Ping</div>
                <div className="font-extrabold text-[1.1rem] text-white mt-1">
                  {pingLatency ? `${pingLatency}ms` : '—'}
                </div>
              </div>
              <div className="rounded-xl border border-border-glass bg-[rgba(15,23,42,0.45)] p-3">
                <div className="text-text-muted text-[0.65rem] font-bold uppercase tracking-wider">Uptime (24h)</div>
                <div className={`font-extrabold text-[1.1rem] mt-1 ${uptimePercentage > 95 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {uptimePercentage}%
                </div>
              </div>
              <div className="rounded-xl border border-border-glass bg-[rgba(15,23,42,0.45)] p-3">
                <div className="text-text-muted text-[0.65rem] font-bold uppercase tracking-wider">Host State</div>
                <div className="font-extrabold text-[1.1rem] text-white mt-1 flex items-center gap-1">
                  {uptimePercentage > 90 ? (
                    <span className="text-emerald-400 flex items-center gap-1 text-[0.88rem] font-bold">
                      <CheckCircle2 size={14} /> Normal
                    </span>
                  ) : (
                    <span className="text-amber-400 flex items-center gap-1 text-[0.88rem] font-bold">
                      <ShieldAlert size={14} /> Unstable
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Healthcheck / Uptime Graph */}
            <div className="rounded-xl border border-border-glass bg-[rgba(15,23,42,0.45)] p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <h4 className="text-[0.8rem] font-bold text-white">Connection Health Check Timeline</h4>
                <span className="text-[0.68rem] text-text-muted font-medium">Last 24 Hours</span>
              </div>

              {/* Status Grid of Uptime Bars */}
              <div className="flex items-center gap-1 w-full justify-between h-7 relative">
                {timelineSlots.map((slot, idx) => (
                  <div
                    key={idx}
                    onMouseEnter={() => setHoveredHour(slot)}
                    onMouseLeave={() => setHoveredHour(null)}
                    className={`flex-1 h-6 rounded transition-all duration-150 cursor-pointer hover:scale-y-110 ${
                      slot.status === 'online' 
                        ? 'bg-emerald-500 hover:bg-emerald-400' 
                        : slot.status === 'warning' 
                        ? 'bg-amber-500 hover:bg-amber-400' 
                        : 'bg-red-500 hover:bg-red-400'
                    }`}
                  />
                ))}
              </div>

              {/* Tooltip display */}
              <div className="h-6 flex items-center justify-between text-[0.72rem] px-1 bg-[rgba(255,255,255,0.01)] rounded border border-[rgba(255,255,255,0.03)]">
                {hoveredHour ? (
                  <>
                    <span className="font-bold text-white">{hoveredHour.label}</span>
                    <span className={`font-semibold ${
                      hoveredHour.status === 'online' ? 'text-emerald-400' : hoveredHour.status === 'warning' ? 'text-amber-400' : 'text-red-400'
                    }`}>
                      {hoveredHour.message}
                    </span>
                  </>
                ) : (
                  <span className="text-text-muted font-medium italic">Hover over status bars to inspect details</span>
                )}
              </div>
            </div>

            {/* SVG CPU Trend Chart */}
            <div className="rounded-xl border border-border-glass bg-[rgba(15,23,42,0.45)] p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <h4 className="text-[0.8rem] font-bold text-white">CPU Usage Trend (%)</h4>
                <span className="text-[0.68rem] text-text-muted font-semibold">Max 100%</span>
              </div>
              <div className="w-full bg-[rgba(0,0,0,0.15)] rounded-lg overflow-hidden border border-[rgba(255,255,255,0.02)]">
                <svg viewBox="0 0 480 80" className="w-full h-20">
                  <defs>
                    <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  
                  {/* Grid Lines */}
                  <line x1="10" y1="40" x2="470" y2="40" stroke="rgba(255,255,255,0.04)" strokeDasharray="3,3" />
                  
                  {/* Gradient Under Area */}
                  {chartData.areaData && (
                    <path d={chartData.areaData} fill="url(#latencyGradient)" />
                  )}

                  {/* Main Line */}
                  {chartData.pathData && (
                    <path
                      d={chartData.pathData}
                      fill="none"
                      stroke="#06B6D4"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="filter drop-shadow-[0_0_4px_rgba(6,182,212,0.4)]"
                    />
                  )}

                  {/* Interactive Circles */}
                  {chartData.points.map((p, idx) => (
                    p.value > 0 && (
                      <circle
                        key={idx}
                        cx={p.x}
                        cy={p.y}
                        r="2.5"
                        fill="#06B6D4"
                        stroke="#0b0f19"
                        strokeWidth="1"
                        className="hover:r-4 transition-all cursor-crosshair"
                      >
                        <title>{`${p.slot.label} - CPU ${p.value.toFixed(1)}%`}</title>
                      </circle>
                    )
                  ))}
                </svg>
              </div>
            </div>

            {/* System Performance (CPU/RAM/Disk) */}
            {metrics ? (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3 text-[0.78rem]">
                  <div className="rounded-lg border border-border-glass bg-[rgba(255,255,255,0.015)] p-3">
                    <div className="text-text-muted text-[0.68rem] uppercase tracking-wide">Hostname</div>
                    <div className="font-semibold mt-1 truncate text-white">{metrics.hostname || '—'}</div>
                  </div>
                  <div className="rounded-lg border border-border-glass bg-[rgba(255,255,255,0.015)] p-3">
                    <div className="text-text-muted text-[0.68rem] uppercase tracking-wide">Uptime</div>
                    <div className="font-semibold mt-1 text-white">{formatUptime(metrics.uptime_seconds)}</div>
                  </div>
                </div>

                {/* CPU usage bar */}
                <div className="rounded-lg border border-border-glass bg-[rgba(255,255,255,0.015)] p-3.5">
                  <div className="flex justify-between items-center mb-2 text-[0.78rem]">
                    <span className="font-semibold text-text-secondary">CPU Usage</span>
                    <span className="text-white font-bold">
                      {metrics.cpu_percent != null ? `${metrics.cpu_percent}%` : '—'}
                      {metrics.cpu_count ? ` • ${metrics.cpu_count} cores` : ''}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#06B6D4] transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, metrics.cpu_percent ?? 0))}%` }}
                    />
                  </div>
                  {metrics.load_avg && (
                    <p className="text-[0.68rem] text-text-muted mt-2">
                      Load average: {metrics.load_avg.map((v: number) => v.toFixed(2)).join(' / ')}
                    </p>
                  )}
                </div>

                {/* RAM usage bar */}
                <div className="rounded-lg border border-border-glass bg-[rgba(255,255,255,0.015)] p-3.5">
                  <div className="flex justify-between items-center mb-2 text-[0.78rem]">
                    <span className="font-semibold text-text-secondary">System Memory</span>
                    <span className="text-white font-bold">
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
                    Available memory: {formatBytes(metrics.memory_available_bytes)}
                  </p>
                </div>

                {/* Disk usage bar */}
                <div className="rounded-lg border border-border-glass bg-[rgba(255,255,255,0.015)] p-3.5">
                  <div className="flex justify-between items-center mb-2 text-[0.78rem]">
                    <span className="font-semibold text-text-secondary">Disk Storage (/)</span>
                    <span className="text-white font-bold">
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
                    Available storage: {formatBytes(metrics.disk_free_bytes)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-text-muted text-[0.78rem] p-3 text-center border border-dashed border-border-glass rounded-lg">
                Host hardware metrics not available for non-Linux or offline state.
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
