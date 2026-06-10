import prisma from './db';
import {
  retrieveReidVectors,
  upsertIdentityPrototype,
  deleteIdentityPrototype,
} from './qdrant';

const MAX_GALLERY_SIZE = 10;

export function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      sum[i] += vec[i];
    }
  }
  return sum.map(v => v / vectors.length);
}

async function getGalleryDetectionIds(identityId: string): Promise<string[]> {
  const allDetections = await prisma.reidDetection.findMany({
    where: { identityId },
    select: { id: true, timestamp: true },
    orderBy: { timestamp: 'desc' },
  });

  if (allDetections.length === 0) return [];

  const allIds = allDetections.map(d => d.id);

  const feedback = await prisma.reidFeedback.findMany({
    where: {
      type: { in: ['confirm', 'same_person'] },
      OR: [
        { sourceDetectionId: { in: allIds } },
        { targetDetectionId: { in: allIds } },
      ],
    },
  });

  const confirmedIds = new Set<string>();
  for (const fb of feedback) {
    if (allIds.includes(fb.sourceDetectionId)) confirmedIds.add(fb.sourceDetectionId);
    if (allIds.includes(fb.targetDetectionId)) confirmedIds.add(fb.targetDetectionId);
  }

  const galleryIds = confirmedIds.size > 0
    ? allDetections.filter(d => confirmedIds.has(d.id)).map(d => d.id)
    : allIds;

  return galleryIds.slice(0, MAX_GALLERY_SIZE);
}

export async function recomputeIdentityCentroid(identityId: string): Promise<void> {
  const identity = await prisma.reidIdentity.findUnique({ where: { id: identityId } });
  if (!identity) return;

  const galleryIds = await getGalleryDetectionIds(identityId);
  if (galleryIds.length === 0) {
    await deleteIdentityPrototype(identityId);
    await prisma.reidIdentity.update({
      where: { id: identityId },
      data: { galleryCount: 0, centroidUpdatedAt: null },
    });
    return;
  }

  const vectors = await retrieveReidVectors(galleryIds);
  if (vectors.length === 0) return;

  const centroid = averageVectors(vectors.map(v => v.vector));

  await upsertIdentityPrototype(identityId, centroid, {
    identityId,
    galleryCount: vectors.length,
    detectionIds: galleryIds,
    updatedAt: new Date().toISOString(),
  });

  await prisma.reidIdentity.update({
    where: { id: identityId },
    data: {
      galleryCount: vectors.length,
      centroidUpdatedAt: new Date(),
    },
  });

  console.log(`[ReID Identity] Updated centroid for identity ${identityId} from ${vectors.length} gallery crop(s)`);
}

export async function removeIdentityCentroid(identityId: string): Promise<void> {
  await deleteIdentityPrototype(identityId);
}
