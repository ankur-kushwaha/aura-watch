/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Camera,
  Settings,
  Play,
  Trash2,
  Activity,
  Video,
  RefreshCw,
  Cpu,
  Clock,
  Sparkles,
  Terminal,
  SlidersHorizontal,
  Fingerprint,
  Network,
  Plus,
  X,
  Power,
  ScrollText,
  Download,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
  Users,
  ArrowLeft,
  UserCircle,
} from 'lucide-react';
import {
  apiFetch,
  getStoredOrg,
  switchOrg,
  fetchMe,
  createEnrollmentToken,
  DEFAULT_ORG_SETTINGS,
  type AuthOrg,
  type AuthUser,
  type OrgSettings,
} from '../api';
import { clearLoggedIn } from '../auth';
import { exitImpersonation, isImpersonating } from '../adminApi';
import OrgSettingsPage from '../OrgSettings';
import {
  createDefaultDeviceConfig,
  DEFAULT_STREAM_CONFIG,
  type EffectiveEdgeDeviceConfig,
} from '../edgeConfig';
import { CLIPS_PAGE_SIZE, PREVIEW_STALL_MS, REID_CROP_IMG, WS_BASE } from './constants';
import type {
  CameraConfig,
  CameraStream,
  ClipDetectionsResponse,
  ClipObjectDetection,
  ClipReidLog,
  CropClipPlayback,
  EdgeDevice,
  LogEntry,
  ReidDetection,
  ReidPerson,
  ReidPersonMatch,
  ReidRoute,
  TimelineVideoPlayback,
  VideoClip,
} from './types';
import { buildClipsQueryString, getClipDetectionCount, isEdgeUpdateAvailable } from './utils/clips';
import { formatClipDuration, formatClipListDateTime } from './utils/format';
import { identityCoverUrl, mediaUrl } from './utils/media';
import { dashboardTabFromPath } from './utils/routing';
import { DashboardHeader, DashboardPlaceholder, DeviceInstallTooltip, EntityIds } from './components';
import { ClipPreviewPanel } from './components/ClipPreviewPanel';
import {
  AskCameraAiDialog,
  CropPreviewDialog,
  DeviceConfigDialog,
  DeviceLogsDialog,
  DeviceMetricsDialog,
  MobileClipPreviewDialog,
  PersonAppearancesDialog,
  StreamConfigDialog,
  TimelineClipPlaybackDialog,
} from './components/modals';

