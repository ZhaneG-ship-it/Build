'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { recordAudit } from '@/lib/audit';
import { stringify } from '@/lib/json';
import { compareKpis, reviewPerformance } from '@/lib/ai/agents/performance';

/** Records an actual KPI value for a period (§15). */
export async function recordKpiResult(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const kpiId = String(formData.get('kpiId'));
  const ctx = await requireOrg(organisationId, 'kpi.record');

  const kpi = await prisma.kpi.findFirst({ where: { id: kpiId, organisationId } });
  if (!kpi) throw new Error('KPI not found in this organisation');

  const raw = String(formData.get('actualValue') ?? '').trim();
  const actualValue = Number(raw.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(actualValue) || raw === '') {
    redirect(`/app/${organisationId}/performance?error=${encodeURIComponent('Enter a number for the actual value')}`);
  }

  const periodStart = formData.get('periodStart')
    ? new Date(String(formData.get('periodStart')))
    : startOfMonth(new Date());
  const periodEnd = formData.get('periodEnd')
    ? new Date(String(formData.get('periodEnd')))
    : endOfMonth(periodStart);

  await prisma.kpiResult.create({
    data: {
      kpiId,
      periodStart,
      periodEnd,
      actualValue,
      note: String(formData.get('note') ?? '').trim() || null,
      recordedById: ctx.user.id,
    },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'kpi.record_result',
    entityType: 'Kpi',
    entityId: kpiId,
    metadata: { actualValue },
  });

  revalidatePath(`/app/${organisationId}/performance`);
  redirect(`/app/${organisationId}/performance?recorded=1`);
}

export async function createKpi(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const ctx = await requireOrg(organisationId, 'kpi.manage');

  const name = String(formData.get('name') ?? '').trim();
  if (!name) redirect(`/app/${organisationId}/performance`);

  const toNumber = (key: string) => {
    const raw = String(formData.get(key) ?? '').trim();
    if (!raw) return null;
    const n = Number(raw.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  await prisma.kpi.create({
    data: {
      organisationId,
      projectId: String(formData.get('projectId') ?? '') || null,
      opportunityId: String(formData.get('opportunityId') ?? '') || null,
      name,
      metricKey: String(formData.get('metricKey') ?? 'CUSTOM'),
      unit: String(formData.get('unit') ?? '').trim(),
      direction: String(formData.get('direction') ?? 'INCREASE'),
      baselineValue: toNumber('baselineValue'),
      projectedValue: toNumber('projectedValue'),
      targetValue: toNumber('targetValue'),
    },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'kpi.create',
    metadata: { name },
  });

  revalidatePath(`/app/${organisationId}/performance`);
  redirect(`/app/${organisationId}/performance?created=1`);
}

/** Generates a performance review comparing projected against actual. */
export async function generatePerformanceReview(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const implementationId = String(formData.get('implementationId') ?? '') || null;
  const ctx = await requireOrg(organisationId, 'kpi.view');

  const implementation = implementationId
    ? await prisma.aIImplementation.findFirst({
        where: { id: implementationId, organisationId },
        include: { opportunity: true },
      })
    : null;

  const kpis = await prisma.kpi.findMany({
    where: {
      organisationId,
      ...(implementation ? { opportunityId: implementation.opportunityId } : {}),
    },
    include: { results: true },
  });

  const comparisons = compareKpis(
    kpis.map((k) => ({
      name: k.name,
      metricKey: k.metricKey,
      unit: k.unit,
      direction: k.direction,
      baselineValue: k.baselineValue,
      projectedValue: k.projectedValue,
      results: k.results.map((r) => ({ actualValue: r.actualValue, periodEnd: r.periodEnd })),
    })),
  );

  const now = new Date();
  const periodStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const periodEnd = endOfMonth(periodStart);
  const periodLabel = periodStart.toLocaleString('en-GB', { month: 'long', year: 'numeric' });

  const { review } = await reviewPerformance(
    organisationId,
    implementation?.name ?? 'All AI implementations',
    comparisons,
    periodLabel,
  );

  const created = await prisma.aIReview.create({
    data: {
      organisationId,
      implementationId: implementation?.id ?? null,
      periodStart,
      periodEnd,
      projected: stringify(
        Object.fromEntries(comparisons.map((c) => [c.name, c.projected])),
      ),
      actual: stringify(Object.fromEntries(comparisons.map((c) => [c.name, c.actual]))),
      variance: stringify(
        Object.fromEntries(comparisons.map((c) => [c.name, c.attainment])),
      ),
      verdict: review.verdict,
      narrative: review.narrative,
      recommendations: stringify(review.recommendations),
    },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'performance.review_generated',
    entityType: 'AIReview',
    entityId: created.id,
    metadata: { verdict: review.verdict },
  });

  revalidatePath(`/app/${organisationId}/performance`);
  redirect(`/app/${organisationId}/performance?review=${created.id}`);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
}
