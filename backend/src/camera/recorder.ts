import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface RecordOptions {
  streamUrl: string;
  cameraType: 'webcam' | 'rtsp';
  outputPath: string;
  durationSeconds?: number;
}

/**
 * Records a video clip from the specified stream or camera device.
 */
export function recordClip(options: RecordOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const { streamUrl, cameraType, outputPath, durationSeconds = 10 } = options;

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let args: string[] = [];

    if (cameraType === 'webcam') {
      if (process.platform === 'darwin') {
        // macOS Webcam capture using avfoundation
        // Device index 0 is MacBook Air Camera
        args = [
          '-y',
          '-f', 'avfoundation',
          '-framerate', '30',
          '-i', '0',
          '-t', durationSeconds.toString(),
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-pix_fmt', 'yuv420p',
          '-an', // No audio
          outputPath
        ];
      } else {
        // Linux Webcam capture using v4l2
        args = [
          '-y',
          '-f', 'v4l2',
          '-i', '/dev/video0',
          '-t', durationSeconds.toString(),
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-pix_fmt', 'yuv420p',
          '-an',
          outputPath
        ];
      }
    } else {
      // RTSP capture
      args = [
        '-y',
        '-rtsp_transport', 'tcp', // Use TCP for RTSP stability
        '-i', streamUrl,
        '-t', durationSeconds.toString(),
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-an',
        outputPath
      ];
    }

    console.log(`[Recorder] Spawning: ffmpeg ${args.join(' ')}`);
    const ffmpeg = spawn('ffmpeg', args);

    let stderrOutput = '';
    ffmpeg.stderr.on('data', (data) => {
      stderrOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log(`[Recorder] Recording successful. File saved: ${outputPath}`);
        resolve();
      } else {
        console.error(`[Recorder] FFmpeg failed with exit code ${code}`);
        console.error(`[Recorder] FFmpeg output: ${stderrOutput}`);
        reject(new Error(`FFmpeg exited with code ${code}. ${stderrOutput.substring(stderrOutput.length - 200)}`));
      }
    });

    ffmpeg.on('error', (err) => {
      console.error(`[Recorder] Error starting FFmpeg:`, err);
      reject(err);
    });
  });
}
