import { useEffect, useState } from 'react';
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { apiFetch } from '../../../api';
import {
  createDefaultDeviceConfig,
  DEVICE_CONFIG_KEYS,
  type EffectiveEdgeDeviceConfig,
} from '../../../edgeConfig';
import { DeviceConfigFields } from '../../../EdgeConfigForms';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';

export interface DeviceConfigDialogProps {
  open: boolean;
  deviceId: string | null;
  initialName: string;
  initialConfig: EffectiveEdgeDeviceConfig;
  onClose: () => void;
  onSaved: () => void;
}

export function DeviceConfigDialog({
  open,
  deviceId,
  initialName,
  initialConfig,
  onClose,
  onSaved,
}: DeviceConfigDialogProps) {
  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState(initialConfig);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setConfig(initialConfig);
    }
  }, [open, initialName, initialConfig]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceId) return;

    try {
      const res = await apiFetch(`/devices/${deviceId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ...config }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to update device configuration');
        return;
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error('Failed to update device config', err);
      alert('Failed to update device configuration');
    }
  };

  const handleResetToDefaults = async () => {
    if (!deviceId) return;
    if (
      !confirm(
        'Reset all device settings to defaults and push to the edge device?\n\nThis clears any saved overrides in the cloud.',
      )
    ) {
      return;
    }

    const defaults = createDefaultDeviceConfig();
    setConfig(defaults);

    try {
      const clearOverrides = Object.fromEntries(DEVICE_CONFIG_KEYS.map((key) => [key, null]));
      const res = await apiFetch(`/devices/${deviceId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ...clearOverrides }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to reset device configuration');
        return;
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error('Failed to reset device config', err);
      alert('Failed to reset device configuration');
    }
  };

  return (
    <Dialog
      open={open && !!deviceId}
      onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
    >
      <DialogContent className="max-w-[720px] p-6 flex flex-col gap-5 max-h-[90vh]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-[rgba(124,58,237,0.15)] p-2 rounded-lg">
              <SlidersHorizontal size={18} color="var(--color-primary)" />
            </div>
            <div>
              <DialogTitle>Device Settings</DialogTitle>
              <p className="text-[0.72rem] text-text-muted mt-0.5">{name}</p>
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 min-h-0">
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.78rem] text-text-secondary font-medium">Device Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <DeviceConfigFields config={config} onChange={setConfig} />

          <div className="flex gap-2.5 justify-between pt-1">
            <button
              type="button"
              onClick={() => { void handleResetToDefaults(); }}
              className="btn btn-secondary py-2 px-4 text-[0.85rem] flex items-center gap-1.5"
            >
              <RotateCcw size={14} />
              Reset to Defaults
            </button>
            <div className="flex gap-2.5">
              <button type="button" onClick={onClose} className="btn btn-secondary py-2 px-4 text-[0.85rem]">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary py-2 px-5 text-[0.85rem]">
                Save Device Settings
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
