import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { WebSocket } from 'ws';
import dotenv from 'dotenv';
import { MotionDetector } from './motion-detector';
import { recordClip, stopActiveRecording } from './recorder';

// Load environment variables
dotenv.config();

const CLOUD_URL = process.env.CLOUD_URL || 'http://localhost:5000';
const CLOUD_WS_URL = process.env.CLOUD_WS_URL || 'ws://localhost:5000';
const DEVICE_NAME = process.env.DEVICE_NAME || 'Office Edge Device';
const LOCAL_VIDEO_DIR = process.env.LOCAL_VIDEO_DIR || path.join(__dirname, '../storage/temp_clips');

// Global state
let deviceId = '';
let activeDetector: MotionDetector | null = null;
let isDetectorRunning = false;
let isRecording = false;
let ws: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let streamFrames = false;

// Ensure local storage directory exists
if (!fs.existsSync(LOCAL_VIDEO_DIR)) {
  fs.mkdirSync(LOCAL_VIDEO_DIR, { recursive: true });
}

// 1. Load or generate persistent Device ID
const deviceIdFile = path.join(__dirname, '../.device-id');
if (fs.existsSync(deviceIdFile)) {
  deviceId = fs.readFileSync(deviceIdFile, 'utf8').trim();
  console.log(`[Edge] Loaded persistent device ID: ${deviceId}`);
} else {
  // Generate random 16-char hex string as ID
  deviceId = 'edge_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
  fs.writeFileSync(deviceIdFile, deviceId, 'utf8');
  console.log(`[Edge] Generated and saved new device ID: ${deviceId}`);
}

// Current applied configuration
let currentConfig = {
  name: DEVICE_NAME,
  cameraType: 'webcam' as 'webcam' | 'rtsp',
  streamUrl: '0',
  enabled: false,
  motionThreshold: 25,
  pixelChangeThreshold: 0.02,
};

/**
 * Log helper that also broadcasts to UI clients over WebSocket
 */
function sendLog(message: string) {
  console.log(`[Edge Log] ${message}`);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'log', message }));
  }
}

/**
 * Stream binary upload using Node.js standard library
 */
function uploadRecordedClip(filepath: string, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const isHttps = CLOUD_URL.startsWith('https');
    const url = new URL(`${CLOUD_URL}/api/devices/${deviceId}/upload`);
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-filename': filename,
        'Content-Length': fs.statSync(filepath).size
      }
    };

    const client = isHttps ? https : http;
    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    const fileStream = fs.createReadStream(filepath);
    fileStream.pipe(req);
  });
}

/**
 * Register device with Cloud Hub REST API
 */
