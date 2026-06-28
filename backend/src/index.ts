import express from 'express';
import cors from 'cors';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import clipsRouter, { registerOnClipDeleted } from './routes/clips';
import ragRouter from './routes/rag';
import devicesRouter, {
  registerOnClipUploaded,
  registerOnClipMetadata,
  registerOnClipMetadataUpdate,
  registerOnDevicesChanged,
  registerOnDeviceConfigUpdated,
  registerOnDeviceEventRecorded,
} from './routes/devices';
import streamsRouter, { registerOnStreamsUpdated } from './routes/streams';
import { buildConfigurePayload } from './services/edgeConfig';
import reidRouter, { registerOnReidCropUploaded, registerOnReidCropDeleted, CROPS_DIR, processReidTrackEventsFromClip, ReidTrackEvent } from './routes/reid';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import orgsRouter from './routes/orgs';
import notificationsRouter from './routes/notifications';
import alertRulesRouter from './routes/alertRules';
import { requireAuth } from './middleware/auth';
import { bootstrapMultiOrg } from './services/bootstrap';
import { getDeviceOrgId } from './services/orgScope';
import { trackEvent, shutdownPostHog } from './services/posthog';
import { getOrgSettings } from './services/orgSettings';
import { initQdrant } from './services/qdrant';
import { aggregateTrackEvents, enrichDetectedObjects, type ClipReidLog, type ClipReidLogEntry } from './services/clipDetections';
import { generateClipAiSummary, generateClipAiSummaryFromLocalFile } from './services/clipAiSummary';
import { buildYoloSummary, selectReidTrackEvents } from './services/yoloSummary';
import { extractYoloPreviewCrops } from './services/yoloCropExtract';
import { analyzeVehicleAppearancesFromClip, mergeAppearanceMaps } from './services/cropAppearance';
import { backfillDetectionClipLinks, linkDetectionsToClip } from './services/clipLink';
import { resolveCropImageBuffer } from './services/cropResolve';
import { resolveClipForDetection } from './services/reidClipResolve';
import { extractCropFromClip } from './services/reidClipExtract';
import { registerEdgeFileFetcher } from './services/edgeFileFetch';
import { backfillStreamTrackIdentities, cleanupEmptyIdentities } from './services/reidPeople';
import prisma from './services/db';
import { recordDeviceEventFromLogSafe, recordDeviceEventSafe, recordDeviceEvent } from './services/deviceEvents';
import { getEffectiveStreamStatus } from './services/deviceStatus';
import { initDeviceCommands, resolveDeviceCommandResponse } from './services/deviceCommands';
import { EDGE_DEVICE_CONFIG_DEFAULTS } from './config/edgeDeviceDefaults';
import { evaluateClipWithLLM, registerNotificationBroadcast } from './services/notificationService';
import { tryParseClipAiAnalysis } from './services/ai/clipAiAnalysis';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 5000;
const VIDEO_DIR = process.env.VIDEO_STORAGE_DIR || path.join(__dirname, '../storage/videos');
const LIVE_PREVIEW_ENABLED = EDGE_DEVICE_CONFIG_DEFAULTS.livePreviewEnabled;

