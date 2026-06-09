import { Router, Request, Response } from 'express';
import prisma from '../services/db';
import * as fs from 'fs';
import * as path from 'path';
import { handleCropUpload } from './reid';

const router = Router();
const VIDEO_DIR = process.env.VIDEO_STORAGE_DIR || path.join(__dirname, '../../storage/videos');

export type DeviceConfigCallback = (deviceId: string, config: any) => void;
export type ClipUploadCallback = (filepath: string, filename: string, timestamp: Date, deviceId: string, duration: number) => Promise<void>;

let onConfigUpdatedCallback: DeviceConfigCallback | null = null;
let onClipUploadedCallback: ClipUploadCallback | null = null;

export function registerOnConfigUpdated(cb: DeviceConfigCallback) {
  onConfigUpdatedCallback = cb;
}

export function registerOnClipUploaded(cb: ClipUploadCallback) {
  onClipUploadedCallback = cb;
}

/**
 * GET /api/devices
 * List all registered edge devices
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const devices = await prisma.edgeDevice.findMany({
      orderBy: { lastHeartbeat: 'desc' },
    });
    
    // Dynamically adjust status to Offline if the last heartbeat is older than 30 seconds
    const now = new Date();
    const threshold = 30000; // 30 seconds
    const sanitizedDevices = devices.map(device => {
      const isStale = now.getTime() - new Date(device.lastHeartbeat).getTime() > threshold;
      if (isStale && device.status !== 'Offline') {
        return { ...device, status: 'Offline' };
      }
      return device;
    });

    res.json(sanitizedDevices);
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Failed to fetch edge devices' });
  }
});

/**
 * GET /api/devices/:deviceId
 * Get details of a single device
 */
router.get('/:deviceId', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  try {
    const device = await prisma.edgeDevice.findUnique({
      where: { deviceId },
    });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    // Dynamically adjust status to Offline if the last heartbeat is older than 30 seconds
    const now = new Date();
    const threshold = 30000; // 30 seconds
    const isStale = now.getTime() - new Date(device.lastHeartbeat).getTime() > threshold;
    if (isStale && device.status !== 'Offline') {
      device.status = 'Offline';
    }

    res.json(device);
  } catch (error) {
    console.error('Error fetching device:', error);
    res.status(500).json({ error: 'Failed to fetch device details' });
  }
});

/**
 * POST /api/devices/register
 * Edge device registers/announces itself on boot
 */
