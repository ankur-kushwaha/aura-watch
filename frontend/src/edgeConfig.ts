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

export const DEFAULT_DEVICE_CONFIG: EffectiveEdgeDeviceConfig = {
  yoloConfidence: 0.25,
  yoloDevice: 'auto',
  yoloImgsz: 416,
  yoloDetectInterval: 3,
  cameraWidth: 640,
  cameraHeight: 480,
  cameraFps: 15,
  clipEncodeFps: 10,
  cameraStallTimeoutSec: 45,
  frameStreamFps: 12,
  previewJpegQuality: 70,
  previewStallTimeoutSec: 5,
  recordingMaxSec: 60,
  recordingEndGraceSec: 5,
  recordingCooldownSec: 45,
  minUploadDurationSec: 2,
  reidConfidenceThreshold: 0.65,
  reidMinBboxSize: 2500,
  reidVisibleSec: 1.0,
  debugLogs: true,
};

export function createDefaultDeviceConfig(): EffectiveEdgeDeviceConfig {
  return { ...DEFAULT_DEVICE_CONFIG };
}
