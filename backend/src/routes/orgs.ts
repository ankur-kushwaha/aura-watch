import { Router, Request, Response } from 'express';
import prisma from '../services/db';
import { hashPassword } from '../services/auth';
import { ensureUniqueOrgSlug } from '../services/bootstrap';
import { requireRole } from '../middleware/auth';
import { getOrgSettings, parseOrgSettingsPatch, updateOrgSettings } from '../services/orgSettings';

const router = Router();

/**
 * POST /api/orgs
 * Create a new organization for the current user.
 */
router.post('/', async (req: Request, res: Response) => {
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { name } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const slug = await ensureUniqueOrgSlug(name);
    const org = await prisma.organization.create({
      data: {
        name: name.trim(),
        slug,
        members: {
          create: {
            userId: req.auth.userId,
            role: 'owner',
          },
        },
      },
    });

    res.status(201).json({ id: org.id, name: org.name, slug: org.slug, role: 'owner' });
  } catch (error) {
    console.error('Create org error:', error);
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

/**
 * GET /api/orgs/:orgId/settings
 */
router.get('/:orgId/settings', async (req: Request, res: Response) => {
  if (!req.auth || req.auth.orgId !== req.params.orgId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const settings = await getOrgSettings(req.auth.orgId);
    res.json({ settings, role: req.auth.role });
  } catch (error) {
    console.error('Get org settings error:', error);
    res.status(500).json({ error: 'Failed to fetch organization settings' });
  }
});

/**
 * PATCH /api/orgs/:orgId/settings
 */
router.patch('/:orgId/settings', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  if (!req.auth || req.auth.orgId !== req.params.orgId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const patch = parseOrgSettingsPatch(req.body);
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No valid settings provided' });
  }

  try {
    const settings = await updateOrgSettings(req.auth.orgId, patch);
    res.json({ settings });
  } catch (error) {
    console.error('Update org settings error:', error);
    res.status(500).json({ error: 'Failed to update organization settings' });
  }
});

const ASSIGNABLE_ROLES = ['member', 'admin', 'viewer'] as const;

function assertOrgAccess(req: Request, res: Response): boolean {
  if (!req.auth || req.auth.orgId !== req.params.orgId) {
    res.status(403).json({ error: 'Access denied' });
    return false;
  }
  return true;
}

/**
 * GET /api/orgs/:orgId/members
 */
router.get('/:orgId/members', async (req: Request, res: Response) => {
  if (!assertOrgAccess(req, res)) return;

  try {
    const members = await prisma.orgMember.findMany({
      where: { orgId: req.auth!.orgId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    res.json(
      members.map((m) => ({
        id: m.id,
        userId: m.userId,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        createdAt: m.createdAt,
      })),
    );
  } catch (error) {
    console.error('List org members error:', error);
    res.status(500).json({ error: 'Failed to list organization members' });
  }
});

/**
 * POST /api/orgs/:orgId/members
 */
router.post('/:orgId/members', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  if (!assertOrgAccess(req, res)) return;

  const { email, name, password, role = 'member' } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.toLowerCase().trim() : '';

  if (!normalizedEmail) {
    return res.status(400).json({ error: 'email is required' });
  }

  const requestedRole = typeof role === 'string' ? role : 'member';
  if (requestedRole === 'owner' && req.auth!.role !== 'owner') {
    return res.status(403).json({ error: 'Only owners can assign the owner role' });
  }
  if (!ASSIGNABLE_ROLES.includes(requestedRole as (typeof ASSIGNABLE_ROLES)[number]) && requestedRole !== 'owner') {
    return res.status(400).json({ error: 'role must be owner, admin, member, or viewer' });
  }

  try {
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return res.status(400).json({ error: 'name is required when creating a new user' });
      }
      if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'password must be at least 8 characters when creating a new user' });
      }

      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          name: trimmedName,
          passwordHash: await hashPassword(password),
        },
      });
    }

    const existing = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: req.auth!.orgId, userId: user.id } },
    });
    if (existing) {
      return res.status(409).json({ error: 'User is already a member of this organization' });
    }

    const member = await prisma.orgMember.create({
      data: {
        orgId: req.auth!.orgId,
        userId: user.id,
        role: requestedRole,
      },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    res.status(201).json({
      id: member.id,
      userId: member.userId,
      email: member.user.email,
      name: member.user.name,
      role: member.role,
      createdAt: member.createdAt,
    });
  } catch (error) {
    console.error('Add org member error:', error);
    res.status(500).json({ error: 'Failed to add organization member' });
  }
});

