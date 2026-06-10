import prisma from './db';
import { resolveClipIdFromFilename } from './clipLink';

export interface ResolvedClipSource {
  clipFilename: string;
  clipOffsetMs: number;
}

export function parseClipStartMs(filename: string): number | null {
  const match = filename.match(/^clip_(\d+)_/);
  if (!match) return null;
  const ms = parseInt(match[1], 10);
  return Number.isFinite(ms) ? ms : null;
}

export function parseCropTimestampMs(filename: string): number | null {
  const match = filename.match(/^crop_(\d+)_/);
  if (!match) return null;
  const ms = parseInt(match[1], 10);
  return Number.isFinite(ms) ? ms : null;
}

function clipStartMs(clip: { filename: string; timestamp: Date }): number {
  return parseClipStartMs(clip.filename) ?? clip.timestamp.getTime();
}

export async function resolveClipForDetection(
  streamId: string | null | undefined,
  detectionTimestamp: Date,
  cropFilename?: string,
  deviceId?: string,
): Promise<ResolvedClipSource | null> {
  const detMs = parseCropTimestampMs(cropFilename ?? '') ?? detectionTimestamp.getTime();

  const streamIds = new Set<string>();
  if (streamId) streamIds.add(streamId);
  if (deviceId) streamIds.add(`${deviceId}_default`);

  if (streamIds.size === 0) return null;

  const clips = await prisma.videoClip.findMany({
    where: { streamId: { in: [...streamIds] } },
    orderBy: { timestamp: 'desc' },
    take: 80,
  });

  for (const clip of clips) {
    const startMs = clipStartMs(clip);
    const endMs = startMs + clip.duration * 1000;
    if (detMs >= startMs && detMs <= endMs) {
      return {
        clipFilename: clip.filename,
        clipOffsetMs: Math.max(0, detMs - startMs),
      };
    }
  }

  return null;
}

type DetectionClipFields = {
  id: string;
  streamId: string | null;
  deviceId: string;
  timestamp: Date;
  filename: string;
  clipId: string | null;
  clipFilename: string | null;
  clipOffsetMs: number | null;
};

export async function enrichDetectionWithClipSource<T extends DetectionClipFields>(
  detection: T,
  options?: { persist?: boolean },
): Promise<T> {
  if (detection.clipFilename) {
    const clipId = detection.clipId ?? await resolveClipIdFromFilename(detection.clipFilename);
    if (options?.persist && clipId && !detection.clipId) {
      await prisma.reidDetection.update({
        where: { id: detection.id },
        data: { clipId },
      });
    }
    return {
      ...detection,
      clipId,
      clipFilename: detection.clipFilename,
      clipOffsetMs: detection.clipOffsetMs ?? 0,
    };
  }

  const resolved = await resolveClipForDetection(
    detection.streamId,
    detection.timestamp,
    detection.filename,
    detection.deviceId,
  );
  if (!resolved) return detection;

  const resolvedClipId = await resolveClipIdFromFilename(resolved.clipFilename);

  if (options?.persist) {
    await prisma.reidDetection.update({
      where: { id: detection.id },
      data: {
        clipId: resolvedClipId,
        clipFilename: resolved.clipFilename,
        clipOffsetMs: resolved.clipOffsetMs,
      },
    });
  }

  return { ...detection, clipId: resolvedClipId, ...resolved };
}
