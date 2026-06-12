import type { CameraStream, EdgeDevice, EdgeDeviceConfig, StreamSettings } from '@prisma/client';

/** Defaults matching edge/.env.example — used for API effective-value display. */
export const EDGE_DEVICE_CONFIG_DEFAULTS: Required<{
  yoloConfidence: number;
  yoloDevice: string;
  yoloImgsz: number;
  yoloDetectInterval: number;
  cameraWidth: number;
  cameraHeight: number;
  cameraFps: number;
  clipEncodeFps: number;
  cameraStallTimeoutSec: number;
  frameStreamFps: number;
  previewJpegQuality: number;
  previewStallTimeoutSec: number;
  recordingMaxSec: number;
  recordingEndGraceSec: number;
  recordingCooldownSec: number;
  minUploadDurationSec: number;
  reidConfidenceThreshold: number;
  reidMinBboxSize: number;
  reidVisibleSec: number;
  debugLogs: boolean;
}> = {
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
  recordingCooldownSec: 20,
  minUploadDurationSec: 2,
  reidConfidenceThreshold: 0.65,
  reidMinBboxSize: 2500,
  reidVisibleSec: 1.0,
  debugLogs: true,
};

export const STREAM_SETTINGS_DEFAULTS: Required<{
  cameraWidth: number;
  cameraHeight: number;
  cameraFps: number;
  rtspTransport: string;
  rtspLocalAddr: string;
  clipEncodeFps: number;
  recordingMaxSec: number;
  recordingEndGraceSec: number;
  recordingCooldownSec: number;
  minUploadDurationSec: number;
  yoloConfidence: number;
  yoloImgsz: number;
  yoloDetectInterval: number;
  frameStreamFps: number;
  previewJpegQuality: number;
  previewStallTimeoutSec: number;
  reidConfidenceThreshold: number;
  reidMinBboxSize: number;
  reidVisibleSec: number;
}> = {
  cameraWidth: EDGE_DEVICE_CONFIG_DEFAULTS.cameraWidth,
  cameraHeight: EDGE_DEVICE_CONFIG_DEFAULTS.cameraHeight,
  cameraFps: EDGE_DEVICE_CONFIG_DEFAULTS.cameraFps,
  rtspTransport: 'tcp',
  rtspLocalAddr: '',
  clipEncodeFps: EDGE_DEVICE_CONFIG_DEFAULTS.clipEncodeFps,
  recordingMaxSec: EDGE_DEVICE_CONFIG_DEFAULTS.recordingMaxSec,
  recordingEndGraceSec: EDGE_DEVICE_CONFIG_DEFAULTS.recordingEndGraceSec,
  recordingCooldownSec: EDGE_DEVICE_CONFIG_DEFAULTS.recordingCooldownSec,
  minUploadDurationSec: EDGE_DEVICE_CONFIG_DEFAULTS.minUploadDurationSec,
  yoloConfidence: EDGE_DEVICE_CONFIG_DEFAULTS.yoloConfidence,
  yoloImgsz: EDGE_DEVICE_CONFIG_DEFAULTS.yoloImgsz,
  yoloDetectInterval: EDGE_DEVICE_CONFIG_DEFAULTS.yoloDetectInterval,
  frameStreamFps: EDGE_DEVICE_CONFIG_DEFAULTS.frameStreamFps,
  previewJpegQuality: EDGE_DEVICE_CONFIG_DEFAULTS.previewJpegQuality,
  previewStallTimeoutSec: EDGE_DEVICE_CONFIG_DEFAULTS.previewStallTimeoutSec,
  reidConfidenceThreshold: EDGE_DEVICE_CONFIG_DEFAULTS.reidConfidenceThreshold,
  reidMinBboxSize: EDGE_DEVICE_CONFIG_DEFAULTS.reidMinBboxSize,
  reidVisibleSec: EDGE_DEVICE_CONFIG_DEFAULTS.reidVisibleSec,
};

export type EffectiveEdgeDeviceConfig = typeof EDGE_DEVICE_CONFIG_DEFAULTS;
export type EffectiveStreamSettings = typeof STREAM_SETTINGS_DEFAULTS;

function pickDefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

