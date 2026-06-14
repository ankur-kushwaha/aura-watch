import prisma from './db';
import {
  ReidFeedbackType,
  isSameFeedback,
} from '../constants/reidFeedback';
import {
  retrieveIdentityPrototype,
  retrieveReidVectors,
  searchIdentityPrototypes,
  searchReidVectors,
} from './qdrant';
import { recomputeIdentityCentroid } from './reidIdentity';
import {
  getStreamTrackKeysForIdentity,
  inheritIdentityLabel,
  registerStreamTrackMapping,
  removeStreamTrackMappingsForIdentity,
  streamTrackKey,
  syncStreamTrackMappingsForIdentity,
} from './reidStreamTrack';
import { rankCoverCandidates } from './cropResolve';
import { getOrgIdForStream } from './orgScope';

export function defaultPersonLabel(cameraName: string, trackId: number): string {
  return `${cameraName} · track ${trackId}`;
}

/** Lookup an existing user-created identity for a stream+track (never auto-creates). */
export async function resolveIdentityForStreamTrack(
  streamId: string,
  trackId: number,
): Promise<string | null> {
  const mapping = await prisma.reidStreamTrackMapping.findUnique({
    where: { streamId_trackId: { streamId, trackId } },
    select: { identityId: true },
  });
  if (mapping) return mapping.identityId;

  const prior = await prisma.reidDetection.findFirst({
    where: { streamId, trackId, identityId: { not: null } },
    orderBy: { timestamp: 'desc' },
    select: { identityId: true },
  });
  if (prior?.identityId) {
    await registerStreamTrackMapping(streamId, trackId, prior.identityId);
    return prior.identityId;
  }

  return null;
}

/** Create or resolve identity — only for explicit user actions (label, assign, merge). */
export async function ensureIdentityForStreamTrack(
  streamId: string,
  trackId: number,
): Promise<string> {
  const existing = await resolveIdentityForStreamTrack(streamId, trackId);
  if (existing) return existing;

  const orgId = await getOrgIdForStream(streamId);
  const identity = await prisma.reidIdentity.create({
    data: orgId ? { orgId } : {},
  });
  await registerStreamTrackMapping(streamId, trackId, identity.id);
  return identity.id;
}

export async function splitStreamTrackToNewIdentity(
  streamId: string,
  trackId: number,
): Promise<string> {
  const detections = await prisma.reidDetection.findMany({
    where: { streamId, trackId },
    select: { id: true },
  });

  const orgId = await getOrgIdForStream(streamId);
  const newIdentity = await prisma.reidIdentity.create({
    data: orgId ? { orgId } : {},
  });
  const detectionIds = detections.map(d => d.id);

  if (detectionIds.length > 0) {
    await prisma.reidDetection.updateMany({
      where: { id: { in: detectionIds } },
      data: { identityId: newIdentity.id },
    });
    const { updateReidPayloadBatch } = await import('./qdrant');
    await updateReidPayloadBatch(detectionIds, { identityId: newIdentity.id });
  }

  await registerStreamTrackMapping(streamId, trackId, newIdentity.id);
  await recomputeIdentityCentroid(newIdentity.id);
  return newIdentity.id;
}

export async function mergeStreamTracks(
  sourceStreamId: string,
  sourceTrackId: number,
  targetStreamId: string,
  targetTrackId: number,
): Promise<string> {
  const sourceIdentityId = await ensureIdentityForStreamTrack(sourceStreamId, sourceTrackId);
  const targetIdentityId = await ensureIdentityForStreamTrack(targetStreamId, targetTrackId);

  if (sourceIdentityId === targetIdentityId) return sourceIdentityId;

  const sourceDetections = await prisma.reidDetection.findMany({
    where: { identityId: sourceIdentityId },
    select: { id: true },
  });

  await prisma.reidDetection.updateMany({
    where: { identityId: sourceIdentityId },
    data: { identityId: targetIdentityId },
  });

  const { updateReidPayloadBatch } = await import('./qdrant');
  await updateReidPayloadBatch(
    sourceDetections.map(d => d.id),
    { identityId: targetIdentityId },
  );

  const mappings = await prisma.reidStreamTrackMapping.findMany({
    where: { identityId: sourceIdentityId },
  });
  for (const m of mappings) {
    await registerStreamTrackMapping(m.streamId, m.trackId, targetIdentityId);
  }

  await inheritIdentityLabel(targetIdentityId, [sourceIdentityId]);
  await removeStreamTrackMappingsForIdentity(sourceIdentityId);
  const { removeIdentityCentroid } = await import('./reidIdentity');
  await removeIdentityCentroid(sourceIdentityId);
  await prisma.reidIdentity.delete({ where: { id: sourceIdentityId } }).catch(() => {});
  await syncStreamTrackMappingsForIdentity(targetIdentityId);
  await recomputeIdentityCentroid(targetIdentityId);

  return targetIdentityId;
}

