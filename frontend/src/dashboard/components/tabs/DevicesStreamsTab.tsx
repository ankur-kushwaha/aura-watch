import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Server, Cpu, Plus, Trash2, Loader2, Network, X, Power, Activity, FileText, ScrollText, Terminal } from 'lucide-react';
import type { EdgeDevice, CameraStream } from '../../types';
import type { DeviceLogTab } from '../modals';
import { DeviceInstallTooltip } from '../DeviceInstallTooltip';
import { AddStreamModal } from '../modals/AddStreamModal';
import { EditStreamModal } from '../modals/EditStreamModal';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import { apiFetch, discoverDeviceStreams } from '../../../api';

export interface DevicesStreamsTabProps {
  devices: EdgeDevice[];
  streams: CameraStream[];
  orgId: string;
  onOpenSettings: (device: EdgeDevice, e: React.MouseEvent) => void;
  onDeleteDevice: (deviceId: string, e: React.MouseEvent) => void;
  onDeleteStream: (streamId: string, e: React.MouseEvent) => void;
  fetchDevices: () => Promise<void>;
  onOpenMetrics?: (device: EdgeDevice, e: React.MouseEvent) => void;
  onDeviceReboot?: (deviceId: string, name: string, e: React.MouseEvent) => void;
  onOpenDeviceLogs?: (deviceId: string, name: string, e: React.MouseEvent, tab?: DeviceLogTab) => void;
  deviceCommandPending?: string | null;
}

