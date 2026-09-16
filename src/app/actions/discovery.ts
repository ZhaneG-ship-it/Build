'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { recordAudit } from '@/lib/audit';
import { stringify } from '@/lib/json';
import { buildKnowledgeModel, snapshotKnowledgeModel } from '@/lib/engine/knowledge-model';
import { runFullAnalysis } from '@/lib/engine/orchestrator';

/**
 * Continuous AI discovery (§16). Asks what has changed since the last
 * assessment, records it, then re-analyses the business against the updated
 * model and reports what is new.
 */
export async function startDiscoveryCycle(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const ctx = await requireOrg(organisationId, 'discovery.run');

  const open = await prisma.discoveryCycle.findFirst({
    where: { organisationId, status: 'OPEN' },
  });
  if (open) redirect(`/app/${organisationId}/discovery`);

  const km = await buildKnowledgeModel(organisationId);

  const cycle = await prisma.discoveryCycle.create({
    data: { organisationId, fromVersion: km.version },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'discovery.start',
    entityType: 'DiscoveryCycle',
    entityId: cycle.id,
  });

  revalidatePath(`/app/${organisationId}/discovery`);
  redirect(`/app/${organisationId}/discovery`);
}

export async function submitDiscoveryChanges(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const cycleId = String(formData.get('cycleId'));
  const ctx = await requireOrg(organisationId, 'discovery.run');

  const cycle = await prisma.discoveryCycle.findFirst({
    where: { id: cycleId, organisationId, status: 'OPEN' },
  });
  if (!cycle) redirect(`/app/${organisationId}/discovery`);

  const sections = [
    ['New or changed processes', formData.get('newProcesses')],
    ['New people or roles', formData.get('newPeople')],
    ['New software', formData.get('newSoftware')],
    ['New problems', formData.get('newProblems')],
    ['New costs', formData.get('newCosts')],
    ['New goals', formData.get('newGoals')],
    ['How existing AI is performing', formData.get('aiPerformance')],
  ] as const;

  const changesReported = sections
    .map(([label, value]) => {
      const text = String(value ?? '').trim();
      return text ? `**${label}**\n${text}` : null;
    })
    .filter(Boolean)
    .join('\n\n');

  // New processes named here become real processes to be sized and analysed.
  const newProcessNames = String(formData.get('newProcesses') ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);

  const existing = await prisma.process.findMany({ where: { organisationId } });
  const existingLower = new Set(existing.map((p) => p.name.toLowerCase()));
  const toCreate = newProcessNames
    .filter((name) => !existingLower.has(name.toLowerCase()))
    .map((name) => ({
      organisationId,
      name,
      description: 'Added during continuous discovery.',
      manualScore: 4,
      repetitivenessScore: 4,
      source: 'DISCOVERY',
      confidence: 'LOW',
      systemsUsed: stringify([]),
    }));

  if (toCreate.length) await prisma.process.createMany({ data: toCreate });

  const newProblems = String(formData.get('newProblems') ?? '')
    .split(/(?<=[.!?])\s+|\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);

  if (newProblems.length) {
    await prisma.problem.createMany({
      data: newProblems.slice(0, 6).map((description) => ({
        organisationId,
        title: description.length > 90 ? `${description.slice(0, 87)}...` : description,
        description,
        category: 'CAPACITY',
        severity: 'MEDIUM',
        source: 'DISCOVERY',
        confidence: 'MEDIUM',
      })),
    });
  }

  const toVersion = await snapshotKnowledgeModel(
    organisationId,
    'DISCOVERY',
    `Discovery cycle: ${toCreate.length} new processes, ${newProblems.length} new problems.`,
  );

  await prisma.discoveryCycle.update({
    where: { id: cycleId },
    data: {
      status: 'ANSWERED',
      changesReported,
      toVersion,
      findings: stringify([
        `${toCreate.length} new process${toCreate.length === 1 ? '' : 'es'} recorded`,
        `${newProblems.length} new problem${newProblems.length === 1 ? '' : 's'} recorded`,
      ]),
    },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'discovery.changes_submitted',
    entityType: 'DiscoveryCycle',
    entityId: cycleId,
    metadata: { newProcesses: toCreate.length, newProblems: newProblems.length },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/discovery?answered=1`);
}

/** Re-runs the full analysis against the updated model and records what is new. */
export async function analyseDiscoveryCycle(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const cycleId = String(formData.get('cycleId'));
  const ctx = await requireOrg(organisationId, 'discovery.run');

  const cycle = await prisma.discoveryCycle.findFirst({
    where: { id: cycleId, organisationId },
  });
  if (!cycle) redirect(`/app/${organisationId}/discovery`);

  const before = await prisma.aIOpportunity.findMany({
    where: { organisationId },
    select: { id: true },
  });
  const beforeIds = new Set(before.map((o) => o.id));

  try {
    await runFullAnalysis(organisationId, ctx.user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The analysis could not be completed';
    redirect(`/app/${organisationId}/discovery?error=${encodeURIComponent(message)}`);
  }

  const after = await prisma.aIOpportunity.findMany({
    where: { organisationId },
    select: { id: true, name: true },
  });
  const newOnes = after.filter((o) => !beforeIds.has(o.id));

  await prisma.discoveryCycle.update({
    where: { id: cycleId },
    data: {
      status: 'ANALYSED',
      completedAt: new Date(),
      newOpportunityIds: stringify(newOnes.map((o) => o.id)),
      findings: stringify([
        ...(newOnes.length
          ? newOnes.map((o) => `New opportunity identified: ${o.name}`)
          : ['No new opportunities emerged from these changes.']),
      ]),
    },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'discovery.analysed',
    entityType: 'DiscoveryCycle',
    entityId: cycleId,
    metadata: { newOpportunities: newOnes.length },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/discovery?analysed=1`);
}
