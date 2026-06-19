import { OrgSettings as PrismaOrgSettings } from '@prisma/client';
import prisma from './db';

export type OrgSettings = PrismaOrgSettings;

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  videoSummary: true,
  semanticSearch: true,
  aiChat: true,
  reidProcessing: true,
  notificationsEnabled: true,
  notifyMinSeverity: 'warn',
  notifyEmail: false,
  notifyWebhookUrl: null,
};

const SETTING_KEYS = Object.keys(DEFAULT_ORG_SETTINGS) as (keyof OrgSettings)[];

function mergeSettings(stored: PrismaOrgSettings | null | undefined): OrgSettings {
  const merged = { ...DEFAULT_ORG_SETTINGS };
  if (!stored) return merged;
  for (const key of SETTING_KEYS) {
    const value = stored[key];
    if (typeof value === 'boolean' || typeof value === 'string') {
      (merged as any)[key] = value;
    }
  }
  return merged;
}

export async function getOrgSettings(orgId: string): Promise<OrgSettings> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  return mergeSettings(org?.settings);
}

export function parseOrgSettingsPatch(body: Record<string, unknown>): Partial<OrgSettings> {
  const patch: Partial<OrgSettings> = {};
  for (const key of SETTING_KEYS) {
    const value = body[key];
    if (key === 'notifyWebhookUrl') {
      if (typeof value === 'string' || value === null) {
        (patch as any)[key] = value;
      }
    } else if (key === 'notifyMinSeverity') {
      if (typeof value === 'string' && ['info', 'warn', 'error'].includes(value)) {
        (patch as any)[key] = value;
      }
    } else if (typeof value === 'boolean') {
      (patch as any)[key] = value;
    }
  }
  return patch;
}

export async function updateOrgSettings(
  orgId: string,
  patch: Partial<OrgSettings>,
): Promise<OrgSettings> {
  const current = await getOrgSettings(orgId);
  const next = { ...current, ...patch };

  await prisma.organization.update({
    where: { id: orgId },
    data: { settings: next },
  });

  return next;
}
