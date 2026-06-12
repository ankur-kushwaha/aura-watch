import prisma from './db';
import {
  retrieveIdentityPrototype,
  retrieveReidVectors,
  searchIdentityPrototypes,
  searchReidVectors,
} from './qdrant';
import { recomputeIdentityCentroid } from './reidIdentity';
import {
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

export async function ensureIdentityForStreamTrack(
  streamId: string,
  trackId: number,
): Promise<string> {
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

async function resolveStreamTracksForIdentity(identityId: string) {
  const fromDetections = await prisma.reidDetection.groupBy({
    by: ['streamId', 'trackId', 'cameraName'],
    where: { identityId, streamId: { not: null } },
    _count: { id: true },
  });

  if (fromDetections.length > 0) {
    return fromDetections.map(st => ({
      streamId: st.streamId!,
      trackId: st.trackId,
      cameraName: st.cameraName,
      cropCount: st._count.id,
    }));
  }

  const mappings = await prisma.reidStreamTrackMapping.findMany({
    where: { identityId },
  });

  const tracks = [];
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
  return tracks;
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
          clipFilename: true,
          clipOffsetMs: true,
        },
      },
      _count: { select: { detections: true } },
    },
  });

  const people = await Promise.all(identities.map(async (identity) => {
    const cover = rankCoverCandidates(identity.detections)[0];
    const streamTracks = await resolveStreamTracksForIdentity(identity.id);

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

export async function findSimilarPeople(identityId: string, limit = 8) {
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

  const rejectedPairs = await prisma.reidStreamTrackFeedback.findMany({
    where: { type: 'different_person' },
  });
  const rejectedIdentityPairs = new Set<string>();

  const sourceMappings = await prisma.reidStreamTrackMapping.findMany({
    where: { identityId },
  });
  const sourceKeys = new Set(sourceMappings.map(m => streamTrackKey(m.streamId, m.trackId)));

  for (const fb of rejectedPairs) {
    const srcKey = streamTrackKey(fb.sourceStreamId, fb.sourceTrackId);
    const tgtKey = streamTrackKey(fb.targetStreamId, fb.targetTrackId);
    if (sourceKeys.has(srcKey) || sourceKeys.has(tgtKey)) {
      rejectedIdentityPairs.add(`${srcKey}|${tgtKey}`);
      rejectedIdentityPairs.add(`${tgtKey}|${srcKey}`);
    }
  }

  const prototypeHits = await searchIdentityPrototypes(searchVector, limit + 5);
  const cropHits = await searchReidVectors(searchVector, limit + 10);

  const identityScores = new Map<string, number>();

  for (const hit of prototypeHits) {
    const hitId = (hit.payload as { identityId?: string })?.identityId;
    if (!hitId || hitId === identityId) continue;
    identityScores.set(hitId, Math.max(identityScores.get(hitId) ?? 0, hit.score));
  }

  for (const hit of cropHits) {
    const payload = hit.payload as { identityId?: string; mongoId?: string };
    if (!payload?.identityId || payload.identityId === identityId) continue;
    identityScores.set(
      payload.identityId,
      Math.max(identityScores.get(payload.identityId) ?? 0, hit.score * 0.9),
    );
  }

  const sortedIds = [...identityScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);

  if (sortedIds.length === 0) return [];

  const similar = await prisma.reidIdentity.findMany({
    where: { id: { in: sortedIds }, detections: { some: {} } },
    include: {
      detections: {
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

  return sortedIds.map(id => {
    const person = similar.find(p => p.id === id)!;
    const cover = rankCoverCandidates(person.detections)[0];
    const primaryMapping = person.streamTrackMappings[0];
    const score = identityScores.get(id) ?? 0;
    return {
      id: person.id,
      label: person.label,
      displayName: person.label
        || (cover
          ? defaultPersonLabel(cover.cameraName, cover.trackId)
          : 'Unknown person'),
      coverFilename: cover?.filename ?? null,
      photoCount: person._count.detections,
      matchScore: score,
      streamTracks: person.streamTrackMappings.map(m => ({
        streamId: m.streamId,
        trackId: m.trackId,
      })),
    };
  });
}

export async function backfillStreamTrackIdentities(): Promise<void> {
  const groups = await prisma.reidDetection.groupBy({
    by: ['streamId', 'trackId'],
    where: { streamId: { not: null } },
  });

  let created = 0;
  for (const group of groups) {
    if (!group.streamId) continue;
    const before = await prisma.reidStreamTrackMapping.findUnique({
      where: { streamId_trackId: { streamId: group.streamId, trackId: group.trackId } },
    });
    const identityId = await ensureIdentityForStreamTrack(group.streamId, group.trackId);
    if (!before) created++;

    await prisma.reidDetection.updateMany({
      where: { streamId: group.streamId, trackId: group.trackId, identityId: null },
      data: { identityId },
    });
    await recomputeIdentityCentroid(identityId);
  }

  if (created > 0) {
    console.log(`[ReID] Auto-mapped ${created} stream+track group(s) to identities`);
  }

  await cleanupEmptyIdentities();
}
