import prisma from './db';

export interface ResolvedClipSource {
  clipFilename: string;
  clipOffsetMs: number;
}

export async function resolveClipForDetection(
  streamId: string | null | undefined,
  detectionTimestamp: Date,
): Promise<ResolvedClipSource | null> {
  if (!streamId) return null;

  const detMs = detectionTimestamp.getTime();
  const windowStart = new Date(detMs - 120_000);
  const windowEnd = new Date(detMs + 5_000);

  const clips = await prisma.videoClip.findMany({
    where: {
      streamId,
      timestamp: { gte: windowStart, lte: windowEnd },
    },
    orderBy: { timestamp: 'desc' },
  });

  for (const clip of clips) {
    const startMs = clip.timestamp.getTime();
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

export async function enrichDetectionWithClipSource<T extends {
  streamId: string | null;
  timestamp: Date;
  clipFilename: string | null;
  clipOffsetMs: number | null;
}>(detection: T): Promise<T & ResolvedClipSource | T> {
  if (detection.clipFilename) {
    return {
      ...detection,
      clipFilename: detection.clipFilename,
      clipOffsetMs: detection.clipOffsetMs ?? 0,
    };
  }

  const resolved = await resolveClipForDetection(detection.streamId, detection.timestamp);
  if (!resolved) return detection;

  return { ...detection, ...resolved };
}
