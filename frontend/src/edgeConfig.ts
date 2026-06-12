import deviceDefaults from '../../config/edge-device-defaults.json';

export interface EdgeDeviceConfig {
  yoloConfidence?: number | null;
  yoloDevice?: string | null;
  yoloImgsz?: number | null;
  yoloDetectInterval?: number | null;
  cameraWidth?: number | null;
  cameraHeight?: number | null;
  cameraFps?: number | null;
  clipEncodeFps?: number | null;
  cameraStallTimeoutSec?: number | null;
  frameStreamFps?: number | null;
  previewJpegQuality?: number | null;
  previewStallTimeoutSec?: number | null;
  recordingMaxSec?: number | null;
  recordingEndGraceSec?: number | null;
  recordingCooldownSec?: number | null;
  minUploadDurationSec?: number | null;
  reidConfidenceThreshold?: number | null;
  reidMinBboxSize?: number | null;
  reidVisibleSec?: number | null;
  debugLogs?: boolean | null;
}

type EffectiveConfig<T> = {
  [K in keyof T]-?: NonNullable<T[K]>;
};

export type EffectiveEdgeDeviceConfig = EffectiveConfig<EdgeDeviceConfig>;

/** Loaded from config/edge-device-defaults.json — do not duplicate values here. */
export const DEFAULT_DEVICE_CONFIG: EffectiveEdgeDeviceConfig = {
  ...deviceDefaults.deviceConfig,
};

export const DEFAULT_STREAM_CONFIG = {
  ...deviceDefaults.streamDefaults,
};

export function createDefaultDeviceConfig(): EffectiveEdgeDeviceConfig {
  return { ...DEFAULT_DEVICE_CONFIG };
}

export const DEVICE_CONFIG_KEYS = Object.keys(DEFAULT_DEVICE_CONFIG) as (keyof EffectiveEdgeDeviceConfig)[];
