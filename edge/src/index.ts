import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { spawn, execSync } from 'child_process';
import { WebSocket } from 'ws';
import dotenv from 'dotenv';
import { MotionDetector } from './motion-detector';
import { recordClip, stopActiveRecording } from './recorder';

// Load environment variables
dotenv.config();

function deriveWsUrl(httpUrl: string): string {
  const url = httpUrl.replace(/\/$/, '');
  if (url.startsWith('https://')) return `wss://${url.slice('https://'.length)}`;
  if (url.startsWith('http://')) return `ws://${url.slice('http://'.length)}`;
  return 'wss://aura-watch.adboardtools.com';
}

const CLOUD_URL = (process.env.CLOUD_URL || 'https://aura-watch.adboardtools.com').replace(/\/$/, '');
const CLOUD_WS_URL = deriveWsUrl(CLOUD_URL);
const DEVICE_NAME = process.env.DEVICE_NAME || 'Office Edge Device';
const LOCAL_VIDEO_DIR = process.env.LOCAL_VIDEO_DIR || path.join(__dirname, '../storage/temp_clips');
const HLS_DIR = path.join(__dirname, '../storage/hls');

// Global state
let deviceId = '';
let activeDetector: MotionDetector | null = null;
let isDetectorRunning = false;
let isRecording = false;
let ws: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let streamFrames = false;
let isStreaming = true; // HLS stream is on by default and always available

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
  trackingEnabled: false,
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
      enrollmentToken: process.env.ENROLLMENT_TOKEN || undefined,
      cameraType: currentConfig.cameraType,
      streamUrl: currentConfig.streamUrl,
      trackingEnabled: currentConfig.trackingEnabled,
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

function prepareHlsDirectory() {
  if (!fs.existsSync(HLS_DIR)) {
    fs.mkdirSync(HLS_DIR, { recursive: true });
  } else {
    clearHlsDirectory();
  }
}