// Ensure storage directories exist
if (!fs.existsSync(VIDEO_DIR)) {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
}
if (!fs.existsSync(CROPS_DIR)) {
  fs.mkdirSync(CROPS_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(requireAuth);

function resolveLocalClipPath(clip: { filepath: string; filename: string }): string | null {
  const candidates = [clip.filepath, path.join(VIDEO_DIR, clip.filename)];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }
  return null;
}

function edgeFileFetchTimeoutMs(filename: string): number {
  if (filename.startsWith('clip_') && filename.endsWith('.mp4')) {
    return 120_000;
  }
  return 30_000;
}

// Serve archived clips from cloud storage, or proxy from the edge device on demand
app.get('/api/videos/:filename', async (req, res) => {
  const { filename } = req.params;
  try {
    const clip = await prisma.videoClip.findFirst({
      where: { filename }
    });

    if (!clip || !clip.deviceId) {
      return res.status(404).json({ error: `Clip metadata not found for ${filename}` });
    }

    const localPath = resolveLocalClipPath(clip);
    if (localPath) {
      res.setHeader('Content-Type', 'video/mp4');
      return res.sendFile(localPath);
    }

    const deviceId = clip.deviceId;
    try {
      const result = await fetchFileFromEdge(deviceId, filename);
      res.setHeader('Content-Type', result.contentType);
      return res.send(result.data);
    } catch (error: any) {
      const message = error?.message || 'Failed to fetch clip from edge device';
      const status = message.includes('offline') ? 503 : message.includes('Timeout') ? 504 : 500;
      return res.status(status).json({ error: message });
    }
  } catch (error: any) {
    console.error(`[Video Proxy] Error fetching video ${filename}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Mount routes
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/orgs', orgsRouter);
app.use('/api/clips', clipsRouter);
app.use('/api/rag', ragRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/streams', streamsRouter);
app.use('/api/reid', reidRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/alert-rules', alertRulesRouter);

// Serve static frontend files
const FRONTEND_DIR = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(FRONTEND_DIR)) {
  console.log(`[Server] Serving static frontend files from ${FRONTEND_DIR}`);
  app.use(express.static(FRONTEND_DIR));

  // SPA routing fallback - serve index.html for any non-API routes
  app.get('*', (req, res, next) => {
    if (!req.path.startsWith('/api') && req.accepts('html')) {
      res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
    } else {
      next();
    }
  });
} else {
  console.log(`[Server] [Warning] Frontend build directory not found at: ${FRONTEND_DIR}. Running in API-only mode.`);
}

// WebSocket Maps
// Maps deviceId -> WebSocket connection
const activeDevices = new Map<string, WebSocket>();
// All connected UI WebSocket clients
const uiClients = new Set<WebSocket>();
// Maps UI WebSocket -> deviceId they are subscribed to
const uiSubscriptions = new Map<WebSocket, string>();
// Maps UI WebSocket -> streamId they are subscribed to
const uiStreamSubscriptions = new Map<WebSocket, string>();
// Maps streamId -> deviceId for routing device-level logs to stream subscribers
const streamDeviceCache = new Map<string, string>();

initDeviceCommands((deviceId) => activeDevices.get(deviceId));

// Inject WebSocket broadcast function into notification service
registerNotificationBroadcast((message: object) => {
  const payload = JSON.stringify(message);
  for (const ws of uiClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
});

function broadcastDevicesChanged() {
  const message = JSON.stringify({ type: 'devices_changed' });
  for (const ws of uiClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

registerOnDevicesChanged(() => {
  broadcastDevicesChanged();
});

registerOnDeviceEventRecorded((deviceId, event) => {
  broadcastToSubscribedUIs(deviceId, { type: 'device_event', deviceId, event });
});

function broadcastToSubscribedUIs(deviceId: string, data: any) {
  const message = JSON.stringify(data);
  const sent = new Set<WebSocket>();

  for (const [ws, subDeviceId] of uiSubscriptions.entries()) {
    if (subDeviceId === deviceId && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      sent.add(ws);
    }
  }

  // Device-level events (logs, clips, etc.) also reach stream subscribers on that device.
  for (const [ws, subStreamId] of uiStreamSubscriptions.entries()) {
    if (
      streamDeviceCache.get(subStreamId) === deviceId &&
      ws.readyState === WebSocket.OPEN &&
      !sent.has(ws)
    ) {
      ws.send(message);
      sent.add(ws);
    }
  }

  if (data.streamId) {
    for (const [ws, subStreamId] of uiStreamSubscriptions.entries()) {
      if (subStreamId === data.streamId && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }
}

function broadcastNewClipToAllUIs(clip: object, deviceId: string, streamId: string) {
  const message = JSON.stringify({ type: 'new_clip', clip, deviceId, streamId });
  for (const ws of uiClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

function broadcastLogToSubscribedUIs(deviceId: string, message: string, timestamp?: string) {
  console.log(`[Log - ${deviceId}] ${message}`);
  recordDeviceEventFromLogSafe(deviceId, message);
  const payload = {
    type: 'log',
    message,
    timestamp: timestamp || new Date().toISOString()
  };
  const payloadMessage = JSON.stringify(payload);
  const sent = new Set<WebSocket>();

  for (const [ws, subDeviceId] of uiSubscriptions.entries()) {
    if (subDeviceId === deviceId && ws.readyState === WebSocket.OPEN) {
      ws.send(payloadMessage);
      sent.add(ws);
    }
  }

  // Logs have no streamId; also deliver to stream subscribers on this device.
  for (const [ws, subStreamId] of uiStreamSubscriptions.entries()) {
    if (
      streamDeviceCache.get(subStreamId) === deviceId &&
      ws.readyState === WebSocket.OPEN &&
      !sent.has(ws)
    ) {
      ws.send(payloadMessage);
    }
  }
}

function requestPreviewForStream(streamId: string, reason: string) {
  if (!LIVE_PREVIEW_ENABLED) return;

  const deviceId = streamDeviceCache.get(streamId);
  if (!deviceId) return;

  const hasSubscribers = Array.from(uiStreamSubscriptions.values()).includes(streamId);
  if (!hasSubscribers) return;

  const deviceSocket = activeDevices.get(deviceId);
  if (!deviceSocket || deviceSocket.readyState !== WebSocket.OPEN) return;

  console.log(`[WS Hub] Requesting live preview for ${streamId} (${reason})`);
  deviceSocket.send(JSON.stringify({ type: 'toggle_stream', streamId, stream: true }));
}

function requestPreviewForDeviceSubscribers(deviceId: string, reason: string) {
  if (!LIVE_PREVIEW_ENABLED) return;

  const deviceSocket = activeDevices.get(deviceId);
  if (!deviceSocket || deviceSocket.readyState !== WebSocket.OPEN) return;

  for (const stream of streamDeviceCache.entries()) {
    const [streamId, ownerDeviceId] = stream;
    if (ownerDeviceId !== deviceId) continue;
    const hasSubscribers = Array.from(uiStreamSubscriptions.values()).includes(streamId);
    if (hasSubscribers) {
      console.log(`[WS Hub] Requesting live preview for ${streamId} (${reason})`);
      deviceSocket.send(JSON.stringify({ type: 'toggle_stream', streamId, stream: true }));
    }
  }
}

async function pushDeviceConfigure(deviceId: string) {
  const [device, streams] = await Promise.all([
    prisma.edgeDevice.findUnique({ where: { deviceId } }),
    prisma.cameraStream.findMany({ where: { deviceId } }),
  ]);
  if (!device) return;

  for (const stream of streams) {
    streamDeviceCache.set(stream.streamId, deviceId);
  }

  const deviceSocket = activeDevices.get(deviceId);
  if (deviceSocket && deviceSocket.readyState === WebSocket.OPEN) {
    const payload = buildConfigurePayload(device, streams);
    console.log(
      `[WS Hub] Pushing configure command to edge device: ${deviceId} with ${streams.length} stream(s)`,
    );
    deviceSocket.send(JSON.stringify(payload));
  } else {
    console.log(`[WS Hub] Edge device ${deviceId} is currently offline. Config saved in DB.`);
  }
}

// Register callbacks for device/stream configuration changes
registerOnStreamsUpdated(pushDeviceConfigure);
registerOnDeviceConfigUpdated(pushDeviceConfigure);

function edgeClipFilepath(deviceId: string, filename: string): string {
  return `edge://${deviceId}/${filename}`;
}

registerOnClipMetadata(async (filename, timestamp, deviceId, duration, streamId, frameWidth, frameHeight) => {
  await processMotionClipMetadataInBackground(
    filename,
    timestamp,
    deviceId,
    duration,
    streamId,
    frameWidth,
    frameHeight,
  );
});

registerOnClipUploaded(async (filepath, filename, timestamp, deviceId, duration, streamId, trackEvents, frameWidth, frameHeight, reidProfiles) => {
  await processVideoClipInBackground(filepath, filename, timestamp, deviceId, duration, streamId, trackEvents, frameWidth, frameHeight, reidProfiles);
});

registerOnClipMetadataUpdate(async (deviceId, filename, streamId, trackEvents, reidProfiles, frameWidth, frameHeight) => {
  await processVideoClipMetadataUpdateInBackground(deviceId, filename, streamId, trackEvents, reidProfiles, frameWidth, frameHeight);
});

registerOnClipDeleted((deviceId, filename) => {
  const deviceSocket = activeDevices.get(deviceId);
  if (deviceSocket && deviceSocket.readyState === WebSocket.OPEN) {
    console.log(`[WS Hub] Requesting edge device ${deviceId} to delete clip: ${filename}`);
    deviceSocket.send(JSON.stringify({
      type: 'delete_clip_file',
      filename
    }));
  }
});

registerOnReidCropUploaded((detection) => {
  console.log(`[ReID Broadcast] Broadcasting crop detection for track ${detection.trackId} on ${detection.deviceId}`);
  broadcastToSubscribedUIs(detection.deviceId, {
    type: 'new_reid_crop',
    detection,
  });
});

registerOnReidCropDeleted((deviceId, filename) => {
  const deviceSocket = activeDevices.get(deviceId);
  if (deviceSocket && deviceSocket.readyState === WebSocket.OPEN) {
    console.log(`[WS Hub] Requesting edge device ${deviceId} to delete crop: ${filename}`);
    deviceSocket.send(JSON.stringify({
      type: 'delete_clip_file',
      filename,
    }));
  }
});

interface PendingStreamRequest {
  resolve: (value: { contentType: string; data: Buffer | string }) => void;
  reject: (reason: any) => void;
  timeout: NodeJS.Timeout;
  chunks?: Buffer[];
  contentType?: string;
  expectedSize?: number;
}

const pendingStreamRequests = new Map<string, PendingStreamRequest>();
let nextStreamRequestId = 0;

function clearPendingStreamRequest(requestId: string): void {
  const pending = pendingStreamRequests.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingStreamRequests.delete(requestId);
}

function resolvePendingStreamRequest(
  requestId: string,
  result: { contentType: string; data: Buffer | string },
): void {
  const pending = pendingStreamRequests.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingStreamRequests.delete(requestId);
  pending.resolve(result);
}

function rejectPendingStreamRequest(requestId: string, error: Error): void {
  const pending = pendingStreamRequests.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingStreamRequests.delete(requestId);
  pending.reject(error);
}

function fetchFileFromEdge(deviceId: string, filename: string): Promise<{ contentType: string; data: Buffer | string }> {
  const deviceSocket = activeDevices.get(deviceId);
  if (!deviceSocket || deviceSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(`Edge device ${deviceId} is offline`));
  }

  const requestId = `req_${Date.now()}_${nextStreamRequestId++}`;
  const timeoutMs = edgeFileFetchTimeoutMs(filename);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearPendingStreamRequest(requestId);
      reject(new Error(`Timeout waiting for file ${filename} from device`));
    }, timeoutMs);

    pendingStreamRequests.set(requestId, { resolve, reject, timeout });

    deviceSocket.send(JSON.stringify({
      type: 'request_stream_file',
      requestId,
      filename,
    }));
  });
}

registerEdgeFileFetcher(fetchFileFromEdge);