export function DevicesStreamsTab({
  devices,
  streams,
  orgId,
  onOpenSettings,
  onDeleteDevice,
  onDeleteStream,
  fetchDevices,
  onOpenMetrics,
  onDeviceReboot,
  onOpenDeviceLogs,
  deviceCommandPending,
}: DevicesStreamsTabProps) {
  // Modal states
  const [addStreamOpen, setAddStreamOpen] = useState(false);
  const [editStreamOpen, setEditStreamOpen] = useState(false);
  const [selectedEditStream, setSelectedEditStream] = useState<CameraStream | null>(null);

  const location = useLocation();
  const navigate = useNavigate();

  // Query param check to auto-open edit modal
  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    const editStreamId = queryParams.get('editStreamId');
    if (editStreamId) {
      const streamToEdit = streams.find((s) => s.streamId === editStreamId);
      if (streamToEdit) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedEditStream(streamToEdit);
        setEditStreamOpen(true);
      }
    }
  }, [location.search, streams]);

  // Network Discovery Modal state
  const [discoveryDevice, setDiscoveryDevice] = useState<EdgeDevice | null>(null);
  const [discoveryStatus, setDiscoveryStatus] = useState<'scanning' | 'results' | 'empty' | 'error' | 'imported'>('scanning');
  const [discoveredStreams, setDiscoveredStreams] = useState<Array<{ name: string; url: string; res: string; fps: string; codec: string; zone: string }>>([]);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discoverySubnet, setDiscoverySubnet] = useState<string | null>(null);
  const [importingIndex, setImportingIndex] = useState<number | null>(null);

  const normalizeStreamUrl = (url: string) => url.trim().toLowerCase().replace(/\/+$/, '');

  const isStreamAlreadyRegistered = (url: string) => {
    const normalized = normalizeStreamUrl(url);
    return streams.some((stream) => normalizeStreamUrl(stream.streamUrl) === normalized);
  };

  // Trigger network discovery scan on the edge device
  const handleOpenDiscovery = async (device: EdgeDevice) => {
    setDiscoveryDevice(device);
    setDiscoveryStatus('scanning');
    setDiscoveredStreams([]);
    setDiscoveryError(null);
    setDiscoverySubnet(null);
    setImportingIndex(null);

    try {
      const result = await discoverDeviceStreams(device.deviceId);
      const cameras = (result.cameras || []).filter((camera) => !isStreamAlreadyRegistered(camera.url));

      setDiscoverySubnet(result.subnet ?? null);
      setDiscoveredStreams(
        cameras.map((camera) => ({
          name: camera.name,
          url: camera.url,
          res: '',
          fps: '',
          codec: '',
          zone: '',
        })),
      );
      setDiscoveryStatus(cameras.length > 0 ? 'results' : 'empty');
    } catch (err) {
      console.error('Failed to discover streams on edge device network', err);
      setDiscoveryError(err instanceof Error ? err.message : 'Failed to scan device network');
      setDiscoveryStatus('error');
    }
  };

  // Import a discovered stream
  const handleImportStream = async (index: number) => {
    if (!discoveryDevice) return;
    setImportingIndex(index);
    const discoveredStream = discoveredStreams[index];

    try {
      const res = await apiFetch('/streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: discoveryDevice.deviceId,
          name: discoveredStream.name,
          cameraType: 'rtsp',
          streamUrl: discoveredStream.url,
          trackingEnabled: true,
          motionThreshold: 25,
          pixelChangeThreshold: 0.02,
          detectPerson: true,
          detectVehicle: true,
          ...(discoveredStream.res ? { resolution: discoveredStream.res } : {}),
          ...(discoveredStream.fps ? { fps: discoveredStream.fps } : {}),
          ...(discoveredStream.codec ? { codec: discoveredStream.codec } : {}),
          ...(discoveredStream.zone ? { zone: discoveredStream.zone } : {}),
          loiteringAlert: true,
          crossCameraReid: true,
          plateRecognition: true,
        }),
      });

      if (res.ok) {
        await fetchDevices();

        // Remove from list
        setDiscoveredStreams(prev => prev.filter((_, i) => i !== index));

        if (discoveredStreams.length <= 1) {
          setDiscoveryStatus('imported');
          setTimeout(() => setDiscoveryDevice(null), 1000);
        }
      }
    } catch (err) {
      console.error('Failed to import discovered stream', err);
    } finally {
      setImportingIndex(null);
    }
  };

  // Helper to retrieve custom device metadata (location, protocol, etc.)
  const getDeviceMeta = (dev: EdgeDevice) => {
    const metaKey = 'aura_watch_devices_metadata';
    const metadata = JSON.parse(localStorage.getItem(metaKey) || '{}');
    const deviceMeta = metadata[dev.deviceId] || {};

    // Guess IP address from streams or default to deviceId if looks like IP
    let ip = dev.deviceId;
    if (!ip.includes('.') && streams.length > 0) {
      const matchingStream = streams.find(s => s.deviceId === dev.deviceId);
      if (matchingStream && matchingStream.streamUrl.includes('//')) {
        const match = matchingStream.streamUrl.match(/\/\/([^:/]+)/);
        if (match) ip = match[1];
      }
    }
    if (!ip.includes('.')) {
      ip = '192.168.1.101'; // Default mockup IP
    }

    return {
      location: deviceMeta.location || (dev.name.includes('—') ? dev.name.split('—')[1].trim() : 'Campus Premises'),
      ip: ip,
      port: deviceMeta.port || '554',
      protocol: deviceMeta.protocol || 'RTSP',
    };
  };

  // Helper to retrieve custom stream metadata (resolution, codec, zone, etc.)
  const getStreamMeta = (stream: CameraStream) => {
    return {
      resolution: stream.resolution || '4MP',
      fps: stream.fps || '25',
      codec: stream.codec || 'H.264',
      zone: stream.zone || 'Entrance',
    };
  };

  return (
    <div className="flex flex-col gap-8 animate-[slideUp_0.3s_ease-out] w-full min-h-[calc(100vh-140px)] pb-10">
      {/* DEVICES SECTION */}
      <div className="flex flex-col gap-4 text-left">
        <div className="flex justify-between items-center pb-2 border-b border-border-glass">
          <div>
            <h2 className="text-[1.3rem] font-bold text-white tracking-tight">Streaming Devices</h2>
            <p className="text-[0.8rem] text-text-muted mt-1 font-medium">
              NVRs, DVRs, and standalone cameras on your network
            </p>
          </div>
          <DeviceInstallTooltip orgId={orgId}>
            <button
              type="button"
              className="btn py-2.5 px-4 text-[0.82rem] font-bold text-white bg-[#7C3AED] hover:bg-[#6d28d9] rounded-xl flex items-center gap-1.5 shadow-[0_4px_12px_rgba(124,58,237,0.25)] transition-all cursor-pointer"
            >
              <Plus size={16} /> Add streaming device
            </button>
          </DeviceInstallTooltip>
        </div>

        {devices.length === 0 ? (
          <div className="text-text-muted text-[0.88rem] text-center p-12 border border-dashed border-border-glass rounded-2xl bg-[rgba(15,23,42,0.25)]">
            No streaming devices configured. Click '+ Add streaming device' to register a streaming device.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {devices.map((dev) => {
              const isOnline = dev.status !== 'Offline';
              const meta = getDeviceMeta(dev);

              return (
                <div
                  key={dev.deviceId}
                  className="glass-panel p-5 rounded-2xl flex flex-col gap-5 border border-border-glass bg-[rgba(15,23,42,0.45)] hover:border-[rgba(255,255,255,0.12)] transition-all text-left relative overflow-hidden group"
                >
                  <div className="flex items-start gap-4">
                    {/* Device Icon */}
                    <div className="p-3 bg-[rgba(255,255,255,0.03)] border border-border-glass rounded-xl flex items-center justify-center shrink-0">
                      <Server size={20} className="text-text-muted group-hover:text-white transition-colors" />
                    </div>

                    <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full inline-block flex-shrink-0 ${isOnline ? 'bg-emerald-400' : 'bg-text-muted'
                            }`}
                          style={{
                            boxShadow: isOnline ? '0 0 10px rgba(52,211,153,0.6)' : 'none',
                          }}
                        />
                        <h3 className="text-[0.92rem] font-bold text-white truncate leading-none">
                          {dev.name}
                        </h3>
                        <span className={`text-[0.62rem] font-black tracking-wider px-1.5 py-0.5 rounded leading-none ${isOnline ? 'bg-emerald-400/10 text-emerald-400' : 'bg-transparent text-text-muted'
                          }`}>
                          {isOnline ? 'online' : 'offline'}
                        </span>
                      </div>
                      <p className="text-[0.78rem] text-text-muted font-mono leading-none">
                        {meta.ip}:{meta.port}
                      </p>
                      <p className="text-[0.72rem] text-text-secondary font-semibold leading-none">
                        {meta.location}
                      </p>
                    </div>
                  </div>

                  {/* Actions buttons */}
                  <div className="flex flex-col gap-2 mt-2 w-full">
                    <div className="flex items-center gap-2 w-full">
                      <button
                        onClick={(e) => onOpenSettings(dev, e)}
                        className="flex-1 py-1.5 px-3 bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.07)] border border-border-glass text-text-secondary hover:text-white rounded-lg text-[0.75rem] font-bold transition-all cursor-pointer flex items-center justify-center"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleOpenDiscovery(dev)}
                        disabled={!isOnline}
                        className="flex-1 py-1.5 px-3 bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.07)] border border-border-glass text-text-secondary hover:text-white rounded-lg text-[0.75rem] font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1 truncate"
                      >
                        Discover streams
                      </button>
                    </div>
                    <div className="flex items-center gap-2 w-full">
                      <button
                        onClick={(e) => onOpenMetrics?.(dev, e)}
                        disabled={!isOnline}
                        className="flex-1 py-1.5 px-3 bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.07)] border border-border-glass text-text-secondary hover:text-white rounded-lg text-[0.75rem] font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1"
                      >
                        Metrics
                      </button>
                      <button
                        onClick={(e) => onDeleteDevice(dev.deviceId, e)}
                        className="p-1.5 bg-transparent text-text-muted hover:text-danger hover:bg-danger/10 border border-border-glass hover:border-danger/30 rounded-lg shrink-0 cursor-pointer transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 w-full">
                      <button
                        onClick={(e) => onDeviceReboot?.(dev.deviceId, dev.name, e)}
                        disabled={!isOnline || deviceCommandPending === `${dev.deviceId}:reboot`}
                        className="py-1 px-2 bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.07)] border border-border-glass text-text-muted hover:text-white rounded-md text-[0.68rem] font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1"
                      >
                        <Power size={11} />
                        {deviceCommandPending === `${dev.deviceId}:reboot` ? 'Rebooting…' : 'Reboot'}
                      </button>
                      <button
                        onClick={(e) => onOpenDeviceLogs?.(dev.deviceId, dev.name, e, 'events')}
                        className="py-1 px-2 bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.07)] border border-border-glass text-text-muted hover:text-white rounded-md text-[0.68rem] font-bold transition-all cursor-pointer flex items-center gap-1"
                      >
                        <Activity size={11} />
                        Events
                      </button>
                      <button
                        onClick={(e) => onOpenDeviceLogs?.(dev.deviceId, dev.name, e, 'journal')}
                        className="py-1 px-2 bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.07)] border border-border-glass text-text-muted hover:text-white rounded-md text-[0.68rem] font-bold transition-all cursor-pointer flex items-center gap-1"
                      >
                        <FileText size={11} />
                        Journal
                      </button>
                      <button
                        onClick={(e) => onOpenDeviceLogs?.(dev.deviceId, dev.name, e, 'agent')}
                        className="py-1 px-2 bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.07)] border border-border-glass text-text-muted hover:text-white rounded-md text-[0.68rem] font-bold transition-all cursor-pointer flex items-center gap-1"
                      >
                        <ScrollText size={11} />
                        Agent
                      </button>
                      <button
                        onClick={(e) => onOpenDeviceLogs?.(dev.deviceId, dev.name, e, 'worker')}
                        className="py-1 px-2 bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.07)] border border-border-glass text-text-muted hover:text-white rounded-md text-[0.68rem] font-bold transition-all cursor-pointer flex items-center gap-1"
                      >
                        <Cpu size={11} />
                        Worker
                      </button>
                      <button
                        onClick={(e) => onOpenDeviceLogs?.(dev.deviceId, dev.name, e, 'live')}
                        className="py-1 px-2 bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.07)] border border-border-glass text-text-muted hover:text-white rounded-md text-[0.68rem] font-bold transition-all cursor-pointer flex items-center gap-1"
                      >
                        <Terminal size={11} />
                        Live
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* STREAMS SECTION */}
      <div className="flex flex-col gap-4 text-left">
        <div className="flex justify-between items-center pb-2 border-b border-border-glass">
          <div>
            <h2 className="text-[1.3rem] font-bold text-white tracking-tight">IP Cameras</h2>
            <p className="text-[0.8rem] text-text-muted mt-1 font-medium">
              Individual camera channels being monitored by AI
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAddStreamOpen(true)}
            className="btn py-2.5 px-4 text-[0.82rem] font-bold text-white bg-transparent border border-border-glass hover:bg-[rgba(255,255,255,0.03)] rounded-xl flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Plus size={16} /> Add IP camera
          </button>
        </div>

        {streams.length === 0 ? (
          <div className="text-text-muted text-[0.88rem] text-center p-12 border border-dashed border-border-glass rounded-2xl bg-[rgba(15,23,42,0.25)]">
            No IP cameras configured yet. Register IP cameras to configure active AI tracking.
          </div>
        ) : (
          <div className="glass-panel overflow-hidden border border-border-glass bg-[rgba(15,23,42,0.35)] rounded-2xl shadow-xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border-glass bg-[rgba(0,0,0,0.15)] text-[0.7rem] font-black uppercase tracking-wider text-text-muted select-none">
                  <th className="py-3.5 px-5">Camera</th>
                  <th className="py-3.5 px-4">Streaming Device</th>
                  <th className="py-3.5 px-4">RTSP URL</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {streams.map((stream) => {
                  const device = devices.find((d) => d.deviceId === stream.deviceId);
                  const isStreamLive = stream.status !== 'Offline' && stream.status !== 'Error';
                  const meta = getStreamMeta(stream);

                  return (
                    <tr
                      onClick={() => {
                        setSelectedEditStream(stream);
                        setEditStreamOpen(true);
                      }}
                      key={stream.streamId}
                      className="border-b cursor-pointer border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.015)] transition-colors text-[0.82rem] text-text-secondary"
                    >
                      {/* CAMERA name & sub-location */}
                      <td className="py-4 px-5">
                        <div className="flex flex-col text-left">
                          <span className="font-bold text-white">{stream.name}</span>
                          <span className="text-[0.72rem] text-text-muted mt-0.5">{meta.zone}</span>
                        </div>
                      </td>

                      {/* DEVICE parent name */}
                      <td className="py-4 px-4 font-semibold text-text-secondary">
                        {device ? device.name.split(' ')[0] : 'Generic'}
                      </td>

                      {/* RTSP URL */}
                      <td className="py-4 px-4 font-mono text-[0.75rem] text-text-muted truncate max-w-[200px]" title={stream.streamUrl}>
                        {stream.streamUrl}
                      </td>

                      {/* STATUS Badge */}
                      <td className="py-4 px-4 text-center">
                        <div className="flex items-center justify-center">
                          <span className={`inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full ${isStreamLive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-[rgba(255,255,255,0.05)] text-text-muted'
                            }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isStreamLive ? 'bg-emerald-400 animate-pulse' : 'bg-text-muted'
                              }`} />
                            {isStreamLive ? 'live' : 'offline'}
                          </span>
                        </div>
                      </td>

                      {/* ACTIONS buttons */}
                      <td className="py-4 px-5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setSelectedEditStream(stream);
                              setEditStreamOpen(true);
                            }}
                            className="py-1 px-3 bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.07)] border border-border-glass text-text-secondary hover:text-white rounded-lg text-[0.72rem] font-bold transition-all cursor-pointer"
                          >
                            Settings
                          </button>
                          <button
                            onClick={(e) => onDeleteStream(stream.streamId, e)}
                            className="p-1.5 bg-transparent text-text-muted hover:text-danger hover:bg-danger/10 border border-border-glass hover:border-danger/30 rounded-lg cursor-pointer transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ALL MODALS RENDERED HERE */}

      <AddStreamModal
        open={addStreamOpen}
        devices={devices}
        onClose={() => setAddStreamOpen(false)}
        onSaved={fetchDevices}
      />

      <EditStreamModal
        open={editStreamOpen}
        stream={selectedEditStream}
        allStreamIds={streams.map(s => s.streamId)}
        onClose={() => {
          setEditStreamOpen(false);
          setSelectedEditStream(null);
          // Clear query parameter
          const queryParams = new URLSearchParams(location.search);
          if (queryParams.has('editStreamId')) {
            queryParams.delete('editStreamId');
            const searchStr = queryParams.toString();
            navigate({
              pathname: location.pathname,
              search: searchStr ? `?${searchStr}` : '',
            }, { replace: true });
          }
        }}
        onSaved={fetchDevices}
      />

      {/* Discovery Modal */}
      <Dialog open={!!discoveryDevice} onOpenChange={(open) => { if (!open) setDiscoveryDevice(null); }}>
        <DialogContent className="max-w-[460px] p-6 flex flex-col gap-4 bg-[#0b0f19] border border-border-glass text-text-primary rounded-2xl shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="text-left flex items-center gap-2">
              <Network size={18} className="text-secondary animate-pulse" />
              <DialogTitle className="text-[1.1rem] font-bold text-white">RTSP IP Camera Scanner</DialogTitle>
            </div>
            <button
              onClick={() => setDiscoveryDevice(null)}
              className="btn p-1.5 bg-transparent border-none text-text-muted hover:text-white rounded-lg"
            >
              <X size={15} />
            </button>
          </div>

          <div className="h-px bg-border-glass shrink-0" />

          {discoveryStatus === 'scanning' && (
            <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
              <Loader2 size={36} className="animate-spin text-primary" />
              <div className="flex flex-col gap-1">
                <p className="text-[0.9rem] font-semibold text-white">Scanning Network Ports</p>
                <p className="text-[0.72rem] text-text-muted">
                  Searching for active RTSP IP cameras from {discoveryDevice?.name} on its local subnet...
                </p>
              </div>
            </div>
          )}

          {discoveryStatus === 'error' && (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
              <p className="text-[0.88rem] font-bold text-danger">Scan Failed</p>
              <p className="text-[0.72rem] text-text-muted max-w-[360px]">
                {discoveryError || 'The edge device could not complete the network scan.'}
              </p>
              <button
                type="button"
                onClick={() => discoveryDevice && handleOpenDiscovery(discoveryDevice)}
                className="btn btn-primary py-1.5 px-4 text-[0.75rem] rounded-lg font-bold cursor-pointer bg-primary mt-2"
              >
                Retry scan
              </button>
            </div>
          )}

          {discoveryStatus === 'empty' && (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
              <p className="text-[0.88rem] font-bold text-white">No New Cameras Found</p>
              <p className="text-[0.72rem] text-text-muted max-w-[360px]">
                {discoverySubnet
                  ? `The scan completed on ${discoverySubnet}, but no new RTSP cameras were detected.`
                  : 'The scan completed, but no new RTSP cameras were detected on the device network.'}
              </p>
              <button
                type="button"
                onClick={() => discoveryDevice && handleOpenDiscovery(discoveryDevice)}
                className="btn py-1.5 px-4 text-[0.75rem] rounded-lg font-bold cursor-pointer border border-border-glass text-text-secondary hover:text-white mt-2"
              >
                Scan again
              </button>
            </div>
          )}

          {discoveryStatus === 'results' && (
            <div className="flex flex-col gap-4 text-left">
              <p className="text-[0.78rem] text-text-secondary font-semibold">
                Complete. Discovered {discoveredStreams.length} new IP camera{discoveredStreams.length === 1 ? '' : 's'}
                {discoverySubnet ? ` on ${discoverySubnet}` : ' on the local subnet'}:
              </p>
              <div className="flex flex-col gap-3.5 max-h-[220px] overflow-y-auto">
                {discoveredStreams.map((stream, idx) => (
                  <div
                    key={idx}
                    className="flex justify-between items-center gap-3 p-3 border border-border-glass rounded-xl bg-[rgba(255,255,255,0.015)]"
                  >
                    <div className="min-w-0 flex-1 flex flex-col">
                      <span className="text-[0.8rem] font-bold text-white">{stream.name}</span>
                      <span className="text-[0.68rem] text-text-muted font-mono truncate mt-0.5">{stream.url}</span>
                    </div>
                    <button
                      onClick={() => handleImportStream(idx)}
                      disabled={importingIndex !== null}
                      className="btn btn-primary py-1 px-3 text-[0.72rem] rounded-lg shrink-0 font-black cursor-pointer bg-primary"
                    >
                      {importingIndex === idx ? <Loader2 size={12} className="animate-spin" /> : 'Import'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {discoveryStatus === 'imported' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/25">
                <Cpu size={24} />
              </div>
              <p className="text-[0.88rem] font-bold text-white">Import Successful</p>
              <p className="text-[0.72rem] text-text-muted">IP cameras have been added and registered for Active AI monitoring.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
