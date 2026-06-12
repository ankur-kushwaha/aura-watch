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
import devicesRouter, { registerOnClipUploaded, registerOnDevicesChanged } from './routes/devices';
import streamsRouter, { registerOnStreamsUpdated } from './routes/streams';
import reidRouter, { registerOnReidCropUploaded, registerOnReidCropDeleted, CROPS_DIR, processReidTrackEventsFromClip, ReidTrackEvent } from './routes/reid';
import authRouter from './routes/auth';
import orgsRouter from './routes/orgs';
import { requireAuth } from './middleware/auth';
import { bootstrapMultiOrg } from './services/bootstrap';
import { getDeviceOrgId } from './services/orgScope';
import { initQdrant, upsertClipVector } from './services/qdrant';
import { aggregateTrackEvents, type ClipReidLog, type ClipReidLogEntry } from './services/clipDetections';
import { backfillDetectionClipLinks, linkDetectionsToClip } from './services/clipLink';
import { resolveCropImageBuffer } from './services/cropResolve';
import { registerEdgeFileFetcher } from './services/edgeFileFetch';
import { backfillStreamTrackIdentities, cleanupEmptyIdentities } from './services/reidPeople';
import { summarizeVideo, generateTextEmbedding } from './services/ai';
import { transcodeForGemini } from './services/videoTranscode';
import prisma from './services/db';
import { initDeviceCommands, resolveDeviceCommandResponse } from './services/deviceCommands';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 5000;
const VIDEO_DIR = process.env.VIDEO_STORAGE_DIR || path.join(__dirname, '../storage/videos');

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

