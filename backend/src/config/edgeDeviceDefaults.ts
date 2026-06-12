import fs from 'fs';
import path from 'path';

export interface EdgeDeviceConfigDefaults {
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
}

export interface StreamConfigDefaults {
  trackingEnabled: boolean;
  detectPerson: boolean;
  detectVehicle: boolean;
  motionThreshold: number;
  pixelChangeThreshold: number;
}

interface EdgeDefaultsFile {
  deviceConfig: EdgeDeviceConfigDefaults;
  streamDefaults: StreamConfigDefaults;
}

function findDefaultsFile(): string {
  const candidates = [
    path.resolve(__dirname, '../../../config/edge-device-defaults.json'),
    path.resolve(process.cwd(), 'config/edge-device-defaults.json'),
    path.resolve(__dirname, '../../config/edge-device-defaults.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    'config/edge-device-defaults.json not found. Expected at repo root or backend/config/.',
  );
}

function loadDefaultsFile(): EdgeDefaultsFile {
  const raw = fs.readFileSync(findDefaultsFile(), 'utf-8');
  return JSON.parse(raw) as EdgeDefaultsFile;
}

const loaded = loadDefaultsFile();

/** Canonical device runtime defaults — see config/edge-device-defaults.json */
export const EDGE_DEVICE_CONFIG_DEFAULTS: EdgeDeviceConfigDefaults = loaded.deviceConfig;

/** Canonical stream defaults for new camera streams */
export const STREAM_CONFIG_DEFAULTS: StreamConfigDefaults = loaded.streamDefaults;
