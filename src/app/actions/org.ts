'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { recordAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/auth';
import { stringify } from '@/lib/json';
import { snapshotKnowledgeModel } from '@/lib/engine/knowledge-model';
import { INTEGRATION_REGISTRY } from '@/lib/integrations/registry';

function text(value: FormDataEntryValue | null): string | null {
  if (value === null) return null;
  const t = String(value).trim();
  return t === '' ? null : t;
}

function num(value: FormDataEntryValue | null): number | null {
  if (value === null) return null;
  const t = String(value).trim();
  if (t === '') return null;
  const n = Number(t.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Business profile editing (§3 onboarding, and later corrections). */
export async function updateBusinessProfile(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const ctx = await requireOrg(organisationId, 'knowledge.edit');

  const locations = String(formData.get('locations') ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const data = {
    legalName: text(formData.get('legalName')),
    industry: text(formData.get('industry')),
    subIndustry: text(formData.get('subIndustry')),
    companySize: text(formData.get('companySize')),
    employeeCount: num(formData.get('employeeCount')),
    locations: stringify(locations),
    website: text(formData.get('website')),
    businessModel: text(formData.get('businessModel')),
    productsServices: text(formData.get('productsServices')),
    targetCustomers: text(formData.get('targetCustomers')),
    annualTurnover: num(formData.get('annualTurnover')),
    currency: String(formData.get('currency') ?? 'GBP'),
    biggestGoals: text(formData.get('biggestGoals')),
    biggestProblems: text(formData.get('biggestProblems')),
    growthLimiters: text(formData.get('growthLimiters')),
    timeSinks: text(formData.get('timeSinks')),
    aiAmbition: text(formData.get('aiAmbition')),
    avgHourlyLabourCost: num(formData.get('avgHourlyLabourCost')),
    avgCustomerValue: num(formData.get('avgCustomerValue')),
    monthlyLeadVolume: num(formData.get('monthlyLeadVolume')),
    conversionRate: num(formData.get('conversionRate')),
    aiBudget: num(formData.get('aiBudget')),
  };

  const existing = await prisma.businessProfile.findFirst({
    where: { organisationId, isCurrent: true },
  });

  if (existing) {
    await prisma.businessProfile.update({ where: { id: existing.id }, data });
  } else {
    await prisma.businessProfile.create({ data: { organisationId, ...data } });
  }

  const orgName = text(formData.get('organisationName'));
  if (orgName) {
    await prisma.organisation.update({ where: { id: organisationId }, data: { name: orgName } });
  }

  // Departments listed on the onboarding form.
  const departments = String(formData.get('departments') ?? '')
    .split(/\r?\n/)
    .map((d) => d.trim())
    .filter(Boolean);

  if (departments.length) {
    const current = await prisma.department.findMany({ where: { organisationId } });
    const currentLower = new Set(current.map((d) => d.name.toLowerCase()));
    const toCreate = departments
      .filter((name) => !currentLower.has(name.toLowerCase()))
      .map((name) => ({ organisationId, name, source: 'MANUAL' }));
    if (toCreate.length) await prisma.department.createMany({ data: toCreate });
  }

  await snapshotKnowledgeModel(organisationId, 'MANUAL', 'Business profile updated.');

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'profile.update',
    entityType: 'BusinessProfile',
    entityId: existing?.id,
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/onboarding?saved=1`);
}

/** Invites a colleague or consultant into the organisation (§2). */
export async function inviteMember(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const ctx = await requireOrg(organisationId, 'org.members.manage');

  const email = String(formData.get('email') ?? '').toLowerCase().trim();
  const name = String(formData.get('name') ?? '').trim();
  const role = String(formData.get('role') ?? 'EMPLOYEE');
  const password = String(formData.get('password') ?? '').trim();

  if (!email || !name || password.length < 8) {
    redirect(
      `/app/${organisationId}/settings?error=${encodeURIComponent('Name, email and a password of at least 8 characters are required')}`,
    );
  }

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name, passwordHash: await hashPassword(password), jobTitle: String(formData.get('jobTitle') ?? '') || null },
    });
  }

  const existingMembership = await prisma.membership.findUnique({
    where: { userId_organisationId: { userId: user.id, organisationId } },
  });

  if (existingMembership) {
    await prisma.membership.update({ where: { id: existingMembership.id }, data: { role } });
  } else {
    await prisma.membership.create({
      data: { userId: user.id, organisationId, role, invitedBy: ctx.user.id },
    });
  }

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'member.invite',
    entityType: 'User',
    entityId: user.id,
    metadata: { email, role },
  });

  revalidatePath(`/app/${organisationId}/settings`);
  redirect(`/app/${organisationId}/settings?invited=1`);
}

export async function removeMember(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const membershipId = String(formData.get('membershipId'));
  const ctx = await requireOrg(organisationId, 'org.members.manage');

  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organisationId },
  });
  if (!membership) throw new Error('Member not found in this organisation');

  // An organisation must always keep at least one owner.
  if (membership.role === 'OWNER') {
    const owners = await prisma.membership.count({ where: { organisationId, role: 'OWNER' } });
    if (owners <= 1) {
      redirect(
        `/app/${organisationId}/settings?error=${encodeURIComponent('You cannot remove the last owner of an organisation')}`,
      );
    }
  }

  await prisma.membership.delete({ where: { id: membershipId } });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'member.remove',
    entityType: 'Membership',
    entityId: membershipId,
  });

  revalidatePath(`/app/${organisationId}/settings`);
}

/** Records a business system manually (§4 technology). */
export async function addSystem(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const ctx = await requireOrg(organisationId, 'knowledge.edit');

  const name = String(formData.get('name') ?? '').trim();
  if (!name) redirect(`/app/${organisationId}/settings`);

  await prisma.businessSystem.create({
    data: {
      organisationId,
      name,
      category: String(formData.get('category') ?? 'OTHER'),
      vendor: text(formData.get('vendor')),
      hasApi: formData.get('hasApi') === 'on',
      dataQuality: num(formData.get('dataQuality')),
      usageNotes: text(formData.get('usageNotes')),
      source: 'MANUAL',
    },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'system.create',
    metadata: { name },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/settings?system=1`);
}

export async function deleteSystem(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const systemId = String(formData.get('systemId'));
  const ctx = await requireOrg(organisationId, 'knowledge.edit');

  const system = await prisma.businessSystem.findFirst({
    where: { id: systemId, organisationId },
  });
  if (!system) throw new Error('System not found in this organisation');

  await prisma.businessSystem.delete({ where: { id: systemId } });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'system.delete',
    entityId: systemId,
  });

  revalidatePath(`/app/${organisationId}/settings`);
}

