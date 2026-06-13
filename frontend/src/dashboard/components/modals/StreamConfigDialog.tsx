import { useEffect, useState } from 'react';
import { Plus, Settings, X } from 'lucide-react';
import { apiFetch } from '../../../api';
import { DEFAULT_STREAM_CONFIG } from '../../../edgeConfig';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import type { CameraConfig } from '../../types';

export interface StreamConfigDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  addDeviceId: string | null;
  streamId: string;
  streamName?: string;
  initialConfig: CameraConfig;
  onSaved: (result?: { streamId: string }) => void;
}

export function StreamConfigDialog({
  open,
  onClose,
  mode,
  addDeviceId,
  streamId,
  streamName,
  initialConfig,
  onSaved,
}: StreamConfigDialogProps) {
  const [config, setConfig] = useState<CameraConfig>(initialConfig);

  useEffect(() => {
    if (open) {
      setConfig(initialConfig);
    }
  }, [open, initialConfig]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config.detectPerson && !config.detectVehicle) {
      alert('Select at least one detection target: Person or Vehicle.');
      return;
    }

    if (mode === 'add' && addDeviceId) {
      try {
        const res = await apiFetch('/streams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: addDeviceId,
            name: config.name,
            cameraType: config.type,
            streamUrl: config.streamUrl,
            trackingEnabled: config.trackingEnabled,
            motionThreshold: config.motionThreshold ?? DEFAULT_STREAM_CONFIG.motionThreshold,
            pixelChangeThreshold: config.pixelChangeThreshold ?? DEFAULT_STREAM_CONFIG.pixelChangeThreshold,
            detectPerson: config.detectPerson,
            detectVehicle: config.detectVehicle,
          }),
        });
        if (res.ok) {
          const newStream = await res.json();
          onSaved({ streamId: newStream.streamId });
          onClose();
        }
      } catch (err) {
        console.error('Failed to create stream', err);
      }
      return;
    }

    if (!streamId) return;

    try {
      const res = await apiFetch(`/streams/${streamId}/config`, {
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
      if (res.ok) {
        onSaved();
        onClose();
      }
    } catch (err) {
      console.error('Failed to update config', err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-[480px] p-6 flex flex-col gap-5 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-[rgba(124,58,237,0.15)] p-2 rounded-lg">
              {mode === 'add' ? <Plus size={18} color="var(--color-primary)" /> : <Settings size={18} color="var(--color-primary)" />}
            </div>
            <div>
              <DialogTitle>{mode === 'add' ? 'Add Camera Stream' : 'Configure Stream'}</DialogTitle>
              {mode === 'edit' && streamName && (
                <p className="text-[0.72rem] text-text-muted mt-0.5">{streamName}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn p-1.5 bg-transparent text-text-muted hover:text-text-primary border-none rounded-lg hover:bg-[rgba(255,255,255,0.06)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="h-px bg-[rgba(255,255,255,0.07)]" />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 overflow-y-auto min-h-0">
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

          <div className="flex gap-2.5 justify-end pt-1">
            <button type="button" onClick={onClose} className="btn btn-secondary py-2 px-4 text-[0.85rem]">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary py-2 px-5 text-[0.85rem]">
              {mode === 'add' ? 'Create Stream' : 'Apply Configuration'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
