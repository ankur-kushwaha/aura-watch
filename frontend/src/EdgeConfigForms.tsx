import React from 'react';
import type { EffectiveEdgeDeviceConfig, EffectiveStreamSettings } from './edgeConfig';

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[0.72rem] text-text-secondary font-medium">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="text-[0.68rem] text-text-muted leading-relaxed">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border border-[rgba(255,255,255,0.06)] rounded-lg p-3 bg-[rgba(255,255,255,0.02)]">
      <h3 className="text-[0.78rem] font-semibold text-text-primary">{title}</h3>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

export function DeviceConfigFields({
  config,
  onChange,
}: {
  config: EffectiveEdgeDeviceConfig;
  onChange: (next: EffectiveEdgeDeviceConfig) => void;
}) {
  const set = <K extends keyof EffectiveEdgeDeviceConfig>(key: K, value: EffectiveEdgeDeviceConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
      <p className="text-[0.72rem] text-text-muted leading-relaxed">
        Values are stored in the cloud and pushed to the edge device. Unset fields on the device still fall back to its local <code>.env</code> file.
      </p>

      <Section title="Capture">
        <NumberField label="Width (px)" value={config.cameraWidth} onChange={(v) => set('cameraWidth', v)} min={160} max={3840} />
        <NumberField label="Height (px)" value={config.cameraHeight} onChange={(v) => set('cameraHeight', v)} min={120} max={2160} />
        <NumberField label="FPS" value={config.cameraFps} onChange={(v) => set('cameraFps', v)} min={1} max={60} />
        <NumberField label="Stall timeout (sec)" value={config.cameraStallTimeoutSec} onChange={(v) => set('cameraStallTimeoutSec', v)} min={5} max={300} />
      </Section>

      <Section title="YOLO / Detection">
        <NumberField label="Confidence" value={config.yoloConfidence} onChange={(v) => set('yoloConfidence', v)} min={0.05} max={1} step={0.05} />
        <div className="flex flex-col gap-1.5">
          <label className="text-[0.72rem] text-text-secondary font-medium">Device</label>
          <select value={config.yoloDevice} onChange={(e) => set('yoloDevice', e.target.value)}>
            <option value="auto">auto</option>
            <option value="cpu">cpu</option>
            <option value="mps">mps</option>
            <option value="cuda">cuda</option>
          </select>
        </div>
        <NumberField label="Image size" value={config.yoloImgsz} onChange={(v) => set('yoloImgsz', v)} min={320} max={1280} step={32} />
        <NumberField label="Detect interval (frames)" value={config.yoloDetectInterval} onChange={(v) => set('yoloDetectInterval', v)} min={1} max={30} />
      </Section>

      <Section title="Preview">
        <NumberField label="Stream FPS" value={config.frameStreamFps} onChange={(v) => set('frameStreamFps', v)} min={1} max={30} step={0.5} />
        <NumberField label="JPEG quality" value={config.previewJpegQuality} onChange={(v) => set('previewJpegQuality', v)} min={30} max={95} />
        <NumberField label="Stall timeout (sec)" value={config.previewStallTimeoutSec} onChange={(v) => set('previewStallTimeoutSec', v)} min={1} max={60} />
      </Section>

      <Section title="Recording">
        <NumberField label="Encode FPS" value={config.clipEncodeFps} onChange={(v) => set('clipEncodeFps', v)} min={1} max={30} />
        <NumberField label="Max clip length (sec)" value={config.recordingMaxSec} onChange={(v) => set('recordingMaxSec', v)} min={5} max={300} />
        <NumberField label="End grace (sec)" value={config.recordingEndGraceSec} onChange={(v) => set('recordingEndGraceSec', v)} min={0} max={30} step={0.5} />
        <NumberField label="Cooldown (sec)" value={config.recordingCooldownSec} onChange={(v) => set('recordingCooldownSec', v)} min={0} max={300} />
      </Section>

      <Section title="ReID">
        <NumberField label="Confidence threshold" value={config.reidConfidenceThreshold} onChange={(v) => set('reidConfidenceThreshold', v)} min={0.1} max={1} step={0.05} />
        <NumberField label="Min bbox area (px²)" value={config.reidMinBboxSize} onChange={(v) => set('reidMinBboxSize', v)} min={500} max={50000} step={100} />
        <NumberField label="Visible before crop (sec)" value={config.reidVisibleSec} onChange={(v) => set('reidVisibleSec', v)} min={0.1} max={10} step={0.1} />
      </Section>

      <label className="flex items-center gap-2 text-[0.82rem] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={config.debugLogs}
          onChange={(e) => set('debugLogs', e.target.checked)}
          className="w-4 h-4 accent-[#a78bfa]"
        />
        Verbose debug logs
      </label>
    </div>
  );
}