app.get('/api/crops/:filename', async (req, res) => {
  const { filename } = req.params;

  if (!filename.startsWith('crop_') || !filename.endsWith('.jpg')) {
    return res.status(400).json({ error: 'Invalid crop filename' });
  }

  try {
    const detection = await prisma.reidDetection.findFirst({ where: { filename } });
    if (!detection?.deviceId) {
      const localPath = path.join(CROPS_DIR, filename);
      if (fs.existsSync(localPath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        return res.sendFile(localPath);
      }
      
      // Parse crop filename: crop_{timestampMs}_{deviceId}_{trackId}.jpg
      const match = filename.match(/^crop_(\d+)_([^_]+)_(\d+)\.jpg$/);
      if (match) {
        const timestampMs = parseInt(match[1], 10);
        const deviceId = match[2];
        const trackId = parseInt(match[3], 10);
        
        try {
          const resolved = await resolveClipForDetection(undefined, new Date(timestampMs), filename, deviceId);
          if (resolved) {
            const clip = await prisma.videoClip.findFirst({ where: { filename: resolved.clipFilename } });
            if (clip) {
              const detectedObjects = (clip.detectedObjects || []) as any[];
              const obj = detectedObjects.find((o) => o.trackId === trackId);
              if (obj && obj.bbox) {
                await extractCropFromClip(
                  clip.filepath,
                  resolved.clipOffsetMs,
                  obj.bbox,
                  localPath,
                  undefined,
                  undefined
                );
                if (fs.existsSync(localPath)) {
                  res.setHeader('Content-Type', 'image/jpeg');
                  return res.sendFile(localPath);
                }
              }
            }
          }
        } catch (err: any) {
          console.warn(`[Crop Fallback] Failed lazy crop extraction for ${filename}:`, err.message);
        }
      }
      return res.status(404).json({ error: `Crop metadata not found for ${filename}` });
    }

    const buffer = await resolveCropImageBuffer(detection, fetchFileFromEdge);
    if (buffer) {
      res.setHeader('Content-Type', 'image/jpeg');
      return res.send(buffer);
    }

    return res.status(404).json({ error: `Crop image not found for ${filename}` });
  } catch (error: any) {
    console.error(`[Crop Proxy] Error fetching crop ${filename}:`, error);
    const status = error.message?.includes('offline') ? 503 : 500;
    res.status(status).json({ error: error.message });
  }
});

/**
 * Process motion clip metadata from edge (video stays on device until hub pulls it).
 */
async function processMotionClipMetadataInBackground(
  filename: string,
  timestamp: Date,
  deviceId: string,
  duration: number,
  streamId: string,
  frameWidth?: number,
  frameHeight?: number,
) {
  const stream = await prisma.cameraStream.findUnique({ where: { streamId } });
  const cameraName = stream?.name ?? 'Unknown Camera';
  const orgId = await getDeviceOrgId(deviceId);
  const orgSettings = orgId ? await getOrgSettings(orgId) : null;

  broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Motion clip recorded: ${filename}`);

  try {
    trackEvent(orgId || deviceId, 'process_motion_clip_metadata', {
      duration,
      cameraName,
      streamId,
    });

    const summary = orgSettings?.videoSummary !== false
      ? buildYoloSummary([], cameraName, duration, frameWidth, frameHeight)
      : '';

    const clipDb = await prisma.videoClip.create({
      data: {
        filepath: edgeClipFilepath(deviceId, filename),
        filename,
        timestamp,
        summary,
        duration: Number.isFinite(duration) && duration > 0 ? duration : 10.0,
        camera: cameraName,
        deviceId,
        streamId,
      },
    });

    broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Saved clip metadata with ID: ${clipDb.id}`);
    broadcastNewClipToAllUIs(clipDb, deviceId, streamId);

    let clipForNotifications = clipDb;

    if (
      orgSettings?.videoSummary !== false &&
      stream?.aiSummaryEnabled !== false
    ) {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Fetching clip from edge for AI summary...`);
      try {
        await generateClipAiSummary(clipDb.id);
        const refreshed = await prisma.videoClip.findUnique({ where: { id: clipDb.id } });
        if (refreshed) {
          clipForNotifications = refreshed;
        }
        broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] AI summary generated for clip ${filename}.`);
        broadcastNewClipToAllUIs(clipForNotifications, deviceId, streamId);
      } catch (err: any) {
        console.error(`[AI Summary] Edge fetch/summary failed for ${filename}:`, err);
        broadcastLogToSubscribedUIs(
          deviceId,
          `[${cameraName}] AI summary failed for ${filename}: ${err.message}`,
        );
      }
    } else if (stream?.aiSummaryEnabled === false) {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] AI summary generation disabled for this camera stream.`);
    }

    if (orgId && orgSettings?.notificationsEnabled !== false) {
      const aiSummaryRaw = (clipForNotifications as any).aiSummary as string | null | undefined;
      const parsedAi = tryParseClipAiAnalysis(aiSummaryRaw);

      void evaluateClipWithLLM({
        clipId: clipForNotifications.id,
        streamId,
        deviceId,
        orgId,
        cameraName,
        duration,
        aiSummary: aiSummaryRaw ?? null,
        objectCounts: {
          person: parsedAi?.objectCounts?.person ?? 0,
          vehicle: parsedAi?.objectCounts?.vehicle ?? 0,
        },
        identityLabels: [],
      }).catch((err: any) => {
        console.warn(`[Notifications] Clip evaluation failed for ${filename}:`, err.message);
      });
    }
  } catch (error: any) {
    console.error(`[Pipeline Error] Failed to process motion clip ${filename}:`, error);
    broadcastLogToSubscribedUIs(deviceId, `[Pipeline Error] Failed to process ${filename}: ${error.message}`);
  } finally {
    for (const ws of uiClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clip_processing_complete', streamId, deviceId }));
      }
    }
  }
}

/**
 * Upload to Gemini, fetch summary, generate vector embeddings, and save to MongoDB + Qdrant
 */
async function processVideoClipInBackground(
  filepath: string,
  filename: string,
  timestamp: Date,
  deviceId: string,
  duration: number = 10.0,
  streamId: string,
  trackEvents: ReidTrackEvent[] = [],
  frameWidth?: number,
  frameHeight?: number,
  reidProfiles?: any[],
) {
  // Merge ReID profiles/embeddings into trackEvents
  if (Array.isArray(reidProfiles) && reidProfiles.length > 0) {
    const profileByTrackId = new Map<number, any>();
    for (const p of reidProfiles) {
      if (p && typeof p.trackId === 'number') {
        profileByTrackId.set(p.trackId, p);
      }
    }
    for (const event of trackEvents) {
      const p = profileByTrackId.get(event.trackId);
      if (p && Array.isArray(p.embedding)) {
        event.embedding = p.embedding;
      }
    }
  }
  const stream = await prisma.cameraStream.findUnique({
    where: { streamId }
  });
  const cameraName = stream ? stream.name : 'Unknown Camera';

  await prisma.cameraStream.update({
    where: { streamId },
    data: { status: 'Processing' }
  });

  broadcastToSubscribedUIs(deviceId, { type: 'status', streamId, status: 'Processing' });
  broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Processing video clip: ${filename}...`);

  const orgId = await getDeviceOrgId(deviceId);
  const orgSettings = orgId ? await getOrgSettings(orgId) : null;

  try {
    trackEvent(orgId || deviceId, 'process_video_clip', {
      duration,
      cameraName,
      streamId,
      trackEventCount: trackEvents.length,
    });
    const reidFromClipPromise =
      orgSettings?.reidProcessing !== false && stream?.crossCameraReid !== false && trackEvents.length > 0
        ? processReidTrackEventsFromClip(
            filepath,
            deviceId,
            streamId,
            timestamp.getTime(),
            filename,
            trackEvents,
            frameWidth,
            frameHeight,
          )
        : Promise.resolve({ succeeded: 0, failures: [] as { trackId: number; error: string }[], appearances: new Map() });

    const vehicleAppearancePromise =
      orgSettings?.videoSummary !== false && trackEvents.length > 0
        ? analyzeVehicleAppearancesFromClip(filepath, trackEvents, frameWidth, frameHeight)
        : Promise.resolve(new Map());

    const [reidResult, vehicleAppearances] = await Promise.all([
      reidFromClipPromise,
      vehicleAppearancePromise,
    ]);
    const appearances = mergeAppearanceMaps(reidResult.appearances, vehicleAppearances);
    const reidCropsExtracted = reidResult.succeeded;
    const reidCandidateCount = selectReidTrackEvents(trackEvents).length;

    let summary = '';
    if (orgSettings?.videoSummary !== false) {
      summary = buildYoloSummary(
        trackEvents,
        cameraName,
        duration,
        frameWidth,
        frameHeight,
        appearances,
      );
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Motion summary generated for clip.`);
    } else {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Video summary disabled for this organization.`);
    }

    if (orgSettings?.reidProcessing === false && trackEvents.length > 0) {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] ReID processing disabled for this organization.`);
    } else if (stream?.crossCameraReid === false && trackEvents.length > 0) {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] ReID processing disabled for this camera stream.`);
    }

    const reidLogEntries: ClipReidLogEntry[] = [];
    if (orgSettings?.reidProcessing === false) {
      reidLogEntries.push({
        level: 'info',
        message: 'ReID processing is disabled in organization settings.',
      });
    }
    if (stream?.crossCameraReid === false) {
      reidLogEntries.push({
        level: 'info',
        message: 'ReID processing is disabled on this camera stream.',
      });
    }
    if (!stream?.trackingEnabled) {
      reidLogEntries.push({
        level: 'info',
        message: 'Object tracking was disabled on this camera stream when the clip was processed.',
      });
    }
    if (trackEvents.length === 0) {
      reidLogEntries.push({
        level: 'info',
        message: 'No track events were bundled with this clip. ReID requires a person or vehicle to be detected during clip analysis.',
      });
    } else if (reidCandidateCount === 0) {
      reidLogEntries.push({
        level: 'warn',
        message: `Clip included ${trackEvents.length} YOLO snapshot(s) but no ReID-ready track event with an edge embedding.`,
      });
    } else {
      reidLogEntries.push({
        level: 'info',
        message: `Edge bundled ${trackEvents.length} track event(s) (${reidCandidateCount} ReID candidate(s)).`,
      });
      for (const failure of reidResult.failures) {
        reidLogEntries.push({
          level: 'warn',
          message: `Track ${failure.trackId}: ReID profile creation failed — ${failure.error}`,
        });
      }
      if (reidCropsExtracted > 0) {
        reidLogEntries.push({
          level: 'info',
          message: `Stored ${reidCropsExtracted} edge ReID profile(s) from the clip.`,
        });
      } else if (reidResult.failures.length === 0) {
        reidLogEntries.push({
          level: 'warn',
          message: 'Track events were received but no ReID profiles could be created.',
        });
      }
    }

    const reidLog: ClipReidLog = {
      trackEventsReceived: trackEvents.length,
      cropsExtracted: reidCropsExtracted,
      trackingEnabled: stream?.trackingEnabled ?? false,
      entries: reidLogEntries,
    };

    if (trackEvents.length > 0) {
      if (reidCropsExtracted > 0) {
        broadcastLogToSubscribedUIs(
          deviceId,
          `[${cameraName}] Stored ${reidCropsExtracted} ReID profile(s) from clip ${filename}.`,
        );
      } else if (reidCandidateCount > 0) {
        broadcastLogToSubscribedUIs(
          deviceId,
          `[${cameraName}] ReID profile creation failed for ${reidCandidateCount} candidate(s) in ${filename}.`,
        );
      } else {
        broadcastLogToSubscribedUIs(
          deviceId,
          `[${cameraName}] Clip ${filename} had ${trackEvents.length} detection snapshot(s) but no ReID embeddings from the edge.`,
        );
      }
    }

    let yoloPreviewCrops = new Map<number, { cropFilename: string; clipOffsetMs: number; bbox: string }>();
    if (trackEvents.length > 0 && fs.existsSync(filepath)) {
      try {
        yoloPreviewCrops = await extractYoloPreviewCrops(
          filepath,
          deviceId,
          timestamp.getTime(),
          trackEvents,
          frameWidth,
          frameHeight,
        );
        if (yoloPreviewCrops.size > 0 && reidCropsExtracted < trackEvents.length) {
          broadcastLogToSubscribedUIs(
            deviceId,
            `[${cameraName}] Saved ${yoloPreviewCrops.size} YOLO preview crop(s) for clip ${filename}.`,
          );
        }
      } catch (err: any) {
        console.warn(`[YoloCrop] Preview crop extraction failed for ${filename}:`, err.message);
      }
    }

    const detectedObjects = trackEvents.length > 0
      ? enrichDetectedObjects(aggregateTrackEvents(trackEvents), trackEvents, appearances)
          .map((object) => {
            const crop = yoloPreviewCrops.get(object.trackId);
            if (!crop) return object;
            return {
              ...object,
              cropFilename: crop.cropFilename,
              clipOffsetMs: crop.clipOffsetMs,
              bbox: crop.bbox,
            };
          })
      : undefined;

    // 2. Save metadata to MongoDB via Prisma
    const clipDb = await prisma.videoClip.create({
      data: {
        filepath,
        filename,
        timestamp,
        summary,
        duration: Number.isFinite(duration) && duration > 0 ? duration : 10.0,
        camera: cameraName,
        deviceId: deviceId,
        streamId: streamId,
        detectedObjects: detectedObjects as object,
        reidLog: reidLog as object,
      }
    });
    await linkDetectionsToClip(clipDb.id, filename);
    broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Saved clip metadata to MongoDB with ID: ${clipDb.id}`);

    let clipForBroadcast = clipDb;
    if (
      orgSettings?.videoSummary !== false &&
      stream?.aiSummaryEnabled !== false &&
      fs.existsSync(filepath)
    ) {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Generating AI summary for motion clip...`);
      try {
        clipForBroadcast = await generateClipAiSummaryFromLocalFile(
          clipDb,
          filepath,
          orgId ?? undefined,
          orgSettings?.semanticSearch !== false,
        );
        broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] AI summary generated for clip ${filename}.`);
      } catch (err: any) {
        console.error(`[AI Summary] Auto-generation failed for ${filename}:`, err);
        broadcastLogToSubscribedUIs(
          deviceId,
          `[${cameraName}] AI summary generation failed for ${filename}: ${err.message}`,
        );
      }
    } else if (stream?.aiSummaryEnabled === false) {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] AI summary generation disabled for this camera stream.`);
    }

    if (orgSettings?.semanticSearch === false) {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Semantic search indexing disabled for this organization.`);
    }
    
    // Notify all UI clients — archive is global and may not have a device/stream subscription.
    broadcastNewClipToAllUIs(clipForBroadcast, deviceId, streamId);

    // --- Notification: LLM surveillance classifier ---
    if (orgId && orgSettings?.notificationsEnabled !== false) {
      const aiSummaryRaw = (clipForBroadcast as any).aiSummary as string | null | undefined;
      const parsedAi = tryParseClipAiAnalysis(aiSummaryRaw);

      // Resolve identity labels from ReID detections linked to this clip
      const reidDetections = await prisma.reidDetection.findMany({
        where: {
          OR: [{ clipId: clipForBroadcast.id }, { clipFilename: filename }],
          identityId: { not: null },
        },
        include: { identity: { select: { id: true, label: true, isWatchlisted: true } } },
      });

      const identityLabels = [...new Set(
        reidDetections
          .map(d => d.identity?.label)
          .filter((l): l is string => !!l),
      )];

      void evaluateClipWithLLM({
        clipId: clipForBroadcast.id,
        streamId,
        deviceId,
        orgId,
        cameraName,
        duration,
        aiSummary: aiSummaryRaw ?? null,
        objectCounts: {
          person: parsedAi?.objectCounts?.person ?? 0,
          vehicle: parsedAi?.objectCounts?.vehicle ?? 0,
        },
        identityLabels,
      }).catch((err: any) => {
        console.warn(`[Notifications] Clip evaluation failed for ${filename}:`, err.message);
      });
    }
  } catch (error: any) {
    console.error(`[Pipeline Error] Failed to process ${filename}:`, error);
    broadcastLogToSubscribedUIs(deviceId, `[Pipeline Error] Failed to process ${filename}: ${error.message}`);
  } finally {
    // Archive uploaded clip on the hub so playback works even when the edge is offline
    if (fs.existsSync(filepath)) {
      try {
        const archivePath = path.join(VIDEO_DIR, filename);
        fs.renameSync(filepath, archivePath);
        await prisma.videoClip.updateMany({
          where: { filename },
          data: { filepath: archivePath },
        });
        console.log(`[Cloud Hub] Archived clip for playback: ${archivePath}`);
      } catch (err: any) {
        console.error(`[Cloud Hub] Failed to archive clip ${filename}:`, err);
        try {
          fs.unlinkSync(filepath);
        } catch {
          // ignore cleanup failure
        }
      }
    }

    // Restore stream status
    const refreshedStream = await prisma.cameraStream.findUnique({ where: { streamId } });
    const isOnline = activeDevices.has(deviceId);
    const finalStatus = isOnline ? (refreshedStream?.trackingEnabled ? 'Monitoring' : 'Idle') : 'Offline';
    
    await prisma.cameraStream.update({
      where: { streamId },
      data: { status: finalStatus }
    });

    broadcastToSubscribedUIs(deviceId, { 
      type: 'status', 
      streamId,
      status: finalStatus 
    });

    // Fallback signal for UIs to refresh archive after processing ends (success or failure).
    for (const ws of uiClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clip_processing_complete', streamId, deviceId }));
      }
    }
  }
}

async function processVideoClipMetadataUpdateInBackground(
  deviceId: string,
  filename: string,
  streamId: string,
  trackEvents: ReidTrackEvent[] = [],
  reidProfiles?: any[],
  frameWidth?: number,
  frameHeight?: number,
) {
  // Merge ReID profiles/embeddings into trackEvents
  if (Array.isArray(reidProfiles) && reidProfiles.length > 0) {
    const profileByTrackId = new Map<number, any>();
    for (const p of reidProfiles) {
      if (p && typeof p.trackId === 'number') {
        profileByTrackId.set(p.trackId, p);
      }
    }
    for (const event of trackEvents) {
      const p = profileByTrackId.get(event.trackId);
      if (p && Array.isArray(p.embedding)) {
        event.embedding = p.embedding;
      }
    }
  }

  const existingClip = await prisma.videoClip.findFirst({
    where: { filename, deviceId }
  });

  if (!existingClip) {
    console.warn(`[Metadata Update] Clip record not found for filename: ${filename}, deviceId: ${deviceId}`);
    return;
  }

  const filepath = existingClip.filepath;
  const timestamp = existingClip.timestamp;
  const duration = existingClip.duration;

  const stream = await prisma.cameraStream.findUnique({
    where: { streamId }
  });
  const cameraName = stream ? stream.name : 'Unknown Camera';

  await prisma.cameraStream.update({
    where: { streamId },
    data: { status: 'Processing' }
  });

  broadcastToSubscribedUIs(deviceId, { type: 'status', streamId, status: 'Processing' });
  broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Processing metadata update for clip: ${filename}...`);

  const orgId = await getDeviceOrgId(deviceId);
  const orgSettings = orgId ? await getOrgSettings(orgId) : null;

  try {
    trackEvent(orgId || deviceId, 'process_video_clip_metadata_update', {
      duration,
      cameraName,
      streamId,
      trackEventCount: trackEvents.length,
    });

    const reidFromClipPromise =
      orgSettings?.reidProcessing !== false && stream?.crossCameraReid !== false && trackEvents.length > 0
        ? processReidTrackEventsFromClip(
            filepath,
            deviceId,
            streamId,
            timestamp.getTime(),
            filename,
            trackEvents,
            frameWidth,
            frameHeight,
          )
        : Promise.resolve({ succeeded: 0, failures: [] as { trackId: number; error: string }[], appearances: new Map() });

    const vehicleAppearancePromise =
      orgSettings?.videoSummary !== false && trackEvents.length > 0
        ? analyzeVehicleAppearancesFromClip(filepath, trackEvents, frameWidth, frameHeight)
        : Promise.resolve(new Map());

    const [reidResult, vehicleAppearances] = await Promise.all([
      reidFromClipPromise,
      vehicleAppearancePromise,
    ]);
    const appearances = mergeAppearanceMaps(reidResult.appearances, vehicleAppearances);
    const reidCropsExtracted = reidResult.succeeded;
    const reidCandidateCount = selectReidTrackEvents(trackEvents).length;

    let summary = '';
    if (orgSettings?.videoSummary !== false) {
      summary = buildYoloSummary(
        trackEvents,
        cameraName,
        duration,
        frameWidth,
        frameHeight,
        appearances,
      );
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Motion summary generated for clip.`);
    } else {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Video summary disabled for this organization.`);
    }

    if (orgSettings?.reidProcessing === false && trackEvents.length > 0) {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] ReID processing disabled for this organization.`);
    } else if (stream?.crossCameraReid === false && trackEvents.length > 0) {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] ReID processing disabled for this camera stream.`);
    }

    const reidLogEntries: ClipReidLogEntry[] = [];
    if (orgSettings?.reidProcessing === false) {
      reidLogEntries.push({
        level: 'info',
        message: 'ReID processing is disabled in organization settings.',
      });
    }
    if (stream?.crossCameraReid === false) {
      reidLogEntries.push({
        level: 'info',
        message: 'ReID processing is disabled on this camera stream.',
      });
    }
    if (!stream?.trackingEnabled) {
      reidLogEntries.push({
        level: 'info',
        message: 'Object tracking was disabled on this camera stream when the clip was processed.',
      });
    }
    if (trackEvents.length === 0) {
      reidLogEntries.push({
        level: 'info',
        message: 'No track events were bundled with this clip. ReID requires a person or vehicle to be detected during clip analysis.',
      });
    } else if (reidCandidateCount === 0) {
      reidLogEntries.push({
        level: 'warn',
        message: `Clip included ${trackEvents.length} YOLO snapshot(s) but no ReID-ready track event with an edge embedding.`,
      });
    } else {
      reidLogEntries.push({
        level: 'info',
        message: `Edge bundled ${trackEvents.length} track event(s) (${reidCandidateCount} ReID candidate(s)).`,
      });
      for (const failure of reidResult.failures) {
        reidLogEntries.push({
          level: 'warn',
          message: `Track ${failure.trackId}: ReID profile creation failed — ${failure.error}`,
        });
      }
      if (reidCropsExtracted > 0) {
        reidLogEntries.push({
          level: 'info',
          message: `Stored ${reidCropsExtracted} edge ReID profile(s) from the clip.`,
        });
      } else if (reidResult.failures.length === 0) {
        reidLogEntries.push({
          level: 'warn',
          message: 'Track events were received but no ReID profiles could be created.',
        });
      }
    }

    const reidLog: ClipReidLog = {
      trackEventsReceived: trackEvents.length,
      cropsExtracted: reidCropsExtracted,
      trackingEnabled: stream?.trackingEnabled ?? false,
      entries: reidLogEntries,
    };

    if (trackEvents.length > 0) {
      if (reidCropsExtracted > 0) {
        broadcastLogToSubscribedUIs(
          deviceId,
          `[${cameraName}] Stored ${reidCropsExtracted} ReID profile(s) from clip ${filename}.`,
        );
      } else if (reidCandidateCount > 0) {
        broadcastLogToSubscribedUIs(
          deviceId,
          `[${cameraName}] ReID profile creation failed for ${reidCandidateCount} candidate(s) in ${filename}.`,
        );
      } else {
        broadcastLogToSubscribedUIs(
          deviceId,
          `[${cameraName}] Clip ${filename} had ${trackEvents.length} detection snapshot(s) but no ReID embeddings from the edge.`,
        );
      }
    }

    let yoloPreviewCrops = new Map<number, { cropFilename: string; clipOffsetMs: number; bbox: string }>();
    if (trackEvents.length > 0 && fs.existsSync(filepath)) {
      try {
        yoloPreviewCrops = await extractYoloPreviewCrops(
          filepath,
          deviceId,
          timestamp.getTime(),
          trackEvents,
          frameWidth,
          frameHeight,
        );
        if (yoloPreviewCrops.size > 0 && reidCropsExtracted < trackEvents.length) {
          broadcastLogToSubscribedUIs(
            deviceId,
            `[${cameraName}] Saved ${yoloPreviewCrops.size} YOLO preview crop(s) for clip ${filename}.`,
          );
        }
      } catch (err: any) {
        console.warn(`[YoloCrop] Preview crop extraction failed for ${filename}:`, err.message);
      }
    }

    const detectedObjects = trackEvents.length > 0
      ? enrichDetectedObjects(aggregateTrackEvents(trackEvents), trackEvents, appearances)
          .map((object) => {
            const crop = yoloPreviewCrops.get(object.trackId);
            if (!crop) return object;
            return {
              ...object,
              cropFilename: crop.cropFilename,
              clipOffsetMs: crop.clipOffsetMs,
              bbox: crop.bbox,
            };
          })
      : undefined;

    // 2. Update metadata in MongoDB
    const clipDb = await prisma.videoClip.update({
      where: { id: existingClip.id },
      data: {
        summary,
        detectedObjects: detectedObjects as object,
        reidLog: reidLog as object,
      }
    });

    await linkDetectionsToClip(clipDb.id, filename);
    broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Updated clip metadata in MongoDB with ID: ${clipDb.id}`);

    let clipForBroadcast = clipDb;
    if (
      orgSettings?.videoSummary !== false &&
      stream?.aiSummaryEnabled !== false &&
      fs.existsSync(filepath)
    ) {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Generating AI summary for motion clip...`);
      try {
        clipForBroadcast = await generateClipAiSummaryFromLocalFile(
          clipDb,
          filepath,
          orgId ?? undefined,
          orgSettings?.semanticSearch !== false,
        );
        broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] AI summary generated for clip ${filename}.`);
      } catch (err: any) {
        console.error(`[AI Summary] Auto-generation failed for ${filename}:`, err);
        broadcastLogToSubscribedUIs(
          deviceId,
          `[${cameraName}] AI summary generation failed for ${filename}: ${err.message}`,
        );
      }
    } else if (stream?.aiSummaryEnabled === false) {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] AI summary generation disabled for this camera stream.`);
    }

    if (orgSettings?.semanticSearch === false) {
      broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Semantic search indexing disabled for this organization.`);
    }
    
    // Notify all UI clients
    broadcastNewClipToAllUIs(clipForBroadcast, deviceId, streamId);

    // --- Notification: LLM surveillance classifier ---
    if (orgId && orgSettings?.notificationsEnabled !== false) {
      const aiSummaryRaw = (clipForBroadcast as any).aiSummary as string | null | undefined;
      const parsedAi = tryParseClipAiAnalysis(aiSummaryRaw);

      // Resolve identity labels from ReID detections linked to this clip
      const reidDetections = await prisma.reidDetection.findMany({
        where: {
          OR: [{ clipId: clipForBroadcast.id }, { clipFilename: filename }],
          identityId: { not: null },
        },
        include: { identity: { select: { id: true, label: true, isWatchlisted: true } } },
      });

      const identityLabels = [...new Set(
        reidDetections
          .map(d => d.identity?.label)
          .filter((l): l is string => !!l),
      )];

      void evaluateClipWithLLM({
        clipId: clipForBroadcast.id,
        streamId,
        deviceId,
        orgId,
        cameraName,
        duration,
        aiSummary: aiSummaryRaw ?? null,
        objectCounts: {
          person: parsedAi?.objectCounts?.person ?? 0,
          vehicle: parsedAi?.objectCounts?.vehicle ?? 0,
        },
        identityLabels,
      }).catch((err: any) => {
        console.warn(`[Notifications] Clip evaluation failed for ${filename}:`, err.message);
      });
    }
  } catch (error: any) {
    console.error(`[Pipeline Error] Failed to process metadata update for ${filename}:`, error);
    broadcastLogToSubscribedUIs(deviceId, `[Pipeline Error] Failed to process metadata update for ${filename}: ${error.message}`);
  } finally {
    // Restore stream status
    const refreshedStream = await prisma.cameraStream.findUnique({ where: { streamId } });
    const isOnline = activeDevices.has(deviceId);
    const finalStatus = isOnline ? (refreshedStream?.trackingEnabled ? 'Monitoring' : 'Idle') : 'Offline';
    
    await prisma.cameraStream.update({
      where: { streamId },
      data: { status: finalStatus }
    });

    broadcastToSubscribedUIs(deviceId, { 
      type: 'status', 
      streamId,
      status: finalStatus 
    });

    // Fallback signal for UIs to refresh archive after processing ends (success or failure).
    for (const ws of uiClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clip_processing_complete', streamId, deviceId }));
      }
    }
  }
}

async function markEdgeDeviceOnline(deviceId: string): Promise<boolean> {
  const result = await prisma.edgeDevice.updateMany({
    where: { deviceId },
    data: { status: 'Online', lastHeartbeat: new Date() },
  });
  return result.count > 0;
}

async function markEdgeDeviceOffline(deviceId: string): Promise<void> {
  await prisma.edgeDevice.updateMany({
    where: { deviceId },
    data: { status: 'Offline' },
  });
}

// WebSocket Connections
wss.on('connection', async (ws: WebSocket, req) => {
  // Parse role and deviceId from query parameters
  const url = new URL(req.url || '', 'http://localhost');
  const role = url.searchParams.get('role') || 'ui';
  const deviceId = url.searchParams.get('deviceId');

  if (role === 'device') {
    if (!deviceId) {
      console.log('[WS] Rejected device connection: missing deviceId');
      ws.close(4000, 'Missing deviceId');
      return;
    }

    activeDevices.set(deviceId, ws);
    console.log(`[WS] Edge device connected: ${deviceId}. Online count: ${activeDevices.size}`);

    // Update device status and set all its streams to Idle/Monitoring initially
    const deviceKnown = await markEdgeDeviceOnline(deviceId);
    if (!deviceKnown) {
      console.warn(
        `[WS] Edge device ${deviceId} connected but is not registered. ` +
          'Closing connection — edge agent should POST /api/devices/register first.',
      );
      activeDevices.delete(deviceId);
      ws.close(4001, 'Device not registered');
      return;
    }

    const streams = await prisma.cameraStream.findMany({ where: { deviceId } });
    for (const stream of streams) {
      streamDeviceCache.set(stream.streamId, deviceId);
      const streamStatus = stream.trackingEnabled ? 'Monitoring' : 'Idle';
      await prisma.cameraStream.update({
        where: { streamId: stream.streamId },
        data: { status: streamStatus }
      });
      broadcastToSubscribedUIs(deviceId, { type: 'status', streamId: stream.streamId, status: streamStatus, cameraConfig: stream });
    }

    broadcastLogToSubscribedUIs(deviceId, `Edge device connected.`);
    broadcastDevicesChanged();

    // Re-sync stream config from DB on every connect/reconnect (edge may have missed configure while offline).
    if (ws.readyState === WebSocket.OPEN) {
      const device = await prisma.edgeDevice.findUnique({ where: { deviceId } });
      if (device) {
        const payload = buildConfigurePayload(device, streams);
        console.log(`[WS Hub] Syncing ${streams.length} stream config(s) to edge device: ${deviceId}`);
        ws.send(JSON.stringify(payload));
      }
    }

    // If there is already a UI client subscribed to any of the device's streams, toggle streaming for them
    setTimeout(() => {
      requestPreviewForDeviceSubscribers(deviceId, 'edge device connected');
    }, 1000);

    ws.on('message', async (messageData: string) => {
      try {
        const data = JSON.parse(messageData);
        switch (data.type) {
          case 'heartbeat':
            await markEdgeDeviceOnline(deviceId);
            break;
          case 'status_change':
            if (data.streamId) {
              const streamRow = await prisma.cameraStream.findUnique({ where: { streamId: data.streamId } });
              let reportedStatus = data.status as string;
              // Pipeline restarts call stop_stream_pipeline which reports Offline; ignore while device WS is up.
              if (reportedStatus === 'Offline' && activeDevices.has(deviceId)) {
                break;
              }
              // Edge may briefly report Recording/Monitoring with stale in-memory config after tracking was disabled in DB.
              if (
                streamRow &&
                !streamRow.trackingEnabled &&
                (reportedStatus === 'Recording' || reportedStatus === 'Monitoring')
              ) {
                reportedStatus = 'Idle';
              }
              await prisma.cameraStream.update({
                where: { streamId: data.streamId },
                data: { status: reportedStatus }
              });
              broadcastToSubscribedUIs(deviceId, { type: 'status', streamId: data.streamId, status: reportedStatus });

              // Pipeline restarts reset preview on the edge; re-enable if the UI is still watching.
              const previewStatuses = ['Idle', 'Monitoring', 'Recording'];
              if (previewStatuses.includes(reportedStatus)) {
                requestPreviewForStream(data.streamId, `pipeline status ${reportedStatus}`);
              }
            }
            break;
          case 'frame':
            broadcastToSubscribedUIs(deviceId, {
              type: 'frame',
              streamId: data.streamId,
              image: data.image
            });
            break;
          case 'preview_stall':
          case 'preview_resumed':
            if (data.streamId) {
              broadcastToSubscribedUIs(deviceId, {
                type: data.type,
                streamId: data.streamId,
                stalledForSec: data.stalledForSec,
              });
              if (data.type === 'preview_stall') {
                recordDeviceEventSafe({
                  deviceId,
                  streamId: data.streamId,
                  category: 'preview',
                  severity: 'warn',
                  eventType: 'preview_stall',
                  message: `Live preview stalled${data.stalledForSec ? ` for ${data.stalledForSec}s` : ''}`,
                  detail: { stalledForSec: data.stalledForSec },
                });
              }
            }
            break;
          case 'stream_error':
            if (data.streamId) {
              await prisma.cameraStream.update({
                where: { streamId: data.streamId },
                data: { status: 'Error' },
              });
              broadcastToSubscribedUIs(deviceId, {
                type: 'stream_error',
                streamId: data.streamId,
                errorType: data.errorType,
                message: data.message,
                retryInSec: data.retryInSec,
              });
              recordDeviceEventSafe({
                deviceId,
                streamId: data.streamId,
                category: 'camera',
                severity: 'error',
                eventType: data.errorType || 'camera_error',
                message: data.message || 'Camera stream error',
                detail: {
                  retryInSec: data.retryInSec,
                },
              });
            }
            break;
          case 'stream_error_cleared':
            if (data.streamId) {
              const streamRow = await prisma.cameraStream.findUnique({ where: { streamId: data.streamId } });
              const clearedStatus = streamRow?.trackingEnabled ? 'Monitoring' : 'Idle';
              await prisma.cameraStream.update({
                where: { streamId: data.streamId },
                data: { status: clearedStatus },
              });
              broadcastToSubscribedUIs(deviceId, {
                type: 'stream_error_cleared',
                streamId: data.streamId,
                status: clearedStatus,
              });
              recordDeviceEventSafe({
                deviceId,
                streamId: data.streamId,
                category: 'recovery',
                severity: 'info',
                eventType: 'camera_recovered',
                message: `Camera stream recovered (${clearedStatus})`,
                dedupeWindowMs: 30_000,
              });
            }
            break;
          case 'response_stream_file': {
            const { requestId, success, contentType, data: fileData, error } = data;
            if (!requestId) break;
            if (success) {
              const bufferOrString = contentType.startsWith('text/') || contentType === 'application/x-mpegURL'
                ? fileData
                : Buffer.from(fileData, 'base64');
              resolvePendingStreamRequest(requestId, { contentType, data: bufferOrString });
            } else {
              rejectPendingStreamRequest(requestId, new Error(error || 'Failed to fetch file from device'));
            }
            break;
          }
          case 'response_stream_file_begin': {
            const pending = pendingStreamRequests.get(data.requestId);
            if (!pending) break;
            pending.contentType = data.contentType || 'application/octet-stream';
            pending.expectedSize = typeof data.size === 'number' ? data.size : undefined;
            pending.chunks = [];
            break;
          }
          case 'response_stream_file_chunk': {
            const pending = pendingStreamRequests.get(data.requestId);
            if (!pending || !pending.chunks || !data.data) break;
            pending.chunks.push(Buffer.from(data.data, 'base64'));
            break;
          }
          case 'response_stream_file_end': {
            const { requestId, success, error } = data;
            const pending = pendingStreamRequests.get(requestId);
            if (!pending) break;
            if (!success) {
              rejectPendingStreamRequest(requestId, new Error(error || 'Failed to fetch file from device'));
              break;
            }
            const contentType = pending.contentType || 'application/octet-stream';
            const buffer = Buffer.concat(pending.chunks || []);
            resolvePendingStreamRequest(requestId, { contentType, data: buffer });
            break;
          }
          case 'device_event': {
            const { category, severity, eventType, message, detail, streamId } = data;
            if (!category || !severity || !eventType || !message) break;
            const event = await recordDeviceEvent({
              deviceId,
              streamId: streamId || null,
              category,
              severity,
              eventType,
              message,
              detail: detail ?? null,
            });
            if (event) {
              broadcastToSubscribedUIs(deviceId, { type: 'device_event', deviceId, event });
            }
            break;
          }
          case 'log':
            broadcastLogToSubscribedUIs(deviceId, data.message, data.timestamp);
            break;
          case 'response_device_command':
            resolveDeviceCommandResponse(data.requestId, data.success, data);
            break;
        }
      } catch (err) {
        console.error(`[WS Error - Device ${deviceId}]`, err);
      }
    });

    ws.on('close', async () => {
      activeDevices.delete(deviceId);
      console.log(`[WS] Edge device disconnected: ${deviceId}. Online count: ${activeDevices.size}`);

      await markEdgeDeviceOffline(deviceId);

      await prisma.cameraStream.updateMany({
        where: { deviceId },
        data: { status: 'Offline' }
      });

      const deviceStreams = await prisma.cameraStream.findMany({ where: { deviceId } });
      for (const stream of deviceStreams) {
        broadcastToSubscribedUIs(deviceId, { type: 'status', streamId: stream.streamId, status: 'Offline' });
      }

      broadcastLogToSubscribedUIs(deviceId, `Edge device disconnected.`);
      broadcastDevicesChanged();
    });

  } else {
    // UI connection
    uiClients.add(ws);
    console.log('[WS] UI client connected');

    ws.on('message', async (messageData: string) => {
      try {
        const data = JSON.parse(messageData);
        
        if (data.type === 'subscribe_device') {
          const targetDeviceId = data.deviceId;
          uiSubscriptions.set(ws, targetDeviceId);
          console.log(`[WS] UI client subscribed to device: ${targetDeviceId}`);

          // Send current status of all streams belonging to this device
          const streams = await prisma.cameraStream.findMany({ where: { deviceId: targetDeviceId } });
          const isOnline = activeDevices.has(targetDeviceId);

          for (const stream of streams) {
            const currentStatus = getEffectiveStreamStatus(
              stream.status || 'Offline',
              isOnline,
              stream.trackingEnabled,
            );
            ws.send(JSON.stringify({
              type: 'status',
              streamId: stream.streamId,
              status: currentStatus,
              cameraConfig: stream
            }));
          }
        } else if (data.type === 'unsubscribe_device') {
          uiSubscriptions.delete(ws);
        } else if (data.type === 'subscribe_stream') {
          const targetStreamId = data.streamId;
          uiStreamSubscriptions.set(ws, targetStreamId);
          console.log(`[WS] UI client subscribed to stream: ${targetStreamId}`);

          const stream = await prisma.cameraStream.findUnique({ where: { streamId: targetStreamId } });
          if (stream) {
            streamDeviceCache.set(targetStreamId, stream.deviceId);
            const isOnline = activeDevices.has(stream.deviceId);
            const currentStatus = getEffectiveStreamStatus(
              stream.status || 'Offline',
              isOnline,
              stream.trackingEnabled,
            );

            ws.send(JSON.stringify({
              type: 'status',
              streamId: targetStreamId,
              status: currentStatus,
              cameraConfig: stream
            }));

            // Notify edge device to start streaming this specific stream
            requestPreviewForStream(targetStreamId, 'UI subscribed to stream');
          }
        } else if (data.type === 'refresh_stream') {
          const targetStreamId = data.streamId;
          if (targetStreamId) {
            console.log(`[WS] UI client requested preview refresh for stream: ${targetStreamId}`);
            const stream = await prisma.cameraStream.findUnique({ where: { streamId: targetStreamId } });
            requestPreviewForStream(targetStreamId, 'UI preview refresh');
            if (stream) {
              broadcastLogToSubscribedUIs(
                stream.deviceId,
                `[${stream.name}] Live preview refresh requested from dashboard.`,
              );
            }
          }
        } else if (data.type === 'unsubscribe_stream') {
          const prevStreamId = uiStreamSubscriptions.get(ws);
          uiStreamSubscriptions.delete(ws);

          if (prevStreamId) {
            console.log(`[WS] UI client unsubscribed from stream: ${prevStreamId}`);
            // Stop streaming if no other UI client is subscribed to this stream
            const hasOtherSubscribers = Array.from(uiStreamSubscriptions.values()).includes(prevStreamId);
            if (!hasOtherSubscribers) {
              const stream = await prisma.cameraStream.findUnique({ where: { streamId: prevStreamId } });
              if (stream && LIVE_PREVIEW_ENABLED) {
                const deviceSocket = activeDevices.get(stream.deviceId);
                if (deviceSocket && deviceSocket.readyState === WebSocket.OPEN) {
                  deviceSocket.send(JSON.stringify({ type: 'toggle_stream', streamId: prevStreamId, stream: false }));
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('[WS Error - UI]', err);
      }
    });

    ws.on('close', () => {
      uiClients.delete(ws);
      uiSubscriptions.delete(ws);
      const prevStreamId = uiStreamSubscriptions.get(ws);
      uiStreamSubscriptions.delete(ws);
      console.log('[WS] UI client disconnected');

      if (prevStreamId) {
        const hasOtherSubscribers = Array.from(uiStreamSubscriptions.values()).includes(prevStreamId);
        if (!hasOtherSubscribers && LIVE_PREVIEW_ENABLED) {
          prisma.cameraStream.findUnique({ where: { streamId: prevStreamId } }).then((stream) => {
            if (stream) {
              const deviceSocket = activeDevices.get(stream.deviceId);
              if (deviceSocket && deviceSocket.readyState === WebSocket.OPEN) {
                deviceSocket.send(JSON.stringify({ type: 'toggle_stream', streamId: prevStreamId, stream: false }));
              }
            }
          }).catch(err => console.error('Error on close stream cleanup:', err));
        }
      }
    });
  }
});

// Graceful shutdown helper
async function shutdown() {
  console.log('[Server] Graceful shutdown initiated. Cleaning up...');

  // Shutdown PostHog
  console.log('[Server] Shutting down PostHog...');
  await shutdownPostHog();
  
  // Close all active WebSocket connections
  console.log('[Server] Closing WebSocket connections...');
  for (const ws of activeDevices.values()) {
    try { ws.terminate(); } catch (e) {}
  }
  for (const ws of uiSubscriptions.keys()) {
    try { ws.terminate(); } catch (e) {}
  }
  
  await new Promise<void>((resolve) => {
    wss.close(() => {
      console.log('[Server] WebSocket server closed.');
      resolve();
    });
  });

  // Close HTTP server
  console.log('[Server] Closing HTTP server...');
  if (typeof (server as any).closeAllConnections === 'function') {
    (server as any).closeAllConnections();
  }
  await new Promise<void>((resolve) => {
    server.close(() => {
      console.log('[Server] HTTP server closed.');
      resolve();
    });
  });

  // Disconnect database
  console.log('[Server] Disconnecting from database...');
  await prisma.$disconnect();
  
  console.log('[Server] Cleanup complete.');
}

// Signal handlers
process.on('SIGINT', async () => {
  console.log('[Server] SIGINT received.');
  await shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received.');
  await shutdown();
  process.exit(0);
});

process.once('SIGUSR2', async () => {
  console.log('[Server] SIGUSR2 received (nodemon restarting).');
  await shutdown();
  process.kill(process.pid, 'SIGUSR2');
});

server.listen(PORT, async () => {
  console.log(`[Server] Express listening on port ${PORT}`);

  await bootstrapMultiOrg();
  
  // Initialize Qdrant Collection
  await initQdrant();
  await backfillStreamTrackIdentities().catch(err => {
    console.error('Failed to backfill stream-track identities:', err);
  });
  await backfillDetectionClipLinks().catch(err => {
    console.error('Failed to backfill detection clip links:', err);
  });
  await cleanupEmptyIdentities().catch(err => {
    console.error('Failed to cleanup empty identities:', err);
  });

  // Set all devices and streams to Offline initially
  await prisma.edgeDevice.updateMany({
    data: { status: 'Offline' }
  });
  await prisma.cameraStream.updateMany({
    data: { status: 'Offline' }
  });

  // Backfill readAt: null for legacy/existing notifications to ensure Prisma counts them correctly
  try {
    await prisma.$runCommandRaw({
      update: "Notification",
      updates: [
        {
          q: { readAt: { $exists: false } },
          u: { $set: { readAt: null } },
          multi: true
        }
      ]
    });
  } catch (err: any) {
    console.error('[Startup] Failed to backfill notification readAt values:', err.message);
  }

  // Periodically check for inactive edge devices (heartbeat timeout every 15s)
  setInterval(async () => {
    const timeoutThreshold = new Date(Date.now() - 30000); // 30 seconds ago
    
    try {
      const staleDevices = await prisma.edgeDevice.findMany({
        where: {
          status: { not: 'Offline' },
          lastHeartbeat: { lt: timeoutThreshold }
        }
      });

      for (const device of staleDevices) {
        console.log(`[Heartbeat Check] Device ${device.name} (${device.deviceId}) heartbeat timeout. Marking Offline.`);
        
        await prisma.edgeDevice.update({
          where: { deviceId: device.deviceId },
          data: { status: 'Offline' }
        });

        await prisma.cameraStream.updateMany({
          where: { deviceId: device.deviceId },
          data: { status: 'Offline' }
        });

        // Clean up socket if exists in activeDevices
        const ws = activeDevices.get(device.deviceId);
        if (ws) {
          try {
            ws.terminate();
          } catch (e) {}
          activeDevices.delete(device.deviceId);
        }

        const streams = await prisma.cameraStream.findMany({ where: { deviceId: device.deviceId } });
        for (const stream of streams) {
          broadcastToSubscribedUIs(device.deviceId, { type: 'status', streamId: stream.streamId, status: 'Offline' });
        }
        broadcastLogToSubscribedUIs(device.deviceId, `Edge device heartbeat timed out. Marked Offline.`);
      }
    } catch (error) {
      console.error('[Heartbeat Check] Error checking stale devices:', error);
    }
  }, 15000);
});
