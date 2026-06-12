import { Router, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../services/db';
import { deleteClipVector, deleteClipVectors } from '../services/qdrant';
import { getClipDetectionsResponse } from '../services/clipDetections';
import { orgClipWhere, assertClipInOrg, getOrgDeviceIds } from '../services/orgScope';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

function parseClipListFilters(req: Request) {
  const deviceId =
    typeof req.query.deviceId === 'string' && req.query.deviceId.trim()
      ? req.query.deviceId.trim()
      : undefined;
  const streamId =
    typeof req.query.streamId === 'string' && req.query.streamId.trim()
      ? req.query.streamId.trim()
      : undefined;

  const startRaw = typeof req.query.startTime === 'string' ? req.query.startTime : undefined;
  const endRaw = typeof req.query.endTime === 'string' ? req.query.endTime : undefined;
  const startTime = startRaw ? new Date(startRaw) : undefined;
  const endTime = endRaw ? new Date(endRaw) : undefined;

  return {
    deviceId,
    streamId,
    startTime: startTime && !Number.isNaN(startTime.getTime()) ? startTime : undefined,
    endTime: endTime && !Number.isNaN(endTime.getTime()) ? endTime : undefined,
  };
}

function buildClipListWhere(
  onlineWhere: Prisma.VideoClipWhereInput,
  filters: ReturnType<typeof parseClipListFilters>,
): Prisma.VideoClipWhereInput {
  const extra: Prisma.VideoClipWhereInput = {};

  if (filters.deviceId) {
    extra.deviceId = filters.deviceId;
  }
  if (filters.streamId) {
    extra.streamId = filters.streamId;
  }
  if (filters.startTime || filters.endTime) {
    extra.timestamp = {
      ...(filters.startTime ? { gte: filters.startTime } : {}),
      ...(filters.endTime ? { lte: filters.endTime } : {}),
    };
  }

  if (Object.keys(extra).length === 0) {
    return onlineWhere;
  }

  return { AND: [onlineWhere, extra] };
}

export type ClipDeletedCallback = (deviceId: string, filename: string) => void;
let onClipDeletedCallback: ClipDeletedCallback | null = null;

export function registerOnClipDeleted(cb: ClipDeletedCallback) {
  onClipDeletedCallback = cb;
}

const VIDEO_DIR = process.env.VIDEO_STORAGE_DIR || path.join(__dirname, '../../storage/videos');

/**
 * GET /api/clips
 * Retrieve video clips ordered by timestamp descending.
 * Optional query params: limit, offset — returns { clips, total, hasMore }.
 */
router.get('/', async (req: Request, res: Response) => {
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const onlineWhere = await orgClipWhere(req.auth.orgId);
    const filters = parseClipListFilters(req);
    const where = buildClipListWhere(onlineWhere, filters);

    const limitParam = req.query.limit;
    const offsetParam = req.query.offset;

    if (limitParam !== undefined) {
      const limit = Math.min(Math.max(parseInt(String(limitParam), 10) || 10, 1), 100);
      const offset = Math.max(parseInt(String(offsetParam ?? '0'), 10) || 0, 0);

      const [clips, total] = await Promise.all([
        prisma.videoClip.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.videoClip.count({ where }),
      ]);

      res.json({
        clips,
        total,
        hasMore: offset + clips.length < total,
      });
      return;
    }

    const clips = await prisma.videoClip.findMany({
      where,
      orderBy: { timestamp: 'desc' },
    });
    res.json(clips);
  } catch (error) {
    console.error('Error fetching clips:', error);
    res.status(500).json({ error: 'Failed to fetch clips' });
  }
});

/**
 * GET /api/clips/:id/detections
 * Detected objects for a clip with confirmed labels or embedding match scores.
 */
router.get('/:id/detections', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (!(await assertClipInOrg(id, req.auth.orgId))) {
      return res.status(404).json({ error: 'Clip not found' });
    }

    const result = await getClipDetectionsResponse(id);
    res.json(result);
  } catch (error) {
    console.error('Error fetching clip detections:', error);
    res.status(500).json({ error: 'Failed to fetch clip detections' });
  }
});

/**
 * GET /api/clips/:id
 * Fetch details of a single clip.
 */
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (!(await assertClipInOrg(id, req.auth.orgId))) {
      return res.status(404).json({ error: 'Clip not found' });
    }

    const clip = await prisma.videoClip.findUnique({
      where: { id },
    });
    if (!clip) {
      return res.status(404).json({ error: 'Clip not found' });
    }
    res.json(clip);
  } catch (error) {
    console.error('Error fetching clip:', error);
    res.status(500).json({ error: 'Failed to fetch clip' });
  }
});

/**
 * DELETE /api/clips
 * Delete all video clips, their local files, and Qdrant vectors.
 */
router.delete('/', async (req: Request, res: Response) => {
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const orgDeviceIds = await getOrgDeviceIds(req.auth.orgId);
    const clips = await prisma.videoClip.findMany({
      where: { deviceId: { in: orgDeviceIds } },
    });

    for (const clip of clips) {
      if (fs.existsSync(clip.filepath)) {
        try {
          fs.unlinkSync(clip.filepath);
          console.log(`[Clips] Deleted local file: ${clip.filepath}`);
        } catch (err) {
          console.error(`[Clips] Failed to delete file at ${clip.filepath}:`, err);
        }
      }

      if (clip.deviceId && onClipDeletedCallback) {
        onClipDeletedCallback(clip.deviceId, clip.filename);
      }
    }

    await deleteClipVectors(clips.map((clip) => clip.id));

    const result = await prisma.videoClip.deleteMany({
      where: { deviceId: { in: orgDeviceIds } },
    });

    res.json({ message: 'Organization clips successfully deleted', count: result.count });
  } catch (error) {
    console.error('Error deleting all clips:', error);
    res.status(500).json({ error: 'Failed to delete all clips' });
  }
});

/**
 * DELETE /api/clips/:id
 * Delete a video clip, its local file, and its Qdrant vector.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (!(await assertClipInOrg(id, req.auth.orgId))) {
      return res.status(404).json({ error: 'Clip not found' });
    }

    const clip = await prisma.videoClip.findUnique({
      where: { id },
    });
    if (!clip) {
      return res.status(404).json({ error: 'Clip not found' });
    }

    // 2. Delete local video file
    if (fs.existsSync(clip.filepath)) {
      try {
        fs.unlinkSync(clip.filepath);
        console.log(`[Clips] Deleted local file: ${clip.filepath}`);
      } catch (err) {
        console.error(`[Clips] Failed to delete file at ${clip.filepath}:`, err);
      }
    }

    // Also trigger deletion on edge device
    if (clip.deviceId && onClipDeletedCallback) {
      onClipDeletedCallback(clip.deviceId, clip.filename);
    }

    // 3. Delete vector from Qdrant
    await deleteClipVector(id);

    // 4. Delete from MongoDB
    await prisma.videoClip.delete({
      where: { id },
    });

    res.json({ message: 'Clip successfully deleted' });
  } catch (error) {
    console.error('Error deleting clip:', error);
    res.status(500).json({ error: 'Failed to delete clip' });
  }
});

export default router;
