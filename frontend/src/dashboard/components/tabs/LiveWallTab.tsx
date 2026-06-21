import { useState, useEffect } from 'react';
import { ShieldAlert, Video } from 'lucide-react';
import type { CameraStream, Notification } from '../../types';

interface AlertItem {
  id: string;
  type: string;
  cameraCode: string;
  cameraName: string;
  detail: string;
  time: string;
  severity: 'high' | 'medium' | 'low';
}

const initialAlerts: AlertItem[] = [
  {
    id: '1',
    type: 'Tailgating detected',
    cameraCode: 'C-01',
    cameraName: 'Main Entrance',
    detail: '2 persons · 1 badge scan',
    time: '14:32:01',
    severity: 'high',
  },
  {
    id: '2',
    type: 'Line crossing',
    cameraCode: 'C-31',
    cameraName: 'Perimeter Gate',
    detail: 'Restricted zone breach',
    time: '14:28:44',
    severity: 'high',
  },
  {
    id: '3',
    type: 'Person loitering',
    cameraCode: 'C-07',
    cameraName: 'Loading Dock',
    detail: 'Dwell 4m 12s',
    time: '14:21:10',
    severity: 'medium',
  },
  {
    id: '4',
    type: 'Unattended object',
    cameraCode: 'C-04',
    cameraName: 'Lobby',
    detail: 'Bag · stationary 8m',
    time: '14:14:33',
    severity: 'medium',
  },
  {
    id: '5',
    type: 'Motion after hours',
    cameraCode: 'C-18',
    cameraName: 'Server Room',
    detail: 'Restricted · no badge',
    time: '14:08:02',
    severity: 'low',
  },
  {
    id: '6',
    type: 'Crowd forming',
    cameraCode: 'C-24',
    cameraName: 'Cafeteria',
    detail: '8 persons · gathering',
    time: '13:56:47',
    severity: 'medium',
  },
];

interface CameraFeed {
  code: string;
  name: string;
  zone: 'Exterior' | 'Restricted' | 'Interior';
  hasTracker?: boolean;
  trackerLabel?: string;
  trackerColor?: string;
  trackerBox?: { top: string; left: string; width: string; height: string };
  streamId?: string;
  streamUrl?: string;
  status?: string;
  isOnline?: boolean;
}

const getWebRtcPreviewUrl = (stream: CameraStream | undefined): string | null => {
  if (!stream) return null;

  if (stream.streamUrl) {
    const match = stream.streamUrl.match(/^rtsp:\/\/([^:/]+)(?::\d+)?\/(.+)$/i);
    if (match) {
      const parsedHost = match[1];
      const parsedPath = match[2];
      
      if (!parsedHost.match(/^(127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|localhost)/)) {
        const cleanPath = parsedPath.endsWith('/') ? parsedPath : `${parsedPath}/`;
        return `https://${parsedHost}/${cleanPath}`;
      }
    }
  }

  const host = stream.streamHost || 'mediamtx.adboardtools.com';
  const streamPath = `live_${stream.streamId}`;
  return `https://${host}/${streamPath}/`;
};

const cameras: CameraFeed[] = [
  {
    code: 'C-01',
    name: 'Main Entrance',
    zone: 'Exterior',
    hasTracker: true,
    trackerLabel: 'TRACKING - ID 4671',
    trackerColor: 'var(--color-danger)',
    trackerBox: { top: '35%', left: '35%', width: '30%', height: '50%' },
  },
  {
    code: 'C-04',
    name: 'Lobby',
    zone: 'Interior',
  },
  {
    code: 'C-07',
    name: 'Loading Dock',
    zone: 'Exterior',
    hasTracker: true,
    trackerLabel: 'Person · 88%',
    trackerColor: 'var(--color-secondary)',
    trackerBox: { top: '25%', left: '45%', width: '25%', height: '55%' },
  },
  {
    code: 'C-12',
    name: 'Reception',
    zone: 'Interior',
  },
  {
    code: 'C-15',
    name: 'East Corridor',
    zone: 'Restricted',
    hasTracker: true,
    trackerLabel: 'ID 4471',
    trackerColor: 'var(--color-danger)',
    trackerBox: { top: '50%', left: '40%', width: '20%', height: '35%' },
  },
  {
    code: 'C-18',
    name: 'Server Room',
    zone: 'Restricted',
    hasTracker: true,
    trackerLabel: 'Motion',
    trackerColor: 'var(--color-warning)',
    trackerBox: { top: '35%', left: '30%', width: '35%', height: '45%' },
  },
];

