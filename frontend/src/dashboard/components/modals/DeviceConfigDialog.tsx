import { useState } from 'react';
import { RotateCcw, SlidersHorizontal, X, Wifi, WifiOff, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { apiFetch, setDeviceWifi, getDeviceWifiStatus, type DeviceWifiStatus } from '../../../api';
import {
  createDefaultDeviceConfig,
  DEVICE_CONFIG_KEYS,
  type EffectiveEdgeDeviceConfig,
} from '../../../edgeConfig';
import { DeviceConfigFields } from '../../../EdgeConfigForms';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import type { EdgeDevice } from '../../types';

export interface DeviceConfigDialogProps {
  open: boolean;
  device: EdgeDevice | null;
  /** @deprecated use device.name */
  initialName?: string;
  /** @deprecated use device.effectiveConfig */
  initialConfig?: EffectiveEdgeDeviceConfig;
  onClose: () => void;
  onSaved: () => void;
}

// ── WiFi Panel ────────────────────────────────────────────────────────────────

function WifiConfigPanel({ device }: { device: EdgeDevice }) {
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [wifiStatus, setWifiStatus] = useState<DeviceWifiStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  const isOnline = device.status !== 'Offline';
  const configuredSsid = device.wifiSsid;
  const hasCredentials = device.wifiConfigured;

  const checkStatus = async () => {
    if (!isOnline) return;
    setCheckingStatus(true);
    try {
      const status = await getDeviceWifiStatus(device.deviceId);
      setWifiStatus(status);
    } catch {
      setWifiStatus(null);
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ssid.trim() || !password) return;
    setSaving(true);
    setResult(null);
    try {
      const res = await setDeviceWifi(device.deviceId, ssid.trim(), password);
      setResult({
        ok: res.deviceOnline,
        msg: res.message || (res.deviceOnline
          ? `WiFi applied on device: ${res.ssid}`
          : `Credentials saved for: ${res.ssid}. Will apply on next boot.`),
      });
      setSsid('');
      setPassword('');
    } catch (err: unknown) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Failed to configure WiFi' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border border-[rgba(255,255,255,0.06)] rounded-lg p-3 bg-[rgba(255,255,255,0.02)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wifi size={14} className="text-primary shrink-0" />
          <h3 className="text-[0.78rem] font-semibold text-text-primary">WiFi Configuration</h3>
        </div>
        {isOnline && (
          <button
            type="button"
            onClick={() => { void checkStatus(); }}
            disabled={checkingStatus}
            className="btn btn-secondary py-1 px-2.5 text-[0.72rem] flex items-center gap-1.5"
          >
            {checkingStatus ? <Loader2 size={11} className="animate-spin" /> : <Wifi size={11} />}
            Check status
          </button>
        )}
      </div>

      {/* Current state banner */}
      {(hasCredentials || configuredSsid || wifiStatus) && (
        <div className="rounded-md bg-[rgba(167,139,250,0.06)] border border-[rgba(167,139,250,0.15)] px-2.5 py-2 flex items-start gap-2">
          {wifiStatus ? (
            wifiStatus.connected ? (
              <CheckCircle size={13} className="text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <WifiOff size={13} className="text-amber-400 shrink-0 mt-0.5" />
            )
          ) : (
            <Wifi size={13} className="text-primary shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            {wifiStatus ? (
              <p className="text-[0.75rem] text-text-secondary leading-relaxed">
                {wifiStatus.connected
                  ? <>Connected to <strong className="text-text-primary">{wifiStatus.ssid || 'unknown SSID'}</strong>{wifiStatus.ip ? ` (${wifiStatus.ip})` : ''}</>
                  : 'Not connected via WiFi'}
              </p>
            ) : configuredSsid ? (
              <p className="text-[0.75rem] text-text-secondary">
                Configured SSID: <strong className="text-text-primary">{configuredSsid}</strong>
                {hasCredentials && <span className="text-emerald-400 ml-1">✓ credentials saved</span>}
              </p>
            ) : hasCredentials ? (
              <p className="text-[0.75rem] text-text-secondary">
                WiFi credentials are saved<span className="text-emerald-400 ml-1">✓</span>
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* AP fallback info */}
      <div className="rounded-md bg-[rgba(96,165,250,0.06)] border border-[rgba(96,165,250,0.12)] px-2.5 py-2 flex items-start gap-2">
        <AlertTriangle size={12} className="text-blue-400 shrink-0 mt-0.5" />
        <p className="text-[0.7rem] text-text-muted leading-relaxed">
          If the device can't connect to WiFi on boot, it will create a hotspot named{' '}
          <strong className="text-text-secondary">AuraWatch-XXXX</strong>. Connect to it and visit{' '}
          <strong className="text-text-secondary">192.168.4.1</strong> to configure WiFi.
        </p>
      </div>

      {/* Credential form */}
      <form onSubmit={(e) => { void handleApply(e); }} className="flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex flex-col gap-1">
            <label className="text-[0.72rem] text-text-secondary font-medium">Network SSID</label>
            <input
              type="text"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              placeholder={configuredSsid || 'e.g. OfficeWiFi'}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.72rem] text-text-secondary font-medium">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasCredentials ? '••••••••' : 'WiFi password'}
              autoComplete="new-password"
            />
          </div>
        </div>

        {result && (
          <div className={`rounded-md px-2.5 py-2 text-[0.75rem] flex items-start gap-1.5 ${
            result.ok
              ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300'
              : 'bg-amber-500/10 border border-amber-500/25 text-amber-300'
          }`}>
            {result.ok ? <CheckCircle size={12} className="shrink-0 mt-0.5" /> : <AlertTriangle size={12} className="shrink-0 mt-0.5" />}
            {result.msg}
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !ssid.trim() || !password}
          className="btn btn-primary py-2 px-4 text-[0.82rem] flex items-center gap-1.5 self-start disabled:opacity-50"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Wifi size={13} />}
          {isOnline ? 'Apply WiFi Now' : 'Save WiFi Credentials'}
        </button>

        {!isOnline && (
          <p className="text-[0.68rem] text-text-muted">
            Device is offline — credentials will be saved and applied when it next connects.
          </p>
        )}
      </form>
    </div>
  );
}

// ── Main Dialog ───────────────────────────────────────────────────────────────

export function DeviceConfigDialog({
  open,
  device,
  initialName,
  initialConfig,
  onClose,
  onSaved,
}: DeviceConfigDialogProps) {
  const deviceId = device?.deviceId ?? null;
  const resolvedName = device?.name ?? initialName ?? '';
  const resolvedConfig = device?.effectiveConfig ?? initialConfig ?? createDefaultDeviceConfig();

  const [name, setName] = useState(resolvedName);
  const [config, setConfig] = useState(resolvedConfig);



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
      <DialogContent key={deviceId ?? 'none'} className="max-w-[720px] p-6 flex flex-col gap-5 max-h-[90vh]">
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

        <form onSubmit={(e) => { void handleSubmit(e); }} className="flex flex-col gap-4 min-h-0">
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

          {/* WiFi config panel */}
          {device && <WifiConfigPanel device={device} />}

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
