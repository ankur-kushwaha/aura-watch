import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import type { ReidTrackEvent } from '../routes/reid';
import { extractCropFromClip } from './reidClipExtract';
import { isVehicleClass, selectVehicleTrackEvents } from './yoloSummary';

export interface TrackAppearance {
  heightRatio?: number;
  upperColor?: string;
  lowerColor?: string;
  vehicleColor?: string;
}

/** @deprecated Use TrackAppearance */
export type PersonAppearance = TrackAppearance;

function parseBbox(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(',').map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

export function analyzeAppearanceFromBbox(bbox: string): Pick<TrackAppearance, 'heightRatio'> {
  const parsed = parseBbox(bbox);
  if (!parsed) return {};

  const [x1, y1, x2, y2] = parsed;
  const width = Math.max(x2 - x1, 1);
  const height = Math.max(y2 - y1, 0);
  if (height <= 0) return {};

  return { heightRatio: Math.round((height / width) * 100) / 100 };
}

function rgbToColorName(r: number, g: number, b: number): string {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  if (v < 0.18) return 'black';
  if (v > 0.88 && s < 0.18) return 'white';
  if (s < 0.16) return 'gray';

  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 160) return 'green';
  if (h < 200) return 'cyan';
  if (h < 260) return 'blue';
  if (h < 300) return 'purple';
  return 'pink';
}

const NEUTRAL_COLORS = new Set(['black', 'white', 'gray']);

