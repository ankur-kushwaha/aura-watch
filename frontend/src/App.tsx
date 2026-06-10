/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  SlidersHorizontal,
  LogOut,
  Fingerprint,
  Network,
  Map,
  Plus,
  X,
  Info,
  Copy,
  Check,
  Power,
  RotateCcw,
  ScrollText,
  Download,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
  Users
} from 'lucide-react';

const PREVIEW_STALL_MS = 5000;

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
  status: string;
  lastHeartbeat: string;
}

interface CameraStream {
  id: string;
  streamId: string;
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
  streamHost: string;
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

interface ReidDetection {
  id: string;
  deviceId: string;
  cameraName: string;
  streamId?: string;
  trackId: number;
  timestamp: string;
  filename: string;
  bbox: string;
  className: string;
  identityId?: string | null;
  identity?: { id: string; label?: string | null } | null;
}

interface ReidRoute {
  id?: string;
  fromCamera: string;
  toCamera: string;
  fromStreamId?: string;
  toStreamId?: string;
  minTimeSeconds: number;
  maxTimeSeconds: number;
  topologyScore: number;
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:5000/api' : `${window.location.origin}/api`;
const WS_BASE = import.meta.env.DEV ? 'ws://localhost:5000' : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
const HUB_HTTP = import.meta.env.DEV ? 'http://localhost:5000' : window.location.origin;

function buildInstallCmd() {
  return `CLOUD_URL='${HUB_HTTP}' sh -c "$(curl -fsSL https://raw.githubusercontent.com/ankur-kushwaha/aura-watch/main/edge/scripts/install.sh)"`;
}

function DeviceInstallTooltip() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const installCmd = buildInstallCmd();

  const handleCopy = () => {
    navigator.clipboard.writeText(installCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="How to add a new device"
        style={{
          background: 'none',
          border: 'none',
          padding: '2px',
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          display: 'flex',
          alignItems: 'center',
          transition: 'color 0.2s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-primary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
      >
        <Info size={15} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 10px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 999,
            width: '340px',
            background: 'rgba(15, 17, 26, 0.97)',
            border: '1px solid rgba(124, 58, 237, 0.35)',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,58,237,0.15)',
            backdropFilter: 'blur(16px)',
            padding: '14px 16px',
          }}
        >
          {/* Arrow */}
          <div style={{
            position: 'absolute',
            top: '-6px',
            left: '50%',
            transform: 'translateX(-50%) rotate(45deg)',
            width: '10px',
            height: '10px',
            background: 'rgba(15, 17, 26, 0.97)',
            border: '1px solid rgba(124, 58, 237, 0.35)',
            borderRight: 'none',
            borderBottom: 'none',
          }} />

          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-primary)', marginBottom: '6px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            ➕ Add a New Edge Device
          </p>
          <p style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginBottom: '10px', lineHeight: 1.5 }}>
            Run this command on the target device (Linux / macOS) to install and register the edge agent:
          </p>

          <div style={{
            background: 'rgba(0,0,0,0.5)',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.08)',
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
          }}>
            <code style={{
              flex: 1,
              fontSize: '0.68rem',
              color: '#38bdf8',
              fontFamily: 'monospace',
              wordBreak: 'break-all',
              lineHeight: 1.6,
            }}>
              {installCmd}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              title="Copy command"
              style={{
                background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(124,58,237,0.15)',
                border: `1px solid ${copied ? 'rgba(16,185,129,0.4)' : 'rgba(124,58,237,0.4)'}`,
                borderRadius: '6px',
                padding: '4px 6px',
                cursor: 'pointer',
                color: copied ? '#10b981' : 'var(--color-primary)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                transition: 'all 0.2s',
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>

          <p style={{ fontSize: '0.67rem', color: 'var(--color-text-muted)', marginTop: '8px', lineHeight: 1.4 }}>
            Installs, starts the agent, and registers it with this dashboard automatically via WebSocket.
          </p>
        </div>
      )}
    </div>
  );
}

interface AppProps {
  onLogout: () => void;
}

