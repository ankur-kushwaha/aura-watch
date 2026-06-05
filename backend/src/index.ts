import express from 'express';
import cors from 'cors';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'path';
import * as fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import clipsRouter from './routes/clips';
import ragRouter from './routes/rag';
import devicesRouter, { registerOnConfigUpdated, registerOnClipUploaded } from './routes/devices';
import { initQdrant, upsertClipVector } from './services/qdrant';
import { summarizeVideo, generateTextEmbedding } from './services/gemini';
import prisma from './services/db';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 5000;
const VIDEO_DIR = process.env.VIDEO_STORAGE_DIR || path.join(__dirname, '../storage/videos');

// Ensure video storage directory exists
if (!fs.existsSync(VIDEO_DIR)) {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());

// Serve static videos
app.use('/api/videos', express.static(VIDEO_DIR));

// Mount routes
app.use('/api/clips', clipsRouter);
app.use('/api/rag', ragRouter);
app.use('/api/devices', devicesRouter);

// WebSocket Maps
// Maps deviceId -> WebSocket connection
const activeDevices = new Map<string, WebSocket>();
// Maps UI WebSocket -> deviceId they are subscribed to
const uiSubscriptions = new Map<WebSocket, string>();

function broadcastToSubscribedUIs(deviceId: string, data: any) {
  const message = JSON.stringify(data);
  for (const [ws, subDeviceId] of uiSubscriptions.entries()) {
    if (subDeviceId === deviceId && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

function broadcastLogToSubscribedUIs(deviceId: string, message: string) {
  console.log(`[Log - ${deviceId}] ${message}`);
  broadcastToSubscribedUIs(deviceId, {
    type: 'log',
    message,
    timestamp: new Date().toISOString()
  });
}

// Register callbacks for device changes
registerOnConfigUpdated((deviceId, config) => {
  const deviceSocket = activeDevices.get(deviceId);
  if (deviceSocket && deviceSocket.readyState === WebSocket.OPEN) {
    console.log(`[WS Hub] Pushing configure command to edge device: ${deviceId}`);
    deviceSocket.send(JSON.stringify({ type: 'configure', config }));
  } else {
    console.log(`[WS Hub] Edge device ${deviceId} is currently offline. Config saved in DB.`);
  }
});

registerOnClipUploaded(async (filepath, filename, timestamp, deviceId) => {
  await processVideoClipInBackground(filepath, filename, timestamp, deviceId);
});

/**
 * Upload to Gemini, fetch summary, generate vector embeddings, and save to MongoDB + Qdrant
 */
async function processVideoClipInBackground(filepath: string, filename: string, timestamp: Date, deviceId: string) {
  const device = await prisma.edgeDevice.findUnique({
    where: { deviceId }
  });
  const cameraName = device ? device.name : 'Unknown Camera';

  await prisma.edgeDevice.update({
    where: { deviceId },
    data: { status: 'Processing' }
  });

  broadcastToSubscribedUIs(deviceId, { type: 'status', status: 'Processing Video' });
  broadcastLogToSubscribedUIs(deviceId, `Processing video clip: ${filename} via Gemini...`);

  try {
    // 1. Send to Gemini for summarization
    const summary = await summarizeVideo(filepath, cameraName);
    broadcastLogToSubscribedUIs(deviceId, `Gemini summary generated successfully.`);

    // 2. Save metadata to MongoDB via Prisma
    const clipDb = await prisma.videoClip.create({
      data: {
        filepath,
        filename,
        timestamp,
        summary,
        duration: 10.0,
        camera: cameraName,
        deviceId: deviceId,
      }
    });
    broadcastLogToSubscribedUIs(deviceId, `Saved clip metadata to MongoDB with ID: ${clipDb.id}`);

    // 3. Generate embedding vector of the summary
    const vector = await generateTextEmbedding(summary);

    // 4. Index vector in Qdrant
    await upsertClipVector(clipDb.id, vector, {
      filepath,
      filename,
      timestamp: timestamp.toISOString(),
      summary,
      camera: cameraName,
      deviceId: deviceId,
    });

    broadcastLogToSubscribedUIs(deviceId, `Successfully indexed clip in Qdrant.`);
    
    // Notify subscribed UI clients of the new clip
    broadcastToSubscribedUIs(deviceId, {
      type: 'new_clip',
      clip: clipDb
    });

  } catch (error: any) {
    console.error(`[Pipeline Error] Failed to process ${filename}:`, error);
    broadcastLogToSubscribedUIs(deviceId, `[Pipeline Error] Failed to process ${filename}: ${error.message}`);
  } finally {
    // Restore device status
    const refreshedDevice = await prisma.edgeDevice.findUnique({ where: { deviceId } });
    const finalStatus = refreshedDevice?.enabled ? 'Monitoring' : 'Idle';
    
    await prisma.edgeDevice.update({
      where: { deviceId },
      data: { status: finalStatus }
    });

    broadcastToSubscribedUIs(deviceId, { 
      type: 'status', 
      status: finalStatus 
    });
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

    // Fetch device and set its status
    const device = await prisma.edgeDevice.findUnique({ where: { deviceId } });
    const currentStatus = device?.enabled ? 'Monitoring' : 'Idle';

    await prisma.edgeDevice.update({
      where: { deviceId },
      data: { status: currentStatus, lastHeartbeat: new Date() }
    });

    // Notify UI subscribers
    broadcastToSubscribedUIs(deviceId, { type: 'status', status: currentStatus, cameraConfig: device });
    broadcastLogToSubscribedUIs(deviceId, `Edge device connected.`);

    // If there is already a UI client subscribed, toggle camera stream on the edge
    const hasSubscribers = Array.from(uiSubscriptions.values()).includes(deviceId);
    if (hasSubscribers) {
      ws.send(JSON.stringify({ type: 'toggle_stream', stream: true }));
    }

    ws.on('message', async (messageData: string) => {
      try {
        const data = JSON.parse(messageData);
        switch (data.type) {
          case 'heartbeat':
            await prisma.edgeDevice.update({
              where: { deviceId },
              data: { lastHeartbeat: new Date() }
            });
            break;
          case 'status_change':
            await prisma.edgeDevice.update({
              where: { deviceId },
              data: { status: data.status }
            });
            broadcastToSubscribedUIs(deviceId, { type: 'status', status: data.status });
            break;
          case 'frame':
            broadcastToSubscribedUIs(deviceId, {
              type: 'frame',
              image: data.image
            });
            break;
          case 'log':
            broadcastLogToSubscribedUIs(deviceId, data.message);
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

      broadcastToSubscribedUIs(deviceId, { type: 'status', status: 'Offline' });
      broadcastLogToSubscribedUIs(deviceId, `Edge device disconnected.`);
    });

  } else {
    // UI connection
    console.log('[WS] UI client connected');

    ws.on('message', async (messageData: string) => {
      try {
        const data = JSON.parse(messageData);
        
        if (data.type === 'subscribe_device') {
          const targetDeviceId = data.deviceId;
          uiSubscriptions.set(ws, targetDeviceId);
          console.log(`[WS] UI client subscribed to device: ${targetDeviceId}`);

          // Send current status of the subscribed device
          const device = await prisma.edgeDevice.findUnique({ where: { deviceId: targetDeviceId } });
          const isOnline = activeDevices.has(targetDeviceId);
          const currentStatus = isOnline ? (device?.status || 'Idle') : 'Offline';

          ws.send(JSON.stringify({
            type: 'status',
            status: currentStatus,
            cameraConfig: device
          }));

          // Notify the edge device to start sending frames since a UI client is listening
          const deviceSocket = activeDevices.get(targetDeviceId);
          if (deviceSocket && deviceSocket.readyState === WebSocket.OPEN) {
            deviceSocket.send(JSON.stringify({ type: 'toggle_stream', stream: true }));
          }
        } else if (data.type === 'unsubscribe_device') {
          const prevDeviceId = uiSubscriptions.get(ws);
          uiSubscriptions.delete(ws);

          if (prevDeviceId) {
            console.log(`[WS] UI client unsubscribed from device: ${prevDeviceId}`);
            // Stop streaming from device if no more UI subscribers are active
            const hasOtherSubscribers = Array.from(uiSubscriptions.values()).includes(prevDeviceId);
            if (!hasOtherSubscribers) {
              const deviceSocket = activeDevices.get(prevDeviceId);
              if (deviceSocket && deviceSocket.readyState === WebSocket.OPEN) {
                deviceSocket.send(JSON.stringify({ type: 'toggle_stream', stream: false }));
              }
            }
          }
        }
      } catch (err) {
        console.error('[WS Error - UI]', err);
      }
    });

    ws.on('close', () => {
      const prevDeviceId = uiSubscriptions.get(ws);
      uiSubscriptions.delete(ws);
      console.log('[WS] UI client disconnected');

      if (prevDeviceId) {
        const hasOtherSubscribers = Array.from(uiSubscriptions.values()).includes(prevDeviceId);
        if (!hasOtherSubscribers) {
          const deviceSocket = activeDevices.get(prevDeviceId);
          if (deviceSocket && deviceSocket.readyState === WebSocket.OPEN) {
            deviceSocket.send(JSON.stringify({ type: 'toggle_stream', stream: false }));
          }
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
  
  // Initialize Qdrant Collection
  await initQdrant();
  
  // Set all devices to Offline initially (until they connect and send WS link)
  await prisma.edgeDevice.updateMany({
    data: { status: 'Offline' }
  });
});
