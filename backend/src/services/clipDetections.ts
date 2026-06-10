import prisma from './db';
import { retrieveReidVectors, searchIdentityPrototypes } from './qdrant';
import { defaultPersonLabel } from './reidPeople';
import type { ReidTrackEvent } from '../routes/reid';

export interface ClipDetectedObjectInput {
  trackId: number;
  className: string;
  confidence: number;
}

export interface ClipObjectDisplay {
  trackId: number;
  className: string;
  confidence?: number;
  labelStatus: 'confirmed' | 'suggested' | 'none';
  label?: string;
  matchScore?: number;
}

export function aggregateTrackEvents(trackEvents: ReidTrackEvent[]): ClipDetectedObjectInput[] {
  const byTrack = new Map<number, ClipDetectedObjectInput>();

  for (const event of trackEvents) {
    const existing = byTrack.get(event.trackId);
    if (!existing || event.confidence > existing.confidence) {
      byTrack.set(event.trackId, {
        trackId: event.trackId,
        className: event.className || 'person',
        confidence: event.confidence,
      });
    }
  }

  return [...byTrack.values()].sort((a, b) => a.trackId - b.trackId);
}

async function resolveIdentityLabel(
  detectionId: string | undefined,
  identityId: string | null | undefined,
  cameraName: string,
  trackId: number,
): Promise<Pick<ClipObjectDisplay, 'labelStatus' | 'label' | 'matchScore'>> {
  if (identityId) {
    const identity = await prisma.reidIdentity.findUnique({
      where: { id: identityId },
      select: { label: true },
    });
    const trimmed = identity?.label?.trim();
    if (trimmed) {
      return { labelStatus: 'confirmed', label: trimmed };
    }
  }

  if (!detectionId) {
    return { labelStatus: 'none' };
  }

  const vectors = await retrieveReidVectors([detectionId]);
  if (vectors.length === 0) {
    return { labelStatus: 'none' };
  }

  const hits = await searchIdentityPrototypes(vectors[0].vector, 5);
  for (const hit of hits) {
    const hitIdentityId = (hit.payload as { identityId?: string })?.identityId;
    if (!hitIdentityId || hitIdentityId === identityId) continue;

    const hitIdentity = await prisma.reidIdentity.findUnique({
      where: { id: hitIdentityId },
      include: {
        detections: { orderBy: { timestamp: 'desc' }, take: 1, select: { cameraName: true, trackId: true } },
      },
    });
    if (!hitIdentity || hitIdentity.detections.length === 0) continue;

    const cover = hitIdentity.detections[0];
    const displayName = hitIdentity.label?.trim()
      || defaultPersonLabel(cover.cameraName, cover.trackId);

    return {
      labelStatus: 'suggested',
      label: displayName,
      matchScore: hit.score,
    };
  }

  return { labelStatus: 'none' };
}

export async function getClipObjectDetections(clipId: string): Promise<ClipObjectDisplay[]> {
  const clip = await prisma.videoClip.findUnique({ where: { id: clipId } });
  if (!clip) return [];

  const storedObjects = Array.isArray(clip.detectedObjects)
    ? (clip.detectedObjects as unknown as ClipDetectedObjectInput[])
    : [];

  const reidDetections = await prisma.reidDetection.findMany({
    where: { clipFilename: clip.filename },
    orderBy: { timestamp: 'asc' },
    include: { identity: { select: { id: true, label: true } } },
  });

  const reidByTrack = new Map<number, typeof reidDetections[number]>();
  for (const detection of reidDetections) {
    if (!reidByTrack.has(detection.trackId)) {
      reidByTrack.set(detection.trackId, detection);
    }
  }

  const objectSeeds: ClipDetectedObjectInput[] = storedObjects.length > 0
    ? storedObjects
    : [...reidByTrack.values()].map((detection) => ({
        trackId: detection.trackId,
        className: detection.className,
        confidence: 0,
      }));

  const results: ClipObjectDisplay[] = [];

  for (const object of objectSeeds) {
    const detection = reidByTrack.get(object.trackId);
    const identityInfo = object.className === 'person' && detection
      ? await resolveIdentityLabel(detection.id, detection.identityId, clip.camera, object.trackId)
      : { labelStatus: 'none' as const };

    results.push({
      trackId: object.trackId,
      className: object.className,
      confidence: object.confidence > 0 ? object.confidence : undefined,
      ...identityInfo,
    });
  }

  return results;
}
