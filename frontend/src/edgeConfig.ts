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
  reidConfidenceThreshold?: number | null;
  reidMinBboxSize?: number | null;
  reidVisibleSec?: number | null;
  debugLogs?: boolean | null;
}

export interface StreamSettings {
  cameraWidth?: number | null;
  cameraHeight?: number | null;
  cameraFps?: number | null;
  rtspTransport?: string | null;
  rtspLocalAddr?: string | null;
  clipEncodeFps?: number | null;
  recordingMaxSec?: number | null;
  recordingEndGraceSec?: number | null;
  recordingCooldownSec?: number | null;
  yoloConfidence?: number | null;
  yoloImgsz?: number | null;
  yoloDetectInterval?: number | null;
  frameStreamFps?: number | null;
  previewJpegQuality?: number | null;
  previewStallTimeoutSec?: number | null;
  reidConfidenceThreshold?: number | null;
  reidMinBboxSize?: number | null;
  reidVisibleSec?: number | null;
}

export type EffectiveEdgeDeviceConfig = Required<EdgeDeviceConfig> & { debugLogs: boolean };
export type EffectiveStreamSettings = Required<
  Omit<StreamSettings, 'rtspLocalAddr'>
> & { rtspLocalAddr: string };

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
  recordingEndGraceSec: 2,
  recordingCooldownSec: 45,
  reidConfidenceThreshold: 0.65,
  reidMinBboxSize: 2500,
  reidVisibleSec: 1.0,
  debugLogs: true,
};

export const DEFAULT_STREAM_SETTINGS: EffectiveStreamSettings = {
  cameraWidth: 640,
  cameraHeight: 480,
  cameraFps: 15,
  rtspTransport: 'tcp',
  rtspLocalAddr: '',
  clipEncodeFps: 10,
  recordingMaxSec: 60,
  recordingEndGraceSec: 2,
  recordingCooldownSec: 45,
  yoloConfidence: 0.25,
  yoloImgsz: 416,
  yoloDetectInterval: 3,
  frameStreamFps: 12,
  previewJpegQuality: 70,
  previewStallTimeoutSec: 5,
  reidConfidenceThreshold: 0.65,
  reidMinBboxSize: 2500,
  reidVisibleSec: 1.0,
};

export function createDefaultDeviceConfig(): EffectiveEdgeDeviceConfig {
  return { ...DEFAULT_DEVICE_CONFIG };
}

export function createDefaultStreamSettings(): EffectiveStreamSettings {
  return { ...DEFAULT_STREAM_SETTINGS };
}

export function createDefaultDeviceConfig(): EffectiveEdgeDeviceConfig {
  return { ...DEFAULT_DEVICE_CONFIG };
}

export function createDefaultStreamSettings(): EffectiveStreamSettings {
  return { ...DEFAULT_STREAM_SETTINGS };
}
