import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Camera,
  Settings,
  Play,
  Trash2,
  Send,
  Activity,
  Video,
  RefreshCw,
  Cpu,
  HelpCircle,
  Clock,
  Sparkles,
  Link2,
  Terminal,
  SlidersHorizontal
} from 'lucide-react';

interface VideoClip {
  id: string;
  filepath: string;
  filename: string;
  timestamp: string;
  summary: string;
  duration: number;
  camera: string;
  deviceId?: string;
}

interface EdgeDevice {
  id: string;
  deviceId: string;
  name: string;
  cameraType: 'webcam' | 'rtsp';
  streamUrl: string;
  trackingEnabled: boolean;
  status: string;
  lastHeartbeat: string;
  motionThreshold: number;
  pixelChangeThreshold: number;
  detectPerson: boolean;
  detectVehicle: boolean;
}

interface CameraConfig {
  name: string;
  type: 'webcam' | 'rtsp';
  streamUrl: string;
  trackingEnabled: boolean;
  motionThreshold?: number;
  pixelChangeThreshold?: number;
  detectPerson: boolean;
  detectVehicle: boolean;
}

interface RagResponseClip {
  id: string;
  camera: string;
  timestamp: string;
  summary: string;
  filepath: string;
  filename?: string;
  score: number;
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:5000/api' : `${window.location.origin}/api`;
const WS_BASE = import.meta.env.DEV ? 'ws://localhost:5000' : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

function App() {
  // App States
  const [devices, setDevices] = useState<EdgeDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const selectedDeviceIdRef = useRef(selectedDeviceId);

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  const [config, setConfig] = useState<CameraConfig>({
    name: 'Macbook Air Camera',
    type: 'webcam',
    streamUrl: '0',
    trackingEnabled: false,
    motionThreshold: 25,
    pixelChangeThreshold: 0.02,
    detectPerson: true,
    detectVehicle: true,
  });
  const [status, setStatus] = useState<string>('Offline');
  const [motionActive, setMotionActive] = useState<boolean>(false);
  const [motionRatio, setMotionRatio] = useState<number>(0);
  const [logs, setLogs] = useState<{ message: string; timestamp: string }[]>([]);
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [loadingClips, setLoadingClips] = useState<boolean>(false);
  const [deletingAllClips, setDeletingAllClips] = useState<boolean>(false);
  const [selectedClip, setSelectedClip] = useState<VideoClip | null>(null);

  // RAG Q&A states
  const [query, setQuery] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; content: string; clips?: RagResponseClip[] }[]>([]);
  const [isAsking, setIsAsking] = useState<boolean>(false);
  const [filterStartTime, setFilterStartTime] = useState<string>('');
  const [filterEndTime, setFilterEndTime] = useState<string>('');
  const [filterDeviceId, setFilterDeviceId] = useState<string>('');
  const [showFilters, setShowFilters] = useState<boolean>(false);

  // Live Camera Feed Video States
  const [streamLoading, setStreamLoading] = useState<boolean>(true);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [useHlsFallback, setUseHlsFallback] = useState<boolean>(false);
  const lastFrameAtRef = useRef<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  // WebSocket Ref
  const wsRef = useRef<WebSocket | null>(null);
  const wsIntentionalCloseRef = useRef(false);
  const wsReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchDevices = useCallback(async (selectFirst = false) => {
    try {
      const res = await fetch(`${API_BASE}/devices`);
      const data = await res.json();
      setDevices(data);
      if (data.length > 0) {
        setSelectedDeviceId((prevId) => {
          if (selectFirst || !prevId) {
            return data[0].deviceId;
          }
          return prevId;
        });
      }
    } catch (err) {
      console.error('Failed to fetch devices', err);
    }
  }, []);

  const fetchClips = useCallback(async () => {
    setLoadingClips(true);
    try {
      const res = await fetch(`${API_BASE}/clips`);
      const data = await res.json();
      setClips(data);
      setSelectedClip((prevSelected) => {
        if (data.length > 0 && !prevSelected) {
          return data[0];
        }
        return prevSelected;
      });
    } catch (err) {
      console.error('Failed to fetch clips', err);
    } finally {
      setLoadingClips(false);
    }
  }, []);

