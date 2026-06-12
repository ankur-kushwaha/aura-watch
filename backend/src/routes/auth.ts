import { Router, Request, Response } from 'express';
import prisma from '../services/db';
import { hashPassword, signToken, verifyPassword } from '../services/auth';
import { ensureUniqueOrgSlug } from '../services/bootstrap';

const router = Router();

/**
 * POST /api/auth/register
 * Create a new user and their first organization.
 */
router.post('/register', async (req: Request, res: Response) => {
  const { email, password, name, orgName } = req.body;

  if (!email || !password || !name || !orgName) {
    return res.status(400).json({ error: 'email, password, name, and orgName are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const slug = await ensureUniqueOrgSlug(orgName);
    const passwordHash = await hashPassword(password);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: email.toLowerCase().trim(),
          passwordHash,
          name: name.trim(),
        },
      });

      const org = await tx.organization.create({
        data: {
          name: orgName.trim(),
          slug,
        },
      });

      await tx.orgMember.create({
        data: {
          orgId: org.id,
          userId: user.id,
          role: 'owner',
        },
      });

      return { user, org };
    });

    const token = signToken({
      userId: result.user.id,
      orgId: result.org.id,
      email: result.user.email,
      role: 'owner',
    });

    res.status(201).json({
      token,
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
      org: { id: result.org.id, name: result.org.name, slug: result.org.slug },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register' });
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req: Request, res: Response) => {
  const { email, password, orgId } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        memberships: {
          include: { org: true },
        },
      },
    });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.memberships.length === 0) {
      return res.status(403).json({ error: 'No organization membership found' });
    }

    const membership = orgId
      ? user.memberships.find((m) => m.orgId === orgId)
      : user.memberships[0];

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of the requested organization' });
    }

    const token = signToken({
      userId: user.id,
      orgId: membership.orgId,
      email: user.email,
      role: membership.role,
    });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      org: { id: membership.org.id, name: membership.org.name, slug: membership.org.slug, role: membership.role },
      orgs: user.memberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        slug: m.org.slug,
        role: m.role,
      })),
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', async (req: Request, res: Response) => {
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      include: {
        memberships: {
          include: { org: true },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentOrg = user.memberships.find((m) => m.orgId === req.auth!.orgId);

    res.json({
      user: { id: user.id, email: user.email, name: user.name },
      org: currentOrg
        ? { id: currentOrg.org.id, name: currentOrg.org.name, slug: currentOrg.org.slug, role: currentOrg.role }
        : null,
      orgs: user.memberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        slug: m.org.slug,
        role: m.role,
      })),
    });
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * POST /api/auth/switch-org
 */
router.post('/switch-org', async (req: Request, res: Response) => {
  if (!req.auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { orgId } = req.body;
  if (!orgId) {
    return res.status(400).json({ error: 'orgId is required' });
  }

  try {
    const membership = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: req.auth.userId } },
      include: { org: true },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this organization' });
    }

    const token = signToken({
      userId: req.auth.userId,
      orgId: membership.orgId,
      email: req.auth.email,
      role: membership.role,
    });

    res.json({
      token,
      org: { id: membership.org.id, name: membership.org.name, slug: membership.org.slug, role: membership.role },
    });
  } catch (error) {
    console.error('Switch org error:', error);
    res.status(500).json({ error: 'Failed to switch organization' });
  }
});

export default router;
