import prisma from './db';
import type { Prisma } from '@prisma/client';

export type DeviceEventCategory = 'camera' | 'websocket' | 'device' | 'preview' | 'recovery';
export type DeviceEventSeverity = 'info' | 'warn' | 'error';

export interface RecordDeviceEventInput {
  deviceId: string;
  streamId?: string | null;
  streamName?: string | null;
  orgId?: string | null;
  category: DeviceEventCategory;
  severity: DeviceEventSeverity;
  eventType: string;
  message: string;
  detail?: Prisma.InputJsonValue | null;
  /** Skip insert if the same eventType occurred within this window (ms). */
  dedupeWindowMs?: number;
}

const DEFAULT_DEDUPE_MS = 120_000;
const RETENTION_DAYS = 90;

function extractStreamName(message: string): string | null {
  const match = message.match(/^\[([^\]]+)\]/);
  return match?.[1]?.trim() || null;
}

function classifyCameraError(detail: string): string {
  const lower = detail.toLowerCase();
  if (lower.includes('no route to host') || lower.includes('network is unreachable')) {
    return 'camera_unreachable';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'camera_timeout';
  }
  if (lower.includes('connection refused')) {
    return 'camera_refused';
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized')) {
    return 'camera_auth';
  }
  if (lower.includes('stream lost') || lower.includes('no frame')) {
    return 'camera_stall';
  }
  return 'camera_error';
}

function simplifyCameraDetail(detail: string): string {
  for (const phrase of [
    'No route to host',
    'Network is unreachable',
    'Connection refused',
    'Connection timed out',
  ]) {
    if (detail.toLowerCase().includes(phrase.toLowerCase())) {
      const rtsp = detail.match(/rtsp:\/\/[^\s|)]+/i);
      return rtsp ? `${phrase} — ${rtsp[0]}` : phrase;
    }
  }
  const cleaned = detail.replace(/\s+/g, ' ').trim();
  return cleaned.length > 240 ? `${cleaned.slice(0, 237)}...` : cleaned;
}

export function parseNetworkEventFromLog(message: string): Omit<RecordDeviceEventInput, 'deviceId' | 'orgId'> | null {
  const streamName = extractStreamName(message);

  const failedOpen = message.match(/Failed to open camera \(([\s\S]+?)\)\. Retrying in (\d+)s/i);
  if (failedOpen) {
    const detail = failedOpen[1];
    return {
      streamId: null,
      streamName,
      category: 'camera',
      severity: 'error',
      eventType: classifyCameraError(detail),
      message: streamName
        ? `[${streamName}] ${simplifyCameraDetail(detail)}`
        : simplifyCameraDetail(detail),
      detail: {
        streamName,
        retryInSec: Number.parseInt(failedOpen[2], 10),
        raw: detail,
      },
    };
  }

  const noFrames = message.match(/Camera opened but no frames \(([\s\S]+?)\)\. Retrying in (\d+)s/i);
  if (noFrames) {
    const detail = noFrames[1];
    return {
      streamId: null,
      streamName,
      category: 'camera',
      severity: 'error',
      eventType: 'camera_no_frames',
      message: streamName
        ? `[${streamName}] ${simplifyCameraDetail(detail)}`
        : simplifyCameraDetail(detail),
      detail: {
        streamName,
        retryInSec: Number.parseInt(noFrames[2], 10),
        raw: detail,
      },
    };
  }

  const detector = message.match(/\[Detector Error\]\s*([\s\S]+?)\.\s*Reconnecting/i);
  if (detector) {
    const detail = detector[1];
    return {
      streamId: null,
      streamName,
      category: 'camera',
      severity: 'error',
      eventType: classifyCameraError(detail),
      message: streamName
        ? `[${streamName}] ${simplifyCameraDetail(detail)}`
        : simplifyCameraDetail(detail),
      detail: { streamName, raw: detail },
    };
  }

  if (/Reconnected to cloud hub/i.test(message)) {
    return {
      streamId: null,
      streamName,
      category: 'websocket',
      severity: 'info',
      eventType: 'websocket_reconnected',
      message,
    };
  }

  if (/Cloud WebSocket (error|disconnected)/i.test(message)) {
    return {
      streamId: null,
      streamName,
      category: 'websocket',
      severity: 'warn',
      eventType: 'websocket_error',
      message,
    };
  }

  if (/Resuming live preview after cloud reconnect/i.test(message)) {
    return {
      streamId: null,
      streamName,
      category: 'recovery',
      severity: 'info',
      eventType: 'preview_resumed',
      message,
      detail: { streamName },
    };
  }

  return null;
}

