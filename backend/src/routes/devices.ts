import { Router, Request, Response } from 'express';
import Busboy from 'busboy';
import prisma from '../services/db';
import * as fs from 'fs';
import * as path from 'path';
import { handleCropUpload, ReidTrackEvent } from './reid';
import { sendDeviceCommand } from '../services/deviceCommands';
import { getEffectiveDeviceStatus } from '../services/deviceStatus';
import { assertDeviceInOrg } from '../services/orgScope';
import {
  getDeviceEvents,
  recordDeviceEvent,
  type DeviceEventCategory,
  type DeviceEventSeverity,
} from '../services/deviceEvents';
import {
  extractDeviceConfigPatch,
  mergeDeviceConfig,
  mergeDeviceConfigUpdate,
  withEffectiveDeviceConfig,
} from '../services/edgeConfig';
import {
  encryptWifiPassword,
  decryptWifiPassword,
  isWifiEncryptionConfigured,
} from '../services/wifiCredentials';

/**
 * Strip sensitive fields (wifiPasswordEncrypted) before sending device data to the frontend.
 * wifiSsid is safe — it's just the network name, not the credential.
 */
function sanitizeDeviceForClient<T extends { config?: Record<string, unknown> | null }>(device: T): T {
  if (!device.config) return device;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { wifiPasswordEncrypted: _stripped, ...safeConfig } = device.config as Record<string, unknown>;
  return { ...device, config: safeConfig };
}

const router = Router();
const VIDEO_DIR = process.env.VIDEO_STORAGE_DIR || path.join(__dirname, '../../storage/videos');

interface ClipUploadMeta {
  filename?: string;
  streamId?: string;
  duration?: number;
  frameWidth?: number;
  frameHeight?: number;
  clipStartMs?: number;
  trackEvents?: ReidTrackEvent[];
}

function finishClipUpload(
  res: Response,
  filepath: string,
  filename: string,
  deviceId: string,
  meta: ClipUploadMeta,
) {
  console.log(`[Cloud Hub] Upload finished and saved to ${filepath}`);
  res.status(200).json({ message: 'Upload successful', filename });

  const duration = meta.duration ?? 10.0;
  const timestamp = meta.clipStartMs ? new Date(meta.clipStartMs) : new Date();
  const streamId = meta.streamId || `${deviceId}_default`;
  const trackEvents = Array.isArray(meta.trackEvents) ? meta.trackEvents : [];

  if (onClipUploadedCallback) {
    onClipUploadedCallback(
      filepath,
      filename,
      timestamp,
      deviceId,
      duration,
      streamId,
      trackEvents,
      meta.frameWidth,
      meta.frameHeight,
    ).catch((err) => console.error(`[Cloud Hub] Error processing uploaded clip ${filename}:`, err));
  }
}

function handleRawClipUpload(
  req: Request,
  res: Response,
  deviceId: string,
  deviceName: string,
  tempDir: string,
) {
  const streamId = (req.headers['x-stream-id'] as string) || `${deviceId}_default`;
  const filename = (req.headers['x-filename'] as string) || `clip_${Date.now()}_${deviceId}.mp4`;
  const filepath = path.join(tempDir, filename);

  console.log(`[Cloud Hub] Receiving video file upload: ${filename} for device: ${deviceName}, stream: ${streamId}`);

  const fileStream = fs.createWriteStream(filepath);

  req.pipe(fileStream);

  fileStream.on('error', (err) => {
    console.error('[Cloud Hub] File stream error:', err);
    res.status(500).json({ error: 'File writing failed' });
  });

  fileStream.on('finish', () => {
    const durationHeader = req.headers['x-duration'];
    const duration = durationHeader ? parseFloat(String(durationHeader)) : undefined;

    const clipStartHeader = req.headers['x-clip-start-ms'] as string | undefined;
    const clipStartMs = clipStartHeader ? parseInt(clipStartHeader, 10) : undefined;

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

    finishClipUpload(res, filepath, filename, deviceId, {
      streamId,
      duration,
      clipStartMs,
      frameWidth,
      frameHeight,
      trackEvents,
    });
  });
}

