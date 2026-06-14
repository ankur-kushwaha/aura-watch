import type { EffectiveEdgeDeviceConfig } from '../edgeConfig';

export type DashboardTab = 'events' | 'reid';

export interface VideoClipDetectedObject {
  trackId: number;
  className: string;
  confidence: number;
  heightRatio?: number;
  upperColor?: string;
  lowerColor?: string;
  vehicleColor?: string;
}

export interface VideoClip {
  id: string;
  filepath: string;
  filename: string;
  timestamp: string;
  summary: string;
  aiSummary?: string | null;
  duration: number;
  camera: string;
  deviceId?: string;
  streamId?: string;
  detectedObjects?: VideoClipDetectedObject[];
  reidLog?: { trackEventsReceived?: number };
}

export interface ClipObjectDetection {
  trackId: number;
  className: string;
  confidence?: number;
  heightRatio?: number;
  upperColor?: string;
  lowerColor?: string;
  vehicleColor?: string;
  detectionId?: string;
  identityId?: string | null;
  cropFilename?: string;
  labelStatus: 'confirmed' | 'suggested' | 'none';
  label?: string;
  matchScore?: number;
}

export interface ClipReidLogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface ClipReidLog {
  trackEventsReceived: number;
  reidDetectionsLinked?: number;
  cropsExtracted?: number;
  trackingEnabled?: boolean;
  entries: ClipReidLogEntry[];
}

export interface ClipDetectionsResponse {
  objects: ClipObjectDetection[];
  reidLog: ClipReidLog;
}

export interface MatchScores {
  vectorSimilarity: number;
  timeScore: number;
  topologyScore: number;
  finalScore: number;
  feedbackBoost?: number;
}

export interface PersonClipReference {
  id: string;
  cameraName: string;
  timestamp: string;
  filename: string;
  clipFilename?: string | null;
  clipOffsetMs?: number | null;
  trackId?: number;
  identityId?: string | null;
  matchScore?: number;
  scores?: MatchScores;
  source: 'query' | 'identity' | 'match';
}

export interface EdgeDevice {
  id: string;
  deviceId: string;
  name: string;
  status: string;
  lastHeartbeat: string;
  gitCommit?: string | null;
  remoteGitCommit?: string | null;
  config?: Record<string, unknown> | null;
  effectiveConfig?: EffectiveEdgeDeviceConfig;
}

export interface DeviceSystemMetrics {
  hostname?: string;
  platform?: string;
  cpu_percent?: number | null;
  cpu_count?: number;
  load_avg?: number[] | null;
  memory_total_bytes?: number;
  memory_used_bytes?: number;
  memory_available_bytes?: number;
  swap_total_bytes?: number;
  swap_used_bytes?: number;
  disk_total_bytes?: number;
  disk_used_bytes?: number;
  disk_free_bytes?: number;
  uptime_seconds?: number | null;
  timestamp?: number;
}

export interface CameraStream {
  id: string;
  streamId: string;
  deviceId: string;
  name: string;
  cameraType: 'webcam' | 'rtsp';
  streamUrl: string;
  trackingEnabled: boolean;
  status: string;
  lastHeartbeat: string;
  motionThreshold: number;
  pixelChangeThreshold: number;
  detectPerson: boolean;
  detectVehicle: boolean;
  streamHost: string;
}

export interface CameraConfig {
  name: string;
  type: 'webcam' | 'rtsp';
  streamUrl: string;
  trackingEnabled: boolean;
  motionThreshold?: number;
  pixelChangeThreshold?: number;
  detectPerson: boolean;
  detectVehicle: boolean;
}

export interface RagResponseClip {
  id: string;
  camera: string;
  timestamp: string;
  summary: string;
  aiSummary?: string | null;
  filepath: string;
  filename?: string;
  deviceId?: string | null;
  score: number;
}

export interface ReidPerson {
  id: string;
  label?: string | null;
  displayName: string;
  coverFilename: string | null;
  coverCameraName: string | null;
  coverDetectionId?: string | null;
  coverClipId?: string | null;
  photoCount: number;
  galleryCount?: number;
  lastSeen: string | null;
  streamTracks: { streamId: string; trackId: number; cameraName: string; cropCount: number }[];
}

export interface ReidPersonMatch {
  id: string;
  label?: string | null;
  displayName: string;
  coverFilename: string | null;
  photoCount: number;
  matchScore: number;
  streamTracks: { streamId: string; trackId: number }[];
}

export interface ReidDetection {
  id: string;
  deviceId: string;
  cameraName: string;
  streamId?: string;
  trackId: number;
  timestamp: string;
  filename: string;
  clipId?: string | null;
  clipFilename?: string | null;
  clipOffsetMs?: number | null;
  bbox: string;
  className: string;
  identityId?: string | null;
  identity?: { id: string; label?: string | null; galleryCount?: number; centroidUpdatedAt?: string | null } | null;
}

export interface TimelineVideoPlayback {
  filename: string;
  offsetMs: number;
  cameraName: string;
  cropFilename: string;
}

export interface ReidRoute {
  id?: string;
  fromCamera: string;
  toCamera: string;
  fromStreamId?: string;
  toStreamId?: string;
  minTimeSeconds: number;
  maxTimeSeconds: number;
  topologyScore: number;
}

export type CropClipPlayback = {
  clipFilename?: string | null;
  clipOffsetMs?: number | null;
  cameraName: string;
  detectionId?: string;
};

export type TrackMatchRow = {
  id: string;
  cameraName: string;
  timestamp: string;
  filename: string;
  clipFilename?: string;
  clipOffsetMs?: number;
  trackId?: number;
  identityId?: string | null;
  scores?: MatchScores;
  feedbackBoost?: number;
};

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  clips?: RagResponseClip[];
  reidDetections?: {
    id: string;
    cameraName: string;
    trackId: number;
    timestamp: string;
    filename: string;
    className: string;
    deviceId?: string | null;
  }[];
}

export interface ClipFilterParams {
  deviceId: string;
  streamId: string;
  startTime: string;
  endTime: string;
}

export interface LogEntry {
  message: string;
  timestamp: string;
}

export interface DeviceEvent {
  id: string;
  deviceId: string;
  streamId?: string | null;
  category: string;
  severity: string;
  eventType: string;
  message: string;
  detail?: Record<string, unknown> | null;
  createdAt: string;
}