export async function cleanupEmptyIdentities(): Promise<number> {
  const emptyIdentities = await prisma.reidIdentity.findMany({
    where: {
      label: null,
      detections: { none: {} },
    },
    select: { id: true },
  });

  if (emptyIdentities.length === 0) return 0;

  const ids = emptyIdentities.map(i => i.id);
  const { removeIdentityCentroid } = await import('./reidIdentity');

  for (const id of ids) {
    await removeIdentityCentroid(id);
    await removeStreamTrackMappingsForIdentity(id);
  }
  await prisma.reidIdentity.deleteMany({ where: { id: { in: ids } } });

  console.log(`[ReID] Cleaned up ${ids.length} empty identity/identities`);
  return ids.length;
}

async function resolveStreamTracksForIdentity(identityId: string, onlineDeviceIds?: string[]) {
  const fromDetections = await prisma.reidDetection.groupBy({
    by: ['streamId', 'trackId', 'cameraName'],
    where: { identityId, streamId: { not: null } },
    _count: { id: true },
  });

  let tracks: { streamId: string; trackId: number; cameraName: string; cropCount: number }[];

  if (fromDetections.length > 0) {
    tracks = fromDetections.map(st => ({
      streamId: st.streamId!,
      trackId: st.trackId,
      cameraName: st.cameraName,
      cropCount: st._count.id,
    }));
  } else {
    const mappings = await prisma.reidStreamTrackMapping.findMany({
      where: { identityId },
    });

    tracks = [];
    for (const m of mappings) {
      const stream = await prisma.cameraStream.findUnique({
        where: { streamId: m.streamId },
        select: { name: true },
      });
      const cropCount = await prisma.reidDetection.count({
        where: { identityId, streamId: m.streamId, trackId: m.trackId },
      });
      tracks.push({
        streamId: m.streamId,
        trackId: m.trackId,
        cameraName: stream?.name ?? 'Unknown Camera',
        cropCount,
      });
    }
  }

  if (onlineDeviceIds === undefined) return tracks;

  const onlineSet = new Set(onlineDeviceIds);
  const streams = await prisma.cameraStream.findMany({
    where: { streamId: { in: tracks.map((t) => t.streamId) } },
    select: { streamId: true, deviceId: true },
  });
  const streamDeviceMap = new Map(streams.map((s) => [s.streamId, s.deviceId]));
  return tracks.filter((t) => onlineSet.has(streamDeviceMap.get(t.streamId) ?? ''));
}
export async function listPeople(limit = 50, onlineDeviceIds?: string[], orgId?: string) {
  const detectionFilter = onlineDeviceIds !== undefined
    ? (onlineDeviceIds.length > 0
      ? { some: { deviceId: { in: onlineDeviceIds } } }
      : { some: { deviceId: { in: [] as string[] } } })
    : { some: {} };

  const identities = await prisma.reidIdentity.findMany({
    where: {
      ...(orgId ? { orgId } : {}),
      detections: detectionFilter,
    },
    orderBy: { centroidUpdatedAt: 'desc' },
    take: limit,
    include: {
      streamTrackMappings: true,
      detections: {
        where: onlineDeviceIds !== undefined
          ? { deviceId: { in: onlineDeviceIds } }
          : undefined,
        orderBy: { timestamp: 'desc' },
        take: 20,
        select: {
          id: true,
          filename: true,
          cameraName: true,
          streamId: true,
          trackId: true,
          timestamp: true,
          clipId: true,
          clipFilename: true,
          clipOffsetMs: true,
        },
      },
      _count: { select: { detections: true } },
    },
  });

  const people = await Promise.all(identities.map(async (identity) => {
    const cover = rankCoverCandidates(identity.detections)[0];
    const streamTracks = await resolveStreamTracksForIdentity(identity.id, onlineDeviceIds);

    const primaryTrack = streamTracks[0];
    const displayName = identity.label
      || (primaryTrack
        ? defaultPersonLabel(primaryTrack.cameraName, primaryTrack.trackId)
        : 'Unknown person');

    return {
      id: identity.id,
      label: identity.label,
      displayName,
      coverFilename: cover?.filename ?? null,
      coverCameraName: cover?.cameraName ?? null,
      coverDetectionId: cover?.id ?? null,
      coverClipId: cover?.clipId ?? null,
      photoCount: identity._count.detections,
      galleryCount: identity.galleryCount,
      lastSeen: cover?.timestamp?.toISOString() ?? null,
      streamTracks,
    };
  }));

  return people.sort((a, b) => {
    const ta = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
    const tb = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
    return tb - ta;
  });
}

