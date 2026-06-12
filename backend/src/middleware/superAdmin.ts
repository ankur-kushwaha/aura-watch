import { Request, Response, NextFunction } from 'express';
import { verifySuperAdminToken } from '../services/auth';

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const rawToken = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!rawToken) {
    return res.status(401).json({ error: 'Super admin authentication required' });
  }

  try {
    verifySuperAdminToken(rawToken);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired super admin token' });
  }
}