async function registerDevice(): Promise<any> {
  return new Promise((resolve, reject) => {
    const isHttps = CLOUD_URL.startsWith('https');
    const url = new URL(`${CLOUD_URL}/api/devices/register`);
    
    const payload = JSON.stringify({
      deviceId,
      name: DEVICE_NAME,
      cameraType: currentConfig.cameraType,
      streamUrl: currentConfig.streamUrl,
      enabled: currentConfig.enabled,
      motionThreshold: currentConfig.motionThreshold,
      pixelChangeThreshold: currentConfig.pixelChangeThreshold,
      status: 'Idle'
    });

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const client = isHttps ? https : http;
    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(body);
          }
        } else {
          reject(new Error(`Registration failed with code ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

/**
 * Stop motion detector process
 */
async function stopDetector() {
  if (activeDetector) {
    sendLog('Stopping camera motion detector...');
    activeDetector.stop();
    activeDetector = null;
  }
  isDetectorRunning = false;
  sendStatusChange('Idle');
}

/**
 * Start motion detector process
 */
async function startDetector() {
  if (!currentConfig.enabled) {
    sendLog('Monitoring is disabled.');
    return;
  }

  if (isRecording) {
    sendLog('Currently recording. Detector will start once recording completes.');
    return;
  }

  sendLog(`Starting motion detector for camera: ${currentConfig.name}`);
  
  activeDetector = new MotionDetector({
    streamUrl: currentConfig.streamUrl,
    cameraType: currentConfig.cameraType,
    motionThreshold: currentConfig.motionThreshold,
    pixelChangeThreshold: currentConfig.pixelChangeThreshold,
  });

  activeDetector.on('log', (msg) => {
    sendLog(`[Detector] ${msg}`);
  });

  activeDetector.on('motion-start', async (ratio) => {
    sendLog(`Motion detected! Pixel change ratio: ${(ratio * 100).toFixed(2)}%`);
    await triggerClipRecording();
  });

  activeDetector.on('error', (err) => {
    sendLog(`[Detector Error] ${err.message}`);
    stopDetector();
  });

  activeDetector.on('frame', (frameData: Buffer) => {
    if (streamFrames && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'frame',
        image: frameData.toString('base64')
      }));
    }
  });

  activeDetector.start();
  isDetectorRunning = true;
  sendStatusChange('Monitoring');
}

/**
 * Trigger recording of a 10s video clip
 */
async function triggerClipRecording() {
  if (isRecording) return;
  isRecording = true;

  // 1. Stop detector to release camera lock
  await stopDetector();
  sendStatusChange('Recording');
  sendLog(`Camera stream released. Starting 10-second recording...`);

  const timestamp = new Date();
  const filename = `clip_${timestamp.getTime()}_${deviceId}.mp4`;
  const outputPath = path.join(LOCAL_VIDEO_DIR, filename);

  try {
    // 2. Record video
    await recordClip({
      streamUrl: currentConfig.streamUrl,
      cameraType: currentConfig.cameraType,
      outputPath: outputPath,
      durationSeconds: 10
    });

    sendLog(`Clip recording finished: ${filename}. Uploading to Cloud...`);
    
    // 3. Upload to cloud backend asynchronously so we can resume monitoring fast
    uploadRecordedClip(outputPath, filename)
      .then(() => {
        sendLog(`Successfully uploaded clip to Cloud: ${filename}`);
        // Delete local temp video clip
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      })
      .catch((err) => {
        sendLog(`[Upload Error] Failed to upload clip: ${err.message}`);
      });

  } catch (error: any) {
    sendLog(`Recording failed: ${error.message}`);
  }

  // 4. Resume detector
  isRecording = false;
  await startDetector();
}

/**
 * Send status change via WebSocket
 */
function sendStatusChange(status: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'status_change', status }));
  }
}

/**
 * Establish WebSocket Connection
 */
function connectWS() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  
  console.log(`[Edge WS] Connecting to ${CLOUD_WS_URL}...`);
  const wsUrl = `${CLOUD_WS_URL}?role=device&deviceId=${deviceId}`;
  
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('[Edge WS] Connected successfully to Cloud Hub.');
    
    // Start heartbeat
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat' }));
      }
    }, 10000);

    // Sync current status
    sendStatusChange(isRecording ? 'Recording' : (isDetectorRunning ? 'Monitoring' : 'Idle'));
  });

  ws.on('message', async (messageData: string) => {
    try {
      const data = JSON.parse(messageData);
      console.log('[Edge WS] Received event:', data.type);

      switch (data.type) {
        case 'configure': {
          const newConfig = data.config;
          sendLog(`Applying new configuration: ${newConfig.name}`);
          
          const wasRunning = currentConfig.enabled;
          
          currentConfig = {
            name: newConfig.name,
            cameraType: newConfig.cameraType,
            streamUrl: newConfig.streamUrl,
            enabled: newConfig.enabled,
            motionThreshold: newConfig.motionThreshold,
            pixelChangeThreshold: newConfig.pixelChangeThreshold,
          };

          // Restart detector if it was running or should run
          await stopDetector();
          if (currentConfig.enabled) {
            await startDetector();
          }
          break;
        }
        case 'toggle_stream': {
          streamFrames = !!data.stream;
          console.log(`[Edge WS] Frame streaming toggled: ${streamFrames}`);
          break;
        }
      }
    } catch (err) {
      console.error('[Edge WS] Error processing message:', err);
    }
  });

  ws.on('close', () => {
    console.log('[Edge WS] Connection closed. Retrying in 5 seconds...');
    cleanupWS();
    reconnectTimer = setTimeout(connectWS, 5000);
  });

  ws.on('error', (err) => {
    console.error('[Edge WS] Connection error:', err);
    ws?.close();
  });
}

function cleanupWS() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Shut down the edge agent
 */
async function shutdown() {
  console.log('[Edge] Shutdown initiated. Cleaning up...');
  
  cleanupWS();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  
  await stopDetector();
  stopActiveRecording();

  if (ws) {
    ws.close();
  }

  console.log('[Edge] Cleanup complete.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Main bootstrap function
async function bootstrap() {
  try {
    console.log('[Edge] Registering device with Cloud Hub...');
    const registeredConfig = await registerDevice();
    console.log('[Edge] Registration successful. Applied config:', registeredConfig);
    
    // Apply registered config from DB
    currentConfig = {
      name: registeredConfig.name,
      cameraType: registeredConfig.cameraType,
      streamUrl: registeredConfig.streamUrl,
      enabled: registeredConfig.enabled,
      motionThreshold: registeredConfig.motionThreshold,
      pixelChangeThreshold: registeredConfig.pixelChangeThreshold,
    };

    // Connect real-time socket
    connectWS();

    // Start detector if enabled
    if (currentConfig.enabled) {
      await startDetector();
    }
  } catch (err: any) {
    console.error('[Edge] Bootstrap failed:', err.message);
    console.log('[Edge] Retrying registration in 10s...');
    setTimeout(bootstrap, 10000);
  }
}

bootstrap();
