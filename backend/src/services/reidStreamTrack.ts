import prisma from './db';
import { updateReidPayload } from './qdrant';
import { recomputeIdentityCentroid } from './reidIdentity';

export function streamTrackKey(streamId: string, trackId: number): string {
  return `${streamId}:${trackId}`;
}

export async function resolveIdentityFromStreamTrack(
  streamId: string | null | undefined,
  trackId: number,
): Promise<string | null> {
  if (!streamId) return null;

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
  if (!prior?.identityId) return null;

  await registerStreamTrackMapping(streamId, trackId, prior.identityId);
  return prior.identityId;
}

export async function registerStreamTrackMapping(
  streamId: string,
  trackId: number,
  identityId: string,
): Promise<void> {
  await prisma.reidStreamTrackMapping.upsert({
    where: { streamId_trackId: { streamId, trackId } },
    create: { streamId, trackId, identityId },
    update: { identityId },
  });
}

export async function syncStreamTrackMappingsForIdentity(identityId: string): Promise<void> {
  const detections = await prisma.reidDetection.findMany({
    where: { identityId, streamId: { not: null } },
    select: { streamId: true, trackId: true },
  });

  for (const detection of detections) {
    if (detection.streamId) {
      await registerStreamTrackMapping(detection.streamId, detection.trackId, identityId);
    }
  }
}

export async function getStreamTrackKeysForIdentity(identityId: string): Promise<Set<string>> {
  const mappings = await prisma.reidStreamTrackMapping.findMany({
    where: { identityId },
    select: { streamId: true, trackId: true },
  });
  return new Set(mappings.map(m => streamTrackKey(m.streamId, m.trackId)));
}

export async function inheritIdentityLabel(
  targetIdentityId: string,
  sourceIdentityIds: string[],
): Promise<void> {
  const target = await prisma.reidIdentity.findUnique({
    where: { id: targetIdentityId },
    select: { label: true },
  });
  if (target?.label) return;

  for (const sourceId of sourceIdentityIds) {
    const source = await prisma.reidIdentity.findUnique({
      where: { id: sourceId },
      select: { label: true },
    });
    if (source?.label) {
      await prisma.reidIdentity.update({
        where: { id: targetIdentityId },
        data: { label: source.label },
      });
      return;
    }
  }
}

/** Link a detection to an identity only when the user has already assigned that stream+track. */
export async function linkDetectionToExistingIdentity(
  detectionId: string,
  streamId: string | null | undefined,
  trackId: number,
): Promise<{ identityId: string } | null> {
  if (!streamId) return null;

  const identityId = await resolveIdentityFromStreamTrack(streamId, trackId);
  if (!identityId) return null;

  await prisma.reidDetection.update({
    where: { id: detectionId },
    data: { identityId },
  });
  await updateReidPayload(detectionId, { identityId });
  await recomputeIdentityCentroid(identityId);

  return { identityId };
}

export async function removeStreamTrackMappingsForIdentity(identityId: string): Promise<void> {
  await prisma.reidStreamTrackMapping.deleteMany({ where: { identityId } });
}

export async function backfillAllStreamTrackMappings(): Promise<void> {
  const identities = await prisma.reidIdentity.findMany({ select: { id: true } });
  for (const { id } of identities) {
    await syncStreamTrackMappingsForIdentity(id);
  }
  if (identities.length > 0) {
    console.log(`[ReID] Backfilled stream-track mappings for ${identities.length} identity/identities`);
  }
}