/**
 * DELETE /api/orgs/:orgId/members/:userId
 */
router.delete('/:orgId/members/:userId', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  if (!assertOrgAccess(req, res)) return;

  const { userId } = req.params;

  if (userId === req.auth!.userId) {
    return res.status(400).json({ error: 'You cannot remove yourself from the organization' });
  }

  try {
    const memberCount = await prisma.orgMember.count({ where: { orgId: req.auth!.orgId } });
    if (memberCount <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last member of the organization' });
    }

    const target = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: req.auth!.orgId, userId } },
    });
    if (!target) {
      return res.status(404).json({ error: 'Member not found' });
    }

    if (target.role === 'owner' && req.auth!.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can remove other owners' });
    }

    await prisma.orgMember.delete({
      where: { orgId_userId: { orgId: req.auth!.orgId, userId } },
    });

    res.json({ message: 'Member removed' });
  } catch (error) {
    console.error('Remove org member error:', error);
    res.status(500).json({ error: 'Failed to remove organization member' });
  }
});

/**
 * GET /api/orgs/:orgId/enrollment-tokens
 */
router.get('/:orgId/enrollment-tokens', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  if (!req.auth || req.auth.orgId !== req.params.orgId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const tokens = await prisma.deviceEnrollmentToken.findMany({
      where: { orgId: req.auth.orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, token: true, label: true, expiresAt: true, createdAt: true },
    });
    res.json(tokens);
  } catch (error) {
    console.error('List enrollment tokens error:', error);
    res.status(500).json({ error: 'Failed to list enrollment tokens' });
  }
});

/**
 * POST /api/orgs/:orgId/enrollment-tokens
 */
router.post('/:orgId/enrollment-tokens', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  if (!req.auth || req.auth.orgId !== req.params.orgId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { deviceId, label, name } = req.body;
  const trimmedDeviceId = typeof deviceId === 'string' ? deviceId.trim() : '';

  if (!trimmedDeviceId) {
    return res.status(400).json({ error: 'deviceId is required' });
  }

  try {
    const existing = await prisma.edgeDevice.findUnique({
      where: { deviceId: trimmedDeviceId },
      select: { orgId: true },
    });

    if (existing?.orgId && existing.orgId !== req.auth.orgId) {
      return res.status(409).json({ error: 'Device is already registered to another organization' });
    }

    if (existing?.orgId === req.auth.orgId) {
      const device = await prisma.edgeDevice.findUnique({ where: { deviceId: trimmedDeviceId } });
      return res.status(200).json({
        id: device!.id,
        token: device!.deviceId,
        deviceId: device!.deviceId,
        label: device!.name,
        createdAt: device!.lastHeartbeat,
      });
    }

    const deviceName = (typeof name === 'string' && name.trim())
      || (typeof label === 'string' && label.trim())
      || 'New Edge Device';

    const device = await prisma.edgeDevice.create({
      data: {
        deviceId: trimmedDeviceId,
        name: deviceName,
        orgId: req.auth.orgId,
        status: 'Offline',
      },
    });

    res.status(201).json({
      id: device.id,
      token: device.deviceId,
      deviceId: device.deviceId,
      label: device.name,
      createdAt: device.lastHeartbeat,
    });
  } catch (error) {
    console.error('Create enrollment token error:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

/**
 * DELETE /api/orgs/:orgId/enrollment-tokens/:tokenId
 */
router.delete('/:orgId/enrollment-tokens/:tokenId', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  if (!req.auth || req.auth.orgId !== req.params.orgId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    await prisma.deviceEnrollmentToken.deleteMany({
      where: { id: req.params.tokenId, orgId: req.auth.orgId },
    });
    res.json({ message: 'Enrollment token deleted' });
  } catch (error) {
    console.error('Delete enrollment token error:', error);
    res.status(500).json({ error: 'Failed to delete enrollment token' });
  }
});

export default router;
