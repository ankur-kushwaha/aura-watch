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
  Users,
  ArrowLeft,
  UserCircle
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

interface ReidPerson {
  id: string;
  label?: string | null;
  displayName: string;
  coverFilename: string | null;
  coverCameraName: string | null;
  photoCount: number;
  galleryCount?: number;
  lastSeen: string | null;
  streamTracks: { streamId: string; trackId: number; cameraName: string; cropCount: number }[];
}

interface ReidPersonMatch {
  id: string;
  label?: string | null;
  displayName: string;
  coverFilename: string | null;
  photoCount: number;
  matchScore: number;
  streamTracks: { streamId: string; trackId: number }[];
}

interface ReidDetection {
  id: string;
  deviceId: string;
  cameraName: string;
  streamId?: string;
  trackId: number;
  timestamp: string;
  filename: string;
  clipFilename?: string | null;
  clipOffsetMs?: number | null;
  bbox: string;
  className: string;
  identityId?: string | null;
  identity?: { id: string; label?: string | null; galleryCount?: number; centroidUpdatedAt?: string | null } | null;
}

interface TimelineVideoPlayback {
  filename: string;
  offsetMs: number;
  cameraName: string;
  cropFilename: string;
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
  const [reidPeople, setReidPeople] = useState<ReidPerson[]>([]);
  const [loadingReidPeople, setLoadingReidPeople] = useState<boolean>(false);
  const [reidView, setReidView] = useState<'people' | 'person'>('people');
  const [selectedPerson, setSelectedPerson] = useState<ReidPerson | null>(null);
  const [personTimeline, setPersonTimeline] = useState<ReidDetection[]>([]);
  const [personSuggestions, setPersonSuggestions] = useState<ReidPersonMatch[]>([]);
  const [loadingPersonDetail, setLoadingPersonDetail] = useState<boolean>(false);
  const [linkPeopleMode, setLinkPeopleMode] = useState<boolean>(false);
  const [linkPeopleSelection, setLinkPeopleSelection] = useState<string[]>([]);
  const [identityLabelDraft, setIdentityLabelDraft] = useState<string>('');
  const [savingIdentityLabel, setSavingIdentityLabel] = useState<boolean>(false);
  const [feedbackPending, setFeedbackPending] = useState<string | null>(null);
  const [showTopology, setShowTopology] = useState<boolean>(false);
  const [reidRefreshNonce, setReidRefreshNonce] = useState<number>(0);
  const [timelineVideo, setTimelineVideo] = useState<TimelineVideoPlayback | null>(null);
  const [timelineClipLoading, setTimelineClipLoading] = useState<string | null>(null);
  const [showIdentitySuggestions, setShowIdentitySuggestions] = useState<boolean>(false);
  const timelineVideoRef = useRef<HTMLVideoElement>(null);

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
          setReidRefreshNonce((n) => n + 1);
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

