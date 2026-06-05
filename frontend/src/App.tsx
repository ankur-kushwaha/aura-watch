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
  Terminal
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
  enabled: boolean;
  status: string;
  lastHeartbeat: string;
  motionThreshold: number;
  pixelChangeThreshold: number;
}

interface CameraConfig {
  name: string;
  type: 'webcam' | 'rtsp';
  streamUrl: string;
  enabled: boolean;
  motionThreshold?: number;
  pixelChangeThreshold?: number;
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

const API_BASE = 'http://localhost:5000/api';
const WS_BASE = 'ws://localhost:5000';

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
    enabled: false,
    motionThreshold: 25,
    pixelChangeThreshold: 0.02,
  });
  const [status, setStatus] = useState<string>('Offline');
  const [motionActive, setMotionActive] = useState<boolean>(false);
  const [motionRatio, setMotionRatio] = useState<number>(0);
  const [logs, setLogs] = useState<{ message: string; timestamp: string }[]>([]);
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [loadingClips, setLoadingClips] = useState<boolean>(false);
  const [selectedClip, setSelectedClip] = useState<VideoClip | null>(null);

  // RAG Q&A states
  const [query, setQuery] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; content: string; clips?: RagResponseClip[] }[]>([]);
  const [isAsking, setIsAsking] = useState<boolean>(false);

  // Live Camera Feed Video States
  const [streamLoading, setStreamLoading] = useState<boolean>(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  // WebSocket Ref
  const wsRef = useRef<WebSocket | null>(null);

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
              enabled: cfg.enabled,
              motionThreshold: cfg.motionThreshold,
              pixelChangeThreshold: cfg.pixelChangeThreshold,
            });
            // Update device list status locally
            setDevices((prev) =>
              prev.map((d) =>
                d.deviceId === cfg.deviceId
                  ? { ...d, status: data.status, name: cfg.name, cameraType: cfg.cameraType, streamUrl: cfg.streamUrl, enabled: cfg.enabled, motionThreshold: cfg.motionThreshold, pixelChangeThreshold: cfg.pixelChangeThreshold }
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
          setLogs((prev) => [...prev, { message: data.message, timestamp: data.timestamp }]);
          break;
        case 'new_clip':
          setClips((prev) => [data.clip, ...prev]);
          setSelectedClip(data.clip);
          break;
        case 'frame':
          // Obsolete grayscale frames
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      console.log('WebSocket closed. Reconnecting in 5s...');
      setTimeout(connect, 5000);
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
          enabled: dev.enabled,
          motionThreshold: dev.motionThreshold,
          pixelChangeThreshold: dev.pixelChangeThreshold,
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
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWS]);

  // useEffect(() => {
  //   if (chatContainerRef.current) {
  //     chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  //   }
  // }, [chatHistory]);

  // Reset stream loading status on changes
  useEffect(() => {
    Promise.resolve().then(() => {
      setStreamLoading(true);
    });
  }, [selectedDeviceId, status, config.enabled]);

  // Initialize HLS player
  useEffect(() => {
    if (status === 'Offline' || !selectedDeviceId) {
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
        maxBufferLength: 4,
        maxMaxBufferLength: 8,
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
      // Native support (Safari/iOS)
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
  }, [selectedDeviceId, status, config.enabled]);

  const handleConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeviceId) return;

    try {
      const res = await fetch(`${API_BASE}/devices/${selectedDeviceId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: config.name,
          cameraType: config.type,
          streamUrl: config.streamUrl,
          enabled: config.enabled,
          motionThreshold: config.motionThreshold !== undefined ? Number(config.motionThreshold) : 25,
          pixelChangeThreshold: config.pixelChangeThreshold !== undefined ? Number(config.pixelChangeThreshold) : 0.02,
        }),
      });
      const data = await res.json();
      setConfig({
        name: data.config.name,
        type: data.config.cameraType,
        streamUrl: data.config.streamUrl,
        enabled: data.config.enabled,
        motionThreshold: data.config.motionThreshold,
        pixelChangeThreshold: data.config.pixelChangeThreshold,
      });
      fetchDevices();
    } catch (err) {
      console.error('Failed to update config', err);
    }
  };

  const handleToggleDeviceMonitoring = async (deviceId: string, currentEnabled: boolean) => {
    const dev = devices.find(d => d.deviceId === deviceId);
    if (!dev || dev.status === 'Offline') return;

    try {
      const res = await fetch(`${API_BASE}/devices/${deviceId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: !currentEnabled,
        }),
      });
      const data = await res.json();

      if (deviceId === selectedDeviceId) {
        setConfig((prev) => ({
          ...prev,
          enabled: data.config.enabled,
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
        body: JSON.stringify({ question: userMessage }),
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
    <div style={{ padding: '24px', maxWidth: '1440px', margin: '0 auto' }}>

      {/* HEADER SECTION */}
      <header className="glass-panel" style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'var(--primary)', padding: '10px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 15px var(--primary-glow)' }}>
            <Cpu size={24} color="white" />
          </div>
          <div>
            <h1 className="text-gradient-purple" style={{ fontSize: '1.6rem', fontWeight: 800 }}>AURA WATCH AI</h1>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Edge Surveillance Vector Search & RAG Dashboard</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {selectedDeviceId && (
            <div className={`status-indicator ${status.toLowerCase().replace(' ', '')}`}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }}></span>
              {status}
            </div>
          )}
        </div>
      </header>

      {/* DASHBOARD LAYOUT */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)', gap: '24px' }}>

        {/* LEFT COLUMN: DEVICES & CAMERA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* DEVICE SELECTOR PANEL */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Cpu size={18} color="var(--primary)" /> Registered Edge Devices
              </h2>
              <button
                onClick={() => fetchDevices()}
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '0.75rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <RefreshCw size={12} /> Refresh List
              </button>
            </div>

            {devices.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '16px', border: '1px dashed var(--border-glass)', borderRadius: '8px' }}>
                No edge devices registered. Run the edge agent script on a device to register.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {devices.map((dev) => {
                    const isSelected = dev.deviceId === selectedDeviceId;
                    const isOnline = dev.status !== 'Offline';
                    const statusColor =
                      dev.status === 'Monitoring' ? 'var(--success)' :
                        dev.status === 'Recording' ? 'var(--danger)' :
                          dev.status === 'Processing Video' || dev.status === 'Processing' ? 'var(--primary)' :
                            dev.status === 'Idle' ? 'var(--secondary)' : 'var(--text-muted)';

                    return (
                      <div
                        key={dev.deviceId}
                        onClick={() => setSelectedDeviceId(dev.deviceId)}
                        className={`glass-panel interactive ${isSelected ? 'active' : ''}`}
                        style={{
                          padding: '10px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                          cursor: 'pointer',
                          border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-glass)',
                          background: isSelected ? 'rgba(124, 58, 237, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                          borderRadius: '10px',
                          textAlign: 'left',
                          flex: '1 1 calc(50% - 10px)',
                          minWidth: '220px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                          <span style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: statusColor,
                            display: 'inline-block',
                            flexShrink: 0,
                            boxShadow: isOnline && dev.status !== 'Idle' ? `0 0 8px ${statusColor}` : 'none'
                          }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dev.name}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>ID: {dev.deviceId} • {dev.status}</div>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleDeviceMonitoring(dev.deviceId, dev.enabled);
                          }}
                          className={`btn ${dev.enabled && isOnline ? 'btn-primary' : 'btn-secondary'}`}
                          style={{
                            padding: '4px 8px',
                            fontSize: '0.7rem',
                            borderRadius: '6px',
                            height: '28px',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontWeight: 600
                          }}
                          disabled={!isOnline}
                        >
                          {dev.enabled && isOnline ? (
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
          <div className="glass-panel" style={{ padding: '20px', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Video size={18} color="var(--secondary)" /> Live Camera Feed
              </h2>
              {motionActive && (
                <div style={{ color: 'var(--danger)', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor', display: 'inline-block', animation: 'pulse-red 0.5s infinite' }}></span>
                  MOTION DETECTED: {(motionRatio * 100).toFixed(1)}%
                </div>
              )}
            </div>

            {/* Video Feed Wrapper */}
            <div style={{ background: '#090d16', borderRadius: '12px', height: '240px', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.05)' }}>

              {selectedDeviceId && status !== 'Offline' ? (
                <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  {status === 'Recording' ? (
                    <div style={{ position: 'absolute', zIndex: 2, background: 'rgba(0,0,0,0.7)', padding: '8px 16px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid rgba(244,63,94,0.4)', boxShadow: '0 4px 15px rgba(0,0,0,0.5)' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--danger)', display: 'inline-block', animation: 'pulse-red 0.8s infinite' }}></span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white', letterSpacing: '0.05em' }}>RECORDING FOOTAGE...</span>
                    </div>
                  ) : status === 'Processing Video' || status === 'Processing' ? (
                    <div style={{ position: 'absolute', zIndex: 2, background: 'rgba(0,0,0,0.7)', padding: '8px 16px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid rgba(124,58,237,0.4)', boxShadow: '0 4px 15px rgba(0,0,0,0.5)' }}>
                      <RefreshCw size={12} className="animate-spin" color="var(--primary)" />
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white', letterSpacing: '0.05em' }}>SUMMARIZING RECORDING...</span>
                    </div>
                  ) : null}

                  <video
                    ref={videoRef}
                    muted
                    controls
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      display: streamLoading ? 'none' : 'block'
                    }}
                  />

                  {streamLoading && (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      <div style={{ animation: 'spin 4s linear infinite', marginBottom: '12px', display: 'inline-block' }}>
                        <RefreshCw size={36} color="var(--primary)" />
                      </div>
                      <p style={{ fontSize: '0.9rem' }}>Initializing Live Stream...</p>
                      <p style={{ fontSize: '0.75rem', marginTop: '4px' }}>Connecting to edge camera device (HLS)</p>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Camera size={36} color="var(--text-muted)" style={{ marginBottom: '12px' }} />
                  <p style={{ fontSize: '0.9rem' }}>Device Offline</p>
                  <p style={{ fontSize: '0.75rem', marginTop: '4px' }}>
                    Start the edge agent to connect
                  </p>
                </div>
              )}

              {/* Dynamic Overlay HUD when motion occurs */}
              {motionActive && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, border: '2px solid var(--danger)', pointerEvents: 'none', boxShadow: 'inset 0 0 30px rgba(244, 63, 94, 0.25)', borderRadius: '12px', zIndex: 3 }} />
              )}
            </div>

            {/* Motion sensitivity bar */}
            {selectedDeviceId && status !== 'Offline' && config.enabled && (
              <div style={{ marginTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  <span>Frame Pixel Diff Activity:</span>
                  <span style={{ color: motionActive ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>{(motionRatio * 100).toFixed(2)}%</span>
                </div>
                <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(motionRatio * 100, 100)}%`, height: '100%', background: motionActive ? 'var(--danger)' : 'var(--primary)', transition: 'width 0.1s ease-out' }}></div>
                </div>
              </div>
            )}
          </div>

          {/* STREAM CONFIGURATION */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <h2 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <Settings size={18} color="var(--secondary)" /> Configure Selected Edge Agent
            </h2>
            <form onSubmit={handleConfigSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Camera Name</label>
                  <input
                    type="text"
                    value={config.name}
                    onChange={(e) => setConfig({ ...config, name: e.target.value })}
                    placeholder="E.g., Office Entry"
                    required
                    disabled={!selectedDeviceId}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Source Type</label>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>RTSP Stream URL</label>
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Motion Detector Threshold (0-255)</label>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={config.motionThreshold || 25}
                    onChange={(e) => setConfig({ ...config, motionThreshold: parseInt(e.target.value) || 25 })}
                    required
                    disabled={!selectedDeviceId}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Pixel Change Ratio (0.01 - 1.00)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1.00"
                    value={config.pixelChangeThreshold || 0.02}
                    onChange={(e) => setConfig({ ...config, pixelChangeThreshold: parseFloat(e.target.value) || 0.02 })}
                    required
                    disabled={!selectedDeviceId}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-secondary"
                style={{ width: 'fit-content', alignSelf: 'flex-end', fontSize: '0.85rem' }}
                disabled={!selectedDeviceId}
              >
                Apply Configuration
              </button>
            </form>
          </div>

          {/* LIVE TERMINAL LOGS */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <h2 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Terminal size={18} color="var(--secondary)" /> System Status Logs
            </h2>
            <div className="terminal-log" ref={terminalContainerRef}>
              {logs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  {selectedDeviceId ? 'Waiting for device events...' : 'Select a device to view logs.'}
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="log-entry">
                    <span className="log-time">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                    <span>{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: CLIPS PLAYBACK & AI CHAT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* EVENT ARCHIVE & PLAYBACK PANEL */}
          <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Video size={18} color="var(--primary)" /> Event Archive & Playback
              </h2>
              <button
                onClick={fetchClips}
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '0.75rem', borderRadius: '6px' }}
                disabled={loadingClips}
              >
                <RefreshCw size={12} className={loadingClips ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>

            <div className="event-archive-layout">
              {/* Left pane: Clips History List */}
              <div className="event-archive-list">
                {clips.length === 0 ? (
                  <div style={{ height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No clips recorded yet.
                  </div>
                ) : (
                  clips.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => setSelectedClip(c)}
                      className={`glass-panel interactive ${selectedClip?.id === c.id ? 'active' : ''}`}
                      style={{ padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                        <div style={{ background: 'var(--primary-glow)', padding: '8px', borderRadius: '8px', color: 'var(--primary)', flexShrink: 0 }}>
                          <Play size={16} fill="currentColor" />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{c.camera}</span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.summary}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={(e) => handleDeleteClip(c.id, e)}
                        className="btn"
                        style={{ padding: '6px', background: 'transparent', color: 'var(--text-muted)', border: 'none' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--danger)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Vertical Divider */}
              <div className="event-archive-divider" />

              {/* Right pane: Clip Viewer */}
              <div className="event-archive-viewer">
                {selectedClip ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ background: '#000', borderRadius: '12px', overflow: 'hidden', height: '220px', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
                      <video
                        key={selectedClip.id}
                        src={`${API_BASE}/videos/${selectedClip.filename}`}
                        controls
                        autoPlay
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '4px' }}>
                        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, wordBreak: 'break-all', color: 'var(--text-primary)' }}>{selectedClip.filename}</h3>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                          <Clock size={12} /> {formatDate(selectedClip.timestamp)}
                        </span>
                      </div>
                      <div style={{ background: 'rgba(124, 58, 237, 0.05)', border: '1px solid rgba(124, 58, 237, 0.15)', borderRadius: '8px', padding: '10px' }}>
                        <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Sparkles size={12} /> Gemini Video Summary
                        </p>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{selectedClip.summary}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', border: '1px dashed var(--border-glass)', borderRadius: '12px', color: 'var(--text-muted)', padding: '20px', textAlign: 'center' }}>
                    <Video size={32} color="var(--text-muted)" style={{ marginBottom: '10px' }} />
                    <p style={{ fontSize: '0.85rem', fontWeight: 500 }}>No Event Selected</p>
                    <p style={{ fontSize: '0.75rem', marginTop: '4px', maxWidth: '220px' }}>Select a clip from the history list to play and view the AI summary.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI ANALYST PANEL (RAG CHAT) */}
          <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '420px' }}>
            <h2 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Sparkles size={18} color="var(--primary)" /> Ask Camera AI (RAG)
            </h2>

            {/* Chat message space */}
            <div
              ref={chatContainerRef}
              style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '4px', marginBottom: '14px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}
            >
              {chatHistory.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                  <HelpCircle size={32} color="var(--text-muted)" style={{ marginBottom: '10px' }} />
                  <p style={{ fontSize: '0.85rem', fontWeight: 600 }}>No active session query.</p>
                  <p style={{ fontSize: '0.75rem', maxWidth: '300px', marginTop: '4px' }}>Ask questions about video events, e.g.: "Has anyone walked past in a red shirt?" or "What activity was recorded on my camera?"</p>
                </div>
              ) : (
                chatHistory.map((chat, idx) => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignSelf: chat.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                    <div style={{
                      background: chat.role === 'user' ? 'linear-gradient(135deg, var(--primary) 0%, #6d28d9 100%)' : 'rgba(255,255,255,0.04)',
                      border: chat.role === 'user' ? 'none' : '1px solid var(--border-glass)',
                      color: 'var(--text-primary)',
                      padding: '10px 14px',
                      borderRadius: '12px',
                      fontSize: '0.85rem',
                      lineHeight: 1.4,
                      boxShadow: chat.role === 'user' ? '0 4px 10px rgba(124, 58, 237, 0.15)' : 'none',
                    }}>
                      {chat.content}
                    </div>

                    {/* Cited references when assistant responds */}
                    {chat.role === 'assistant' && chat.clips && chat.clips.length > 0 && (
                      <div style={{ marginTop: '8px', width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <Video size={12} color="var(--primary)" />
                          <span>Cited Video Footage:</span>
                        </div>
                        <div
                          className="cited-clips-scroll"
                          style={{
                            display: 'flex',
                            gap: '10px',
                            overflowX: 'auto',
                            paddingBottom: '8px',
                            width: '100%',
                            scrollBehavior: 'smooth'
                          }}
                        >
                          {chat.clips.map((c, cIdx) => {
                            const filename = c.filename || c.filepath.split(/[/\\]/).pop() || '';
                            const videoUrl = `${API_BASE}/videos/${filename}`;
                            const matchPercentage = c.score ? Math.round(c.score * 100) : null;

                            return (
                              <div
                                key={cIdx}
                                className="glass-panel"
                                style={{
                                  flexShrink: 0,
                                  width: '200px',
                                  padding: '8px',
                                  borderRadius: '10px',
                                  border: '1px solid rgba(255, 255, 255, 0.06)',
                                  background: 'rgba(15, 23, 42, 0.6)',
                                }}
                              >
                                <div style={{
                                  width: '100%',
                                  height: '112px',
                                  background: '#020617',
                                  borderRadius: '6px',
                                  overflow: 'hidden',
                                  position: 'relative',
                                  border: '1px solid rgba(255, 255, 255, 0.05)',
                                  marginBottom: '6px'
                                }}>
                                  <video
                                    src={videoUrl}
                                    controls
                                    preload="metadata"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                  />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span
                                      title={c.camera}
                                      style={{
                                        fontSize: '0.75rem',
                                        fontWeight: 600,
                                        color: 'var(--text-primary)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        maxWidth: '110px'
                                      }}
                                    >
                                      {c.camera}
                                    </span>
                                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                      {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </span>
                                  </div>

                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                                    {matchPercentage !== null && (
                                      <span
                                        style={{
                                          fontSize: '0.65rem',
                                          color: 'var(--secondary)',
                                          background: 'rgba(6, 182, 212, 0.1)',
                                          padding: '1px 5px',
                                          borderRadius: '4px',
                                          fontWeight: 600
                                        }}
                                      >
                                        {matchPercentage}% Match
                                      </span>
                                    )}
                                    <button
                                      onClick={() => selectAndPlayClip(c.id)}
                                      className="btn btn-secondary"
                                      style={{
                                        padding: '2px 8px',
                                        fontSize: '0.65rem',
                                        height: '20px',
                                        borderRadius: '4px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                        background: 'rgba(255, 255, 255, 0.05)',
                                        border: '1px solid rgba(255, 255, 255, 0.08)'
                                      }}
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
                <div style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)', padding: '10px 14px', borderRadius: '12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Searching vectors and answering...
                </div>
              )}
            </div>

            {/* Question query input */}
            <form onSubmit={handleAskQuestion} style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask about your camera recordings..."
                style={{ flex: 1 }}
                disabled={isAsking}
              />
              <button type="submit" className="btn btn-primary" style={{ padding: '10px 15px' }} disabled={isAsking}>
                <Send size={16} />
              </button>
            </form>
          </div>

        </div>

      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}

export default App;
