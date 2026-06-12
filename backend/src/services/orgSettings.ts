import { OrgSettings as PrismaOrgSettings } from '@prisma/client';
import prisma from './db';

export type OrgSettings = PrismaOrgSettings;

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  videoSummary: true,
  semanticSearch: true,
  aiChat: true,
  reidProcessing: true,
};

const SETTING_KEYS = Object.keys(DEFAULT_ORG_SETTINGS) as (keyof OrgSettings)[];

function mergeSettings(stored: PrismaOrgSettings | null | undefined): OrgSettings {
  const merged = { ...DEFAULT_ORG_SETTINGS };
  if (!stored) return merged;
  for (const key of SETTING_KEYS) {
    if (typeof stored[key] === 'boolean') {
      merged[key] = stored[key];
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
    if (typeof body[key] === 'boolean') {
      patch[key] = body[key] as boolean;
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
