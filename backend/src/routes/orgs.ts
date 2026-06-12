import { Router, Request, Response } from 'express';
import prisma from '../services/db';
import { generateEnrollmentToken } from '../services/auth';
import { ensureUniqueOrgSlug } from '../services/bootstrap';
import { requireRole } from '../middleware/auth';

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

  const { label, expiresInDays } = req.body;

  try {
    const expiresAt = expiresInDays
      ? new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000)
      : null;

    const token = await prisma.deviceEnrollmentToken.create({
      data: {
        orgId: req.auth.orgId,
        token: generateEnrollmentToken(),
        label: label?.trim() || null,
        expiresAt,
      },
    });

    res.status(201).json({
      id: token.id,
      token: token.token,
      label: token.label,
      expiresAt: token.expiresAt,
      createdAt: token.createdAt,
    });
  } catch (error) {
    console.error('Create enrollment token error:', error);
    res.status(500).json({ error: 'Failed to create enrollment token' });
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