function clearHlsDirectory() {
  if (fs.existsSync(HLS_DIR)) {
    const files = fs.readdirSync(HLS_DIR);
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(HLS_DIR, file));
      } catch (e) { }
    }
  }
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
  // Kill any existing/dangling ffmpeg processes using the same HLS output directory
  try {
    if (process.platform !== 'win32') {
      console.log(`[Edge Detector] Killing any running ffmpeg processes writing to ${HLS_DIR}...`);
      execSync(`pkill -9 -f "ffmpeg.*${HLS_DIR}"`, { stdio: 'ignore' });
    }
  } catch (e) {
    // Ignore error if no process was found
  }

  sendLog(`Starting camera detector for: ${currentConfig.name}`);
  prepareHlsDirectory();

  activeDetector = new MotionDetector({
    streamUrl: currentConfig.streamUrl,
    cameraType: currentConfig.cameraType,
    motionThreshold: currentConfig.motionThreshold,
    pixelChangeThreshold: currentConfig.pixelChangeThreshold,
    hlsOutputDir: HLS_DIR // Always generate HLS output in combined mode
  });

  activeDetector.on('log', (msg) => {
    sendLog(`[Detector] ${msg}`);
  });

  activeDetector.on('motion-start', async (ratio) => {
    if (!currentConfig.trackingEnabled) return;
    sendLog(`Motion detected! Pixel change ratio: ${(ratio * 100).toFixed(2)}%`);
    await triggerClipRecording();
  });

  activeDetector.on('error', async (err) => {
    sendLog(`[Detector Error] ${err.message}`);
    await stopDetector();
    await updateCameraState();
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
  sendStatusChange(currentConfig.trackingEnabled ? 'Monitoring' : 'Idle');
}

async function updateCameraState(forceRestart = false) {
  console.log(`[Edge State Machine] Updating processes. Enabled: ${currentConfig.trackingEnabled}, Streaming: ${isStreaming}, ForceRestart: ${forceRestart}`);

  if (forceRestart) {
    console.log(`[Edge State Machine] Force restarting active camera/detector processes to apply new configuration.`);
    await stopDetector();
  }

  if (!activeDetector) {
    await startDetector();
  } else {
    sendStatusChange(currentConfig.trackingEnabled ? 'Monitoring' : 'Idle');
  }
}

function concatHlsSegments(outputMp4Path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const files = fs.readdirSync(HLS_DIR)
        .filter(f => f.endsWith('.ts'))
        .map(f => {
          const match = f.match(/(\d+)\.ts$/);
          const num = match ? parseInt(match[1]) : 0;
          return { name: f, num };
        })
        .sort((a, b) => a.num - b.num)
        .map(f => path.join(HLS_DIR, f.name));

      if (files.length === 0) {
        return reject(new Error('No segments found to concatenate'));
      }

      // FFmpeg resolves paths relative to the concat file's directory — use bare filenames only.
      const txtPath = path.join(HLS_DIR, `concat_${Date.now()}.txt`);
      const content = files.map(f => `file '${path.basename(f).replace(/'/g, "'\\''")}'`).join('\n');
      fs.writeFileSync(txtPath, content, 'utf8');

      const args = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', txtPath,
        '-c', 'copy',
        outputMp4Path
      ];

      console.log(`[Concat] Spawning ffmpeg ${args.join(' ')}`);
      const proc = spawn('ffmpeg', args);

      let stderr = '';
      proc.stderr?.on('data', (d) => stderr += d.toString());

      proc.on('close', (code) => {
        try {
          fs.unlinkSync(txtPath);
        } catch (e) { }

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg concat exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        try {
          fs.unlinkSync(txtPath);
        } catch (e) { }
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function transcodeForGemini(
  inputPath: string,
  outputPath: string,
  fps: string,
  resolution: string,
  crf: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Transcode using ffmpeg: reduce FPS, scale resolution, apply CRF compression, remove audio
    const args = [
      '-y',
      '-i', inputPath,
      '-vf', `fps=${fps},scale=${resolution}`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', crf,
      '-an',
      outputPath
    ];

    console.log(`[Transcoder] Spawning: ffmpeg ${args.join(' ')}`);
    const proc = spawn('ffmpeg', args);
    let stderr = '';

    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg transcoding exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Trigger recording of a 10s video clip using HLS segments without interrupting live stream
 */
async function triggerClipRecording() {
  if (isRecording) return;
  isRecording = true;

  sendStatusChange('Recording');
  sendLog(`Motion detected. Collecting 10 seconds of video feed...`);

  const timestamp = new Date();
  const filename = `clip_${timestamp.getTime()}_${deviceId}.mp4`;
  const outputPath = path.join(LOCAL_VIDEO_DIR, filename);

  // Wait 10 seconds for the current segments to be generated fully
  setTimeout(async () => {
    try {
      sendLog(`Compiling HLS segments into clip: ${filename}...`);
      await concatHlsSegments(outputPath);
      sendLog(`Clip compiled successfully: ${filename}`);

      const optimizeGemini = process.env.GEMINI_OPTIMIZE === 'true';
      let uploadPath = outputPath;
      let tempGeminiPath = '';

      if (optimizeGemini) {
        const geminiFps = process.env.GEMINI_OPTIMIZE_FPS || '1';
        const geminiRes = process.env.GEMINI_OPTIMIZE_RESOLUTION || '640:480';
        const geminiCrf = process.env.GEMINI_OPTIMIZE_CRF || '28';

        tempGeminiPath = path.join(LOCAL_VIDEO_DIR, `temp_gemini_${timestamp.getTime()}_${deviceId}.mp4`);

        sendLog(`Optimizing clip for Gemini (FPS: ${geminiFps}, Res: ${geminiRes}, CRF: ${geminiCrf})...`);
        try {
          await transcodeForGemini(outputPath, tempGeminiPath, geminiFps, geminiRes, geminiCrf);

          if (fs.existsSync(tempGeminiPath)) {
            const originalSize = fs.statSync(outputPath).size;
            const optimizedSize = fs.statSync(tempGeminiPath).size;
            const reduction = ((1 - optimizedSize / originalSize) * 100).toFixed(1);
            sendLog(`Optimization success: ${(optimizedSize / 1024).toFixed(1)} KB (vs ${(originalSize / 1024).toFixed(1)} KB original, ${reduction}% bandwidth saved)`);
            uploadPath = tempGeminiPath;
          }
        } catch (transcodeErr: any) {
          sendLog(`[Transcode Warning] Transcoding failed: ${transcodeErr.message}. Falling back to original clip.`);
          uploadPath = outputPath;
        }
      }

      sendLog(`Uploading clip to Cloud: ${filename}...`);

      uploadRecordedClip(uploadPath, filename)
        .then(() => {
          sendLog(`Successfully uploaded clip to Cloud: ${filename}`);
          // Clean up the temp optimized file if it was created
          if (tempGeminiPath && fs.existsSync(tempGeminiPath)) {
            try {
              fs.unlinkSync(tempGeminiPath);
              sendLog(`Cleaned up temporary Gemini-optimized video file.`);
            } catch (e) { }
          }
        })
        .catch((err) => {
          sendLog(`[Upload Error] Failed to upload clip: ${err.message}`);
          if (tempGeminiPath && fs.existsSync(tempGeminiPath)) {
            try {
              fs.unlinkSync(tempGeminiPath);
            } catch (e) { }
          }
        });

    } catch (error: any) {
      sendLog(`Clip generation failed: ${error.message}`);
    } finally {
      isRecording = false;
      await updateCameraState();
    }
  }, 10000);
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
    sendStatusChange(isRecording ? 'Recording' : (isDetectorRunning ? (currentConfig.trackingEnabled ? 'Monitoring' : 'Idle') : 'Idle'));
  });

  ws.on('message', async (messageData: string) => {
    try {
      const data = JSON.parse(messageData);
      // if (process.env.DEBUG_LOGS !== 'false') {
        // console.log('[Edge WS] Received event:', data.type);
      // }
      switch (data.type) {
        case 'configure': {
          const newConfig = data.config;
          sendLog(`Applying new configuration: ${newConfig.name}`);

          currentConfig = {
            name: newConfig.name,
            cameraType: newConfig.cameraType,
            streamUrl: newConfig.streamUrl,
            trackingEnabled: newConfig.trackingEnabled,
            motionThreshold: newConfig.motionThreshold,
            pixelChangeThreshold: newConfig.pixelChangeThreshold,
          };

          await updateCameraState(true);
          break;
        }
        case 'toggle_stream': {
          // Keep this structure for compatibility but our HLS stream is always active
          console.log(`[Edge WS] HLS stream always active. Toggle ignored.`);
          break;
        }
        case 'request_stream_file': {
          const { requestId, filename } = data;
          const isClip = filename.startsWith('clip_') && filename.endsWith('.mp4');
          const filePath = isClip ? path.join(LOCAL_VIDEO_DIR, filename) : path.join(HLS_DIR, filename);

          if (!fs.existsSync(filePath)) {
            ws?.send(JSON.stringify({
              type: 'response_stream_file',
              requestId,
              success: false,
              error: `File ${filename} not found`
            }));
            break;
          }

          try {
            const isPlaylist = filename.endsWith('.m3u8');
            const isMp4 = filename.endsWith('.mp4');
            const contentType = isPlaylist
              ? 'application/x-mpegURL'
              : (isMp4 ? 'video/mp4' : 'video/MP2T');

            if (isPlaylist) {
              const fileContent = fs.readFileSync(filePath, 'utf8');
              ws?.send(JSON.stringify({
                type: 'response_stream_file',
                requestId,
                success: true,
                contentType,
                data: fileContent
              }));
            } else {
              const fileContent = fs.readFileSync(filePath);
              ws?.send(JSON.stringify({
                type: 'response_stream_file',
                requestId,
                success: true,
                contentType,
                data: fileContent.toString('base64')
              }));
            }
          } catch (err: any) {
            ws?.send(JSON.stringify({
              type: 'response_stream_file',
              requestId,
              success: false,
              error: `Error reading file: ${err.message}`
            }));
          }
          break;
        }
        case 'delete_clip_file': {
          const { filename } = data;
          const filePath = path.join(LOCAL_VIDEO_DIR, filename);
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
              sendLog(`Deleted clip file on edge: ${filename}`);
            } catch (err: any) {
              sendLog(`Error deleting clip file on edge: ${err.message}`);
            }
          }
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

  if (activeDetector) {
    activeDetector.stop();
    activeDetector = null;
  }
  stopActiveRecording();
  clearHlsDirectory();

  if (ws) {
    ws.close();
  }

  console.log('[Edge] Cleanup complete.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.once('SIGUSR2', async () => {
  console.log('[Edge] SIGUSR2 received (nodemon restarting).');
  await shutdown();
});

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
      trackingEnabled: registeredConfig.trackingEnabled,
      motionThreshold: registeredConfig.motionThreshold,
      pixelChangeThreshold: registeredConfig.pixelChangeThreshold,
    };

    // Connect real-time socket
    connectWS();

    // Start appropriate camera/streaming processes
    await updateCameraState();
  } catch (err: any) {
    console.error('[Edge] Bootstrap failed:', err.message);
    console.log('[Edge] Retrying registration in 10s...');
    setTimeout(bootstrap, 10000);
  }
}

bootstrap();