function handleMultipartClipUpload(
  req: Request,
  res: Response,
  deviceId: string,
  deviceName: string,
  tempDir: string,
) {
  const busboy = Busboy({ headers: req.headers });
  let metadata: ClipUploadMeta = {};
  let filename = `clip_${Date.now()}_${deviceId}.mp4`;
  let filepath = '';
  let fileWritePromise: Promise<void> | null = null;
  let responded = false;

  const fail = (status: number, message: string) => {
    if (responded) return;
    responded = true;
    res.status(status).json({ error: message });
  };

  busboy.on('field', (name, value) => {
    if (name !== 'metadata') return;
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        metadata = parsed as ClipUploadMeta;
      }
    } catch (err) {
      console.warn('[Cloud Hub] Failed to parse clip upload metadata field:', err);
    }
  });

  busboy.on('file', (fieldname, file, info) => {
    if (fieldname !== 'video') {
      file.resume();
      return;
    }

    filename = metadata.filename || info.filename || filename;
    filepath = path.join(tempDir, filename);
    const streamId = metadata.streamId || `${deviceId}_default`;
    console.log(`[Cloud Hub] Receiving video file upload: ${filename} for device: ${deviceName}, stream: ${streamId}`);

    const fileStream = fs.createWriteStream(filepath);
    fileWritePromise = new Promise((resolve, reject) => {
      file.pipe(fileStream);
      fileStream.on('finish', () => resolve());
      fileStream.on('error', reject);
      file.on('error', reject);
    });
  });

  busboy.on('finish', async () => {
    if (responded) return;
    try {
      if (!fileWritePromise || !filepath) {
        fail(400, 'No video file in upload');
        return;
      }
      await fileWritePromise;
      responded = true;
      finishClipUpload(res, filepath, filename, deviceId, metadata);
    } catch (err) {
      console.error('[Cloud Hub] Multipart clip upload error:', err);
      fail(500, 'File writing failed');
    }
  });

  busboy.on('error', (err) => {
    console.error('[Cloud Hub] Busboy error:', err);
    fail(500, 'Upload parse failed');
  });

  req.pipe(busboy);
}

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
let onDeviceConfigUpdatedCallback: ((deviceId: string) => Promise<void>) | null = null;
let onDeviceEventRecordedCallback: ((deviceId: string, event: object) => void) | null = null;

export function registerOnClipUploaded(cb: ClipUploadCallback) {
  onClipUploadedCallback = cb;
}

export function registerOnDevicesChanged(cb: () => void) {
  onDevicesChangedCallback = cb;
}

export function registerOnDeviceConfigUpdated(cb: (deviceId: string) => Promise<void>) {
  onDeviceConfigUpdatedCallback = cb;
}

export function registerOnDeviceEventRecorded(cb: (deviceId: string, event: object) => void) {
  onDeviceEventRecordedCallback = cb;
}

export async function triggerDeviceConfigUpdated(deviceId: string) {
  if (onDeviceConfigUpdatedCallback) {
    try {
      await onDeviceConfigUpdatedCallback(deviceId);
    } catch (err) {
      console.error(`Error in onDeviceConfigUpdatedCallback for ${deviceId}:`, err);
    }
  }
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
    const sanitizedDevices = devices.map((device) =>
      sanitizeDeviceForClient({
        ...withEffectiveDeviceConfig(device),
        status: getEffectiveDeviceStatus(device.status, device.lastHeartbeat, now),
        wifiSsid: (device.config as Record<string, unknown> | null)?.wifiSsid ?? null,
        wifiConfigured: !!((device.config as Record<string, unknown> | null)?.wifiPasswordEncrypted),
      }),
    );

    res.json(sanitizedDevices);
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Failed to fetch edge devices' });
  }
});

/**
 * POST /api/devices/check-versions
 * Ask online edge devices to compare local vs remote git commits and refresh stored versions.
 */
