import { Router, Request, Response } from 'express';
import prisma from '../services/db';
import { deleteClipVector } from '../services/qdrant';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

const VIDEO_DIR = process.env.VIDEO_STORAGE_DIR || path.join(__dirname, '../../storage/videos');

/**
 * GET /api/clips
 * Retrieve all video clips from database ordered by timestamp descending.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const clips = await prisma.videoClip.findMany({
      orderBy: {
        timestamp: 'desc',
      },
    });
    res.json(clips);
  } catch (error) {
    console.error('Error fetching clips:', error);
    res.status(500).json({ error: 'Failed to fetch clips' });
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
