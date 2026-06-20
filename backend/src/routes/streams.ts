import { Router, Request, Response } from 'express';
import prisma from '../services/db';
import { assertDeviceInOrg } from '../services/orgScope';
import { STREAM_CONFIG_DEFAULTS } from '../services/edgeConfig';
import {
  getEffectiveStreamStatus,
  getOnlineDeviceIds,
  isDeviceOnline,
} from '../services/deviceStatus';

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
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const [streams, onlineDeviceIds] = await Promise.all([
      prisma.cameraStream.findMany({
        where: { device: { orgId: req.auth.orgId } },
        orderBy: { lastHeartbeat: 'desc' },
      }),
      getOnlineDeviceIds(),
    ]);
    const onlineSet = new Set(onlineDeviceIds);
    res.json(
      streams.map((stream) => ({
        ...stream,
        status: getEffectiveStreamStatus(
          stream.status,
          onlineSet.has(stream.deviceId),
          stream.trackingEnabled,
        ),
      })),
    );
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
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (!(await assertDeviceInOrg(deviceId, req.auth.orgId))) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const device = await prisma.edgeDevice.findUnique({
      where: { deviceId },
      select: { status: true, lastHeartbeat: true },
    });
    const deviceOnline = device
      ? isDeviceOnline(device.status, device.lastHeartbeat)
      : false;

    const streams = await prisma.cameraStream.findMany({
      where: { deviceId },
      orderBy: { name: 'asc' },
    });
    res.json(
      streams.map((stream) => ({
        ...stream,
        status: getEffectiveStreamStatus(
          stream.status,
          deviceOnline,
          stream.trackingEnabled,
        ),
      })),
    );
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

  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (!(await assertDeviceInOrg(deviceId, req.auth.orgId))) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const streamId = `${deviceId}_stream_${Date.now()}`;

    const newStream = await prisma.cameraStream.create({
      data: {
        streamId,
        deviceId,
        name,
        cameraType: cameraType || 'webcam',
        streamUrl: streamUrl || '0',
        trackingEnabled: trackingEnabled !== undefined ? Boolean(trackingEnabled) : STREAM_CONFIG_DEFAULTS.trackingEnabled,
        status: 'Offline',
        motionThreshold: motionThreshold !== undefined ? Number(motionThreshold) : STREAM_CONFIG_DEFAULTS.motionThreshold,
        pixelChangeThreshold: pixelChangeThreshold !== undefined ? Number(pixelChangeThreshold) : STREAM_CONFIG_DEFAULTS.pixelChangeThreshold,
        detectPerson: detectPerson !== undefined ? Boolean(detectPerson) : STREAM_CONFIG_DEFAULTS.detectPerson,
        detectVehicle: detectVehicle !== undefined ? Boolean(detectVehicle) : STREAM_CONFIG_DEFAULTS.detectVehicle,
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

  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const existing = await prisma.cameraStream.findUnique({
      where: { streamId },
      include: { device: { select: { orgId: true } } },
    });
    if (!existing || existing.device.orgId !== req.auth.orgId) {
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

    res.json({
      message: 'Stream configuration updated successfully',
      config: updatedStream,
    });
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

  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const existing = await prisma.cameraStream.findUnique({
      where: { streamId },
      include: { device: { select: { orgId: true } } },
    });
    if (!existing || existing.device.orgId !== req.auth.orgId) {
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

export default router;
