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
  RefreshCw,
  Cpu,
  Terminal,
  Video,
  Plus,
  X,
  Power,
  ScrollText,
  Download,
  AlertTriangle,
  SlidersHorizontal,
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
import { PREVIEW_STALL_MS, STREAM_INIT_TIMEOUT_MS, STREAM_REFRESH_COOLDOWN_MS, WS_BASE } from './constants';
import type {
  CameraConfig,
  CameraStream,
  EdgeDevice,
  LogEntry,
  VideoClip,
} from './types';
import { isEdgeUpdateAvailable } from './utils/clips';
import { dashboardTabFromPath } from './utils/routing';
import { DashboardHeader, DashboardPlaceholder, DeviceInstallTooltip } from './components';
import { DashboardTabs, EventsTab, ReidTab } from './components/tabs';
import {
  DeviceConfigDialog,
  DeviceLogsDialog,
  DeviceMetricsDialog,
  StreamConfigDialog,
} from './components/modals';
import { useEventsTab, useReidTab } from './hooks';

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
  const [refreshingDevices, setRefreshingDevices] = useState(false);

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

  const selectedStreamIdRef = useRef(selectedStreamId);
  const selectedStreamDeviceIdRef = useRef<string | null>(null);
  const fetchClipsRef = useRef<() => Promise<void>>(async () => {});
  const handleNewClipRef = useRef<(clip: VideoClip) => void>(() => {});
  const triggerReidRefreshRef = useRef<() => void>(() => {});
  const streamStatusRef = useRef<string>('Offline');
  const onlineDeviceIdsRef = useRef<Set<string>>(new Set());
  const deviceLogsDeviceRef = useRef(deviceLogsDevice);
  const deviceLogSinkRef = useRef<((entry: LogEntry) => void) | null>(null);

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
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [previewFrozen, setPreviewFrozen] = useState<boolean>(false);
  const lastFrameAtRef = useRef<number>(0);
  const lastStreamRefreshAtRef = useRef<number>(0);
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

  const hasOnlineDevices = onlineDeviceIds.size > 0;

  const selectedStream = useMemo(
    () => streams.find((s) => s.streamId === selectedStreamId) ?? null,
    [streams, selectedStreamId],
  );

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
    if (!streamId || !liveFeedOpenRef.current) return;

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

  const refreshDevices = useCallback(async () => {
    setRefreshingDevices(true);
    try {
      await apiFetch('/devices/check-versions', { method: 'POST' });
      await fetchDevices();
    } catch (err) {
      console.error('Failed to refresh device versions', err);
      await fetchDevices();
    } finally {
      setRefreshingDevices(false);
    }
  }, [fetchDevices]);

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
      if (currentStreamId && liveFeedOpenRef.current) {
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
            setPreviewFrozen(false);
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
      fetchDevices(true);
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
        });
        setStatus(stream.status);
        setSelectedDeviceId(stream.deviceId);
      });
    }
  }, [selectedStreamId, streams]);

  // Subscribe/unsubscribe live preview when the feed panel is toggled
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !selectedStreamId) return;

    if (liveFeedOpen) {
      setStreamLoading(true);
      setStreamInitTimedOut(false);
      setLiveFrame(null);
      lastFrameAtRef.current = 0;
      ws.send(JSON.stringify({ type: 'subscribe_stream', streamId: selectedStreamId }));
    } else {
      ws.send(JSON.stringify({ type: 'unsubscribe_stream' }));
      setStreamLoading(false);
      setStreamInitTimedOut(false);
      setPreviewFrozen(false);
      setLiveFrame(null);
    }
  }, [liveFeedOpen, selectedStreamId]);

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

  const wsNeeded = !!selectedStreamId || !!deviceLogsDevice;

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
    setStreamInitTimedOut(false);
    setPreviewFrozen(false);
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
    if (!liveFeedOpen) return;
    Promise.resolve().then(() => {
      setStreamLoading(true);
      setStreamInitTimedOut(false);
      setLiveFrame(null);
      setPreviewFrozen(false);
      lastFrameAtRef.current = 0;
      lastStreamRefreshAtRef.current = 0;
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
      const frozen = Date.now() - lastFrameAt > PREVIEW_STALL_MS;
      setPreviewFrozen(frozen);
      if (frozen) {
        refreshStreamPreview('no frames received in dashboard');
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [selectedStreamId, status, liveFeedOpen, refreshStreamPreview]);

  // Auto-recover when the live feed never receives its first frame
  useEffect(() => {
    if (!liveFeedOpen || !selectedStreamId || status === 'Offline' || !streamLoading) {
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
    streamLoading,
    appendLog,
    refreshStreamPreview,
  ]);

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
        await refreshDevices();
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
                <DeviceInstallTooltip onGenerateToken={handleGenerateEnrollmentToken} />
              </h2>
              <button
                onClick={() => refreshDevices()}
                disabled={refreshingDevices}
                className="btn btn-secondary py-1 px-2 text-[0.75rem] rounded-md flex items-center gap-1 disabled:opacity-50"
              >
                <RefreshCw size={12} className={refreshingDevices ? 'animate-spin' : ''} />
                {refreshingDevices ? 'Checking...' : 'Refresh List'}
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
                  {selectedStreamId
                    ? 'Waiting for edge device events... (camera errors, reconnects, and clip activity appear here)'
                    : 'Select a camera stream to view logs.'}
                </div>
              ) : (
                logs.map((log, index) => {
                  const isError = /\[Detector Error\]|WebSocket|stream lost|failed|error|timed out/i.test(log.message);
                  const isWarn = /stalled|retry|reconnect|cooldown/i.test(log.message);
                  return (
                    <div key={index} className="mb-1">
                      <span className="text-text-muted mr-2">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                      <span className={isError ? 'text-rose-400' : isWarn ? 'text-amber-300' : undefined}>
                        {log.message}
                      </span>
                    </div>
                  );
                })
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
            <EventsTab events={eventsTab} />
          ) : activeTab === 'reid' ? (
            <ReidTab reid={reidTab} view={reidTab.reidView} />
          ) : null}
        </div>


      </div>

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


