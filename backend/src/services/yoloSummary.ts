import type { ReidTrackEvent } from '../routes/reid';
import type { TrackAppearance } from './cropAppearance';
import { formatTrackAppearance, analyzeAppearanceFromBbox } from './cropAppearance';

export type { TrackAppearance as PersonAppearance };

export type ScreenZone = 'left' | 'center' | 'right';

export interface TrackAnalysis {
  trackId: number;
  className: string;
  firstSeenMs: number;
  lastSeenMs: number;
  maxConfidence: number;
  zones: ScreenZone[];
  direction?: 'left-to-right' | 'right-to-left' | 'approaching' | 'receding' | 'stationary';
  appearance?: TrackAppearance;
}

const VEHICLE_CLASSES = new Set(['bicycle', 'car', 'motorcycle', 'bus', 'truck']);

export function isVehicleClass(className: string): boolean {
  return VEHICLE_CLASSES.has(className);
}

export function isReidEligibleClass(className: string): boolean {
  return className === 'person' || isVehicleClass(className);
}

export function selectVehicleTrackEvents(trackEvents: ReidTrackEvent[]): ReidTrackEvent[] {
  const snapshotEvents = trackEvents.filter(
    (event) => event.kind === 'snapshot' && isVehicleClass(event.className),
  );
  const candidates = snapshotEvents.length > 0
    ? snapshotEvents
    : trackEvents.filter((event) => isVehicleClass(event.className));

  const byTrack = new Map<number, ReidTrackEvent>();
  for (const event of candidates) {
    const existing = byTrack.get(event.trackId);
    if (!existing || event.confidence > existing.confidence) {
      byTrack.set(event.trackId, event);
    }
  }

  return [...byTrack.values()];
}

