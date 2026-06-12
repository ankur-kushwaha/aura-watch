import prisma from './db';

export const HEARTBEAT_OFFLINE_THRESHOLD_MS = 30_000;

export function getEffectiveDeviceStatus(
  status: string,
  lastHeartbeat: Date | string,
  now: Date = new Date(),
): string {
  const isStale =
    now.getTime() - new Date(lastHeartbeat).getTime() > HEARTBEAT_OFFLINE_THRESHOLD_MS;
  if (isStale && status !== 'Offline') {
    return 'Offline';
  }
  return status;
}

export function isDeviceOnline(
  status: string,
  lastHeartbeat: Date | string,
  now: Date = new Date(),
): boolean {
  return getEffectiveDeviceStatus(status, lastHeartbeat, now) !== 'Offline';
}

export async function getOnlineDeviceIds(now: Date = new Date()): Promise<string[]> {
  const devices = await prisma.edgeDevice.findMany({
    select: { deviceId: true, status: true, lastHeartbeat: true },
  });

  return devices
    .filter((device) => isDeviceOnline(device.status, device.lastHeartbeat, now))
    .map((device) => device.deviceId);
}

/** Prisma filter: clips/detections from online edge devices (or with no deviceId). */
export function onlineDeviceClipWhere(onlineDeviceIds: string[]) {
  if (onlineDeviceIds.length === 0) {
    return { deviceId: { in: [] as string[] } };
  }
  return {
    OR: [
      { deviceId: { in: onlineDeviceIds } },
      { deviceId: null },
    ],
  };
}
