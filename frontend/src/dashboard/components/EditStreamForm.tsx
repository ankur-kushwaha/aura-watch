import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { apiFetch } from '../../api';
import { fetchAlertRules, updateAlertRule, type AlertRule } from '../../alertRulesApi';
import { ToggleSwitch } from './ToggleSwitch';
import type { CameraStream } from '../types';

export interface EditStreamFormProps {
  stream: CameraStream | null;
  allStreamIds?: string[];
  onClose: () => void;
  onSaved: () => void;
}

export function EditStreamForm({ stream, allStreamIds = [], onClose, onSaved }: EditStreamFormProps) {
  const navigate = useNavigate();
  const [cameraName, setCameraName] = useState('');
  const [streamUrl, setStreamUrl] = useState('');
  const [resolution, setResolution] = useState('4MP');
  const [fps, setFps] = useState('25');
  const [codec, setCodec] = useState('H.264');
  const [zone, setZone] = useState('');
  const [locationName, setLocationName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

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
    if (stream) {
      setCameraName(stream.name);
      setStreamUrl(stream.streamUrl);
      setPersonDetection(stream.detectPerson ?? true);
      setVehicleDetection(stream.detectVehicle ?? true);

      setResolution(stream.resolution || '4MP');
      setFps(stream.fps || '25');
      setCodec(stream.codec || 'H.264');
      const rawZone = stream.zone || 'Exterior';
      const normalizedZone = rawZone.toLowerCase().includes('lobby') || rawZone.toLowerCase().includes('reception') || rawZone.toLowerCase().includes('office') || rawZone.toLowerCase().includes('interior')
        ? 'Interior'
        : rawZone.toLowerCase().includes('server') || rawZone.toLowerCase().includes('corridor') || rawZone.toLowerCase().includes('restricted')
          ? 'Restricted'
          : 'Exterior';
      setZone(normalizedZone);
      setLoiteringAlert(stream.loiteringAlert !== undefined && stream.loiteringAlert !== null ? stream.loiteringAlert : true);
      setCrossCameraReid(stream.crossCameraReid !== undefined && stream.crossCameraReid !== null ? stream.crossCameraReid : true);
      setPlateRecognition(stream.plateRecognition !== undefined && stream.plateRecognition !== null ? stream.plateRecognition : true);
      setLocationName(stream.locationName || '');
      setLatitude(stream.latitude !== undefined && stream.latitude !== null ? String(stream.latitude) : '');
      setLongitude(stream.longitude !== undefined && stream.longitude !== null ? String(stream.longitude) : '');

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
        .catch((err) => console.error('Failed to load alert rules in EditStreamForm', err));
      setError(null);
    }
  }, [stream]);

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
          resolution,
          fps,
          codec,
          zone: zone.trim() || 'Entrance',
          loiteringAlert,
          crossCameraReid,
          plateRecognition,
          locationName: locationName.trim() || null,
          latitude: latitude.trim() ? parseFloat(latitude) : null,
          longitude: longitude.trim() ? parseFloat(longitude) : null,
        }),
      });

      if (!streamRes.ok) {
        const data = await streamRes.json().catch(() => ({}));
        setError(data.error || 'Failed to update stream configuration');
        setSubmitting(false);
        return;
      }

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
    } catch (err) {
      console.error('Failed to save stream configuration', err);
      setError('Connection failed. Please check backend status.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 flex-1 overflow-y-auto max-h-[calc(100vh-200px)] pr-1 animate-[fadeIn_0.2s_ease-out] text-left">
      {/* Camera Name */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[0.68rem] font-bold uppercase tracking-wider text-text-muted">Camera Name</label>
        <input
          type="text"
          required
          value={cameraName}
          onChange={(e) => setCameraName(e.target.value)}
          className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.82rem] px-3.5 py-2 rounded-lg focus:border-primary text-white outline-none w-full"
        />
      </div>

      {/* RTSP URL */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[0.68rem] font-bold uppercase tracking-wider text-text-muted">RTSP URL</label>
        <input
          type="text"
          required
          value={streamUrl}
          onChange={(e) => setStreamUrl(e.target.value)}
          className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.75rem] px-3.5 py-2 rounded-lg focus:border-primary text-white outline-none w-full font-mono"
        />
      </div>

      {/* Zone */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[0.68rem] font-bold uppercase tracking-wider text-text-muted">Zone</label>
        <select
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          className="bg-[#0b0f19] border border-border-glass text-[0.82rem] px-3.5 py-2 rounded-lg focus:border-primary text-white outline-none w-full cursor-pointer"
        >
          <option value="Interior" className="bg-[#0b0f19] text-white">Interior</option>
          <option value="Exterior" className="bg-[#0b0f19] text-white">Exterior</option>
          <option value="Restricted" className="bg-[#0b0f19] text-white">Restricted</option>
        </select>
      </div>

      {/* Location Name */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[0.68rem] font-bold uppercase tracking-wider text-text-muted">Location Name</label>
        <input
          type="text"
          placeholder="e.g. West Gate Entrance"
          value={locationName}
          onChange={(e) => setLocationName(e.target.value)}
          className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.82rem] px-3.5 py-2 rounded-lg focus:border-primary text-white outline-none w-full"
        />
      </div>

      {/* Lat / Lng Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1.5">
          <label className="text-[0.68rem] font-bold uppercase tracking-wider text-text-muted">Latitude</label>
          <input
            type="number"
            step="any"
            placeholder="e.g. 28.5355"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.82rem] px-3.5 py-2 rounded-lg focus:border-primary text-white outline-none w-full"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[0.68rem] font-bold uppercase tracking-wider text-text-muted">Longitude</label>
          <input
            type="number"
            step="any"
            placeholder="e.g. 77.3910"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            className="bg-[rgba(15,23,42,0.4)] border border-border-glass text-[0.82rem] px-3.5 py-2 rounded-lg focus:border-primary text-white outline-none w-full"
          />
        </div>
      </div>

      {/* AI Detection Section */}
      <div className="flex flex-col gap-2 pt-1">
        <label className="text-[0.68rem] font-bold uppercase tracking-wider text-text-muted">AI Detection</label>
        <div className="flex flex-col gap-2 bg-[rgba(15,23,42,0.25)] p-3 rounded-xl border border-border-glass">
          <ToggleSwitch checked={personDetection} onChange={setPersonDetection} label="Person detection" />
          <ToggleSwitch checked={vehicleDetection} onChange={setVehicleDetection} label="Vehicle detection" />
          {/* <ToggleSwitch checked={loiteringAlert} onChange={setLoiteringAlert} label="Loitering alert" /> */}
          {/* <ToggleSwitch checked={crossCameraReid} onChange={setCrossCameraReid} label="Cross-camera ReID" /> */}
          {/* <ToggleSwitch checked={plateRecognition} onChange={setPlateRecognition} label="Plate recognition" /> */}

          {/* Custom rules toggles */}
          {customRules.length > 0 && (
            <>
              <div className="h-[1px] bg-border-glass my-1" />
              <div className="flex justify-between items-center mb-1">
                <p className="text-[0.62rem] font-extrabold uppercase tracking-widest text-text-muted">Custom Alert Rules</p>
                <button
                  type="button"
                  onClick={() => navigate('/app/notifications')}
                  className="text-[0.65rem] font-bold text-[var(--color-secondary)] hover:text-white transition-colors bg-transparent border-none outline-none cursor-pointer p-0"
                >
                  Edit rules
                </button>
              </div>
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
        <div className="flex items-start gap-2 text-[0.72rem] p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="h-[1px] bg-border-glass my-1 shrink-0" />

      {/* Actions */}
      <div className="flex gap-2 justify-end items-center mt-1">
        <button
          type="button"
          onClick={onClose}
          className="py-2 px-4 text-[0.78rem] font-bold rounded-lg cursor-pointer bg-[rgba(255,255,255,0.05)] border border-border-glass text-text-secondary hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="py-2 px-4 text-[0.78rem] font-bold rounded-lg cursor-pointer bg-[#7C3AED] hover:bg-[#6d28d9] text-white border-none transition-colors flex items-center gap-1.5"
        >
          {submitting ? <Loader2 size={12} className="animate-spin" /> : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