router.post('/register', async (req: Request, res: Response) => {
  const { deviceId, name, cameraType, streamUrl, trackingEnabled, motionThreshold, pixelChangeThreshold, status, streamHost } = req.body;

  if (!deviceId || !name) {
    return res.status(400).json({ error: 'deviceId and name are required' });
  }

  try {
    // Check if device already exists. If it does, we preserve its trackingEnabled configuration and return it.
    // Otherwise we create a new edge device.
    const device = await prisma.edgeDevice.upsert({
      where: { deviceId },
      update: {
        name,
        status: status || 'Idle',
        lastHeartbeat: new Date(),
        ...(streamHost !== undefined ? { streamHost: String(streamHost) } : {}),
      },
      create: {
        deviceId,
        name,
        cameraType: cameraType || 'webcam',
        streamUrl: streamUrl || '0',
        trackingEnabled: trackingEnabled || false,
        status: status || 'Idle',
        motionThreshold: motionThreshold !== undefined ? Number(motionThreshold) : 25,
        pixelChangeThreshold: pixelChangeThreshold !== undefined ? Number(pixelChangeThreshold) : 0.02,
        detectPerson: true,
        detectVehicle: true,
        streamHost: streamHost ? String(streamHost) : '',
        lastHeartbeat: new Date(),
      },
    });

    console.log(`[Cloud Hub] Device registered/updated: ${name} (${deviceId})`);
    res.json(device);
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

/**
 * POST /api/devices/:deviceId/config
 * Update configuration of a device from the Admin UI
 */
router.post('/:deviceId/config', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  const { name, cameraType, streamUrl, trackingEnabled, motionThreshold, pixelChangeThreshold, detectPerson, detectVehicle } = req.body;

  try {
    const existing = await prisma.edgeDevice.findUnique({ where: { deviceId } });
    if (!existing) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const updatedDevice = await prisma.edgeDevice.update({
      where: { deviceId },
      data: {
        name: name !== undefined ? name : existing.name,
        cameraType: cameraType !== undefined ? cameraType : existing.cameraType,
        streamUrl: streamUrl !== undefined ? streamUrl : existing.streamUrl,
        trackingEnabled: trackingEnabled !== undefined ? trackingEnabled : existing.trackingEnabled,
        motionThreshold: motionThreshold !== undefined ? Number(motionThreshold) : existing.motionThreshold,
        pixelChangeThreshold: pixelChangeThreshold !== undefined ? Number(pixelChangeThreshold) : existing.pixelChangeThreshold,
        detectPerson: detectPerson !== undefined ? Boolean(detectPerson) : existing.detectPerson,
        detectVehicle: detectVehicle !== undefined ? Boolean(detectVehicle) : existing.detectVehicle,
      },
    });

    console.log(`[Cloud Hub] Configuration updated for device ${deviceId}. Triggering callback...`);

    // Notify the connected WS device of its configuration change
    if (onConfigUpdatedCallback) {
      onConfigUpdatedCallback(deviceId, updatedDevice);
    }

    res.json({ message: 'Configuration updated successfully', config: updatedDevice });
  } catch (error) {
    console.error('Error updating device config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

/**
 * DELETE /api/devices/:deviceId
 * Delete/Unregister a device
 */
router.delete('/:deviceId', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  try {
    await prisma.edgeDevice.delete({
      where: { deviceId },
    });
    console.log(`[Cloud Hub] Device unregistered: ${deviceId}`);
    res.json({ message: 'Device unregistered successfully' });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

/**
 * POST /api/devices/:deviceId/upload
 * Edge device uploads a raw recorded video clip
 */
router.post('/:deviceId/upload', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  const filename = req.headers['x-filename'] as string || `clip_${Date.now()}_${deviceId}.mp4`;
  const tempDir = path.join(__dirname, '../../storage/temp');
  const filepath = path.join(tempDir, filename);

  try {
    const device = await prisma.edgeDevice.findUnique({ where: { deviceId } });
    if (!device) {
      return res.status(404).json({ error: 'Device not found. Register first.' });
    }

    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    console.log(`[Cloud Hub] Receiving video file upload: ${filename} for device: ${device.name}`);

    const fileStream = fs.createWriteStream(filepath);
    
    req.pipe(fileStream);

    fileStream.on('error', (err) => {
      console.error('[Cloud Hub] File stream error:', err);
      res.status(500).json({ error: 'File writing failed' });
    });

    fileStream.on('finish', () => {
      console.log(`[Cloud Hub] Upload finished and saved to ${filepath}`);
      res.status(200).json({ message: 'Upload successful', filename });

      const durationHeader = req.headers['x-duration'];
      const duration = durationHeader ? parseFloat(String(durationHeader)) : 10.0;

      // Run background processing (Gemini pipelines, MongoDB, Qdrant) asynchronously
      if (onClipUploadedCallback) {
        onClipUploadedCallback(filepath, filename, new Date(), deviceId, duration)
          .catch((err) => console.error(`[Cloud Hub] Error processing uploaded clip ${filename}:`, err));
      }
    });
  } catch (error) {
    console.error('Error uploading clip:', error);
    res.status(500).json({ error: 'Failed to process file upload' });
  }
});

/**
 * POST /api/devices/:deviceId/reid/crop
 * Edge device uploads a cropped person JPEG frame
 */
router.post('/:deviceId/reid/crop', handleCropUpload);


export type StreamFileRequestHandler = (deviceId: string, filename: string) => Promise<{ contentType: string, data: Buffer | string }>;
let onStreamFileRequestCallback: StreamFileRequestHandler | null = null;

export function registerOnStreamFileRequest(cb: StreamFileRequestHandler) {
  onStreamFileRequestCallback = cb;
}

/**
 * GET /api/devices/:deviceId/stream/:filename
 * Proxy endpoint to pull HLS playlist/segments from edge device over WebSocket
 */
router.get('/:deviceId/stream/:filename', async (req: Request, res: Response) => {
  const { deviceId, filename } = req.params;

  if (!onStreamFileRequestCallback) {
    return res.status(500).json({ error: 'Stream proxy not initialized' });
  }

  try {
    const result = await onStreamFileRequestCallback(deviceId, filename);
    res.setHeader('Content-Type', result.contentType);
    res.send(result.data);
  } catch (error: any) {
    console.error(`[Stream Proxy] Error proxying ${filename} for ${deviceId}:`, error.message);
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
