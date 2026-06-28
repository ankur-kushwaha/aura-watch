import React from 'react';
import type { EffectiveEdgeDeviceConfig } from './edgeConfig';

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
    <div className="flex flex-col gap-3 pr-1">
      <p className="text-[0.72rem] text-text-muted leading-relaxed">
        Values are stored in the cloud and pushed to the edge device. Unset fields on the device still fall back to its local <code>.env</code> file.
      </p>

      <Section title="Recording">
        <NumberField label="Max clip length (sec)" value={config.recordingMaxSec} onChange={(v) => set('recordingMaxSec', v)} min={5} max={300} />
        <NumberField
          label="End grace (sec)"
          value={config.recordingEndGraceSec}
          onChange={(v) => set('recordingEndGraceSec', v)}
          min={0}
          max={30}
          step={0.5}
          hint="Stop recording after motion ends for this long."
        />
        <NumberField
          label="Wait before next clip (sec)"
          value={config.recordingCooldownSec}
          onChange={(v) => set('recordingCooldownSec', v)}
          min={0}
          max={300}
          hint="Minimum gap between clip uploads after one finishes."
        />
        <NumberField
          label="Min upload duration (sec)"
          value={config.minUploadDurationSec}
          onChange={(v) => set('minUploadDurationSec', v)}
          min={0}
          max={120}
          step={0.5}
          hint="Skip cloud upload for clips shorter than this (0 = disabled)."
        />
        <NumberField
          label="Pre-roll (sec)"
          value={config.clipPrerollSec}
          onChange={(v) => set('clipPrerollSec', v)}
          min={0}
          max={30}
          step={0.5}
          hint="Seconds of footage to include before motion is detected."
        />
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
