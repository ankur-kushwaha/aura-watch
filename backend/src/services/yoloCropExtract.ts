import * as fs from 'fs';
import * as path from 'path';
import type { ReidTrackEvent } from '../routes/reid';
import { CROPS_DIR } from '../routes/reid';
import { extractCropFromClip } from './reidClipExtract';
import { cropExistsLocally } from './cropResolve';

export interface YoloCropMeta {
  cropFilename: string;
  clipOffsetMs: number;
  bbox: string;
}

/** Pick the highest-confidence track event per track for crop extraction. */
export function selectBestCropEventPerTrack(trackEvents: ReidTrackEvent[]): Map<number, ReidTrackEvent> {
  const byTrack = new Map<number, ReidTrackEvent>();

  for (const event of trackEvents) {
    const existing = byTrack.get(event.trackId);
    if (!existing || event.confidence > existing.confidence) {
      byTrack.set(event.trackId, event);
    }
  }

  return byTrack;
}

function yoloCropFilename(clipStartMs: number, deviceId: string, trackId: number, offsetMs: number): string {
  return `crop_${clipStartMs + offsetMs}_${deviceId}_${trackId}.jpg`;
}

/**
 * Extract preview crops from YOLO track events (snapshots + failed ReID events).
 * Does not create ReID profiles — only saves JPEG crops for UI display.
 */
export async function extractYoloPreviewCrops(
  clipPath: string,
  deviceId: string,
  clipStartMs: number,
  trackEvents: ReidTrackEvent[],
  frameWidth?: number,
  frameHeight?: number,
): Promise<Map<number, YoloCropMeta>> {
  const result = new Map<number, YoloCropMeta>();
  if (!trackEvents.length || !fs.existsSync(clipPath)) return result;

  const bestPerTrack = selectBestCropEventPerTrack(trackEvents);

  for (const [trackId, event] of bestPerTrack) {
    const cropFilename = yoloCropFilename(clipStartMs, deviceId, trackId, event.offsetMs);
    const cropPath = path.join(CROPS_DIR, cropFilename);

    if (!cropExistsLocally(cropFilename)) {
      try {
        await extractCropFromClip(
          clipPath,
          event.offsetMs,
          event.bbox,
          cropPath,
          frameWidth,
          frameHeight,
        );
      } catch (err: any) {
        console.warn(
          `[YoloCrop] Failed to extract preview crop for track ${trackId} @ ${event.offsetMs}ms:`,
          err.message,
        );
        continue;
      }
    }

    result.set(trackId, {
      cropFilename,
      clipOffsetMs: event.offsetMs,
      bbox: event.bbox,
    });
  }

  return result;
}
