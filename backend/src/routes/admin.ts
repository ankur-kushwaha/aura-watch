import { Router, Request, Response } from 'express';
import prisma from '../services/db';
import { signSuperAdminToken, signToken } from '../services/auth';
import { requireSuperAdmin } from '../middleware/superAdmin';
import { getOrgSettings } from '../services/orgSettings';

const router = Router();

const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'aura-admin';

function preferAdminMember<T extends { role: string }>(members: T[]): T | undefined {
  return members.sort((a, b) => {
    if (a.role === 'owner' && b.role !== 'owner') return -1;
    if (b.role === 'owner' && a.role !== 'owner') return 1;
    return 0;
  })[0];
}

/**
 * POST /api/admin/login
 */
router.post('/login', (req: Request, res: Response) => {
  const { password } = req.body;

  if (!password || password !== SUPER_ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }

  res.json({ token: signSuperAdminToken() });
});

/**
 * GET /api/admin/orgs
 */
router.get('/orgs', requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { members: true, devices: true } },
      },
    });

    const result = await Promise.all(
      orgs.map(async (org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        createdAt: org.createdAt,
        memberCount: org._count.members,
        deviceCount: org._count.devices,
        settings: await getOrgSettings(org.id),
      })),
    );

    res.json(result);
  } catch (error) {
    console.error('Admin list orgs error:', error);
    res.status(500).json({ error: 'Failed to list organizations' });
  }
});

/**
 * GET /api/admin/orgs/:orgId
 */
router.get('/orgs/:orgId', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.params.orgId },
      include: {
        members: {
          include: { user: { select: { id: true, email: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { members: true, devices: true } },
      },
    });

    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      createdAt: org.createdAt,
      memberCount: org._count.members,
      deviceCount: org._count.devices,
      settings: await getOrgSettings(org.id),
      members: org.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        createdAt: m.createdAt,
      })),
    });
  } catch (error) {
    console.error('Admin get org error:', error);
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

/**
 * POST /api/admin/orgs/:orgId/impersonate
 * Issue a user JWT as the org owner/admin for full app access.
 */
router.post('/orgs/:orgId/impersonate', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.params.orgId },
    });

    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const adminMembers = await prisma.orgMember.findMany({
      where: { orgId: org.id, role: { in: ['owner', 'admin'] } },
      include: { user: true },
    });

    const adminMember = preferAdminMember(adminMembers);
    if (!adminMember) {
      return res.status(404).json({ error: 'No owner or admin found for this organization' });
    }

    const allMemberships = await prisma.orgMember.findMany({
      where: { userId: adminMember.userId },
      include: { org: true },
    });

    const token = signToken({
      userId: adminMember.user.id,
      orgId: org.id,
      email: adminMember.user.email,
      role: adminMember.role,
      impersonatedBy: 'superadmin',
    });

    res.json({
      token,
      user: {
        id: adminMember.user.id,
        email: adminMember.user.email,
        name: adminMember.user.name,
      },
      org: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        role: adminMember.role,
      },
      orgs: allMemberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        slug: m.org.slug,
        role: m.role,
      })),
      impersonatedAs: {
        email: adminMember.user.email,
        name: adminMember.user.name,
        role: adminMember.role,
      },
    });
  } catch (error) {
    console.error('Admin impersonate error:', error);
    res.status(500).json({ error: 'Failed to impersonate organization admin' });
  }
});

export default router;
