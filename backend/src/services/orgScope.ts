import prisma from './db';
import { getOnlineDeviceIds, onlineDeviceClipWhere } from './deviceStatus';

export async function getOrgDeviceIds(orgId: string): Promise<string[]> {
  const devices = await prisma.edgeDevice.findMany({
    where: { orgId },
    select: { deviceId: true },
  });
  return devices.map((d) => d.deviceId);
}

export async function getOrgOnlineDeviceIds(orgId: string): Promise<string[]> {
  const orgDeviceIds = new Set(await getOrgDeviceIds(orgId));
  const onlineIds = await getOnlineDeviceIds();
  return onlineIds.filter((id) => orgDeviceIds.has(id));
}

export async function orgClipWhere(orgId: string) {
  const onlineInOrg = await getOrgOnlineDeviceIds(orgId);
  return onlineDeviceClipWhere(onlineInOrg);
}

export async function assertDeviceInOrg(deviceId: string, orgId: string): Promise<boolean> {
  const device = await prisma.edgeDevice.findFirst({
    where: { deviceId, orgId },
    select: { deviceId: true },
  });
  return !!device;
}

export async function getDeviceOrgId(deviceId: string): Promise<string | null> {
  const device = await prisma.edgeDevice.findUnique({
    where: { deviceId },
    select: { orgId: true },
  });
  return device?.orgId ?? null;
}

export async function getOrgIdForStream(streamId: string): Promise<string | null> {
  const stream = await prisma.cameraStream.findUnique({
    where: { streamId },
    include: { device: { select: { orgId: true } } },
  });
  return stream?.device?.orgId ?? null;
}

export async function assertIdentityInOrg(identityId: string, orgId: string): Promise<boolean> {
  const identity = await prisma.reidIdentity.findFirst({
    where: { id: identityId, orgId },
    select: { id: true },
  });
  return !!identity;
}

export async function assertClipInOrg(clipId: string, orgId: string): Promise<boolean> {
  const clip = await prisma.videoClip.findUnique({
    where: { id: clipId },
    select: { deviceId: true },
  });
  if (!clip?.deviceId) return false;
  return assertDeviceInOrg(clip.deviceId, orgId);
}
