import React, { useState, useEffect, useRef } from 'react';
import {
  AlertCircle,
  Settings,
  Cpu,
  Plus,
  Trash2,
  Power,
  ScrollText,
  Activity,
  SlidersHorizontal,
  Maximize2,
  Terminal,
} from 'lucide-react';
import type { EdgeDevice, CameraStream, LogEntry, Notification } from '../../types';
import { SystemStatusLogsList } from '../SystemStatusLogsList';
import { DeviceInstallTooltip } from '../DeviceInstallTooltip';
import type { AuthOrg } from '../../../api';
import { ManageNotificationsTab } from './ManageNotificationsTab';

interface CameraItem {
  code: string;
  name: string;
  zone: string;
  status: 'online' | 'offline';
  recordingMode: 'Continuous' | 'Motion only' | 'Event-triggered';
  personDetection: boolean;
  vehicleDetection: boolean;
  unattendedObject: boolean;
  loitering: boolean;
  sensitivity: number;
  resolution: string;
  frameRate: string;
}

const initialCameras: CameraItem[] = [
  {
    code: 'C-01',
    name: 'Main Entrance',
    zone: 'Exterior zone',
    status: 'online',
    recordingMode: 'Motion only',
    personDetection: true,
    vehicleDetection: true,
    unattendedObject: true,
    loitering: true,
    sensitivity: 70,
    resolution: '2560 × 1440 · QHD',
    frameRate: '30 fps',
  },
  {
    code: 'C-04',
    name: 'Lobby',
    zone: 'Interior zone',
    status: 'online',
    recordingMode: 'Continuous',
    personDetection: true,
    vehicleDetection: false,
    unattendedObject: true,
    loitering: false,
    sensitivity: 65,
    resolution: '1920 × 1080 · FHD',
    frameRate: '30 fps',
  },
  {
    code: 'C-07',
    name: 'Loading Dock',
    zone: 'Exterior zone',
    status: 'online',
    recordingMode: 'Motion only',
    personDetection: true,
    vehicleDetection: true,
    unattendedObject: true,
    loitering: true,
    sensitivity: 75,
    resolution: '2560 × 1440 · QHD',
    frameRate: '30 fps',
  },
  {
    code: 'C-09',
    name: 'Parking West',
    zone: 'Exterior zone',
    status: 'online',
    recordingMode: 'Event-triggered',
    personDetection: true,
    vehicleDetection: true,
    unattendedObject: false,
    loitering: true,
    sensitivity: 80,
    resolution: '1920 × 1080 · FHD',
    frameRate: '15 fps',
  },
  {
    code: 'C-12',
    name: 'Reception',
    zone: 'Interior zone',
    status: 'online',
    recordingMode: 'Continuous',
    personDetection: true,
    vehicleDetection: false,
    unattendedObject: true,
    loitering: false,
    sensitivity: 60,
    resolution: '1920 × 1080 · FHD',
    frameRate: '30 fps',
  },
];

type SettingsTab = 'Detection' | 'Cameras' | 'Alert rules' | 'Integrations' | 'Devices';

interface ConfigurationTabProps {
  devices: EdgeDevice[];
  streams: CameraStream[];
  deviceCommandPending: string | null;
  logs: LogEntry[];
  selectedStreamId: string;
  orgId: string;
  onAddStream: (deviceId: string) => void;
  onDeleteDevice: (deviceId: string, e: React.MouseEvent) => void;
  onDeviceReboot: (deviceId: string, name: string, e: React.MouseEvent) => void;
  onOpenLogs: (deviceId: string, name: string, e: React.MouseEvent) => void;
  onOpenMetrics: (deviceId: string, name: string, e: React.MouseEvent) => void;
  onOpenSettings: (device: EdgeDevice, e: React.MouseEvent) => void;
  onDeleteStream: (streamId: string, e: React.MouseEvent) => void;
  onToggleStreamMonitoring: (streamId: string, enabled: boolean) => void;
  onOpenSystemLogs: () => void;
  setSelectedStreamId: (streamId: string | ((prev: string) => string)) => void;
  setSelectedDeviceId: (deviceId: string) => void;
  setShowConfigDialog: (show: boolean) => void;
  // Alert rules and notification handlers
  notifications: Notification[];
  onMarkRead: (id: string) => Promise<void>;
  onNotificationClick: (n: Notification) => void;
  onDeleteNotification: (id: string) => Promise<void>;
  onClearAllNotifications: () => Promise<void>;
  currentOrg: AuthOrg | null;
}