router.post('/check-versions', async (req: Request, res: Response) => {
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const devices = await prisma.edgeDevice.findMany({
      where: { orgId: req.auth.orgId },
      orderBy: { lastHeartbeat: 'desc' },
    });

    const results = await Promise.allSettled(
      devices.map(async (device) => {
        try {
          const result = await sendDeviceCommand(device.deviceId, 'check_version', {}, 90000);
          const versionUpdate: { gitCommit?: string | null; remoteGitCommit?: string | null } = {};

          if (typeof result.gitCommit === 'string' && result.gitCommit.trim()) {
            versionUpdate.gitCommit = result.gitCommit.trim();
          }
          if (typeof result.remoteGitCommit === 'string' && result.remoteGitCommit.trim()) {
            versionUpdate.remoteGitCommit = result.remoteGitCommit.trim();
          }

          if (Object.keys(versionUpdate).length > 0) {
            await prisma.edgeDevice.update({
              where: { deviceId: device.deviceId },
              data: versionUpdate,
            });
          }

          return {
            deviceId: device.deviceId,
            checked: true,
            gitCommit: versionUpdate.gitCommit ?? device.gitCommit,
            remoteGitCommit: versionUpdate.remoteGitCommit ?? device.remoteGitCommit,
          };
        } catch (error: any) {
          return {
            deviceId: device.deviceId,
            checked: false,
            error: error.message || 'Version check failed',
          };
        }
      }),
    );

    notifyDevicesChanged();

    const checked = results.map((result) =>
      result.status === 'fulfilled' ? result.value : { checked: false, error: 'Version check failed' },
    );

    res.json({ checked });
  } catch (error) {
    console.error('Error checking device versions:', error);
    res.status(500).json({ error: 'Failed to check device versions' });
  }
});

/**
 * GET /api/devices/install-config
 * Optional hub settings for the edge install command (e.g. Tailscale auth key).
 */
