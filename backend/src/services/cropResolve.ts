import * as fs from 'fs';
import * as path from 'path';
import prisma from './db';
import { CROPS_DIR } from '../routes/reid';
import { extractCropFromClip } from './reidClipExtract';
import { enrichDetectionWithClipSource } from './reidClipResolve';

const TEMP_DIR = path.join(__dirname, '../storage/temp');

export type EdgeFileFetcher = (
  deviceId: string,
  filename: string,
) => Promise<{ contentType: string; data: Buffer | string }>;

export function cropExistsLocally(filename: string): boolean {
  return fs.existsSync(path.join(CROPS_DIR, filename));
}

async function resolveClipPath(
  clipFilename: string,
  deviceId: string,
  fetchFileFromEdge: EdgeFileFetcher,
): Promise<{ clipPath: string; tempPath: string | null } | null> {
  const clip = await prisma.videoClip.findFirst({ where: { filename: clipFilename } });
  if (!clip) return null;

  if (clip.filepath && fs.existsSync(clip.filepath)) {
    return { clipPath: clip.filepath, tempPath: null };
  }

  try {
    const result = await fetchFileFromEdge(deviceId, clipFilename);
    const buffer = Buffer.isBuffer(result.data)
      ? result.data
      : Buffer.from(result.data as string, 'base64');

    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const tempPath = path.join(TEMP_DIR, `resolve_${clipFilename}`);
    fs.writeFileSync(tempPath, buffer);
    return { clipPath: tempPath, tempPath };
  } catch (err: any) {
    console.warn(`[CropResolve] Failed to fetch clip ${clipFilename} from edge:`, err.message);
    return null;
  }
}

/**
 * Regenerate a missing crop JPEG from its linked clip using bbox + offset metadata.
 * Saves the result to CROPS_DIR and returns the local path, or null on failure.
 */
export async function regenerateCropFromDetection(
  detection: {
    id: string;
    deviceId: string;
    filename: string;
    bbox: string;
    streamId: string | null;
    timestamp: Date;
    clipId: string | null;
    clipFilename: string | null;
    clipOffsetMs: number | null;
  },
  fetchFileFromEdge: EdgeFileFetcher,
): Promise<string | null> {
  const enriched = await enrichDetectionWithClipSource(detection, { persist: true });
  if (!enriched.clipFilename || enriched.clipOffsetMs == null) {
    return null;
  }

  const resolved = await resolveClipPath(enriched.clipFilename, detection.deviceId, fetchFileFromEdge);
  if (!resolved) return null;

  const cropPath = path.join(CROPS_DIR, detection.filename);
  try {
    await extractCropFromClip(
      resolved.clipPath,
      enriched.clipOffsetMs,
      detection.bbox,
      cropPath,
    );
    return cropPath;
  } catch (err: any) {
    console.error(`[CropResolve] Failed to extract crop for ${detection.filename}:`, err.message);
    return null;
  } finally {
    if (resolved.tempPath && fs.existsSync(resolved.tempPath)) {
      try {
        fs.unlinkSync(resolved.tempPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