/**
 * Connects a business-system integration. Connectors are declared in the
 * registry; those not yet built are recorded as planned rather than pretending
 * to connect.
 */
export async function toggleIntegration(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const provider = String(formData.get('provider'));
  const ctx = await requireOrg(organisationId, 'integrations.manage');

  const definition = INTEGRATION_REGISTRY.find((i) => i.provider === provider);
  if (!definition) throw new Error('Unknown integration');

  const existing = await prisma.integration.findFirst({ where: { organisationId, provider } });

  if (existing) {
    await prisma.integration.delete({ where: { id: existing.id } });
  } else {
    await prisma.integration.create({
      data: {
        organisationId,
        provider,
        status: definition.available ? 'CONNECTED' : 'COMING_SOON',
        config: stringify({ registeredBy: ctx.user.id }),
      },
    });

    // An available connector contributes its systems to the knowledge model.
    if (definition.available) {
      const existingSystems = await prisma.businessSystem.findMany({ where: { organisationId } });
      const names = new Set(existingSystems.map((s) => s.name.toLowerCase()));
      if (!names.has(definition.name.toLowerCase())) {
        await prisma.businessSystem.create({
          data: {
            organisationId,
            name: definition.name,
            category: definition.category,
            hasApi: true,
            usageNotes: 'Connected via integration',
            source: 'INTEGRATION',
          },
        });
      }
    }
  }

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: existing ? 'integration.disconnect' : 'integration.connect',
    metadata: { provider },
  });

  revalidatePath(`/app/${organisationId}/settings`);
}
