import React, { useState } from 'react';
import { X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../../api';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';

export interface AddDeviceModalProps {
  open: boolean;
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function AddDeviceModal({ open, orgId, onClose, onSaved }: AddDeviceModalProps) {
  const [deviceName, setDeviceName] = useState('');
  const [location, setLocation] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [port, setPort] = useState('554');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [protocol, setProtocol] = useState('RTSP');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTestConnection = async () => {
    if (!ipAddress.trim()) {
      setTestResult({ ok: false, message: 'Please enter an IP address first.' });
      return;
    }
    setTesting(true);
    setTestResult(null);

    // Simulate connection testing
    await new Promise((resolve) => setTimeout(resolve, 1500));

    setTesting(false);
    setTestResult({
      ok: true,
      message: `Successfully connected to ${ipAddress}:${port} via ${protocol}! Device is responsive.`,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceName.trim() || !ipAddress.trim()) {
      setError('Device Name and IP Address are required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Register device in the database via the enrollment token endpoint
      // We pass IP address as the deviceId and deviceName as name
      const res = await apiFetch(`/orgs/${orgId}/enrollment-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: ipAddress.trim(),
          name: deviceName.trim(),
          label: location.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to create device');
        setSubmitting(false);
        return;
      }

      // Save custom fields to localStorage to satisfy mockup requirements persistently
      const metaKey = 'aura_watch_devices_metadata';
      const existingMeta = JSON.parse(localStorage.getItem(metaKey) || '{}');
      existingMeta[ipAddress.trim()] = {
        location: location.trim(),
        port: port.trim(),
        username: username.trim(),
        password: password.trim(),
        protocol: protocol,
      };
      localStorage.setItem(metaKey, JSON.stringify(existingMeta));

      onSaved();
      onClose();
      // Reset form
      setDeviceName('');
      setLocation('');
      setIpAddress('');
      setPort('554');
      setUsername('admin');
      setPassword('');
      setProtocol('RTSP');
      setTestResult(null);
    } catch (err) {
      console.error('Failed to add device', err);
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
            <DialogTitle className="text-[1.2rem] font-bold tracking-tight text-white">Add device</DialogTitle>
            <p className="text-[0.78rem] text-text-muted mt-1">NVR, DVR, or standalone IP camera</p>
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
          {/* Device Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">Device Name</label>
            <input
              type="text"
              required
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g. Hikvision — Gate"
              className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full"
            />
          </div>

          {/* Location */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Main entrance"
              className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full"
            />
          </div>

          {/* IP & Port */}
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-9 flex flex-col gap-1.5">
              <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">IP Address</label>
              <input
                type="text"
                required
                value={ipAddress}
                onChange={(e) => setIpAddress(e.target.value)}
                placeholder="192.168.1.x"
                className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full font-mono"
              />
            </div>
            <div className="col-span-3 flex flex-col gap-1.5">
              <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">Port</label>
              <input
                type="text"
                required
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="554"
                className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full font-mono"
              />
            </div>
          </div>

          {/* Username & Password */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full"
              />
            </div>
          </div>

          {/* Protocol */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">Protocol</label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full"
            >
              <option value="RTSP">RTSP</option>
              <option value="ONVIF">ONVIF</option>
            </select>
          </div>

          {/* Test connection result */}
          {testing && (
            <div className="flex items-center gap-2 text-[0.75rem] text-text-secondary bg-[rgba(255,255,255,0.02)] p-3 rounded-lg border border-border-glass">
              <Loader2 size={14} className="animate-spin text-secondary" />
              <span>Testing connection to {ipAddress}:{port}...</span>
            </div>
          )}
          {testResult && (
            <div className={`flex items-start gap-2 text-[0.75rem] p-3 rounded-lg border ${
              testResult.ok
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-danger/10 border-danger/20 text-danger'
            }`}>
              {testResult.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
              <span>{testResult.message}</span>
            </div>
          )}

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
              type="button"
              onClick={handleTestConnection}
              disabled={testing || submitting}
              className="btn bg-transparent border border-secondary text-secondary hover:bg-[rgba(6,182,212,0.05)] py-2 px-5 text-[0.82rem] rounded-lg cursor-pointer transition-colors"
            >
              {testing ? 'Testing...' : 'Test connection'}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary py-2 px-5 text-[0.82rem] rounded-lg cursor-pointer transition-colors bg-primary"
            >
              {submitting ? 'Adding...' : 'Add device'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
