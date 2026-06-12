import { Router, Request, Response } from 'express';
import prisma from '../services/db';
import * as fs from 'fs';
import * as path from 'path';
import { handleCropUpload, ReidTrackEvent } from './reid';
import { sendDeviceCommand } from '../services/deviceCommands';
import { getEffectiveDeviceStatus } from '../services/deviceStatus';
import { assertDeviceInOrg } from '../services/orgScope';

const router = Router();
const VIDEO_DIR = process.env.VIDEO_STORAGE_DIR || path.join(__dirname, '../../storage/videos');

export type ClipUploadCallback = (
  filepath: string,
  filename: string,
  timestamp: Date,
  deviceId: string,
  duration: number,
  streamId: string,
  trackEvents: ReidTrackEvent[],
  frameWidth?: number,
  frameHeight?: number,
) => Promise<void>;

let onClipUploadedCallback: ClipUploadCallback | null = null;
let onDevicesChangedCallback: (() => void) | null = null;

export function registerOnClipUploaded(cb: ClipUploadCallback) {
  onClipUploadedCallback = cb;
}

export function registerOnDevicesChanged(cb: () => void) {
  onDevicesChangedCallback = cb;
}

function notifyDevicesChanged() {
  onDevicesChangedCallback?.();
}

/**
 * GET /api/devices
 * List all registered edge devices
 */
router.get('/', async (req: Request, res: Response) => {
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const devices = await prisma.edgeDevice.findMany({
      where: { orgId: req.auth.orgId },
      orderBy: { lastHeartbeat: 'desc' },
    });
    
    const now = new Date();
    const sanitizedDevices = devices.map((device) => ({
      ...device,
      status: getEffectiveDeviceStatus(device.status, device.lastHeartbeat, now),
    }));

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
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const device = await prisma.edgeDevice.findFirst({
      where: { deviceId, orgId: req.auth.orgId },
    });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    device.status = getEffectiveDeviceStatus(device.status, device.lastHeartbeat);

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
  const { deviceId, name, enrollmentToken, cameraType, streamUrl, trackingEnabled, motionThreshold, pixelChangeThreshold, status } = req.body;

  if (!deviceId || !name) {
    return res.status(400).json({ error: 'deviceId and name are required' });
  }

  try {
    const existing = await prisma.edgeDevice.findUnique({ where: { deviceId } });
    let orgId = existing?.orgId ?? null;

    if (!orgId) {
      if (!enrollmentToken) {
        return res.status(400).json({ error: 'enrollmentToken is required for new devices' });
      }

      const tokenRecord = await prisma.deviceEnrollmentToken.findUnique({
        where: { token: enrollmentToken },
      });

      if (!tokenRecord) {
        return res.status(403).json({ error: 'Invalid enrollment token' });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        return res.status(403).json({ error: 'Enrollment token has expired' });
      }

      orgId = tokenRecord.orgId;
    }

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
        orgId: orgId!,
        status: status || 'Idle',
        lastHeartbeat: new Date(),
      },
    });

    // Auto-create default camera stream if none exist
    let streams = await prisma.cameraStream.findMany({
      where: { deviceId },
    });

    if (streams.length === 0) {
      const defaultStreamId = `${deviceId}_default`;
      const defaultStream = await prisma.cameraStream.create({
        data: {
          streamId: defaultStreamId,
          deviceId,
          name: 'Default Camera',
          cameraType: cameraType || 'webcam',
          streamUrl: streamUrl || '0',
          trackingEnabled: trackingEnabled || false,
          status: 'Offline',
          motionThreshold: motionThreshold !== undefined ? Number(motionThreshold) : 25,
          pixelChangeThreshold: pixelChangeThreshold !== undefined ? Number(pixelChangeThreshold) : 0.02,
          detectPerson: true,
          detectVehicle: true,
        },
      });
      streams = [defaultStream];
    }

    console.log(`[Cloud Hub] Device registered/updated: ${name} (${deviceId}) with ${streams.length} stream(s)`);
    notifyDevicesChanged();
    res.json({ device, streams });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

