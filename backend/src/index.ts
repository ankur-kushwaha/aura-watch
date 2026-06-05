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
import { initQdrant, upsertClipVector } from './services/qdrant';
import { MotionDetector } from './camera/motion-detector';
import { recordClip, stopActiveRecording } from './camera/recorder';
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

// WebSocket Connections
const clients = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
  clients.add(ws);
  console.log(`[WS] Client connected. Total: ${clients.size}`);
  
  // Send initial status
  ws.send(JSON.stringify({ 
    type: 'status', 
    status: isDetectorRunning ? 'Monitoring' : 'Idle',
    cameraConfig
  }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected. Total: ${clients.size}`);
  });
});

// Broadcast helper
function broadcast(data: any) {
  const message = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function broadcastLog(message: string) {
  console.log(`[Log] ${message}`);
  broadcast({ type: 'log', message, timestamp: new Date().toISOString() });
}

// Configuration (In-Memory for demonstration/simplicity, can be saved to JSON file or DB)
interface CameraConfig {
  name: string;
  type: 'webcam' | 'rtsp';
  streamUrl: string;
  enabled: boolean;
}

let cameraConfig: CameraConfig = {
  name: 'Macbook Camera',
  type: 'webcam',
  streamUrl: '0',
  enabled: false, // Start disabled so user can choose to enable in UI
};

let activeDetector: MotionDetector | null = null;
let isDetectorRunning = false;
let isRecording = false;

// API camera configuration routes
app.get('/api/config', (req, res) => {
  res.json(cameraConfig);
});

app.post('/api/config', async (req, res) => {
  const { name, type, streamUrl, enabled } = req.body;
  
  if (!name || !type || enabled === undefined) {
    return res.status(400).json({ error: 'Invalid config fields' });
  }

  broadcastLog(`Updating camera configuration to: ${name} (${type})`);
  
  cameraConfig = { name, type, streamUrl: streamUrl || '0', enabled };
  
  // Restart detector with new configuration
  await restartDetector();
  
  res.json({ message: 'Configuration updated successfully', config: cameraConfig });
});

async function stopDetector() {
  if (activeDetector) {
    broadcastLog('Stopping camera motion detector...');
    activeDetector.stop();
    activeDetector = null;
  }
  isDetectorRunning = false;
  broadcast({ type: 'status', status: 'Idle' });
}

async function startDetector() {
  if (!cameraConfig.enabled) {
    broadcastLog('Camera monitoring is disabled in config.');
    return;
  }

  if (isRecording) {
    broadcastLog('Currently recording. Detector will start once recording completes.');
    return;
  }

  broadcastLog(`Starting motion detector for camera: ${cameraConfig.name}`);
  
  activeDetector = new MotionDetector({
    streamUrl: cameraConfig.streamUrl,
    cameraType: cameraConfig.type,
    motionThreshold: 25,
    pixelChangeThreshold: 0.02,
  });

  activeDetector.on('log', (msg) => {
    broadcastLog(`[Detector] ${msg}`);
  });

  activeDetector.on('motion-start', async (ratio) => {
    broadcastLog(`Motion detected! Pixel change ratio: ${(ratio * 100).toFixed(2)}%`);
    broadcast({ type: 'motion_state', active: true, ratio });
    
    // Trigger recording clip
    await triggerClipRecording();
  });

  activeDetector.on('motion-update', (ratio) => {
    broadcast({ type: 'motion_state', active: true, ratio });
  });

  activeDetector.on('motion-end', (ratio) => {
    broadcastLog(`Motion stopped.`);
    broadcast({ type: 'motion_state', active: false, ratio });
  });

  activeDetector.on('error', (err) => {
    broadcastLog(`[Detector Error] ${err.message}`);
    stopDetector();
  });

  activeDetector.on('frame', (frameData: Buffer) => {
    broadcast({
      type: 'frame',
      width: 320,
      height: 240,
      image: frameData.toString('base64')
    });
  });

  activeDetector.start();
  isDetectorRunning = true;
  broadcast({ type: 'status', status: 'Monitoring' });
}

async function restartDetector() {
  await stopDetector();
  if (cameraConfig.enabled) {
    await startDetector();
  }
}

/**
 * Handle motion detection -> pause detection -> record 10s -> resume detection -> process Gemini/DB in background
 */
async function triggerClipRecording() {
  if (isRecording) return;
  isRecording = true;

  // 1. Pause motion detector so recording can access the camera device without lock conflict
  await stopDetector();
  broadcast({ type: 'status', status: 'Recording' });
  broadcastLog(`Camera stream released. Starting 10-second recording...`);

  const timestamp = new Date();
  const filename = `clip_${timestamp.getTime()}.mp4`;
  const outputPath = path.join(VIDEO_DIR, filename);

  try {
    // 2. Record video clip
    await recordClip({
      streamUrl: cameraConfig.streamUrl,
      cameraType: cameraConfig.type,
      outputPath: outputPath,
      durationSeconds: 10
    });

    broadcastLog(`Clip recording finished: ${filename}`);
  } catch (error: any) {
    broadcastLog(`Recording failed: ${error.message}`);
    // Restart detector and exit
    isRecording = false;
    await startDetector();
    return;
  }

  // 3. Resume detector so we don't miss future events while processing the current clip
  isRecording = false;
  await startDetector();

  // 4. Process the recorded video in the background (Gemini API & Databases)
  processVideoClipInBackground(outputPath, filename, timestamp);
}

/**
 * Upload to Gemini, fetch summary, generate vector embeddings, and save to MongoDB + Qdrant
 */
async function processVideoClipInBackground(filepath: string, filename: string, timestamp: Date) {
  broadcast({ type: 'status', status: 'Processing Video' });
  broadcastLog(`Processing video clip: ${filename} via Gemini...`);

  try {
    // 1. Send to Gemini for summarization
    const summary = await summarizeVideo(filepath, cameraConfig.name);
    broadcastLog(`Gemini summary generated successfully.`);

    // 2. Save metadata to MongoDB via Prisma
    const clipDb = await prisma.videoClip.create({
      data: {
        filepath,
        filename,
        timestamp,
        summary,
        duration: 10.0,
        camera: cameraConfig.name,
      }
    });
    broadcastLog(`Saved clip metadata to MongoDB with ID: ${clipDb.id}`);

    // 3. Generate embedding vector of the summary
    const vector = await generateTextEmbedding(summary);

    // 4. Index vector in Qdrant
    await upsertClipVector(clipDb.id, vector, {
      filepath,
      filename,
      timestamp: timestamp.toISOString(),
      summary,
      camera: cameraConfig.name,
    });

    broadcastLog(`Successfully indexed clip in Qdrant.`);
    
    // Notify all frontend clients of the new clip
    broadcast({
      type: 'new_clip',
      clip: clipDb
    });

  } catch (error: any) {
    broadcastLog(`[Pipeline Error] Failed to process ${filename}: ${error.message}`);
  } finally {
    // Send status back to normal monitoring/idle
    broadcast({ 
      type: 'status', 
      status: isDetectorRunning ? 'Monitoring' : 'Idle' 
    });
  }
}

// Graceful shutdown helper
async function shutdown() {
  console.log('[Server] Graceful shutdown initiated. Cleaning up...');
  
  // 1. Stop motion detector (kills its ffmpeg child process)
  await stopDetector();
  
  // 2. Stop any active recording process (kills its ffmpeg child process)
  stopActiveRecording();
  
  // 3. Close all active WebSocket connections and close the WebSocket server
  console.log('[Server] Closing WebSocket connections...');
  for (const client of clients) {
    try {
      client.terminate();
    } catch (e) {
      console.error('[Server] Error terminating WS client:', e);
    }
  }
  
  await new Promise<void>((resolve) => {
    wss.close(() => {
      console.log('[Server] WebSocket server closed.');
      resolve();
    });
  });

  // 4. Close the Express/HTTP server to release the port
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

  // 5. Disconnect Prisma client
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

// nodemon sends SIGUSR2 on restarts.
// We must call process.kill(process.pid, 'SIGUSR2') once cleanup is complete
// to allow nodemon to proceed with restarting.
process.once('SIGUSR2', async () => {
  console.log('[Server] SIGUSR2 received (nodemon restarting).');
  await shutdown();
  process.kill(process.pid, 'SIGUSR2');
});


server.listen(PORT, async () => {
  console.log(`[Server] Express listening on port ${PORT}`);
  
  // Initialize Qdrant Collection
  await initQdrant();
  
  // Start detector if enabled on boot
  if (cameraConfig.enabled) {
    await startDetector();
  }
});
