import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

const BBOX_PADDING_RATIO = 0.1;

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

function parseBbox(bbox: string): [number, number, number, number] {
  const parts = bbox.split(',').map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid bbox: ${bbox}`);
  }
  return parts as [number, number, number, number];
}

/** Add margin around a bbox and clamp to frame bounds. */
export function padBbox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  frameWidth: number,
  frameHeight: number,
  paddingRatio = BBOX_PADDING_RATIO,
): { x1: number; y1: number; w: number; h: number } {
  const w = x2 - x1;
  const h = y2 - y1;
  const padX = Math.round(w * paddingRatio);
  const padY = Math.round(h * paddingRatio);

  const px1 = Math.max(0, x1 - padX);
  const py1 = Math.max(0, y1 - padY);
  const px2 = Math.min(frameWidth, x2 + padX);
  const py2 = Math.min(frameHeight, y2 + padY);

  const pw = px2 - px1;
  const ph = py2 - py1;
  if (pw <= 0 || ph <= 0) {
    throw new Error(`Invalid padded bbox dimensions for ${x1},${y1},${x2},${y2}`);
  }

  return { x1: px1, y1: py1, w: pw, h: ph };
}

export function scaleBbox(
  bbox: string,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  paddingRatio = BBOX_PADDING_RATIO,
): { x1: number; y1: number; w: number; h: number } {
  const [x1, y1, x2, y2] = parseBbox(bbox);
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;

  const sx1 = Math.round(x1 * scaleX);
  const sy1 = Math.round(y1 * scaleY);
  const sx2 = Math.round(x2 * scaleX);
  const sy2 = Math.round(y2 * scaleY);

  return padBbox(sx1, sy1, sx2, sy2, targetWidth, targetHeight, paddingRatio);
}

/**
 * Extract a person crop from a clip at offsetMs using bbox coordinates in source frame space.
 * Falls back to ffmpeg clip extraction; prefer edge-uploaded JPEGs when available.
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

  // -ss after -i for frame-accurate seek (bbox must match the frame at offsetMs)
  await execAsync(
    `ffmpeg -y -i "${clipPath}" -ss ${offsetSec} -vf "${cropFilter}" -frames:v 1 -q:v 2 "${outputPath}"`,
    { maxBuffer: 10 * 1024 * 1024 },
  );

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error(`ffmpeg did not produce crop image at offset ${offsetMs}ms`);
  }
}
