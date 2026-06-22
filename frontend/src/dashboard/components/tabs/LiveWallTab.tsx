import { useState } from 'react';
import { SlidersHorizontal, Video, RefreshCw } from 'lucide-react';
import type { CameraStream } from '../../types';
import { EditStreamForm } from '../EditStreamForm';




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

const cameras: CameraFeed[] = [];

interface LiveWallTabProps {
  streams?: CameraStream[];
  onEditStream?: (streamId: string) => void;
  onUpdateStreamConfig?: (streamId: string, patch: Partial<CameraStream>) => Promise<void>;
}

const getStatusLabelAndColor = (status: string | undefined, isOnline: boolean) => {
  if (!isOnline) {
    return {
      label: 'OFFLINE',
      dotClass: 'bg-slate-500',
      bgClass: 'bg-[#090d16]/95 border border-slate-700 text-slate-400 font-bold'
    };
  }
  const s = status?.toLowerCase() || '';
  if (s === 'recording') {
    return {
      label: 'REC',
      dotClass: 'bg-[var(--color-danger)] animate-[pulse-danger_1.2s_infinite]',
      bgClass: 'bg-[#090d16]/95 border border-[var(--color-danger)]/60 text-[var(--color-danger)] font-black'
    };
  }
  if (s === 'processing' || s === 'processingvideo') {
    return {
      label: 'SUMMARIZING',
      dotClass: 'bg-[var(--color-secondary)] animate-pulse',
      bgClass: 'bg-[#090d16]/95 border border-[var(--color-secondary)]/60 text-[var(--color-secondary)] font-black'
    };
  }
  if (s === 'monitoring') {
    return {
      label: 'MONITORING',
      dotClass: 'bg-emerald-400 animate-[pulse-success_2s_infinite]',
      bgClass: 'bg-[#090d16]/95 border border-emerald-500/50 text-emerald-400 font-bold'
    };
  }
  if (s === 'error') {
    return {
      label: 'ERROR',
      dotClass: 'bg-[var(--color-danger)] animate-pulse',
      bgClass: 'bg-[#090d16]/95 border border-rose-500/60 text-rose-400 font-bold'
    };
  }
  return {
    label: 'IDLE',
    dotClass: 'bg-slate-400',
    bgClass: 'bg-[#090d16]/95 border border-slate-600 text-slate-200 font-bold'
  };
};

  export function LiveWallTab({ streams = [], onUpdateStreamConfig }: LiveWallTabProps) {
    const [selectedZone, setSelectedZone] = useState<'All' | 'Exterior' | 'Restricted'>('All');
    const [selectedCameraCode, setSelectedCameraCode] = useState<string | null>(null);
    const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({});

    const handleRefreshStream = (streamId: string) => {
      setRefreshKeys((prev) => ({
        ...prev,
        [streamId]: (prev[streamId] || 0) + 1,
      }));
    };


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

    // Filter camera feeds based on active zone selection
    const filteredFeeds = actualCameras.filter((feed) => {
      if (selectedZone === 'All') return true;
      return feed.zone === selectedZone;
    });

    const selectedFeed = actualCameras.find((c) => c.code === selectedCameraCode) || null;
    const selectedStream = selectedFeed && streams ? streams.find((s) => s.streamId === selectedFeed.streamId) : null;



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
                  className={`py-1.5 px-3 rounded-md text-[0.78rem] font-semibold transition-all duration-200 border-none outline-none cursor-pointer ${(zone === 'All' && selectedZone === 'All') || selectedZone === zone
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
              const isSelected = selectedCameraCode === feed.code;
              const stream = feed.streamId ? streams.find((s) => s.streamId === feed.streamId) : undefined;
              return (
                <div
                  key={feed.code}
                  onClick={() => setSelectedCameraCode(feed.code)}
                  className={`glass-panel overflow-hidden relative group flex flex-col cursor-pointer transition-all duration-300 ${isSelected
                    ? 'border-[var(--color-secondary)] shadow-[0_0_20px_rgba(6,182,212,0.25)] scale-[1.01]'
                    : 'border-border-glass hover:border-[rgba(255,255,255,0.1)]'
                    }`}
                  style={{ aspectRatio: '4/3' }}
                >
                  {/* Camera stream body */}
                  <div className="flex-1 relative bg-gradient-to-br from-[#0c121e] to-[#060a12] w-full overflow-hidden select-none">
                    {/* Transparent overlay to capture clicks instead of letting the iframe intercept them */}
                    <div className="absolute inset-0 z-10 cursor-pointer" />
                    {feed.streamId && feed.isOnline && feed.streamUrl ? (
                      <iframe
                        key={`${feed.streamId}-${refreshKeys[feed.streamId] || 0}`}
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

                    {/* Camera Code Overlay & Refresh Button */}
                    <div className="absolute top-3 left-3 flex items-center gap-1.5 z-20">
                      <div className="text-[0.72rem] font-extrabold text-text-secondary bg-[rgba(9,13,22,0.65)] px-2 py-0.5 rounded border border-[rgba(255,255,255,0.05)] select-none">
                        {feed.code}
                      </div>
                      {feed.streamId && feed.isOnline && feed.streamUrl && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRefreshStream(feed.streamId!);
                          }}
                          title="Refresh Stream"
                          className="p-1 rounded bg-[rgba(9,13,22,0.65)] border border-[rgba(255,255,255,0.05)] hover:border-[rgba(255,255,255,0.25)] hover:bg-[rgba(255,255,255,0.05)] text-text-secondary hover:text-white transition-all cursor-pointer flex items-center justify-center"
                        >
                          <RefreshCw size={11} />
                        </button>
                      )}
                    </div>

                    {/* Blinking REC Status indicator */}
                    {(() => {
                      const statusMeta = getStatusLabelAndColor(feed.status, feed.isOnline ?? false);
                      return (
                        <div className={`absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-0.5 rounded select-none z-10 font-bold text-[0.65rem] tracking-wider ${statusMeta.bgClass}`}>
                          <span className={`w-1.5 h-1.5 rounded-full inline-block ${statusMeta.dotClass}`} />
                          <span>{statusMeta.label}</span>
                        </div>
                      );
                    })()}

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
                  <div className="h-12 border-t border-border-glass bg-[rgba(9,13,22,0.6)] backdrop-blur px-3 flex justify-between items-center select-none shrink-0 text-text-secondary" onClick={(e) => e.stopPropagation()}>
                    <span className="text-[0.75rem] font-semibold">{feed.name}</span>
                    {stream && onUpdateStreamConfig && (
                      <div className="flex items-center gap-4">
                        {/* Object Tracking */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[0.68rem] font-bold text-text-secondary">Tracking</span>
                          <label className="relative inline-flex items-center cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={stream.trackingEnabled}
                              onChange={(e) => onUpdateStreamConfig(stream.streamId, { trackingEnabled: e.target.checked })}
                            />
                            <div className="w-8 h-4 bg-white/10 rounded-full relative peer peer-checked:bg-[var(--color-secondary)] transition-colors duration-200 after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-transform after:duration-200 peer-checked:after:translate-x-4"></div>
                          </label>
                        </div>

                        <div className="w-px h-3 bg-[rgba(255,255,255,0.15)]" />

                        {/* AI Summaries */}
                        <div className={`flex items-center gap-1.5 transition-opacity duration-200 ${!stream.trackingEnabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}`}>
                          <span className="text-[0.68rem] font-bold text-text-secondary">AI Summary</span>
                          <label className="relative inline-flex items-center cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              disabled={!stream.trackingEnabled}
                              checked={stream.trackingEnabled && stream.aiSummaryEnabled !== false}
                              onChange={(e) => onUpdateStreamConfig(stream.streamId, { aiSummaryEnabled: e.target.checked })}
                            />
                            <div className="w-8 h-4 bg-white/10 rounded-full relative peer peer-checked:bg-[var(--color-secondary)] transition-colors duration-200 after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-transform after:duration-200 peer-checked:after:translate-x-4"></div>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT PANEL: Camera Properties */}
        <div className="xl:col-span-3 flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border-glass pb-3">
            <h2 className="text-[1.1rem] font-bold flex items-center gap-2">
              <SlidersHorizontal size={18} className="text-[var(--color-secondary)]" /> IP Camera settings
            </h2>
            {selectedFeed && (
              <span className="text-[0.7rem] font-extrabold bg-[rgba(6,182,212,0.1)] text-[var(--color-secondary)] px-2 py-0.5 rounded border border-[rgba(6,182,212,0.25)] select-none">
                {selectedFeed.code}
              </span>
            )}
          </div>

          {/* Selected Camera Details / Form */}
          {selectedFeed && selectedStream ? (
            <EditStreamForm
              stream={selectedStream}
              allStreamIds={streams.map((s) => s.streamId)}
              onClose={() => setSelectedCameraCode(null)}
              onSaved={async () => {
                if (onUpdateStreamConfig) {
                  await onUpdateStreamConfig(selectedStream.streamId, {});
                }
              }}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-border-glass rounded-2xl bg-[rgba(255,255,255,0.01)] text-text-muted gap-3 min-h-[300px]">
              <div className="w-12 h-12 rounded-full bg-[rgba(255,255,255,0.03)] border border-border-glass flex items-center justify-center">
                <Video size={20} className="opacity-40" />
              </div>
              <div>
                <p className="text-[0.88rem] font-bold text-text-secondary">No camera selected</p>
                <p className="text-[0.75rem] text-text-muted mt-1 max-w-[200px] leading-relaxed">
                  Click on any camera feed in the grid to view its live properties and AI configurations.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
