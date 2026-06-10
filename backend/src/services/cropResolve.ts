import * as fs from 'fs';
import * as path from 'path';
import prisma from './db';
import { CROPS_DIR } from '../routes/reid';
import { extractCropFromClip } from './reidClipExtract';
import { enrichDetectionWithClipSource } from './reidClipResolve';
import type { EdgeFileFetcher } from './edgeFileFetch';

const TEMP_DIR = path.join(__dirname, '../storage/temp');

export type { EdgeFileFetcher };

export function cropExistsLocally(filename: string): boolean {
  return fs.existsSync(path.join(CROPS_DIR, filename));
}

export type CoverCandidate = {
  filename: string;
  clipFilename: string | null;
  clipOffsetMs: number | null;
};

/** Prefer a detection whose crop file exists or can be regenerated from clip metadata. */
export function rankCoverCandidates<T extends CoverCandidate>(candidates: T[]): T[] {
  if (candidates.length <= 1) return candidates;

  const withLocalFile = candidates.filter((c) => cropExistsLocally(c.filename));
  const withClipMeta = candidates.filter((c) => c.clipFilename && c.clipOffsetMs != null);
  const rest = candidates.filter(
    (c) => !cropExistsLocally(c.filename) && !(c.clipFilename && c.clipOffsetMs != null),
  );

  return [...withLocalFile, ...withClipMeta, ...rest];
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

type CropDetection = {
  id: string;
  deviceId: string;
  filename: string;
  bbox: string;
  streamId: string | null;
  timestamp: Date;
  clipId: string | null;
  clipFilename: string | null;
  clipOffsetMs: number | null;
};

/** Resolve crop bytes from local storage, edge proxy, or clip extraction. */
export async function resolveCropImageBuffer(
  detection: CropDetection,
  fetchFileFromEdge: EdgeFileFetcher,
): Promise<Buffer | null> {
  const localPath = path.join(CROPS_DIR, detection.filename);
  if (fs.existsSync(localPath)) {
    return fs.readFileSync(localPath);
  }

  try {
    const result = await fetchFileFromEdge(detection.deviceId, detection.filename);
    const buffer = Buffer.isBuffer(result.data)
      ? result.data
      : Buffer.from(result.data as string, 'base64');
    fs.writeFileSync(localPath, buffer);
    return buffer;
  } catch (edgeErr: any) {
    console.warn(`[CropResolve] Edge fetch failed for ${detection.filename}:`, edgeErr.message);
  }

  const regenerated = await regenerateCropFromDetection(detection, fetchFileFromEdge);
  if (regenerated && fs.existsSync(regenerated)) {
    return fs.readFileSync(regenerated);
  }

  return null;
}