/**
 * DELETE /api/devices/:deviceId
 * Delete/Unregister a device
 */
router.delete('/:deviceId', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (!(await assertDeviceInOrg(deviceId, req.auth.orgId))) {
      return res.status(404).json({ error: 'Device not found' });
    }

    await prisma.cameraStream.deleteMany({
      where: { deviceId },
    });
    await prisma.edgeDevice.delete({
      where: { deviceId },
    });
    console.log(`[Cloud Hub] Device and its streams unregistered: ${deviceId}`);
    notifyDevicesChanged();
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
  const streamId = (req.headers['x-stream-id'] as string) || `${deviceId}_default`;
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

    console.log(`[Cloud Hub] Receiving video file upload: ${filename} for device: ${device.name}, stream: ${streamId}`);

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

      const clipStartHeader = req.headers['x-clip-start-ms'] as string | undefined;
      const timestamp = clipStartHeader ? new Date(parseInt(clipStartHeader, 10)) : new Date();

      const frameWidthHeader = req.headers['x-frame-width'] as string | undefined;
      const frameHeightHeader = req.headers['x-frame-height'] as string | undefined;
      const frameWidth = frameWidthHeader ? parseInt(frameWidthHeader, 10) : undefined;
      const frameHeight = frameHeightHeader ? parseInt(frameHeightHeader, 10) : undefined;

      let trackEvents: ReidTrackEvent[] = [];
      const trackEventsHeader = req.headers['x-track-events'] as string | undefined;
      if (trackEventsHeader) {
        try {
          const parsed = JSON.parse(trackEventsHeader);
          if (Array.isArray(parsed)) {
            trackEvents = parsed;
          }
        } catch (err) {
          console.warn('[Cloud Hub] Failed to parse x-track-events header:', err);
        }
      }

      // Run background processing (Gemini pipelines, MongoDB, Qdrant) asynchronously
      if (onClipUploadedCallback) {
        onClipUploadedCallback(
          filepath,
          filename,
          timestamp,
          deviceId,
          duration,
          streamId,
          trackEvents,
          frameWidth,
          frameHeight,
        ).catch((err) => console.error(`[Cloud Hub] Error processing uploaded clip ${filename}:`, err));
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

/**
 * POST /api/devices/:deviceId/command/reboot
 * Reboot the edge device (Raspberry Pi / host OS)
 */
router.post('/:deviceId/command/reboot', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (!(await assertDeviceInOrg(deviceId, req.auth.orgId))) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const result = await sendDeviceCommand(deviceId, 'reboot');
    res.json({ message: result.message || 'Reboot initiated', ...result });
  } catch (error: any) {
    const status = error.message === 'Device is offline' ? 503 : 500;
    res.status(status).json({ error: error.message || 'Failed to reboot device' });
  }
});

/**
 * POST /api/devices/:deviceId/command/update-service
 * Force git pull, refresh Python deps + systemd unit, then restart the edge agent on the device
 */
router.post('/:deviceId/command/update-service', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (!(await assertDeviceInOrg(deviceId, req.auth.orgId))) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const result = await sendDeviceCommand(deviceId, 'update_service', {}, 900000);
    res.json({ message: result.message || 'Update complete', ...result });
  } catch (error: any) {
    const status = error.message === 'Device is offline' ? 503 : 500;
    res.status(status).json({ error: error.message || 'Failed to update edge service' });
  }
});

/**
 * GET /api/devices/:deviceId/logs
 * Fetch recent journalctl logs from the edge device's aura-watch-edge service
 */
router.get('/:deviceId/logs', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  const lines = Math.min(Math.max(parseInt(String(req.query.lines || '200'), 10) || 200, 10), 2000);

  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (!(await assertDeviceInOrg(deviceId, req.auth.orgId))) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const result = await sendDeviceCommand(deviceId, 'fetch_logs', { lines }, 45000);
    res.json({ logs: result.logs || '', message: result.message });
  } catch (error: any) {
    const status = error.message === 'Device is offline' ? 503 : 500;
    res.status(status).json({ error: error.message || 'Failed to fetch device logs' });
  }
});



export default router;