  const fetchReidPeople = useCallback(async () => {
    setLoadingReidPeople(true);
    try {
      const res = await fetch(`${API_BASE}/reid/people`);
      const data = await res.json();
      setReidPeople(data);
    } catch (err) {
      console.error('Failed to fetch ReID people', err);
    } finally {
      setLoadingReidPeople(false);
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

  const openPersonDetail = async (person: ReidPerson) => {
    setSelectedPerson(person);
    setReidView('person');
    setIdentityLabelDraft(person.label || '');
    setShowIdentitySuggestions(!person.label?.trim());
    setLoadingPersonDetail(true);
    try {
      const [journeyRes, matchesRes] = await Promise.all([
        fetch(`${API_BASE}/reid/identities/${person.id}/journey`),
        fetch(`${API_BASE}/reid/identities/${person.id}/matches`),
      ]);
      const journey = await journeyRes.json();
      const matches = await matchesRes.json();
      setPersonTimeline(journey.detections || []);
      setPersonSuggestions(matches || []);
      if (journey.identity) {
        setSelectedPerson(prev => prev ? {
          ...prev,
          label: journey.identity.label,
          displayName: journey.identity.label || prev.displayName,
          photoCount: journey.detections?.length ?? prev.photoCount,
        } : null);
        setIdentityLabelDraft(journey.identity.label || '');
      }
    } catch (err) {
      console.error('Failed to load person detail', err);
    } finally {
      setLoadingPersonDetail(false);
    }
  };

  const closePersonDetail = () => {
    setReidView('people');
    setSelectedPerson(null);
    setPersonTimeline([]);
    setPersonSuggestions([]);
    setTimelineVideo(null);
    setShowIdentitySuggestions(false);
    fetchReidPeople();
  };

  const playTimelineCrop = async (crop: ReidDetection) => {
    setTimelineClipLoading(crop.id);
    try {
      let clipFilename = crop.clipFilename;
      let clipOffsetMs = crop.clipOffsetMs ?? 0;

      if (!clipFilename) {
        const res = await fetch(`${API_BASE}/reid/detections/${crop.id}/source-clip`);
        if (!res.ok) {
          alert('No video clip found for this detection.');
          return;
        }
        const data = await res.json();
        clipFilename = data.clipFilename;
        clipOffsetMs = data.clipOffsetMs ?? 0;
        setPersonTimeline((prev) =>
          prev.map((d) =>
            d.id === crop.id ? { ...d, clipFilename, clipOffsetMs } : d,
          ),
        );
      }

      setTimelineVideo({
        filename: clipFilename!,
        offsetMs: clipOffsetMs,
        cameraName: crop.cameraName,
        cropFilename: crop.filename,
      });
    } catch (err) {
      console.error('Failed to resolve clip for detection', err);
      alert('Could not load video for this detection.');
    } finally {
      setTimelineClipLoading(null);
    }
  };

  const handleSavePersonLabel = async () => {
    if (!selectedPerson) return;
    setSavingIdentityLabel(true);
    try {
      const res = await fetch(`${API_BASE}/reid/identities/${selectedPerson.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: identityLabelDraft }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to save label');
        return;
      }
      const newLabel = data.identity?.label || identityLabelDraft;
      setSelectedPerson(prev => prev ? {
        ...prev,
        label: newLabel,
        displayName: newLabel || prev.displayName,
      } : null);
      if (newLabel?.trim()) {
        setShowIdentitySuggestions(false);
      }
      await fetchReidPeople();
    } catch (err) {
      console.error('Failed to save person label', err);
    } finally {
      setSavingIdentityLabel(false);
    }
  };

  const handleStreamTrackFeedback = async (
    type: 'same_person' | 'different_person',
    sourceStreamId: string,
    sourceTrackId: number,
    targetStreamId: string,
    targetTrackId: number,
  ) => {
    const key = `${type}:${sourceStreamId}:${sourceTrackId}:${targetStreamId}:${targetTrackId}`;
    setFeedbackPending(key);
    try {
      const res = await fetch(`${API_BASE}/reid/feedback/stream-track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, sourceStreamId, sourceTrackId, targetStreamId, targetTrackId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to save feedback');
        return;
      }
      await fetchReidPeople();
      if (selectedPerson) {
        const updated = reidPeople.find(p => p.id === selectedPerson.id)
          || (data.identityId ? { ...selectedPerson, id: data.identityId } : selectedPerson);
        await openPersonDetail(updated);
      }
    } catch (err) {
      console.error('Failed to submit stream-track feedback', err);
    } finally {
      setFeedbackPending(null);
    }
  };

  const handleLinkPeopleSelection = (personId: string) => {
    setLinkPeopleSelection(prev => {
      if (prev.includes(personId)) return prev.filter(id => id !== personId);
      if (prev.length >= 2) return [prev[1], personId];
      return [...prev, personId];
    });
  };

  const handleLinkPeople = async () => {
    if (linkPeopleSelection.length !== 2) {
      alert('Select exactly 2 people to link.');
      return;
    }
    try {
      const [idA, idB] = linkPeopleSelection;
      const [jA, jB] = await Promise.all([
        fetch(`${API_BASE}/reid/identities/${idA}/journey`).then(r => r.json()),
        fetch(`${API_BASE}/reid/identities/${idB}/journey`).then(r => r.json()),
      ]);
      const detA = jA.detections?.[0]?.id;
      const detB = jB.detections?.[0]?.id;
      if (!detA || !detB) {
        alert('Could not find crops to link.');
        return;
      }
      const res = await fetch(`${API_BASE}/reid/identities/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detectionIds: [detA, detB] }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to link people');
        return;
      }
      setLinkPeopleSelection([]);
      setLinkPeopleMode(false);
      await fetchReidPeople();
    } catch (err) {
      console.error('Failed to link people', err);
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

  useEffect(() => {
    if (activeTab === 'reid') {
      fetchReidPeople();
      fetchTopology();
    }
  }, [activeTab, fetchReidPeople, fetchTopology]);

  useEffect(() => {
    if (activeTab === 'reid' && reidRefreshNonce > 0) {
      fetchReidPeople();
      if (reidView === 'person' && selectedPerson) {
        openPersonDetail(selectedPerson);
      }
    }
  }, [reidRefreshNonce]);

  useEffect(() => {
    const video = timelineVideoRef.current;
    if (!video || !timelineVideo) return;

    const seekToOffset = () => {
      video.currentTime = Math.max(0, timelineVideo.offsetMs / 1000);
    };

    video.addEventListener('loadedmetadata', seekToOffset);
    if (video.readyState >= 1) {
      seekToOffset();
    }

    return () => video.removeEventListener('loadedmetadata', seekToOffset);
  }, [timelineVideo]);

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
        `Update "${deviceName}"?\n\nThis will git pull, refresh dependencies and the systemd service, then restart the edge agent.`
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
            <p className="text-[0.8rem] text-text-muted">Smart surveillance — see everything, ask anything</p>
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
                          title="Run git pull on the edge device"
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
          ) : reidView === 'people' ? (
            <div className="flex flex-col gap-6 h-[984px]">
              <div className="glass-panel p-5 flex flex-col flex-1 min-h-0">
                <div className="flex justify-between items-center mb-5">
                  <h2 className="text-[1.1rem] flex items-center gap-2">
                    <UserCircle size={20} color="var(--color-primary)" /> People
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setLinkPeopleMode(!linkPeopleMode);
                        setLinkPeopleSelection([]);
                      }}
                      className={`btn py-1 px-2 text-[0.75rem] rounded-md ${linkPeopleMode ? 'btn-primary' : 'btn-secondary'}`}
                    >
                      <Users size={12} /> {linkPeopleMode ? 'Cancel' : 'Link People'}
                    </button>
                    {linkPeopleMode && linkPeopleSelection.length === 2 && (
                      <button onClick={handleLinkPeople} className="btn btn-primary py-1 px-2 text-[0.75rem] rounded-md">
                        Merge 2 people
                      </button>
                    )}
                    <button
                      onClick={() => setShowTopology(!showTopology)}
                      className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md"
                    >
                      <Network size={12} /> Topology
                    </button>
                    <button
                      onClick={fetchReidPeople}
                      className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md"
                      disabled={loadingReidPeople}
                    >
                      <RefreshCw size={12} className={loadingReidPeople ? 'animate-spin' : ''} /> Refresh
                    </button>
                  </div>
                </div>

                {linkPeopleMode && (
                  <p className="text-[0.75rem] text-text-muted mb-4">
                    Select 2 people that are the same person.
                    {linkPeopleSelection.length > 0 && (
                      <span className="text-secondary font-semibold ml-1">{linkPeopleSelection.length} selected</span>
                    )}
                  </p>
                )}

                <div className="flex-1 overflow-y-auto pr-1">
                  {loadingReidPeople && reidPeople.length === 0 ? (
                    <div className="h-full flex flex-col justify-center items-center text-text-muted">
                      <RefreshCw size={24} className="animate-spin mb-2" />
                      <span>Loading people...</span>
                    </div>
                  ) : reidPeople.length === 0 ? (
                    <div className="h-full flex flex-col justify-center items-center text-text-muted text-[0.85rem] py-12">
                      <UserCircle size={40} className="mb-3 opacity-50" />
                      <span>No people detected yet.</span>
                      <span className="text-[0.75rem] mt-1 text-center max-w-[280px]">
                        Each camera track is auto-grouped. Crops appear here once a person is visible for &gt;1s.
                      </span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-6">
                      {reidPeople.map((person) => {
                        const isLinkSelected = linkPeopleSelection.includes(person.id);
                        const coverUrl = person.coverFilename
                          ? `${API_BASE}/crops/${person.coverFilename}`
                          : null;

                        return (
                          <button
                            key={person.id}
                            type="button"
                            onClick={() => linkPeopleMode
                              ? handleLinkPeopleSelection(person.id)
                              : openPersonDetail(person)}
                            className={`flex flex-col items-center gap-2 group border-none bg-transparent p-0 cursor-pointer ${isLinkSelected ? 'opacity-100' : ''}`}
                          >
                            <div className={`relative w-[88px] h-[88px] rounded-full overflow-hidden border-2 transition-all duration-200 ${
                              isLinkSelected
                                ? 'border-secondary shadow-[0_0_12px_rgba(6,182,212,0.5)]'
                                : 'border-[rgba(255,255,255,0.1)] group-hover:border-primary/50 group-hover:shadow-[0_0_12px_rgba(124,58,237,0.3)]'
                            }`}>
                              {coverUrl ? (
                                <img src={coverUrl} alt={person.displayName} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center">
                                  <UserCircle size={32} className="text-text-muted" />
                                </div>
                              )}
                              {person.photoCount > 1 && (
                                <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[0.6rem] text-white text-center py-0.5">
                                  {person.photoCount}
                                </div>
                              )}
                            </div>
                            <span className="text-[0.72rem] font-semibold text-text-primary text-center max-w-[100px] truncate leading-tight">
                              {person.displayName}
                            </span>
                            {person.streamTracks.length > 1 ? (
                              <span className="text-[0.6rem] text-text-muted -mt-1">
                                {person.streamTracks.length} tracks
                              </span>
                            ) : person.streamTracks.length === 1 && person.label ? (
                              <span className="text-[0.6rem] text-text-muted -mt-1">
                                track {person.streamTracks[0].trackId}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {showTopology && (
                <div className="glass-panel p-5 flex flex-col h-[320px] shrink-0">
                  <h2 className="text-[1rem] flex items-center gap-2 mb-3">
                    <Network size={16} color="var(--color-secondary)" /> Camera Topology
                  </h2>
                  <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
                    <form onSubmit={handleAddTopology} className="flex flex-col gap-2 md:w-[220px] shrink-0">
                      <select
                        value={newRoute.fromCamera}
                        onChange={(e) => setNewRoute({ ...newRoute, fromCamera: e.target.value })}
                        required
                        className="text-[0.75rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary"
                      >
                        <option value="">Source camera</option>
                        {streams.map((s) => <option key={s.streamId} value={s.name}>{s.name}</option>)}
                      </select>
                      <select
                        value={newRoute.toCamera}
                        onChange={(e) => setNewRoute({ ...newRoute, toCamera: e.target.value })}
                        required
                        className="text-[0.75rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary"
                      >
                        <option value="">Target camera</option>
                        {streams.map((s) => <option key={s.streamId} value={s.name}>{s.name}</option>)}
                      </select>
                      <button type="submit" className="btn btn-primary py-1 text-[0.75rem]">Save Link Rule</button>
                    </form>
                    <div className="flex-1 overflow-y-auto">
                      {topologyRoutes.map((r, rIdx) => (
                        <div key={rIdx} className="text-[0.75rem] py-1.5 border-b border-border-glass">
                          {r.fromCamera} ↔ {r.toCamera} ({r.minTimeSeconds}s–{r.maxTimeSeconds}s)
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-5 h-[984px]">
              <div className="glass-panel p-5 flex flex-col flex-1 min-h-0">
                <div className="flex items-start gap-4 mb-5">
                  <button
                    type="button"
                    onClick={closePersonDetail}
                    className="btn btn-secondary p-2 rounded-lg shrink-0 border-none"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-primary/30 shrink-0">
                    {selectedPerson?.coverFilename && (
                      <img
                        src={`${API_BASE}/crops/${selectedPerson.coverFilename}`}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-[1.2rem] font-bold text-text-primary truncate">
                      {selectedPerson?.displayName}
                    </h2>
                    <p className="text-[0.75rem] text-text-muted mt-0.5">
                      {selectedPerson?.photoCount} photo{selectedPerson?.photoCount !== 1 ? 's' : ''}
                      {selectedPerson?.streamTracks && selectedPerson.streamTracks.length > 0 && (
                        <span> · {selectedPerson.streamTracks.length} camera track{selectedPerson.streamTracks.length !== 1 ? 's' : ''}</span>
                      )}
                    </p>
                    <div className="flex gap-2 mt-2 max-w-md">
                      <input
                        type="text"
                        value={identityLabelDraft}
                        onChange={(e) => setIdentityLabelDraft(e.target.value)}
                        placeholder="Name this person"
                        className="flex-1 text-[0.75rem] py-1.5 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary"
                      />
                      <button
                        type="button"
                        onClick={handleSavePersonLabel}
                        disabled={savingIdentityLabel}
                        className="btn btn-secondary py-1 px-3 text-[0.7rem] shrink-0"
                      >
                        {savingIdentityLabel ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>

                {selectedPerson && selectedPerson.streamTracks.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {selectedPerson.streamTracks.map((st) => (
                      <span
                        key={`${st.streamId}-${st.trackId}`}
                        className="text-[0.65rem] bg-secondary/10 text-secondary px-2 py-1 rounded-full border border-secondary/20"
                      >
                        {st.cameraName} · track {st.trackId} ({st.cropCount})
                      </span>
                    ))}
                  </div>
                )}

                {personSuggestions.length > 0 && (
                  <div className="mb-5">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <h3 className="text-[0.75rem] font-bold text-text-secondary uppercase tracking-wider">
                        Might be the same person
                      </h3>
                      {selectedPerson?.label?.trim() && !showIdentitySuggestions && (
                        <button
                          type="button"
                          onClick={() => setShowIdentitySuggestions(true)}
                          className="btn btn-secondary py-1 px-2 text-[0.7rem] rounded-md shrink-0"
                        >
                          Change selection
                        </button>
                      )}
                      {selectedPerson?.label?.trim() && showIdentitySuggestions && (
                        <button
                          type="button"
                          onClick={() => setShowIdentitySuggestions(false)}
                          className="btn btn-secondary py-1 px-2 text-[0.7rem] rounded-md shrink-0"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    {(!selectedPerson?.label?.trim() || showIdentitySuggestions) && (
                    <div className="flex gap-4 overflow-x-auto pb-2">
                      {personSuggestions.map((suggestion) => {
                        const srcTrack = selectedPerson?.streamTracks[0];
                        const tgtTrack = suggestion.streamTracks[0];
                        if (!srcTrack || !tgtTrack) return null;
                        const sameKey = `same_person:${srcTrack.streamId}:${srcTrack.trackId}:${tgtTrack.streamId}:${tgtTrack.trackId}`;
                        const diffKey = `different_person:${srcTrack.streamId}:${srcTrack.trackId}:${tgtTrack.streamId}:${tgtTrack.trackId}`;

                        return (
                          <div key={suggestion.id} className="glass-panel p-3 rounded-xl shrink-0 w-[160px] flex flex-col items-center gap-2">
                            <div className="w-14 h-14 rounded-full overflow-hidden border border-border-glass">
                              {suggestion.coverFilename && (
                                <img
                                  src={`${API_BASE}/crops/${suggestion.coverFilename}`}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                            <span className="text-[0.7rem] font-semibold text-center truncate w-full">{suggestion.displayName}</span>
                            <span className="text-[0.6rem] text-secondary">{Math.round(suggestion.matchScore * 100)}% match</span>
                            <div className="flex gap-1 w-full">
                              <button
                                type="button"
                                disabled={!!feedbackPending}
                                onClick={() => handleStreamTrackFeedback('same_person', srcTrack.streamId, srcTrack.trackId, tgtTrack.streamId, tgtTrack.trackId)}
                                className="btn btn-secondary flex-1 py-0.5 text-[0.6rem] border-none hover:text-green-400"
                              >
                                <ThumbsUp size={10} className={feedbackPending === sameKey ? 'animate-pulse' : ''} />
                              </button>
                              <button
                                type="button"
                                disabled={!!feedbackPending}
                                onClick={() => handleStreamTrackFeedback('different_person', srcTrack.streamId, srcTrack.trackId, tgtTrack.streamId, tgtTrack.trackId)}
                                className="btn btn-secondary flex-1 py-0.5 text-[0.6rem] border-none hover:text-danger"
                              >
                                <ThumbsDown size={10} className={feedbackPending === diffKey ? 'animate-pulse' : ''} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                )}

                <h3 className="text-[0.75rem] font-bold text-text-secondary uppercase tracking-wider mb-3">
                  Timeline
                </h3>
                <div className="flex-1 overflow-y-auto pr-1">
                  {loadingPersonDetail ? (
                    <div className="flex justify-center py-12 text-text-muted">
                      <RefreshCw size={20} className="animate-spin" />
                    </div>
                  ) : personTimeline.length === 0 ? (
                    <p className="text-text-muted text-[0.8rem] text-center py-8">No photos in this group yet.</p>
                  ) : (
                    <div className="relative border-l-2 border-primary/25 ml-4 pl-6 flex flex-col gap-5">
                      {personTimeline.map((crop) => {
                        const isLoadingClip = timelineClipLoading === crop.id;
                        return (
                          <div key={crop.id} className="relative">
                            <div className="absolute -left-[27px] top-3 w-3 h-3 rounded-full bg-primary border-2 border-[#090d16]" />
                            <button
                              type="button"
                              onClick={() => playTimelineCrop(crop)}
                              disabled={isLoadingClip}
                              className="glass-panel p-3 flex gap-3 items-center rounded-xl w-full text-left transition-all duration-200 cursor-pointer hover:border-primary/40 hover:bg-[rgba(124,58,237,0.06)]"
                            >
                              <div className="relative w-12 h-12 shrink-0">
                                <img
                                  src={`${API_BASE}/crops/${crop.filename}`}
                                  alt=""
                                  className="w-12 h-12 rounded-lg object-cover bg-black"
                                />
                                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                                  {isLoadingClip ? (
                                    <RefreshCw size={14} className="text-white animate-spin" />
                                  ) : (
                                    <Play size={16} className="text-white" fill="white" />
                                  )}
                                </div>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[0.85rem] font-bold text-text-primary">{crop.cameraName}</div>
                                <div className="text-[0.7rem] text-text-muted flex items-center gap-2 flex-wrap">
                                  <Clock size={11} />
                                  {new Date(crop.timestamp).toLocaleString()}
                                  <span className="text-secondary">track {crop.trackId}</span>
                                  <span className="text-[#a78bfa]">tap to play clip</span>
                                </div>
                              </div>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>


      </div>

      {/* TIMELINE CLIP PLAYBACK MODAL */}
      {timelineVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: 'blur(6px)', background: 'rgba(9,13,22,0.75)' }}
          onClick={() => setTimelineVideo(null)}
        >
          <div
            className="glass-panel w-full max-w-[720px] p-5 flex flex-col gap-4 relative animate-[slideUp_0.22s_ease-out]"
            style={{ boxShadow: '0 24px 80px rgba(124,58,237,0.25), 0 0 0 1px rgba(124,58,237,0.2)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[1rem] font-bold text-text-primary">{timelineVideo.cameraName}</h2>
                <p className="text-[0.75rem] text-text-muted mt-0.5">
                  Clip playback from timeline detection
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTimelineVideo(null)}
                className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md"
              >
                Close
              </button>
            </div>
            <div className="bg-[#000] rounded-xl overflow-hidden border border-[rgba(255,255,255,0.08)]">
              <video
                ref={timelineVideoRef}
                key={timelineVideo.filename}
                src={`${API_BASE}/videos/${timelineVideo.filename}`}
                controls
                autoPlay
                className="w-full max-h-[420px] object-contain"
              />
            </div>
            <div className="flex items-center gap-3">
              <img
                src={`${API_BASE}/crops/${timelineVideo.cropFilename}`}
                alt=""
                className="w-12 h-12 rounded-lg object-cover bg-black shrink-0"
              />
              <p className="text-[0.75rem] text-text-secondary">
                Jumped to the moment this person was detected
                {timelineVideo.offsetMs > 0 ? ` (${(timelineVideo.offsetMs / 1000).toFixed(1)}s into clip)` : ''}.
              </p>
            </div>
          </div>
        </div>
      )}

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
