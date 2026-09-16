'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requirePlatformAdmin } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { stringify } from '@/lib/json';

/** Platform administration (§2). All actions require the platform admin role. */

export async function setUserActive(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const userId = String(formData.get('userId'));
  const isActive = String(formData.get('isActive')) === 'true';

  if (userId === admin.id) {
    redirect(`/admin/users?error=${encodeURIComponent('You cannot deactivate your own account')}`);
  }

  await prisma.user.update({ where: { id: userId }, data: { isActive } });
  if (!isActive) await prisma.session.deleteMany({ where: { userId } });

  await recordAudit({
    userId: admin.id,
    action: isActive ? 'admin.user_activate' : 'admin.user_deactivate',
    entityType: 'User',
    entityId: userId,
  });

  revalidatePath('/admin/users');
}

export async function setPlatformRole(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const userId = String(formData.get('userId'));
  const platformRole = String(formData.get('platformRole'));

  if (userId === admin.id) {
    redirect(`/admin/users?error=${encodeURIComponent('You cannot change your own platform role')}`);
  }

  await prisma.user.update({ where: { id: userId }, data: { platformRole } });

  await recordAudit({
    userId: admin.id,
    action: 'admin.role_change',
    entityType: 'User',
    entityId: userId,
    metadata: { platformRole },
  });

  revalidatePath('/admin/users');
}

export async function setOrganisationStatus(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const organisationId = String(formData.get('organisationId'));
  const status = String(formData.get('status'));

  await prisma.organisation.update({ where: { id: organisationId }, data: { status } });

  await recordAudit({
    organisationId,
    userId: admin.id,
    action: 'admin.org_status',
    entityType: 'Organisation',
    entityId: organisationId,
    metadata: { status },
  });

  revalidatePath('/admin/organisations');
}

export async function setOrganisationPlan(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const organisationId = String(formData.get('organisationId'));
  const planId = String(formData.get('planId')) || null;

  await prisma.organisation.update({ where: { id: organisationId }, data: { planId } });

  await recordAudit({
    organisationId,
    userId: admin.id,
    action: 'admin.org_plan',
    entityType: 'Organisation',
    entityId: organisationId,
    metadata: { planId },
  });

  revalidatePath('/admin/organisations');
}

export async function saveAIModelConfig(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const key = String(formData.get('key'));
  const modelId = String(formData.get('modelId')).trim();
  const label = String(formData.get('label')).trim();
  const temperature = Number(formData.get('temperature') ?? 0.2);
  const maxTokens = Number(formData.get('maxTokens') ?? 16000);
  const isActive = formData.get('isActive') === 'on';

  await prisma.aIModelConfig.upsert({
    where: { key },
    create: { key, label, modelId, temperature, maxTokens, isActive },
    update: { label, modelId, temperature, maxTokens, isActive },
  });

  await recordAudit({
    userId: admin.id,
    action: 'admin.model_config',
    entityType: 'AIModelConfig',
    metadata: { key, modelId },
  });

  revalidatePath('/admin/models');
  redirect('/admin/models?saved=1');
}

export async function savePricingPlan(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const id = String(formData.get('planId') ?? '');
  const name = String(formData.get('name')).trim();

  const features = String(formData.get('features') ?? '')
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean);

  const data = {
    name,
    monthlyPrice: Number(formData.get('monthlyPrice') ?? 0),
    currency: String(formData.get('currency') ?? 'GBP'),
    maxUsers: Number(formData.get('maxUsers') ?? 10),
    maxDocuments: Number(formData.get('maxDocuments') ?? 100),
    features: stringify(features),
    isActive: formData.get('isActive') === 'on',
  };

  if (id) {
    await prisma.pricingPlan.update({ where: { id }, data });
  } else {
    await prisma.pricingPlan.create({ data });
  }

  await recordAudit({
    userId: admin.id,
    action: 'admin.pricing_plan',
    entityType: 'PricingPlan',
    metadata: { name },
  });

  revalidatePath('/admin/pricing');
  redirect('/admin/pricing?saved=1');
}
