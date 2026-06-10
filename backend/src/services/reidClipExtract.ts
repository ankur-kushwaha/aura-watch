import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

async function probeVideoDimensions(videoPath: string): Promise<{ width: number; height: number }> {
  const result = await execAsync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${videoPath}"`,
    { maxBuffer: 1024 * 1024 },
  );
  const [widthStr, heightStr] = result.stdout.trim().split(',');
  const width = parseInt(widthStr, 10);
  const height = parseInt(heightStr, 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Could not probe video dimensions for ${videoPath}`);
  }
  return { width, height };
}

function scaleBbox(
  bbox: string,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): { x1: number; y1: number; w: number; h: number } {
  const parts = bbox.split(',').map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid bbox: ${bbox}`);
  }

  const [x1, y1, x2, y2] = parts;
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;

  const sx1 = Math.max(0, Math.min(targetWidth - 1, Math.round(x1 * scaleX)));
  const sy1 = Math.max(0, Math.min(targetHeight - 1, Math.round(y1 * scaleY)));
  const sx2 = Math.max(0, Math.min(targetWidth, Math.round(x2 * scaleX)));
  const sy2 = Math.max(0, Math.min(targetHeight, Math.round(y2 * scaleY)));

  const w = sx2 - sx1;
  const h = sy2 - sy1;
  if (w <= 0 || h <= 0) {
    throw new Error(`Invalid scaled bbox dimensions for ${bbox}`);
  }

  return { x1: sx1, y1: sy1, w, h };
}

/**
 * Extract a person crop from a clip at offsetMs using bbox coordinates in source frame space.
 */
export async function extractCropFromClip(
  clipPath: string,
  offsetMs: number,
  bbox: string,
  outputPath: string,
  sourceFrameWidth?: number,
  sourceFrameHeight?: number,
): Promise<void> {
  if (!fs.existsSync(clipPath)) {
    throw new Error(`Clip not found: ${clipPath}`);
  }

  const { width: videoWidth, height: videoHeight } = await probeVideoDimensions(clipPath);
  const srcW = sourceFrameWidth && sourceFrameWidth > 0 ? sourceFrameWidth : videoWidth;
  const srcH = sourceFrameHeight && sourceFrameHeight > 0 ? sourceFrameHeight : videoHeight;

  const { x1, y1, w, h } = scaleBbox(bbox, srcW, srcH, videoWidth, videoHeight);
  const offsetSec = Math.max(0, offsetMs / 1000).toFixed(3);
  const cropFilter = `crop=${w}:${h}:${x1}:${y1}`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  await execAsync(
    `ffmpeg -y -ss ${offsetSec} -i "${clipPath}" -vf "${cropFilter}" -frames:v 1 -q:v 2 "${outputPath}"`,
    { maxBuffer: 10 * 1024 * 1024 },
  );

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error(`ffmpeg did not produce crop image at offset ${offsetMs}ms`);
  }
}