export async function findSimilarPeople(identityId: string, limit = 8, onlineDeviceIds?: string[], orgId?: string) {
  const identity = await prisma.reidIdentity.findUnique({
    where: { id: identityId },
    include: {
      detections: { orderBy: { timestamp: 'desc' }, take: 1 },
    },
  });
  if (!identity) return [];

  let searchVector: number[] | null = null;
  const prototype = await retrieveIdentityPrototype(identityId);
  if (prototype) {
    searchVector = prototype.vector;
  } else if (identity.detections[0]) {
    const vectors = await retrieveReidVectors([identity.detections[0].id]);
    if (vectors.length) searchVector = vectors[0].vector;
  }
  if (!searchVector) return [];

  const identityDetections = await prisma.reidDetection.findMany({
    where: { identityId },
    select: { id: true },
  });
  const identityDetectionIds = identityDetections.map((d) => d.id);

  const rejectedFeedback = identityDetectionIds.length > 0
    ? await prisma.reidFeedback.findMany({
      where: {
        type: ReidFeedbackType.different,
        OR: [
          { sourceDetectionId: { in: identityDetectionIds } },
          { targetDetectionId: { in: identityDetectionIds } },
        ],
      },
    })
    : [];

  const rejectedOtherDetectionIds = new Set<string>();
  for (const fb of rejectedFeedback) {
    if (identityDetectionIds.includes(fb.sourceDetectionId)) {
      rejectedOtherDetectionIds.add(fb.targetDetectionId);
    } else {
      rejectedOtherDetectionIds.add(fb.sourceDetectionId);
    }
  }

  const rejectedIdentityIds = new Set<string>();
  if (rejectedOtherDetectionIds.size > 0) {
    const rejectedDetections = await prisma.reidDetection.findMany({
      where: { id: { in: [...rejectedOtherDetectionIds] } },
      select: { identityId: true },
    });
    for (const detection of rejectedDetections) {
      if (detection.identityId) rejectedIdentityIds.add(detection.identityId);
    }
  }

  const prototypeHits = await searchIdentityPrototypes(searchVector, limit + 5);
  const cropHits = await searchReidVectors(searchVector, limit + 10);

  const identityScores = new Map<string, number>();

  for (const hit of prototypeHits) {
    const hitId = (hit.payload as { identityId?: string })?.identityId;
    if (!hitId || hitId === identityId || rejectedIdentityIds.has(hitId)) continue;
    identityScores.set(hitId, Math.max(identityScores.get(hitId) ?? 0, hit.score));
  }

  for (const hit of cropHits) {
    const payload = hit.payload as { identityId?: string; mongoId?: string };
    if (!payload?.identityId || payload.identityId === identityId || rejectedIdentityIds.has(payload.identityId)) continue;
    identityScores.set(
      payload.identityId,
      Math.max(identityScores.get(payload.identityId) ?? 0, hit.score * 0.9),
    );
  }

  const sortedIds = [...identityScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);

  return fetchPersonMatchesByIds(sortedIds, identityScores, onlineDeviceIds, orgId);
}