export function ConfigurationTab({
  devices,
  streams,
  deviceCommandPending,
  logs,
  selectedStreamId,
  orgId,
  onAddStream,
  onDeleteDevice,
  onDeviceReboot,
  onOpenLogs,
  onOpenMetrics,
  onOpenSettings,
  onDeleteStream,
  onToggleStreamMonitoring,
  onOpenSystemLogs,
  setSelectedStreamId,
  setSelectedDeviceId,
  setShowConfigDialog,
  notifications,
  onMarkRead,
  onNotificationClick,
  onDeleteNotification,
  onClearAllNotifications,
  currentOrg,
}: ConfigurationTabProps) {
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('Cameras');
  const [camerasList, setCamerasList] = useState<CameraItem[]>(initialCameras);
  const [selectedCameraCode, setSelectedCameraCode] = useState('C-01');
  const [cameraTime, setCameraTime] = useState('14:32:08');
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);

  // Sync clock ticking
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const formatTime = (t: number) => String(t).padStart(2, '0');
      setCameraTime(`${formatTime(now.getHours())}:${formatTime(now.getMinutes())}:${formatTime(now.getSeconds())}`);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Auto-scroll logs terminal
  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const selectedCam = camerasList.find((c) => c.code === selectedCameraCode) || camerasList[0];

  const updateSelectedCamera = (updates: Partial<CameraItem>) => {
    setCamerasList((prev) =>
      prev.map((c) => (c.code === selectedCam.code ? { ...c, ...updates } : c))
    );
  };

  return (
    <div className="flex flex-col gap-6 animate-[slideUp_0.3s_ease-out] w-full min-h-[calc(100vh-140px)]">
      {/* Configuration layout grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch flex-1">
        {/* LEFT COLUMN: Categories Submenu */}
        <div className="lg:col-span-2 flex flex-col gap-2">
          {(['Detection', 'Cameras', 'Alert rules', 'Integrations', 'Devices'] as const).map((tab) => {
            const isSelected = activeSettingsTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveSettingsTab(tab)}
                className={`w-full text-left py-2.5 px-4 rounded-xl text-[0.88rem] font-semibold transition-all duration-200 cursor-pointer border-none outline-none ${
                  isSelected
                    ? 'bg-[rgba(255,255,255,0.06)] text-white shadow-sm border border-border-glass'
                    : 'text-text-muted hover:text-text-secondary bg-transparent hover:bg-[rgba(255,255,255,0.015)]'
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {/* CONDITION-BASED MAIN VIEWS */}
        {activeSettingsTab === 'Devices' ? (
          /* DEVICES TAB: Renders Edge Devices list & system status logs */
          <div className="lg:col-span-10 grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Devices list panel */}
            <div className="md:col-span-7 glass-panel p-5 rounded-2xl flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-200px)]">
              <div className="flex justify-between items-center pb-2 border-b border-[rgba(255,255,255,0.04)]">
                <h2 className="text-[1.05rem] font-bold flex items-center gap-2">
                  <Cpu size={18} color="var(--color-primary)" /> Registered Edge Devices
                </h2>
                <DeviceInstallTooltip orgId={orgId} showAsButton />
              </div>

              {devices.length === 0 ? (
                <div className="text-text-muted text-[0.85rem] text-center p-8 border border-dashed border-border-glass rounded-lg">
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
                        className="border border-border-glass rounded-xl bg-[rgba(255,255,255,0.01)] p-4 flex flex-col gap-3 text-left"
                      >
                        {/* Device Header */}
                        <div className="flex justify-between items-center border-b border-[rgba(255,255,255,0.05)] pb-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-2 h-2 rounded-full inline-block flex-shrink-0 ${
                                  isDeviceOnline ? 'bg-emerald-400' : 'bg-text-muted'
                                }`}
                                style={{
                                  boxShadow: isDeviceOnline ? '0 0 8px var(--color-success)' : 'none',
                                }}
                              />
                              <h3 className="text-[0.9rem] font-bold text-text-primary truncate">
                                {dev.name}
                              </h3>
                            </div>
                            <p className="text-[0.7rem] text-text-muted mt-1 truncate">
                              ID: {dev.deviceId} • Status: {dev.status}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onAddStream(dev.deviceId)}
                              className="btn btn-secondary py-1 px-2.5 text-[0.72rem] rounded-lg flex items-center gap-1.5 font-bold"
                            >
                              <Plus size={12} /> Add Stream
                            </button>
                            <button
                              onClick={(e) => onDeleteDevice(dev.deviceId, e)}
                              className="btn p-1.5 bg-transparent text-text-muted hover:text-danger border border-transparent hover:border-danger/30 rounded-md shrink-0"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        {/* Device Actions */}
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={(e) => onDeviceReboot(dev.deviceId, dev.name, e)}
                            disabled={!isDeviceOnline || deviceCommandPending === `${dev.deviceId}:reboot`}
                            className="btn btn-secondary py-1 px-3 text-[0.7rem] rounded-lg flex items-center gap-1 disabled:opacity-40 font-bold"
                          >
                            <Power size={11} />
                            {deviceCommandPending === `${dev.deviceId}:reboot` ? 'Rebooting...' : 'Reboot'}
                          </button>
                          <button
                            onClick={(e) => onOpenLogs(dev.deviceId, dev.name, e)}
                            className="btn btn-secondary py-1 px-3 text-[0.7rem] rounded-lg flex items-center gap-1 font-bold"
                          >
                            <ScrollText size={11} /> Logs
                          </button>
                          <button
                            onClick={(e) => onOpenMetrics(dev.deviceId, dev.name, e)}
                            disabled={!isDeviceOnline}
                            className="btn btn-secondary py-1 px-3 text-[0.7rem] rounded-lg flex items-center gap-1 disabled:opacity-40 font-bold"
                          >
                            <Activity size={11} /> Metrics
                          </button>
                          <button
                            onClick={(e) => onOpenSettings(dev, e)}
                            className="btn btn-secondary py-1 px-3 text-[0.7rem] rounded-lg flex items-center gap-1 font-bold"
                          >
                            <SlidersHorizontal size={11} /> Settings
                          </button>
                        </div>

                        {/* Device Streams Nested List */}
                        <div className="flex flex-col gap-2.5 mt-2">
                          {deviceStreams.length === 0 ? (
                            <p className="text-text-muted text-[0.75rem] text-center py-2 italic border border-dashed border-border-glass rounded-lg">
                              No streams configured. Click 'Add Stream' above.
                            </p>
                          ) : (
                            deviceStreams.map((stream) => {
                              const isStreamOnline = stream.status !== 'Offline';
                              const streamStatusColor =
                                stream.status === 'Monitoring'
                                  ? 'var(--color-success)'
                                  : stream.status === 'Recording'
                                  ? 'var(--color-danger)'
                                  : stream.status === 'Error'
                                  ? 'var(--color-danger)'
                                  : stream.status === 'Processing Video' || stream.status === 'Processing'
                                  ? 'var(--color-primary)'
                                  : stream.status === 'Idle'
                                  ? 'var(--color-secondary)'
                                  : 'var(--color-text-muted)';

                              return (
                                <div
                                  key={stream.streamId}
                                  className="flex items-center justify-between gap-3 py-2 px-3 border border-border-glass rounded-lg bg-[rgba(255,255,255,0.005)]"
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
                                      <div className="text-[0.78rem] font-bold text-text-primary truncate">
                                        {stream.name}
                                      </div>
                                      <div className="text-[0.65rem] text-text-muted truncate mt-0.5 font-mono">
                                        {stream.status} · {stream.cameraType}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => onToggleStreamMonitoring(stream.streamId, stream.trackingEnabled)}
                                      className={`btn ${
                                        stream.trackingEnabled ? 'btn-primary' : 'btn-secondary'
                                      } py-0.5 px-2 text-[0.62rem] rounded-md shrink-0 font-bold`}
                                    >
                                      {stream.trackingEnabled ? 'Disable Tracking' : 'Enable Tracking'}
                                    </button>
                                    <button
                                      onClick={() => {
                                        setSelectedStreamId(stream.streamId);
                                        setSelectedDeviceId(dev.deviceId);
                                        setShowConfigDialog(true);
                                      }}
                                      className="btn p-1 bg-transparent border-none text-text-muted hover:text-primary transition-colors cursor-pointer"
                                    >
                                      <Settings size={12} />
                                    </button>
                                    <button
                                      onClick={(e) => onDeleteStream(stream.streamId, e)}
                                      className="btn p-1 bg-transparent border-none text-text-muted hover:text-danger cursor-pointer"
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

            {/* Logs terminal side panel */}
            <div className="md:col-span-5 glass-panel p-5 rounded-2xl flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.04)] pb-2.5">
                <h2 className="text-[1.05rem] font-bold flex items-center gap-2">
                  <Terminal size={18} color="var(--color-secondary)" /> System Status Logs
                </h2>
                <button
                  type="button"
                  onClick={onOpenSystemLogs}
                  className="btn btn-secondary py-1 px-2.5 text-[0.72rem] rounded-lg flex items-center gap-1.5 font-bold"
                >
                  <Maximize2 size={12} />
                  Expand
                </button>
              </div>

              <div
                className="font-mono bg-[rgba(0,0,0,0.5)] rounded-xl p-4 text-[0.82rem] leading-relaxed text-[#38bdf8] flex-1 overflow-y-auto border border-[rgba(255,255,255,0.04)] select-text"
                ref={terminalContainerRef}
                style={{ height: '360px' }}
              >
                <SystemStatusLogsList logs={logs} selectedStreamId={selectedStreamId} />
              </div>
            </div>
          </div>
        ) : activeSettingsTab === 'Alert rules' ? (
          /* ALERT RULES TAB: Renders Alert Rules & notification settings */
          <div className="lg:col-span-10 text-left">
            <ManageNotificationsTab
              notifications={notifications}
              onMarkRead={onMarkRead}
              onNotificationClick={onNotificationClick}
              onDeleteNotification={onDeleteNotification}
              onClearAllNotifications={onClearAllNotifications}
              streams={streams}
              currentOrg={currentOrg}
            />
          </div>
        ) : (
          /* STANDARD SETTINGS DETAILS FOR CAMERAS, ALERT RULES, ETC */
          <>
            {/* MIDDLE COLUMN: Scrollable Camera List */}
            <div className="lg:col-span-3 glass-panel p-4 rounded-2xl flex flex-col gap-3 max-h-[calc(100vh-200px)] overflow-y-auto">
              <div className="flex justify-between items-center text-[0.7rem] font-bold uppercase tracking-wider text-text-muted select-none pb-2 border-b border-[rgba(255,255,255,0.04)]">
                <span>All cameras</span>
                <span className="bg-[rgba(255,255,255,0.05)] px-2 py-0.5 rounded-full text-text-secondary">
                  {camerasList.length}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {camerasList.map((cam) => {
                  const isSelected = selectedCameraCode === cam.code;
                  const isOnline = cam.status === 'online';
                  return (
                    <div
                      key={cam.code}
                      onClick={() => setSelectedCameraCode(cam.code)}
                      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer select-none transition-all duration-200 ${
                        isSelected
                          ? 'bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)]'
                          : 'hover:bg-[rgba(255,255,255,0.015)] border border-transparent'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full inline-block shrink-0 ${
                          isOnline ? 'bg-emerald-400' : 'bg-rose-500'
                        }`}
                        style={{
                          boxShadow: isOnline ? '0 0 6px rgba(52,211,153,0.4)' : '0 0 6px rgba(244,63,94,0.4)',
                        }}
                      />
                      <div className="min-w-0 flex-1 flex flex-col text-left">
                        <span className="text-[0.78rem] text-text-muted font-bold leading-none mb-1 font-mono">
                          {cam.code}
                        </span>
                        <span className="text-[0.82rem] font-bold text-text-primary truncate">
                          {cam.name}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* RIGHT COLUMN: Settings Panel */}
            <div className="lg:col-span-7 glass-panel p-5 rounded-2xl flex flex-col gap-5">
              {/* Header */}
              <div className="flex justify-between items-center border-b border-[rgba(255,255,255,0.05)] pb-4">
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-[0.8rem] text-text-muted font-mono font-bold">{selectedCam.code}</span>
                    <span className="text-text-muted leading-none font-bold">·</span>
                    <h3 className="text-[1.1rem] font-bold text-text-primary leading-none">{selectedCam.name}</h3>
                  </div>
                  <p className="text-[0.78rem] text-text-muted mt-1.5 font-semibold">{selectedCam.zone}</p>
                </div>

                {/* Toggle switch for enable */}
                <div className="flex items-center gap-3">
                  <span className="text-[0.78rem] text-text-muted font-semibold">
                    {selectedCam.status === 'online' ? 'Enabled' : 'Disabled'}
                  </span>
                  <button
                    onClick={() =>
                      updateSelectedCamera({
                        status: selectedCam.status === 'online' ? 'offline' : 'online',
                      })
                    }
                    className={`w-11 h-6 rounded-full p-0.5 transition-colors duration-200 focus:outline-none relative border-none cursor-pointer ${
                      selectedCam.status === 'online' ? 'bg-[var(--color-secondary)]' : 'bg-[rgba(255,255,255,0.1)]'
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full bg-white block transition-transform duration-200 shadow-md ${
                        selectedCam.status === 'online' ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Grid Layout inside settings detail */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Col: Stream Preview Mock & Recording Mode */}
                <div className="flex flex-col gap-4">
                  {/* Preview Thumbnail Card */}
                  <div
                    className="relative rounded-xl overflow-hidden bg-gradient-to-br from-[#0c121e] to-[#04060b] select-none border border-border-glass"
                    style={{ aspectRatio: '16/9' }}
                  >
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%)] bg-[size:100%_4px] pointer-events-none opacity-25" />

                    {/* Status indicator overlays */}
                    {selectedCam.status === 'online' ? (
                      <>
                        <div className="absolute top-2 left-2 text-[0.62rem] font-bold text-text-secondary bg-[rgba(9,13,22,0.7)] px-2 py-0.5 rounded border border-[rgba(255,255,255,0.04)] font-mono">
                          {selectedCam.code}
                        </div>
                        <div className="absolute top-2 right-2 flex items-center gap-1 bg-[rgba(9,13,22,0.7)] px-2.5 py-0.5 rounded border border-[rgba(255,255,255,0.04)]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-danger)] inline-block animate-[pulse-danger_1.2s_infinite]" />
                          <span className="text-[0.55rem] font-extrabold tracking-wider text-white">REC</span>
                        </div>
                      </>
                    ) : (
                      <div className="absolute inset-0 bg-[rgba(0,0,0,0.4)] backdrop-blur-sm flex items-center justify-center text-[0.8rem] text-text-muted font-bold gap-1.5">
                        <AlertCircle size={16} /> Stream Disabled
                      </div>
                    )}

                    {/* Footer overlay details */}
                    <div className="absolute bottom-2 left-2 right-2 flex justify-between text-[0.65rem] text-text-secondary select-none font-semibold px-1 py-0.5 rounded bg-[rgba(9,13,22,0.6)]">
                      <span>{selectedCam.name}</span>
                      <span className="font-mono text-text-muted">{cameraTime}</span>
                    </div>
                  </div>

                  {/* Recording mode button group */}
                  <div className="flex flex-col gap-2.5">
                    <label className="text-[0.78rem] text-text-muted font-bold uppercase tracking-wider select-none text-left">
                      Recording mode
                    </label>
                    <div className="flex bg-[rgba(15,23,42,0.4)] p-1 rounded-xl border border-border-glass gap-1">
                      {(['Continuous', 'Motion only', 'Event-triggered'] as const).map((mode) => {
                        const isModeSelected = selectedCam.recordingMode === mode;
                        return (
                          <button
                            key={mode}
                            onClick={() => updateSelectedCamera({ recordingMode: mode })}
                            className={`flex-1 py-2 text-[0.75rem] font-bold rounded-lg cursor-pointer transition-all duration-200 border-none outline-none whitespace-nowrap ${
                              isModeSelected
                                ? 'bg-[var(--color-secondary)] text-white shadow'
                                : 'text-text-muted hover:text-text-secondary bg-transparent'
                            }`}
                          >
                            {mode}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Right Col: Detection Features, Sensitivity & Stats */}
                <div className="flex flex-col gap-5 text-left">
                  <label className="text-[0.78rem] text-text-muted font-bold uppercase tracking-wider select-none leading-none">
                    Detection on this camera
                  </label>

                  {/* Toggle controls */}
                  <div className="flex flex-col gap-4 bg-[rgba(15,23,42,0.2)] p-4 rounded-xl border border-border-glass">
                    {[
                      {
                        key: 'personDetection',
                        label: 'Person detection',
                        desc: 'Re-ID across cameras',
                      },
                      {
                        key: 'vehicleDetection',
                        label: 'Vehicle detection',
                        desc: 'Plates & dwell',
                      },
                      {
                        key: 'unattendedObject',
                        label: 'Unattended object',
                        desc: 'Bags left stationary',
                      },
                      {
                        key: 'loitering',
                        label: 'Loitering',
                        desc: 'Dwell beyond threshold',
                      },
                    ].map((item) => {
                      const val = selectedCam[item.key as keyof CameraItem] as boolean;
                      return (
                        <div key={item.key} className="flex justify-between items-center">
                          <div>
                            <h4 className="text-[0.85rem] font-bold text-text-primary leading-tight">
                              {item.label}
                            </h4>
                            <p className="text-[0.72rem] text-text-muted mt-0.5 leading-normal">
                              {item.desc}
                            </p>
                          </div>
                          <button
                            onClick={() => updateSelectedCamera({ [item.key]: !val })}
                            className={`w-10 h-5.5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none relative border-none cursor-pointer ${
                              val ? 'bg-[var(--color-secondary)]' : 'bg-[rgba(255,255,255,0.08)]'
                            }`}
                          >
                            <span
                              className={`w-4.5 h-4.5 rounded-full bg-white block transition-transform duration-200 shadow ${
                                val ? 'translate-x-4.5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Slider for sensitivity */}
                  <div className="flex flex-col gap-2.5">
                    <div className="flex justify-between items-center text-[0.78rem] text-text-muted font-bold uppercase tracking-wider select-none">
                      <span>Sensitivity</span>
                      <span className="text-[var(--color-secondary)] font-mono">{selectedCam.sensitivity}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={selectedCam.sensitivity}
                      onChange={(e) => updateSelectedCamera({ sensitivity: Number(e.target.value) })}
                      className="w-full h-1 bg-[rgba(255,255,255,0.15)] rounded-lg appearance-none cursor-pointer accent-[var(--color-secondary)] outline-none"
                    />
                  </div>

                  {/* Dropdowns */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[0.75rem] text-text-muted font-semibold">Resolution</label>
                      <select
                        value={selectedCam.resolution}
                        onChange={(e) => updateSelectedCamera({ resolution: e.target.value })}
                        className="w-full bg-[rgba(15,23,42,0.5)] border border-border-glass rounded-lg text-text-secondary text-[0.8rem] py-2 px-3 outline-none"
                      >
                        <option value="1920 × 1080 · FHD">1920 × 1080 · FHD</option>
                        <option value="2560 × 1440 · QHD">2560 × 1440 · QHD</option>
                        <option value="3840 × 2160 · 4K">3840 × 2160 · 4K</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[0.75rem] text-text-muted font-semibold">Frame rate</label>
                      <select
                        value={selectedCam.frameRate}
                        onChange={(e) => updateSelectedCamera({ frameRate: e.target.value })}
                        className="w-full bg-[rgba(15,23,42,0.5)] border border-border-glass rounded-lg text-text-secondary text-[0.8rem] py-2 px-3 outline-none"
                      >
                        <option value="15 fps">15 fps</option>
                        <option value="24 fps">24 fps</option>
                        <option value="30 fps">30 fps</option>
                        <option value="60 fps">60 fps</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
