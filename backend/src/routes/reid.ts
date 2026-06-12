import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import prisma from '../services/db';
import reidWorker from '../services/reidWorker';
import { upsertReidVector, searchReidVectors, deleteReidVector, deleteReidVectors, updateReidPayloadBatch, updateReidPayload, retrieveReidVectors, retrieveIdentityPrototype, searchIdentityPrototypes } from '../services/qdrant';
import { recomputeIdentityCentroid, removeIdentityCentroid } from '../services/reidIdentity';
import {
  findSimilarPeople,
  listPeople,
  mergeStreamTracks,
  splitStreamTrackToNewIdentity,
  cleanupEmptyIdentities,
} from '../services/reidPeople';
import { fetchFileFromEdge } from '../services/edgeFileFetch';
import { rankCoverCandidates, resolveCropImageBuffer } from '../services/cropResolve';
import {
  autoLinkDetectionToIdentity,
  getStreamTrackKeysForIdentity,
  inheritIdentityLabel,
  registerStreamTrackMapping,
  removeStreamTrackMappingsForIdentity,
  resolveIdentityFromStreamTrack,
  streamTrackKey,
  syncStreamTrackMappingsForIdentity,
} from '../services/reidStreamTrack';
import { extractCropFromClip } from '../services/reidClipExtract';
import { enrichDetectionWithClipSource, resolveClipForDetection } from '../services/reidClipResolve';
import { resolveClipIdFromFilename } from '../services/clipLink';
import { getOrgOnlineDeviceIds, assertIdentityInOrg, getDeviceOrgId } from '../services/orgScope';

const router = Router();
export const CROPS_DIR = path.join(__dirname, '../../storage/crops');

if (!fs.existsSync(CROPS_DIR)) {
  fs.mkdirSync(CROPS_DIR, { recursive: true });
}

export type ReidCropUploadedCallback = (detection: any) => void;
let onReidCropUploadedCallback: ReidCropUploadedCallback | null = null;

export function registerOnReidCropUploaded(cb: ReidCropUploadedCallback) {
  onReidCropUploadedCallback = cb;
}

export type ReidCropDeletedCallback = (deviceId: string, filename: string) => void;
let onReidCropDeletedCallback: ReidCropDeletedCallback | null = null;

export function registerOnReidCropDeleted(cb: ReidCropDeletedCallback) {
  onReidCropDeletedCallback = cb;
}

export interface ReidTrackEvent {
  trackId: number;
  bbox: string;
  offsetMs: number;
  confidence: number;
  className: string;
}

export interface ReidDetectionInput {
  deviceId: string;
  streamId: string;
  trackId: number;
  timestamp: Date;
  filename: string;
  bbox: string;
  className: string;
  clipFilename?: string;
  clipOffsetMs?: number;
}

export async function processReidDetectionFromCropFile(input: ReidDetectionInput): Promise<any> {
  const { deviceId, streamId, trackId, timestamp, filename, bbox, className, clipFilename, clipOffsetMs } = input;
  const filepath = path.join(CROPS_DIR, filename);

  const stream = await prisma.cameraStream.findUnique({ where: { streamId } });
  const cameraName = stream?.name ?? 'Unknown Camera';

  console.log(`[ReID Router] Running OSNet embedding extraction for ${filename}...`);
  const vector = await reidWorker.generateEmbedding(filepath);

  let resolvedClipFilename = clipFilename ?? null;
  let resolvedClipOffsetMs = clipOffsetMs ?? null;
  if (!resolvedClipFilename) {
    const resolved = await resolveClipForDetection(streamId, timestamp, filename, deviceId);
    if (resolved) {
      resolvedClipFilename = resolved.clipFilename;
      resolvedClipOffsetMs = resolved.clipOffsetMs;
    }
  }
  const resolvedClipId = await resolveClipIdFromFilename(resolvedClipFilename);

  const detection = await prisma.reidDetection.create({
    data: {
      deviceId,
      cameraName,
      streamId,
      trackId,
      timestamp,
      filename,
      bbox,
      className,
      clipId: resolvedClipId,
      clipFilename: resolvedClipFilename,
      clipOffsetMs: resolvedClipOffsetMs,
    },
  });

  await upsertReidVector(detection.id, vector, {
    deviceId,
    cameraName,
    streamId,
    trackId,
    timestamp: timestamp.toISOString(),
    filename,
    bbox,
    className,
  });

  await autoLinkDetectionToIdentity(detection.id, streamId, trackId);

  const fullDetection = await prisma.reidDetection.findUnique({
    where: { id: detection.id },
    include: { identity: { select: { id: true, label: true, galleryCount: true, centroidUpdatedAt: true } } },
  });

  if (onReidCropUploadedCallback && fullDetection) {
    onReidCropUploadedCallback(fullDetection);
  }

  return fullDetection;
}