async function fetchPersonMatchesByIds(
  sortedIds: string[],
  identityScores: Map<string, number>,
  onlineDeviceIds?: string[],
  orgId?: string,
) {
  if (sortedIds.length === 0) return [];

  const detectionFilter = onlineDeviceIds !== undefined
    ? (onlineDeviceIds.length > 0
      ? { some: { deviceId: { in: onlineDeviceIds } } }
      : { some: { deviceId: { in: [] as string[] } } })
    : { some: {} };

  const similar = await prisma.reidIdentity.findMany({
    where: { id: { in: sortedIds }, ...(orgId ? { orgId } : {}), detections: detectionFilter },
    include: {
      detections: {
        where: onlineDeviceIds !== undefined
          ? { deviceId: { in: onlineDeviceIds } }
          : undefined,
        orderBy: { timestamp: 'desc' },
        take: 20,
        select: {
          id: true,
          filename: true,
          cameraName: true,
          trackId: true,
          clipFilename: true,
          clipOffsetMs: true,
        },
      },
      streamTrackMappings: true,
      _count: { select: { detections: true } },
    },
  });

  return sortedIds.flatMap((id) => {
    const person = similar.find((p) => p.id === id);
    if (!person || person.detections.length === 0) return [];
    const cover = rankCoverCandidates(person.detections)[0];
    const score = identityScores.get(id) ?? 0;
    return [{
      id: person.id,
      label: person.label,
      displayName: person.label
        || (cover
          ? defaultPersonLabel(cover.cameraName, cover.trackId)
          : 'Unknown person'),
      coverFilename: cover?.filename ?? null,
      photoCount: person._count.detections,
      matchScore: score,
      streamTracks: person.streamTrackMappings.map((m) => ({
        streamId: m.streamId,
        trackId: m.trackId,
      })),
    }];
  });
}

export async function findSimilarIdentitiesForDetection(
  detectionId: string,
  limit = 8,
  onlineDeviceIds?: string[],
  orgId?: string,
) {
  const detection = await prisma.reidDetection.findUnique({ where: { id: detectionId } });
  if (!detection) return [];

  const vectors = await retrieveReidVectors([detectionId]);
  if (vectors.length === 0) return [];

  const hits = await searchIdentityPrototypes(vectors[0].vector, limit + 10);
  const identityScores = new Map<string, number>();

  for (const hit of hits) {
    const hitId = (hit.payload as { identityId?: string })?.identityId;
    if (!hitId || hitId === detection.identityId) continue;
    identityScores.set(hitId, Math.max(identityScores.get(hitId) ?? 0, hit.score));
  }

  const sortedIds = [...identityScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);

  return fetchPersonMatchesByIds(sortedIds, identityScores, onlineDeviceIds, orgId);
}

export type IdentityTimelineEntry = {
  id: string;
  deviceId: string;
  cameraName: string;
  streamId: string | null;
  trackId: number;
  timestamp: Date;
  filename: string;
  clipId: string | null;
  bbox: string;
  className: string;
  identityId: string | null;
  linkStatus: 'confirmed' | 'approximate';
  matchScore?: number;
  scores?: {
    vectorSimilarity: number;
    timeScore: number;
    topologyScore: number;
    finalScore: number;
    feedbackBoost?: number;
  };
};

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function computeTransitionScores(
  reference: IdentityTimelineEntry,
  current: IdentityTimelineEntry,
  topologyRoutes: Awaited<ReturnType<typeof prisma.topologyRoute.findMany>>,
): { timeScore: number; topologyScore: number } {
  const tRef = new Date(reference.timestamp).getTime();
  const tCur = new Date(current.timestamp).getTime();
  const deltaTime = Math.abs(tRef - tCur) / 1000;

  let timeScore = 0.5;
  let topologyScore = 0.5;

  const route = topologyRoutes.find((r) =>
    (reference.streamId && current.streamId
      && ((r.fromStreamId === reference.streamId && r.toStreamId === current.streamId)
        || (r.fromStreamId === current.streamId && r.toStreamId === reference.streamId)))
    || (r.fromCamera === reference.cameraName && r.toCamera === current.cameraName)
    || (r.fromCamera === current.cameraName && r.toCamera === reference.cameraName));

  if (route) {
    topologyScore = route.topologyScore;
    if (deltaTime < route.minTimeSeconds) {
      timeScore = 0.0;
    } else if (deltaTime >= route.minTimeSeconds && deltaTime <= route.maxTimeSeconds) {
      const span = route.maxTimeSeconds - route.minTimeSeconds;
      timeScore = span > 0
        ? 1.0 - 0.8 * ((deltaTime - route.minTimeSeconds) / span)
        : 1.0;
    } else {
      timeScore = 0.2 * Math.exp(-(deltaTime - route.maxTimeSeconds) / 600);
    }
  } else {
    const isSameCamera = reference.streamId && current.streamId
      ? reference.streamId === current.streamId
      : reference.cameraName === current.cameraName;
    if (isSameCamera) {
      topologyScore = 0.8;
      timeScore = Math.exp(-deltaTime / 300);
    } else {
      topologyScore = 0.2;
      timeScore = deltaTime < 10 ? 0.1 : Math.exp(-(deltaTime - 10) / 600);
    }
  }

  return { timeScore, topologyScore };
}

