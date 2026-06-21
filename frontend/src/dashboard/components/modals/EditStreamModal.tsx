import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { apiFetch } from '../../../api';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui/dialog';
import type { CameraStream } from '../../types';
import { fetchAlertRules, updateAlertRule, type AlertRule } from '../../../alertRulesApi';

export interface EditStreamModalProps {
  open: boolean;
  stream: CameraStream | null;
  allStreamIds?: string[];
  onClose: () => void;
  onSaved: () => void;
}

export function EditStreamModal({ open, stream, allStreamIds = [], onClose, onSaved }: EditStreamModalProps) {
  const [cameraName, setCameraName] = useState('');
  const [streamUrl, setStreamUrl] = useState('');
  const [resolution, setResolution] = useState('4MP');
  const [fps, setFps] = useState('25');
  const [codec, setCodec] = useState('H.264');
  const [zone, setZone] = useState('');

  // Standard AI Detection Toggles
  const [personDetection, setPersonDetection] = useState(true);
  const [vehicleDetection, setVehicleDetection] = useState(true);
  const [loiteringAlert, setLoiteringAlert] = useState(true);
  const [crossCameraReid, setCrossCameraReid] = useState(true);
  const [plateRecognition, setPlateRecognition] = useState(true);

  // Custom Alert Rules
  const [customRules, setCustomRules] = useState<AlertRule[]>([]);
  const [activeRuleIds, setActiveRuleIds] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch alert rules and sync state when stream changes
  useEffect(() => {
    if (open && stream) {
      setCameraName(stream.name);
      setStreamUrl(stream.streamUrl);
      setPersonDetection(stream.detectPerson ?? true);
      setVehicleDetection(stream.detectVehicle ?? true);

      // Load custom properties from LocalStorage
      const metaKey = 'aura_watch_streams_metadata';
      const existingMeta = JSON.parse(localStorage.getItem(metaKey) || '{}');
      const meta = existingMeta[stream.streamId] || {};

      setResolution(meta.resolution || '4MP');
      setFps(meta.fps || '25');
      setCodec(meta.codec || 'H.264');
      setZone(meta.zone || 'Entrance');
      setLoiteringAlert(meta.loiteringAlert !== undefined ? meta.loiteringAlert : true);
      setCrossCameraReid(meta.crossCameraReid !== undefined ? meta.crossCameraReid : true);
      setPlateRecognition(meta.plateRecognition !== undefined ? meta.plateRecognition : true);

      // Fetch org-wide alert rules
      fetchAlertRules()
        .then((data) => {
          setCustomRules(data.rules);
          const activeIds = new Set<string>();
          data.rules.forEach((rule) => {
            if (rule.allStreams || rule.streamIds.includes(stream.streamId)) {
              activeIds.add(rule.id);
            }
          });
          setActiveRuleIds(activeIds);
        })
        .catch((err) => console.error('Failed to load alert rules in EditStreamModal', err));
    }
  }, [open, stream]);

  const handleToggleCustomRule = (ruleId: string, checked: boolean) => {
    setActiveRuleIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(ruleId);
      } else {
        next.delete(ruleId);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stream) return;
    if (!cameraName.trim() || !streamUrl.trim()) {
      setError('Camera Name and RTSP URL are required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // 1. Update real schema properties via backend endpoint
      const streamRes = await apiFetch(`/streams/${stream.streamId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cameraName.trim(),
          cameraType: 'rtsp',
          streamUrl: streamUrl.trim(),
          trackingEnabled: stream.trackingEnabled,
          motionThreshold: stream.motionThreshold,
          pixelChangeThreshold: stream.pixelChangeThreshold,
          detectPerson: personDetection,
          detectVehicle: vehicleDetection,
        }),
      });

      if (!streamRes.ok) {
        const data = await streamRes.json().catch(() => ({}));
        setError(data.error || 'Failed to update stream configuration');
        setSubmitting(false);
        return;
      }

      // 2. Save mockup metadata persistently in LocalStorage
      const metaKey = 'aura_watch_streams_metadata';
      const existingMeta = JSON.parse(localStorage.getItem(metaKey) || '{}');
      existingMeta[stream.streamId] = {
        resolution,
        fps,
        codec,
        zone: zone.trim() || 'Entrance',
        loiteringAlert,
        crossCameraReid,
        plateRecognition,
      };
      localStorage.setItem(metaKey, JSON.stringify(existingMeta));

      // 3. Update alert rules configurations in database
      await Promise.all(
        customRules.map(async (rule) => {
          const wasActive = rule.allStreams || rule.streamIds.includes(stream.streamId);
          const isActiveNow = activeRuleIds.has(rule.id);

          if (wasActive === isActiveNow) return; // No change

          if (isActiveNow) {
            // Add stream to rule streamIds list
            const nextStreamIds = Array.from(new Set([...rule.streamIds, stream.streamId]));
            await updateAlertRule(rule.id, {
              streamIds: nextStreamIds,
            });
          } else {
            // Remove stream from rule streamIds list
            let nextStreamIds = rule.streamIds.filter((id) => id !== stream.streamId);
            let nextAllStreams = rule.allStreams;

            if (rule.allStreams) {
              // If it applied to all streams, explicitly map all streams EXCEPT the current one
              nextAllStreams = false;
              nextStreamIds = allStreamIds.filter((id) => id !== stream.streamId);
            }

            await updateAlertRule(rule.id, {
              allStreams: nextAllStreams,
              streamIds: nextStreamIds,
            });
          }
        }),
      );

      onSaved();
      onClose();
    } catch (err) {
      console.error('Failed to save stream configuration', err);
      setError('Connection failed. Please check backend status.');
    } finally {
      setSubmitting(false);
    }
  };

  const ToggleSwitch = ({
    checked,
    onChange,
    label,
  }: {
    checked: boolean;
    onChange: (val: boolean) => void;
    label: string;
  }) => (
    <div className="flex justify-between items-center py-1">
      <span className="text-[0.85rem] font-medium text-text-secondary">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full p-0.5 transition-colors duration-200 focus:outline-none relative border-none cursor-pointer ${
          checked ? 'bg-[#7C3AED]' : 'bg-[rgba(255,255,255,0.08)]'
        }`}
      >
        <span
          className={`w-5 h-5 rounded-full bg-white block transition-transform duration-200 shadow-md ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );

  return (
    <Dialog open={open && !!stream} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-w-[480px] p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto bg-[#0b0f19] border border-border-glass text-text-primary rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="text-left">
            <DialogTitle className="text-[1.2rem] font-bold tracking-tight text-white">Stream settings</DialogTitle>
            <p className="text-[0.78rem] text-text-muted mt-1">{stream?.name}</p>
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
              className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full"
            />
          </div>

          {/* RTSP URL */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">RTSP URL</label>
            <input
              type="text"
              required
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full font-mono"
            />
          </div>

          {/* Resolution, FPS, Codec selectors */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">Resolution</label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full"
              >
                <option value="2MP">2MP</option>
                <option value="4MP">4MP</option>
                <option value="8MP">8MP</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">FPS</label>
              <select
                value={fps}
                onChange={(e) => setFps(e.target.value)}
                className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full"
              >
                <option value="15">15</option>
                <option value="20">20</option>
                <option value="25">25</option>
                <option value="30">30</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">Codec</label>
              <select
                value={codec}
                onChange={(e) => setCodec(e.target.value)}
                className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full"
              >
                <option value="H.264">H.264</option>
                <option value="H.265">H.265</option>
              </select>
            </div>
          </div>

          {/* Zone */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">Zone</label>
            <input
              type="text"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.88rem] px-3.5 py-2.5 rounded-lg focus:border-primary text-white outline-none w-full"
            />
          </div>

          {/* AI Detection Section */}
          <div className="flex flex-col gap-2.5 pt-2">
            <label className="text-[0.72rem] font-bold uppercase tracking-wider text-text-muted">AI Detection</label>
            <div className="flex flex-col gap-2 bg-[rgba(15,23,42,0.2)] p-4 rounded-xl border border-border-glass">
              <ToggleSwitch checked={personDetection} onChange={setPersonDetection} label="Person detection" />
              <ToggleSwitch checked={vehicleDetection} onChange={setVehicleDetection} label="Vehicle detection" />
              <ToggleSwitch checked={loiteringAlert} onChange={setLoiteringAlert} label="Loitering alert" />
              <ToggleSwitch checked={crossCameraReid} onChange={setCrossCameraReid} label="Cross-camera ReID" />
              <ToggleSwitch checked={plateRecognition} onChange={setPlateRecognition} label="Plate recognition" />
              
              {/* Custom rules toggles */}
              {customRules.length > 0 && (
                <>
                  <div className="h-[1px] bg-border-glass my-2" />
                  <p className="text-[0.62rem] font-extrabold uppercase tracking-widest text-text-muted mb-1 text-left">Custom Alert Rules</p>
                  {customRules.map((rule) => (
                    <ToggleSwitch
                      key={rule.id}
                      checked={activeRuleIds.has(rule.id)}
                      onChange={(checked) => handleToggleCustomRule(rule.id, checked)}
                      label={rule.name}
                    />
                  ))}
                </>
              )}
            </div>
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
              {submitting ? <Loader2 size={12} className="animate-spin" /> : 'Save changes'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
