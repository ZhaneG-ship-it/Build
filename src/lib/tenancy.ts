import 'server-only';
import { prisma } from './db';
import { AuthError, getCurrentUser, roleHasPermission, type SessionUser } from './auth';
import type { OrgRole } from './types';

/**
 * Tenancy guard. Every organisation-scoped read/write in the app resolves its
 * scope through here first, so a caller can never reach another tenant's rows:
 * the returned `organisationId` is always one the caller is a member of (or,
 * for a platform admin, one that exists).
 */
export interface OrgContext {
  user: SessionUser;
  organisationId: string;
  organisationName: string;
  role: OrgRole | 'PLATFORM_ADMIN';
  can: (permission: string) => boolean;
}

export async function getOrgContext(organisationId: string): Promise<OrgContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const membership = user.memberships.find((m) => m.organisationId === organisationId);

  if (!membership) {
    // Platform admins may administer any organisation, but this is the only
    // path that bypasses membership and it is always audited by the caller.
    if (user.platformRole === 'PLATFORM_ADMIN') {
      const org = await prisma.organisation.findUnique({ where: { id: organisationId } });
      if (!org) return null;
      return {
        user,
        organisationId: org.id,
        organisationName: org.name,
        role: 'PLATFORM_ADMIN',
        can: () => true,
      };
    }
    return null;
  }

  return {
    user,
    organisationId,
    organisationName: membership.organisationName,
    role: membership.role,
    can: (permission: string) => roleHasPermission(membership.role, permission),
  };
}

export async function requireOrg(organisationId: string, permission?: string): Promise<OrgContext> {
  const ctx = await getOrgContext(organisationId);
  if (!ctx) throw new AuthError('You do not have access to this organisation', 403);
  if (permission && !ctx.can(permission)) {
    throw new AuthError(`Your role cannot perform this action (${permission})`, 403);
  }
  return ctx;
}

/** Resolves the organisation a user lands in by default. */
export async function resolveDefaultOrg(user: SessionUser): Promise<string | null> {
  if (user.memberships.length > 0) return user.memberships[0].organisationId;
  return null;
}

/**
 * Asserts a child row really belongs to the scoped organisation before it is
 * mutated. Prevents id-guessing across tenants.
 */
export function assertSameOrg(row: { organisationId: string } | null, organisationId: string) {
  if (!row || row.organisationId !== organisationId) {
    throw new AuthError('Record not found in this organisation', 404);
  }
}
