import type { EdgeDeviceConfig } from '@prisma/client';
import type { CameraStream, EdgeDevice } from '@prisma/client';
import {
  EDGE_DEVICE_CONFIG_DEFAULTS,
  type EdgeDeviceConfigDefaults,
} from '../config/edgeDeviceDefaults';

export type EffectiveEdgeDeviceConfig = EdgeDeviceConfigDefaults;

export { EDGE_DEVICE_CONFIG_DEFAULTS, STREAM_CONFIG_DEFAULTS } from '../config/edgeDeviceDefaults';

function pickDefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export function mergeDeviceConfig(
  stored: EdgeDeviceConfig | null | undefined,
): EffectiveEdgeDeviceConfig {
  if (!stored) return { ...EDGE_DEVICE_CONFIG_DEFAULTS };
  const overrides: Partial<EffectiveEdgeDeviceConfig> = {};
  for (const key of DEVICE_CONFIG_KEYS) {
    const value = stored[key as keyof EdgeDeviceConfig];
    if (value !== null && value !== undefined) {
      overrides[key as keyof EffectiveEdgeDeviceConfig] = value as never;
    }
  }
  return { ...EDGE_DEVICE_CONFIG_DEFAULTS, ...overrides };
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

export const DEVICE_CONFIG_KEYS = Object.keys(EDGE_DEVICE_CONFIG_DEFAULTS);

export function extractDeviceConfigPatch(body: Record<string, unknown>): Partial<EdgeDeviceConfig> {
  return pickDefined(
    Object.fromEntries(
      DEVICE_CONFIG_KEYS.filter((key) => key in body).map((key) => [key, body[key]]),
    ),
  ) as Partial<EdgeDeviceConfig>;
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
    })),
  };
}

export function withEffectiveDeviceConfig<T extends EdgeDevice>(device: T) {
  return {
    ...device,
    effectiveConfig: mergeDeviceConfig(device.config),
  };
}