  const connectWS = useCallback(function connect() {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    wsIntentionalCloseRef.current = false;
    console.log('Connecting to websocket...');
    const ws = new WebSocket(WS_BASE);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket open. Subscribing to selected device...');
      const currentId = selectedDeviceIdRef.current;
      if (currentId) {
        ws.send(JSON.stringify({ type: 'subscribe_device', deviceId: currentId }));
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'status':
          setStatus(data.status);
          if (data.cameraConfig) {
            const cfg = data.cameraConfig;
            setConfig({
              name: cfg.name,
              type: cfg.cameraType,
              streamUrl: cfg.streamUrl,
              trackingEnabled: cfg.trackingEnabled,
              motionThreshold: cfg.motionThreshold,
              pixelChangeThreshold: cfg.pixelChangeThreshold,
              detectPerson: cfg.detectPerson ?? true,
              detectVehicle: cfg.detectVehicle ?? true,
            });
            // Update device list status locally
            setDevices((prev) =>
              prev.map((d) =>
                d.deviceId === cfg.deviceId
                  ? { ...d, status: data.status, name: cfg.name, cameraType: cfg.cameraType, streamUrl: cfg.streamUrl, trackingEnabled: cfg.trackingEnabled, motionThreshold: cfg.motionThreshold, pixelChangeThreshold: cfg.pixelChangeThreshold, detectPerson: cfg.detectPerson ?? true, detectVehicle: cfg.detectVehicle ?? true }
                  : d
              )
            );
          }
          break;
        case 'motion_state':
          setMotionActive(data.active);
          setMotionRatio(data.ratio);
          break;
        case 'log':
          setLogs((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.message === data.message && last.timestamp === data.timestamp) {
              return prev;
            }
            return [...prev, { message: data.message, timestamp: data.timestamp }];
          });
          break;
        case 'new_clip':
          setClips((prev) => [data.clip, ...prev]);
          setSelectedClip(data.clip);
          break;
        case 'frame':
          if (data.image) {
            setLiveFrame(`data:image/jpeg;base64,${data.image}`);
            lastFrameAtRef.current = Date.now();
            setUseHlsFallback(false);
            setStreamLoading(false);
          }
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      if (wsIntentionalCloseRef.current) {
        return;
      }
      console.log('WebSocket closed. Reconnecting in 5s...');
      wsReconnectTimerRef.current = setTimeout(connect, 5000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, []);

  // Fetch initial data
  useEffect(() => {
    Promise.resolve().then(() => {
      fetchDevices(true);
      fetchClips();
    });
  }, [fetchDevices, fetchClips]);

  // Sync selected device details when selectedDeviceId or devices list changes
  useEffect(() => {
    if (!selectedDeviceId) return;
    const dev = devices.find((d) => d.deviceId === selectedDeviceId);
    if (dev) {
      Promise.resolve().then(() => {
        setConfig({
          name: dev.name,
          type: dev.cameraType,
          streamUrl: dev.streamUrl,
          trackingEnabled: dev.trackingEnabled,
          motionThreshold: dev.motionThreshold,
          pixelChangeThreshold: dev.pixelChangeThreshold,
          detectPerson: dev.detectPerson ?? true,
          detectVehicle: dev.detectVehicle ?? true,
        });
        setStatus(dev.status);
      });
    }
  }, [selectedDeviceId, devices]);

  // Sync WS subscription when device changes
  useEffect(() => {
    if (!selectedDeviceId) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Clear logs for new stream
      setLogs([]);
      setMotionActive(false);
      setMotionRatio(0);

      wsRef.current.send(JSON.stringify({ type: 'subscribe_device', deviceId: selectedDeviceId }));
    }
  }, [selectedDeviceId]);

  // Establish initial WebSocket connection
  useEffect(() => {
    connectWS();
    return () => {
      wsIntentionalCloseRef.current = true;
      if (wsReconnectTimerRef.current) {
        clearTimeout(wsReconnectTimerRef.current);
        wsReconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      if (ws) {
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        wsRef.current = null;
      }
    };
  }, [connectWS]);

  // useEffect(() => {
  //   if (chatContainerRef.current) {
  //     chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  //   }
  // }, [chatHistory]);

  // Reset stream loading only when switching devices (not on Recording/Processing status)
  useEffect(() => {
    Promise.resolve().then(() => {
      setStreamLoading(true);
      setLiveFrame(null);
      setUseHlsFallback(false);
      lastFrameAtRef.current = 0;
    });
  }, [selectedDeviceId]);

  // Fall back to HLS if WebSocket preview frames never arrive or stop
  useEffect(() => {
    if (!selectedDeviceId || status === 'Offline') return;

    const startupTimeout = setTimeout(() => {
      if (!lastFrameAtRef.current) {
        setUseHlsFallback(true);
      }
    }, 5000);

    const interval = setInterval(() => {
      const lastFrameAt = lastFrameAtRef.current;
      if (!lastFrameAt) return;
      if (Date.now() - lastFrameAt > 4000) {
        setUseHlsFallback(true);
        setStreamLoading(true);
      }
    }, 1000);

    return () => {
      clearTimeout(startupTimeout);
      clearInterval(interval);
    };
  }, [selectedDeviceId, status]);

  const isDeviceOffline = status === 'Offline';

  // Initialize HLS player as fallback when WebSocket preview is unavailable
  useEffect(() => {
    if (!selectedDeviceId || isDeviceOffline || !useHlsFallback) {
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const streamUrl = `${API_BASE}/devices/${selectedDeviceId}/stream/index.m3u8`;
    let hls: Hls | null = null;

    const startPlaying = () => {
      video.play().catch(err => {
        console.log('HLS play error:', err.message);
      });
    };

    video.onplaying = () => {
      setStreamLoading(false);
    };

    if (Hls.isSupported()) {
      const activeHls = new Hls({
        maxBufferLength: 2,
        maxMaxBufferLength: 4,
        liveSyncDuration: 1,
        liveMaxLatencyDuration: 3,
        enableWorker: true,
        lowLatencyMode: true,
      });
      hls = activeHls;

      activeHls.loadSource(streamUrl);
      activeHls.attachMedia(video);
      activeHls.on(Hls.Events.MANIFEST_PARSED, startPlaying);

      activeHls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('HLS Network error, retrying in 2s...');
              setTimeout(() => {
                activeHls.loadSource(streamUrl);
              }, 2000);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('HLS Media error, recovering...');
              activeHls.recoverMediaError();
              break;
            default:
              console.error('Fatal HLS error:', data);
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('canplay', startPlaying);
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
      video.src = '';
      video.onplaying = null;
    };
  }, [selectedDeviceId, isDeviceOffline, useHlsFallback]);

  const handleConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeviceId) return;
    if (!config.detectPerson && !config.detectVehicle) {
      alert('Select at least one detection target: Person or Vehicle.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/devices/${selectedDeviceId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: config.name,
          cameraType: config.type,
          streamUrl: config.streamUrl,
          trackingEnabled: config.trackingEnabled,
          motionThreshold: config.motionThreshold !== undefined ? Number(config.motionThreshold) : 25,
          pixelChangeThreshold: config.pixelChangeThreshold !== undefined ? Number(config.pixelChangeThreshold) : 0.02,
          detectPerson: config.detectPerson,
          detectVehicle: config.detectVehicle,
        }),
      });
      const data = await res.json();
      setConfig({
        name: data.config.name,
        type: data.config.cameraType,
        streamUrl: data.config.streamUrl,
        trackingEnabled: data.config.trackingEnabled,
        motionThreshold: data.config.motionThreshold,
        pixelChangeThreshold: data.config.pixelChangeThreshold,
        detectPerson: data.config.detectPerson ?? true,
        detectVehicle: data.config.detectVehicle ?? true,
      });
      fetchDevices();
    } catch (err) {
      console.error('Failed to update config', err);
    }
  };

  const handleToggleDeviceMonitoring = async (deviceId: string, currentTrackingEnabled: boolean) => {
    const dev = devices.find(d => d.deviceId === deviceId);
    if (!dev || dev.status === 'Offline') return;

    try {
      const res = await fetch(`${API_BASE}/devices/${deviceId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingEnabled: !currentTrackingEnabled,
        }),
      });
      const data = await res.json();

      if (deviceId === selectedDeviceId) {
        setConfig((prev) => ({
          ...prev,
          trackingEnabled: data.config.trackingEnabled,
        }));
      }

      fetchDevices();
    } catch (err) {
      console.error('Failed to toggle monitoring', err);
    }
  };

  const handleDeleteClip = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this recorded clip?')) return;

    try {
      const res = await fetch(`${API_BASE}/clips/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setClips((prev) => prev.filter((c) => c.id !== id));
        if (selectedClip?.id === id) {
          setSelectedClip(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete clip', err);
    }
  };

  const handleDeleteAllClips = async () => {
    if (clips.length === 0) return;
    if (!confirm(`Are you sure you want to delete all ${clips.length} recorded clips? This cannot be undone.`)) return;

    setDeletingAllClips(true);
    try {
      const res = await fetch(`${API_BASE}/clips`, { method: 'DELETE' });
      if (res.ok) {
        setClips([]);
        setSelectedClip(null);
      }
    } catch (err) {
      console.error('Failed to delete all clips', err);
    } finally {
      setDeletingAllClips(false);
    }
  };

  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    const userMessage = query;
    setQuery('');
    setChatHistory((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsAsking(true);

    try {
      const res = await fetch(`${API_BASE}/rag/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          question: userMessage,
          history: chatHistory.map(h => ({ role: h.role, content: h.content })),
          startTime: filterStartTime ? new Date(filterStartTime).toISOString() : undefined,
          endTime: filterEndTime ? new Date(filterEndTime).toISOString() : undefined,
          deviceId: filterDeviceId || undefined,
        }),
      });

      const data = await res.json();

      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', content: data.answer, clips: data.clips }
      ]);
    } catch (err) {
      console.error('RAG query failed', err);
      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, I encountered an error searching for matching footage summaries.' }
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  const selectAndPlayClip = (clipId: string) => {
    const clip = clips.find(c => c.id === clipId);
    if (clip) {
      setSelectedClip(clip);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  return (
    <div className="p-6 max-w-[1440px] mx-auto">

      {/* HEADER SECTION */}
      <header className="glass-panel p-5 px-6 flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-primary p-2.5 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(124,58,237,0.2)]">
            <Cpu size={24} color="white" />
          </div>
          <div>
            <h1 className="text-gradient-purple text-[1.6rem] font-extrabold">AURA WATCH AI</h1>
            <p className="text-[0.8rem] text-text-muted">Edge Surveillance Vector Search & RAG Dashboard</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {selectedDeviceId && (
            <div className={`status-indicator ${status.toLowerCase().replace(' ', '')}`}>
              <span className="w-2 h-2 rounded-full bg-current inline-block"></span>
              {status}
            </div>
          )}
        </div>
      </header>

      {/* DASHBOARD LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* LEFT COLUMN: DEVICES & CAMERA */}
        <div className="lg:col-span-4 flex flex-col gap-6">

          {/* DEVICE SELECTOR PANEL */}
          <div className="glass-panel p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-[1.1rem] flex items-center gap-2">
                <Cpu size={18} color="var(--color-primary)" /> Registered Edge Devices
              </h2>
              <button
                onClick={() => fetchDevices()}
                className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md flex items-center gap-1"
              >
                <RefreshCw size={12} /> Refresh List
              </button>
            </div>

            {devices.length === 0 ? (
              <div className="text-text-muted text-[0.85rem] text-center p-4 border border-dashed border-border-glass rounded-lg">
                No edge devices registered. Run the edge agent script on a device to register.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex gap-2.5 flex-wrap">
                  {devices.map((dev) => {
                    const isSelected = dev.deviceId === selectedDeviceId;
                    const isOnline = dev.status !== 'Offline';
                    const statusColor =
                      dev.status === 'Monitoring' ? 'var(--color-success)' :
                        dev.status === 'Recording' ? 'var(--color-danger)' :
                          dev.status === 'Processing Video' || dev.status === 'Processing' ? 'var(--color-primary)' :
                            dev.status === 'Idle' ? 'var(--color-secondary)' : 'var(--color-text-muted)';

                    return (
                      <div
                        key={dev.deviceId}
                        onClick={() => setSelectedDeviceId(dev.deviceId)}
                        className={`glass-panel interactive ${isSelected ? 'active border-primary bg-[rgba(124,58,237,0.1)]' : 'border-border-glass bg-[rgba(255,255,255,0.02)]'} py-2.5 px-3.5 flex items-center justify-between gap-3 cursor-pointer rounded-[10px] text-left flex-auto w-full sm:w-[calc(50%-10px)] min-w-[220px]`}
                      >
                        <div className="flex items-center gap-2.5 flex-1 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full inline-block flex-shrink-0"
                            style={{
                              background: statusColor,
                              boxShadow: isOnline && dev.status !== 'Idle' ? `0 0 8px ${statusColor}` : 'none'
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-[0.85rem] font-semibold text-text-primary overflow-hidden text-ellipsis whitespace-nowrap">{dev.name}</div>
                            <div className="text-[0.7rem] text-text-muted overflow-hidden text-ellipsis whitespace-nowrap">ID: {dev.deviceId} • {dev.status}</div>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleDeviceMonitoring(dev.deviceId, dev.trackingEnabled);
                          }}
                          className={`btn ${dev.trackingEnabled && isOnline ? 'btn-primary' : 'btn-secondary'} py-1 px-2 text-[0.7rem] rounded-md h-[28px] shrink-0 flex items-center gap-1 font-semibold`}
                          disabled={!isOnline}
                        >
                          {dev.trackingEnabled && isOnline ? (
                            <>
                              <Activity size={12} /> Disable
                            </>
                          ) : (
                            <>
                              <Camera size={12} /> Enable
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* CAMERA FEED */}
          <div className="glass-panel p-5 relative">
            <div className="flex justify-between items-center mb-4 gap-2 flex-wrap">
              <h2 className="text-[1.1rem] flex items-center gap-2">
                <Video size={18} color="var(--color-secondary)" /> Live Camera Feed
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                {status === 'Recording' && (
                  <div className="text-[0.7rem] font-semibold flex items-center gap-1.5 py-1 px-2.5 rounded-full bg-[rgba(244,63,94,0.15)] text-danger border border-[rgba(244,63,94,0.35)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger inline-block animate-[pulse-danger_0.8s_infinite]"></span>
                    Recording clip
                  </div>
                )}
                {(status === 'Processing Video' || status === 'Processing') && (
                  <div className="text-[0.7rem] font-semibold flex items-center gap-1.5 py-1 px-2.5 rounded-full bg-[rgba(124,58,237,0.15)] text-[#a78bfa] border border-[rgba(124,58,237,0.35)]">
                    <RefreshCw size={11} className="animate-spin" />
                    Summarizing clip
                  </div>
                )}
                {motionActive && (
                  <div className="text-danger text-[0.8rem] font-semibold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-current inline-block animate-[pulse-danger_0.5s_infinite]"></span>
                    MOTION DETECTED: {(motionRatio * 100).toFixed(1)}%
                  </div>
                )}
              </div>
            </div>

            {/* Video Feed Wrapper */}
            <div className="bg-[#090d16] rounded-xl w-full relative overflow-hidden border border-[rgba(255,255,255,0.05)] min-h-[200px]">

              {selectedDeviceId && status !== 'Offline' ? (
                <div className="w-full relative">
                  {liveFrame && !useHlsFallback ? (
                    <img
                      src={liveFrame}
                      alt="Live camera preview"
                      className="w-full h-auto block"
                    />
                  ) : (
                    <video
                      ref={videoRef}
                      muted
                      controls
                      className={`w-full h-auto block ${streamLoading ? 'hidden' : 'block'}`}
                    />
                  )}

                  {liveFrame && !useHlsFallback && (
                    <div className="absolute top-2 left-2 text-[0.65rem] font-semibold flex items-center gap-1.5 py-1 px-2 rounded-full bg-[rgba(16,185,129,0.2)] text-emerald-400 border border-[rgba(16,185,129,0.35)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-[pulse-danger_0.8s_infinite]"></span>
                      LIVE
                    </div>
                  )}

                  {streamLoading && (
                    <div className="text-center text-text-muted absolute inset-0 flex flex-col justify-center items-center bg-[#090d16]/80">
                      <div className="animate-[spin_4s_linear_infinite] mb-3 inline-block">
                        <RefreshCw size={36} color="var(--color-primary)" />
                      </div>
                      <p className="text-[0.9rem]">Initializing Live Stream...</p>
                      <p className="text-[0.75rem] mt-1">
                        {useHlsFallback ? 'Connecting via HLS fallback' : 'Connecting to edge camera (WebSocket)'}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-text-muted min-h-[200px] flex flex-col justify-center items-center py-8">
                  <Camera size={36} className="text-text-muted mb-3 mx-auto" />
                  <p className="text-[0.9rem]">Device Offline</p>
                  <p className="text-[0.75rem] mt-1">
                    Start the edge agent to connect
                  </p>
                </div>
              )}

              {/* Dynamic Overlay HUD when motion occurs */}
              {motionActive && (
                <div className="absolute inset-0 border-2 border-danger pointer-events-none shadow-[inset_0_0_30px_rgba(244,63,94,0.25)] rounded-xl z-20" />
              )}
            </div>
          </div>

          {/* STREAM CONFIGURATION */}
          <div className="glass-panel p-5">
            <h2 className="text-[1.1rem] flex items-center gap-2 mb-4">
              <Settings size={18} color="var(--color-secondary)" /> Configure Selected Edge Agent
            </h2>
            <form onSubmit={handleConfigSubmit} className="flex flex-col gap-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.8rem] text-text-secondary">Camera Name</label>
                  <input
                    type="text"
                    value={config.name}
                    onChange={(e) => setConfig({ ...config, name: e.target.value })}
                    placeholder="E.g., Office Entry"
                    required
                    disabled={!selectedDeviceId}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.8rem] text-text-secondary">Source Type</label>
                  <select
                    value={config.type}
                    onChange={(e) => setConfig({ ...config, type: e.target.value as 'webcam' | 'rtsp' })}
                    disabled={!selectedDeviceId}
                  >
                    <option value="webcam">Local Device Camera / Webcam</option>
                    <option value="rtsp">RTSP Network Stream</option>
                  </select>
                </div>
              </div>

              {config.type === 'rtsp' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.8rem] text-text-secondary">RTSP Stream URL</label>
                  <input
                    type="text"
                    value={config.streamUrl}
                    onChange={(e) => setConfig({ ...config, streamUrl: e.target.value })}
                    placeholder="rtsp://username:password@ip:port/h264"
                    required
                    disabled={!selectedDeviceId}
                  />
                </div>
              )}

              <div className="flex flex-col gap-2">
                <label className="text-[0.8rem] text-text-secondary">Detect Objects</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-[0.85rem] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.detectPerson}
                      onChange={(e) => setConfig({ ...config, detectPerson: e.target.checked })}
                      disabled={!selectedDeviceId}
                      className="w-4 h-4 accent-[#a78bfa]"
                    />
                    Person
                  </label>
                  <label className="flex items-center gap-2 text-[0.85rem] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.detectVehicle}
                      onChange={(e) => setConfig({ ...config, detectVehicle: e.target.checked })}
                      disabled={!selectedDeviceId}
                      className="w-4 h-4 accent-[#a78bfa]"
                    />
                    Vehicle
                  </label>
                </div>
                <p className="text-[0.75rem] text-text-muted">
                  Vehicle includes cars, trucks, buses, motorcycles, and bicycles.
                </p>
              </div>

              <button
                type="submit"
                className="btn btn-secondary w-fit self-end text-[0.85rem]"
                disabled={!selectedDeviceId}
              >
                Apply Configuration
              </button>
            </form>
          </div>

          {/* LIVE TERMINAL LOGS */}
          <div className="glass-panel p-5">
            <h2 className="text-[1.1rem] flex items-center gap-2 mb-3">
              <Terminal size={18} color="var(--color-secondary)" /> System Status Logs
            </h2>
            <div className="font-mono bg-[rgba(0,0,0,0.5)] rounded-lg p-3.5 text-[0.85rem] leading-[1.4] text-[#38bdf8] h-[180px] overflow-y-auto border border-[rgba(255,255,255,0.05)]" ref={terminalContainerRef}>
              {logs.length === 0 ? (
                <div className="text-text-muted text-[0.8rem]">
                  {selectedDeviceId ? 'Waiting for device events...' : 'Select a device to view logs.'}
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="mb-1">
                    <span className="text-text-muted mr-2">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                    <span>{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: CLIPS PLAYBACK & AI CHAT */}
        <div className="lg:col-span-8 flex flex-col gap-6">

          {/* EVENT ARCHIVE & PLAYBACK PANEL */}
          <div className="glass-panel p-5 flex flex-col h-[480px]">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-[1.1rem] flex items-center gap-2">
                <Video size={18} color="var(--color-primary)" /> Event Archive & Playback
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDeleteAllClips}
                  className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md hover:text-danger"
                  disabled={loadingClips || deletingAllClips || clips.length === 0}
                >
                  <Trash2 size={12} /> Delete All
                </button>
                <button
                  onClick={fetchClips}
                  className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md"
                  disabled={loadingClips || deletingAllClips}
                >
                  <RefreshCw size={12} className={loadingClips ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-5 flex-1 min-h-0 lg:overflow-hidden">
              {/* Left pane: Clips History List */}
              <div className="w-full lg:w-[320px] lg:shrink-0 flex flex-col gap-2.5 overflow-y-auto min-w-0 pr-1 lg:h-full">
                {clips.length === 0 ? (
                  <div className="h-full flex justify-center items-center text-text-muted text-[0.85rem]">
                    No clips recorded yet.
                  </div>
                ) : (
                  clips.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => setSelectedClip(c)}
                      className={`glass-panel interactive ${selectedClip?.id === c.id ? 'active' : ''} p-3 flex justify-between items-center cursor-pointer transition-all duration-200 w-full min-w-0`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="bg-primary-glow p-2 rounded-lg text-primary flex-shrink-0">
                          <Play size={16} fill="currentColor" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between items-center mb-0.5">
                            <span className="text-[0.85rem] font-semibold text-text-primary">{c.camera}</span>
                            <span className="text-[0.7rem] text-text-muted">{new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <p className="text-[0.75rem] text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap">
                            {c.summary}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={(e) => handleDeleteClip(c.id, e)}
                        className="btn p-1.5 bg-transparent text-text-muted hover:text-danger border-none"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Vertical Divider */}
              <div className="hidden lg:block w-[1px] bg-[rgba(255,255,255,0.08)] self-stretch" />

              {/* Right pane: Clip Viewer */}
              <div className="flex-1 flex flex-col min-w-0 overflow-y-auto pr-1 lg:h-full">
                {selectedClip ? (
                  <div className="flex flex-col gap-3">
                    <div className="bg-[#000] rounded-xl overflow-hidden h-[220px] border border-[rgba(255,255,255,0.08)] shrink-0">
                      <video
                        key={selectedClip.id}
                        src={`${API_BASE}/videos/${selectedClip.filename}`}
                        controls
                        autoPlay
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1.5 flex-wrap gap-1">
                        <h3 className="text-[0.85rem] font-semibold break-all text-text-primary">{selectedClip.filename}</h3>
                        <span className="text-[0.7rem] text-text-muted flex items-center gap-1 whitespace-nowrap">
                          <Clock size={12} /> {formatDate(selectedClip.timestamp)}
                        </span>
                      </div>
                      <div className="bg-[rgba(124,58,237,0.05)] border border-[rgba(124,58,237,0.15)] rounded-lg p-2.5">
                        <p className="text-[0.7rem] font-bold text-[#a78bfa] uppercase mb-1 tracking-wider flex items-center gap-1">
                          <Sparkles size={12} />Video Summary
                        </p>
                        <p className="text-[0.8rem] text-text-secondary leading-[1.4]">{selectedClip.summary}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col justify-center items-center border border-dashed border-border-glass rounded-xl text-text-muted p-5 text-center">
                    <Video size={32} className="text-text-muted mb-2.5 mx-auto" />
                    <p className="text-[0.85rem] font-semibold">No Event Selected</p>
                    <p className="text-[0.75rem] mt-1 max-w-[220px] mx-auto">Select a clip from the history list to play and view the AI summary.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI ANALYST PANEL (RAG CHAT) */}
          <div className="glass-panel p-5 flex flex-col h-[480px]">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-[1.1rem] flex items-center gap-2">
                <Sparkles size={18} color="var(--color-primary)" /> Ask Camera AI
              </h2>
              <button
                type="button"
                onClick={() => setShowFilters(!showFilters)}
                className={`btn btn-secondary py-1 px-2.5 text-[0.75rem] rounded-md flex items-center gap-1.5 transition-all duration-200 ${
                  showFilters || filterStartTime || filterEndTime || filterDeviceId
                    ? 'border-primary text-primary bg-[rgba(124,58,237,0.08)]'
                    : ''
                }`}
              >
                <SlidersHorizontal size={12} />
                Search Filters
                {(filterStartTime || filterEndTime || filterDeviceId) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block"></span>
                )}
              </button>
            </div>

            {/* Collapsible Filter Inputs */}
            {showFilters && (
              <div className="glass-panel p-3.5 mb-3.5 bg-[rgba(255,255,255,0.01)] border-[rgba(255,255,255,0.08)] rounded-[10px] flex flex-col gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[0.7rem] text-text-secondary">Target Camera</label>
                    <select
                      value={filterDeviceId}
                      onChange={(e) => setFilterDeviceId(e.target.value)}
                      className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
                    >
                      <option value="">All Cameras</option>
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[0.7rem] text-text-secondary">Start Time</label>
                    <input
                      type="datetime-local"
                      value={filterStartTime}
                      onChange={(e) => setFilterStartTime(e.target.value)}
                      className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[0.7rem] text-text-secondary">End Time</label>
                    <input
                      type="datetime-local"
                      value={filterEndTime}
                      onChange={(e) => setFilterEndTime(e.target.value)}
                      className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
                    />
                  </div>
                </div>
                {(filterStartTime || filterEndTime || filterDeviceId) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterStartTime('');
                      setFilterEndTime('');
                      setFilterDeviceId('');
                    }}
                    className="btn btn-secondary py-1 px-2 text-[0.7rem] self-end rounded flex items-center gap-1 hover:text-danger hover:border-danger bg-transparent font-semibold border-none"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            )}

            {/* Chat message space */}
            <div
              ref={chatContainerRef}
              className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1 mb-3.5 border-b border-[rgba(255,255,255,0.05)]"
            >
              {chatHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-text-muted text-center p-5">
                  <HelpCircle size={32} className="text-text-muted mb-2.5 mx-auto" />
                  <p className="text-[0.85rem] font-semibold">No active session query.</p>
                  <p className="text-[0.75rem] max-w-[300px] mt-1">Ask questions about video events, e.g.: "Has anyone walked past in a red shirt?" or "What activity was recorded on my camera?"</p>
                </div>
              ) : (
                chatHistory.map((chat, idx) => (
                  <div key={idx} className={`flex flex-col max-w-[85%] ${chat.role === 'user' ? 'self-end' : 'self-start'}`}>
                    <div className={`p-2.5 px-3.5 rounded-xl text-[0.85rem] leading-[1.4] ${chat.role === 'user'
                      ? 'bg-gradient-to-br from-primary to-[#6d28d9] text-white shadow-[0_4px_10px_rgba(124,58,237,0.15)] border-none'
                      : 'bg-[rgba(255,255,255,0.04)] border border-border-glass text-text-primary'
                      }`}>
                      {chat.content}
                    </div>

                    {/* Cited references when assistant responds */}
                    {chat.role === 'assistant' && chat.clips && chat.clips.length > 0 && (
                      <div className="mt-2 w-full flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 text-[0.75rem] text-text-muted">
                          <Video size={12} color="var(--color-primary)" />
                          <span>Cited Video Footage:</span>
                        </div>
                        <div className="flex gap-2.5 overflow-x-auto pb-2 w-full scroll-smooth">
                          {chat.clips.map((c, cIdx) => {
                            const filename = c.filename || c.filepath.split(/[/\\]/).pop() || '';
                            const videoUrl = `${API_BASE}/videos/${filename}`;
                            const matchPercentage = c.score ? Math.round(c.score * 100) : null;

                            return (
                              <div
                                key={cIdx}
                                className="glass-panel shrink-0 w-[200px] p-2 rounded-[10px] border border-[rgba(255,255,255,0.06)] bg-[rgba(15,23,42,0.6)]"
                              >
                                <div className="w-full h-[112px] bg-[#020617] rounded-md overflow-hidden relative border border-[rgba(255,255,255,0.05)] mb-1.5">
                                  <video
                                    src={videoUrl}
                                    controls
                                    preload="metadata"
                                    className="w-full h-full object-contain"
                                  />
                                </div>

                                <div className="flex flex-col gap-0.5">
                                  <div className="flex justify-between items-center">
                                    <span
                                      title={c.camera}
                                      className="text-[0.75rem] font-semibold text-text-primary overflow-hidden text-ellipsis whitespace-nowrap max-w-[110px]"
                                    >
                                      {c.camera}
                                    </span>
                                    <span className="text-[0.65rem] text-text-muted">
                                      {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </span>
                                  </div>

                                  <div className="flex justify-between items-center mt-0.5">
                                    {matchPercentage !== null && (
                                      <span className="text-[0.65rem] text-secondary bg-[rgba(6,182,212,0.1)] py-0.5 px-1.5 rounded font-semibold">
                                        {matchPercentage}% Match
                                      </span>
                                    )}
                                    <button
                                      onClick={() => selectAndPlayClip(c.id)}
                                      className="btn btn-secondary py-0.5 px-2 text-[0.65rem] h-[20px] rounded flex items-center gap-0.5 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)]"
                                    >
                                      <Link2 size={10} /> View
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
              {isAsking && (
                <div className="self-start bg-[rgba(255,255,255,0.04)] border border-border-glass p-2.5 px-3.5 rounded-xl text-[0.85rem] flex items-center gap-2">
                  <RefreshCw size={12} className="animate-spin" /> Searching vectors and answering...
                </div>
              )}
            </div>

            {/* Question query input */}
            <form onSubmit={handleAskQuestion} className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask about your camera recordings..."
                className="flex-1"
                disabled={isAsking}
              />
              <button type="submit" className="btn btn-primary py-2.5 px-3.5" disabled={isAsking}>
                <Send size={16} />
              </button>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
}

export default App;
