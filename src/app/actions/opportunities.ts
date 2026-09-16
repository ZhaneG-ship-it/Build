'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { recordAudit } from '@/lib/audit';

/**
 * Consultant review and client decisions on opportunities (§18, §1).
 *
 * A consultant may rewrite any AI-generated recommendation before it reaches the
 * client; doing so marks the opportunity as consultant-edited, which protects it
 * from being overwritten the next time the analysis runs.
 */
export async function updateOpportunity(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const opportunityId = String(formData.get('opportunityId'));
  const ctx = await requireOrg(organisationId, 'opportunity.edit');

  const existing = await prisma.aIOpportunity.findFirst({
    where: { id: opportunityId, organisationId },
  });
  if (!existing) throw new Error('Opportunity not found in this organisation');

  const recommendation = String(formData.get('recommendation') ?? existing.recommendation);
  const notRecommendedReason = String(formData.get('notRecommendedReason') ?? '').trim();

  await prisma.aIOpportunity.update({
    where: { id: opportunityId },
    data: {
      name: String(formData.get('name') ?? existing.name).trim(),
      currentProblem: String(formData.get('currentProblem') ?? existing.currentProblem).trim(),
      proposedSolution: String(formData.get('proposedSolution') ?? existing.proposedSolution).trim(),
      rationale: String(formData.get('rationale') ?? existing.rationale ?? '').trim() || null,
      aiCategory: String(formData.get('aiCategory') ?? existing.aiCategory),
      recommendation,
      notRecommendedReason:
        recommendation === 'NOT_RECOMMENDED' || recommendation === 'DO_NOTHING'
          ? notRecommendedReason || 'AI is not recommended for this process.'
          : null,
      priorityBand:
        recommendation === 'NOT_RECOMMENDED' || recommendation === 'DO_NOTHING'
          ? 'NOT_RECOMMENDED'
          : String(formData.get('priorityBand') ?? existing.priorityBand),
      implementationComplexity: String(
        formData.get('implementationComplexity') ?? existing.implementationComplexity,
      ),
      riskLevel: String(formData.get('riskLevel') ?? existing.riskLevel),
      humanOversight: String(formData.get('humanOversight') ?? existing.humanOversight),
      consultantNotes: String(formData.get('consultantNotes') ?? '').trim() || null,
      editedByConsultant: true,
      generatedBy: 'consultant',
    },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'opportunity.edit',
    entityType: 'AIOpportunity',
    entityId: opportunityId,
    metadata: { recommendation },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/opportunities/${opportunityId}?saved=1`);
}

/** Consultant releases an opportunity to the client. */
export async function approveOpportunity(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const opportunityId = String(formData.get('opportunityId'));
  const ctx = await requireOrg(organisationId, 'opportunity.approve');

  const existing = await prisma.aIOpportunity.findFirst({
    where: { id: opportunityId, organisationId },
  });
  if (!existing) throw new Error('Opportunity not found in this organisation');

  await prisma.aIOpportunity.update({
    where: { id: opportunityId },
    data: { status: 'SENT_TO_CLIENT' },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'opportunity.approve',
    entityType: 'AIOpportunity',
    entityId: opportunityId,
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/opportunities/${opportunityId}?approved=1`);
}

/** The business owner accepts or declines a recommendation. */
export async function recordClientDecision(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const opportunityId = String(formData.get('opportunityId'));
  const decision = String(formData.get('decision'));
  const note = String(formData.get('note') ?? '').trim();

  const ctx = await requireOrg(organisationId, 'opportunity.decide');

  const opportunity = await prisma.aIOpportunity.findFirst({
    where: { id: opportunityId, organisationId },
  });
  if (!opportunity) throw new Error('Opportunity not found in this organisation');

  const approved = decision === 'APPROVE';

  await prisma.aIOpportunity.update({
    where: { id: opportunityId },
    data: {
      status: approved ? 'CLIENT_APPROVED' : 'CLIENT_REJECTED',
      clientDecisionNote: note || null,
    },
  });

  await prisma.roadmapItem.updateMany({
    where: { opportunityId },
    data: {
      clientDecision: approved ? 'APPROVED' : 'REJECTED',
      decidedAt: new Date(),
      decidedById: ctx.user.id,
    },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: approved ? 'opportunity.client_approve' : 'opportunity.client_reject',
    entityType: 'AIOpportunity',
    entityId: opportunityId,
    metadata: { note },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/opportunities/${opportunityId}?decided=1`);
}

/** Consultant approves and publishes a report to the client. */
export async function publishReport(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const reportId = String(formData.get('reportId'));
  const ctx = await requireOrg(organisationId, 'report.approve');

  const report = await prisma.report.findFirst({ where: { id: reportId, organisationId } });
  if (!report) throw new Error('Report not found in this organisation');

  await prisma.report.update({
    where: { id: reportId },
    data: {
      status: 'PUBLISHED',
      approvedById: ctx.user.id,
      approvedAt: new Date(),
      publishedAt: new Date(),
    },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'report.publish',
    entityType: 'Report',
    entityId: reportId,
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/reports/${reportId}?published=1`);
}

/** Consultant replaces a generated report section with their own wording. */
export async function editReportSection(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const reportId = String(formData.get('reportId'));
  const sectionKey = String(formData.get('sectionKey'));
  const replacement = String(formData.get('replacement') ?? '').trim();
  const ctx = await requireOrg(organisationId, 'report.edit');

  const report = await prisma.report.findFirst({ where: { id: reportId, organisationId } });
  if (!report) throw new Error('Report not found in this organisation');

  const edits = JSON.parse(report.consultantEdits || '{}') as Record<string, string>;
  if (replacement) edits[sectionKey] = replacement;
  else delete edits[sectionKey];

  await prisma.report.update({
    where: { id: reportId },
    data: { consultantEdits: JSON.stringify(edits) },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'report.edit_section',
    entityType: 'Report',
    entityId: reportId,
    metadata: { sectionKey },
  });

  revalidatePath(`/app/${organisationId}/reports/${reportId}`);
  redirect(`/app/${organisationId}/reports/${reportId}?edited=${sectionKey}`);
}