/** Add embedding/time/topology/final score breakdown for identity journey timeline rows. */
export async function enrichIdentityTimelineWithScores(
  identityId: string,
  entries: IdentityTimelineEntry[],
): Promise<IdentityTimelineEntry[]> {
  if (entries.length === 0) return entries;

  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const [topologyRoutes, mappedTrackKeys, prototype, vectors] = await Promise.all([
    prisma.topologyRoute.findMany(),
    getStreamTrackKeysForIdentity(identityId),
    retrieveIdentityPrototype(identityId),
    retrieveReidVectors(sorted.map((entry) => entry.id)),
  ]);

  const vectorById = new Map(vectors.map((row) => [row.mongoId, row.vector]));
  const confirmedIds = sorted.filter((entry) => entry.linkStatus === 'confirmed').map((entry) => entry.id);
  const feedbackEntries = confirmedIds.length > 0
    ? await prisma.reidFeedback.findMany({
      where: {
        OR: [
          { sourceDetectionId: { in: confirmedIds } },
          { targetDetectionId: { in: confirmedIds } },
        ],
      },
    })
    : [];

  const feedbackConfirmedIds = new Set<string>();
  for (const fb of feedbackEntries) {
    if (isSameFeedback(fb.type)) {
      const otherId = confirmedIds.includes(fb.sourceDetectionId)
        ? fb.targetDetectionId
        : fb.sourceDetectionId;
      feedbackConfirmedIds.add(otherId);
    }
  }

  const findReferenceIndex = (index: number): number => {
    for (let j = index - 1; j >= 0; j -= 1) {
      if (sorted[j].linkStatus === 'confirmed') return j;
    }
    for (let j = 0; j < sorted.length; j += 1) {
      if (sorted[j].linkStatus === 'confirmed') return j;
    }
    return index;
  };

  return sorted.map((entry, index) => {
    const reference = sorted[findReferenceIndex(index)];
    const { timeScore, topologyScore } = computeTransitionScores(reference, entry, topologyRoutes);

    let vectorSimilarity = entry.matchScore ?? 0.5;
    if (prototype && vectorById.has(entry.id)) {
      vectorSimilarity = cosineSimilarity(prototype.vector, vectorById.get(entry.id)!);
    }

    let feedbackBoost = 0;
    if (entry.identityId === identityId) feedbackBoost += 0.3;
    if (feedbackConfirmedIds.has(entry.id)) feedbackBoost += 0.15;
    if (entry.streamId && mappedTrackKeys.has(streamTrackKey(entry.streamId, entry.trackId))) {
      feedbackBoost += 0.25;
    }

    const finalScore = Math.min(
      1.0,
      (0.6 * vectorSimilarity) + (0.2 * timeScore) + (0.2 * topologyScore) + feedbackBoost,
    );

    return {
      ...entry,
      matchScore: finalScore,
      scores: {
        vectorSimilarity,
        timeScore,
        topologyScore,
        finalScore,
        ...(feedbackBoost > 0 ? { feedbackBoost } : {}),
      },
    };
  });
};