export async function processReidTrackEventsFromClip(
  clipPath: string,
  deviceId: string,
  streamId: string,
  clipStartMs: number,
  clipFilename: string,
  trackEvents: ReidTrackEvent[],
  frameWidth?: number,
  frameHeight?: number,
): Promise<{ succeeded: number; failures: { trackId: number; error: string }[] }> {
  if (!trackEvents.length) return { succeeded: 0, failures: [] };

  let succeeded = 0;
  const failures: { trackId: number; error: string }[] = [];
  for (const event of trackEvents) {
    const timestamp = new Date(clipStartMs + event.offsetMs);
    const filename = `crop_${timestamp.getTime()}_${deviceId}_${event.trackId}.jpg`;
    const cropPath = path.join(CROPS_DIR, filename);

    try {
      await extractCropFromClip(
        clipPath,
        event.offsetMs,
        event.bbox,
        cropPath,
        frameWidth,
        frameHeight,
      );
      await processReidDetectionFromCropFile({
        deviceId,
        streamId,
        trackId: event.trackId,
        timestamp,
        filename,
        bbox: event.bbox,
        className: event.className || 'person',
        clipFilename,
        clipOffsetMs: event.offsetMs,
      });
      succeeded++;
      console.log(
        `[ReID Router] Extracted ReID crop from clip for device ${deviceId}, track ${event.trackId} @ ${event.offsetMs}ms`,
      );
    } catch (err: any) {
      failures.push({ trackId: event.trackId, error: err.message });
      console.error(
        `[ReID Router] Failed to extract ReID from clip for track ${event.trackId} @ ${event.offsetMs}ms:`,
        err.message,
      );
    }
  }

  return { succeeded, failures };
}

/**
 * POST /api/reid/devices/:deviceId/crop
 * Edge device uploads a cropped person JPEG frame
 */