function applyDefinedDefaults<T extends Record<string, unknown>>(
  defaults: T,
  stored: Record<string, unknown> | null | undefined,
): T {
  const merged = { ...defaults };
  if (!stored) return merged;
  for (const key of Object.keys(defaults)) {
    const value = stored[key];
    if (value !== null && value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

export function mergeDeviceConfig(
  stored: EdgeDeviceConfig | null | undefined,
): EffectiveEdgeDeviceConfig {
  return applyDefinedDefaults(EDGE_DEVICE_CONFIG_DEFAULTS, stored as Record<string, unknown> | null);
}

export function mergeStreamSettings(
  stored: StreamSettings | null | undefined,
  deviceConfig?: EdgeDeviceConfig | null,
): EffectiveStreamSettings {
  const deviceMerged = mergeDeviceConfig(deviceConfig);
  return applyDefinedDefaults(
    {
      ...STREAM_SETTINGS_DEFAULTS,
      cameraWidth: deviceMerged.cameraWidth,
      cameraHeight: deviceMerged.cameraHeight,
      cameraFps: deviceMerged.cameraFps,
      clipEncodeFps: deviceMerged.clipEncodeFps,
      recordingMaxSec: deviceMerged.recordingMaxSec,
      recordingEndGraceSec: deviceMerged.recordingEndGraceSec,
      recordingCooldownSec: deviceMerged.recordingCooldownSec,
      minUploadDurationSec: deviceMerged.minUploadDurationSec,
      yoloConfidence: deviceMerged.yoloConfidence,
      yoloImgsz: deviceMerged.yoloImgsz,
      yoloDetectInterval: deviceMerged.yoloDetectInterval,
      frameStreamFps: deviceMerged.frameStreamFps,
      previewJpegQuality: deviceMerged.previewJpegQuality,
      previewStallTimeoutSec: deviceMerged.previewStallTimeoutSec,
      reidConfidenceThreshold: deviceMerged.reidConfidenceThreshold,
      reidMinBboxSize: deviceMerged.reidMinBboxSize,
      reidVisibleSec: deviceMerged.reidVisibleSec,
    },
    stored as Record<string, unknown> | null,
  );
}

export function mergeDeviceConfigUpdate(
  existing: EdgeDeviceConfig | null | undefined,
  patch: Record<string, unknown>,
): EdgeDeviceConfig {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') {
      delete next[key];
    } else if (value !== undefined) {
      next[key] = value;
    }
  }
  return next as EdgeDeviceConfig;
}

export function mergeStreamSettingsUpdate(
  existing: StreamSettings | null | undefined,
  patch: Record<string, unknown>,
): StreamSettings {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') {
      delete next[key];
    } else if (value !== undefined) {
      next[key] = value;
    }
  }
  return next as StreamSettings;
}

export const DEVICE_CONFIG_KEYS = Object.keys(EDGE_DEVICE_CONFIG_DEFAULTS);
export const STREAM_SETTINGS_KEYS = Object.keys(STREAM_SETTINGS_DEFAULTS);

export function extractDeviceConfigPatch(body: Record<string, unknown>): Partial<EdgeDeviceConfig> {
  return pickDefined(
    Object.fromEntries(
      DEVICE_CONFIG_KEYS.filter((key) => key in body).map((key) => [key, body[key]]),
    ),
  ) as Partial<EdgeDeviceConfig>;
}

export function extractStreamSettingsPatch(body: Record<string, unknown>): Partial<StreamSettings> {
  return pickDefined(
    Object.fromEntries(
      STREAM_SETTINGS_KEYS.filter((key) => key in body).map((key) => [key, body[key]]),
    ),
  ) as Partial<StreamSettings>;
}

export function buildConfigurePayload(
  device: Pick<EdgeDevice, 'config'>,
  streams: CameraStream[],
) {
  return {
    type: 'configure' as const,
    deviceConfig: device.config ?? {},
    streams: streams.map((stream) => ({
      streamId: stream.streamId,
      name: stream.name,
      cameraType: stream.cameraType,
      streamUrl: stream.streamUrl,
      trackingEnabled: stream.trackingEnabled,
      motionThreshold: stream.motionThreshold,
      pixelChangeThreshold: stream.pixelChangeThreshold,
      detectPerson: stream.detectPerson,
      detectVehicle: stream.detectVehicle,
      settings: stream.settings ?? {},
    })),
  };
}

export function withEffectiveDeviceConfig<T extends EdgeDevice>(device: T) {
  return {
    ...device,
    effectiveConfig: mergeDeviceConfig(device.config),
  };
}

export function withEffectiveStreamSettings<T extends CameraStream>(
  stream: T,
  deviceConfig?: EdgeDeviceConfig | null,
) {
  return {
    ...stream,
    effectiveSettings: mergeStreamSettings(stream.settings, deviceConfig),
  };
}