export function StreamAdvancedFields({
  settings,
  onChange,
  isRtsp,
}: {
  settings: EffectiveStreamSettings;
  onChange: (next: EffectiveStreamSettings) => void;
  isRtsp: boolean;
}) {
  const set = <K extends keyof EffectiveStreamSettings>(key: K, value: EffectiveStreamSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.72rem] text-text-muted leading-relaxed">
        Stream overrides take priority over device settings. Leave unchanged to inherit from the device or edge <code>.env</code>.
      </p>

      {isRtsp && (
        <Section title="RTSP">
          <div className="flex flex-col gap-1.5 col-span-2">
            <label className="text-[0.72rem] text-text-secondary font-medium">Transport</label>
            <select value={settings.rtspTransport} onChange={(e) => set('rtspTransport', e.target.value)}>
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
              <option value="auto">auto</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5 col-span-2">
            <label className="text-[0.72rem] text-text-secondary font-medium">Local bind address</label>
            <input
              type="text"
              value={settings.rtspLocalAddr}
              onChange={(e) => set('rtspLocalAddr', e.target.value)}
              placeholder="Optional, e.g. 192.168.1.10"
            />
          </div>
        </Section>
      )}

      <Section title="Capture override">
        <NumberField label="Width (px)" value={settings.cameraWidth} onChange={(v) => set('cameraWidth', v)} min={160} max={3840} />
        <NumberField label="Height (px)" value={settings.cameraHeight} onChange={(v) => set('cameraHeight', v)} min={120} max={2160} />
        <NumberField label="FPS" value={settings.cameraFps} onChange={(v) => set('cameraFps', v)} min={1} max={60} />
      </Section>

      <Section title="Detection override">
        <NumberField label="Confidence" value={settings.yoloConfidence} onChange={(v) => set('yoloConfidence', v)} min={0.05} max={1} step={0.05} />
        <NumberField label="Image size" value={settings.yoloImgsz} onChange={(v) => set('yoloImgsz', v)} min={320} max={1280} step={32} />
        <NumberField label="Detect interval" value={settings.yoloDetectInterval} onChange={(v) => set('yoloDetectInterval', v)} min={1} max={30} />
      </Section>

      <Section title="Preview override">
        <NumberField label="Stream FPS" value={settings.frameStreamFps} onChange={(v) => set('frameStreamFps', v)} min={1} max={30} step={0.5} />
        <NumberField label="JPEG quality" value={settings.previewJpegQuality} onChange={(v) => set('previewJpegQuality', v)} min={30} max={95} />
        <NumberField label="Stall timeout (sec)" value={settings.previewStallTimeoutSec} onChange={(v) => set('previewStallTimeoutSec', v)} min={1} max={60} />
      </Section>

      <Section title="Recording override">
        <NumberField label="Encode FPS" value={settings.clipEncodeFps} onChange={(v) => set('clipEncodeFps', v)} min={1} max={30} />
        <NumberField label="Max clip (sec)" value={settings.recordingMaxSec} onChange={(v) => set('recordingMaxSec', v)} min={5} max={300} />
        <NumberField label="End grace (sec)" value={settings.recordingEndGraceSec} onChange={(v) => set('recordingEndGraceSec', v)} min={0} max={30} step={0.5} />
        <NumberField label="Cooldown (sec)" value={settings.recordingCooldownSec} onChange={(v) => set('recordingCooldownSec', v)} min={0} max={300} />
      </Section>

      <Section title="ReID override">
        <NumberField label="Confidence" value={settings.reidConfidenceThreshold} onChange={(v) => set('reidConfidenceThreshold', v)} min={0.1} max={1} step={0.05} />
        <NumberField label="Min bbox (px²)" value={settings.reidMinBboxSize} onChange={(v) => set('reidMinBboxSize', v)} min={500} max={50000} step={100} />
        <NumberField label="Visible (sec)" value={settings.reidVisibleSec} onChange={(v) => set('reidVisibleSec', v)} min={0.1} max={10} step={0.1} />
      </Section>
    </div>
  );
}