interface LiveWallTabProps {
  streams?: CameraStream[];
  notifications?: Notification[];
}

export function LiveWallTab({ streams = [], notifications = [] }: LiveWallTabProps) {
  const [selectedZone, setSelectedZone] = useState<'All' | 'Exterior' | 'Restricted'>('All');
  const [activeAlertCamera, setActiveAlertCamera] = useState<string | null>(null);
  const [cameraTime, setCameraTime] = useState('14:32:08');

  // Derive actual camera feeds from backend streams
  const actualCameras: CameraFeed[] = (streams && streams.length > 0)
    ? streams.map((stream, idx) => {
        const isOnline = stream.status !== 'Offline' && stream.status !== 'Error';
        return {
          code: `C-${String(idx + 1).padStart(2, '0')}`,
          name: stream.name,
          zone: stream.name.toLowerCase().includes('lobby') || stream.name.toLowerCase().includes('reception') || stream.name.toLowerCase().includes('office')
            ? 'Interior'
            : stream.name.toLowerCase().includes('server') || stream.name.toLowerCase().includes('corridor')
            ? 'Restricted'
            : 'Exterior',
          hasTracker: stream.trackingEnabled,
          trackerLabel: stream.detectPerson ? 'Person' : stream.detectVehicle ? 'Vehicle' : undefined,
          trackerColor: 'var(--color-secondary)',
          trackerBox: { top: '30%', left: '30%', width: '40%', height: '40%' },
          streamId: stream.streamId,
          streamUrl: stream.streamUrl,
          status: stream.status,
          isOnline,
        };
      })
    : cameras.map(c => ({ ...c, isOnline: true }));

  // Derive alert stream items from notifications
  const alerts = (notifications && notifications.length > 0)
    ? notifications.map((n) => {
        const matchingStreamIdx = streams.findIndex((s) => s.streamId === n.streamId);
        const cameraCode = matchingStreamIdx !== -1 ? `C-${String(matchingStreamIdx + 1).padStart(2, '0')}` : 'C-01';
        const cameraName = streams.find((s) => s.streamId === n.streamId)?.name || 'Unknown Camera';
        
        let timeStr = '12:00:00';
        try {
          const d = new Date(n.createdAt);
          const formatNum = (x: number) => String(x).padStart(2, '0');
          timeStr = `${formatNum(d.getHours())}:${formatNum(d.getMinutes())}:${formatNum(d.getSeconds())}`;
        } catch {
          // Fallback
        }

        return {
          id: n.id,
          type: n.title,
          cameraCode,
          cameraName,
          detail: n.body,
          time: timeStr,
          severity: n.riskLevel === 'high' ? ('high' as const) : n.riskLevel === 'medium' ? ('medium' as const) : ('low' as const),
        };
      })
    : initialAlerts;

  // Keep camera feed clock ticking
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const formatTime = (t: number) => String(t).padStart(2, '0');
      setCameraTime(`${formatTime(now.getHours())}:${formatTime(now.getMinutes())}:${formatTime(now.getSeconds())}`);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Filter camera feeds based on active zone selection
  const filteredFeeds = actualCameras.filter((feed) => {
    if (selectedZone === 'All') return true;
    return feed.zone === selectedZone;
  });

  const handleAlertClick = (alert: AlertItem) => {
    setActiveAlertCamera(alert.cameraCode);
    setTimeout(() => setActiveAlertCamera(null), 3000);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 animate-[slideUp_0.3s_ease-out] w-full min-h-[calc(100vh-140px)]">
      {/* LEFT GRID: Live feeds */}
      <div className="xl:col-span-9 flex flex-col gap-4">
        {/* Sub-header & Filter Options */}
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-[1.25rem] font-bold tracking-tight">Live wall</h2>
          </div>
          <div className="flex gap-1.5 bg-[rgba(255,255,255,0.02)] p-1 rounded-lg border border-border-glass">
            {(['All', 'Exterior', 'Restricted'] as const).map((zone) => (
              <button
                key={zone}
                onClick={() => setSelectedZone(zone)}
                className={`py-1.5 px-3 rounded-md text-[0.78rem] font-semibold transition-all duration-200 border-none outline-none cursor-pointer ${
                  (zone === 'All' && selectedZone === 'All') || selectedZone === zone
                    ? 'bg-[rgba(255,255,255,0.08)] text-white shadow-sm'
                    : 'text-text-muted hover:text-text-secondary bg-transparent'
                }`}
              >
                {zone === 'All' ? 'All zones' : zone}
              </button>
            ))}
          </div>
        </div>

        {/* Video Feeds Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 flex-1">
          {filteredFeeds.map((feed) => {
            const isHighlighted = activeAlertCamera === feed.code;
            return (
              <div
                key={feed.code}
                className={`glass-panel overflow-hidden relative group flex flex-col cursor-pointer transition-all duration-300 ${
                  isHighlighted
                    ? 'border-[rgba(244,63,94,0.6)] shadow-[0_0_24px_rgba(244,63,94,0.35)] scale-[1.01]'
                    : 'border-border-glass'
                }`}
                style={{ aspectRatio: '4/3' }}
              >
                {/* Camera stream body */}
                <div className="flex-1 relative bg-gradient-to-br from-[#0c121e] to-[#060a12] w-full overflow-hidden select-none">
                  {feed.streamId && feed.isOnline && feed.streamUrl ? (
                    <iframe
                      src={getWebRtcPreviewUrl(streams.find((s) => s.streamId === feed.streamId)!)!}
                      title={`Live Stream ${feed.name}`}
                      className="w-full h-full border-0 rounded-lg block bg-[#090d16]"
                      allow="autoplay; fullscreen"
                    />
                  ) : feed.streamId ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-muted bg-[#090d16]">
                      <Video className="w-8 h-8 opacity-40 animate-pulse" />
                      <span className="text-[0.8rem] font-bold">Stream Offline</span>
                    </div>
                  ) : (
                    <>
                      {/* Grid layout lines */}
                      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none" />

                      {/* Scanlines Effect */}
                      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%)] bg-[size:100%_4px] pointer-events-none opacity-40" />

                      {/* Static Noise Overlay */}
                      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(circle,rgba(255,255,255,0.8)_1px,transparent_1px)] bg-[size:6px_6px] animate-[pulse_8s_infinite]" />

                      {/* Bounding Box Trackers */}
                      {feed.hasTracker && feed.trackerBox && (
                        <div
                          className="absolute border-2 rounded transition-all duration-300"
                          style={{
                            borderColor: feed.trackerColor,
                            top: feed.trackerBox.top,
                            left: feed.trackerBox.left,
                            width: feed.trackerBox.width,
                            height: feed.trackerBox.height,
                            boxShadow: `0 0 12px ${feed.trackerColor}40, inset 0 0 12px ${feed.trackerColor}20`,
                          }}
                        >
                          {/* Bounding Box Label */}
                          <div
                            className="absolute -top-6 left-0 px-2 py-0.5 rounded text-[0.65rem] font-bold text-white uppercase tracking-wider shadow-md select-none pointer-events-none"
                            style={{ backgroundColor: feed.trackerColor }}
                          >
                            {feed.trackerLabel}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Camera Code Overlay */}
                  <div className="absolute top-3 left-3 text-[0.72rem] font-extrabold text-text-secondary bg-[rgba(9,13,22,0.65)] px-2 py-0.5 rounded border border-[rgba(255,255,255,0.05)] select-none z-10">
                    {feed.code}
                  </div>

                  {/* Blinking REC Status indicator */}
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-[rgba(9,13,22,0.65)] px-2.5 py-0.5 rounded border border-[rgba(255,255,255,0.05)] select-none z-10">
                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${feed.isOnline ? 'bg-[var(--color-danger)] animate-[pulse-danger_1.2s_infinite]' : 'bg-text-muted'}`} />
                    <span className="text-[0.6rem] font-bold tracking-wider text-white">REC</span>
                  </div>

                  {/* Interactive stream play icons / overlays on hover */}
                  {(!feed.streamId || !feed.isOnline) && (
                    <div className="absolute inset-0 bg-[rgba(9,13,22,0.4)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center pointer-events-none">
                      <div className="bg-[rgba(255,255,255,0.06)] backdrop-blur p-3 rounded-full border border-border-glass">
                        <Video className="text-white w-5 h-5 animate-pulse" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer bar */}
                <div className="h-10 border-t border-border-glass bg-[rgba(9,13,22,0.6)] backdrop-blur px-3 flex justify-between items-center select-none shrink-0 text-text-secondary">
                  <span className="text-[0.75rem] font-semibold">{feed.name}</span>
                  <span className="text-[0.7rem] font-mono text-text-muted">{cameraTime}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT PANEL: Live Alert Stream */}
      <div className="xl:col-span-3 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-[1.1rem] font-bold flex items-center gap-2">
            <ShieldAlert size={18} className="text-[var(--color-danger)]" /> Alert stream
          </h2>
          <div className="flex items-center gap-1.5 bg-[rgba(244,63,94,0.1)] px-2.5 py-0.5 rounded-full border border-[rgba(244,63,94,0.25)] select-none">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-danger)] inline-block animate-[pulse-danger_0.8s_infinite]" />
            <span className="text-[0.65rem] font-extrabold tracking-wider text-[var(--color-danger)]">LIVE</span>
          </div>
        </div>

        {/* Alert Cards Container */}
        <div className="flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-200px)] pr-1 flex-1">
          {alerts.map((alert) => {
            const isHigh = alert.severity === 'high';
            const isMed = alert.severity === 'medium';
            const borderGlowColor = isHigh
              ? 'border-l-[var(--color-danger)]'
              : isMed
              ? 'border-l-[var(--color-warning)]'
              : 'border-l-[var(--color-secondary)]';

            return (
              <div
                key={alert.id}
                onClick={() => handleAlertClick(alert)}
                className={`glass-panel interactive cursor-pointer p-4 rounded-xl border-l-[3px] ${borderGlowColor} bg-[rgba(15,23,42,0.45)] hover:bg-[rgba(30,41,59,0.55)] transition-all duration-200 flex flex-col gap-1.5`}
              >
                {/* Header info */}
                <div className="flex justify-between items-start gap-2">
                  <h3 className="text-[0.88rem] font-bold text-text-primary leading-tight">
                    {alert.type}
                  </h3>
                  <span className="text-[0.68rem] text-text-muted font-mono whitespace-nowrap">
                    {alert.time}
                  </span>
                </div>

                {/* Details */}
                <div className="flex flex-wrap items-center gap-x-2 text-[0.72rem] text-text-secondary leading-normal">
                  <span className="font-bold text-[var(--color-secondary)]">
                    {alert.cameraCode}
                  </span>
                  <span className="text-text-muted font-semibold">·</span>
                  <span className="text-text-muted truncate">{alert.cameraName}</span>
                </div>

                <p className="text-[0.75rem] text-text-muted leading-relaxed truncate">
                  {alert.detail}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