export function shouldPersistHubLog(message: string): boolean {
  return (
    /Failed to open camera/i.test(message) ||
    /Camera opened but no frames/i.test(message) ||
    /\[Detector Error\]/i.test(message) ||
    /Reconnected to cloud hub/i.test(message) ||
    /Cloud WebSocket/i.test(message) ||
    /Resuming live preview/i.test(message) ||
    /Edge device connected/i.test(message) ||
    /Edge device disconnected/i.test(message) ||
    /heartbeat timed out/i.test(message)
  );
}

async function resolveStreamId(
  deviceId: string,
  streamId?: string | null,
  streamName?: string | null,
): Promise<string | null> {
  if (streamId) return streamId;
  if (!streamName) return null;

  const stream = await prisma.cameraStream.findFirst({
    where: { deviceId, name: streamName },
    select: { streamId: true },
  });
  return stream?.streamId ?? null;
}

async function resolveOrgId(deviceId: string, orgId?: string | null): Promise<string | null> {
  if (orgId) return orgId;
  const device = await prisma.edgeDevice.findUnique({
    where: { deviceId },
    select: { orgId: true },
  });
  return device?.orgId ?? null;
}

async function isDuplicate(
  deviceId: string,
  streamId: string | null | undefined,
  eventType: string,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const existing = await prisma.deviceEvent.findFirst({
    where: {
      deviceId,
      eventType,
      createdAt: { gte: since },
      ...(streamId ? { streamId } : {}),
    },
    select: { id: true },
  });
  return !!existing;
}

async function pruneOldEvents(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.deviceEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
}

let lastPruneAt = 0;

export async function recordDeviceEvent(input: RecordDeviceEventInput): Promise<void> {
  const dedupeWindowMs = input.dedupeWindowMs ?? DEFAULT_DEDUPE_MS;
  const streamName = input.streamName ?? null;
  const resolvedStreamId = await resolveStreamId(input.deviceId, input.streamId, streamName);
  const resolvedOrgId = await resolveOrgId(input.deviceId, input.orgId);

  if (
    await isDuplicate(input.deviceId, resolvedStreamId, input.eventType, dedupeWindowMs)
  ) {
    return;
  }

  await prisma.deviceEvent.create({
    data: {
      deviceId: input.deviceId,
      streamId: resolvedStreamId,
      orgId: resolvedOrgId,
      category: input.category,
      severity: input.severity,
      eventType: input.eventType,
      message: input.message,
      detail: input.detail ?? undefined,
    },
  });

  const now = Date.now();
  if (now - lastPruneAt > 60 * 60 * 1000) {
    lastPruneAt = now;
    void pruneOldEvents().catch((err) => {
      console.error('[DeviceEvents] Retention prune failed:', err);
    });
  }
}

export async function recordDeviceEventFromLog(
  deviceId: string,
  message: string,
  orgId?: string | null,
): Promise<void> {
  if (!shouldPersistHubLog(message)) return;

  const parsed = parseNetworkEventFromLog(message);
  if (!parsed) return;

  await recordDeviceEvent({
    deviceId,
    orgId,
    ...parsed,
  });
}

export async function getDeviceEvents(
  deviceId: string,
  options: {
    orgId: string;
    limit?: number;
    streamId?: string;
    since?: Date;
  },
) {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const device = await prisma.edgeDevice.findFirst({
    where: { deviceId, orgId: options.orgId },
    select: { deviceId: true },
  });
  if (!device) return [];

  return prisma.deviceEvent.findMany({
    where: {
      deviceId,
      ...(options.streamId ? { streamId: options.streamId } : {}),
      ...(options.since ? { createdAt: { gte: options.since } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export function recordDeviceEventSafe(input: RecordDeviceEventInput): void {
  void recordDeviceEvent(input).catch((err) => {
    console.error(`[DeviceEvents] Failed to record ${input.eventType} for ${input.deviceId}:`, err);
  });
}

export function recordDeviceEventFromLogSafe(
  deviceId: string,
  message: string,
  orgId?: string | null,
): void {
  void recordDeviceEventFromLog(deviceId, message, orgId).catch((err) => {
    console.error(`[DeviceEvents] Failed to record log event for ${deviceId}:`, err);
  });
}