function App({ onLogout }: AppProps) {
  // App States
  const [devices, setDevices] = useState<EdgeDevice[]>([]);
  const [streams, setStreams] = useState<CameraStream[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedStreamId, setSelectedStreamId] = useState<string>('');
  const [showConfigDialog, setShowConfigDialog] = useState<boolean>(false);
  // When non-null, the dialog is in "add" mode and this is the target deviceId
  const [addingStreamForDeviceId, setAddingStreamForDeviceId] = useState<string | null>(null);
  const [deviceLogsModal, setDeviceLogsModal] = useState<{ deviceId: string; name: string } | null>(null);
  const [deviceLogs, setDeviceLogs] = useState<{ message: string; timestamp: string }[]>([]);
  const [journalLogs, setJournalLogs] = useState<string>('');
  const [loadingJournalLogs, setLoadingJournalLogs] = useState<boolean>(false);
  const [deviceCommandPending, setDeviceCommandPending] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'events' | 'reid'>('events');

  // ReID States
  const [reidCrops, setReidCrops] = useState<ReidDetection[]>([]);
  const [loadingReidCrops, setLoadingReidCrops] = useState<boolean>(false);
  const [selectedReidCrop, setSelectedReidCrop] = useState<ReidDetection | null>(null);
  const [reidMatches, setReidMatches] = useState<any[]>([]);
  const [isReidSearching, setIsReidSearching] = useState<boolean>(false);
  const [mergeMode, setMergeMode] = useState<boolean>(false);
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  const [feedbackPending, setFeedbackPending] = useState<string | null>(null);

  // Topology States
  const [topologyRoutes, setTopologyRoutes] = useState<ReidRoute[]>([]);
  const [newRoute, setNewRoute] = useState<ReidRoute>({
    fromCamera: '',
    toCamera: '',
    minTimeSeconds: 5,
    maxTimeSeconds: 60,
    topologyScore: 1.0,
  });
  const selectedStreamIdRef = useRef(selectedStreamId);
  const deviceLogsModalRef = useRef(deviceLogsModal);
  const deviceLogsContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedStreamIdRef.current = selectedStreamId;
  }, [selectedStreamId]);

  useEffect(() => {
    deviceLogsModalRef.current = deviceLogsModal;
  }, [deviceLogsModal]);

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
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; content: string; clips?: RagResponseClip[]; reidDetections?: { id: string; cameraName: string; trackId: number; timestamp: string; filename: string; className: string }[] }[]>([]);
  const [isAsking, setIsAsking] = useState<boolean>(false);
  const [filterStartTime, setFilterStartTime] = useState<string>('');
  const [filterEndTime, setFilterEndTime] = useState<string>('');
  const [filterStreamId, setFilterStreamId] = useState<string>('');
  const [showFilters, setShowFilters] = useState<boolean>(false);

  // Live Camera Feed Video States
  const [streamLoading, setStreamLoading] = useState<boolean>(true);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [previewFrozen, setPreviewFrozen] = useState<boolean>(false);
  const lastFrameAtRef = useRef<number>(0);
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

      const streamsRes = await fetch(`${API_BASE}/streams`);
      const streamsData = await streamsRes.json();
      setStreams(streamsData);

      if (streamsData.length > 0) {
        setSelectedStreamId((prevId) => {
          if (selectFirst || !prevId) {
            return streamsData[0].streamId;
          }
          return prevId;
        });
      }
    } catch (err) {
      console.error('Failed to fetch devices/streams', err);
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
      console.log('WebSocket open. Subscribing to selected stream...');
      const currentStreamId = selectedStreamIdRef.current;
      if (currentStreamId) {
        ws.send(JSON.stringify({ type: 'subscribe_stream', streamId: currentStreamId }));
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'status':
          if (data.streamId) {
            setStreams((prev) =>
              prev.map((s) =>
                s.streamId === data.streamId
                  ? {
                    ...s,
                    status: data.status,
                    ...(data.cameraConfig ? {
                      name: data.cameraConfig.name,
                      cameraType: data.cameraConfig.cameraType,
                      streamUrl: data.cameraConfig.streamUrl,
                      trackingEnabled: data.cameraConfig.trackingEnabled,
                      motionThreshold: data.cameraConfig.motionThreshold,
                      pixelChangeThreshold: data.cameraConfig.pixelChangeThreshold,
                      detectPerson: data.cameraConfig.detectPerson ?? true,
                      detectVehicle: data.cameraConfig.detectVehicle ?? true,
                      streamHost: data.cameraConfig.streamHost,
                    } : {})
                  }
                  : s
              )
            );

            if (data.streamId === selectedStreamIdRef.current) {
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
              }
            }
          }
          break;
        case 'motion_state':
          setMotionActive(data.active);
          setMotionRatio(data.ratio);
          break;
        case 'log': {
          const logEntry = { message: data.message, timestamp: data.timestamp };
          setLogs((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.message === data.message && last.timestamp === data.timestamp) {
              return prev;
            }
            return [...prev, logEntry];
          });
          if (deviceLogsModalRef.current) {
            setDeviceLogs((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.message === data.message && last.timestamp === data.timestamp) {
                return prev;
              }
              return [...prev, logEntry];
            });
          }
          break;
        }
        case 'new_clip':
          setClips((prev) => [data.clip, ...prev]);
          setSelectedClip(data.clip);
          break;
        case 'new_reid_crop':
          if (data.detection) {
            setReidCrops((prev) => {
              const alreadyExists = prev.some(c => c.id === data.detection.id);
              if (alreadyExists) return prev;
              return [data.detection, ...prev];
            });
          }
          break;
        case 'frame':
          if (data.image && data.streamId === selectedStreamIdRef.current) {
            lastFrameAtRef.current = Date.now();
            setLiveFrame(`data:image/jpeg;base64,${data.image}`);
            setStreamLoading(false);
            setPreviewFrozen(false);
          }
          break;
        case 'preview_stall':
          if (data.streamId === selectedStreamIdRef.current) {
            setPreviewFrozen(true);
          }
          break;
        case 'preview_resumed':
          if (data.streamId === selectedStreamIdRef.current) {
            setPreviewFrozen(false);
          }
          break;
        case 'devices_changed':
          fetchDevices();
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
  }, [fetchDevices]);

  // Fetch initial data
  useEffect(() => {
    Promise.resolve().then(() => {
      fetchDevices(true);
      fetchClips();
    });
  }, [fetchDevices, fetchClips]);

  // Sync selected stream details when selectedStreamId or streams list changes
  useEffect(() => {
    if (!selectedStreamId) return;
    const stream = streams.find((s) => s.streamId === selectedStreamId);
    if (stream) {
      Promise.resolve().then(() => {
        setConfig({
          name: stream.name,
          type: stream.cameraType,
          streamUrl: stream.streamUrl,
          trackingEnabled: stream.trackingEnabled,
          motionThreshold: stream.motionThreshold,
          pixelChangeThreshold: stream.pixelChangeThreshold,
          detectPerson: stream.detectPerson ?? true,
          detectVehicle: stream.detectVehicle ?? true,
        });
        setStatus(stream.status);
        setSelectedDeviceId(stream.deviceId);
      });
    }
  }, [selectedStreamId, streams]);

  // Sync WS subscription when stream changes
  useEffect(() => {
    if (!selectedStreamId) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Clear logs for new stream
      setLogs([]);
      setMotionActive(false);
      setMotionRatio(0);

      wsRef.current.send(JSON.stringify({ type: 'subscribe_stream', streamId: selectedStreamId }));
    }
  }, [selectedStreamId]);

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

  const fetchReidCrops = useCallback(async () => {
    setLoadingReidCrops(true);
    try {
      const res = await fetch(`${API_BASE}/reid/detections`);
      const data = await res.json();
      setReidCrops(data);
    } catch (err) {
      console.error('Failed to fetch ReID crops', err);
    } finally {
      setLoadingReidCrops(false);
    }
  }, []);

  const fetchTopology = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/reid/topology`);
      const data = await res.json();
      setTopologyRoutes(data);
    } catch (err) {
      console.error('Failed to fetch topology routes', err);
    }
  }, []);

  const handleReidTrack = async (detection: ReidDetection) => {
    setSelectedReidCrop(detection);
    setIsReidSearching(true);
    setReidMatches([]);
    try {
      const res = await fetch(`${API_BASE}/reid/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detectionId: detection.id }),
      });
      const data = await res.json();
      if (data.error) {
        alert(`Search error: ${data.error}`);
      } else {
        setReidMatches(data.matches || []);
      }
    } catch (err: any) {
      console.error('ReID search failed', err);
      alert(`ReID search failed: ${err.message}`);
    } finally {
      setIsReidSearching(false);
    }
  };

  const handleAddTopology = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoute.fromCamera || !newRoute.toCamera) {
      alert('Select both source and target cameras.');
      return;
    }
    if (newRoute.fromCamera === newRoute.toCamera) {
      alert('Source and target cameras must be different.');
      return;
    }
    try {
      // Find streamIds for topology linking
      const fromStream = streams.find(s => s.name === newRoute.fromCamera);
      const toStream = streams.find(s => s.name === newRoute.toCamera);
      const payload = {
        ...newRoute,
        fromStreamId: fromStream?.streamId,
        toStreamId: toStream?.streamId,
      };

      const res = await fetch(`${API_BASE}/reid/topology`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        fetchTopology();
        setNewRoute(prev => ({
          ...prev,
          fromCamera: '',
          toCamera: '',
        }));
      }
    } catch (err) {
      console.error('Failed to save topology route', err);
    }
  };

  const handleDeleteReidDetection = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this face crop?')) return;
    try {
      const res = await fetch(`${API_BASE}/reid/detections/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setReidCrops(prev => prev.filter(c => c.id !== id));
        if (selectedReidCrop?.id === id) {
          setSelectedReidCrop(null);
          setReidMatches([]);
        }
        setMergeSelection(prev => prev.filter(s => s !== id));
      }
    } catch (err) {
      console.error('Failed to delete ReID detection', err);
    }
  };

  const handleReidFeedback = async (
    type: 'confirm' | 'reject' | 'same_person' | 'different_person',
    sourceDetectionId: string,
    targetDetectionId: string,
  ) => {
    const key = `${type}:${sourceDetectionId}:${targetDetectionId}`;
    setFeedbackPending(key);
    try {
      const res = await fetch(`${API_BASE}/reid/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, sourceDetectionId, targetDetectionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to save feedback');
        return;
      }

      await fetchReidCrops();
      if (selectedReidCrop) {
        await handleReidTrack(selectedReidCrop);
      }
    } catch (err) {
      console.error('Failed to submit ReID feedback', err);
    } finally {
      setFeedbackPending(null);
    }
  };

  const handleMergeSelection = (crop: ReidDetection) => {
    if (!mergeMode) return;
    setMergeSelection(prev => {
      if (prev.includes(crop.id)) {
        return prev.filter(id => id !== crop.id);
      }
      if (prev.length >= 2) {
        return [prev[1], crop.id];
      }
      return [...prev, crop.id];
    });
  };

  const handleMergeIdentities = async () => {
    if (mergeSelection.length < 2) {
      alert('Select at least 2 crops to merge as the same person.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/reid/identities/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detectionIds: mergeSelection }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to merge identities');
        return;
      }
      const mergedIds = [...mergeSelection];
      setMergeSelection([]);
      setMergeMode(false);
      await fetchReidCrops();
      if (selectedReidCrop && mergedIds.includes(selectedReidCrop.id)) {
        await handleReidTrack(selectedReidCrop);
      }
    } catch (err) {
      console.error('Failed to merge identities', err);
    }
  };

  const handleGalleryCropClick = (crop: ReidDetection) => {
    if (mergeMode) {
      handleMergeSelection(crop);
      return;
    }
    handleReidTrack(crop);
  };

  useEffect(() => {
    if (activeTab === 'reid') {
      fetchReidCrops();
      fetchTopology();
    }
  }, [activeTab, fetchReidCrops, fetchTopology]);

  // useEffect(() => {
  //   if (chatContainerRef.current) {
  //     chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  //   }
  // }, [chatHistory]);

  // Reset stream loading only when switching streams (not on Recording/Processing status)
  useEffect(() => {
    Promise.resolve().then(() => {
      setStreamLoading(true);
      setLiveFrame(null);
      setPreviewFrozen(false);
      lastFrameAtRef.current = 0;
    });
  }, [selectedStreamId]);

  // Detect frozen preview when WS frames stop arriving
  useEffect(() => {
    if (!selectedStreamId || status === 'Offline') {
      setPreviewFrozen(false);
      return;
    }

    const intervalId = setInterval(() => {
      const lastFrameAt = lastFrameAtRef.current;
      if (!lastFrameAt) return;
      setPreviewFrozen(Date.now() - lastFrameAt > PREVIEW_STALL_MS);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [selectedStreamId, status]);

  const handleConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStreamId) return;
    if (!config.detectPerson && !config.detectVehicle) {
      alert('Select at least one detection target: Person or Vehicle.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/streams/${selectedStreamId}/config`, {
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

  const handleToggleStreamMonitoring = async (streamId: string, currentTrackingEnabled: boolean) => {
    const stream = streams.find(s => s.streamId === streamId);
    if (!stream || stream.status === 'Offline') return;

    try {
      const res = await fetch(`${API_BASE}/streams/${streamId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingEnabled: !currentTrackingEnabled,
        }),
      });
      const data = await res.json();

      if (streamId === selectedStreamId) {
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

  const handleAddStream = (deviceId: string) => {
    // Just open the dialog with defaults — stream is created only on form submit
    setSelectedDeviceId(deviceId);
    setSelectedStreamId('');
    setConfig({
      name: 'New Camera Stream',
      type: 'webcam',
      streamUrl: '0',
      trackingEnabled: false,
      motionThreshold: 25,
      pixelChangeThreshold: 0.02,
      detectPerson: true,
      detectVehicle: true,
    });
    setAddingStreamForDeviceId(deviceId);
    setShowConfigDialog(true);
  };

  const handleDeviceReboot = async (deviceId: string, deviceName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Reboot device "${deviceName}"? The device will disconnect briefly.`)) return;

    setDeviceCommandPending(`${deviceId}:reboot`);
    try {
      const res = await fetch(`${API_BASE}/devices/${deviceId}/command/reboot`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to reboot device');
      }
    } catch (err) {
      console.error('Failed to reboot device', err);
      alert('Failed to reboot device');
    } finally {
      setDeviceCommandPending(null);
    }
  };

  const handleRestartService = async (deviceId: string, deviceName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Restart aura-watch-edge service on "${deviceName}"?`)) return;

    setDeviceCommandPending(`${deviceId}:restart`);
    try {
      const res = await fetch(`${API_BASE}/devices/${deviceId}/command/restart-service`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to restart service');
      }
    } catch (err) {
      console.error('Failed to restart service', err);
      alert('Failed to restart service');
    } finally {
      setDeviceCommandPending(null);
    }
  };

  const handleUpdateService = async (deviceId: string, deviceName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !confirm(
        `Pull latest code and update aura-watch-edge on "${deviceName}"?\n\nThis runs git pull, updates dependencies, and restarts the service. It may take several minutes.`
      )
    ) {
      return;
    }

    setDeviceCommandPending(`${deviceId}:update`);
    try {
      const res = await fetch(`${API_BASE}/devices/${deviceId}/command/update-service`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.output ? `\n\n${data.output}` : '';
        alert((data.error || 'Failed to update service') + detail);
      } else {
        const detail = data.output ? `\n\n${data.output}` : '';
        alert((data.message || 'Update complete') + detail);
      }
    } catch (err) {
      console.error('Failed to update service', err);
      alert('Failed to update service');
    } finally {
      setDeviceCommandPending(null);
    }
  };

  const fetchJournalLogs = useCallback(async (deviceId: string) => {
    setLoadingJournalLogs(true);
    try {
      const res = await fetch(`${API_BASE}/devices/${deviceId}/logs?lines=200`);
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
      setLoadingJournalLogs(false);
    }
  }, []);

  const openDeviceLogsModal = (deviceId: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeviceLogs([]);
    setJournalLogs('');
    setDeviceLogsModal({ deviceId, name });

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe_device', deviceId }));
    }
    fetchJournalLogs(deviceId);
  };

  const closeDeviceLogsModal = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe_device' }));
    }
    setDeviceLogsModal(null);
    setDeviceLogs([]);
    setJournalLogs('');
  };

  useEffect(() => {
    if (deviceLogsContainerRef.current) {
      deviceLogsContainerRef.current.scrollTop = deviceLogsContainerRef.current.scrollHeight;
    }
  }, [deviceLogs]);

  const handleDeleteDevice = async (deviceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this edge device and all its streams?')) return;
    try {
      const res = await fetch(`${API_BASE}/devices/${deviceId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        // Remove device and its streams from state
        setDevices((prev) => prev.filter((d) => d.deviceId !== deviceId));
        setStreams((prev) => {
          const remaining = prev.filter((s) => s.deviceId !== deviceId);
          // If selected stream belonged to deleted device, reset selection
          setSelectedStreamId((prevId) => {
            const stillExists = remaining.some((s) => s.streamId === prevId);
            return stillExists ? prevId : (remaining.length > 0 ? remaining[0].streamId : '');
          });
          return remaining;
        });
      }
    } catch (err) {
      console.error('Failed to delete device', err);
    }
  };

  const handleDeleteStream = async (streamId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this camera stream?')) return;
    try {
      const res = await fetch(`${API_BASE}/streams/${streamId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchDevices();
        setSelectedStreamId((prevId) => {
          if (prevId === streamId) {
            const remaining = streams.filter(s => s.streamId !== streamId);
            return remaining.length > 0 ? remaining[0].streamId : '';
          }
          return prevId;
        });
      }
    } catch (err) {
      console.error('Failed to delete stream', err);
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
          streamId: filterStreamId || undefined,
        }),
      });

      const data = await res.json();

      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', content: data.answer, clips: data.clips, reidDetections: data.reidDetections }
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
          <button
            type="button"
            onClick={onLogout}
            className="btn btn-secondary py-1.5 px-3 text-[0.8rem] rounded-md flex items-center gap-1.5"
          >
            <LogOut size={14} /> Logout
          </button>
        </div>
      </header>

      {/* NAVIGATION TABS */}
      <div className="flex gap-3 mb-6 bg-[rgba(255,255,255,0.02)] p-1.5 rounded-xl border border-border-glass w-fit">
        <button
          onClick={() => setActiveTab('events')}
          className={`py-2 px-4 rounded-lg text-[0.85rem] font-semibold flex items-center gap-2 transition-all duration-200 border-none outline-none ${activeTab === 'events'
            ? 'bg-primary text-white shadow-[0_4px_12px_rgba(124,58,237,0.25)]'
            : 'text-text-secondary hover:text-text-primary bg-transparent'
            }`}
        >
          <Video size={16} /> Archive & AI Analyst
        </button>
        <button
          onClick={() => setActiveTab('reid')}
          className={`py-2 px-4 rounded-lg text-[0.85rem] font-semibold flex items-center gap-2 transition-all duration-200 border-none outline-none ${activeTab === 'reid'
            ? 'bg-primary text-white shadow-[0_4px_12px_rgba(124,58,237,0.25)]'
            : 'text-text-secondary hover:text-text-primary bg-transparent'
            }`}
        >
          <Fingerprint size={16} /> Cross-Camera ReID Tracker
        </button>
      </div>

      {/* DASHBOARD LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* LEFT COLUMN: DEVICES & CAMERA */}
        <div className="lg:col-span-4 flex flex-col gap-6">

          {/* DEVICE SELECTOR PANEL */}
          <div className="glass-panel p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-[1.1rem] flex items-center gap-2">
                <Cpu size={18} color="var(--color-primary)" /> Registered Edge Devices
                <DeviceInstallTooltip />
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
              <div className="flex flex-col gap-4">
                {devices.map((dev) => {
                  const isDeviceOnline = dev.status !== 'Offline';
                  const deviceStreams = streams.filter((s) => s.deviceId === dev.deviceId);

                  return (
                    <div
                      key={dev.deviceId}
                      className="border border-border-glass rounded-xl bg-[rgba(255,255,255,0.015)] p-3.5 flex flex-col gap-3"
                    >
                      {/* Device Header */}
                      <div className="flex justify-between items-center border-b border-[rgba(255,255,255,0.05)] pb-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full inline-block flex-shrink-0 ${isDeviceOnline ? 'bg-emerald-400' : 'bg-text-muted'
                                }`}
                              style={{
                                boxShadow: isDeviceOnline
                                  ? '0 0 8px var(--color-success)'
                                  : 'none',
                              }}
                            />
                            <h3 className="text-[0.9rem] font-bold text-text-primary truncate">
                              {dev.name}
                            </h3>
                          </div>
                          <p className="text-[0.7rem] text-text-muted mt-0.5 truncate">
                            ID: {dev.deviceId} • Device: {dev.status}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddStream(dev.deviceId);
                            }}
                            className="btn btn-secondary py-1 px-2 text-[0.7rem] rounded-md flex items-center gap-1 hover:border-primary/50 hover:text-primary transition-all duration-200"
                          >
                            <Plus size={12} /> Add Stream
                          </button>
                          <button
                            onClick={(e) => handleDeleteDevice(dev.deviceId, e)}
                            className="btn p-1.5 bg-transparent text-text-muted hover:text-danger border border-transparent hover:border-danger/30 rounded-md shrink-0 transition-all duration-200"
                            title="Delete Device"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Device Actions */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={(e) => handleDeviceReboot(dev.deviceId, dev.name, e)}
                          disabled={!isDeviceOnline || deviceCommandPending === `${dev.deviceId}:reboot`}
                          className="btn btn-secondary py-0.5 px-2 text-[0.65rem] rounded-md flex items-center gap-1 disabled:opacity-40"
                          title="Reboot Device"
                        >
                          <Power size={11} />
                          {deviceCommandPending === `${dev.deviceId}:reboot` ? 'Rebooting...' : 'Reboot'}
                        </button>
                        <button
                          onClick={(e) => handleRestartService(dev.deviceId, dev.name, e)}
                          disabled={!isDeviceOnline || deviceCommandPending === `${dev.deviceId}:restart`}
                          className="btn btn-secondary py-0.5 px-2 text-[0.65rem] rounded-md flex items-center gap-1 disabled:opacity-40"
                          title="Restart aura-watch-edge Service"
                        >
                          <RotateCcw size={11} />
                          {deviceCommandPending === `${dev.deviceId}:restart` ? 'Restarting...' : 'Restart Service'}
                        </button>
                        <button
                          onClick={(e) => handleUpdateService(dev.deviceId, dev.name, e)}
                          disabled={!isDeviceOnline || deviceCommandPending === `${dev.deviceId}:update`}
                          className="btn btn-secondary py-0.5 px-2 text-[0.65rem] rounded-md flex items-center gap-1 disabled:opacity-40"
                          title="Pull latest code from git and update service"
                        >
                          <Download size={11} />
                          {deviceCommandPending === `${dev.deviceId}:update` ? 'Updating...' : 'Update'}
                        </button>
                        <button
                          onClick={(e) => openDeviceLogsModal(dev.deviceId, dev.name, e)}
                          className="btn btn-secondary py-0.5 px-2 text-[0.65rem] rounded-md flex items-center gap-1"
                          title="View Device Logs"
                        >
                          <ScrollText size={11} /> Logs
                        </button>
                      </div>

                      {/* Nested Streams List */}
                      <div className="flex flex-col gap-2">
                        {deviceStreams.length === 0 ? (
                          <p className="text-text-muted text-[0.75rem] text-center py-2 italic">
                            No streams configured. Click 'Add Stream' above.
                          </p>
                        ) : (
                          deviceStreams.map((stream) => {
                            const isSelected = stream.streamId === selectedStreamId;
                            const isStreamOnline = stream.status !== 'Offline';
                            const streamStatusColor =
                              stream.status === 'Monitoring'
                                ? 'var(--color-success)'
                                : stream.status === 'Recording'
                                  ? 'var(--color-danger)'
                                  : stream.status === 'Processing Video' ||
                                    stream.status === 'Processing'
                                    ? 'var(--color-primary)'
                                    : stream.status === 'Idle'
                                      ? 'var(--color-secondary)'
                                      : 'var(--color-text-muted)';

                            return (
                              <div
                                key={stream.streamId}
                                onClick={() => {
                                  setSelectedStreamId(stream.streamId);
                                  setSelectedDeviceId(dev.deviceId);
                                }}
                                className={`glass-panel interactive flex items-center justify-between gap-3 cursor-pointer py-2 px-3 rounded-lg text-left transition-all duration-200 ${isSelected
                                  ? 'active border-primary/50 bg-[rgba(124,58,237,0.08)] shadow-[0_0_12px_rgba(124,58,237,0.15)]'
                                  : 'border-border-glass bg-[rgba(255,255,255,0.015)]'
                                  }`}
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span
                                    className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0"
                                    style={{
                                      background: streamStatusColor,
                                      boxShadow:
                                        isStreamOnline && stream.status !== 'Idle'
                                          ? `0 0 6px ${streamStatusColor}`
                                          : 'none',
                                    }}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[0.8rem] font-semibold text-text-primary truncate">
                                      {stream.name}
                                    </div>
                                    <div className="text-[0.65rem] text-text-secondary truncate mt-0.5">
                                      {stream.cameraType === 'webcam'
                                        ? 'Webcam'
                                        : `RTSP: ${stream.streamUrl}`}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1">
                                  {/* Toggle Monitoring Button */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleStreamMonitoring(
                                        stream.streamId,
                                        stream.trackingEnabled
                                      );
                                    }}
                                    className={`btn ${stream.trackingEnabled && isStreamOnline
                                      ? 'btn-primary'
                                      : 'btn-secondary'
                                      } py-0.5 px-2 text-[0.65rem] rounded-md h-[24px] shrink-0 flex items-center gap-1 font-semibold`}
                                    disabled={!isStreamOnline}
                                  >
                                    {stream.trackingEnabled && isStreamOnline ? (
                                      <>
                                        <Activity size={10} /> Disable
                                      </>
                                    ) : (
                                      <>
                                        <Camera size={10} /> Enable
                                      </>
                                    )}
                                  </button>

                                  {/* Settings Button */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedStreamId(stream.streamId);
                                      setSelectedDeviceId(dev.deviceId);
                                      setShowConfigDialog(true);
                                    }}
                                    className="btn p-1 bg-transparent text-text-muted hover:text-primary border-none shrink-0 transition-colors duration-200"
                                    title="Configure Stream"
                                  >
                                    <Settings size={12} />
                                  </button>

                                  {/* Delete Button */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteStream(stream.streamId, e);
                                    }}
                                    className="btn p-1 bg-transparent text-text-muted hover:text-danger border-none shrink-0"
                                    title="Delete Stream"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
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

              {selectedStreamId && status !== 'Offline' ? (
                <div className="w-full relative">
                  {liveFrame && (
                    <img
                      src={liveFrame}
                      alt="Live camera preview"
                      className="w-full h-auto block"
                    />
                  )}

                  {liveFrame && !previewFrozen && (
                    <div className="absolute top-2 left-2 text-[0.65rem] font-semibold flex items-center gap-1.5 py-1 px-2 rounded-full bg-[rgba(16,185,129,0.2)] text-emerald-400 border border-[rgba(16,185,129,0.35)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-[pulse-danger_0.8s_infinite]"></span>
                      LIVE
                    </div>
                  )}

                  {liveFrame && previewFrozen && (
                    <div className="absolute top-2 left-2 text-[0.65rem] font-semibold flex items-center gap-1.5 py-1 px-2 rounded-full bg-[rgba(245,158,11,0.2)] text-amber-400 border border-[rgba(245,158,11,0.35)]">
                      <AlertTriangle size={10} />
                      FROZEN
                    </div>
                  )}

                  {previewFrozen && (
                    <div className="absolute inset-0 border-2 border-amber-500/60 pointer-events-none rounded-xl z-10" />
                  )}

                  {streamLoading && (
                    <div className="text-center text-text-muted absolute inset-0 flex flex-col justify-center items-center bg-[#090d16]/80">
                      <div className="animate-[spin_4s_linear_infinite] mb-3 inline-block">
                        <RefreshCw size={36} color="var(--color-primary)" />
                      </div>
                      <p className="text-[0.9rem]">Initializing Live Stream...</p>
                      <p className="text-[0.75rem] mt-1">Connecting to edge camera (WebSocket)</p>
                    </div>
                  )}
                </div>
              ) : selectedStreamId ? (
                <div className="text-center text-text-muted min-h-[200px] flex flex-col justify-center items-center py-8">
                  <Camera size={36} className="text-text-muted mb-3 mx-auto" />
                  <p className="text-[0.9rem]">Camera Stream Offline</p>
                  <p className="text-[0.75rem] mt-1">
                    Start the edge agent to connect
                  </p>
                </div>
              ) : (
                <div className="text-center text-text-muted min-h-[200px] flex flex-col justify-center items-center py-8">
                  <Camera size={36} className="text-text-muted mb-3 mx-auto" />
                  <p className="text-[0.9rem]">No Camera Stream Selected</p>
                  <p className="text-[0.75rem] mt-1">
                    Select or create a camera stream to view live feed
                  </p>
                </div>
              )}

              {/* Dynamic Overlay HUD when motion occurs */}
              {motionActive && (
                <div className="absolute inset-0 border-2 border-danger pointer-events-none shadow-[inset_0_0_30px_rgba(244,63,94,0.25)] rounded-xl z-20" />
              )}
            </div>
          </div>



          {/* LIVE TERMINAL LOGS */}
          <div className="glass-panel p-5">
            <h2 className="text-[1.1rem] flex items-center gap-2 mb-3">
              <Terminal size={18} color="var(--color-secondary)" /> System Status Logs
            </h2>
            <div className="font-mono bg-[rgba(0,0,0,0.5)] rounded-lg p-3.5 text-[0.85rem] leading-[1.4] text-[#38bdf8] h-[180px] overflow-y-auto border border-[rgba(255,255,255,0.05)]" ref={terminalContainerRef}>
              {logs.length === 0 ? (
                <div className="text-text-muted text-[0.8rem]">
                  {selectedStreamId ? 'Waiting for stream events...' : 'Select a camera stream to view logs.'}
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
          {activeTab === 'events' ? (
            <>
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
                    className={`btn btn-secondary py-1 px-2.5 text-[0.75rem] rounded-md flex items-center gap-1.5 transition-all duration-200 ${showFilters || filterStartTime || filterEndTime || filterStreamId
                      ? 'border-primary text-primary bg-[rgba(124,58,237,0.08)]'
                      : ''
                      }`}
                  >
                    <SlidersHorizontal size={12} />
                    Search Filters
                    {(filterStartTime || filterEndTime || filterStreamId) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block"></span>
                    )}
                  </button>
                </div>

                {/* Collapsible Filter Inputs */}
                {showFilters && (
                  <div className="glass-panel p-3.5 mb-3.5 bg-[rgba(255,255,255,0.01)] border-[rgba(255,255,255,0.08)] rounded-[10px] flex flex-col gap-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[0.7rem] text-text-secondary">Target Camera Stream</label>
                        <select
                          value={filterStreamId}
                          onChange={(e) => setFilterStreamId(e.target.value)}
                          className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
                        >
                          <option value="">All Streams</option>
                          {streams.map((s) => (
                            <option key={s.streamId} value={s.streamId}>
                              {s.name}
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
                    {(filterStartTime || filterEndTime || filterStreamId) && (
                      <button
                        type="button"
                        onClick={() => {
                          setFilterStartTime('');
                          setFilterEndTime('');
                          setFilterStreamId('');
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

                        {/* Cited REID detections when assistant responds */}
                        {chat.role === 'assistant' && chat.reidDetections && chat.reidDetections.length > 0 && (
                          <div className="mt-2 w-full flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5 text-[0.75rem] text-text-muted">
                              <Fingerprint size={12} color="var(--color-secondary)" />
                              <span>Cited REID Detections:</span>
                            </div>
                            <div className="flex gap-2.5 overflow-x-auto pb-2 w-full scroll-smooth">
                              {chat.reidDetections.map((det, dIdx) => {
                                const imageUrl = `${API_BASE}/crops/${det.filename}`;
                                return (
                                  <div
                                    key={dIdx}
                                    className="glass-panel shrink-0 w-[160px] p-2 rounded-[10px] border border-[rgba(255,255,255,0.06)] bg-[rgba(15,23,42,0.6)]"
                                  >
                                    <div className="w-full h-[100px] bg-[#020617] rounded-md overflow-hidden relative border border-[rgba(255,255,255,0.05)] mb-1.5">
                                      <img
                                        src={imageUrl}
                                        alt={`Track ${det.trackId}`}
                                        className="w-full h-full object-cover"
                                      />
                                      <div className="absolute bottom-1 right-1 text-[0.6rem] bg-black/60 text-white px-1.5 py-0.5 rounded font-mono">
                                        ID:{det.trackId}
                                      </div>
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                      <span
                                        title={det.cameraName}
                                        className="text-[0.72rem] font-semibold text-text-primary overflow-hidden text-ellipsis whitespace-nowrap"
                                      >
                                        {det.cameraName}
                                      </span>
                                      <div className="flex justify-between items-center">
                                        <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded capitalize ${
                                          det.className === 'vehicle'
                                            ? 'bg-[rgba(6,182,212,0.15)] text-[#06b6d4]'
                                            : 'bg-[rgba(124,58,237,0.15)] text-[#a78bfa]'
                                        }`}>
                                          {det.className}
                                        </span>
                                        <span className="text-[0.6rem] text-text-muted">
                                          {new Date(det.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </span>
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
                      <RefreshCw size={12} className="animate-spin" /> Searching clips and REID detections...
                    </div>
                  )}
                </div>

                {/* Question query input */}
                <form onSubmit={handleAskQuestion} className="flex gap-2">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ask about recordings or detected persons — e.g., 'How many people were seen today?' or 'Was anyone detected after 9pm?'"
                    className="flex-1"
                    disabled={isAsking}
                  />
                  <button type="submit" className="btn btn-primary py-2.5 px-3.5" disabled={isAsking}>
                    <Send size={16} />
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[984px]">
              {/* LEFT: Recent Face Crops Gallery */}
              <div className="glass-panel p-5 flex flex-col h-full">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-[1.1rem] flex items-center gap-2">
                    <Fingerprint size={18} color="var(--color-primary)" /> Stabilized Person Crops
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setMergeMode(!mergeMode);
                        setMergeSelection([]);
                      }}
                      className={`btn py-1 px-2 text-[0.75rem] rounded-md ${mergeMode ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      <Users size={12} /> {mergeMode ? 'Cancel Link' : 'Link Same Person'}
                    </button>
                    {mergeMode && mergeSelection.length >= 2 && (
                      <button
                        onClick={handleMergeIdentities}
                        className="btn btn-primary py-1 px-2 text-[0.75rem] rounded-md"
                      >
                        Merge {mergeSelection.length}
                      </button>
                    )}
                    <button
                      onClick={fetchReidCrops}
                      className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md"
                      disabled={loadingReidCrops}
                    >
                      <RefreshCw size={12} className={loadingReidCrops ? 'animate-spin' : ''} /> Refresh
                    </button>
                  </div>
                </div>

                {mergeMode && (
                  <p className="text-[0.75rem] text-text-muted mb-3">
                    Select 2 or more crops that belong to the same person, then click Merge.
                  </p>
                )}

                <div className="flex-1 overflow-y-auto pr-1">
                  {reidCrops.length === 0 ? (
                    <div className="h-full flex flex-col justify-center items-center text-text-muted text-[0.85rem] py-12">
                      <Fingerprint size={32} className="mb-2" />
                      <span>No stabilized person crops found.</span>
                      <span className="text-[0.75rem] mt-1 text-center max-w-[240px]">Once a person stands visible for &gt;1s, their crop will appear here.</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {reidCrops.map((crop) => {
                        const isSelected = selectedReidCrop?.id === crop.id;
                        const isMergeSelected = mergeSelection.includes(crop.id);
                        const imageUrl = `${API_BASE}/crops/${crop.filename}`;

                        return (
                          <div
                            key={crop.id}
                            onClick={() => handleGalleryCropClick(crop)}
                            className={`glass-panel interactive ${isSelected && !mergeMode ? 'active border-primary bg-[rgba(124,58,237,0.1)]' : isMergeSelected ? 'border-secondary bg-[rgba(6,182,212,0.1)]' : 'border-border-glass'} p-2 rounded-[10px] cursor-pointer flex flex-col gap-2 relative`}
                          >
                            <div className="w-full aspect-square bg-black rounded-lg overflow-hidden border border-[rgba(255,255,255,0.05)] relative">
                              <img src={imageUrl} alt="Person crop" className="w-full h-full object-cover" />
                              <div className="absolute bottom-1 right-1 text-[0.65rem] bg-black/60 text-white px-1.5 py-0.5 rounded font-mono">
                                ID:{crop.trackId}
                              </div>
                              {crop.identityId && (
                                <div className="absolute top-1 left-1 text-[0.6rem] bg-secondary/80 text-white px-1.5 py-0.5 rounded font-bold">
                                  Person
                                </div>
                              )}
                              {isMergeSelected && (
                                <div className="absolute inset-0 bg-secondary/20 border-2 border-secondary rounded-lg" />
                              )}
                            </div>

                            <div className="flex flex-col min-w-0">
                              <div className="text-[0.8rem] font-bold text-text-primary truncate">{crop.cameraName}</div>
                              <div className="text-[0.65rem] text-text-muted truncate">
                                {new Date(crop.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </div>
                            </div>

                            {!mergeMode && (
                              <button
                                onClick={(e) => handleDeleteReidDetection(crop.id, e)}
                                className="absolute top-1 right-1 p-1 bg-black/40 text-text-muted hover:text-danger rounded border-none hover:bg-black/80"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT: Timeline Matches & Camera Topology */}
              <div className="flex flex-col gap-6 h-full">
                {/* TOP: Journey Timeline */}
                <div className="glass-panel p-5 flex flex-col h-[580px]">
                  <h2 className="text-[1.1rem] flex items-center gap-2 mb-4">
                    <Map size={18} color="var(--color-primary)" /> Cross-Camera Matching Journey
                  </h2>

                  <div className="flex-1 overflow-y-auto pr-1">
                    {isReidSearching ? (
                      <div className="h-full flex flex-col justify-center items-center text-text-muted">
                        <RefreshCw size={24} className="animate-spin mb-2" />
                        <span>Computing topology weights and cosine distance...</span>
                      </div>
                    ) : selectedReidCrop ? (
                      <div className="flex flex-col gap-4">
                        {/* Query Node */}
                        <div className="bg-[rgba(124,58,237,0.05)] border border-primary/20 rounded-xl p-3.5 flex gap-4 items-center">
                          <img
                            src={`${API_BASE}/crops/${selectedReidCrop.filename}`}
                            alt="Query face"
                            className="w-14 h-14 rounded-lg object-cover border border-primary/30 bg-black shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="text-[0.65rem] text-primary uppercase font-bold tracking-wider">Search Query Target</span>
                            <h3 className="text-[0.85rem] font-bold text-text-primary break-all">{selectedReidCrop.cameraName}</h3>
                            <span className="text-[0.7rem] text-text-muted flex items-center gap-1">
                              <Clock size={12} /> {new Date(selectedReidCrop.timestamp).toLocaleString()}
                            </span>
                            {selectedReidCrop.identityId && (
                              <span className="text-[0.65rem] text-secondary font-medium mt-0.5 inline-block">
                                Linked identity — feedback will improve future matches
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Connection Timeline path */}
                        {reidMatches.length === 0 ? (
                          <div className="text-center text-text-muted text-[0.8rem] py-8 border border-dashed border-border-glass rounded-xl mt-4">
                            No valid cross-camera matches found matching travel constraints.
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1 mt-2">
                            <h4 className="text-[0.75rem] font-bold text-text-secondary uppercase tracking-wider mb-2">Likely Transitions & Timeline</h4>

                            <div className="relative border-l-2 border-primary/25 ml-7 pl-6 flex flex-col gap-6">
                              {reidMatches.map((match) => {
                                const matchPercentage = Math.round(match.scores.finalScore * 100);
                                const confirmKey = `confirm:${selectedReidCrop.id}:${match.id}`;
                                const rejectKey = `reject:${selectedReidCrop.id}:${match.id}`;
                                const isConfirmPending = feedbackPending === confirmKey;
                                const isRejectPending = feedbackPending === rejectKey;

                                const currentT = new Date(match.timestamp).getTime();
                                const queryT = new Date(selectedReidCrop.timestamp).getTime();
                                const diffSec = Math.abs(currentT - queryT) / 1000;
                                const delayStr = diffSec < 60
                                  ? `${Math.round(diffSec)}s`
                                  : `${Math.floor(diffSec / 60)}m ${Math.round(diffSec % 60)}s`;

                                return (
                                  <div key={match.id} className="relative">
                                    <div className="absolute -left-[31px] top-4 bg-primary border-2 border-[#090d16] w-4 h-4 rounded-full flex items-center justify-center shadow-[0_0_8px_rgba(124,58,237,0.6)]" />

                                    <div className="glass-panel p-3.5 flex gap-4 items-center bg-[rgba(255,255,255,0.02)] border-border-glass rounded-xl relative hover:border-primary/30 transition-all duration-200">
                                      <img
                                        src={`${API_BASE}/crops/${match.filename}`}
                                        alt="Match face"
                                        className="w-12 h-12 rounded-lg object-cover border border-[rgba(255,255,255,0.05)] bg-black shrink-0"
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex justify-between items-start flex-wrap gap-1 mb-0.5">
                                          <span className="text-[0.85rem] font-bold text-text-primary">{match.cameraName}</span>
                                          <span className="text-[0.75rem] font-extrabold text-[#06b6d4] bg-[rgba(6,182,212,0.1)] px-2 py-0.5 rounded whitespace-nowrap">
                                            {matchPercentage}% Match
                                          </span>
                                        </div>

                                        <div className="text-[0.7rem] text-text-muted flex justify-between items-center flex-wrap gap-2">
                                          <span className="flex items-center gap-1">
                                            <Clock size={11} /> {new Date(match.timestamp).toLocaleTimeString()}
                                          </span>
                                          <span className="text-secondary font-medium">
                                            {delayStr} diff
                                          </span>
                                        </div>

                                        <div className="flex gap-2.5 mt-1.5 flex-wrap text-[0.65rem] text-text-muted">
                                          <span>Vec: {Math.round(match.scores.vectorSimilarity * 100)}%</span>
                                          <span>•</span>
                                          <span>Time: {Math.round(match.scores.timeScore * 100)}%</span>
                                          <span>•</span>
                                          <span>Topo: {Math.round(match.scores.topologyScore * 100)}%</span>
                                          {match.feedbackBoost && (
                                            <>
                                              <span>•</span>
                                              <span className="text-primary">Feedback +{Math.round(match.feedbackBoost * 100)}%</span>
                                            </>
                                          )}
                                        </div>

                                        <div className="flex gap-2 mt-2">
                                          <button
                                            onClick={() => handleReidFeedback('confirm', selectedReidCrop.id, match.id)}
                                            disabled={!!feedbackPending}
                                            className="btn btn-secondary py-0.5 px-2 text-[0.65rem] rounded flex items-center gap-1 border-none hover:text-green-400"
                                            title="Correct match — same person"
                                          >
                                            <ThumbsUp size={11} className={isConfirmPending ? 'animate-pulse' : ''} /> Correct
                                          </button>
                                          <button
                                            onClick={() => handleReidFeedback('reject', selectedReidCrop.id, match.id)}
                                            disabled={!!feedbackPending}
                                            className="btn btn-secondary py-0.5 px-2 text-[0.65rem] rounded flex items-center gap-1 border-none hover:text-danger"
                                            title="Incorrect match — not the same person"
                                          >
                                            <ThumbsDown size={11} className={isRejectPending ? 'animate-pulse' : ''} /> Wrong
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-full flex flex-col justify-center items-center text-text-muted text-center p-5">
                        <Fingerprint size={32} className="mb-2.5 mx-auto" />
                        <p className="text-[0.85rem] font-semibold font-sans">No Target Selected</p>
                        <p className="text-[0.75rem] mt-1 max-w-[220px]">Select any stabilized face crop from the gallery on the left to track them across all cameras.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* BOTTOM: Camera Topology Manager */}
                <div className="glass-panel p-5 flex flex-col h-[380px]">
                  <h2 className="text-[1.1rem] flex items-center gap-2 mb-3">
                    <Network size={18} color="var(--color-secondary)" /> Camera Topology Links & Constraints
                  </h2>

                  <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
                    {/* Left: Form */}
                    <form onSubmit={handleAddTopology} className="flex flex-col gap-2.5 md:w-[220px] shrink-0">
                      <div className="flex flex-col gap-1">
                        <label className="text-[0.7rem] text-text-secondary">Source Camera Stream</label>
                        <select
                          value={newRoute.fromCamera}
                          onChange={(e) => setNewRoute({ ...newRoute, fromCamera: e.target.value })}
                          required
                          className="text-[0.75rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[30px]"
                        >
                          <option value="">Select Stream</option>
                          {streams.map((s) => (
                            <option key={s.streamId} value={s.name}>{s.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[0.7rem] text-text-secondary">Target Camera Stream</label>
                        <select
                          value={newRoute.toCamera}
                          onChange={(e) => setNewRoute({ ...newRoute, toCamera: e.target.value })}
                          required
                          className="text-[0.75rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[30px]"
                        >
                          <option value="">Select Stream</option>
                          {streams.map((s) => (
                            <option key={s.streamId} value={s.name}>{s.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-[0.7rem] text-text-secondary">Min Sec</label>
                          <input
                            type="number"
                            min="0"
                            value={newRoute.minTimeSeconds}
                            onChange={(e) => setNewRoute({ ...newRoute, minTimeSeconds: parseFloat(e.target.value) })}
                            required
                            className="text-[0.75rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[30px]"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[0.7rem] text-text-secondary">Max Sec</label>
                          <input
                            type="number"
                            min="0"
                            value={newRoute.maxTimeSeconds}
                            onChange={(e) => setNewRoute({ ...newRoute, maxTimeSeconds: parseFloat(e.target.value) })}
                            required
                            className="text-[0.75rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[30px]"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[0.7rem] text-text-secondary">Topology Score (0.1 - 1.0)</label>
                        <input
                          type="number"
                          min="0.1"
                          max="1.0"
                          step="0.1"
                          value={newRoute.topologyScore}
                          onChange={(e) => setNewRoute({ ...newRoute, topologyScore: parseFloat(e.target.value) })}
                          required
                          className="text-[0.75rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[30px]"
                        />
                      </div>

                      <button type="submit" className="btn btn-primary text-[0.75rem] py-1.5 px-3 rounded mt-1 shadow-none">
                        Save Link Rule
                      </button>
                    </form>

                    {/* Right: List */}
                    <div className="flex-1 overflow-y-auto pr-1">
                      {topologyRoutes.length === 0 ? (
                        <div className="h-full flex justify-center items-center text-text-muted text-[0.8rem] border border-dashed border-border-glass rounded-xl p-4 text-center">
                          No links configured. Define adjacent cameras and expected travel times on the left.
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          {topologyRoutes.map((r, rIdx) => (
                            <div key={rIdx} className="glass-panel p-2 px-3 bg-[rgba(255,255,255,0.01)] border-border-glass rounded-lg flex items-center justify-between text-[0.75rem]">
                              <div className="min-w-0 flex-1">
                                <div className="font-semibold text-text-primary flex items-center gap-1.5">
                                  <span>{r.fromCamera}</span>
                                  <span className="text-text-muted">↔</span>
                                  <span>{r.toCamera}</span>
                                </div>
                                <div className="text-text-secondary mt-0.5 text-[0.7rem]">
                                  Transition: {r.minTimeSeconds}s - {r.maxTimeSeconds}s • Weight: {r.topologyScore}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>


      </div>

      {/* DEVICE LOGS MODAL */}
      {deviceLogsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: 'blur(6px)', background: 'rgba(9,13,22,0.75)' }}
          onClick={closeDeviceLogsModal}
        >
          <div
            className="glass-panel w-full max-w-[720px] p-6 flex flex-col gap-4 relative animate-[slideUp_0.22s_ease-out] max-h-[85vh]"
            style={{ boxShadow: '0 24px 80px rgba(124,58,237,0.25), 0 0 0 1px rgba(124,58,237,0.2)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-[rgba(124,58,237,0.15)] p-2 rounded-lg">
                  <ScrollText size={18} color="var(--color-primary)" />
                </div>
                <div>
                  <h2 className="text-[1.05rem] font-bold text-text-primary">
                    Device Logs — {deviceLogsModal.name}
                  </h2>
                  <p className="text-[0.72rem] text-text-muted mt-0.5">{deviceLogsModal.deviceId}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchJournalLogs(deviceLogsModal.deviceId)}
                  disabled={loadingJournalLogs}
                  className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md flex items-center gap-1"
                >
                  <RefreshCw size={12} className={loadingJournalLogs ? 'animate-spin' : ''} />
                  Refresh Journal
                </button>
                <button
                  onClick={closeDeviceLogsModal}
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
                  {loadingJournalLogs ? (
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
                  ref={deviceLogsContainerRef}
                  className="font-mono bg-[rgba(0,0,0,0.5)] rounded-lg p-3 text-[0.75rem] leading-[1.4] text-[#38bdf8] flex-1 min-h-[140px] max-h-[220px] overflow-y-auto border border-[rgba(255,255,255,0.05)]"
                >
                  {deviceLogs.length === 0 ? (
                    <span className="text-text-muted">Waiting for live log events from device...</span>
                  ) : (
                    deviceLogs.map((log, index) => (
                      <div key={index} className="mb-1">
                        <span className="text-text-muted mr-2">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                        <span>{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STREAM CONFIG DIALOG MODAL */}
      {/* STREAM CONFIG DIALOG MODAL — handles both Add and Edit modes */}
      {showConfigDialog && (() => {
        const isAddMode = !!addingStreamForDeviceId;
        const configStream = !isAddMode ? streams.find(s => s.streamId === selectedStreamId) : null;

        const closeDialog = () => {
          setShowConfigDialog(false);
          setAddingStreamForDeviceId(null);
        };

        const handleSubmit = async (e: React.FormEvent) => {
          e.preventDefault();
          if (!config.detectPerson && !config.detectVehicle) {
            alert('Select at least one detection target: Person or Vehicle.');
            return;
          }
          if (isAddMode) {
            // CREATE new stream
            try {
              const res = await fetch(`${API_BASE}/streams`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  deviceId: addingStreamForDeviceId,
                  name: config.name,
                  cameraType: config.type,
                  streamUrl: config.streamUrl,
                  trackingEnabled: config.trackingEnabled,
                  motionThreshold: config.motionThreshold ?? 25,
                  pixelChangeThreshold: config.pixelChangeThreshold ?? 0.02,
                  detectPerson: config.detectPerson,
                  detectVehicle: config.detectVehicle,
                }),
              });
              if (res.ok) {
                const newStream = await res.json();
                await fetchDevices();
                setSelectedStreamId(newStream.streamId);
                closeDialog();
              }
            } catch (err) {
              console.error('Failed to create stream', err);
            }
          } else {
            // UPDATE existing stream
            await handleConfigSubmit(e);
            closeDialog();
          }
        };

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backdropFilter: 'blur(6px)', background: 'rgba(9,13,22,0.75)' }}
            onClick={closeDialog}
          >
            <div
              className="glass-panel w-full max-w-[480px] p-6 flex flex-col gap-5 relative animate-[slideUp_0.22s_ease-out]"
              style={{ boxShadow: '0 24px 80px rgba(124,58,237,0.25), 0 0 0 1px rgba(124,58,237,0.2)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-[rgba(124,58,237,0.15)] p-2 rounded-lg">
                    {isAddMode ? <Plus size={18} color="var(--color-primary)" /> : <Settings size={18} color="var(--color-primary)" />}
                  </div>
                  <div>
                    <h2 className="text-[1.05rem] font-bold text-text-primary">
                      {isAddMode ? 'Add Camera Stream' : 'Configure Stream'}
                    </h2>
                    {configStream && (
                      <p className="text-[0.72rem] text-text-muted mt-0.5">{configStream.name}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={closeDialog}
                  className="btn p-1.5 bg-transparent text-text-muted hover:text-text-primary border-none rounded-lg hover:bg-[rgba(255,255,255,0.06)]"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Divider */}
              <div className="h-px bg-[rgba(255,255,255,0.07)]" />

              {/* Config Form */}
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[0.78rem] text-text-secondary font-medium">Camera Name</label>
                    <input
                      type="text"
                      value={config.name}
                      onChange={(e) => setConfig({ ...config, name: e.target.value })}
                      placeholder="E.g., Office Entry"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[0.78rem] text-text-secondary font-medium">Source Type</label>
                    <select
                      value={config.type}
                      onChange={(e) => setConfig({ ...config, type: e.target.value as 'webcam' | 'rtsp' })}
                    >
                      <option value="webcam">Local Camera / Webcam</option>
                      <option value="rtsp">RTSP Network Stream</option>
                    </select>
                  </div>
                </div>

                {config.type === 'rtsp' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[0.78rem] text-text-secondary font-medium">RTSP Stream URL</label>
                    <input
                      type="text"
                      value={config.streamUrl}
                      onChange={(e) => setConfig({ ...config, streamUrl: e.target.value })}
                      placeholder="rtsp://username:password@ip:port/h264"
                      required
                    />
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <label className="text-[0.78rem] text-text-secondary font-medium">Detect Objects</label>
                  <div className="flex gap-5">
                    <label className="flex items-center gap-2 text-[0.85rem] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={config.detectPerson}
                        onChange={(e) => setConfig({ ...config, detectPerson: e.target.checked })}
                        className="w-4 h-4 accent-[#a78bfa]"
                      />
                      Person
                    </label>
                    <label className="flex items-center gap-2 text-[0.85rem] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={config.detectVehicle}
                        onChange={(e) => setConfig({ ...config, detectVehicle: e.target.checked })}
                        className="w-4 h-4 accent-[#a78bfa]"
                      />
                      Vehicle
                    </label>
                  </div>
                  <p className="text-[0.72rem] text-text-muted leading-relaxed">
                    Vehicle includes cars, trucks, buses, motorcycles, and bicycles.
                  </p>
                </div>

                {/* Footer Actions */}
                <div className="flex gap-2.5 justify-end pt-1">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="btn btn-secondary py-2 px-4 text-[0.85rem]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary py-2 px-5 text-[0.85rem]"
                  >
                    {isAddMode ? 'Create Stream' : 'Apply Configuration'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default App;
