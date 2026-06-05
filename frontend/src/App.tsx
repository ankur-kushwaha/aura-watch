import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  Settings, 
  Play, 
  Trash2, 
  Send, 
  Activity, 
  Terminal, 
  Video, 
  RefreshCw, 
  Cpu, 
  HelpCircle,
  Clock,
  Sparkles,
  Link2
} from 'lucide-react';

interface VideoClip {
  id: string;
  filepath: string;
  filename: string;
  timestamp: string;
  summary: string;
  duration: number;
  camera: string;
}

interface CameraConfig {
  name: string;
  type: 'webcam' | 'rtsp';
  streamUrl: string;
  enabled: boolean;
}

interface RagResponseClip {
  id: string;
  camera: string;
  timestamp: string;
  summary: string;
  filepath: string;
  score: number;
}

const API_BASE = 'http://localhost:5000/api';
const WS_BASE = 'ws://localhost:5000';

function App() {
  // App States
  const [config, setConfig] = useState<CameraConfig>({
    name: 'Macbook Air Camera',
    type: 'webcam',
    streamUrl: '0',
    enabled: false,
  });
  const [status, setStatus] = useState<string>('Idle');
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

  // UI Web Feed State (for local browser webcam preview)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [localStreamActive, setLocalStreamActive] = useState<boolean>(false);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // WebSocket Ref
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch initial config and clips
  useEffect(() => {
    fetchConfig();
    fetchClips();
  }, []);

  // Scroll to bottom of terminal and chat
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // Establish WebSocket connection
  useEffect(() => {
    connectWS();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // Handle local webcam preview in the browser for testing
  useEffect(() => {
    if (config.type === 'webcam' && config.enabled) {
      startBrowserWebcam();
    } else {
      stopBrowserWebcam();
    }
  }, [config.enabled, config.type]);

  const connectWS = () => {
    console.log('Connecting to websocket...');
    const ws = new WebSocket(WS_BASE);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'status':
          setStatus(data.status);
          if (data.cameraConfig) {
            setConfig(data.cameraConfig);
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
          // If no clip is currently selected, highlight this new one
          setSelectedClip(data.clip);
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      console.log('WebSocket closed. Reconnecting in 5s...');
      setTimeout(connectWS, 5000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  };

  const startBrowserWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setLocalStreamActive(true);
      }
    } catch (err) {
      console.warn('Could not open webcam in browser. (Check permissions)', err);
      setLocalStreamActive(false);
    }
  };

  const stopBrowserWebcam = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setLocalStreamActive(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/config`);
      const data = await res.json();
      setConfig(data);
    } catch (err) {
      console.error('Failed to fetch config', err);
    }
  };

  const fetchClips = async () => {
    setLoadingClips(true);
    try {
      const res = await fetch(`${API_BASE}/clips`);
      const data = await res.json();
      setClips(data);
      if (data.length > 0 && !selectedClip) {
        setSelectedClip(data[0]);
      }
    } catch (err) {
      console.error('Failed to fetch clips', err);
    } finally {
      setLoadingClips(false);
    }
  };

  const handleConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      setConfig(data.config);
    } catch (err) {
      console.error('Failed to update config', err);
    }
  };

  const handleToggleMonitoring = async () => {
    const updatedConfig = { ...config, enabled: !config.enabled };
    setConfig(updatedConfig);
    try {
      await fetch(`${API_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
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
      // Scroll to video player
      document.getElementById('video-player-section')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Helper to get relative timeline label
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
          {/* Active Status Display */}
          <div className={`status-indicator ${status.toLowerCase().replace(' ', '')}`}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'currentColor', display: 'inline-block' }}></span>
            {status}
          </div>

          <button 
            onClick={handleToggleMonitoring}
            className={`btn ${config.enabled ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontWeight: 600 }}
          >
            {config.enabled ? (
              <>
                <Activity size={16} /> Disable Monitor
              </>
            ) : (
              <>
                <Camera size={16} /> Enable Monitor
              </>
            )}
          </button>
        </div>
      </header>

      {/* DASHBOARD LAYOUT */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)', gap: '24px' }}>
        
        {/* LEFT COLUMN: CAMERA & ARCHIVE */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* CAMERA stream / STATUS MONITOR */}
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
              
              {localStreamActive ? (
                <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  {config.enabled ? (
                    <>
                      <div style={{ animation: 'spin 4s linear infinite', marginBottom: '12px', display: 'inline-block' }}>
                        <RefreshCw size={36} color="var(--primary)" />
                      </div>
                      <p style={{ fontSize: '0.9rem' }}>Camera Stream Active in Backend</p>
                      <p style={{ fontSize: '0.75rem', marginTop: '4px' }}>Webcam browser preview disabled or unavailable</p>
                    </>
                  ) : (
                    <>
                      <Camera size={36} color="var(--text-muted)" style={{ marginBottom: '12px' }} />
                      <p style={{ fontSize: '0.9rem' }}>Monitoring Inactive</p>
                      <p style={{ fontSize: '0.75rem', marginTop: '4px' }}>Enable monitoring above to view feed</p>
                    </>
                  )}
                </div>
              )}

              {/* Dynamic Overlay HUD when motion occurs */}
              {motionActive && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, border: '2px solid var(--danger)', pointerEvents: 'none', boxShadow: 'inset 0 0 30px rgba(244, 63, 94, 0.25)', borderRadius: '12px' }} />
              )}
            </div>
            
            {/* Motion sensitivity bar */}
            {config.enabled && (
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
              <Settings size={18} color="var(--secondary)" /> Stream Configuration
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
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Source Type</label>
                  <select 
                    value={config.type}
                    onChange={(e) => setConfig({ ...config, type: e.target.value as 'webcam' | 'rtsp' })}
                  >
                    <option value="webcam">Mac/Local Webcam</option>
                    <option value="rtsp">RTSP Network Stream</option>
                  </select>
                </div>
              </div>

              {config.type === 'rtsp' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>RTSP URL</label>
                  <input 
                    type="text" 
                    value={config.streamUrl}
                    onChange={(e) => setConfig({ ...config, streamUrl: e.target.value })}
                    placeholder="rtsp://username:password@ip:port/h264"
                    required
                  />
                </div>
              )}

              <button type="submit" className="btn btn-secondary" style={{ width: 'fit-content', alignSelf: 'flex-end', fontSize: '0.85rem' }}>
                Apply Settings
              </button>
            </form>
          </div>

          {/* LIVE TERMINAL LOGS */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <h2 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Terminal size={18} color="var(--secondary)" /> System Status Logs
            </h2>
            <div className="terminal-log">
              {logs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Waiting for system events...</div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="log-entry">
                    <span className="log-time">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                    <span>{log.message}</span>
                  </div>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: CLIPS PLAYBACK & AI CHAT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* VIDEO PLAYER SECTION (Toggled when clip is selected) */}
          <div id="video-player-section" className="glass-panel" style={{ padding: '20px' }}>
            <h2 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <Video size={18} color="var(--primary)" /> Recorded Clip Viewer
            </h2>
            {selectedClip ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ background: '#000', borderRadius: '12px', overflow: 'hidden', height: '280px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <video 
                    key={selectedClip.id}
                    src={`${API_BASE}/videos/${selectedClip.filename}`} 
                    controls 
                    autoPlay
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>{selectedClip.filename}</h3>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={12} /> {formatDate(selectedClip.timestamp)}
                    </span>
                  </div>
                  <div style={{ background: 'rgba(124, 58, 237, 0.05)', border: '1px solid rgba(124, 58, 237, 0.15)', borderRadius: '8px', padding: '12px' }}>
                    <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Sparkles size={12} /> Gemini Video Summary
                    </p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{selectedClip.summary}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ height: '180px', display: 'flex', justifyContent: 'center', alignItems: 'center', border: '1px dashed var(--border-glass)', borderRadius: '12px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Select a clip from the gallery below to play and read summary.
              </div>
            )}
          </div>

          {/* AI ANALYST PANEL (RAG CHAT) */}
          <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '420px' }}>
            <h2 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Sparkles size={18} color="var(--primary)" /> Ask Camera AI (RAG)
            </h2>
            
            {/* Chat message space */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '4px', marginBottom: '14px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
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
                      <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', width: '100%' }}>Cited Clips:</span>
                        {chat.clips.map((c, cIdx) => (
                          <button 
                            key={cIdx} 
                            onClick={() => selectAndPlayClip(c.id)}
                            className="btn"
                            style={{ 
                              padding: '3px 8px', 
                              fontSize: '0.7rem', 
                              background: 'rgba(6, 182, 212, 0.08)', 
                              border: '1px solid rgba(6, 182, 212, 0.25)', 
                              color: 'var(--secondary)',
                              borderRadius: '4px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <Link2 size={10} /> {c.camera} ({new Date(c.timestamp).toLocaleTimeString()})
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
              {isAsking && (
                <div style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)', padding: '10px 14px', borderRadius: '12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Searching vectors and summarizing...
                </div>
              )}
              <div ref={chatEndRef} />
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

          {/* EVENTS ARCHIVE / CLIPS GALLERY */}
          <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '350px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={18} color="var(--secondary)" /> Event Clip History
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

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{new Date(c.timestamp).toLocaleTimeString()}</span>
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
