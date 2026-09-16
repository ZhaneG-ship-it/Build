import 'server-only';
import { cookies, headers } from 'next/headers';
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { prisma } from './db';
import type { OrgRole, PlatformRole } from './types';

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = 'clarity_session';
const SESSION_DAYS = 14;

// --- passwords -------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

// --- sessions --------------------------------------------------------------

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  let userAgent: string | undefined;
  try {
    userAgent = (await headers()).get('user-agent') ?? undefined;
  } catch {
    userAgent = undefined;
  }
  await prisma.session.create({ data: { token, userId, expiresAt, userAgent } });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { token } });
  jar.delete(SESSION_COOKIE);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
  jobTitle: string | null;
  memberships: { organisationId: string; organisationName: string; role: OrgRole }[];
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: {
      user: { include: { memberships: { include: { organisation: true } } } },
    },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;

  const { user } = session;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    platformRole: user.platformRole as PlatformRole,
    jobTitle: user.jobTitle,
    memberships: user.memberships.map((m) => ({
      organisationId: m.organisationId,
      organisationName: m.organisation.name,
      role: m.role as OrgRole,
    })),
  };
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('Not authenticated', 401);
  return user;
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.platformRole !== 'PLATFORM_ADMIN') {
    throw new AuthError('Platform administrator access required', 403);
  }
  return user;
}

// --- permissions (§2) ------------------------------------------------------

export const PERMISSIONS = {
  OWNER: [
    'org.manage',
    'org.members.manage',
    'assessment.complete',
    'assessment.assign',
    'documents.upload',
    'documents.view',
    'integrations.manage',
    'knowledge.view',
    'knowledge.edit',
    'process.view',
    'process.edit',
    'opportunity.view',
    'opportunity.decide',
    'report.view',
    'roadmap.view',
    'roadmap.decide',
    'project.view',
    'project.manage',
    'kpi.view',
    'kpi.record',
    'discovery.run',
  ],
  EMPLOYEE: [
    'assessment.complete',
    'documents.view',
    'documents.upload',
    'knowledge.view',
    'process.view',
    'opportunity.view',
    'report.view',
    'project.view',
    'project.participate',
    'kpi.view',
  ],
  CONSULTANT: [
    'assessment.complete',
    'assessment.assign',
    'documents.upload',
    'documents.view',
    'integrations.manage',
    'knowledge.view',
    'knowledge.edit',
    'process.view',
    'process.edit',
    'opportunity.view',
    'opportunity.edit',
    'opportunity.approve',
    'report.view',
    'report.edit',
    'report.approve',
    'roadmap.view',
    'roadmap.edit',
    'project.view',
    'project.manage',
    'kpi.view',
    'kpi.record',
    'kpi.manage',
    'discovery.run',
    'analysis.run',
  ],
} as const satisfies Record<OrgRole, readonly string[]>;

export type Permission = (typeof PERMISSIONS)[OrgRole][number];

/** Owners can trigger analysis for their own business. */
const EXTRA_OWNER_PERMISSIONS = ['analysis.run'];

export function roleHasPermission(role: OrgRole, permission: string): boolean {
  if (role === 'OWNER' && EXTRA_OWNER_PERMISSIONS.includes(permission)) return true;
  return (PERMISSIONS[role] as readonly string[]).includes(permission);
}