function dominantColorName(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  yStart: number,
  yEnd: number,
  xStart = 0,
  xEnd?: number,
): string | undefined {
  const xEndResolved = xEnd ?? width;
  const counts = new Map<string, number>();

  for (let y = yStart; y < yEnd; y += 2) {
    for (let x = xStart; x < xEndResolved; x += 2) {
      const idx = (y * width + x) * channels;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const name = rgbToColorName(r, g, b);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  if (counts.size === 0) return undefined;

  return [...counts.entries()]
    .sort((a, b) => {
      const neutralA = NEUTRAL_COLORS.has(a[0]) ? 1 : 0;
      const neutralB = NEUTRAL_COLORS.has(b[0]) ? 1 : 0;
      if (neutralA !== neutralB) return neutralA - neutralB;
      return b[1] - a[1];
    })[0][0];
}

async function analyzeRegionFromCrop(
  cropPath: string,
  region: { yStartRatio: number; yEndRatio: number; xStartRatio?: number; xEndRatio?: number },
): Promise<string | undefined> {
  if (!fs.existsSync(cropPath)) return undefined;

  const { data, info } = await sharp(cropPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width <= 0 || height <= 0 || channels < 3) return undefined;

  const yStart = Math.max(0, Math.floor(height * region.yStartRatio));
  const yEnd = Math.min(height, Math.max(yStart + 1, Math.floor(height * region.yEndRatio)));
  const xStart = Math.max(0, Math.floor(width * (region.xStartRatio ?? 0)));
  const xEnd = Math.min(width, Math.max(xStart + 1, Math.floor(width * (region.xEndRatio ?? 1))));

  return dominantColorName(data, width, height, channels, yStart, yEnd, xStart, xEnd);
}

export async function analyzePersonColorsFromCrop(
  cropPath: string,
): Promise<Pick<TrackAppearance, 'upperColor' | 'lowerColor'>> {
  try {
    const upperColor = await analyzeRegionFromCrop(cropPath, { yStartRatio: 0, yEndRatio: 1 / 3 });
    const lowerColor = await analyzeRegionFromCrop(cropPath, { yStartRatio: 2 / 3, yEndRatio: 1 });
    return {
      ...(upperColor ? { upperColor } : {}),
      ...(lowerColor ? { lowerColor } : {}),
    };
  } catch (error) {
    console.warn(`[Appearance] Failed to analyze person crop ${cropPath}:`, error);
    return {};
  }
}

export async function analyzeVehicleColorFromCrop(
  cropPath: string,
): Promise<Pick<TrackAppearance, 'vehicleColor'>> {
  try {
    const vehicleColor = await analyzeRegionFromCrop(cropPath, {
      yStartRatio: 0.2,
      yEndRatio: 0.8,
      xStartRatio: 0.2,
      xEndRatio: 0.8,
    });
    return vehicleColor ? { vehicleColor } : {};
  } catch (error) {
    console.warn(`[Appearance] Failed to analyze vehicle crop ${cropPath}:`, error);
    return {};
  }
}

/** @deprecated Use analyzePersonColorsFromCrop */
export const analyzeAppearanceFromCrop = analyzePersonColorsFromCrop;

export async function analyzePersonAppearance(
  bbox: string,
  cropPath?: string,
): Promise<TrackAppearance> {
  const appearance: TrackAppearance = {
    ...analyzeAppearanceFromBbox(bbox),
  };

  if (cropPath) {
    Object.assign(appearance, await analyzePersonColorsFromCrop(cropPath));
  }

  return appearance;
}

export async function analyzeTrackAppearance(
  className: string,
  bbox: string,
  cropPath?: string,
): Promise<TrackAppearance> {
  if (isVehicleClass(className)) {
    return cropPath ? await analyzeVehicleAppearance(cropPath) : {};
  }
  return analyzePersonAppearance(bbox, cropPath);
}

export async function analyzeVehicleAppearance(
  cropPath: string,
): Promise<TrackAppearance> {
  return analyzeVehicleColorFromCrop(cropPath);
}

export async function analyzeVehicleAppearancesFromClip(
  clipPath: string,
  trackEvents: ReidTrackEvent[],
  frameWidth?: number,
  frameHeight?: number,
): Promise<Map<number, TrackAppearance>> {
  const vehicleEvents = selectVehicleTrackEvents(trackEvents);
  const appearances = new Map<number, TrackAppearance>();

  for (const event of vehicleEvents) {
    if (event.appearance?.vehicleColor) {
      appearances.set(event.trackId, { vehicleColor: event.appearance.vehicleColor });
      continue;
    }

    const tempPath = path.join(
      os.tmpdir(),
      `vehicle_${event.trackId}_${event.offsetMs}_${Date.now()}.jpg`,
    );

    try {
      await extractCropFromClip(
        clipPath,
        event.offsetMs,
        event.bbox,
        tempPath,
        frameWidth,
        frameHeight,
      );
      const analyzed = await analyzeVehicleColorFromCrop(tempPath);
      if (analyzed.vehicleColor) {
        appearances.set(event.trackId, analyzed);
      }
    } catch (error) {
      console.warn(
        `[Appearance] Failed vehicle color analysis for track ${event.trackId} @ ${event.offsetMs}ms:`,
        error,
      );
    } finally {
      if (fs.existsSync(tempPath)) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  return appearances;
}

export function statureLabel(heightRatio?: number): string | undefined {
  if (heightRatio == null) return undefined;
  if (heightRatio >= 2.2) return 'tall';
  if (heightRatio <= 1.5) return 'compact';
  return 'average';
}

export function formatPersonAppearance(appearance?: TrackAppearance): string | undefined {
  if (!appearance) return undefined;

  const parts: string[] = [];
  if (appearance.upperColor) {
    parts.push(`${appearance.upperColor} upper clothing`);
  }
  if (appearance.lowerColor) {
    parts.push(`${appearance.lowerColor} lower clothing`);
  }

  const stature = statureLabel(appearance.heightRatio);
  if (stature) {
    parts.push(`${stature} stature`);
  }

  if (parts.length === 0) return undefined;
  return parts.join(', ');
}

export function formatTrackAppearance(
  className: string,
  appearance?: TrackAppearance,
): string | undefined {
  if (!appearance) return undefined;

  if (isVehicleClass(className) && appearance.vehicleColor) {
    return `${appearance.vehicleColor} ${className}`;
  }

  return formatPersonAppearance(appearance);
}

export function collectAppearanceColors(appearances: Iterable<TrackAppearance | undefined>): string[] {
  const colors = new Set<string>();
  for (const appearance of appearances) {
    if (!appearance) continue;
    if (appearance.upperColor) colors.add(appearance.upperColor);
    if (appearance.lowerColor) colors.add(appearance.lowerColor);
    if (appearance.vehicleColor) colors.add(appearance.vehicleColor);
  }
  return [...colors];
}

/** @deprecated Use collectAppearanceColors */
export const collectClothingColors = collectAppearanceColors;

export function mergeAppearanceMaps(
  ...maps: Array<Map<number, TrackAppearance> | undefined>
): Map<number, TrackAppearance> {
  const merged = new Map<number, TrackAppearance>();

  for (const map of maps) {
    if (!map) continue;
    for (const [trackId, appearance] of map.entries()) {
      const existing = merged.get(trackId);
      merged.set(trackId, {
        ...existing,
        ...appearance,
        heightRatio: appearance.heightRatio ?? existing?.heightRatio,
        upperColor: appearance.upperColor ?? existing?.upperColor,
        lowerColor: appearance.lowerColor ?? existing?.lowerColor,
        vehicleColor: appearance.vehicleColor ?? existing?.vehicleColor,
      });
    }
  }

  return merged;
}
