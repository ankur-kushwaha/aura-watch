import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export interface AuthContext {
  userId: string;
  orgId: string;
  email: string;
  role: string;
}

export interface JwtPayload {
  userId: string;
  orgId: string;
  email: string;
  role: string;
  impersonatedBy?: 'superadmin';
}

export interface SuperAdminJwtPayload {
  isSuperAdmin: true;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function signSuperAdminToken(): string {
  return jwt.sign({ isSuperAdmin: true } satisfies SuperAdminJwtPayload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function verifySuperAdminToken(token: string): SuperAdminJwtPayload {
  const payload = jwt.verify(token, JWT_SECRET) as SuperAdminJwtPayload;
  if (!payload.isSuperAdmin) {
    throw new Error('Not a super admin token');
  }
  return payload;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'org';
}

export function generateEnrollmentToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
