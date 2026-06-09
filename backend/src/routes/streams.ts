import { Router, Request, Response } from 'express';
import prisma from '../services/db';

const router = Router();

export type StreamsUpdatedCallback = (deviceId: string) => Promise<void>;
let onStreamsUpdatedCallback: StreamsUpdatedCallback | null = null;

export function registerOnStreamsUpdated(cb: StreamsUpdatedCallback) {
  onStreamsUpdatedCallback = cb;
}

export async function triggerStreamsUpdated(deviceId: string) {
  if (onStreamsUpdatedCallback) {
    try {
      await onStreamsUpdatedCallback(deviceId);
    } catch (err) {
      console.error(`Error in onStreamsUpdatedCallback for ${deviceId}:`, err);
    }
  }
}

/**
 * GET /api/streams
 * Retrieve all camera streams
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const streams = await prisma.cameraStream.findMany({
      orderBy: { lastHeartbeat: 'desc' },
    });
    res.json(streams);
  } catch (error) {
    console.error('Error fetching streams:', error);
    res.status(500).json({ error: 'Failed to fetch camera streams' });
  }
});

/**
 * GET /api/devices/:deviceId/streams
 * Retrieve all streams for a specific device
 */
router.get('/device/:deviceId', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  try {
    const streams = await prisma.cameraStream.findMany({
      where: { deviceId },
      orderBy: { name: 'asc' },
    });
    res.json(streams);
  } catch (error) {
    console.error('Error fetching device streams:', error);
    res.status(500).json({ error: 'Failed to fetch device camera streams' });
  }
});

/**
 * POST /api/streams
 * Create a new camera stream for a device
 */
router.post('/', async (req: Request, res: Response) => {
  const {
    deviceId,
    name,
    cameraType,
    streamUrl,
    trackingEnabled,
    motionThreshold,
    pixelChangeThreshold,
    detectPerson,
    detectVehicle,
  } = req.body;

  if (!deviceId || !name) {
    return res.status(400).json({ error: 'deviceId and name are required' });
  }

  try {
    // Generate a unique stream ID
    const streamId = `${deviceId}_stream_${Date.now()}`;

    const newStream = await prisma.cameraStream.create({
      data: {
        streamId,
        deviceId,
        name,
        cameraType: cameraType || 'webcam',
        streamUrl: streamUrl || '0',
        trackingEnabled: trackingEnabled || false,
        status: 'Offline',
        motionThreshold: motionThreshold !== undefined ? Number(motionThreshold) : 25,
        pixelChangeThreshold: pixelChangeThreshold !== undefined ? Number(pixelChangeThreshold) : 0.02,
        detectPerson: detectPerson !== undefined ? Boolean(detectPerson) : true,
        detectVehicle: detectVehicle !== undefined ? Boolean(detectVehicle) : true,
        streamHost: '',
      },
    });

    console.log(`[Cloud Hub] Created stream ${streamId} for device ${deviceId}`);
    
    // Trigger callback to notify the connected edge device
    await triggerStreamsUpdated(deviceId);

    res.json(newStream);
  } catch (error) {
    console.error('Error creating camera stream:', error);
    res.status(500).json({ error: 'Failed to create camera stream' });
  }
});

/**
 * POST /api/streams/:streamId/config
 * Update configuration of a specific camera stream
 */
router.post('/:streamId/config', async (req: Request, res: Response) => {
  const { streamId } = req.params;
  const {
    name,
    cameraType,
    streamUrl,
    trackingEnabled,
    motionThreshold,
    pixelChangeThreshold,
    detectPerson,
    detectVehicle,
    status,
    streamHost,
  } = req.body;

  try {
    const existing = await prisma.cameraStream.findUnique({ where: { streamId } });
    if (!existing) {
      return res.status(404).json({ error: 'Camera stream not found' });
    }

    const updatedStream = await prisma.cameraStream.update({
      where: { streamId },
      data: {
        name: name !== undefined ? name : existing.name,
        cameraType: cameraType !== undefined ? cameraType : existing.cameraType,
        streamUrl: streamUrl !== undefined ? streamUrl : existing.streamUrl,
        trackingEnabled: trackingEnabled !== undefined ? trackingEnabled : existing.trackingEnabled,
        motionThreshold: motionThreshold !== undefined ? Number(motionThreshold) : existing.motionThreshold,
        pixelChangeThreshold: pixelChangeThreshold !== undefined ? Number(pixelChangeThreshold) : existing.pixelChangeThreshold,
        detectPerson: detectPerson !== undefined ? Boolean(detectPerson) : existing.detectPerson,
        detectVehicle: detectVehicle !== undefined ? Boolean(detectVehicle) : existing.detectVehicle,
        status: status !== undefined ? status : existing.status,
        streamHost: streamHost !== undefined ? streamHost : existing.streamHost,
      },
    });

    console.log(`[Cloud Hub] Config updated for stream ${streamId}`);

    // Notify the connected WS device
    await triggerStreamsUpdated(updatedStream.deviceId);

    res.json({ message: 'Stream configuration updated successfully', config: updatedStream });
  } catch (error) {
    console.error('Error updating stream configuration:', error);
    res.status(500).json({ error: 'Failed to update stream configuration' });
  }
});

/**
 * DELETE /api/streams/:streamId
 * Delete a camera stream
 */
router.delete('/:streamId', async (req: Request, res: Response) => {
  const { streamId } = req.params;

  try {
    const existing = await prisma.cameraStream.findUnique({ where: { streamId } });
    if (!existing) {
      return res.status(404).json({ error: 'Camera stream not found' });
    }

    await prisma.cameraStream.delete({ where: { streamId } });

    console.log(`[Cloud Hub] Deleted camera stream ${streamId}`);

    // Notify the connected WS device
    await triggerStreamsUpdated(existing.deviceId);

    res.json({ message: 'Camera stream deleted successfully' });
  } catch (error) {
    console.error('Error deleting camera stream:', error);
    res.status(500).json({ error: 'Failed to delete camera stream' });
  }
});

export type StreamFileRequestHandler = (deviceId: string, filename: string) => Promise<{ contentType: string, data: Buffer | string }>;
let onStreamFileRequestCallback: StreamFileRequestHandler | null = null;

export function registerOnStreamFileRequest(cb: StreamFileRequestHandler) {
  onStreamFileRequestCallback = cb;
}

/**
 * GET /api/streams/:streamId/stream/:filename
 * Proxy endpoint to pull HLS playlist/segments from edge device for a specific stream
 */
router.get('/:streamId/stream/:filename', async (req: Request, res: Response) => {
  const { streamId, filename } = req.params;

  if (!onStreamFileRequestCallback) {
    return res.status(500).json({ error: 'Stream proxy not initialized' });
  }

  try {
    const stream = await prisma.cameraStream.findUnique({ where: { streamId } });
    if (!stream) {
      return res.status(404).json({ error: 'Camera stream not found' });
    }

    const targetFilename = filename.startsWith('clip_') ? filename : `hls_${streamId}/${filename}`;
    const result = await onStreamFileRequestCallback(stream.deviceId, targetFilename);
    res.setHeader('Content-Type', result.contentType);
    res.send(result.data);
  } catch (error: any) {
    console.error(`[Stream Proxy] Error proxying ${filename} for stream ${streamId}:`, error.message);
    if (error.message.includes('offline')) {
      res.status(503).send(error.message);
    } else if (error.message.includes('Timeout') || error.message.includes('timeout')) {
      res.status(504).send(error.message);
    } else {
      res.status(404).send(error.message);
    }
  }
});

export default router;
