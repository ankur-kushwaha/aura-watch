import type { ClipFilterParams, EdgeDevice, VideoClip } from '../types';

export function buildClipsQueryString(limit: number, offset: number, filters: ClipFilterParams) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (filters.deviceId) params.set('deviceId', filters.deviceId);
  if (filters.streamId) params.set('streamId', filters.streamId);
  if (filters.startTime) params.set('startTime', new Date(filters.startTime).toISOString());
  if (filters.endTime) params.set('endTime', new Date(filters.endTime).toISOString());
  return params.toString();
}

export function getClipDetectionCount(clip: VideoClip): number | null {
  if (Array.isArray(clip.detectedObjects) && clip.detectedObjects.length > 0) {
    return clip.detectedObjects.length;
  }
  const fromLog = clip.reidLog?.trackEventsReceived;
  if (typeof fromLog === 'number' && fromLog > 0) {
    return fromLog;
  }
  return null;
}

export function isEdgeUpdateAvailable(dev: EdgeDevice): boolean {
  return Boolean(
    dev.gitCommit && dev.remoteGitCommit && dev.gitCommit !== dev.remoteGitCommit,
  );
}