router.get('/install-config', async (req: Request, res: Response) => {
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const tailscaleAuthKey = process.env.TAILSCALE_AUTH_KEY?.trim() || null;
  res.json({ tailscaleAuthKey });
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
    const cfg = device.config as Record<string, unknown> | null;

    res.json(sanitizeDeviceForClient({
      ...withEffectiveDeviceConfig(device),
      wifiSsid: cfg?.wifiSsid ?? null,
      wifiConfigured: !!(cfg?.wifiPasswordEncrypted),
    }));
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
  const {
    deviceId,
    name,
    enrollmentToken,
    status,
    gitCommit,
    remoteGitCommit,
  } = req.body;

  if (!deviceId || !name) {
    return res.status(400).json({ error: 'deviceId and name are required' });
  }

  try {
    const existing = await prisma.edgeDevice.findUnique({
      where: { deviceId },
      include: { org: { select: { slug: true } } },
    });

    let tokenOrgId: string | null = null;

    if (enrollmentToken) {
      const org = await prisma.organization.findUnique({
        where: { id: enrollmentToken },
        select: { id: true },
      });

      if (org) {
        tokenOrgId = org.id;
      } else {
        const tokenRecord = await prisma.deviceEnrollmentToken.findUnique({
          where: { token: enrollmentToken },
        });

        if (!tokenRecord) {
          return res.status(403).json({ error: 'Invalid enrollment token' });
        }

        if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
          return res.status(403).json({ error: 'Enrollment token has expired' });
        }

        tokenOrgId = tokenRecord.orgId;
      }
    }

    let orgId: string;
    if (existing?.orgId) {
      const isDefaultOrg = existing.org?.slug === 'default';
      if (tokenOrgId && (isDefaultOrg || existing.orgId === tokenOrgId)) {
        orgId = tokenOrgId;
      } else {
        orgId = existing.orgId;
      }
    } else if (tokenOrgId) {
      orgId = tokenOrgId;
    } else {
      return res.status(400).json({ error: 'enrollmentToken is required for new devices' });
    }

    const versionUpdate: { gitCommit?: string; remoteGitCommit?: string } = {};
    if (typeof gitCommit === 'string' && gitCommit.trim()) {
      versionUpdate.gitCommit = gitCommit.trim();
    }
    if (typeof remoteGitCommit === 'string' && remoteGitCommit.trim()) {
      versionUpdate.remoteGitCommit = remoteGitCommit.trim();
    }

    const device = await prisma.edgeDevice.upsert({
      where: { deviceId },
      update: {
        name,
        orgId,
        status: status || 'Idle',
        lastHeartbeat: new Date(),
        ...versionUpdate,
      },
      create: {
        deviceId,
        name,
        orgId,
        status: status || 'Idle',
        lastHeartbeat: new Date(),
        ...versionUpdate,
      },
    });

    const streams = await prisma.cameraStream.findMany({
      where: { deviceId },
    });

    console.log(`[Cloud Hub] Device registered/updated: ${name} (${deviceId}) with ${streams.length} stream(s)`);
    notifyDevicesChanged();
    res.json({ device, streams });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

/**
 * POST /api/devices/:deviceId/config
 * Update edge device runtime configuration (stored in DB; env on device is fallback)
 */
router.post('/:deviceId/config', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  const { name } = req.body;

  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const existing = await prisma.edgeDevice.findFirst({
      where: { deviceId, orgId: req.auth.orgId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const configPatch = extractDeviceConfigPatch(req.body);
    const updatedConfig = mergeDeviceConfigUpdate(existing.config, configPatch);

    const updatedDevice = await prisma.edgeDevice.update({
      where: { deviceId },
      data: {
        ...(name !== undefined ? { name: String(name) } : {}),
        config: updatedConfig,
      },
    });

    console.log(`[Cloud Hub] Device config updated for ${deviceId}`);
    await triggerDeviceConfigUpdated(deviceId);

    res.json({
      message: 'Device configuration updated successfully',
      device: withEffectiveDeviceConfig(updatedDevice),
      config: updatedDevice.config,
      effectiveConfig: mergeDeviceConfig(updatedDevice.config),
    });
  } catch (error) {
    console.error('Error updating device configuration:', error);
    res.status(500).json({ error: 'Failed to update device configuration' });
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
 * Edge device uploads a raw recorded video clip (multipart form or legacy raw stream)
 */
router.post('/:deviceId/upload', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  const contentType = req.headers['content-type'] || '';
  const tempDir = path.join(__dirname, '../../storage/temp');

  try {
    const device = await prisma.edgeDevice.findUnique({ where: { deviceId } });
    if (!device) {
      return res.status(404).json({ error: 'Device not found. Register first.' });
    }

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    if (contentType.includes('multipart/form-data')) {
      handleMultipartClipUpload(req, res, deviceId, device.name, tempDir);
      return;
    }

    handleRawClipUpload(req, res, deviceId, device.name, tempDir);
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
 * GET /api/devices/:deviceId/metrics
 * Fetch current host metrics (CPU, RAM, disk) from the edge device on demand
 */
router.get('/:deviceId/metrics', async (req: Request, res: Response) => {
  const { deviceId } = req.params;

  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (!(await assertDeviceInOrg(deviceId, req.auth.orgId))) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const result = await sendDeviceCommand(deviceId, 'fetch_metrics', {}, 20000);
    res.json({ metrics: result.metrics || null, message: result.message });
  } catch (error: any) {
    const status = error.message === 'Device is offline' ? 503 : 500;
    res.status(status).json({ error: error.message || 'Failed to fetch device metrics' });
  }
});

/**
 * POST /api/devices/:deviceId/report-event
 * Edge agent reports a durable device event (e.g. software update lifecycle).
 */
router.post('/:deviceId/report-event', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  const { category, severity, eventType, message, detail, streamId } = req.body ?? {};

  if (!category || !severity || !eventType || !message) {
    return res.status(400).json({ error: 'category, severity, eventType, and message are required' });
  }

  const allowedCategories: DeviceEventCategory[] = [
    'camera',
    'websocket',
    'device',
    'preview',
    'recovery',
    'update',
  ];
  const allowedSeverities: DeviceEventSeverity[] = ['info', 'warn', 'error'];

  if (!allowedCategories.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  if (!allowedSeverities.includes(severity)) {
    return res.status(400).json({ error: 'Invalid severity' });
  }

  try {
    const device = await prisma.edgeDevice.findUnique({ where: { deviceId } });
    if (!device) {
      return res.status(404).json({ error: 'Device not found. Register first.' });
    }

    const event = await recordDeviceEvent({
      deviceId,
      streamId: typeof streamId === 'string' ? streamId : null,
      orgId: device.orgId,
      category,
      severity,
      eventType: String(eventType),
      message: String(message),
      detail: detail ?? null,
    });

    if (event) {
      onDeviceEventRecordedCallback?.(deviceId, event);
    }

    res.json({ ok: true, recorded: !!event, event });
  } catch (error: any) {
    console.error(`[Devices] Failed to record event for ${deviceId}:`, error);
    res.status(500).json({ error: error.message || 'Failed to record device event' });
  }
});

/**
 * GET /api/devices/:deviceId/events
 * Fetch persisted network/connectivity events for debugging
 */
router.get('/:deviceId/events', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '100'), 10) || 100, 1), 500);
  const streamId = typeof req.query.streamId === 'string' ? req.query.streamId : undefined;
  const sinceRaw = typeof req.query.since === 'string' ? req.query.since : undefined;

  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (!(await assertDeviceInOrg(deviceId, req.auth.orgId))) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const since = sinceRaw ? new Date(sinceRaw) : undefined;
    if (since && Number.isNaN(since.getTime())) {
      return res.status(400).json({ error: 'Invalid since timestamp' });
    }

    const events = await getDeviceEvents(deviceId, {
      orgId: req.auth.orgId,
      limit,
      streamId,
      since,
    });
    res.json({ events });
  } catch (error: any) {
    console.error(`[Devices] Failed to fetch events for ${deviceId}:`, error);
    res.status(500).json({ error: error.message || 'Failed to fetch device events' });
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


/**
 * POST /api/devices/:deviceId/command/set-wifi
 * Store encrypted WiFi credentials and push them to the online edge device.
 * The plaintext password is ONLY sent in-flight over the WebSocket; it is
 * stored encrypted (AES-256-GCM) in the database.
 * The decrypted password is NEVER returned to the frontend.
 */
router.post('/:deviceId/command/set-wifi', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  const { ssid, password } = req.body as { ssid?: string; password?: string };

  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!ssid || typeof ssid !== 'string' || ssid.trim().length === 0) {
    return res.status(400).json({ error: 'ssid is required' });
  }
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'password is required' });
  }

  try {
    const device = await prisma.edgeDevice.findFirst({
      where: { deviceId, orgId: req.auth.orgId },
    });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Encrypt and store credentials
    if (!isWifiEncryptionConfigured()) {
      console.warn('[WiFi] WIFI_CREDENTIAL_SECRET not configured — credentials will not be persisted.');
    }

    const wifiPasswordEncrypted = isWifiEncryptionConfigured()
      ? encryptWifiPassword(password)
      : null;

    // Merge into device config (keep all other config fields)
    const existingConfig = (device.config ?? {}) as Record<string, unknown>;
    const updatedConfig = {
      ...existingConfig,
      wifiSsid: ssid.trim(),
      ...(wifiPasswordEncrypted ? { wifiPasswordEncrypted } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await prisma.edgeDevice.update({
      where: { deviceId },
      data: { config: updatedConfig },
    });

    console.log(`[WiFi] Stored credentials for device ${deviceId}, SSID: ${ssid}`);

    // Push credentials to the device over WebSocket (plaintext, in-flight only)
    let commandResult: { success?: boolean; message?: string; error?: string } = {};
    try {
      const result = await sendDeviceCommand(deviceId, 'set_wifi', { ssid: ssid.trim(), password }, 40000);
      commandResult = { success: true, message: result.message as string | undefined || `WiFi applied: ${ssid}` };
    } catch (cmdErr: unknown) {
      const errMsg = cmdErr instanceof Error ? cmdErr.message : String(cmdErr);
      if (errMsg === 'Device is offline') {
        // Offline is OK — credentials are stored, will apply on next reboot via AP config
        commandResult = {
          success: false,
          message: 'Device is offline. Credentials saved — the device will use them when next it boots.',
        };
      } else {
        commandResult = { success: false, message: errMsg };
      }
    }

    res.json({
      ok: true,
      ssid: ssid.trim(),
      credentialsSaved: !!wifiPasswordEncrypted,
      deviceOnline: commandResult.success !== false,
      message: commandResult.message,
    });
  } catch (error) {
    console.error('[WiFi] Error in set-wifi:', error);
    res.status(500).json({ error: 'Failed to configure WiFi' });
  }
});

/**
 * GET /api/devices/:deviceId/command/get-wifi-status
 * Ask the edge device for its current WiFi connection state.
 */
router.get('/:deviceId/command/get-wifi-status', async (req: Request, res: Response) => {
  const { deviceId } = req.params;
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (!(await assertDeviceInOrg(deviceId, req.auth.orgId))) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const result = await sendDeviceCommand(deviceId, 'get_wifi_status', {}, 15000);
    res.json(result);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const status = errMsg === 'Device is offline' ? 503 : 500;
    res.status(status).json({ error: errMsg || 'Failed to get WiFi status' });
  }
});

export default router;
