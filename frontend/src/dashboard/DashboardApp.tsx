/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Camera,
  Settings,
  Fingerprint,
  // AlertTriangle,
  Bell,
  BellRing,
  Film,
  Monitor,
  // Map as MapIcon,
  Clock,
  Server,
  ChevronLeft,
} from 'lucide-react';
import {
  apiFetch,
  getStoredOrg,
  fetchMe,
  DEFAULT_ORG_SETTINGS,
  type AuthOrg,
  type AuthUser,
  type OrgSettings,
} from '../api';
import { clearLoggedIn } from '../auth';
import { exitImpersonation, isImpersonating } from '../adminApi';
import OrgSettingsPage from '../OrgSettings';
import { identifyUser, trackEvent } from '../lib/posthog';
import {
  createDefaultDeviceConfig,
  DEFAULT_STREAM_CONFIG,
  type EffectiveEdgeDeviceConfig,
} from '../edgeConfig';
import { WS_BASE } from './constants';
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
import { fetchNotifications, fetchUnreadCount, markNotificationsRead, deleteNotification, clearAllNotifications } from '../notificationsApi';


import { dashboardTabFromPath } from './utils/routing';
import { EventsTab, type EventsTabRef, ReidTab, DevicesStreamsTab, NotificationsTab } from './components/tabs';
import { ManageNotificationsTab } from './components/tabs/ManageNotificationsTab';
import { LiveWallTab } from './components/tabs/LiveWallTab';
import { ClipLibraryTab } from './components/tabs/ClipLibraryTab';
import { AskCameraAiTab } from './components/tabs/AskCameraAiTab';
import { ConfigurationTab } from './components/tabs/ConfigurationTab';
import {
  DeviceConfigDialog,
  DeviceLogsDialog,
  type DeviceLogTab,
  DeviceMetricsDialog,
  StreamConfigDialog,
  SystemStatusLogsDialog,
} from './components/modals';
import { useReidTab } from './hooks';

