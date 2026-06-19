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
  Cpu,
  Terminal,
  Video,
  Plus,
  X,
  Power,
  ScrollText,
  AlertTriangle,
  SlidersHorizontal,
  Maximize2,
  RefreshCw,
} from 'lucide-react';
import {
  apiFetch,
  getStoredOrg,
  switchOrg,
  fetchMe,
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
import { LIVE_PREVIEW_ENABLED, PREVIEW_STALL_MS, STREAM_INIT_TIMEOUT_MS, STREAM_REFRESH_COOLDOWN_MS, WS_BASE } from './constants';
import type {
  CameraConfig,
  CameraStream,
  DeviceEvent,
  EdgeDevice,
  LogEntry,
  VideoClip,
  Notification,
} from './types';
import { NotificationDrawer } from './components';
import { fetchNotifications, fetchUnreadCount, markNotificationsRead } from '../notificationsApi';

import {
  findLatestStreamError,
  getStreamErrorHint,
  getStreamErrorTitle,
  parseStreamErrorFromLog,
  type StreamErrorState,
} from './utils/streamErrors';
import { dashboardTabFromPath } from './utils/routing';
import { copyMacVlcTerminalCommand } from './utils/vlc';
import { DashboardHeader, DashboardPlaceholder, DeviceInstallTooltip } from './components';
import { SystemStatusLogsList } from './components/SystemStatusLogsList';
import { DashboardTabs, EventsTab, ReidTab } from './components/tabs';
import {
  DeviceConfigDialog,
  DeviceLogsDialog,
  DeviceMetricsDialog,
  StreamConfigDialog,
  SystemStatusLogsDialog,
} from './components/modals';
import { useEventsTab, useReidTab } from './hooks';

const getWebRtcPreviewUrl = (rtspUrl: string | undefined): string | null => {
  if (!rtspUrl) return null;
  const lowerUrl = rtspUrl.toLowerCase();
  if (!lowerUrl.startsWith('rtsp://')) return null;

  const match = rtspUrl.match(/^rtsp:\/\/([^:/]+)(?::\d+)?\/(.+)$/i);
  if (match) {
    const host = match[1];
    const path = match[2];
    const cleanPath = path.endsWith('/') ? path : `${path}/`;
    return `https://${host}/${cleanPath}`;
  }
  return null;
};

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
  const [showSystemLogsDialog, setShowSystemLogsDialog] = useState(false);
  const [deviceCommandPending, setDeviceCommandPending] = useState<string | null>(null);

  // Notifications States
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState<number>(0);
  const [loadingNotifications, setLoadingNotifications] = useState<boolean>(false);
  const [notificationsDrawerOpen, setNotificationsDrawerOpen] = useState<boolean>(false);

  const loadNotifications = useCallback(async () => {
    setLoadingNotifications(true);
    try {
      const [{ notifications: fetched }, { count }] = await Promise.all([
        fetchNotifications({ limit: 50 }),
        fetchUnreadCount(),
      ]);
      setNotifications(fetched);
      setUnreadNotificationCount(count);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setLoadingNotifications(false);
    }
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await markNotificationsRead({ all: true });
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: new Date().toISOString() }))
      );
      setUnreadNotificationCount(0);
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await markNotificationsRead({ ids: [id] });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
      );
      setUnreadNotificationCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error(`Failed to mark notification ${id} as read:`, err);
    }
  };

  useEffect(() => {
    fetchMe()
      .then((data) => {
        setCurrentUser(data.user);
        if (data.org) setCurrentOrg(data.org);
        setAvailableOrgs(data.orgs);
        if (data.settings) setOrgSettings(data.settings);
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (currentOrg) {
      loadNotifications();
    }
  }, [currentOrg, loadNotifications]);

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

  const selectedStreamIdRef = useRef(selectedStreamId);
  const selectedStreamDeviceIdRef = useRef<string | null>(null);
  const fetchClipsRef = useRef<() => Promise<void>>(async () => { });
  const handleNewClipRef = useRef<(clip: VideoClip) => void>(() => { });
  const triggerReidRefreshRef = useRef<() => void>(() => { });
  const streamStatusRef = useRef<string>('Offline');
  const onlineDeviceIdsRef = useRef<Set<string>>(new Set());
  const deviceLogsDeviceRef = useRef(deviceLogsDevice);
  const deviceLogSinkRef = useRef<((entry: LogEntry) => void) | null>(null);
  const deviceEventSinkRef = useRef<((event: DeviceEvent) => void) | null>(null);

  const registerDeviceLogSink = useCallback((sink: ((entry: LogEntry) => void) | null) => {
    deviceLogSinkRef.current = sink;
  }, []);

  const registerDeviceEventSink = useCallback((sink: ((event: DeviceEvent) => void) | null) => {
    deviceEventSinkRef.current = sink;
  }, []);

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
  const [leftSidebarOpen, setLeftSidebarOpen] = useState<boolean>(false);
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
      setLeftSidebarOpen(false);
    }
  }, [isMobileViewport]);

  const closeMobileLeftSidebarOnButtonClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!isMobileViewport) return;
    if ((e.target as HTMLElement).closest('button')) {
      setLeftSidebarOpen(false);
    }
  }, [isMobileViewport]);

  // Live Camera Feed Video States
  const [liveFeedOpen, setLiveFeedOpen] = useState<boolean>(true);
  const liveFeedOpenRef = useRef(liveFeedOpen);
  useEffect(() => {
    liveFeedOpenRef.current = liveFeedOpen;
  }, [liveFeedOpen]);
  const [streamLoading, setStreamLoading] = useState<boolean>(true);
  const [streamInitTimedOut, setStreamInitTimedOut] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<StreamErrorState | null>(null);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [previewFrozen, setPreviewFrozen] = useState<boolean>(false);
  const [, setVlcLaunchHint] = useState<'idle' | 'opened' | 'failed'>('idle');
  const lastFrameAtRef = useRef<number>(0);
  const lastStreamRefreshAtRef = useRef<number>(0);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);

  const [showInlineWebRtc, setShowInlineWebRtc] = useState<boolean>(true);
  useEffect(() => {
    setShowInlineWebRtc(true);
  }, [selectedStreamId]);

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

  const hasOnlineDevices = onlineDeviceIds.size > 0;

  const selectedStream = useMemo(
    () => streams.find((s) => s.streamId === selectedStreamId) ?? null,
    [streams, selectedStreamId],
  );

  const usesWebPreview = LIVE_PREVIEW_ENABLED && selectedStream?.cameraType !== 'rtsp';
  const usesRtspExternal = selectedStream?.cameraType === 'rtsp';
  const usesExternalView = !usesWebPreview;
  const usesWebPreviewRef = useRef(usesWebPreview);
  useEffect(() => {
    usesWebPreviewRef.current = usesWebPreview;
  }, [usesWebPreview]);

  const activeStreamError = useMemo<StreamErrorState | null>(() => {
    if (streamError) return streamError;

    const fromLogs = findLatestStreamError(logs, selectedStream?.name);
    if (fromLogs) return fromLogs;

    if (status === 'Error') {
      const rtsp = selectedStream?.streamUrl;
      return {
        errorType: 'camera_error',
        message: rtsp
          ? `Cannot connect to camera at ${rtsp}`
          : 'Camera connection failed. See System Status Logs below.',
      };
    }
    return null;
  }, [streamError, status, logs, selectedStream?.name, selectedStream?.streamUrl]);

  const appendLog = useCallback((message: string) => {
    const logEntry = { message, timestamp: new Date().toISOString() };
    setLogs((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.message === logEntry.message && last.timestamp === logEntry.timestamp) {
        return prev;
      }
      return [...prev, logEntry];
    });
  }, []);

  const refreshStreamPreview = useCallback((reason: string) => {
    const streamId = selectedStreamIdRef.current;
    if (!streamId || !liveFeedOpenRef.current || !usesWebPreviewRef.current) return;

    const now = Date.now();
    if (now - lastStreamRefreshAtRef.current < STREAM_REFRESH_COOLDOWN_MS) {
      return;
    }
    lastStreamRefreshAtRef.current = now;

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'refresh_stream', streamId }));
      appendLog(`[Dashboard] Auto-recovery: ${reason}`);
    }
  }, [appendLog]);

  const appendLogRef = useRef(appendLog);
  const refreshStreamPreviewRef = useRef(refreshStreamPreview);

  useEffect(() => {
    appendLogRef.current = appendLog;
    refreshStreamPreviewRef.current = refreshStreamPreview;
  }, [appendLog, refreshStreamPreview]);

  useEffect(() => {
    selectedStreamIdRef.current = selectedStreamId;
    selectedStreamDeviceIdRef.current = selectedStream?.deviceId ?? null;
  }, [selectedStreamId, selectedStream?.deviceId]);

  const eventsTab = useEventsTab({
    devices,
    streams,
    orgSettings,
    onlineDeviceIds,
    hasOnlineDevices,
    isMobileViewport,
    deviceNameById,
  });

  const reidTab = useReidTab({
    streams,
    hasOnlineDevices,
    active: activeTab === 'reid',
  });

  const handleNotificationClick = async (n: Notification) => {
    setNotificationsDrawerOpen(false);

    if (n.category === 'surveillance' && n.clipId) {
      navigate('/app/events');
      if (n.streamId) {
        setSelectedStreamId(n.streamId);
      }
      try {
        const res = await apiFetch(`/clips/${n.clipId}`);
        if (res.ok) {
          const data = await res.json();
          const clip = data.clip || data;
          if (clip) {
            eventsTab.handleSelectClip(clip);
          }
        }
      } catch (err) {
        console.error('Failed to fetch clip for notification click:', err);
      }
    } else if (n.deviceId) {
      const deviceStream = streams.find((s) => s.deviceId === n.deviceId);
      if (deviceStream) {
        setSelectedStreamId(deviceStream.streamId);
        setSelectedDeviceId(n.deviceId);
      }
    }
  };

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
          if (selectFirst) {
            return streamsData[0].streamId;
          }
          if (prevId) {
            const stillExists = streamsData.some((s: { streamId: string }) => s.streamId === prevId);
            return stillExists ? prevId : '';
          }
          return '';
        });
      }
    } catch (err) {
      console.error('Failed to fetch devices/streams', err);
    } finally {
      setLoadingDevices(false);
    }
  }, []);



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

  useEffect(() => {
    onlineDeviceIdsRef.current = onlineDeviceIds;
  }, [onlineDeviceIds]);

  useEffect(() => {
    fetchClipsRef.current = eventsTab.fetchClips;
    handleNewClipRef.current = eventsTab.handleNewClip;
    triggerReidRefreshRef.current = reidTab.triggerReidRefresh;
  }, [eventsTab.fetchClips, eventsTab.handleNewClip, reidTab.triggerReidRefresh]);

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
      if (currentStreamId && liveFeedOpenRef.current && usesWebPreviewRef.current) {
        ws.send(JSON.stringify({ type: 'subscribe_stream', streamId: currentStreamId }));
      }
      const deviceId = selectedStreamDeviceIdRef.current;
      if (deviceId) {
        ws.send(JSON.stringify({ type: 'subscribe_device', deviceId }));
      }
      const deviceModal = deviceLogsDeviceRef.current;
      if (deviceModal) {
        ws.send(JSON.stringify({ type: 'subscribe_device', deviceId: deviceModal.deviceId }));
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'notification_count':
          if (currentOrg && data.orgId === currentOrg.id) {
            setUnreadNotificationCount(data.count);
          }
          break;
        case 'new_notification':
          if (currentOrg && data.notification && data.notification.orgId === currentOrg.id) {
            setNotifications((prev) => {
              if (prev.some((n) => n.id === data.notification.id)) return prev;
              return [data.notification, ...prev];
            });
            setUnreadNotificationCount((prev) => prev + 1);
          }
          break;
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
                  alertInstructions: cfg.alertInstructions || [],
                });
              }
            }
          }
          break;
        case 'motion_state':
          setMotionActive(data.active);
          setMotionRatio(data.ratio);
          break;
        case 'device_event': {
          const modalDevice = deviceLogsDeviceRef.current;
          const event = data.event as DeviceEvent | undefined;
          if (
            event &&
            modalDevice &&
            data.deviceId === modalDevice.deviceId &&
            deviceEventSinkRef.current
          ) {
            deviceEventSinkRef.current(event);
          }
          break;
        }
        case 'log': {
          const logEntry = { message: data.message, timestamp: data.timestamp };
          setLogs((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.message === data.message && last.timestamp === data.timestamp) {
              return prev;
            }
            return [...prev, logEntry];
          });
          const parsed = parseStreamErrorFromLog(data.message);
          if (parsed) {
            setStreamError(parsed);
            setStreamLoading(false);
            setStreamInitTimedOut(false);
          } else if (
            data.message.includes('Started YOLO+ByteTrack pipeline') ||
            data.message.includes('Live preview streaming enabled')
          ) {
            setStreamError(null);
          }
          if (deviceLogSinkRef.current) {
            deviceLogSinkRef.current(logEntry);
          }
          break;
        }
        case 'new_clip': {
          const clip = data.clip as VideoClip | undefined;
          if (clip?.id) {
            handleNewClipRef.current(clip);
          }
          break;
        }
        case 'clip_processing_complete':
          fetchClipsRef.current();
          break;
        case 'new_reid_crop':
          triggerReidRefreshRef.current();
          break;
        case 'frame':
          if (data.image && data.streamId === selectedStreamIdRef.current) {
            lastFrameAtRef.current = Date.now();
            setLiveFrame(`data:image/jpeg;base64,${data.image}`);
            setStreamLoading(false);
            setStreamInitTimedOut(false);
            setStreamError(null);
            setPreviewFrozen(false);
          }
          break;
        case 'stream_error':
          if (data.streamId === selectedStreamIdRef.current) {
            setStreamError({
              errorType: data.errorType || 'camera_error',
              message: data.message || 'Camera connection failed',
              retryInSec: data.retryInSec,
            });
            setStreamLoading(false);
            setStreamInitTimedOut(false);
            setStatus('Error');
          }
          if (data.streamId) {
            setStreams((prev) =>
              prev.map((s) =>
                s.streamId === data.streamId ? { ...s, status: 'Error' } : s,
              ),
            );
          }
          break;
        case 'stream_error_cleared':
          if (data.streamId === selectedStreamIdRef.current) {
            setStreamError(null);
            if (data.status) {
              setStatus(data.status);
            }
          }
          if (data.streamId) {
            setStreams((prev) =>
              prev.map((s) =>
                s.streamId === data.streamId
                  ? { ...s, status: data.status || (s.trackingEnabled ? 'Monitoring' : 'Idle') }
                  : s,
              ),
            );
          }
          break;
        case 'preview_stall':
          if (data.streamId === selectedStreamIdRef.current) {
            setPreviewFrozen(true);
            if (typeof data.stalledForSec === 'number') {
              appendLogRef.current(
                `[Dashboard] Live preview stalled (no frames for ${data.stalledForSec}s). Attempting recovery...`,
              );
            }
            refreshStreamPreviewRef.current('preview stall detected');
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
        !!selectedStreamIdRef.current ||
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
      fetchDevices(false);
    });
  }, [fetchDevices]);

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
          alertInstructions: stream.alertInstructions || [],
        });
        setStatus(stream.status);
        setSelectedDeviceId(stream.deviceId);
      });
    }
  }, [selectedStreamId, streams]);

  const openStreamFeed = useCallback((stream: CameraStream) => {
    setSelectedStreamId(stream.streamId);
    setSelectedDeviceId(stream.deviceId);
    setLiveFeedOpen(true);
    setStreamError(null);
    setPreviewFrozen(false);
    setLiveFrame(null);
    setVlcLaunchHint('idle');
    lastFrameAtRef.current = 0;

    if (stream.cameraType === 'rtsp' && stream.streamUrl) {
      setStreamLoading(false);
      setStreamInitTimedOut(false);
      return;
    }

    if (!LIVE_PREVIEW_ENABLED) {
      setStreamLoading(false);
      setStreamInitTimedOut(false);
      return;
    }

    setStreamLoading(true);
    setStreamInitTimedOut(false);
  }, []);

  const handleCopyMacVlcCommand = useCallback(async (url?: string) => {
    const targetUrl = url || selectedStream?.streamUrl;
    if (!targetUrl) return;
    const copied = await copyMacVlcTerminalCommand(targetUrl);
    appendLog(
      copied
        ? '[Dashboard] macOS command copied — paste in Terminal: open -a VLC "rtsp://..."'
        : '[Dashboard] Could not copy Terminal command',
    );
  }, [appendLog, selectedStream?.streamUrl]);

  // Subscribe/unsubscribe live preview when the feed panel is toggled (webcam only)
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !selectedStreamId) return;

    if (liveFeedOpen && usesWebPreview) {
      setStreamLoading(true);
      setStreamInitTimedOut(false);
      setLiveFrame(null);
      lastFrameAtRef.current = 0;
      ws.send(JSON.stringify({ type: 'subscribe_stream', streamId: selectedStreamId }));
    } else {
      ws.send(JSON.stringify({ type: 'unsubscribe_stream' }));
      if (!liveFeedOpen || !usesWebPreview) {
        setStreamLoading(false);
        setStreamInitTimedOut(false);
        setPreviewFrozen(false);
        if (!usesWebPreview) {
          setLiveFrame(null);
        }
      }
    }
  }, [liveFeedOpen, selectedStreamId, usesWebPreview]);

  // Sync WS device subscription when stream changes
  useEffect(() => {
    if (!selectedStreamId) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const deviceId = selectedStream?.deviceId;
      if (deviceId) {
        wsRef.current.send(JSON.stringify({ type: 'subscribe_device', deviceId }));
      }
      setMotionActive(false);
      setMotionRatio(0);
    }
  }, [selectedStreamId, selectedStream?.deviceId]);

  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Surface the latest camera error from buffered logs when opening a stream
  useEffect(() => {
    if (!selectedStreamId || !liveFeedOpen) return;
    const parsed = findLatestStreamError(logs, selectedStream?.name);
    if (parsed) {
      setStreamError(parsed);
      setStreamLoading(false);
    }
  }, [selectedStreamId, selectedStream?.name, liveFeedOpen, logs]);

  const wsNeeded = !!selectedStreamId || !!deviceLogsDevice;
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
    setStreamInitTimedOut(false);
    setStreamError(null);
    setPreviewFrozen(false);
    setVlcLaunchHint('idle');
    setMotionActive(false);
    setMotionRatio(0);
    lastFrameAtRef.current = 0;
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchDevices();
    }, 30_000);
    return () => clearInterval(intervalId);
  }, [fetchDevices]);

  // Reset stream loading only when switching streams (not on Recording/Processing status)
  useEffect(() => {
    if (!liveFeedOpen || !usesWebPreview) return;
    Promise.resolve().then(() => {
      setStreamLoading(true);
      setStreamInitTimedOut(false);
      setLiveFrame(null);
      setPreviewFrozen(false);
      lastFrameAtRef.current = 0;
      lastStreamRefreshAtRef.current = 0;
    });
  }, [selectedStreamId, liveFeedOpen, usesWebPreview]);

  // Detect frozen preview when WS frames stop arriving (webcam only)
  useEffect(() => {
    if (!liveFeedOpen || !selectedStreamId || !usesWebPreview || status === 'Offline') {
      setPreviewFrozen(false);
      return;
    }

    const intervalId = setInterval(() => {
      const lastFrameAt = lastFrameAtRef.current;
      if (!lastFrameAt) return;
      const frozen = Date.now() - lastFrameAt > PREVIEW_STALL_MS;
      setPreviewFrozen(frozen);
      if (frozen) {
        refreshStreamPreview('no frames received in dashboard');
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [selectedStreamId, status, liveFeedOpen, usesWebPreview, refreshStreamPreview]);

  // Auto-recover when the live feed never receives its first frame (webcam only)
  useEffect(() => {
    if (!liveFeedOpen || !selectedStreamId || !usesWebPreview || status === 'Offline' || !streamLoading) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (!lastFrameAtRef.current) {
        setStreamInitTimedOut(true);
        appendLog(
          '[Dashboard] Live stream initialization timed out. Check edge logs below and retrying preview...',
        );
        refreshStreamPreview('stream init timeout');
      }
    }, STREAM_INIT_TIMEOUT_MS);

    return () => clearTimeout(timeoutId);
  }, [
    selectedStreamId,
    status,
    liveFeedOpen,
    usesWebPreview,
    streamLoading,
    appendLog,
    refreshStreamPreview,
  ]);

  const handleToggleStreamMonitoring = async (streamId: string, currentTrackingEnabled: boolean) => {
    const stream = streams.find((s) => s.streamId === streamId);
    if (!stream) return;

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
      alertInstructions: [],
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
        unreadNotificationCount={unreadNotificationCount}
        onNotificationBellClick={() => setNotificationsDrawerOpen((prev) => !prev)}
      />

      <NotificationDrawer
        isOpen={notificationsDrawerOpen}
        onClose={() => setNotificationsDrawerOpen(false)}
        notifications={notifications}
        loading={loadingNotifications}
        onMarkAllRead={handleMarkAllRead}
        onMarkRead={handleMarkRead}
        onNotificationClick={handleNotificationClick}
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
          <DashboardTabs
            activeTab={activeTab}
            hasOnlineDevices={hasOnlineDevices}
            onSelectEvents={() => navigate('/app/events')}
            onSelectReid={() => navigate('/app/reid')}
          />

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
                  </h2>
                  <DeviceInstallTooltip orgId={currentOrg?.id ?? ''} showAsButton />
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
                                      : stream.status === 'Error'
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
                                    className="flex flex-col gap-1.5"
                                  >
                                    <div
                                      onClick={() => {
                                        if (stream.cameraType === 'rtsp') {
                                          setSelectedStreamId((prev) => (prev === stream.streamId ? '' : stream.streamId));
                                          setSelectedDeviceId(stream.deviceId);
                                          setLiveFeedOpen(false);
                                          setVlcLaunchHint('idle');
                                        } else {
                                          openStreamFeed(stream);
                                        }
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
                                            {stream.status === 'Error'
                                              ? 'Camera connection error'
                                              : stream.cameraType === 'webcam'
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
                                          className={`btn ${stream.trackingEnabled
                                            ? 'btn-primary'
                                            : 'btn-secondary'
                                            } py-0.5 px-2 text-[0.65rem] rounded-md h-[24px] shrink-0 flex items-center gap-1 font-semibold`}
                                        >
                                          {stream.trackingEnabled ? (
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

                                    {/* Inline RTSP Operations */}
                                    {stream.cameraType === 'rtsp' && isSelected && (
                                      <div className="flex flex-col gap-2.5 p-3 rounded-lg border border-border-glass bg-[rgba(124,58,237,0.03)] ml-2 mb-1.5">
                                        <div
                                          className="text-[0.7rem] text-text-secondary truncate font-mono bg-[rgba(0,0,0,0.20)] px-2 py-1 rounded border border-[rgba(255,255,255,0.04)] select-all cursor-pointer"
                                          title="Double click to select all"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {stream.streamUrl}
                                        </div>
                                        <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
                                          {getWebRtcPreviewUrl(stream.streamUrl) ? (
                                            showInlineWebRtc ? (
                                              <div className="flex flex-col gap-2 animate-[fadeIn_0.2s_ease-out]">
                                                <div className="w-full relative" style={{ aspectRatio: '16/9' }}>
                                                  <iframe
                                                    src={getWebRtcPreviewUrl(stream.streamUrl)!}
                                                    title="WebRTC Live Preview"
                                                    className="w-full h-full border-0 rounded-lg block bg-[#090d16]"
                                                    allow="autoplay; fullscreen"
                                                  />
                                                  <div className="absolute top-2 left-2 text-[0.6rem] font-semibold flex items-center gap-1.5 py-0.5 px-2 rounded-full bg-[rgba(16,185,129,0.25)] text-emerald-400 border border-[rgba(16,185,129,0.4)] pointer-events-none select-none z-10">
                                                    <span className="w-1 h-1 rounded-full bg-emerald-400 inline-block animate-[pulse-danger_0.8s_infinite]"></span>
                                                    LIVE (WebRTC)
                                                  </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setShowInlineWebRtc(false);
                                                    }}
                                                    className="btn btn-secondary py-1.5 text-[0.7rem] rounded flex items-center justify-center gap-1 hover:text-danger hover:border-danger/30 transition-colors cursor-pointer font-semibold"
                                                  >
                                                    <X size={11} /> Close Preview
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      void handleCopyMacVlcCommand(stream.streamUrl);
                                                    }}
                                                    className="btn btn-secondary py-1.5 px-2 text-[0.7rem] rounded flex items-center justify-center gap-1.5 cursor-pointer font-semibold truncate"
                                                    title="Copy macOS Terminal Command"
                                                  >
                                                    <Terminal size={11} /> Copy Command
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="grid grid-cols-2 gap-1.5">
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShowInlineWebRtc(true);
                                                  }}
                                                  className="btn btn-primary py-1.5 px-2 text-[0.7rem] rounded flex items-center justify-center gap-1.5 font-semibold cursor-pointer"
                                                >
                                                  <Play size={11} /> Play Live View
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    void handleCopyMacVlcCommand(stream.streamUrl);
                                                  }}
                                                  className="btn btn-secondary py-1.5 px-2 text-[0.7rem] rounded flex items-center justify-center gap-1.5 cursor-pointer font-semibold truncate"
                                                  title="Copy macOS Terminal Command"
                                                >
                                                  <Terminal size={11} /> Copy Terminal Command
                                                </button>
                                              </div>
                                            )
                                          ) : (
                                            <div className="flex flex-col gap-1.5">
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  void handleCopyMacVlcCommand(stream.streamUrl);
                                                }}
                                                className="btn btn-secondary w-full py-1.5 px-2 text-[0.7rem] rounded flex items-center justify-center gap-1.5 cursor-pointer font-semibold"
                                              >
                                                <Terminal size={11} /> Copy Terminal Command
                                              </button>
                                              <p className="text-[0.65rem] text-text-muted leading-relaxed mt-1 text-center">
                                                Live preview is not supported in-browser for this RTSP stream.
                                              </p>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}
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
              {(liveFeedOpen || selectedStreamId) && !usesRtspExternal && (
                <div className="glass-panel p-5 relative">
                  <div className={`flex justify-between items-center gap-2 flex-wrap ${liveFeedOpen ? 'mb-4' : ''}`}>
                    <h2 className="text-[1.1rem] flex items-center gap-2">
                      <Video size={18} color="var(--color-secondary)" />
                      {usesWebPreview ? 'Live Camera Feed' : 'Camera Stream'}
                    </h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      {liveFeedOpen && status === 'Error' && (
                        <div className="text-[0.7rem] font-semibold flex items-center gap-1.5 py-1 px-2.5 rounded-full bg-[rgba(244,63,94,0.15)] text-danger border border-[rgba(244,63,94,0.35)]">
                          <AlertTriangle size={11} />
                          Camera error
                        </div>
                      )}
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
                          onClick={() => selectedStream && openStreamFeed(selectedStream)}
                          disabled={!selectedStream}
                          className="btn btn-secondary py-1 px-2.5 text-[0.75rem] rounded-md flex items-center gap-1.5"
                        >
                          <Play size={12} />
                          Open Feed
                        </button>
                      )}
                    </div>
                  </div>

                  {liveFeedOpen && (
                    <div className={`bg-[#090d16] rounded-xl w-full relative border border-[rgba(255,255,255,0.05)] ${activeStreamError && !liveFrame && usesWebPreview ? 'min-h-0' : 'min-h-[200px] overflow-hidden'}`}>

                      {selectedStreamId && status !== 'Offline' ? (
                        usesExternalView ? (
                          <div className="w-full p-4 sm:p-6 min-h-[200px] flex flex-col items-center justify-center text-center">
                            <div className="bg-[rgba(124,58,237,0.12)] p-3 rounded-xl mb-4">
                              <Activity size={28} className="text-[#a78bfa]" />
                            </div>
                            <p className="text-[0.95rem] font-semibold text-text-primary">
                              {status === 'Recording' ? 'Recording motion clip' : status === 'Monitoring' ? 'Monitoring for motion' : status}
                            </p>
                            <p className="text-[0.78rem] text-text-muted mt-2 max-w-md leading-relaxed">
                              Live browser preview is disabled to reduce edge CPU and bandwidth. Motion detection,
                              clip recording, and hub commands still run normally.
                            </p>
                            {motionActive && (
                              <p className="text-[0.75rem] text-danger mt-3 font-semibold">
                                Motion detected: {(motionRatio * 100).toFixed(1)}%
                              </p>
                            )}
                            {activeStreamError && (
                              <div className="w-full mt-5 text-left bg-[rgba(244,63,94,0.08)] border border-[rgba(244,63,94,0.35)] rounded-xl p-4 max-w-lg">
                                <p className="text-[0.85rem] font-semibold text-danger">
                                  {getStreamErrorTitle(activeStreamError.errorType)}
                                </p>
                                <p className="text-[0.78rem] text-text-muted mt-2 leading-relaxed">
                                  {getStreamErrorHint(activeStreamError.errorType, activeStreamError.message)}
                                </p>
                              </div>
                            )}
                            <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                              <button
                                type="button"
                                onClick={() => setShowConfigDialog(true)}
                                className="btn btn-secondary py-1.5 px-3 text-[0.75rem] rounded-md flex items-center gap-1.5"
                              >
                                <Settings size={12} />
                                Stream Settings
                              </button>
                            </div>
                          </div>
                        ) : activeStreamError && !liveFrame ? (
                          <div className="w-full p-4 sm:p-5">
                            <div className="bg-[rgba(244,63,94,0.08)] border border-[rgba(244,63,94,0.35)] rounded-xl p-4 sm:p-5">
                              <div className="flex items-start gap-3 mb-3">
                                <div className="bg-[rgba(244,63,94,0.15)] p-2 rounded-lg shrink-0">
                                  <AlertTriangle size={18} className="text-danger" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[0.95rem] font-semibold text-danger leading-snug">
                                    {getStreamErrorTitle(activeStreamError.errorType)}
                                  </p>
                                  {selectedStream?.streamUrl && selectedStream.cameraType === 'rtsp' && (
                                    <p className="text-[0.7rem] text-text-muted mt-1 break-all">
                                      RTSP: {selectedStream.streamUrl}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="bg-[rgba(0,0,0,0.35)] rounded-lg px-3 py-2.5 mb-3 border border-[rgba(255,255,255,0.06)]">
                                <p className="text-[0.72rem] uppercase tracking-wide text-text-muted mb-1">Error detail</p>
                                <p className="text-[0.8rem] text-text-primary leading-relaxed break-words">
                                  {activeStreamError.message}
                                </p>
                              </div>

                              <p className="text-[0.78rem] text-amber-300/90 leading-relaxed mb-3">
                                {getStreamErrorHint(activeStreamError.errorType, activeStreamError.message)}
                              </p>

                              {activeStreamError.retryInSec != null && activeStreamError.retryInSec > 0 && (
                                <p className="text-[0.72rem] text-text-muted mb-4">
                                  Edge agent will retry automatically in ~{Math.ceil(activeStreamError.retryInSec)}s.
                                </p>
                              )}

                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setShowConfigDialog(true)}
                                  className="btn btn-secondary py-1.5 px-3 text-[0.75rem] rounded-md flex items-center gap-1.5"
                                >
                                  <Settings size={12} />
                                  Check Stream Settings
                                </button>
                                <button
                                  type="button"
                                  onClick={() => refreshStreamPreview('manual retry after error')}
                                  className="btn btn-secondary py-1.5 px-3 text-[0.75rem] rounded-md flex items-center gap-1.5"
                                >
                                  <RefreshCw size={12} />
                                  Retry Now
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="w-full relative min-h-[200px]">
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

                            {streamLoading && !activeStreamError && (
                              <div className="text-center text-text-muted absolute inset-0 flex flex-col justify-center items-center bg-[#090d16]/80 px-4">
                                <div className="animate-[spin_4s_linear_infinite] mb-3 inline-block">
                                  <RefreshCw size={36} color="var(--color-primary)" />
                                </div>
                                {streamInitTimedOut ? (
                                  <>
                                    <p className="text-[0.9rem] text-amber-400">Live stream stalled</p>
                                    <p className="text-[0.75rem] mt-1 max-w-md">
                                      No frames received from the edge device. Check System Status Logs below for
                                      camera or WebSocket errors. Recovery is retrying automatically.
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => refreshStreamPreview('manual retry')}
                                      className="btn btn-secondary mt-3 py-1.5 px-3 text-[0.75rem] rounded-md flex items-center gap-1.5"
                                    >
                                      <RefreshCw size={12} />
                                      Retry Preview Now
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-[0.9rem]">Initializing Live Stream...</p>
                                    <p className="text-[0.75rem] mt-1">Connecting to edge camera (WebSocket)</p>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )
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
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h2 className="text-[1.1rem] flex items-center gap-2">
                    <Terminal size={18} color="var(--color-secondary)" /> System Status Logs
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowSystemLogsDialog(true)}
                    className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md flex items-center gap-1 shrink-0"
                    title="View logs fullscreen"
                    aria-label="View logs fullscreen"
                  >
                    <Maximize2 size={12} />
                    Expand
                  </button>
                </div>
                <div className="font-mono bg-[rgba(0,0,0,0.5)] rounded-lg p-3.5 text-[0.85rem] leading-[1.4] text-[#38bdf8] h-[180px] overflow-y-auto border border-[rgba(255,255,255,0.05)]" ref={terminalContainerRef}>
                  <SystemStatusLogsList logs={logs} selectedStreamId={selectedStreamId} />
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
                <EventsTab events={eventsTab} />
              ) : activeTab === 'reid' ? (
                <ReidTab reid={reidTab} view={reidTab.reidView} />
              ) : null}
            </div>


          </div>

          <SystemStatusLogsDialog
            open={showSystemLogsDialog}
            onClose={() => setShowSystemLogsDialog(false)}
            logs={logs}
            selectedStreamId={selectedStreamId}
          />

          <DeviceLogsDialog
            device={deviceLogsDevice}
            onClose={closeDeviceLogsModal}
            registerLiveLogSink={registerDeviceLogSink}
            registerLiveEventSink={registerDeviceEventSink}
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
            device={devices.find((d) => d.deviceId === deviceConfigDeviceId) ?? null}
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


