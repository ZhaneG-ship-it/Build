'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { createSession, destroySession, hashPassword, verifyPassword } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';

const RegisterSchema = z.object({
  name: z.string().min(2, 'Enter your name'),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
  companyName: z.string().min(2, 'Enter your company name'),
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || 'company';
  let candidate = root;
  let suffix = 1;
  while (await prisma.organisation.findUnique({ where: { slug: candidate } })) {
    candidate = `${root}-${++suffix}`;
  }
  return candidate;
}

export async function registerAction(formData: FormData) {
  const parsed = RegisterSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    companyName: formData.get('companyName'),
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Check the details and try again';
    redirect(`/register?error=${encodeURIComponent(message)}`);
  }

  const { name, email, password, companyName } = parsed.data;
  const normalisedEmail = email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email: normalisedEmail } });
  if (existing) {
    redirect(`/register?error=${encodeURIComponent('An account already exists for that email address')}`);
  }

  const organisation = await prisma.organisation.create({
    data: { name: companyName.trim(), slug: await uniqueSlug(companyName) },
  });

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: normalisedEmail,
      passwordHash: await hashPassword(password),
      memberships: { create: { organisationId: organisation.id, role: 'OWNER' } },
    },
  });

  // Every new business starts with its assessment ready to complete.
  await prisma.assessment.create({
    data: {
      organisationId: organisation.id,
      name: 'AI Business Assessment',
      templateKey: 'core-ai-readiness',
      assignedToId: user.id,
    },
  });

  await prisma.businessProfile.create({ data: { organisationId: organisation.id } });

  await recordAudit({
    organisationId: organisation.id,
    userId: user.id,
    action: 'organisation.create',
    entityType: 'Organisation',
    entityId: organisation.id,
    metadata: { companyName },
  });

  await createSession(user.id);
  redirect(`/app/${organisation.id}/onboarding`);
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').toLowerCase().trim();
  const password = String(formData.get('password') ?? '');

  const fail = () =>
    redirect(`/login?error=${encodeURIComponent('Those details did not match an account')}`);

  if (!email || !password) fail();

  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: true },
  });

  if (!user || !user.isActive) fail();
  if (!(await verifyPassword(password, user!.passwordHash))) fail();

  await createSession(user!.id);
  await recordAudit({ userId: user!.id, action: 'auth.login' });

  if (user!.platformRole === 'PLATFORM_ADMIN') redirect('/admin');

  const consultantMembership = user!.memberships.find((m) => m.role === 'CONSULTANT');
  if (consultantMembership) redirect('/consultant');

  const first = user!.memberships[0];
  redirect(first ? `/app/${first.organisationId}` : '/app');
}

export async function logoutAction() {
  await destroySession();
  redirect('/login');
}