export default function DashboardApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const appView = location.pathname.startsWith('/app/settings') ? 'settings' : 'dashboard';
  const activeTab = dashboardTabFromPath(location.pathname) ?? 'events';

  const [currentOrg, setCurrentOrg] = useState<AuthOrg | null>(() => getStoredOrg());
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [availableOrgs, setAvailableOrgs] = useState<AuthOrg[]>([]);
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [orgSettings, setOrgSettings] = useState<OrgSettings>(DEFAULT_ORG_SETTINGS);

  // App States
  const [devices, setDevices] = useState<EdgeDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState<boolean>(true);
  const [streams, setStreams] = useState<CameraStream[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedStreamId, setSelectedStreamId] = useState<string>('');
  const [showConfigDialog, setShowConfigDialog] = useState<boolean>(false);
  const [showDeviceConfigDialog, setShowDeviceConfigDialog] = useState<boolean>(false);
  const [deviceConfigDeviceId, setDeviceConfigDeviceId] = useState<string | null>(null);
  const [deviceConfig, setDeviceConfig] = useState<EffectiveEdgeDeviceConfig>(createDefaultDeviceConfig());
  const [deviceConfigName, setDeviceConfigName] = useState('');
  // When non-null, the dialog is in "add" mode and this is the target deviceId
  const [addingStreamForDeviceId, setAddingStreamForDeviceId] = useState<string | null>(null);
  const [deviceLogsDevice, setDeviceLogsDevice] = useState<{ deviceId: string; name: string } | null>(null);
  const [deviceMetricsDevice, setDeviceMetricsDevice] = useState<{ deviceId: string; name: string } | null>(null);
  const [deviceCommandPending, setDeviceCommandPending] = useState<string | null>(null);

  // ReID States
  const [reidPeople, setReidPeople] = useState<ReidPerson[]>([]);
  const [loadingReidPeople, setLoadingReidPeople] = useState<boolean>(false);
  const [brokenIdentityCovers, setBrokenIdentityCovers] = useState<Set<string>>(new Set());
  const [deletingIdentityId, setDeletingIdentityId] = useState<string | null>(null);
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

  useEffect(() => {
    fetchMe()
      .then((data) => {
        setCurrentUser(data.user);
        if (data.org) setCurrentOrg(data.org);
        setAvailableOrgs(data.orgs);
        if (data.settings) setOrgSettings(data.settings);
      })
      .catch(() => {});
  }, []);

  const handleSwitchOrg = async (orgId: string) => {
    if (orgId === currentOrg?.id) return;
    setSwitchingOrg(true);
    try {
      const org = await switchOrg(orgId);
      setCurrentOrg(org);
      window.location.reload();
    } catch (err: any) {
      alert(err.message || 'Failed to switch organization');
    } finally {
      setSwitchingOrg(false);
    }
  };

  const handleGenerateEnrollmentToken = async () => {
    const result = await createEnrollmentToken('Device install');
    return result.token;
  };

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
  const fetchClipsRef = useRef<() => Promise<void>>(async () => {});
  const streamStatusRef = useRef<string>('Offline');
  const onlineDeviceIdsRef = useRef<Set<string>>(new Set());
  const deviceLogsDeviceRef = useRef(deviceLogsDevice);
  const deviceLogSinkRef = useRef<((entry: LogEntry) => void) | null>(null);

  useEffect(() => {
    selectedStreamIdRef.current = selectedStreamId;
  }, [selectedStreamId]);

  useEffect(() => {
    deviceLogsDeviceRef.current = deviceLogsDevice;
  }, [deviceLogsDevice]);

  const [config, setConfig] = useState<CameraConfig>({
    name: 'Macbook Air Camera',
    type: 'webcam',
    streamUrl: '0',
    trackingEnabled: DEFAULT_STREAM_CONFIG.trackingEnabled,
    motionThreshold: DEFAULT_STREAM_CONFIG.motionThreshold,
    pixelChangeThreshold: DEFAULT_STREAM_CONFIG.pixelChangeThreshold,
    detectPerson: DEFAULT_STREAM_CONFIG.detectPerson,
    detectVehicle: DEFAULT_STREAM_CONFIG.detectVehicle,
  });
  const [status, setStatus] = useState<string>('Offline');
  const [motionActive, setMotionActive] = useState<boolean>(false);
  const [motionRatio, setMotionRatio] = useState<number>(0);
  const [logs, setLogs] = useState<{ message: string; timestamp: string }[]>([]);
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [clipsTotal, setClipsTotal] = useState<number>(0);
  const [loadingClips, setLoadingClips] = useState<boolean>(false);
  const [loadingMoreClips, setLoadingMoreClips] = useState<boolean>(false);
  const [deletingAllClips, setDeletingAllClips] = useState<boolean>(false);
  const [selectedClip, setSelectedClip] = useState<VideoClip | null>(null);
  const [clipDetections, setClipDetections] = useState<ClipObjectDetection[]>([]);
  const [clipReidLog, setClipReidLog] = useState<ClipReidLog | null>(null);
  const [loadingClipDetections, setLoadingClipDetections] = useState<boolean>(false);
  const [personRefsDetection, setPersonRefsDetection] = useState<ClipObjectDetection | null>(null);
  const [cropPreviewFilename, setCropPreviewFilename] = useState<string | null>(null);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState<boolean>(false);
  const [clipPreviewOpen, setClipPreviewOpen] = useState<boolean>(false);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = () => setIsMobileViewport(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) {
      setClipPreviewOpen(false);
      setLeftSidebarOpen(false);
    }
  }, [isMobileViewport]);

  const closeMobileLeftSidebarOnButtonClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!isMobileViewport) return;
    if ((e.target as HTMLElement).closest('button')) {
      setLeftSidebarOpen(false);
    }
  }, [isMobileViewport]);

  // Ask AI dialog
  const [clipFilterDeviceId, setClipFilterDeviceId] = useState<string>('');
  const [clipFilterStreamId, setClipFilterStreamId] = useState<string>('');
  const [clipFilterStartTime, setClipFilterStartTime] = useState<string>('');
  const [clipFilterEndTime, setClipFilterEndTime] = useState<string>('');
  const [showClipFilters, setShowClipFilters] = useState<boolean>(false);
  const [showAskAiDialog, setShowAskAiDialog] = useState<boolean>(false);

  // Live Camera Feed Video States
  const [liveFeedOpen, setLiveFeedOpen] = useState<boolean>(true);
  const liveFeedOpenRef = useRef(liveFeedOpen);
  useEffect(() => {
    liveFeedOpenRef.current = liveFeedOpen;
  }, [liveFeedOpen]);
  const [streamLoading, setStreamLoading] = useState<boolean>(true);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [previewFrozen, setPreviewFrozen] = useState<boolean>(false);
  const lastFrameAtRef = useRef<number>(0);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);

  // WebSocket Ref
  const wsRef = useRef<WebSocket | null>(null);
  const wsIntentionalCloseRef = useRef(false);
  const wsReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onlineDeviceIds = useMemo(
    () => new Set(devices.filter((d) => d.status !== 'Offline').map((d) => d.deviceId)),
    [devices],
  );

  const deviceNameById = useMemo(
    () => new Map(devices.map((d) => [d.deviceId, d.name])),
    [devices],
  );

  const clipFilterParams = useMemo(
    () => ({
      deviceId: clipFilterDeviceId,
      streamId: clipFilterStreamId,
      startTime: clipFilterStartTime,
      endTime: clipFilterEndTime,
    }),
    [clipFilterDeviceId, clipFilterStreamId, clipFilterStartTime, clipFilterEndTime],
  );

  const clipFilterStreams = useMemo(
    () => (clipFilterDeviceId
      ? streams.filter((s) => s.deviceId === clipFilterDeviceId)
      : streams),
    [streams, clipFilterDeviceId],
  );

  const hasActiveClipFilters = Boolean(
    clipFilterDeviceId || clipFilterStreamId || clipFilterStartTime || clipFilterEndTime,
  );

  const hasOnlineDevices = onlineDeviceIds.size > 0;

  useEffect(() => {
    if (location.pathname === '/app' || location.pathname === '/app/') {
      navigate('/app/events', { replace: true });
      return;
    }
    if (location.pathname.startsWith('/app/settings')) return;
    if (location.pathname.startsWith('/app/ai')) {
      navigate('/app/events', { replace: true });
    }
  }, [location.pathname, navigate]);

  const isClipFromOnlineDevice = useCallback((clip: VideoClip) => {
    if (!clip.deviceId) return hasOnlineDevices;
    return onlineDeviceIds.has(clip.deviceId);
  }, [onlineDeviceIds, hasOnlineDevices]);

  const visibleClips = useMemo(
    () => clips.filter(isClipFromOnlineDevice),
    [clips, isClipFromOnlineDevice],
  );

  const visibleClipIds = useMemo(
    () => new Set(visibleClips.map((c) => c.id)),
    [visibleClips],
  );

  useEffect(() => {
    onlineDeviceIdsRef.current = onlineDeviceIds;
  }, [onlineDeviceIds]);

  useEffect(() => {
    setClips((prev) => {
      const filtered = prev.filter(isClipFromOnlineDevice);
      return filtered.length === prev.length ? prev : filtered;
    });
    setSelectedClip((prev) => (prev && isClipFromOnlineDevice(prev) ? prev : null));
  }, [isClipFromOnlineDevice]);

  const onlineDevicesInitializedRef = useRef(false);
  useEffect(() => {
    if (!onlineDevicesInitializedRef.current) {
      onlineDevicesInitializedRef.current = true;
      return;
    }
    fetchClipsRef.current();
  }, [onlineDeviceIds]);

  const fetchDevices = useCallback(async (selectFirst = false) => {
    try {
      const res = await apiFetch('/devices');
      const data = await res.json();
      setDevices(data);

      const streamsRes = await apiFetch('/streams');
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
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  const fetchClips = useCallback(async (
    filtersOverride?: {
      deviceId: string;
      streamId: string;
      startTime: string;
      endTime: string;
    },
  ) => {
    const filters = filtersOverride ?? clipFilterParams;
    setLoadingClips(true);
    try {
      const qs = buildClipsQueryString(CLIPS_PAGE_SIZE, 0, filters);
      const res = await apiFetch(`/clips?${qs}`);
      const data = await res.json();
      setClips(data.clips);
      setClipsTotal(data.total);
      setSelectedClip((prevSelected) => {
        if (data.clips.length > 0 && !prevSelected) {
          return data.clips[0];
        }
        if (prevSelected && !data.clips.some((c: VideoClip) => c.id === prevSelected.id)) {
          return data.clips.length > 0 ? data.clips[0] : null;
        }
        return prevSelected;
      });
    } catch (err) {
      console.error('Failed to fetch clips', err);
    } finally {
      setLoadingClips(false);
    }
  }, [clipFilterParams]);

  const loadMoreClips = useCallback(async () => {
    if (loadingMoreClips || clips.length >= clipsTotal) return;
    setLoadingMoreClips(true);
    try {
      const qs = buildClipsQueryString(CLIPS_PAGE_SIZE, clips.length, clipFilterParams);
      const res = await apiFetch(`/clips?${qs}`);
      const data = await res.json();
      setClips((prev) => [...prev, ...data.clips]);
      setClipsTotal(data.total);
    } catch (err) {
      console.error('Failed to load more clips', err);
    } finally {
      setLoadingMoreClips(false);
    }
  }, [clips.length, clipsTotal, loadingMoreClips, clipFilterParams]);

  useEffect(() => {
    fetchClipsRef.current = fetchClips;
  }, [fetchClips]);

  useEffect(() => {
    streamStatusRef.current = status;
  }, [status]);

  const disconnectWS = useCallback(() => {
    wsIntentionalCloseRef.current = true;
    if (wsReconnectTimerRef.current) {
      clearTimeout(wsReconnectTimerRef.current);
      wsReconnectTimerRef.current = null;
    }
    const ws = wsRef.current;
    if (!ws) return;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe_stream' }));
    }
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
    wsRef.current = null;
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
      if (currentStreamId && liveFeedOpenRef.current) {
        ws.send(JSON.stringify({ type: 'subscribe_stream', streamId: currentStreamId }));
      }
      const deviceModal = deviceLogsDeviceRef.current;
      if (deviceModal) {
        ws.send(JSON.stringify({ type: 'subscribe_device', deviceId: deviceModal.deviceId }));
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'status':
          if (data.streamId) {
            const prevStatus = data.streamId === selectedStreamIdRef.current
              ? streamStatusRef.current
              : null;
            const isProcessingStatus = (s: string) =>
              s === 'Processing' || s === 'Processing Video';

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
              if (prevStatus && isProcessingStatus(prevStatus) && !isProcessingStatus(data.status)) {
                fetchClipsRef.current();
              }
              streamStatusRef.current = data.status;
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
          if (deviceLogSinkRef.current) {
            deviceLogSinkRef.current(logEntry);
          }
          break;
        }
        case 'new_clip': {
          const clip = data.clip as VideoClip | undefined;
          if (!clip?.id) break;
          if (clip.deviceId && !onlineDeviceIdsRef.current.has(clip.deviceId)) break;
          const normalized: VideoClip = {
            ...clip,
            timestamp: typeof clip.timestamp === 'string'
              ? clip.timestamp
              : new Date(clip.timestamp as unknown as string).toISOString(),
          };
          setClips((prev) => {
            if (prev.some((c) => c.id === normalized.id)) return prev;
            return [normalized, ...prev];
          });
          setClipsTotal((prev) => prev + 1);
          setSelectedClip(normalized);
          break;
        }
        case 'clip_processing_complete':
          fetchClipsRef.current();
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
          fetchClipsRef.current();
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
      const wsStillNeeded =
        (liveFeedOpenRef.current && !!selectedStreamIdRef.current) ||
        !!deviceLogsDeviceRef.current;
      if (!wsStillNeeded) {
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

  useEffect(() => {
    if (!selectedClip) {
      setClipDetections([]);
      setClipReidLog(null);
      return;
    }

    let cancelled = false;
    setLoadingClipDetections(true);

    apiFetch(`/clips/${selectedClip.id}/detections`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ClipDetectionsResponse | ClipObjectDetection[] | null) => {
        if (cancelled || !data) return;
        if (Array.isArray(data)) {
          setClipDetections(data);
          setClipReidLog(null);
        } else {
          setClipDetections(Array.isArray(data.objects) ? data.objects : []);
          setClipReidLog(data.reidLog ?? null);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch clip detections', err);
        if (!cancelled) {
          setClipDetections([]);
          setClipReidLog(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingClipDetections(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedClip?.id]);

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
    if (!liveFeedOpen || !selectedStreamId) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Clear logs for new stream
      setLogs([]);
      setMotionActive(false);
      setMotionRatio(0);

      wsRef.current.send(JSON.stringify({ type: 'subscribe_stream', streamId: selectedStreamId }));
    }
  }, [selectedStreamId, liveFeedOpen]);

  const wsNeeded = (liveFeedOpen && !!selectedStreamId) || !!deviceLogsDevice;

  // Connect WebSocket only while live feed or device logs modal needs it
  useEffect(() => {
    if (!wsNeeded) {
      disconnectWS();
      return;
    }
    connectWS();
    return () => {
      disconnectWS();
    };
  }, [wsNeeded, connectWS, disconnectWS]);

  const closeLiveFeed = useCallback(() => {
    setLiveFeedOpen(false);
    setLiveFrame(null);
    setStreamLoading(false);
    setPreviewFrozen(false);
    setMotionActive(false);
    setMotionRatio(0);
    lastFrameAtRef.current = 0;
  }, []);

  const fetchReidPeople = useCallback(async () => {
    setLoadingReidPeople(true);
    try {
      const res = await apiFetch('/reid/people');
      const data = await res.json();
      setReidPeople(data);
      setBrokenIdentityCovers(new Set());
    } catch (err) {
      console.error('Failed to fetch ReID people', err);
    } finally {
      setLoadingReidPeople(false);
    }
  }, []);

  const fetchTopology = useCallback(async () => {
    try {
      const res = await apiFetch('/reid/topology');
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
        apiFetch(`/reid/identities/${person.id}/journey`),
        apiFetch(`/reid/identities/${person.id}/matches`),
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
        const res = await apiFetch(`/reid/detections/${crop.id}/source-clip`);
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
      const res = await apiFetch(`/reid/identities/${selectedPerson.id}`, {
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
      const res = await apiFetch('/reid/feedback/stream-track', {
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

  const handleDeleteIdentity = async (person: ReidPerson, e: React.MouseEvent) => {
    e.stopPropagation();
    if (linkPeopleMode) return;

    const label = person.displayName || 'this person';
    if (!confirm(`Delete "${label}" and all ${person.photoCount} associated crop(s)? This cannot be undone.`)) {
      return;
    }

    setDeletingIdentityId(person.id);
    try {
      const res = await apiFetch(`/reid/identities/${person.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to delete identity');
        return;
      }

      if (selectedPerson?.id === person.id) {
        closePersonDetail();
      } else {
        setReidPeople((prev) => prev.filter((p) => p.id !== person.id));
      }
    } catch (err) {
      console.error('Failed to delete identity', err);
      alert('Failed to delete identity');
    } finally {
      setDeletingIdentityId(null);
    }
  };

  const handleLinkPeople = async () => {
    if (linkPeopleSelection.length !== 2) {
      alert('Select exactly 2 people to link.');
      return;
    }
    try {
      const [idA, idB] = linkPeopleSelection;
      const [jA, jB] = await Promise.all([
        apiFetch(`/reid/identities/${idA}/journey`).then(r => r.json()),
        apiFetch(`/reid/identities/${idB}/journey`).then(r => r.json()),
      ]);
      const detA = jA.detections?.[0]?.id;
      const detB = jB.detections?.[0]?.id;
      if (!detA || !detB) {
        alert('Could not find crops to link.');
        return;
      }
      const res = await apiFetch('/reid/identities/merge', {
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

      const res = await apiFetch('/reid/topology', {
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
    if (!hasOnlineDevices && reidView === 'person') {
      setReidView('people');
      setSelectedPerson(null);
      setPersonTimeline([]);
      setPersonSuggestions([]);
      setTimelineVideo(null);
      setShowIdentitySuggestions(false);
    }
  }, [hasOnlineDevices, activeTab, reidView]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchDevices();
    }, 30_000);
    return () => clearInterval(intervalId);
  }, [fetchDevices]);

  useEffect(() => {
    if (activeTab === 'reid') {
      fetchReidPeople();
      if (reidView === 'person' && selectedPerson) {
        openPersonDetail(selectedPerson);
      }
    }
  }, [onlineDeviceIds, activeTab, fetchReidPeople]);

  useEffect(() => {
    if (activeTab === 'reid' && reidRefreshNonce > 0) {
      fetchReidPeople();
      if (reidView === 'person' && selectedPerson) {
        openPersonDetail(selectedPerson);
      }
    }
  }, [reidRefreshNonce]);

  // Reset stream loading only when switching streams (not on Recording/Processing status)
  useEffect(() => {
    if (!liveFeedOpen) return;
    Promise.resolve().then(() => {
      setStreamLoading(true);
      setLiveFrame(null);
      setPreviewFrozen(false);
      lastFrameAtRef.current = 0;
    });
  }, [selectedStreamId, liveFeedOpen]);

  // Detect frozen preview when WS frames stop arriving
  useEffect(() => {
    if (!liveFeedOpen || !selectedStreamId || status === 'Offline') {
      setPreviewFrozen(false);
      return;
    }

    const intervalId = setInterval(() => {
      const lastFrameAt = lastFrameAtRef.current;
      if (!lastFrameAt) return;
      setPreviewFrozen(Date.now() - lastFrameAt > PREVIEW_STALL_MS);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [selectedStreamId, status, liveFeedOpen]);

  const handleToggleStreamMonitoring = async (streamId: string, currentTrackingEnabled: boolean) => {
    const stream = streams.find((s) => s.streamId === streamId);
    if (!stream || stream.status === 'Offline') return;

    try {
      await apiFetch(`/streams/${streamId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingEnabled: !currentTrackingEnabled }),
      });
      if (streamId === selectedStreamId) {
        setConfig((prev) => ({ ...prev, trackingEnabled: !currentTrackingEnabled }));
      }
      fetchDevices();
    } catch (err) {
      console.error('Failed to toggle monitoring', err);
    }
  };

  const handleAddStream = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setSelectedStreamId('');
    setConfig({
      name: 'New Camera Stream',
      type: 'webcam',
      streamUrl: '0',
      trackingEnabled: DEFAULT_STREAM_CONFIG.trackingEnabled,
      motionThreshold: DEFAULT_STREAM_CONFIG.motionThreshold,
      pixelChangeThreshold: DEFAULT_STREAM_CONFIG.pixelChangeThreshold,
      detectPerson: DEFAULT_STREAM_CONFIG.detectPerson,
      detectVehicle: DEFAULT_STREAM_CONFIG.detectVehicle,
    });
    setAddingStreamForDeviceId(deviceId);
    setShowConfigDialog(true);
  };

  const closeStreamConfigDialog = () => {
    setShowConfigDialog(false);
    setAddingStreamForDeviceId(null);
  };

  const openDeviceConfigDialog = (dev: EdgeDevice, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDeviceConfigDeviceId(dev.deviceId);
    setDeviceConfigName(dev.name);
    setDeviceConfig(dev.effectiveConfig ?? createDefaultDeviceConfig());
    setShowDeviceConfigDialog(true);
  };

  const handleSelectClip = (clip: VideoClip) => {
    setSelectedClip(clip);
    if (isMobileViewport) {
      setClipPreviewOpen(true);
    }
  };

  const closeClipPreview = () => {
    setClipPreviewOpen(false);
  };

  const playDetectionClip = useCallback(async (opts: CropClipPlayback & { cropFilename: string }) => {
    let clipFilename = opts.clipFilename;
    let clipOffsetMs = opts.clipOffsetMs ?? 0;

    if (!clipFilename && opts.detectionId) {
      try {
        const res = await apiFetch(`/reid/detections/${opts.detectionId}/source-clip`);
        if (!res.ok) {
          setCropPreviewFilename(opts.cropFilename);
          return;
        }
        const data = await res.json();
        clipFilename = data.clipFilename;
        clipOffsetMs = data.clipOffsetMs ?? 0;
      } catch (err) {
        console.error('Failed to resolve clip for detection', err);
        setCropPreviewFilename(opts.cropFilename);
        return;
      }
    }

    if (clipFilename) {
      setTimelineVideo({
        filename: clipFilename,
        offsetMs: clipOffsetMs,
        cameraName: opts.cameraName,
        cropFilename: opts.cropFilename,
      });
    } else {
      setCropPreviewFilename(opts.cropFilename);
    }
  }, []);

  const handleDeviceReboot = async (deviceId: string, deviceName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Reboot device "${deviceName}"? The device will disconnect briefly.`)) return;

    setDeviceCommandPending(`${deviceId}:reboot`);
    try {
      const res = await apiFetch(`/devices/${deviceId}/command/reboot`, { method: 'POST' });
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

  const handleUpdateService = async (deviceId: string, deviceName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !confirm(
        `Update "${deviceName}"?\n\nThis will force-pull the latest code, refresh dependencies and the systemd service, then restart the edge agent. Local changes on the device will be discarded.`
      )
    ) {
      return;
    }

    setDeviceCommandPending(`${deviceId}:update`);
    try {
      const res = await apiFetch(`/devices/${deviceId}/command/update-service`, {
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

  const openDeviceLogsModal = (deviceId: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeviceLogsDevice({ deviceId, name });
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe_device', deviceId }));
    }
  };

  const closeDeviceLogsModal = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe_device' }));
    }
    setDeviceLogsDevice(null);
  };

  const openDeviceMetricsModal = (deviceId: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeviceMetricsDevice({ deviceId, name });
  };

  const refreshClipDetections = useCallback(async () => {
    if (!selectedClip) return;
    const detRes = await apiFetch(`/clips/${selectedClip.id}/detections`);
    if (detRes.ok) {
      const updated = await detRes.json();
      if (Array.isArray(updated)) {
        setClipDetections(updated);
      } else {
        setClipDetections(Array.isArray(updated.objects) ? updated.objects : []);
        setClipReidLog(updated.reidLog ?? null);
      }
    }
  }, [selectedClip?.id]);

  const openPersonRefsModal = (obj: ClipObjectDetection) => {
    if (obj.className !== 'person' || !obj.detectionId) return;
    setPersonRefsDetection(obj);
  };

  const handleStreamConfigSaved = async (result?: { streamId: string }) => {
    await fetchDevices();
    if (result?.streamId) {
      setSelectedStreamId(result.streamId);
      setLiveFeedOpen(true);
    }
  };

  const handleDeleteDevice = async (deviceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this edge device and all its streams?')) return;
    try {
      const res = await apiFetch(`/devices/${deviceId}`, {
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
      const res = await apiFetch(`/streams/${streamId}`, {
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
      const res = await apiFetch(`/clips/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setClips((prev) => prev.filter((c) => c.id !== id));
        setClipsTotal((prev) => Math.max(0, prev - 1));
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
    if (!confirm(`Are you sure you want to delete all ${clipsTotal} recorded clips? This cannot be undone.`)) return;

    setDeletingAllClips(true);
    try {
      const res = await apiFetch('/clips', { method: 'DELETE' });
      if (res.ok) {
        setClips([]);
        setClipsTotal(0);
        setSelectedClip(null);
      }
    } catch (err) {
      console.error('Failed to delete all clips', err);
    } finally {
      setDeletingAllClips(false);
    }
  };

  const handleLogout = () => {
    const wasImpersonating = isImpersonating();
    if (wasImpersonating) {
      exitImpersonation();
      navigate('/admin/orgs', { replace: true });
      return;
    }
    clearLoggedIn();
    navigate('/login', { replace: true });
  };

  const handleExitImpersonation = () => {
    exitImpersonation();
    navigate('/admin/orgs', { replace: true });
  };

  const clipsHasMore = visibleClips.length < clipsTotal;

  if (
    location.pathname.startsWith('/app') &&
    !location.pathname.startsWith('/app/settings') &&
    dashboardTabFromPath(location.pathname) === null
  ) {
    return <Navigate to="/app/events" replace />;
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1440px] mx-auto">

      {isImpersonating() && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[0.85rem] text-amber-200">
            Super admin impersonation — viewing as <span className="font-semibold">{currentOrg?.name}</span>
            {currentOrg?.role ? ` (${currentOrg.role})` : ''}
          </p>
          <button
            type="button"
            onClick={handleExitImpersonation}
            className="btn btn-secondary py-1.5 px-3 text-[0.8rem]"
          >
            Exit to admin console
          </button>
        </div>
      )}

      <DashboardHeader
        appView={appView}
        currentOrg={currentOrg}
        availableOrgs={availableOrgs}
        switchingOrg={switchingOrg}
        selectedDeviceId={selectedDeviceId}
        status={status}
        onSwitchOrg={handleSwitchOrg}
        onOpenSidebar={() => setLeftSidebarOpen(true)}
        onToggleSettings={() => navigate(appView === 'settings' ? '/app/events' : '/app/settings')}
        onLogout={handleLogout}
      />

      {appView === 'settings' && currentOrg && currentUser ? (
        <OrgSettingsPage
          org={currentOrg}
          currentUserId={currentUser.id}
          onBack={() => navigate('/app/events')}
          onSettingsSaved={setOrgSettings}
        />
      ) : (
        <>
      {/* NAVIGATION TABS */}
      <div className="flex gap-2 sm:gap-3 mb-6 bg-[rgba(255,255,255,0.02)] p-1.5 rounded-xl border border-border-glass w-full lg:w-fit overflow-x-auto">
        {hasOnlineDevices && (
          <button
            onClick={() => navigate('/app/events')}
            className={`py-2 px-3 sm:px-4 rounded-lg text-[0.8rem] sm:text-[0.85rem] font-semibold flex items-center gap-2 transition-all duration-200 border-none outline-none whitespace-nowrap shrink-0 ${activeTab === 'events'
              ? 'bg-primary text-white shadow-[0_4px_12px_rgba(124,58,237,0.25)]'
              : 'text-text-secondary hover:text-text-primary bg-transparent'
              }`}
          >
            <Video size={16} /> Event Archive
          </button>
        )}
        
        {hasOnlineDevices && (
          <button
            onClick={() => navigate('/app/reid')}
            className={`py-2 px-3 sm:px-4 rounded-lg text-[0.8rem] sm:text-[0.85rem] font-semibold flex items-center gap-2 transition-all duration-200 border-none outline-none whitespace-nowrap shrink-0 ${activeTab === 'reid'
              ? 'bg-primary text-white shadow-[0_4px_12px_rgba(124,58,237,0.25)]'
              : 'text-text-secondary hover:text-text-primary bg-transparent'
              }`}
          >
            <Fingerprint size={16} /> Cross-Camera ReID Tracker
          </button>
        )}
      </div>

      {/* Mobile left sidebar backdrop */}
      {leftSidebarOpen && appView === 'dashboard' && createPortal(
        <div
          className="fixed inset-0 z-[10001] bg-[rgba(9,13,22,0.75)] backdrop-blur-sm lg:hidden"
          onClick={() => setLeftSidebarOpen(false)}
          aria-hidden="true"
        />,
        document.body,
      )}

      {/* DASHBOARD LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative">

        {/* LEFT COLUMN: DEVICES & CAMERA */}
        <div
          className={`lg:col-span-4 flex flex-col gap-6
            fixed inset-y-0 left-0 z-[10002] w-[min(100vw-2.5rem,380px)] overflow-y-auto p-4 pt-5
            bg-[rgba(9,13,22,0.97)] border-r border-border-glass shadow-2xl
            transition-transform duration-300 ease-out
            lg:relative lg:z-auto lg:w-auto lg:overflow-visible lg:p-0 lg:bg-transparent lg:border-r-0 lg:shadow-none
            ${leftSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
          onClickCapture={closeMobileLeftSidebarOnButtonClick}
        >
          <div className="flex justify-between items-center lg:hidden mb-1">
            <span className="text-[0.85rem] font-semibold text-text-secondary">Devices & Cameras</span>
            <button
              type="button"
              onClick={() => setLeftSidebarOpen(false)}
              className="btn btn-secondary p-1.5 rounded-md"
              aria-label="Close devices panel"
            >
              <X size={16} />
            </button>
          </div>

          {/* DEVICE SELECTOR PANEL */}
          <div className="glass-panel p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-[1.1rem] flex items-center gap-2">
                <Cpu size={18} color="var(--color-primary)" /> Registered Edge Devices
                <DeviceInstallTooltip onGenerateToken={handleGenerateEnrollmentToken} />
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
                        {isEdgeUpdateAvailable(dev) && (
                          <button
                            onClick={(e) => handleUpdateService(dev.deviceId, dev.name, e)}
                            disabled={!isDeviceOnline || deviceCommandPending === `${dev.deviceId}:update`}
                            className="btn btn-secondary py-0.5 px-2 text-[0.65rem] rounded-md flex items-center gap-1 disabled:opacity-40"
                            title={`Update available (${dev.gitCommit?.slice(0, 8)} → ${dev.remoteGitCommit?.slice(0, 8)})`}
                          >
                            <Download size={11} />
                            {deviceCommandPending === `${dev.deviceId}:update` ? 'Updating...' : 'Update'}
                          </button>
                        )}
                        <button
                          onClick={(e) => openDeviceLogsModal(dev.deviceId, dev.name, e)}
                          className="btn btn-secondary py-0.5 px-2 text-[0.65rem] rounded-md flex items-center gap-1"
                          title="View Device Logs"
                        >
                          <ScrollText size={11} /> Logs
                        </button>
                        <button
                          onClick={(e) => openDeviceMetricsModal(dev.deviceId, dev.name, e)}
                          disabled={!isDeviceOnline}
                          className="btn btn-secondary py-0.5 px-2 text-[0.65rem] rounded-md flex items-center gap-1 disabled:opacity-40"
                          title="View Device Metrics"
                        >
                          <Activity size={11} /> Metrics
                        </button>
                        <button
                          onClick={(e) => openDeviceConfigDialog(dev, e)}
                          className="btn btn-secondary py-0.5 px-2 text-[0.65rem] rounded-md flex items-center gap-1"
                          title="Device settings"
                        >
                          <SlidersHorizontal size={11} /> Settings
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
                                  setLiveFeedOpen(true);
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
                                        <Activity size={10} /> Disable Tracking
                                      </>
                                    ) : (
                                      <>
                                        <Camera size={10} /> Enable Tracking
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
          {(liveFeedOpen || selectedStreamId) && (
          <div className="glass-panel p-5 relative">
            <div className={`flex justify-between items-center gap-2 flex-wrap ${liveFeedOpen ? 'mb-4' : ''}`}>
              <h2 className="text-[1.1rem] flex items-center gap-2">
                <Video size={18} color="var(--color-secondary)" /> Live Camera Feed
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                {liveFeedOpen && status === 'Recording' && (
                  <div className="text-[0.7rem] font-semibold flex items-center gap-1.5 py-1 px-2.5 rounded-full bg-[rgba(244,63,94,0.15)] text-danger border border-[rgba(244,63,94,0.35)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger inline-block animate-[pulse-danger_0.8s_infinite]"></span>
                    Recording clip
                  </div>
                )}
                {liveFeedOpen && (status === 'Processing Video' || status === 'Processing') && (
                  <div className="text-[0.7rem] font-semibold flex items-center gap-1.5 py-1 px-2.5 rounded-full bg-[rgba(124,58,237,0.15)] text-[#a78bfa] border border-[rgba(124,58,237,0.35)]">
                    <RefreshCw size={11} className="animate-spin" />
                    Summarizing clip
                  </div>
                )}
                {liveFeedOpen && motionActive && (
                  <div className="text-danger text-[0.8rem] font-semibold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-current inline-block animate-[pulse-danger_0.5s_infinite]"></span>
                    MOTION DETECTED: {(motionRatio * 100).toFixed(1)}%
                  </div>
                )}
                {liveFeedOpen ? (
                  <button
                    type="button"
                    onClick={closeLiveFeed}
                    className="btn p-1.5 bg-transparent text-text-muted hover:text-danger border-none shrink-0 transition-colors duration-200"
                    title="Close live feed"
                    aria-label="Close live feed"
                  >
                    <X size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setLiveFeedOpen(true)}
                    className="btn btn-secondary py-1 px-2.5 text-[0.75rem] rounded-md flex items-center gap-1.5"
                  >
                    <Play size={12} />
                    Open Feed
                  </button>
                )}
              </div>
            </div>

            {liveFeedOpen && (
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
            )}
          </div>
          )}



          {/* LIVE TERMINAL LOGS */}
          <div className="glass-panel p-5">
            <h2 className="text-[1.1rem] flex items-center gap-2 mb-3">
              <Terminal size={18} color="var(--color-secondary)" /> System Status Logs
            </h2>
            <div className="font-mono bg-[rgba(0,0,0,0.5)] rounded-lg p-3.5 text-[0.85rem] leading-[1.4] text-[#38bdf8] h-[180px] overflow-y-auto border border-[rgba(255,255,255,0.05)]" ref={terminalContainerRef}>
              {logs.length === 0 ? (
                <div className="text-text-muted text-[0.8rem]">
                  {selectedStreamId && liveFeedOpen
                    ? 'Waiting for stream events...'
                    : selectedStreamId
                      ? 'Live feed closed. Open feed to view stream events.'
                      : 'Select a camera stream to view logs.'}
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

        {/* RIGHT COLUMN: TAB CONTENT */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {loadingDevices ? (
            <DashboardPlaceholder reason="loading" />
          ) : !hasOnlineDevices ? (
            <DashboardPlaceholder reason={devices.length === 0 ? 'no-devices' : 'offline'} />
          ) : activeTab === 'events' ? (
            <>
              {/* EVENT ARCHIVE & PLAYBACK PANEL */}
              <div className="glass-panel p-4 sm:p-5 flex flex-col min-h-[60vh] lg:h-[984px]">
                <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
                  <div className="flex items-center gap-3 flex-wrap min-w-0">
                    <h2 className="text-[1rem] sm:text-[1.1rem] flex items-center gap-2">
                      <Video size={18} color="var(--color-primary)" /> Event Archive & Playback
                    </h2>
                    {orgSettings.aiChat && (
                      <button
                        type="button"
                        onClick={() => setShowAskAiDialog(true)}
                        className="btn btn-primary py-1.5 px-3.5 text-[0.8rem] rounded-lg flex items-center gap-2 font-semibold shadow-[0_4px_16px_rgba(124,58,237,0.4)] hover:shadow-[0_6px_22px_rgba(124,58,237,0.55)] transition-all duration-200"
                      >
                        <Sparkles size={14} /> Ask Camera AI
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setShowClipFilters(!showClipFilters)}
                      className={`btn btn-secondary py-1 px-2.5 text-[0.75rem] rounded-md flex items-center gap-1.5 transition-all duration-200 ${
                        showClipFilters || hasActiveClipFilters
                          ? 'border-primary text-primary bg-[rgba(124,58,237,0.08)]'
                          : ''
                      }`}
                    >
                      <SlidersHorizontal size={12} />
                      Filters
                      {hasActiveClipFilters && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                      )}
                    </button>
                    <button
                      onClick={handleDeleteAllClips}
                      className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md hover:text-danger"
                      disabled={loadingClips || deletingAllClips || visibleClips.length === 0}
                    >
                      <Trash2 size={12} /> Delete All
                    </button>
                    <button
                      onClick={() => { void fetchClips(); }}
                      className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md"
                      disabled={loadingClips || deletingAllClips}
                    >
                      <RefreshCw size={12} className={loadingClips ? 'animate-spin' : ''} /> Refresh
                    </button>
                  </div>
                </div>

                {showClipFilters && (
                  <div className="glass-panel p-3.5 mb-3 bg-[rgba(255,255,255,0.01)] border-[rgba(255,255,255,0.08)] rounded-[10px] flex flex-col gap-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[0.7rem] text-text-secondary">Device</label>
                        <select
                          value={clipFilterDeviceId}
                          onChange={(e) => {
                            setClipFilterDeviceId(e.target.value);
                            setClipFilterStreamId('');
                          }}
                          className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
                        >
                          <option value="">All Devices</option>
                          {devices.filter((d) => d.status !== 'Offline').map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[0.7rem] text-text-secondary">Camera Stream</label>
                        <select
                          value={clipFilterStreamId}
                          onChange={(e) => setClipFilterStreamId(e.target.value)}
                          className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
                        >
                          <option value="">All Streams</option>
                          {clipFilterStreams.map((s) => (
                            <option key={s.streamId} value={s.streamId}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[0.7rem] text-text-secondary">From</label>
                        <input
                          type="datetime-local"
                          value={clipFilterStartTime}
                          onChange={(e) => setClipFilterStartTime(e.target.value)}
                          className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[0.7rem] text-text-secondary">To</label>
                        <input
                          type="datetime-local"
                          value={clipFilterEndTime}
                          onChange={(e) => setClipFilterEndTime(e.target.value)}
                          className="text-[0.8rem] py-1 px-2 rounded-md bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] text-text-primary h-[32px]"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {hasActiveClipFilters && (
                        <button
                          type="button"
                          onClick={() => {
                            setClipFilterDeviceId('');
                            setClipFilterStreamId('');
                            setClipFilterStartTime('');
                            setClipFilterEndTime('');
                            void fetchClips({
                              deviceId: '',
                              streamId: '',
                              startTime: '',
                              endTime: '',
                            });
                          }}
                          className="btn btn-secondary py-1 px-2 text-[0.7rem] rounded flex items-center gap-1 hover:text-danger hover:border-danger bg-transparent font-semibold border-none"
                        >
                          Clear Filters
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { void fetchClips(); }}
                        disabled={loadingClips}
                        className="btn btn-secondary py-1 px-2.5 text-[0.75rem] rounded-md"
                      >
                        Apply Filters
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col lg:flex-row gap-5 flex-1 min-h-0 lg:overflow-hidden">
                  {/* Left pane: Clips History List */}
                  <div className="w-full lg:w-[320px] lg:shrink-0 flex flex-col gap-2.5 overflow-y-auto min-w-0 pr-1 lg:h-full max-h-[70vh] lg:max-h-none">
                    {loadingClips && visibleClips.length === 0 ? (
                      <div className="h-full flex flex-col justify-center items-center text-text-muted text-[0.85rem] text-center px-4">
                        <RefreshCw size={24} className="animate-spin mb-2" />
                        <span>Loading events…</span>
                      </div>
                    ) : visibleClips.length === 0 ? (
                      <div className="h-full flex justify-center items-center text-text-muted text-[0.85rem] text-center px-4">
                        {hasActiveClipFilters
                          ? 'No clips match the current filters.'
                          : 'No clips recorded yet.'}
                      </div>
                    ) : (
                      <>
                        {visibleClips.map((c) => {
                          const deviceName = c.deviceId ? deviceNameById.get(c.deviceId) : undefined;
                          const durationLabel = formatClipDuration(c.duration);
                          const detectionCount = getClipDetectionCount(c);
                          return (
                          <div
                            key={c.id}
                            onClick={() => handleSelectClip(c)}
                            className={`glass-panel interactive ${selectedClip?.id === c.id ? 'active' : ''} p-3 flex justify-between items-start cursor-pointer transition-all duration-200 w-full min-w-0`}
                          >
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <div className="bg-primary-glow p-2 rounded-lg text-primary flex-shrink-0 mt-0.5">
                                <Play size={16} fill="currentColor" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex justify-between items-start gap-2 mb-0.5">
                                  <span className="text-[0.85rem] font-semibold text-text-primary truncate">{c.camera}</span>
                                  <span className="text-[0.68rem] text-text-muted whitespace-nowrap shrink-0">
                                    {formatClipListDateTime(c.timestamp)}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] text-text-muted mb-0.5">
                                  {deviceName && (
                                    <span className="inline-flex items-center gap-1">
                                      <Cpu size={11} />
                                      {deviceName}
                                    </span>
                                  )}
                                  {durationLabel && (
                                    <span className="inline-flex items-center gap-1">
                                      <Clock size={11} />
                                      {durationLabel}
                                    </span>
                                  )}
                                  {detectionCount !== null && (
                                    <span className="inline-flex items-center gap-1 text-sky-400/90">
                                      <Activity size={11} />
                                      {detectionCount} detection{detectionCount === 1 ? '' : 's'}
                                    </span>
                                  )}
                                </div>
                                {orgSettings.videoSummary && c.summary && (
                                  <p className="text-[0.75rem] text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap">
                                    {c.summary}
                                  </p>
                                )}
                              </div>
                            </div>

                            <button
                              onClick={(e) => handleDeleteClip(c.id, e)}
                              className="btn p-1.5 bg-transparent text-text-muted hover:text-danger border-none shrink-0"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          );
                        })}
                        {clipsHasMore && (
                          <button
                            type="button"
                            onClick={loadMoreClips}
                            disabled={loadingMoreClips}
                            className="btn btn-secondary w-full py-2 text-[0.8rem] rounded-lg flex items-center justify-center gap-1.5"
                          >
                            <RefreshCw size={12} className={loadingMoreClips ? 'animate-spin' : ''} />
                            {loadingMoreClips
                              ? 'Loading…'
                              : `Load more (${visibleClips.length} of ${clipsTotal})`}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* Vertical Divider */}
                  <div className="hidden lg:block w-[1px] bg-[rgba(255,255,255,0.08)] self-stretch" />

                  {/* Right pane: Clip Viewer (desktop only) */}
                  <div className="hidden lg:flex flex-1 flex-col min-w-0 overflow-y-auto pr-1 lg:h-full">
                    {selectedClip ? (
                      <ClipPreviewPanel
                        clip={selectedClip}
                        deviceName={selectedClip.deviceId ? deviceNameById.get(selectedClip.deviceId) : undefined}
                        orgSettings={orgSettings}
                        loadingClipDetections={loadingClipDetections}
                        clipDetections={clipDetections}
                        clipReidLog={clipReidLog}
                        onOpenPersonRefs={openPersonRefsModal}
                        onCropPreview={setCropPreviewFilename}
                        onPlayDetectionClip={playDetectionClip}
                      />
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
            </>
          ) : activeTab === 'reid' && reidView === 'people' ? (
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
                      <span>{hasOnlineDevices ? 'No people detected yet.' : 'No online devices.'}</span>
                      <span className="text-[0.75rem] mt-1 text-center max-w-[280px]">
                        {hasOnlineDevices
                          ? 'Each camera track is auto-grouped. Crops appear here once a person is visible for >1s.'
                          : 'ReID detections are hidden while all edge devices are offline because video playback is unavailable.'}
                      </span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-6">
                      {reidPeople.map((person) => {
                        const isLinkSelected = linkPeopleSelection.includes(person.id);
                        const coverBroken = brokenIdentityCovers.has(person.id);

                        return (
                          <div
                            key={person.id}
                            className={`relative flex flex-col items-center gap-2 group ${isLinkSelected ? 'opacity-100' : ''}`}
                          >
                            {!linkPeopleMode && (
                              <button
                                type="button"
                                onClick={(e) => handleDeleteIdentity(person, e)}
                                disabled={deletingIdentityId === person.id}
                                title="Delete person"
                                className="absolute top-0 right-0 z-10 btn p-1 bg-[rgba(9,13,22,0.85)] text-text-muted hover:text-danger border border-[rgba(255,255,255,0.1)] rounded-full opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                              >
                                {deletingIdentityId === person.id
                                  ? <RefreshCw size={11} className="animate-spin" />
                                  : <Trash2 size={11} />}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => linkPeopleMode
                                ? handleLinkPeopleSelection(person.id)
                                : openPersonDetail(person)}
                              className="flex flex-col items-center gap-2 border-none bg-transparent p-0 cursor-pointer w-full"
                            >
                            <div className={`relative w-[88px] h-[88px] rounded-full overflow-hidden border-2 transition-all duration-200 ${
                              isLinkSelected
                                ? 'border-secondary shadow-[0_0_12px_rgba(6,182,212,0.5)]'
                                : 'border-[rgba(255,255,255,0.1)] group-hover:border-primary/50 group-hover:shadow-[0_0_12px_rgba(124,58,237,0.3)]'
                            }`}>
                              {coverBroken ? (
                                <div className="w-full h-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center">
                                  <UserCircle size={32} className="text-text-muted" />
                                </div>
                              ) : (
                                <img
                                  src={identityCoverUrl(person.id)}
                                  alt=""
                                  onError={() => {
                                    setBrokenIdentityCovers((prev) => new Set(prev).add(person.id));
                                  }}
                                  className={`w-full h-full ${REID_CROP_IMG}`}
                                />
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
                            <EntityIds
                              identityId={person.id}
                              detectionId={person.coverDetectionId}
                              clipId={person.coverClipId}
                              className="justify-center"
                            />
                            </button>
                          </div>
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
          ) : activeTab === 'reid' && reidView === 'person' && selectedPerson ? (
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
                    {selectedPerson && !brokenIdentityCovers.has(selectedPerson.id) ? (
                      <img
                        src={identityCoverUrl(selectedPerson.id)}
                        alt=""
                        onError={() => {
                          if (selectedPerson) {
                            setBrokenIdentityCovers((prev) => new Set(prev).add(selectedPerson.id));
                          }
                        }}
                        className={`w-full h-full ${REID_CROP_IMG}`}
                      />
                    ) : (
                      <div className="w-full h-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center">
                        <UserCircle size={36} className="text-text-muted" />
                      </div>
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
                    {selectedPerson && (
                      <EntityIds
                        identityId={selectedPerson.id}
                        detectionId={selectedPerson.coverDetectionId}
                        clipId={selectedPerson.coverClipId}
                        className="mt-1.5"
                      />
                    )}
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
                              {brokenIdentityCovers.has(suggestion.id) ? (
                                <div className="w-full h-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center">
                                  <UserCircle size={24} className="text-text-muted" />
                                </div>
                              ) : (
                                <img
                                  src={identityCoverUrl(suggestion.id)}
                                  alt=""
                                  onError={() => {
                                    setBrokenIdentityCovers((prev) => new Set(prev).add(suggestion.id));
                                  }}
                                  className={`w-full h-full ${REID_CROP_IMG}`}
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
                                  src={mediaUrl(`/crops/${crop.filename}`)}
                                  alt=""
                                  className={`w-12 h-12 rounded-lg ${REID_CROP_IMG}`}
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
                                <EntityIds
                                  identityId={crop.identityId || selectedPerson?.id || '—'}
                                  detectionId={crop.id}
                                  clipId={crop.clipId}
                                  className="mt-1"
                                />
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
          ) : null}
        </div>


      </div>

      <AskCameraAiDialog
        open={showAskAiDialog}
        onOpenChange={setShowAskAiDialog}
        orgSettings={orgSettings}
        streams={streams}
        onlineDeviceIds={onlineDeviceIds}
        visibleClipIds={visibleClipIds}
        hasOnlineDevices={hasOnlineDevices}
      />

      <MobileClipPreviewDialog
        open={clipPreviewOpen && isMobileViewport}
        clip={selectedClip}
        deviceName={selectedClip?.deviceId ? deviceNameById.get(selectedClip.deviceId) : undefined}
        orgSettings={orgSettings}
        loadingClipDetections={loadingClipDetections}
        clipDetections={clipDetections}
        clipReidLog={clipReidLog}
        onClose={closeClipPreview}
        onOpenPersonRefs={openPersonRefsModal}
        onCropPreview={setCropPreviewFilename}
        onPlayDetectionClip={playDetectionClip}
      />

      <CropPreviewDialog
        filename={cropPreviewFilename}
        onClose={() => setCropPreviewFilename(null)}
      />

      <TimelineClipPlaybackDialog
        playback={timelineVideo}
        onClose={() => setTimelineVideo(null)}
      />

      <PersonAppearancesDialog
        detection={personRefsDetection}
        onClose={() => setPersonRefsDetection(null)}
        selectedClip={selectedClip}
        clips={clips}
        onSelectClip={(clip) => {
          handleSelectClip(clip);
        }}
        onClipDetectionsRefresh={refreshClipDetections}
        onCropPreview={setCropPreviewFilename}
        onPlayClip={playDetectionClip}
      />

      <DeviceLogsDialog
        device={deviceLogsDevice}
        onClose={closeDeviceLogsModal}
        registerLiveLogSink={(sink) => { deviceLogSinkRef.current = sink; }}
      />

      <DeviceMetricsDialog
        device={deviceMetricsDevice}
        onClose={() => setDeviceMetricsDevice(null)}
      />

      <StreamConfigDialog
        open={showConfigDialog}
        onClose={closeStreamConfigDialog}
        mode={addingStreamForDeviceId ? 'add' : 'edit'}
        addDeviceId={addingStreamForDeviceId}
        streamId={selectedStreamId}
        streamName={streams.find((s) => s.streamId === selectedStreamId)?.name}
        initialConfig={config}
        onSaved={handleStreamConfigSaved}
      />

      <DeviceConfigDialog
        open={showDeviceConfigDialog}
        deviceId={deviceConfigDeviceId}
        initialName={deviceConfigName}
        initialConfig={deviceConfig}
        onClose={() => {
          setShowDeviceConfigDialog(false);
          setDeviceConfigDeviceId(null);
        }}
        onSaved={() => { void fetchDevices(); }}
      />
        </>
      )}
    </div>
  );
}


