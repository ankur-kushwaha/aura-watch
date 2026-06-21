import React, { useState, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../../api';
import { DEFAULT_STREAM_CONFIG } from '../../../edgeConfig';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import type { EdgeDevice } from '../../types';

export interface AddStreamModalProps {
  open: boolean;
  devices: EdgeDevice[];
  onClose: () => void;
  onSaved: (result?: { streamId: string }) => void;
}

export function AddStreamModal({ open, devices, onClose, onSaved }: AddStreamModalProps) {
  const [cameraName, setCameraName] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [streamUrl, setStreamUrl] = useState('');
  const [resolution, setResolution] = useState('4MP');
  const [fps, setFps] = useState('25');
  const [codec, setCodec] = useState('H.264');
  const [zone, setZone] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set default device when open
  useEffect(() => {
    if (open && devices.length > 0 && !deviceId) {
      setDeviceId(devices[0].deviceId);
    }
  }, [open, devices, deviceId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cameraName.trim() || !deviceId || !streamUrl.trim()) {
      setError('Camera Name, Device, and RTSP URL are required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Call the backend to create the RTSP camera stream
      const res = await apiFetch('/streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: deviceId,
          name: cameraName.trim(),
          cameraType: 'rtsp',
          streamUrl: streamUrl.trim(),
          trackingEnabled: DEFAULT_STREAM_CONFIG.trackingEnabled,
          motionThreshold: DEFAULT_STREAM_CONFIG.motionThreshold,
          pixelChangeThreshold: DEFAULT_STREAM_CONFIG.pixelChangeThreshold,
          detectPerson: DEFAULT_STREAM_CONFIG.detectPerson,
          detectVehicle: DEFAULT_STREAM_CONFIG.detectVehicle,
          resolution,
          fps,
          codec,
          zone: zone.trim() || 'Entrance',
          loiteringAlert: true,
          crossCameraReid: true,
          plateRecognition: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to create camera stream');
        setSubmitting(false);
        return;
      }

      const newStream = await res.json();
      const streamId = newStream.streamId;

      onSaved({ streamId });
      onClose();
      // Reset form
      setCameraName('');
      setStreamUrl('');
      setResolution('4MP');
      setFps('25');
      setCodec('H.264');
      setZone('');
    } catch (err) {
      console.error('Failed to create stream', err);
      setError('Connection failed. Please check backend status.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-[480px] p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto bg-[#0b0f19] border border-border-glass text-text-primary rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="text-left">
            <DialogTitle className="text-[1.2rem] font-bold tracking-tight text-white">Add IP camera</DialogTitle>
            <p className="text-[0.78rem] text-text-muted mt-1">Configure an IP camera for AI monitoring</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn p-1.5 bg-transparent border-none text-text-muted hover:text-white rounded-lg hover:bg-[rgba(255,255,255,0.06)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="h-px bg-border-glass shrink-0" />

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
          {/* Camera Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">Camera Name</label>
            <input
              type="text"
              required
              value={cameraName}
              onChange={(e) => setCameraName(e.target.value)}
              placeholder="e.g. Main Gate — Wide"
              className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full"
            />
          </div>

          {/* Device selection dropdown */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">Streaming Device</label>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              required
              className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full"
            >
              {devices.length === 0 ? (
                <option value="" disabled>No devices available</option>
              ) : (
                devices.map((dev) => (
                  <option key={dev.deviceId} value={dev.deviceId}>
                    {dev.name} ({dev.deviceId})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* RTSP URL */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">RTSP URL</label>
            <input
              type="text"
              required
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              placeholder="rtsp://..."
              className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full font-mono"
            />
          </div>



          {/* Zone / Area Label */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">Zone / Area Label</label>
            <input
              type="text"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder="e.g. Forecourt"
              className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-[0.75rem] p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="h-[1px] bg-border-glass my-1 shrink-0" />

          {/* Actions */}
          <div className="flex gap-3 justify-end items-center">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary py-2 px-5 text-[0.82rem] rounded-lg cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary py-2 px-5 text-[0.82rem] rounded-lg cursor-pointer transition-colors bg-primary"
            >
              {submitting ? 'Adding...' : 'Add IP camera'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