function PremiseMapTab() {
  return (
    <div className="glass-panel p-5 rounded-2xl flex flex-col gap-4 animate-[slideUp_0.3s_ease-out] w-full min-h-[calc(100vh-140px)] justify-center items-center text-center">
      <div className="max-w-xl w-full flex flex-col gap-6">
        <h3 className="text-[1.25rem] font-bold text-text-primary">Premise Camera Map</h3>
        {/* Mock plan overlay */}
        <div className="relative border border-border-glass rounded-xl overflow-hidden bg-gradient-to-br from-[#0c121e] to-[#04060b] aspect-[16/9] flex items-center justify-center">
          {/* Grid lines */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

          {/* Blueprint-style outline drawings */}
          <div className="absolute inset-10 border border-dashed border-[rgba(255,255,255,0.05)] rounded-lg pointer-events-none flex items-center justify-center">
            <span className="text-[0.7rem] text-text-muted select-none uppercase tracking-widest font-mono">West Campus</span>
          </div>
          <div className="absolute top-1/4 left-1/3 w-1/3 h-1/2 border border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.005)] rounded pointer-events-none" />

          {/* Camera pin placements */}
          {[
            { code: 'C-01', top: '20%', left: '25%', name: 'Main Entrance' },
            { code: 'C-04', top: '45%', left: '35%', name: 'Lobby' },
            { code: 'C-07', top: '75%', left: '15%', name: 'Loading Dock' },
            { code: 'C-12', top: '35%', left: '65%', name: 'Reception' },
            { code: 'C-15', top: '60%', left: '75%', name: 'East Corridor' },
            { code: 'C-18', top: '80%', left: '55%', name: 'Server Room' },
          ].map((pin) => (
            <div
              key={pin.code}
              className="absolute group"
              style={{ top: pin.top, left: pin.left }}
            >
              <div className="w-3.5 h-3.5 rounded-full bg-[var(--color-secondary)] border-2 border-white flex items-center justify-center cursor-pointer shadow-[0_0_12px_var(--color-secondary)] active:scale-95 transition-all duration-200">
                <span className="w-1.5 h-1.5 rounded-full bg-white block"></span>
              </div>
              {/* Tooltip on hover */}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded bg-[rgba(9,13,22,0.85)] border border-border-glass shadow-lg pointer-events-none select-none opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap z-50 flex flex-col text-left">
                <span className="text-[0.65rem] font-bold text-[var(--color-secondary)] font-mono">{pin.code}</span>
                <span className="text-[0.72rem] font-semibold text-white mt-0.5">{pin.name}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[0.8rem] text-text-muted">Interactive map showing locations of all registered cameras across the facility premise. Hover over camera nodes to see location tags.</p>
      </div>
    </div>
  );
}

export default function DashboardApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const appView = location.pathname.startsWith('/app/settings') ? 'settings' : 'dashboard';
  const activeTab = dashboardTabFromPath(location.pathname) ?? 'live';

  const [isSidebarExpanded, setIsSidebarExpanded] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sidebar-expanded');
      return stored === null ? true : stored === 'true';
    }
    return true;
  });

  const toggleSidebar = () => {
    setIsSidebarExpanded((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar-expanded', String(next));
      return next;
    });
  };

  const [cameraTime, setCameraTime] = useState('');
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const formatTime = (t: number) => String(t).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const m = months[now.getMonth()];
      const d = now.getDate();
      setCameraTime(`${formatTime(now.getHours())}:${formatTime(now.getMinutes())}:${formatTime(now.getSeconds())} UTC-05 ${m} ${d}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const [currentDateTimeStr, setCurrentDateTimeStr] = useState('');
  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      const datePart = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
      const pad = (n: number) => String(n).padStart(2, '0');
      const timePart = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      setCurrentDateTimeStr(`${datePart}, ${timePart}`);
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const [currentOrg, setCurrentOrg] = useState<AuthOrg | null>(() => getStoredOrg());
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [orgSettings, setOrgSettings] = useState<OrgSettings>(DEFAULT_ORG_SETTINGS);

  // App States
  const [devices, setDevices] = useState<EdgeDevice[]>([]);
  const [streams, setStreams] = useState<CameraStream[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  if (selectedDeviceId) { /* state tracked for modals */ }
  const [selectedStreamId, setSelectedStreamId] = useState<string>('');
  const [showConfigDialog, setShowConfigDialog] = useState<boolean>(false);
  const [showDeviceConfigDialog, setShowDeviceConfigDialog] = useState<boolean>(false);
  const [deviceConfigDeviceId, setDeviceConfigDeviceId] = useState<string | null>(null);
  const [deviceConfig, setDeviceConfig] = useState<EffectiveEdgeDeviceConfig>(createDefaultDeviceConfig());
  const [deviceConfigName, setDeviceConfigName] = useState('');
  // When non-null, the dialog is in "add" mode and this is the target deviceId
  const [addingStreamForDeviceId, setAddingStreamForDeviceId] = useState<string | null>(null);
  const [deviceLogsDevice, setDeviceLogsDevice] = useState<{ deviceId: string; name: string; initialTab: DeviceLogTab } | null>(null);
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

  const handleDeleteNotification = async (id: string) => {
    try {
      const data = await deleteNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setUnreadNotificationCount(data.unreadCount);
    } catch (err) {
      console.error(`Failed to delete notification ${id}:`, err);
    }
  };

  const handleClearAllNotifications = async () => {
    try {
      await clearAllNotifications();
      setNotifications([]);
      setUnreadNotificationCount(0);
    } catch (err) {
      console.error('Failed to clear notifications:', err);
    }
  };

  useEffect(() => {
    fetchMe()
      .then((data) => {
        setCurrentUser(data.user);
        if (data.org) setCurrentOrg(data.org);
        if (data.settings) setOrgSettings(data.settings);
        if (data.user) {
          identifyUser(data.user.id, {
            email: data.user.email,
            name: data.user.name,
            orgId: data.org?.id,
            orgName: data.org?.name
          });
        }
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (currentOrg) {
      loadNotifications();
    }
  }, [currentOrg, loadNotifications]);

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
  const [logs, setLogs] = useState<{ message: string; timestamp: string }[]>([]);
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

  const terminalContainerRef = useRef<HTMLDivElement | null>(null);

  const [showInlineWebRtc, setShowInlineWebRtc] = useState<boolean>(true);
  const showInlineWebRtcRef = useRef(showInlineWebRtc);
  useEffect(() => {
    setShowInlineWebRtc(true);
  }, [selectedStreamId]);
  useEffect(() => {
    showInlineWebRtcRef.current = showInlineWebRtc;
  }, [showInlineWebRtc]);

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





  useEffect(() => {
    selectedStreamIdRef.current = selectedStreamId;
    selectedStreamDeviceIdRef.current = selectedStream?.deviceId ?? null;
  }, [selectedStreamId, selectedStream?.deviceId]);

  const eventsTabRef = useRef<EventsTabRef>(null);

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
            eventsTabRef.current?.handleSelectClip(clip);
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
    }
  }, []);



  useEffect(() => {
    if (location.pathname === '/app' || location.pathname === '/app/') {
      navigate('/app/live', { replace: true });
      return;
    }
    if (location.pathname.startsWith('/app/settings')) return;
  }, [location.pathname, navigate]);

  useEffect(() => {
    onlineDeviceIdsRef.current = onlineDeviceIds;
  }, [onlineDeviceIds]);

  useEffect(() => {
    fetchClipsRef.current = () => eventsTabRef.current?.fetchClips() ?? Promise.resolve();
    handleNewClipRef.current = (clip) => eventsTabRef.current?.handleNewClip(clip);
    triggerReidRefreshRef.current = reidTab.triggerReidRefresh;
  }, [reidTab.triggerReidRefresh]);

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
      if (currentStreamId && showInlineWebRtcRef.current) {
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
                      crossCameraReid: data.cameraConfig.crossCameraReid ?? true,
                      aiSummaryEnabled: data.cameraConfig.aiSummaryEnabled ?? true,
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
          break;
        case 'stream_error':
          if (data.streamId === selectedStreamIdRef.current) {
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
        });
        setStatus(stream.status);
        setSelectedDeviceId(stream.deviceId);
      });
    }
  }, [selectedStreamId, streams]);



  // Subscribe/unsubscribe live preview when a stream is selected and inline preview is active
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (selectedStreamId && showInlineWebRtc) {
      ws.send(JSON.stringify({ type: 'subscribe_stream', streamId: selectedStreamId }));
    } else {
      ws.send(JSON.stringify({ type: 'unsubscribe_stream' }));
    }
  }, [selectedStreamId, showInlineWebRtc]);

  // Sync WS device subscription when stream changes
  useEffect(() => {
    if (!selectedStreamId) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const deviceId = selectedStream?.deviceId;
      if (deviceId) {
        wsRef.current.send(JSON.stringify({ type: 'subscribe_device', deviceId }));
      }
    }
  }, [selectedStreamId, selectedStream?.deviceId]);

  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [logs]);

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

  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchDevices();
    }, 30_000);
    return () => clearInterval(intervalId);
  }, [fetchDevices]);

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

  const handleUpdateStreamConfig = async (streamId: string, patch: Partial<CameraStream>) => {
    const stream = streams.find((s) => s.streamId === streamId);
    if (!stream) return;

    try {
      await apiFetch(`/streams/${streamId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (streamId === selectedStreamId) {
        setConfig((prev) => ({
          ...prev,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.cameraType !== undefined ? { type: patch.cameraType } : {}),
          ...(patch.streamUrl !== undefined ? { streamUrl: patch.streamUrl } : {}),
          ...(patch.trackingEnabled !== undefined ? { trackingEnabled: patch.trackingEnabled } : {}),
          ...(patch.motionThreshold !== undefined ? { motionThreshold: patch.motionThreshold } : {}),
          ...(patch.pixelChangeThreshold !== undefined ? { pixelChangeThreshold: patch.pixelChangeThreshold } : {}),
          ...(patch.detectPerson !== undefined ? { detectPerson: patch.detectPerson } : {}),
          ...(patch.detectVehicle !== undefined ? { detectVehicle: patch.detectVehicle } : {}),
        }));
      }
      fetchDevices();
    } catch (err) {
      console.error('Failed to update stream configuration', err);
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



  const openDeviceLogsModal = (
    deviceId: string,
    name: string,
    e: React.MouseEvent,
    initialTab: DeviceLogTab = 'events',
  ) => {
    e.stopPropagation();
    setDeviceLogsDevice({ deviceId, name, initialTab });
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
      trackEvent('save_stream_config', { streamId: result.streamId });
      setSelectedStreamId(result.streamId);
    }
  };

  const handleDeleteDevice = async (deviceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this edge device and all its streams?')) return;
    try {
      trackEvent('delete_device', { deviceId });
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
    return <Navigate to="/app/live" replace />;
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-bg-dark)] text-[var(--color-text-primary)] w-full">
      {/* LEFT NARROW SIDEBAR */}
      <div
        className={`bg-[#070b13] border-r border-border-glass flex flex-col justify-between py-6 shrink-0 z-50 select-none transition-all duration-300 ease-in-out ${isSidebarExpanded ? 'w-64 px-4' : 'w-16 md:w-20 px-2'
          }`}
      >
        <div className="flex flex-col gap-6 items-center w-full">
          {/* Logo & Toggle Header */}
          <div
            className={`flex items-center w-full ${isSidebarExpanded ? 'justify-between px-2' : 'justify-center'
              }`}
          >
            <div
              onClick={toggleSidebar}
              className="flex items-center gap-3 cursor-pointer group"
              title={isSidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <div className="p-2 bg-[rgba(255,255,255,0.02)] border border-border-glass rounded-xl shadow-inner select-none flex items-center justify-center group-hover:border-[var(--color-secondary)] transition-colors duration-200">
                <svg viewBox="0 0 24 24" className="w-6 h-6 text-[var(--color-secondary)] fill-none stroke-current stroke-2">
                  <rect x="2" y="2" width="20" height="20" rx="6" />
                  <circle cx="12" cy="12" r="5" />
                  <circle cx="12" cy="12" r="1.5" className="fill-current" />
                </svg>
              </div>
              {isSidebarExpanded && (
                <span className="font-heading font-extrabold text-[0.95rem] tracking-wider bg-gradient-to-r from-white via-text-secondary to-[var(--color-secondary)] bg-clip-text text-transparent animate-[fadeIn_0.2s_ease-out] whitespace-nowrap">
                  AURA WATCH
                </span>
              )}
            </div>
            {isSidebarExpanded && (
              <button
                onClick={toggleSidebar}
                className="p-1.5 rounded-lg hover:bg-[rgba(255,255,255,0.05)] text-text-muted hover:text-white border-none outline-none cursor-pointer transition-colors"
                title="Collapse sidebar"
              >
                <ChevronLeft size={16} />
              </button>
            )}
          </div>

          {/* Divider */}
          <div className="w-full px-2">
            <div className="h-[1px] bg-border-glass w-full" />
          </div>

          {/* Tab buttons */}
          <div className="flex flex-col gap-3 w-full">
            {[
              { tab: 'live' as const, icon: Camera, title: 'Live wall' },
              { tab: 'events' as const, icon: Film, title: 'Event archive', hasBadge: true },
              // { tab: 'clips' as const, icon: Film, title: 'Clip library' },
              { tab: 'reid' as const, icon: Fingerprint, title: 'Cross-Camera ReID' },
              { tab: 'ai' as const, icon: Monitor, title: 'Ask Camera AI' },
              // { tab: 'map' as const, icon: MapIcon, title: 'Premise map' },
              { tab: 'devices' as const, icon: Server, title: 'Streaming Devices' },
              { tab: 'custom-alerts' as const, icon: BellRing, title: 'Custom Alerts' },
            ].map(({ tab, icon: Icon, title, hasBadge }) => {
              const isSelected = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => navigate(`/app/${tab}`)}
                  title={isSidebarExpanded ? undefined : title}
                  className={`relative p-3 rounded-xl transition-all duration-200 border-none outline-none cursor-pointer group flex items-center ${isSidebarExpanded ? 'justify-start gap-3 w-full px-4' : 'justify-center'
                    } ${isSelected
                      ? 'bg-[rgba(6,182,212,0.1)] text-[var(--color-secondary)] border border-[rgba(6,182,212,0.2)]'
                      : 'text-text-muted hover:text-text-secondary hover:bg-[rgba(255,255,255,0.02)]'
                    }`}
                >
                  <Icon size={20} className={`shrink-0 ${isSelected ? 'stroke-[2.5px]' : 'stroke-2'}`} />
                  {isSidebarExpanded && (
                    <span className="text-[0.85rem] font-semibold tracking-wide whitespace-nowrap animate-[fadeIn_0.2s_ease-out]">
                      {title}
                    </span>
                  )}
                  {hasBadge && unreadNotificationCount > 0 && (
                    isSidebarExpanded ? (
                      <span className="ml-auto px-2 py-0.5 text-[0.65rem] font-bold rounded-full bg-[var(--color-danger)] text-white">
                        {unreadNotificationCount}
                      </span>
                    ) : (
                      <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[var(--color-danger)] animate-pulse" />
                    )
                  )}
                  {/* Tooltip on hover */}
                  {!isSidebarExpanded && (
                    <div className="absolute left-16 px-2.5 py-1 rounded bg-[rgba(9,13,22,0.9)] border border-border-glass shadow-lg pointer-events-none select-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 text-[0.75rem] font-bold text-white">
                      {title}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* User initials & notifications bell */}
        <div className={`flex flex-col gap-4 w-full ${isSidebarExpanded ? 'items-stretch' : 'items-center'}`}>
          {/* Notifications Page Link */}
          <button
            onClick={() => navigate('/app/notifications')}
            className={`rounded-xl transition-all duration-200 border-none outline-none cursor-pointer relative flex items-center ${isSidebarExpanded ? 'justify-start gap-3 w-full px-4 py-3' : 'justify-center p-3'
              } ${activeTab === 'notifications'
                ? 'bg-[rgba(6,182,212,0.1)] text-[var(--color-secondary)] border border-[rgba(6,182,212,0.2)]'
                : 'text-text-muted hover:text-text-secondary hover:bg-[rgba(255,255,255,0.02)]'
              }`}
            title={isSidebarExpanded ? undefined : "Notifications"}
          >
            <Bell size={20} className="shrink-0" />
            {isSidebarExpanded && (
              <span className="text-[0.85rem] font-semibold tracking-wide whitespace-nowrap animate-[fadeIn_0.2s_ease-out]">
                Notifications
              </span>
            )}
            {unreadNotificationCount > 0 && (
              isSidebarExpanded ? (
                <span className="ml-auto px-2 py-0.5 text-[0.65rem] font-bold rounded-full bg-[var(--color-danger)] text-white">
                  {unreadNotificationCount}
                </span>
              ) : (
                <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-[var(--color-danger)] text-[0.55rem] font-bold text-white leading-none scale-90">
                  {unreadNotificationCount}
                </span>
              )
            )}
          </button>

          {/* Switch Org/Org Settings Option if settings tab isn't open */}
          <button
            onClick={() => navigate('/app/settings')}
            className={`rounded-xl transition-all duration-200 border-none outline-none cursor-pointer hover:bg-[rgba(255,255,255,0.02)] text-text-muted hover:text-text-secondary flex items-center ${isSidebarExpanded ? 'justify-start gap-3 w-full px-4 py-3' : 'justify-center p-3'
              } ${appView === 'settings'
                ? 'text-[var(--color-primary)] bg-[rgba(124,58,237,0.05)] border border-[rgba(124,58,237,0.15)]'
                : ''
              }`}
            title={isSidebarExpanded ? undefined : "Organization settings"}
          >
            <Settings size={20} className="shrink-0" />
            {isSidebarExpanded && (
              <span className="text-[0.85rem] font-semibold tracking-wide whitespace-nowrap animate-[fadeIn_0.2s_ease-out]">
                Org Settings
              </span>
            )}
          </button>

          {/* Divider */}
          <div className="w-full px-2">
            <div className="h-[1px] bg-border-glass w-full" />
          </div>

          {/* User profile initials circle */}
          <div
            onClick={handleLogout}
            title="Sign out"
            className={`flex items-center gap-3 w-full rounded-xl cursor-pointer transition-all duration-200 select-none ${isSidebarExpanded ? 'hover:bg-[rgba(255,255,255,0.02)] p-2' : 'justify-center'
              }`}
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-secondary)] text-white font-extrabold text-[0.8rem] flex items-center justify-center shadow-[0_0_12px_var(--color-primary-glow)] shrink-0 hover:scale-105 active:scale-95 transition-all duration-200">
              {currentUser?.name?.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase() || 'JM'}
            </div>
            {isSidebarExpanded && (
              <div className="flex flex-col text-left overflow-hidden animate-[fadeIn_0.2s_ease-out]">
                <span className="text-[0.8rem] font-bold text-text-primary truncate">
                  {currentUser?.name || 'User'}
                </span>
                <span className="text-[0.65rem] text-text-muted truncate">
                  Sign out
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notification Drawer */}
      <NotificationDrawer
        isOpen={notificationsDrawerOpen}
        onClose={() => setNotificationsDrawerOpen(false)}
        notifications={notifications}
        loading={loadingNotifications}
        onMarkAllRead={handleMarkAllRead}
        onMarkRead={handleMarkRead}
        onNotificationClick={handleNotificationClick}
        onViewAll={() => {
          setNotificationsDrawerOpen(false);
          navigate('/app/notifications');
        }}
        streams={streams}
      />

      {/* MAIN CONTAINER */}
      <div className="flex-1 flex flex-col p-6 overflow-y-auto max-h-screen">
        {/* TOP STATUS BAR */}
        <div className="flex flex-wrap justify-between items-center gap-4 pb-4 border-b border-border-glass mb-6 shrink-0 select-none text-left">
          <div className="flex items-center gap-3">
            {activeTab !== 'devices' && (
              <>
                {/* Pulsing armed badge */}
                <div className="flex items-center gap-2 bg-[rgba(52,211,153,0.08)] px-3 py-1 rounded-full border border-[rgba(52,211,153,0.22)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                  <span className="text-[0.65rem] font-black tracking-widest text-emerald-400 uppercase">SYSTEM ARMED</span>
                </div>

                <div className="w-[1px] h-4 bg-border-glass" />
              </>
            )}

            {/* Dynamic Active Tab Name & Subtitle */}
            <div className="flex flex-col">
              <h1 className="text-[1.15rem] font-extrabold text-text-primary capitalize leading-none tracking-tight">
                {activeTab === 'live' && 'Live monitoring'}
                {activeTab === 'events' && 'Event archive'}
                {activeTab === 'clips' && 'Clip library'}
                {activeTab === 'reid' && 'Cross-Camera ReID'}
                {activeTab === 'ai' && 'Ask Camera AI'}
                {activeTab === 'map' && 'Premise map'}
                {activeTab === 'devices' && (
                  <span className="flex items-center gap-2 flex-wrap">
                    <span>Streaming Devices</span>
                    <span className="text-text-muted font-bold">·</span>
                    <span className="text-[0.8rem] text-text-muted font-bold font-sans mt-0.5 normal-case">
                      {currentOrg?.name || 'Petrol Station Complex, Sector 57, Gurgaon'}
                    </span>
                  </span>
                )}
                {activeTab === 'custom-alerts' && 'Manage Notifications'}
                {activeTab === 'notifications' && 'Notification Center'}
                {appView === 'settings' && 'Org settings'}
              </h1>
              {activeTab !== 'devices' && (
                <p className="text-[0.72rem] text-text-muted mt-1 leading-none font-semibold">
                  {activeTab === 'live' && 'Control Room'}
                  {activeTab === 'events' && 'All zones · last 24 hours'}
                  {activeTab === 'clips' && 'Recorded & flagged footage'}
                  {activeTab === 'reid' && 'Multi-camera tracking & path analysis'}
                  {activeTab === 'ai' && 'Natural-language video search'}
                  {activeTab === 'map' && 'Interactive camera location mapping'}
                  {activeTab === 'custom-alerts' && 'Alert subscriptions & integrations'}
                  {activeTab === 'notifications' && 'System & security notification feed'}
                  {appView === 'settings' && 'Manage your organization, billing, and team members'}
                </p>
              )}
            </div>
          </div>

          {/* Right Statistics / Time */}
          {activeTab === 'devices' ? (
            <div className="flex items-center gap-3">
              {unreadNotificationCount > 0 ? (
                <div className="flex items-center gap-1.5 bg-[#EF4444]/10 border border-[#EF4444]/20 px-2.5 py-1 rounded-full text-[#EF4444] text-[0.68rem] font-bold tracking-wider leading-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444] animate-pulse" />
                  THREAT ACTIVE
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-[rgba(255,255,255,0.02)] border border-border-glass px-2.5 py-1 rounded-full text-text-muted text-[0.68rem] font-bold tracking-wider leading-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
                  NO THREATS
                </div>
              )}

              {streams.some(s => s.trackingEnabled) ? (
                <div className="flex items-center gap-1.5 bg-[#06B6D4]/10 border border-[#06B6D4]/20 px-2.5 py-1 rounded-full text-[#06B6D4] text-[0.68rem] font-bold tracking-wider leading-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#06B6D4] animate-pulse" />
                  AI ACTIVE
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-[rgba(255,255,255,0.02)] border border-border-glass px-2.5 py-1 rounded-full text-text-muted text-[0.68rem] font-bold tracking-wider leading-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
                  AI INACTIVE
                </div>
              )}

              <div className="w-[1px] h-3.5 bg-border-glass" />
              <div className="text-[0.75rem] text-text-secondary font-mono tracking-wider font-semibold">
                {currentDateTimeStr || cameraTime}
              </div>
            </div>
          ) : (
            <div className="flex items-center divide-x divide-border-glass text-[0.72rem] text-text-muted font-bold">
              <div className="pr-4 flex items-center gap-1.5">
                <span>{streams.filter((s) => s.status !== 'Offline' && s.status !== 'Error').length} / {streams.length || 1} online</span>
              </div>
              <button
                type="button"
                onClick={() => setNotificationsDrawerOpen(true)}
                className="px-4 flex items-center gap-1.5 hover:text-text-primary transition-colors bg-transparent border-none outline-none cursor-pointer text-[0.72rem] text-text-muted font-bold font-sans"
              >
                <Bell size={12} className="text-text-muted shrink-0" />
                <span>{unreadNotificationCount} unread alerts</span>
              </button>
              <div className="pl-4 flex items-center gap-1.5 text-text-secondary">
                <Clock className="w-3.5 h-3.5 animate-pulse text-text-muted shrink-0" />
                <span className="font-mono">{cameraTime}</span>
              </div>
            </div>
          )}
        </div>

        {/* Impersonation Banner */}
        {isImpersonating() && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
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

        {/* TAB BODY PANE */}
        <div className="flex-1 min-h-0 w-full relative">
          {appView === 'settings' && currentOrg && currentUser ? (
            <OrgSettingsPage
              org={currentOrg}
              currentUserId={currentUser.id}
              onBack={() => navigate('/app/live')}
              onSettingsSaved={setOrgSettings}
            />
          ) : (
            <>
              {activeTab === 'live' && (
                <LiveWallTab
                  streams={streams}
                  onEditStream={(streamId) => {
                    navigate(`/app/devices?editStreamId=${streamId}`);
                  }}
                  onUpdateStreamConfig={handleUpdateStreamConfig}
                />
              )}

              {activeTab === 'events' && (
                <EventsTab
                  ref={eventsTabRef}
                  devices={devices}
                  streams={streams}
                  orgSettings={orgSettings}
                  onlineDeviceIds={onlineDeviceIds}
                  hasOnlineDevices={hasOnlineDevices}
                  isMobileViewport={isMobileViewport}
                  deviceNameById={deviceNameById}
                />
              )}

              {activeTab === 'clips' && <ClipLibraryTab />}

              {activeTab === 'reid' && (
                <ReidTab reid={reidTab} view={reidTab.reidView} />
              )}

              {activeTab === 'ai' && (
                <AskCameraAiTab
                  orgSettings={orgSettings}
                  streams={streams}
                />
              )}

              {activeTab === 'map' && <PremiseMapTab />}

              {activeTab === 'config' && (
                <ConfigurationTab
                  devices={devices}
                  streams={streams}
                  deviceCommandPending={deviceCommandPending}
                  logs={logs}
                  selectedStreamId={selectedStreamId}
                  orgId={currentOrg?.id ?? ''}
                  onAddStream={handleAddStream}
                  onDeleteDevice={handleDeleteDevice}
                  onDeviceReboot={handleDeviceReboot}
                  onOpenLogs={openDeviceLogsModal}
                  onOpenMetrics={openDeviceMetricsModal}
                  onOpenSettings={openDeviceConfigDialog}
                  onDeleteStream={handleDeleteStream}
                  onToggleStreamMonitoring={handleToggleStreamMonitoring}
                  onOpenSystemLogs={() => setShowSystemLogsDialog(true)}
                  setSelectedStreamId={setSelectedStreamId}
                  setSelectedDeviceId={setSelectedDeviceId}
                  setShowConfigDialog={setShowConfigDialog}
                  notifications={notifications}
                  onMarkRead={handleMarkRead}
                  onNotificationClick={handleNotificationClick}
                  onDeleteNotification={handleDeleteNotification}
                  onClearAllNotifications={handleClearAllNotifications}
                  currentOrg={currentOrg}
                />
              )}

              {activeTab === 'devices' && (
                <DevicesStreamsTab
                  devices={devices}
                  streams={streams}
                  orgId={currentOrg?.id ?? ''}
                  onOpenSettings={openDeviceConfigDialog}
                  onDeleteDevice={handleDeleteDevice}
                  onDeleteStream={handleDeleteStream}
                  fetchDevices={fetchDevices}
                  onOpenMetrics={(dev, e) => openDeviceMetricsModal(dev.deviceId, dev.name, e)}
                  onDeviceReboot={handleDeviceReboot}
                  onOpenDeviceLogs={openDeviceLogsModal}
                  deviceCommandPending={deviceCommandPending}
                />
              )}

              {activeTab === 'custom-alerts' && (
                <ManageNotificationsTab
                  notifications={notifications}
                  onMarkRead={handleMarkRead}
                  onNotificationClick={handleNotificationClick}
                  onDeleteNotification={handleDeleteNotification}
                  onClearAllNotifications={handleClearAllNotifications}
                  streams={streams}
                  currentOrg={currentOrg}
                />
              )}

              {activeTab === 'notifications' && (
                <NotificationsTab
                  notifications={notifications}
                  onMarkRead={handleMarkRead}
                  onMarkAllRead={handleMarkAllRead}
                  onDeleteNotification={handleDeleteNotification}
                  onClearAllNotifications={handleClearAllNotifications}
                  onNotificationClick={handleNotificationClick}
                  streams={streams}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* KEEP INTACT AND RENDER ALL DIALOGS / CONFIG MODALS */}
      <SystemStatusLogsDialog
        open={showSystemLogsDialog}
        onClose={() => setShowSystemLogsDialog(false)}
        logs={logs}
        selectedStreamId={selectedStreamId}
      />

      <DeviceLogsDialog
        device={deviceLogsDevice}
        initialTab={deviceLogsDevice?.initialTab}
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
    </div>
  );
}


