import prisma from './db';
import { retrieveReidVectors, searchIdentityPrototypes } from './qdrant';
import { defaultPersonLabel } from './reidPeople';
import { cropExistsLocally } from './cropResolve';
import { extractCropFromClip } from './reidClipExtract';
import { CROPS_DIR } from '../routes/reid';
import * as fs from 'fs';
import * as path from 'path';
import type { ReidTrackEvent } from '../routes/reid';
import type { TrackAppearance } from './cropAppearance';
import { buildAppearanceMap } from './yoloSummary';
import { isVehicleClass } from './yoloSummary';

export interface ClipDetectedObjectInput {
  trackId: number;
  className: string;
  confidence: number;
  heightRatio?: number;
  upperColor?: string;
  lowerColor?: string;
  vehicleColor?: string;
  cropFilename?: string;
  clipOffsetMs?: number;
  bbox?: string;
}

export interface ClipObjectDisplay {
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
  clipOffsetMs?: number;
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
  objects: ClipObjectDisplay[];
  reidLog: ClipReidLog;
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

export function enrichDetectedObjects(
  objects: ClipDetectedObjectInput[],
  trackEvents: ReidTrackEvent[],
  analyzedAppearances?: Map<number, TrackAppearance>,
): ClipDetectedObjectInput[] {
  const appearanceByTrack = buildAppearanceMap(trackEvents, analyzedAppearances);

  return objects.map((object) => {
    const appearance = appearanceByTrack.get(object.trackId);
    if (!appearance) return object;

    return {
      ...object,
      heightRatio: appearance.heightRatio ?? object.heightRatio,
      upperColor: appearance.upperColor ?? object.upperColor,
      lowerColor: appearance.lowerColor ?? object.lowerColor,
      vehicleColor: appearance.vehicleColor ?? object.vehicleColor,
    };
  });
}

async function resolveIdentityLabel(
  detectionId: string | undefined,
  identityId: string | null | undefined,
  cameraName: string,
  trackId: number,
  orgId?: string,
): Promise<Pick<ClipObjectDisplay, 'labelStatus' | 'label' | 'matchScore'>> {
  if (identityId) {
    const identity = await prisma.reidIdentity.findFirst({
      where: { id: identityId, ...(orgId ? { orgId } : {}) },
      select: { label: true },
    });
    const trimmed = identity?.label?.trim();
    if (trimmed) {
      return { labelStatus: 'confirmed', label: trimmed };
    }
    // Linked to an identity the user has not named yet — treat as unassigned for display.
  }

  if (!detectionId) {
    return { labelStatus: 'none' };
  }

  const vectors = await retrieveReidVectors([detectionId]);
  if (vectors.length === 0) {
    return { labelStatus: 'none' };
  }

  const hits = await searchIdentityPrototypes(vectors[0].vector, 15);
  for (const hit of hits) {
    const hitIdentityId = (hit.payload as { identityId?: string })?.identityId;
    if (!hitIdentityId || hitIdentityId === identityId) continue;

    const hitIdentity = await prisma.reidIdentity.findFirst({
      where: { id: hitIdentityId, ...(orgId ? { orgId } : {}) },
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

type ReidDetectionRow = Awaited<ReturnType<typeof prisma.reidDetection.findMany>>[number];

function pickBestDetectionForTrack(
  detections: ReidDetectionRow[],
  clipId: string,
): ReidDetectionRow | undefined {
  if (detections.length === 0) return undefined;

  const linkedToClip = detections.filter(
    (d) => d.clipId === clipId && d.clipOffsetMs != null,
  );
  const candidates = linkedToClip.length > 0 ? linkedToClip : detections;

  for (const detection of [...candidates].reverse()) {
    if (cropExistsLocally(detection.filename)) return detection;
  }

  const withOffset = [...candidates].reverse().find((d) => d.clipOffsetMs != null);
  if (withOffset) return withOffset;

  return candidates[candidates.length - 1];
}

async function ensureYoloCropAvailable(
  clip: { filepath: string; filename: string; deviceId: string | null },
  object: ClipDetectedObjectInput,
): Promise<string | undefined> {
  if (!object.cropFilename || !object.bbox || object.clipOffsetMs == null) {
    return object.cropFilename;
  }
  if (cropExistsLocally(object.cropFilename)) {
    return object.cropFilename;
  }

  const clipPath = clip.filepath && fs.existsSync(clip.filepath)
    ? clip.filepath
    : null;
  if (!clipPath) {
    return object.cropFilename;
  }

  const cropPath = path.join(CROPS_DIR, object.cropFilename);
  try {
    await extractCropFromClip(clipPath, object.clipOffsetMs, object.bbox, cropPath);
    return object.cropFilename;
  } catch {
    return undefined;
  }
}

export async function getClipObjectDetections(clipId: string, orgId?: string): Promise<ClipObjectDisplay[]> {
  const clip = await prisma.videoClip.findUnique({ where: { id: clipId } });
  if (!clip) return [];

  const storedObjects = Array.isArray(clip.detectedObjects)
    ? (clip.detectedObjects as unknown as ClipDetectedObjectInput[])
    : [];

  const reidDetections = await prisma.reidDetection.findMany({
    where: {
      OR: [
        { clipId: clip.id },
        { clipFilename: clip.filename },
      ],
    },
    orderBy: { timestamp: 'asc' },
    include: { identity: { select: { id: true, label: true } } },
  });

  const reidByTrack = new Map<number, ReidDetectionRow[]>();
  for (const detection of reidDetections) {
    const list = reidByTrack.get(detection.trackId) ?? [];
    list.push(detection);
    reidByTrack.set(detection.trackId, list);
  }

  const objectSeeds: ClipDetectedObjectInput[] = storedObjects.length > 0
    ? storedObjects
    : [...reidByTrack.entries()].map(([trackId, detections]) => {
        const best = pickBestDetectionForTrack(detections, clip.id) ?? detections[0];
        return {
          trackId,
          className: best.className,
          confidence: 0,
        };
      });

  const results: ClipObjectDisplay[] = [];

  for (const object of objectSeeds) {
    const detection = pickBestDetectionForTrack(reidByTrack.get(object.trackId) ?? [], clip.id);
    const identityInfo = object.className === 'person' && detection
      ? await resolveIdentityLabel(detection.id, detection.identityId, clip.camera, object.trackId, orgId)
      : { labelStatus: 'none' as const };

    const yoloCropFilename = detection?.filename
      ? undefined
      : await ensureYoloCropAvailable(clip, object);
    const cropFilename = detection?.filename ?? yoloCropFilename ?? object.cropFilename;
    const clipOffsetMs = detection?.clipOffsetMs ?? object.clipOffsetMs;

    results.push({
      trackId: object.trackId,
      className: object.className,
      confidence: object.confidence > 0 ? object.confidence : undefined,
      heightRatio: object.heightRatio,
      upperColor: object.upperColor,
      lowerColor: object.lowerColor,
      vehicleColor: object.vehicleColor,
      detectionId: detection?.id,
      identityId: detection?.identityId ?? null,
      cropFilename,
      clipOffsetMs: clipOffsetMs ?? undefined,
      ...identityInfo,
    });
  }

  return results;
}

export async function buildClipReidLog(
  clipId: string,
  objects: ClipObjectDisplay[],
): Promise<ClipReidLog> {
  const clip = await prisma.videoClip.findUnique({ where: { id: clipId } });
  if (!clip) {
    return {
      trackEventsReceived: 0,
      entries: [{ level: 'error', message: 'Clip not found.' }],
    };
  }

  const storedLog = clip.reidLog as ClipReidLog | null;
  const entries: ClipReidLogEntry[] = storedLog?.entries?.length
    ? [...storedLog.entries]
    : [];

  const reidDetectionsLinked = await prisma.reidDetection.count({
    where: {
      OR: [{ clipId: clip.id }, { clipFilename: clip.filename }],
    },
  });

  const trackEventsReceived = Array.isArray(clip.detectedObjects)
    ? (clip.detectedObjects as unknown as ClipDetectedObjectInput[]).length
    : 0;

  if (!storedLog?.entries?.length) {
    const stream = clip.streamId
      ? await prisma.cameraStream.findUnique({ where: { streamId: clip.streamId } })
      : null;

    if (stream && !stream.trackingEnabled) {
      entries.push({
        level: 'info',
        message: 'Object tracking is disabled on this camera stream.',
      });
    }

    if (trackEventsReceived === 0 && reidDetectionsLinked === 0) {
      entries.push({
        level: 'info',
        message: 'No person tracks were recorded with this clip. Enable tracking and ensure a person is visible for at least ~1 second during recording.',
      });
    } else if (trackEventsReceived > 0) {
      entries.push({
        level: 'info',
        message: `${trackEventsReceived} object track(s) detected during recording.`,
      });
    }

    if (trackEventsReceived > 0 && reidDetectionsLinked === 0) {
      entries.push({
        level: 'warn',
        message: 'Tracks were detected but no ReID profiles were stored. Crop extraction may have failed during processing.',
      });
    } else if (reidDetectionsLinked > 0) {
      entries.push({
        level: 'info',
        message: `${reidDetectionsLinked} ReID detection(s) linked to this clip.`,
      });
    }
  }

  for (const obj of objects) {
    const isPerson = obj.className === 'person';
    const isVehicle = isVehicleClass(obj.className);

    if (!isPerson && !isVehicle) continue;

    if (!obj.detectionId) {
      entries.push({
        level: 'warn',
        message: `Track ${obj.trackId} (${obj.className}): detected during clip but no ReID profile was stored.`,
      });
      continue;
    }

    if (isVehicle) {
      entries.push({
        level: 'info',
        message: `Track ${obj.trackId} (${obj.className}): vehicle ReID detection stored.`,
      });
      if (obj.cropFilename && !cropExistsLocally(obj.cropFilename)) {
        entries.push({
          level: 'info',
          message: `Track ${obj.trackId}: crop image not cached — will be fetched from edge or regenerated from clip.`,
        });
      }
      continue;
    }

    if (obj.labelStatus === 'confirmed' && obj.label) {
      entries.push({
        level: 'info',
        message: `Track ${obj.trackId}: identified as "${obj.label}".`,
      });
    } else if (obj.labelStatus === 'suggested' && obj.label && obj.matchScore != null) {
      entries.push({
        level: 'info',
        message: `Track ${obj.trackId}: ${Math.round(obj.matchScore * 100)}% match with "${obj.label}" (suggested).`,
      });
    } else {
      entries.push({
        level: 'info',
        message: `Track ${obj.trackId}: detection stored — assign an identity manually to link appearances.`,
      });
    }

    if (obj.cropFilename && !cropExistsLocally(obj.cropFilename)) {
      entries.push({
        level: 'info',
        message: `Track ${obj.trackId}: crop image not cached — will be fetched from edge or regenerated from clip.`,
      });
    }
  }

  if (entries.length === 0) {
    entries.push({
      level: 'info',
      message: 'No ReID activity recorded for this clip.',
    });
  }

  return {
    trackEventsReceived: storedLog?.trackEventsReceived ?? trackEventsReceived,
    reidDetectionsLinked,
    cropsExtracted: storedLog?.cropsExtracted,
    trackingEnabled: storedLog?.trackingEnabled,
    entries,
  };
}

export async function getClipDetectionsResponse(clipId: string, orgId?: string): Promise<ClipDetectionsResponse> {
  const objects = await getClipObjectDetections(clipId, orgId);
  const reidLog = await buildClipReidLog(clipId, objects);
  return { objects, reidLog };
}