function parseBbox(bbox: string): [number, number, number, number] | null {
  const parts = bbox.split(',').map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

function bboxCenter(bbox: [number, number, number, number]): [number, number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function bboxArea(bbox: [number, number, number, number]): number {
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
}

function zoneFromBbox(bbox: [number, number, number, number], frameWidth: number): ScreenZone {
  const [cx] = bboxCenter(bbox);
  const ratio = frameWidth > 0 ? cx / frameWidth : 0.5;
  if (ratio < 0.33) return 'left';
  if (ratio > 0.66) return 'right';
  return 'center';
}

function directionLabel(
  first: [number, number, number, number],
  last: [number, number, number, number],
  frameWidth: number,
  frameHeight: number,
): TrackAnalysis['direction'] {
  const [fx, fy] = bboxCenter(first);
  const [lx, ly] = bboxCenter(last);
  const firstArea = bboxArea(first);
  const lastArea = bboxArea(last);

  const dx = lx - fx;
  const dy = ly - fy;
  const moveThresholdX = Math.max(frameWidth * 0.08, 24);
  const moveThresholdY = Math.max(frameHeight * 0.05, 16);

  if (firstArea > 0) {
    const areaRatio = lastArea / firstArea;
    if (areaRatio >= 1.35) return 'approaching';
    if (areaRatio <= 0.72) return 'receding';
  }

  if (Math.abs(dx) >= moveThresholdX && Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? 'left-to-right' : 'right-to-left';
  }

  if (Math.abs(dx) < moveThresholdX && Math.abs(dy) < moveThresholdY) {
    return 'stationary';
  }

  return undefined;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

function mergeAppearance(
  current?: TrackAppearance,
  next?: TrackAppearance,
): TrackAppearance | undefined {
  if (!current && !next) return undefined;
  return {
    ...current,
    ...next,
    heightRatio: next?.heightRatio ?? current?.heightRatio,
    upperColor: next?.upperColor ?? current?.upperColor,
    lowerColor: next?.lowerColor ?? current?.lowerColor,
    vehicleColor: next?.vehicleColor ?? current?.vehicleColor,
  };
}

function appearanceFromTrackEvents(
  trackId: number,
  trackEvents: ReidTrackEvent[],
): TrackAppearance | undefined {
  let appearance: TrackAppearance | undefined;
  let bestConfidence = -1;

  for (const event of trackEvents) {
    if (event.trackId !== trackId) continue;

    if (event.appearance) {
      appearance = mergeAppearance(appearance, event.appearance);
    }

    if (event.className === 'person' && event.confidence >= bestConfidence) {
      bestConfidence = event.confidence;
      appearance = mergeAppearance(appearance, analyzeAppearanceFromBbox(event.bbox));
    }
  }

  return appearance;
}

export function buildAppearanceMap(
  trackEvents: ReidTrackEvent[],
  analyzedAppearances?: Map<number, TrackAppearance>,
): Map<number, TrackAppearance> {
  const byTrack = new Map<number, ReidTrackEvent[]>();
  for (const event of trackEvents) {
    const list = byTrack.get(event.trackId) ?? [];
    list.push(event);
    byTrack.set(event.trackId, list);
  }

  const merged = new Map<number, TrackAppearance>();
  for (const [trackId, events] of byTrack.entries()) {
    let appearance = appearanceFromTrackEvents(trackId, events);
    if (analyzedAppearances?.has(trackId)) {
      appearance = mergeAppearance(appearance, analyzedAppearances.get(trackId));
    }
    if (appearance && Object.keys(appearance).length > 0) {
      merged.set(trackId, appearance);
    }
  }

  return merged;
}

function eventsForSummary(trackEvents: ReidTrackEvent[]): ReidTrackEvent[] {
  const snapshots = trackEvents.filter((e) => e.kind === 'snapshot');
  return snapshots.length > 0 ? snapshots : trackEvents;
}

export function analyzeTrackEvents(
  trackEvents: ReidTrackEvent[],
  frameWidth = 640,
  frameHeight = 480,
  appearanceByTrack?: Map<number, TrackAppearance>,
): TrackAnalysis[] {
  const events = eventsForSummary(trackEvents);
  const byTrack = new Map<number, ReidTrackEvent[]>();

  for (const event of events) {
    if (event.trackId == null) continue;
    const list = byTrack.get(event.trackId) ?? [];
    list.push(event);
    byTrack.set(event.trackId, list);
  }

  const analyses: TrackAnalysis[] = [];

  for (const [trackId, trackEventsForId] of byTrack.entries()) {
    const sorted = [...trackEventsForId].sort((a, b) => a.offsetMs - b.offsetMs);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const className = sorted.reduce(
      (best, event) => (event.confidence > best.confidence ? event : best),
      first,
    ).className || 'object';

    const zoneSet = new Set<ScreenZone>();
    let maxConfidence = 0;
    let firstBbox: [number, number, number, number] | null = null;
    let lastBbox: [number, number, number, number] | null = null;

    for (const event of sorted) {
      maxConfidence = Math.max(maxConfidence, event.confidence);
      const bbox = parseBbox(event.bbox);
      if (!bbox) continue;
      zoneSet.add(zoneFromBbox(bbox, frameWidth));
      if (!firstBbox) firstBbox = bbox;
      lastBbox = bbox;
    }

    analyses.push({
      trackId,
      className,
      firstSeenMs: first.offsetMs,
      lastSeenMs: last.offsetMs,
      maxConfidence,
      zones: [...zoneSet],
      direction:
        firstBbox && lastBbox
          ? directionLabel(firstBbox, lastBbox, frameWidth, frameHeight)
          : undefined,
      appearance: appearanceByTrack?.get(trackId),
    });
  }

  return analyses.sort((a, b) => a.firstSeenMs - b.firstSeenMs);
}

function describeTrack(track: TrackAnalysis): string {
  const visibleFor = track.lastSeenMs - track.firstSeenMs;
  const parts: string[] = [
    `${track.className} track #${track.trackId}`,
    `visible ${formatSeconds(track.firstSeenMs)}–${formatSeconds(track.lastSeenMs)}`,
  ];

  if (visibleFor >= 250) {
    parts.push(`(${formatSeconds(visibleFor)} total)`);
  }

  if (track.zones.length > 0) {
    parts.push(`in ${track.zones.join('/') } frame`);
  }

  if (track.direction) {
    const directionText: Record<NonNullable<TrackAnalysis['direction']>, string> = {
      'left-to-right': 'moving left to right',
      'right-to-left': 'moving right to left',
      approaching: 'approaching camera',
      receding: 'moving away from camera',
      stationary: 'mostly stationary',
    };
    parts.push(directionText[track.direction]);
  }

  const appearanceText = formatTrackAppearance(track.className, track.appearance);
  if (appearanceText) {
    parts.push(appearanceText);
  }

  parts.push(`${Math.round(track.maxConfidence * 100)}% confidence`);
  return parts.join(', ');
}

export function buildYoloSummary(
  trackEvents: ReidTrackEvent[],
  cameraName: string,
  duration: number,
  frameWidth = 640,
  frameHeight = 480,
  analyzedAppearances?: Map<number, TrackAppearance>,
): string {
  const clipDuration = Number.isFinite(duration) && duration > 0 ? duration : 10;
  const appearanceByTrack = buildAppearanceMap(trackEvents, analyzedAppearances);
  const analyses = analyzeTrackEvents(trackEvents, frameWidth, frameHeight, appearanceByTrack);

  if (analyses.length === 0) {
    return `No objects were detected on ${cameraName} during this ${clipDuration.toFixed(0)}s clip.`;
  }

  const classCounts = new Map<string, number>();
  for (const track of analyses) {
    classCounts.set(track.className, (classCounts.get(track.className) ?? 0) + 1);
  }

  const countParts = [...classCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([className, count]) => `${count} ${pluralize(count, className)}`);

  const lines = [
    `${cameraName}, ${clipDuration.toFixed(0)}s clip. Detected: ${countParts.join(', ')}.`,
  ];

  for (const track of analyses) {
    lines.push(describeTrack(track));
  }

  const peakConcurrent = estimatePeakConcurrent(eventsForSummary(trackEvents));
  if (peakConcurrent > 1) {
    lines.push(`Up to ${peakConcurrent} objects were visible at the same time.`);
  }

  return lines.join(' ');
}

function estimatePeakConcurrent(events: ReidTrackEvent[]): number {
  type Point = { ms: number; delta: number };
  const points: Point[] = [];

  const byTrack = new Map<number, { start: number; end: number }>();
  for (const event of events) {
    const existing = byTrack.get(event.trackId);
    if (!existing) {
      byTrack.set(event.trackId, { start: event.offsetMs, end: event.offsetMs });
    } else {
      existing.start = Math.min(existing.start, event.offsetMs);
      existing.end = Math.max(existing.end, event.offsetMs);
    }
  }

  for (const span of byTrack.values()) {
    points.push({ ms: span.start, delta: 1 });
    points.push({ ms: span.end + 1, delta: -1 });
  }

  points.sort((a, b) => a.ms - b.ms || a.delta - b.delta);

  let current = 0;
  let peak = 0;
  for (const point of points) {
    current += point.delta;
    peak = Math.max(peak, current);
  }

  return peak;
}

export function buildClipSearchText(summary: string, aiSummary?: string | null): string {
  const parts = [summary.trim(), aiSummary?.trim()].filter(Boolean);
  return parts.join('\n\n');
}

export function buildClipIndexStats(detectedObjects: unknown): {
  classNames: string[];
  personCount: number;
  vehicleCount: number;
  hasVehicle: boolean;
  clothingColors: string[];
} {
  const objects = Array.isArray(detectedObjects)
    ? detectedObjects as { className?: string; upperColor?: string; lowerColor?: string; vehicleColor?: string }[]
    : [];

  const classNames = [...new Set(objects.map((o) => o.className).filter(Boolean))] as string[];
  const personCount = objects.filter((o) => o.className === 'person').length;
  const vehicleCount = objects.filter((o) => o.className && VEHICLE_CLASSES.has(o.className)).length;
  const clothingColors = [...new Set(
    objects.flatMap((o) => [o.upperColor, o.lowerColor, o.vehicleColor].filter(Boolean) as string[]),
  )];

  return {
    classNames,
    personCount,
    vehicleCount,
    hasVehicle: vehicleCount > 0,
    clothingColors,
  };
}

export function formatClipContextSummary(payload: {
  summary?: string | null;
  aiSummary?: string | null;
}): string {
  const detection = payload.summary?.trim();
  const ai = payload.aiSummary?.trim();
  if (detection && ai) {
    return `Detection summary: ${detection}\nAI summary: ${ai}`;
  }
  return detection || ai || 'No summary available.';
}

export function selectReidTrackEvents(trackEvents: ReidTrackEvent[]): ReidTrackEvent[] {
  const reidEvents = trackEvents.filter(
    (event) => event.kind !== 'snapshot' && isReidEligibleClass(event.className || 'person'),
  );

  const byTrack = new Map<number, ReidTrackEvent>();
  for (const event of reidEvents) {
    const existing = byTrack.get(event.trackId);
    if (!existing || event.confidence > existing.confidence) {
      byTrack.set(event.trackId, event);
    }
  }

  return [...byTrack.values()];
}
