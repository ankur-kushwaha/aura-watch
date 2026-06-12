import { Request, Response, NextFunction } from 'express';
import prisma from '../services/db';
import { verifyToken } from '../services/auth';

const PUBLIC_PATHS: Array<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/api\/auth\/(register|login)$/ },
  { method: 'POST', pattern: /^\/api\/admin\/login$/ },
  { method: 'POST', pattern: /^\/api\/devices\/register$/ },
  { method: 'POST', pattern: /^\/api\/devices\/[^/]+\/(upload|reid\/crop)$/ },
];

function isPublicPath(method: string, path: string): boolean {
  return PUBLIC_PATHS.some((p) => p.method === method && p.pattern.test(path));
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api')) {
    return next();
  }

  if (isPublicPath(req.method, req.path)) {
    return next();
  }

  // Super admin routes use their own auth middleware.
  if (req.path.startsWith('/api/admin')) {
    return next();
  }

  const header = req.headers.authorization;
  const queryToken = typeof req.query.access_token === 'string' ? req.query.access_token : null;
  const rawToken = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;

  if (!rawToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = rawToken;
    const payload = verifyToken(token);

    const membership = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: payload.orgId, userId: payload.userId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this organization' });
    }

    req.auth = {
      userId: payload.userId,
      orgId: payload.orgId,
      email: payload.email,
      role: membership.role,
    };

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