const APPROXIMATE_MATCH_THRESHOLD = 0.45;

/** Vector-similar detections not yet linked to this identity. */
export async function findApproximateDetectionsForIdentity(
  identityId: string,
  confirmedIds: Set<string>,
  onlineDeviceIds: string[],
  limit = 40,
): Promise<IdentityTimelineEntry[]> {
  if (onlineDeviceIds.length === 0) return [];

  let searchVector: number[] | null = null;
  const prototype = await retrieveIdentityPrototype(identityId);
  if (prototype) {
    searchVector = prototype.vector;
  } else {
    const latest = await prisma.reidDetection.findFirst({
      where: { identityId, deviceId: { in: onlineDeviceIds } },
      orderBy: { timestamp: 'desc' },
    });
    if (latest) {
      const vectors = await retrieveReidVectors([latest.id]);
      if (vectors.length) searchVector = vectors[0].vector;
    }
  }
  if (!searchVector) return [];

  const confirmedIdList = [...confirmedIds];
  const rejectedFeedback = confirmedIdList.length > 0
    ? await prisma.reidFeedback.findMany({
      where: {
        type: ReidFeedbackType.different,
        OR: [
          { sourceDetectionId: { in: confirmedIdList } },
          { targetDetectionId: { in: confirmedIdList } },
        ],
      },
    })
    : [];

  const rejectedIds = new Set<string>();
  for (const fb of rejectedFeedback) {
    if (confirmedIds.has(fb.sourceDetectionId)) {
      rejectedIds.add(fb.targetDetectionId);
    } else {
      rejectedIds.add(fb.sourceDetectionId);
    }
  }

  const hits = await searchReidVectors(searchVector, limit + confirmedIds.size + 15);
  const candidateScores = new Map<string, number>();

  for (const hit of hits) {
    const payload = hit.payload as {
      mongoId?: string;
      identityId?: string;
      deviceId?: string;
    } | undefined;
    const mongoId = payload?.mongoId;
    if (!mongoId || confirmedIds.has(mongoId) || rejectedIds.has(mongoId)) continue;
    if (payload?.identityId && payload.identityId !== identityId) continue;
    if (!payload?.deviceId || !onlineDeviceIds.includes(payload.deviceId)) continue;
    if (hit.score < APPROXIMATE_MATCH_THRESHOLD) continue;
    candidateScores.set(mongoId, hit.score);
  }

  if (candidateScores.size === 0) return [];

  const detections = await prisma.reidDetection.findMany({
    where: { id: { in: [...candidateScores.keys()] } },
  });

  return detections
    .map((detection) => ({
      id: detection.id,
      deviceId: detection.deviceId,
      cameraName: detection.cameraName,
      streamId: detection.streamId,
      trackId: detection.trackId,
      timestamp: detection.timestamp,
      filename: detection.filename,
      clipId: detection.clipId,
      bbox: detection.bbox,
      className: detection.className,
      identityId: detection.identityId,
      linkStatus: 'approximate' as const,
      matchScore: candidateScores.get(detection.id),
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(0, limit);
}

/** Sync stream-track mappings from user-assigned detections only (no auto-create). */
export async function backfillStreamTrackIdentities(): Promise<void> {
  const groups = await prisma.reidDetection.groupBy({
    by: ['streamId', 'trackId'],
    where: { streamId: { not: null }, identityId: { not: null } },
  });

  let synced = 0;
  for (const group of groups) {
    if (!group.streamId) continue;
    const prior = await prisma.reidDetection.findFirst({
      where: { streamId: group.streamId, trackId: group.trackId, identityId: { not: null } },
      orderBy: { timestamp: 'desc' },
      select: { identityId: true },
    });
    if (!prior?.identityId) continue;

    const before = await prisma.reidStreamTrackMapping.findUnique({
      where: { streamId_trackId: { streamId: group.streamId, trackId: group.trackId } },
    });
    await registerStreamTrackMapping(group.streamId, group.trackId, prior.identityId);
    if (!before) synced++;
  }

  if (synced > 0) {
    console.log(`[ReID] Synced ${synced} user-assigned stream+track mapping(s)`);
  }

  await cleanupEmptyIdentities();
}
