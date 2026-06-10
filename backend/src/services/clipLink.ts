import prisma from './db';

export async function resolveClipIdFromFilename(clipFilename: string | null | undefined): Promise<string | null> {
  if (!clipFilename) return null;
  const clip = await prisma.videoClip.findFirst({
    where: { filename: clipFilename },
    select: { id: true },
  });
  return clip?.id ?? null;
}

export async function linkDetectionsToClip(clipId: string, clipFilename: string): Promise<number> {
  const result = await prisma.reidDetection.updateMany({
    where: { clipFilename, clipId: null },
    data: { clipId },
  });
  return result.count;
}

/** Backfill clipId on detections that only have clipFilename. */
export async function backfillDetectionClipLinks(): Promise<number> {
  const unlinked = await prisma.reidDetection.findMany({
    where: { clipId: null, clipFilename: { not: null } },
    select: { id: true, clipFilename: true },
    take: 500,
  });

  if (unlinked.length === 0) return 0;

  const filenames = [...new Set(unlinked.map((d) => d.clipFilename!).filter(Boolean))];
  const clips = await prisma.videoClip.findMany({
    where: { filename: { in: filenames } },
    select: { id: true, filename: true },
  });
  const clipIdByFilename = new Map(clips.map((c) => [c.filename, c.id]));

  let linked = 0;
  for (const detection of unlinked) {
    const clipId = clipIdByFilename.get(detection.clipFilename!);
    if (!clipId) continue;
    await prisma.reidDetection.update({
      where: { id: detection.id },
      data: { clipId },
    });
    linked++;
  }

  if (linked > 0) {
    console.log(`[Clips] Backfilled clipId on ${linked} Reid detection(s)`);
  }
  return linked;
}
