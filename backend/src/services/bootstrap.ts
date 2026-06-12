import prisma from './db';
import { hashPassword, slugify } from './auth';

/**
 * Migrates legacy single-tenant data and optionally seeds a bootstrap admin user.
 */
export async function bootstrapMultiOrg() {
  let defaultOrg = await prisma.organization.findFirst({
    where: { slug: 'default' },
  });

  if (!defaultOrg) {
    defaultOrg = await prisma.organization.create({
      data: { name: 'Default Organization', slug: 'default' },
    });
    console.log('[Bootstrap] Created default organization');
  }

  const allDevices = await prisma.edgeDevice.findMany();
  const devicesNeedingOrg = allDevices.filter((d) => !d.orgId);

  if (devicesNeedingOrg.length > 0) {
    await prisma.edgeDevice.updateMany({
      where: { id: { in: devicesNeedingOrg.map((d) => d.id) } },
      data: { orgId: defaultOrg.id },
    });
    console.log(`[Bootstrap] Assigned ${devicesNeedingOrg.length} device(s) to default org`);
  }

  const identities = await prisma.reidIdentity.findMany();
  const identitiesNeedingOrg = identities.filter((i) => !i.orgId);
  if (identitiesNeedingOrg.length > 0) {
    await prisma.reidIdentity.updateMany({
      where: { id: { in: identitiesNeedingOrg.map((i) => i.id) } },
      data: { orgId: defaultOrg.id },
    });
    console.log(`[Bootstrap] Assigned ${identitiesNeedingOrg.length} Reid identity(ies) to default org`);
  }

  const routes = await prisma.topologyRoute.findMany();
  const routesNeedingOrg = routes.filter((r) => !r.orgId);
  if (routesNeedingOrg.length > 0) {
    await prisma.topologyRoute.updateMany({
      where: { id: { in: routesNeedingOrg.map((r) => r.id) } },
      data: { orgId: defaultOrg.id },
    });
    console.log(`[Bootstrap] Assigned ${routesNeedingOrg.length} topology route(s) to default org`);
  }

  const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!bootstrapEmail || !bootstrapPassword) {
    return;
  }

  const existingUser = await prisma.user.findUnique({ where: { email: bootstrapEmail } });
  if (existingUser) {
    return;
  }

  const passwordHash = await hashPassword(bootstrapPassword);
  const user = await prisma.user.create({
    data: {
      email: bootstrapEmail,
      passwordHash,
      name: 'Admin',
    },
  });

  await prisma.orgMember.create({
    data: {
      orgId: defaultOrg.id,
      userId: user.id,
      role: 'owner',
    },
  });

  console.log(`[Bootstrap] Created bootstrap admin user: ${bootstrapEmail}`);
}

export async function ensureUniqueOrgSlug(baseName: string): Promise<string> {
  let slug = slugify(baseName);
  let suffix = 0;

  while (true) {
    const candidate = suffix === 0 ? slug : `${slug}-${suffix}`;
    const existing = await prisma.organization.findUnique({ where: { slug: candidate } });
    if (!existing) {
      return candidate;
    }
    suffix++;
  }
}