// Serve static videos or proxy them from the edge device
app.get('/api/videos/:filename', async (req, res) => {
  const { filename } = req.params;
  try {
    const clip = await prisma.videoClip.findFirst({
      where: { filename }
    });

    if (!clip || !clip.deviceId) {
      return res.status(404).json({ error: `Clip metadata not found for ${filename}` });
    }

    const deviceId = clip.deviceId;
    const deviceSocket = activeDevices.get(deviceId);
    if (!deviceSocket || deviceSocket.readyState !== WebSocket.OPEN) {
      return res.status(503).json({ error: `Edge device ${deviceId} is offline` });
    }

    const requestId = `req_${Date.now()}_${nextStreamRequestId++}`;
    
    // 15 seconds timeout
    const timeout = setTimeout(() => {
      pendingStreamRequests.delete(requestId);
      res.status(504).json({ error: `Timeout waiting for clip file ${filename} from device` });
    }, 15000);

    pendingStreamRequests.set(requestId, {
      resolve: (result) => {
        clearTimeout(timeout);
        res.setHeader('Content-Type', result.contentType);
        res.send(result.data);
      },
      reject: (err) => {
        clearTimeout(timeout);
        res.status(500).json({ error: err.message });
      },
      timeout
    });

    deviceSocket.send(JSON.stringify({
      type: 'request_stream_file',
      requestId,
      filename
    }));
  } catch (error: any) {
    console.error(`[Video Proxy] Error fetching video ${filename}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Mount routes
app.use('/api/auth', authRouter);
app.use('/api/orgs', orgsRouter);
app.use('/api/clips', clipsRouter);
app.use('/api/rag', ragRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/streams', streamsRouter);
app.use('/api/reid', reidRouter);

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

function broadcastLogToSubscribedUIs(deviceId: string, message: string) {
  console.log(`[Log - ${deviceId}] ${message}`);
  const payload = {
    type: 'log',
    message,
    timestamp: new Date().toISOString()
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

// Register callbacks for stream configuration changes
registerOnStreamsUpdated(async (deviceId) => {
  const streams = await prisma.cameraStream.findMany({ where: { deviceId } });
  for (const stream of streams) {
    streamDeviceCache.set(stream.streamId, deviceId);
  }

  const deviceSocket = activeDevices.get(deviceId);
  if (deviceSocket && deviceSocket.readyState === WebSocket.OPEN) {
    console.log(`[WS Hub] Pushing configure command to edge device: ${deviceId} with ${streams.length} stream(s)`);
    deviceSocket.send(JSON.stringify({ type: 'configure', streams }));
  } else {
    console.log(`[WS Hub] Edge device ${deviceId} is currently offline. Config saved in DB.`);
  }
});

registerOnClipUploaded(async (filepath, filename, timestamp, deviceId, duration, streamId, trackEvents, frameWidth, frameHeight) => {
  await processVideoClipInBackground(filepath, filename, timestamp, deviceId, duration, streamId, trackEvents, frameWidth, frameHeight);
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
}

const pendingStreamRequests = new Map<string, PendingStreamRequest>();
let nextStreamRequestId = 0;

function fetchFileFromEdge(deviceId: string, filename: string): Promise<{ contentType: string; data: Buffer | string }> {
  const deviceSocket = activeDevices.get(deviceId);
  if (!deviceSocket || deviceSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(`Edge device ${deviceId} is offline`));
  }

  const requestId = `req_${Date.now()}_${nextStreamRequestId++}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingStreamRequests.delete(requestId);
      reject(new Error(`Timeout waiting for file ${filename} from device`));
    }, 15000);

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
) {
  const stream = await prisma.cameraStream.findUnique({
    where: { streamId }
  });
  const cameraName = stream ? stream.name : 'Unknown Camera';

  await prisma.cameraStream.update({
    where: { streamId },
    data: { status: 'Processing' }
  });

  broadcastToSubscribedUIs(deviceId, { type: 'status', streamId, status: 'Processing' });
  broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Processing video clip: ${filename} via Gemini...`);

  let geminiPath: string | null = null;

  try {
    geminiPath = await transcodeForGemini(filepath);
    const summaryPath = geminiPath !== filepath ? geminiPath : filepath;

    const reidFromClipPromise = trackEvents.length > 0
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
      : Promise.resolve({ succeeded: 0, failures: [] as { trackId: number; error: string }[] });

    const summary = await summarizeVideo(summaryPath, cameraName);
    const reidResult = await reidFromClipPromise;
    const reidCropsExtracted = reidResult.succeeded;

    broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Gemini summary generated successfully.`);

    const reidLogEntries: ClipReidLogEntry[] = [];
    if (!stream?.trackingEnabled) {
      reidLogEntries.push({
        level: 'info',
        message: 'Object tracking was disabled on this camera stream when the clip was processed.',
      });
    }
    if (trackEvents.length === 0) {
      reidLogEntries.push({
        level: 'info',
        message: 'No track events were bundled with this clip. ReID requires a person to be tracked for at least ~1 second during recording.',
      });
    } else {
      reidLogEntries.push({
        level: 'info',
        message: `Edge device bundled ${trackEvents.length} track event(s) with the clip upload.`,
      });
      for (const failure of reidResult.failures) {
        reidLogEntries.push({
          level: 'warn',
          message: `Track ${failure.trackId}: crop extraction failed — ${failure.error}`,
        });
      }
      if (reidCropsExtracted > 0) {
        reidLogEntries.push({
          level: 'info',
          message: `Created ${reidCropsExtracted} ReID profile(s) from the clip.`,
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
          `[${cameraName}] Extracted ${reidCropsExtracted} ReID crop(s) from clip ${filename}.`,
        );
      } else {
        broadcastLogToSubscribedUIs(
          deviceId,
          `[${cameraName}] ReID crop extraction failed for ${trackEvents.length} track event(s) in ${filename}.`,
        );
      }
    }

    const detectedObjects = trackEvents.length > 0 ? aggregateTrackEvents(trackEvents) : undefined;

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

    // 3. Generate embedding vector of the summary
    const vector = await generateTextEmbedding(summary);

    // 4. Index vector in Qdrant
    const orgId = await getDeviceOrgId(deviceId);
    await upsertClipVector(clipDb.id, vector, {
      filepath,
      filename,
      timestamp: timestamp.toISOString(),
      summary,
      camera: cameraName,
      deviceId: deviceId,
      streamId: streamId,
      ...(orgId ? { orgId } : {}),
    });

    broadcastLogToSubscribedUIs(deviceId, `[${cameraName}] Successfully indexed clip in Qdrant.`);
    
    // Notify all UI clients — archive is global and may not have a device/stream subscription.
    broadcastNewClipToAllUIs(clipDb, deviceId, streamId);

  } catch (error: any) {
    console.error(`[Pipeline Error] Failed to process ${filename}:`, error);
    broadcastLogToSubscribedUIs(deviceId, `[Pipeline Error] Failed to process ${filename}: ${error.message}`);
  } finally {
    if (geminiPath && geminiPath !== filepath && fs.existsSync(geminiPath)) {
      try {
        fs.unlinkSync(geminiPath);
      } catch (err: any) {
        console.error(`[Cloud Hub] Failed to delete gemini transcode ${geminiPath}:`, err);
      }
    }

    // Delete temporary backend video file
    if (fs.existsSync(filepath)) {
      try {
        fs.unlinkSync(filepath);
        console.log(`[Cloud Hub] Deleted temporary upload file: ${filepath}`);
      } catch (err: any) {
        console.error(`[Cloud Hub] Failed to delete temporary file ${filepath}:`, err);
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
    await prisma.edgeDevice.update({
      where: { deviceId },
      data: { status: 'Online', lastHeartbeat: new Date() }
    });

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
    if (ws.readyState === WebSocket.OPEN && streams.length > 0) {
      console.log(`[WS Hub] Syncing ${streams.length} stream config(s) to edge device: ${deviceId}`);
      ws.send(JSON.stringify({ type: 'configure', streams }));
    }

    // If there is already a UI client subscribed to any of the device's streams, toggle streaming for them
    for (const stream of streams) {
      const hasSubscribers = Array.from(uiStreamSubscriptions.values()).includes(stream.streamId);
      if (hasSubscribers) {
        ws.send(JSON.stringify({ type: 'toggle_stream', streamId: stream.streamId, stream: true }));
      }
    }

    ws.on('message', async (messageData: string) => {
      try {
        const data = JSON.parse(messageData);
        switch (data.type) {
          case 'heartbeat':
            await prisma.edgeDevice.update({
              where: { deviceId },
              data: {
                lastHeartbeat: new Date(),
                status: 'Online',
              }
            });
            break;
          case 'status_change':
            if (data.streamId) {
              const streamRow = await prisma.cameraStream.findUnique({ where: { streamId: data.streamId } });
              let reportedStatus = data.status as string;
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
                const hasSubscribers = Array.from(uiStreamSubscriptions.values()).includes(data.streamId);
                if (hasSubscribers) {
                  const deviceSocket = activeDevices.get(deviceId);
                  if (deviceSocket && deviceSocket.readyState === WebSocket.OPEN) {
                    deviceSocket.send(JSON.stringify({ type: 'toggle_stream', streamId: data.streamId, stream: true }));
                  }
                }
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
            }
            break;
          case 'response_stream_file': {
            const { requestId, success, contentType, data: fileData, error } = data;
            const pending = pendingStreamRequests.get(requestId);
            if (pending) {
              clearTimeout(pending.timeout);
              pendingStreamRequests.delete(requestId);
              
              if (success) {
                const bufferOrString = contentType.startsWith('text/') || contentType === 'application/x-mpegURL'
                  ? fileData
                  : Buffer.from(fileData, 'base64');
                pending.resolve({ contentType, data: bufferOrString });
              } else {
                pending.reject(new Error(error || 'Failed to fetch HLS file from device'));
              }
            }
            break;
          }
          case 'log':
            broadcastLogToSubscribedUIs(deviceId, data.message);
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

      await prisma.edgeDevice.update({
        where: { deviceId },
        data: { status: 'Offline' }
      });

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
            const currentStatus = isOnline ? (stream.status || 'Idle') : 'Offline';
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
            const currentStatus = isOnline ? (stream.status || 'Idle') : 'Offline';

            ws.send(JSON.stringify({
              type: 'status',
              streamId: targetStreamId,
              status: currentStatus,
              cameraConfig: stream
            }));

            // Notify edge device to start streaming this specific stream
            const deviceSocket = activeDevices.get(stream.deviceId);
            if (deviceSocket && deviceSocket.readyState === WebSocket.OPEN) {
              deviceSocket.send(JSON.stringify({ type: 'toggle_stream', streamId: targetStreamId, stream: true }));
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
              if (stream) {
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
        if (!hasOtherSubscribers) {
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

  // Stop ReID worker
  console.log('[Server] Stopping ReID worker process...');
  const { reidWorker } = require('./services/reidWorker');
  reidWorker.stop();

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

  // Start persistent ReID worker process
  try {
    const { reidWorker } = require('./services/reidWorker');
    await reidWorker.start();
  } catch (err) {
    console.error('Failed to start ReID worker:', err);
  }
  
  // Set all devices and streams to Offline initially
  await prisma.edgeDevice.updateMany({
    data: { status: 'Offline' }
  });
  await prisma.cameraStream.updateMany({
    data: { status: 'Offline' }
  });

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
