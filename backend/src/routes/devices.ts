import { Router, Request, Response } from 'express';
import prisma from '../services/db';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();
const VIDEO_DIR = process.env.VIDEO_STORAGE_DIR || path.join(__dirname, '../../storage/videos');

export type DeviceConfigCallback = (deviceId: string, config: any) => void;
export type ClipUploadCallback = (filepath: string, filename: string, timestamp: Date, deviceId: string) => Promise<void>;

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
    res.json(devices);
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
  const { deviceId, name, cameraType, streamUrl, enabled, motionThreshold, pixelChangeThreshold, status } = req.body;

  if (!deviceId || !name) {
    return res.status(400).json({ error: 'deviceId and name are required' });
  }

  try {
    // Check if device already exists. If it does, we preserve its enabled configuration and return it.
    // Otherwise we create a new edge device.
    const device = await prisma.edgeDevice.upsert({
      where: { deviceId },
      update: {
        name,
        status: status || 'Idle',
        lastHeartbeat: new Date(),
      },
      create: {
        deviceId,
        name,
        cameraType: cameraType || 'webcam',
        streamUrl: streamUrl || '0',
        enabled: enabled || false,
        status: status || 'Idle',
        motionThreshold: motionThreshold !== undefined ? Number(motionThreshold) : 25,
        pixelChangeThreshold: pixelChangeThreshold !== undefined ? Number(pixelChangeThreshold) : 0.02,
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
  const { name, cameraType, streamUrl, enabled, motionThreshold, pixelChangeThreshold } = req.body;

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
        enabled: enabled !== undefined ? enabled : existing.enabled,
        motionThreshold: motionThreshold !== undefined ? Number(motionThreshold) : existing.motionThreshold,
        pixelChangeThreshold: pixelChangeThreshold !== undefined ? Number(pixelChangeThreshold) : existing.pixelChangeThreshold,
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
  const filepath = path.join(VIDEO_DIR, filename);

  try {
    const device = await prisma.edgeDevice.findUnique({ where: { deviceId } });
    if (!device) {
      return res.status(404).json({ error: 'Device not found. Register first.' });
    }

    // Ensure video directory exists
    if (!fs.existsSync(VIDEO_DIR)) {
      fs.mkdirSync(VIDEO_DIR, { recursive: true });
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

      // Run background processing (Gemini pipelines, MongoDB, Qdrant) asynchronously
      if (onClipUploadedCallback) {
        onClipUploadedCallback(filepath, filename, new Date(), deviceId)
          .catch((err) => console.error(`[Cloud Hub] Error processing uploaded clip ${filename}:`, err));
      }
    });
  } catch (error) {
    console.error('Error uploading clip:', error);
    res.status(500).json({ error: 'Failed to process file upload' });
  }
});

export default router;
