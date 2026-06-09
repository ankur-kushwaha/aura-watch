import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import prisma from '../services/db';
import reidWorker from '../services/reidWorker';
import { upsertReidVector, searchReidVectors, deleteReidVector } from '../services/qdrant';

const router = Router();
const CROPS_DIR = path.join(__dirname, '../../storage/crops');

if (!fs.existsSync(CROPS_DIR)) {
  fs.mkdirSync(CROPS_DIR, { recursive: true });
}

export type ReidCropUploadedCallback = (detection: any) => void;
let onReidCropUploadedCallback: ReidCropUploadedCallback | null = null;

export function registerOnReidCropUploaded(cb: ReidCropUploadedCallback) {
  onReidCropUploadedCallback = cb;
}

/**
 * POST /api/reid/devices/:deviceId/crop
 * Edge device uploads a cropped person JPEG frame
 */
export async function handleCropUpload(req: Request, res: Response) {
  const { deviceId } = req.params;
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

      // Get device info to get cameraName
      const device = await prisma.edgeDevice.findUnique({ where: { deviceId } });
      const cameraName = device ? device.name : 'Unknown Camera';

      // 1. Generate OSNet 512-d Embedding
      console.log(`[ReID Router] Running OSNet embedding extraction for ${filename}...`);
      const vector = await reidWorker.generateEmbedding(filepath);

      // 2. Save metadata to MongoDB
      const detection = await prisma.reidDetection.create({
        data: {
          deviceId,
          cameraName,
          trackId,
          timestamp,
          filename,
          bbox,
          className,
        }
      });

      // 3. Upsert into Qdrant reid_embeddings collection
      await upsertReidVector(detection.id, vector, {
        deviceId,
        cameraName,
        trackId,
        timestamp: timestamp.toISOString(),
        filename,
        bbox,
        className,
      });

      console.log(`[ReID Router] Successfully processed ReID crop for device ${deviceId}, track ${trackId}`);
      res.status(200).json({ success: true, detectionId: detection.id });

      // Notify UI clients
      if (onReidCropUploadedCallback) {
        onReidCropUploadedCallback(detection);
      }
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
    const detections = await prisma.reidDetection.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    res.json(detections);
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

    res.json({ success: true, message: 'Detection deleted successfully' });
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
    const routes = await prisma.topologyRoute.findMany();
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
  const { fromCamera, toCamera, minTimeSeconds, maxTimeSeconds, topologyScore } = req.body;

  if (!fromCamera || !toCamera) {
    return res.status(400).json({ error: 'fromCamera and toCamera are required' });
  }

  try {
    // Check if route exists between these two cameras (bi-directional check)
    const existing = await prisma.topologyRoute.findFirst({
      where: {
        OR: [
          { fromCamera, toCamera },
          { fromCamera: toCamera, toCamera: fromCamera },
        ]
      }
    });

    let route;
    if (existing) {
      route = await prisma.topologyRoute.update({
        where: { id: existing.id },
        data: {
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
          minTimeSeconds: parseFloat(minTimeSeconds),
          maxTimeSeconds: parseFloat(maxTimeSeconds),
          topologyScore: parseFloat(topologyScore || '1.0'),
        }
      });
    }

    res.json(route);
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
    // 1. Fetch query crop details from MongoDB
    const queryDetection = await prisma.reidDetection.findUnique({ where: { id: detectionId } });
    if (!queryDetection) {
      return res.status(404).json({ error: `Detection ${detectionId} not found in database.` });
    }

    // 2. Fetch the corresponding vector from Qdrant by converting MongoDB ID to Qdrant UUID
    const { QdrantClient } = require('@qdrant/js-client-rest');
    const qdrant = new QdrantClient({
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
    });
    const { mongoIdToUuid } = require('../services/qdrant');
    const qdrantId = mongoIdToUuid(detectionId);

    const point = await qdrant.retrieve('reid_embeddings', { ids: [qdrantId], with_vector: true });
    if (!point || point.length === 0 || !point[0].vector) {
      return res.status(404).json({ error: `Vector embedding not found in Qdrant for detection ${detectionId}.` });
    }

    const queryVector = point[0].vector as number[];

    // 3. Search Qdrant for closest ReID neighbors
    const candidates = await searchReidVectors(queryVector, limit + 5);

    // 4. Load topology routes to calculate topological and time scores
    const topologyRoutes = await prisma.topologyRoute.findMany();

    const tq = new Date(queryDetection.timestamp).getTime();
    const Cq = queryDetection.cameraName;

    const scoredMatches = [];

    for (const cand of candidates) {
      const payload = cand.payload as any;
      if (!payload || payload.mongoId === detectionId) {
        continue; // Skip self
      }

      const tc = new Date(payload.timestamp).getTime();
      const Cc = payload.cameraName;
      const deltaTime = Math.abs(tq - tc) / 1000; // time diff in seconds

      let timeScore = 0.5; // default moderate score
      let topologyScore = 0.5; // default moderate score
      let isValidTransition = true;

      // Find route config bi-directionally
      const route = topologyRoutes.find(r => 
        (r.fromCamera === Cq && r.toCamera === Cc) || 
        (r.fromCamera === Cc && r.toCamera === Cq)
      );

      if (route) {
        topologyScore = route.topologyScore;

        if (deltaTime < route.minTimeSeconds) {
          // Impossible speed: set score to 0 and flag as invalid
          timeScore = 0.0;
          isValidTransition = false;
        } else if (deltaTime >= route.minTimeSeconds && deltaTime <= route.maxTimeSeconds) {
          // Normal/valid travel time range: score decays linearly from 1.0 to 0.2
          const span = route.maxTimeSeconds - route.minTimeSeconds;
          timeScore = span > 0 
            ? 1.0 - 0.8 * ((deltaTime - route.minTimeSeconds) / span)
            : 1.0;
        } else {
          // Too long ago: exponential decay after max time
          timeScore = 0.2 * Math.exp(-(deltaTime - route.maxTimeSeconds) / 600);
        }
      } else {
        // No topology route configured between these cameras
        if (Cq === Cc) {
          // Same camera: higher topology default, decay over time
          topologyScore = 0.8;
          timeScore = Math.exp(-deltaTime / 300); // decays over 5 mins
        } else {
          // Different cameras: lower baseline topology
          topologyScore = 0.2;
          // Apply general walk decay (assume min 10s to walk between general cams)
          if (deltaTime < 10) {
            timeScore = 0.1; // unlikely to hop cams in < 10s
          } else {
            timeScore = Math.exp(-(deltaTime - 10) / 600); // decays over 10 mins
          }
        }
      }

      // Final Score = 0.6 * vector_similarity + 0.2 * time_score + 0.2 * camera_topology_score
      const vectorSimilarity = cand.score; // cosine similarity score from Qdrant
      const finalScore = (0.6 * vectorSimilarity) + (0.2 * timeScore) + (0.2 * topologyScore);

      // Only include candidate if it's a physically possible transition
      if (isValidTransition && finalScore >= 0.3) {
        scoredMatches.push({
          id: payload.mongoId,
          deviceId: payload.deviceId,
          cameraName: payload.cameraName,
          trackId: payload.trackId,
          timestamp: payload.timestamp,
          filename: payload.filename,
          bbox: payload.bbox,
          className: payload.className,
          scores: {
            vectorSimilarity,
            timeScore,
            topologyScore,
            finalScore,
          }
        });
      }
    }

    // Sort by final score descending
    scoredMatches.sort((a, b) => b.scores.finalScore - a.scores.finalScore);

    res.json({
      query: queryDetection,
      matches: scoredMatches.slice(0, limit)
    });

  } catch (err: any) {
    console.error('[ReID Match Error]', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
