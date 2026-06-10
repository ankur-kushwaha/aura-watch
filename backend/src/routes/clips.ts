import { Router, Request, Response } from 'express';
import prisma from '../services/db';
import { deleteClipVector, deleteClipVectors } from '../services/qdrant';
import { getClipObjectDetections } from '../services/clipDetections';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

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
  try {
    const limitParam = req.query.limit;
    const offsetParam = req.query.offset;

    if (limitParam !== undefined) {
      const limit = Math.min(Math.max(parseInt(String(limitParam), 10) || 10, 1), 100);
      const offset = Math.max(parseInt(String(offsetParam ?? '0'), 10) || 0, 0);

      const [clips, total] = await Promise.all([
        prisma.videoClip.findMany({
          orderBy: { timestamp: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.videoClip.count(),
      ]);

      res.json({
        clips,
        total,
        hasMore: offset + clips.length < total,
      });
      return;
    }

    const clips = await prisma.videoClip.findMany({
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
  try {
    const clip = await prisma.videoClip.findUnique({ where: { id } });
    if (!clip) {
      return res.status(404).json({ error: 'Clip not found' });
    }

    const objects = await getClipObjectDetections(id);
    res.json(objects);
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
  try {
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
router.delete('/', async (_req: Request, res: Response) => {
  try {
    const clips = await prisma.videoClip.findMany();

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

    const result = await prisma.videoClip.deleteMany();

    res.json({ message: 'All clips successfully deleted', count: result.count });
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
  try {
    // 1. Fetch clip from DB to get filepath
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
