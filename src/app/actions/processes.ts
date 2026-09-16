'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { recordAudit } from '@/lib/audit';
import { stringify } from '@/lib/json';
import { refreshProcessScores } from '@/lib/engine/ingest';
import { snapshotKnowledgeModel } from '@/lib/engine/knowledge-model';

function num(value: FormDataEntryValue | null): number | null {
  if (value === null) return null;
  const text = String(value).trim();
  if (text === '') return null;
  const n = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function text(value: FormDataEntryValue | null): string | null {
  if (value === null) return null;
  const t = String(value).trim();
  return t === '' ? null : t;
}

export async function saveProcess(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const processId = text(formData.get('processId'));
  const ctx = await requireOrg(organisationId, 'process.edit');

  const systemsUsed = String(formData.get('systemsUsed') ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const data = {
    name: String(formData.get('name') ?? '').trim(),
    description: text(formData.get('description')),
    departmentId: text(formData.get('departmentId')),
    owner: text(formData.get('owner')),
    trigger: text(formData.get('trigger')),
    frequency: text(formData.get('frequency')),
    employeesInvolved: num(formData.get('employeesInvolved')),
    hoursPerWeek: num(formData.get('hoursPerWeek')),
    avgDurationMins: num(formData.get('avgDurationMins')),
    volumePerPeriod: num(formData.get('volumePerPeriod')),
    inputs: text(formData.get('inputs')),
    outputs: text(formData.get('outputs')),
    errorRate: num(formData.get('errorRate')),
    errorImpact: text(formData.get('errorImpact')),
    delayDescription: text(formData.get('delayDescription')),
    customerImpact: text(formData.get('customerImpact')),
    revenueImpact: text(formData.get('revenueImpact')),
    manualScore: num(formData.get('manualScore')),
    repetitivenessScore: num(formData.get('repetitivenessScore')),
    dataReadiness: num(formData.get('dataReadiness')),
    riskLevel: String(formData.get('riskLevel') ?? 'LOW'),
    systemsUsed: stringify(systemsUsed),
    // A hand-edited map is protected from being regenerated later.
    editedByConsultant: ctx.role === 'CONSULTANT' || ctx.role === 'PLATFORM_ADMIN',
    confidence: 'HIGH',
  };

  if (!data.name) {
    redirect(`/app/${organisationId}/processes?error=${encodeURIComponent('A process needs a name')}`);
  }

  let id: string;
  if (processId) {
    const existing = await prisma.process.findFirst({ where: { id: processId, organisationId } });
    if (!existing) throw new Error('Process not found in this organisation');
    await prisma.process.update({ where: { id: processId }, data });
    id = processId;
  } else {
    const created = await prisma.process.create({
      data: { ...data, organisationId, source: 'MANUAL' },
    });
    id = created.id;
  }

  await refreshProcessScores(organisationId);
  await snapshotKnowledgeModel(organisationId, 'MANUAL', `Process "${data.name}" updated.`);

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: processId ? 'process.update' : 'process.create',
    entityType: 'Process',
    entityId: id,
    metadata: { name: data.name },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/processes/${id}?saved=1`);
}

export async function deleteProcess(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const processId = String(formData.get('processId'));
  const ctx = await requireOrg(organisationId, 'process.edit');

  const existing = await prisma.process.findFirst({ where: { id: processId, organisationId } });
  if (!existing) throw new Error('Process not found in this organisation');

  await prisma.process.delete({ where: { id: processId } });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'process.delete',
    entityType: 'Process',
    entityId: processId,
    metadata: { name: existing.name },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/processes`);
}

export async function saveProcessSteps(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const processId = String(formData.get('processId'));
  const ctx = await requireOrg(organisationId, 'process.edit');

  const process = await prisma.process.findFirst({ where: { id: processId, organisationId } });
  if (!process) throw new Error('Process not found in this organisation');

  const names = formData.getAll('stepName').map(String);
  const descriptions = formData.getAll('stepDescription').map(String);
  const roles = formData.getAll('stepRole').map(String);
  const systems = formData.getAll('stepSystem').map(String);
  const durations = formData.getAll('stepDuration').map(String);
  const manualFlags = new Set(formData.getAll('stepManual').map(String));
  const bottleneckFlags = new Set(formData.getAll('stepBottleneck').map(String));
  const automatableFlags = new Set(formData.getAll('stepAutomatable').map(String));

  await prisma.processStep.deleteMany({ where: { processId } });

  const rows = names
    .map((name, index) => ({
      processId,
      order: index,
      name: name.trim(),
      description: descriptions[index]?.trim() || null,
      role: roles[index]?.trim() || null,
      systemUsed: systems[index]?.trim() || null,
      durationMins: durations[index] ? Number(durations[index]) || null : null,
      isManual: manualFlags.has(String(index)),
      isBottleneck: bottleneckFlags.has(String(index)),
      automatable: automatableFlags.has(String(index)),
    }))
    .filter((row) => row.name.length > 0);

  if (rows.length) await prisma.processStep.createMany({ data: rows });

  await prisma.process.update({
    where: { id: processId },
    data: { editedByConsultant: true },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'process.steps_update',
    entityType: 'Process',
    entityId: processId,
    metadata: { steps: rows.length },
  });

  revalidatePath(`/app/${organisationId}/processes/${processId}`);
  redirect(`/app/${organisationId}/processes/${processId}?saved=steps`);
}