export async function handleCropUpload(req: Request, res: Response) {
  const { deviceId } = req.params;
  const streamId = req.headers['x-stream-id'] as string || `${deviceId}_default`;
  const trackId = parseInt(req.headers['x-track-id'] as string || '0', 10);
  const confidence = parseFloat(req.headers['x-confidence'] as string || '0');
  const bbox = req.headers['x-bbox'] as string || '0,0,0,0';
  const timestampHeader = req.headers['x-timestamp'] as string;
  const timestamp = timestampHeader ? new Date(parseInt(timestampHeader, 10)) : new Date();
  const className = req.headers['x-class-name'] as string || 'person';

  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    try {
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) {
        return res.status(400).json({ error: 'Empty crop image buffer' });
      }

      const filename = `crop_${timestamp.getTime()}_${deviceId}_${trackId}.jpg`;
      const filepath = path.join(CROPS_DIR, filename);

      fs.writeFileSync(filepath, buffer);
      console.log(`[ReID Router] Saved crop file to ${filepath}`);

      const fullDetection = await processReidDetectionFromCropFile({
        deviceId,
        streamId,
        trackId,
        timestamp,
        filename,
        bbox,
        className,
      });

      console.log(`[ReID Router] Successfully processed ReID crop for device ${deviceId}, track ${trackId}`);
      res.status(200).json({ success: true, detectionId: fullDetection?.id });
    } catch (err: any) {
      console.error('[ReID Router Error] Failed to process crop upload:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

router.post('/devices/:deviceId/crop', handleCropUpload);

/**
 * GET /api/reid/detections
 * List recent ReID detections
 */
router.get('/detections', async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string || '50', 10);
  try {
    const onlineDeviceIds = await getOrgOnlineDeviceIds(req.auth!.orgId);
    const detections = await prisma.reidDetection.findMany({
      where: { deviceId: { in: onlineDeviceIds } },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: { identity: { select: { id: true, label: true, galleryCount: true, centroidUpdatedAt: true } } },
    });
    res.json(detections);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reid/identities/:id/cover
 * Best available cover image for a person, trying multiple detections if needed.
 */
router.get('/identities/:id/cover', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const detections = await prisma.reidDetection.findMany({
      where: { identityId: id },
      orderBy: { timestamp: 'desc' },
      take: 20,
    });

    if (detections.length === 0) {
      return res.status(404).json({ error: 'No detections for identity' });
    }

    for (const detection of rankCoverCandidates(detections)) {
      const buffer = await resolveCropImageBuffer(detection, fetchFileFromEdge);
      if (buffer) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.send(buffer);
      }
    }

    return res.status(404).json({ error: 'No cover image available' });
  } catch (err: any) {
    console.error(`[ReID] Error resolving cover for identity ${id}:`, err);
    const status = err.message?.includes('offline') ? 503 : 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/reid/people
 * Google Photos-style person list with cover image and counts
 */
router.get('/people', async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string || '50', 10);
  try {
    await cleanupEmptyIdentities();
    const onlineDeviceIds = await getOrgOnlineDeviceIds(req.auth!.orgId);
    const people = await listPeople(limit, onlineDeviceIds, req.auth!.orgId);
    res.json(people);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reid/identities/:id/matches
 * Suggested people that may be the same person (identity-level matching)
 */
router.get('/identities/:id/matches', async (req: Request, res: Response) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit as string || '8', 10);
  try {
    const onlineDeviceIds = await getOrgOnlineDeviceIds(req.auth!.orgId);
    const matches = await findSimilarPeople(id, limit, onlineDeviceIds);
    res.json(matches);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/reid/feedback/stream-track
 * Feedback that two camera+track groups are same or different person
 */
router.post('/feedback/stream-track', async (req: Request, res: Response) => {
  const {
    type,
    sourceStreamId,
    sourceTrackId,
    targetStreamId,
    targetTrackId,
  } = req.body;

  if (!type || !sourceStreamId || sourceTrackId === undefined || !targetStreamId || targetTrackId === undefined) {
    return res.status(400).json({
      error: 'type, sourceStreamId, sourceTrackId, targetStreamId, and targetTrackId are required',
    });
  }
  if (!['same_person', 'different_person'].includes(type)) {
    return res.status(400).json({ error: 'type must be same_person or different_person' });
  }

  const srcTrack = parseInt(String(sourceTrackId), 10);
  const tgtTrack = parseInt(String(targetTrackId), 10);

  if (sourceStreamId === targetStreamId && srcTrack === tgtTrack) {
    return res.status(400).json({ error: 'Source and target stream+track must differ' });
  }

  try {
    const [sourceDetection, targetDetection] = await Promise.all([
      prisma.reidDetection.findFirst({
        where: { streamId: sourceStreamId, trackId: srcTrack },
        orderBy: { timestamp: 'desc' },
      }),
      prisma.reidDetection.findFirst({
        where: { streamId: targetStreamId, trackId: tgtTrack },
        orderBy: { timestamp: 'desc' },
      }),
    ]);

    if (!sourceDetection || !targetDetection) {
      return res.status(404).json({ error: 'Could not resolve detections for one or both stream tracks' });
    }

    await prisma.reidFeedback.create({
      data: {
        type,
        sourceDetectionId: sourceDetection.id,
        targetDetectionId: targetDetection.id,
      },
    });

    let resultIdentityId: string | null = null;
    if (type === 'same_person') {
      resultIdentityId = await mergeStreamTracks(
        sourceStreamId, srcTrack, targetStreamId, tgtTrack,
      );
    } else {
      const sourceMapping = await prisma.reidStreamTrackMapping.findUnique({
        where: { streamId_trackId: { streamId: sourceStreamId, trackId: srcTrack } },
      });
      const targetMapping = await prisma.reidStreamTrackMapping.findUnique({
        where: { streamId_trackId: { streamId: targetStreamId, trackId: tgtTrack } },
      });
      if (sourceMapping && targetMapping && sourceMapping.identityId === targetMapping.identityId) {
        resultIdentityId = await splitStreamTrackToNewIdentity(targetStreamId, tgtTrack);
      } else {
        resultIdentityId = targetMapping?.identityId ?? sourceMapping?.identityId ?? null;
      }
    }

    await cleanupEmptyIdentities();

    res.json({ success: true, identityId: resultIdentityId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/reid/detections/:id
 * Delete a ReID detection
 */
router.delete('/detections/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const detection = await prisma.reidDetection.findUnique({ where: { id } });
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }

    const filepath = path.join(CROPS_DIR, detection.filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    await deleteReidVector(id);
    await prisma.reidDetection.delete({ where: { id } });

    const identityId = detection.identityId;
    if (identityId) {
      const remaining = await prisma.reidDetection.count({ where: { identityId } });
      if (remaining === 0) {
        await removeIdentityCentroid(identityId);
        await removeStreamTrackMappingsForIdentity(identityId);
        await prisma.reidIdentity.delete({ where: { id: identityId } }).catch(() => {});
      } else {
        await recomputeIdentityCentroid(identityId);
        await syncStreamTrackMappingsForIdentity(identityId);
      }
    }

    if (onReidCropDeletedCallback) {
      onReidCropDeletedCallback(detection.deviceId, detection.filename);
    }

    res.json({ success: true, message: 'Detection deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/reid/detections/:id/assign-identity
 * Link a detection to an existing ReidIdentity
 */
router.post('/detections/:id/assign-identity', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { identityId } = req.body;

  if (!identityId || typeof identityId !== 'string') {
    return res.status(400).json({ error: 'identityId is required' });
  }

  try {
    const detection = await prisma.reidDetection.findUnique({ where: { id } });
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }

    const identity = await prisma.reidIdentity.findUnique({ where: { id: identityId } });
    if (!identity) {
      return res.status(404).json({ error: 'Identity not found' });
    }

    const resultIdentityId = await assignDetectionsToIdentity([id], identityId);
    if (detection.streamId) {
      await registerStreamTrackMapping(detection.streamId, detection.trackId, identityId);
    }
    await cleanupEmptyIdentities();

    const updated = await prisma.reidDetection.findUnique({
      where: { id },
      include: { identity: { select: { id: true, label: true, galleryCount: true, centroidUpdatedAt: true } } },
    });

    res.json({ success: true, identityId: resultIdentityId, detection: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/reid/detections/:id/label
 * Assign or update a label for a crop (creates identity + camera track mapping if needed)
 */
router.patch('/detections/:id/label', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { label } = req.body;

  if (typeof label !== 'string') {
    return res.status(400).json({ error: 'label must be a string' });
  }

  try {
    const detection = await prisma.reidDetection.findUnique({ where: { id } });
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }

    const trimmed = label.trim();
    let identityId = detection.identityId;

    if (!identityId) {
      const orgId = await getDeviceOrgId(detection.deviceId);
      const identity = await prisma.reidIdentity.create({
        data: { label: trimmed || null, ...(orgId ? { orgId } : {}) },
      });
      identityId = identity.id;
      await prisma.reidDetection.update({
        where: { id },
        data: { identityId },
      });
      await updateReidPayload(id, { identityId });
    } else {
      await prisma.reidIdentity.update({
        where: { id: identityId },
        data: { label: trimmed || null },
      });
    }

    if (detection.streamId) {
      await registerStreamTrackMapping(detection.streamId, detection.trackId, identityId);
    }
    await recomputeIdentityCentroid(identityId);

    const updated = await prisma.reidDetection.findUnique({
      where: { id },
      include: { identity: { select: { id: true, label: true, galleryCount: true, centroidUpdatedAt: true } } },
    });

    res.json({ success: true, detection: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reid/topology
 * List camera topology routes
 */
router.get('/topology', async (req: Request, res: Response) => {
  try {
    const routes = await prisma.topologyRoute.findMany({
      where: { orgId: req.auth!.orgId },
    });
    res.json(routes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/reid/topology
 * Create or update a topology route
 */
router.post('/topology', async (req: Request, res: Response) => {
  const { fromCamera, toCamera, fromStreamId, toStreamId, minTimeSeconds, maxTimeSeconds, topologyScore } = req.body;

  if (!fromCamera || !toCamera) {
    return res.status(400).json({ error: 'fromCamera and toCamera are required' });
  }

  try {
    // Check if route exists between these two cameras/streams (bi-directional check)
    const existing = await prisma.topologyRoute.findFirst({
      where: {
        orgId: req.auth!.orgId,
        OR: [
          { fromCamera, toCamera },
          { fromCamera: toCamera, toCamera: fromCamera },
          ...(fromStreamId && toStreamId ? [
            { fromStreamId, toStreamId },
            { fromStreamId: toStreamId, toStreamId: fromStreamId }
          ] : [])
        ]
      }
    });

    let route;
    if (existing) {
      route = await prisma.topologyRoute.update({
        where: { id: existing.id },
        data: {
          fromCamera,
          toCamera,
          fromStreamId: fromStreamId || null,
          toStreamId: toStreamId || null,
          minTimeSeconds: parseFloat(minTimeSeconds),
          maxTimeSeconds: parseFloat(maxTimeSeconds),
          topologyScore: parseFloat(topologyScore || '1.0'),
        }
      });
    } else {
      route = await prisma.topologyRoute.create({
        data: {
          fromCamera,
          toCamera,
          fromStreamId: fromStreamId || null,
          toStreamId: toStreamId || null,
          minTimeSeconds: parseFloat(minTimeSeconds),
          maxTimeSeconds: parseFloat(maxTimeSeconds),
          topologyScore: parseFloat(topologyScore || '1.0'),
          orgId: req.auth!.orgId,
        }
      });
    }

    res.json(route);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const FEEDBACK_TYPES = ['confirm', 'reject', 'same_person', 'different_person'] as const;
type FeedbackType = typeof FEEDBACK_TYPES[number];

async function assignDetectionsToIdentity(detectionIds: string[], identityId?: string) {
  const uniqueIds = [...new Set(detectionIds)];
  if (uniqueIds.length === 0) return null;

  const detections = await prisma.reidDetection.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, identityId: true },
  });

  if (detections.length !== uniqueIds.length) {
    throw new Error('One or more detections not found');
  }

  const existingIdentityIds = [...new Set(
    detections.map(d => d.identityId).filter((id): id is string => !!id)
  )];

  let targetIdentityId = identityId;
  const mergedAwayIds: string[] = [];
  if (!targetIdentityId) {
    if (existingIdentityIds.length === 0) {
      const firstDet = await prisma.reidDetection.findFirst({
        where: { id: uniqueIds[0] },
        select: { deviceId: true },
      });
      const orgId = firstDet ? await getDeviceOrgId(firstDet.deviceId) : null;
      const identity = await prisma.reidIdentity.create({
        data: orgId ? { orgId } : {},
      });
      targetIdentityId = identity.id;
    } else {
      targetIdentityId = existingIdentityIds[0];
      const mergeIds = existingIdentityIds.slice(1);
      for (const mergeId of mergeIds) {
        mergedAwayIds.push(mergeId);
        const mergedDetections = await prisma.reidDetection.findMany({
          where: { identityId: mergeId },
          select: { id: true },
        });
        const mergedDetectionIds = mergedDetections.map(d => d.id);
        await prisma.reidDetection.updateMany({
          where: { identityId: mergeId },
          data: { identityId: targetIdentityId },
        });
        await updateReidPayloadBatch(mergedDetectionIds, { identityId: targetIdentityId });
        await prisma.reidIdentity.delete({ where: { id: mergeId } });
      }
    }
  }

  await prisma.reidDetection.updateMany({
    where: { id: { in: uniqueIds } },
    data: { identityId: targetIdentityId },
  });
  await updateReidPayloadBatch(uniqueIds, { identityId: targetIdentityId });

  for (const mergedId of mergedAwayIds) {
    await removeIdentityCentroid(mergedId);
    await removeStreamTrackMappingsForIdentity(mergedId);
  }
  if (targetIdentityId) {
    await inheritIdentityLabel(targetIdentityId, existingIdentityIds);
    await syncStreamTrackMappingsForIdentity(targetIdentityId);
    await recomputeIdentityCentroid(targetIdentityId);
  }

  return targetIdentityId;
}

function mergeReidCandidates(
  ...candidateLists: Awaited<ReturnType<typeof searchReidVectors>>[]
) {
  const candidateMap = new Map<string, Awaited<ReturnType<typeof searchReidVectors>>[number]>();
  for (const list of candidateLists) {
    for (const cand of list) {
      const mongoId = (cand.payload as { mongoId?: string })?.mongoId;
      if (!mongoId) continue;
      const existing = candidateMap.get(mongoId);
      if (!existing || cand.score > existing.score) {
        candidateMap.set(mongoId, cand);
      }
    }
  }
  return [...candidateMap.values()];
}

/**
 * POST /api/reid/feedback
 * Submit user feedback on a match or pair of detections
 */
router.post('/feedback', async (req: Request, res: Response) => {
  const { type, sourceDetectionId, targetDetectionId } = req.body;

  if (!type || !sourceDetectionId || !targetDetectionId) {
    return res.status(400).json({ error: 'type, sourceDetectionId, and targetDetectionId are required' });
  }
  if (!FEEDBACK_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${FEEDBACK_TYPES.join(', ')}` });
  }
  if (sourceDetectionId === targetDetectionId) {
    return res.status(400).json({ error: 'sourceDetectionId and targetDetectionId must differ' });
  }

  try {
    const [source, target] = await Promise.all([
      prisma.reidDetection.findUnique({ where: { id: sourceDetectionId } }),
      prisma.reidDetection.findUnique({ where: { id: targetDetectionId } }),
    ]);
    if (!source || !target) {
      return res.status(404).json({ error: 'One or both detections not found' });
    }

    const feedback = await prisma.reidFeedback.create({
      data: { type, sourceDetectionId, targetDetectionId },
    });

    let identityId: string | null = null;
    if (type === 'confirm' || type === 'same_person') {
      identityId = await assignDetectionsToIdentity([sourceDetectionId, targetDetectionId]);
    }

    res.json({ success: true, feedback, identityId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/reid/identities/merge
 * Merge multiple detections into a single identity
 */
router.post('/identities/merge', async (req: Request, res: Response) => {
  const { detectionIds, label } = req.body;

  if (!Array.isArray(detectionIds) || detectionIds.length < 2) {
    return res.status(400).json({ error: 'detectionIds must be an array of at least 2 detection IDs' });
  }

  try {
    const identityId = await assignDetectionsToIdentity(detectionIds);

    if (label !== undefined && identityId) {
      const trimmed = typeof label === 'string' ? label.trim() : '';
      await prisma.reidIdentity.update({
        where: { id: identityId },
        data: { label: trimmed || null },
      });
    }

    const detections = await prisma.reidDetection.findMany({
      where: { identityId: identityId! },
      orderBy: { timestamp: 'asc' },
      include: { identity: { select: { id: true, label: true, galleryCount: true, centroidUpdatedAt: true } } },
    });

    res.json({ success: true, identityId, detections });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/reid/identities/:id
 * Delete an identity and all of its detections, crops, and vectors
 */
router.delete('/identities/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const identity = await prisma.reidIdentity.findUnique({ where: { id } });
    if (!identity) {
      return res.status(404).json({ error: 'Identity not found' });
    }

    const detections = await prisma.reidDetection.findMany({
      where: { identityId: id },
      select: { id: true, filename: true, deviceId: true },
    });

    for (const detection of detections) {
      const filepath = path.join(CROPS_DIR, detection.filename);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      if (onReidCropDeletedCallback) {
        onReidCropDeletedCallback(detection.deviceId, detection.filename);
      }
    }

    await deleteReidVectors(detections.map((d) => d.id));
    await prisma.reidDetection.deleteMany({ where: { identityId: id } });
    await removeStreamTrackMappingsForIdentity(id);
    await removeIdentityCentroid(id);
    await prisma.reidIdentity.delete({ where: { id } });

    res.json({ success: true, deletedDetections: detections.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/reid/identities/:id
 * Set or clear a label on an identity
 */
router.patch('/identities/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { label } = req.body;

  if (label !== undefined && typeof label !== 'string') {
    return res.status(400).json({ error: 'label must be a string' });
  }

  try {
    const existing = await prisma.reidIdentity.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Identity not found' });
    }

    const trimmed = typeof label === 'string' ? label.trim() : '';
    const identity = await prisma.reidIdentity.update({
      where: { id },
      data: { label: trimmed || null },
    });

    res.json({ success: true, identity });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reid/detections/:id/source-clip
 * Resolve and return the video clip for a detection (lazy lookup + backfill)
 */
router.get('/detections/:id/source-clip', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const detection = await prisma.reidDetection.findUnique({ where: { id } });
    if (!detection) {
      return res.status(404).json({ error: 'Detection not found' });
    }

    const enriched = await enrichDetectionWithClipSource(detection, { persist: true });
    if (!enriched.clipFilename) {
      return res.status(404).json({ error: 'No matching video clip for this detection' });
    }

    res.json({
      clipFilename: enriched.clipFilename,
      clipOffsetMs: enriched.clipOffsetMs ?? 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reid/identities/:id/journey
 * List all detections linked to an identity
 */
router.get('/identities/:id/journey', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const identity = await prisma.reidIdentity.findUnique({ where: { id } });
    if (!identity) {
      return res.status(404).json({ error: 'Identity not found' });
    }

    const onlineDeviceIds = await getOrgOnlineDeviceIds(req.auth!.orgId);
    const detections = await prisma.reidDetection.findMany({
      where: { identityId: id, deviceId: { in: onlineDeviceIds } },
      orderBy: { timestamp: 'asc' },
      include: { identity: { select: { id: true, label: true, galleryCount: true, centroidUpdatedAt: true } } },
    });

    const enrichedDetections = await Promise.all(
      detections.map((detection) => enrichDetectionWithClipSource(detection, { persist: true })),
    );

    res.json({ identity, detections: enrichedDetections });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/reid/track
 * Track a person across cameras using a source detection ID
 */
router.post('/track', async (req: Request, res: Response) => {
  const { detectionId, limit = 20 } = req.body;

  if (!detectionId) {
    return res.status(400).json({ error: 'detectionId is required' });
  }

  try {
    const queryDetection = await prisma.reidDetection.findUnique({
      where: { id: detectionId },
      include: { identity: { select: { id: true, label: true, galleryCount: true, centroidUpdatedAt: true } } },
    });
    if (!queryDetection) {
      return res.status(404).json({ error: `Detection ${detectionId} not found in database.` });
    }

    const queryVectors = await retrieveReidVectors([detectionId]);
    if (queryVectors.length === 0) {
      return res.status(404).json({ error: `Vector embedding not found in Qdrant for detection ${detectionId}.` });
    }

    const cropVector = queryVectors[0].vector;
    const searchLimit = limit + 10;

    const cropCandidates = await searchReidVectors(cropVector, searchLimit);

    let centroidCandidates: Awaited<ReturnType<typeof searchReidVectors>> = [];
    if (queryDetection.identityId) {
      let prototype = await retrieveIdentityPrototype(queryDetection.identityId);
      if (!prototype) {
        await recomputeIdentityCentroid(queryDetection.identityId);
        prototype = await retrieveIdentityPrototype(queryDetection.identityId);
      }
      if (prototype) {
        centroidCandidates = await searchReidVectors(prototype.vector, searchLimit);
      }
    }

    const candidates = mergeReidCandidates(cropCandidates, centroidCandidates);

    const similarIdentities = await searchIdentityPrototypes(cropVector, 5);
    const similarIdentityScores = new Map<string, number>();
    for (const hit of similarIdentities) {
      const identityId = (hit.payload as { identityId?: string })?.identityId;
      if (identityId && identityId !== queryDetection.identityId) {
        similarIdentityScores.set(identityId, hit.score);
      }
    }

    let mappedTrackKeys = new Set<string>();
    const queryIdentityId = queryDetection.identityId
      || (queryDetection.streamId
        ? await resolveIdentityFromStreamTrack(queryDetection.streamId, queryDetection.trackId)
        : null);
    if (queryIdentityId) {
      mappedTrackKeys = await getStreamTrackKeysForIdentity(queryIdentityId);
    }

    const topologyRoutes = await prisma.topologyRoute.findMany();

    // Load feedback involving the query detection
    const feedbackEntries = await prisma.reidFeedback.findMany({
      where: {
        OR: [
          { sourceDetectionId: detectionId },
          { targetDetectionId: detectionId },
        ],
      },
    });

    const rejectedIds = new Set<string>();
    const confirmedIds = new Set<string>();
    for (const fb of feedbackEntries) {
      const otherId = fb.sourceDetectionId === detectionId ? fb.targetDetectionId : fb.sourceDetectionId;
      if (fb.type === 'reject' || fb.type === 'different_person') {
        rejectedIds.add(otherId);
      } else if (fb.type === 'confirm' || fb.type === 'same_person') {
        confirmedIds.add(otherId);
      }
    }

    const tq = new Date(queryDetection.timestamp).getTime();
    const Cq = queryDetection.cameraName;
    const Sq = queryDetection.streamId;

    const scoredMatches = [];

    for (const cand of candidates) {
      const payload = cand.payload as any;
      if (!payload || payload.mongoId === detectionId) {
        continue;
      }

      if (rejectedIds.has(payload.mongoId)) {
        continue;
      }

      const tc = new Date(payload.timestamp).getTime();
      const Cc = payload.cameraName;
      const Sc = payload.streamId;
      const deltaTime = Math.abs(tq - tc) / 1000;

      let timeScore = 0.5;
      let topologyScore = 0.5;
      let isValidTransition = true;

      const route = topologyRoutes.find(r => 
        (Sq && Sc && ((r.fromStreamId === Sq && r.toStreamId === Sc) || (r.fromStreamId === Sc && r.toStreamId === Sq))) ||
        (r.fromCamera === Cq && r.toCamera === Cc) || 
        (r.fromCamera === Cc && r.toCamera === Cq)
      );

      if (route) {
        topologyScore = route.topologyScore;

        if (deltaTime < route.minTimeSeconds) {
          timeScore = 0.0;
          isValidTransition = false;
        } else if (deltaTime >= route.minTimeSeconds && deltaTime <= route.maxTimeSeconds) {
          const span = route.maxTimeSeconds - route.minTimeSeconds;
          timeScore = span > 0 
            ? 1.0 - 0.8 * ((deltaTime - route.minTimeSeconds) / span)
            : 1.0;
        } else {
          timeScore = 0.2 * Math.exp(-(deltaTime - route.maxTimeSeconds) / 600);
        }
      } else {
        const isSameCamera = Sq && Sc ? Sq === Sc : Cq === Cc;
        if (isSameCamera) {
          topologyScore = 0.8;
          timeScore = Math.exp(-deltaTime / 300);
        } else {
          topologyScore = 0.2;
          if (deltaTime < 10) {
            timeScore = 0.1;
          } else {
            timeScore = Math.exp(-(deltaTime - 10) / 600);
          }
        }
      }

      const vectorSimilarity = cand.score;
      let feedbackBoost = 0;
      if (queryDetection.identityId && payload.identityId === queryDetection.identityId) {
        feedbackBoost += 0.3;
      }
      if (confirmedIds.has(payload.mongoId)) {
        feedbackBoost += 0.15;
      }
      if (payload.streamId && mappedTrackKeys.has(streamTrackKey(payload.streamId, payload.trackId))) {
        feedbackBoost += 0.25;
      }
      if (payload.identityId && similarIdentityScores.has(payload.identityId)) {
        feedbackBoost += 0.1 * (similarIdentityScores.get(payload.identityId) || 0);
      }

      const finalScore = Math.min(1.0, (0.6 * vectorSimilarity) + (0.2 * timeScore) + (0.2 * topologyScore) + feedbackBoost);

      if (isValidTransition && finalScore >= 0.3) {
        scoredMatches.push({
          id: payload.mongoId,
          deviceId: payload.deviceId,
          cameraName: payload.cameraName,
          streamId: payload.streamId,
          trackId: payload.trackId,
          timestamp: payload.timestamp,
          filename: payload.filename,
          bbox: payload.bbox,
          className: payload.className,
          identityId: payload.identityId || null,
          feedbackBoost: feedbackBoost > 0 ? feedbackBoost : undefined,
          scores: {
            vectorSimilarity,
            timeScore,
            topologyScore,
            finalScore,
          }
        });
      }
    }

    scoredMatches.sort((a, b) => b.scores.finalScore - a.scores.finalScore);
    const topMatches = scoredMatches.slice(0, limit);

    const matchIds = topMatches.map((m) => m.id);
    const matchDetections = matchIds.length > 0
      ? await prisma.reidDetection.findMany({
          where: { id: { in: matchIds } },
          select: { id: true, clipId: true, clipFilename: true, clipOffsetMs: true },
        })
      : [];
    const clipFieldsById = new Map(matchDetections.map((d) => [d.id, d]));

    const enrichedMatches = await Promise.all(topMatches.map(async (match) => {
      const stored = clipFieldsById.get(match.id);
      if (stored?.clipFilename) {
        return {
          ...match,
          clipFilename: stored.clipFilename,
          clipOffsetMs: stored.clipOffsetMs ?? 0,
          clipId: stored.clipId,
        };
      }
      const detection = await prisma.reidDetection.findUnique({ where: { id: match.id } });
      if (!detection) return match;
      const enriched = await enrichDetectionWithClipSource(detection, { persist: true });
      return {
        ...match,
        clipFilename: enriched.clipFilename,
        clipOffsetMs: enriched.clipOffsetMs ?? 0,
        clipId: enriched.clipId,
      };
    }));

    const enrichedQuery = await enrichDetectionWithClipSource(queryDetection, { persist: true });

    res.json({
      query: enrichedQuery,
      matches: enrichedMatches,
    });

  } catch (err: any) {
    console.error('[ReID Match Error]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
