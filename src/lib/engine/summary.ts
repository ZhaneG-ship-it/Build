import 'server-only';
import { prisma } from '../db';
import { parseJson } from '../json';
import { buildKnowledgeModel, type KnowledgeModel } from './knowledge-model';
import { compareKpis } from '../ai/agents/performance';

/**
 * Dashboard figures (§17, §18). One place computes these so the business
 * dashboard and the consultant's client list can never disagree.
 */
export interface OrgSummary {
  organisationId: string;
  organisationName: string;
  km: KnowledgeModel;

  aiMaturity: number;
  completeness: number;

  assessmentStatus: string;
  assessmentProgress: number;

  opportunityCount: number;
  notRecommendedCount: number;
  awaitingClientDecision: number;
  approvedCount: number;

  activeProjects: number;
  liveImplementations: number;

  capacityLowHrs: number;
  capacityHighHrs: number;
  valueLow: number;
  valueHigh: number;
  implementationLow: number;
  implementationHigh: number;
  currency: string;

  phaseCounts: { phase1: number; phase2: number; phase3: number };

  /** Average share of projected KPI movement actually delivered, if measurable. */
  performanceAttainment: number | null;
  measuredKpis: number;
  totalKpis: number;

  pendingInterviewQuestions: number;
  documentsProcessed: number;
  reportsAwaitingReview: number;
  latestReportId: string | null;

  nextAction: { label: string; href: string; reason: string } | null;
}

export async function getOrgSummary(organisationId: string): Promise<OrgSummary> {
  const km = await buildKnowledgeModel(organisationId);

  const [
    assessment,
    opportunities,
    projects,
    implementations,
    kpis,
    pendingInterviewQuestions,
    documentsProcessed,
    reports,
  ] = await Promise.all([
    prisma.assessment.findFirst({ where: { organisationId }, orderBy: { createdAt: 'asc' } }),
    prisma.aIOpportunity.findMany({
      where: { organisationId },
      include: { calculation: true },
    }),
    prisma.project.count({ where: { organisationId, status: 'ACTIVE' } }),
    prisma.aIImplementation.count({ where: { organisationId, status: { in: ['LIVE', 'PILOT'] } } }),
    prisma.kpi.findMany({ where: { organisationId }, include: { results: true } }),
    prisma.interviewTurn.count({
      where: { session: { organisationId, status: 'ACTIVE' }, answeredAt: null },
    }),
    prisma.document.count({ where: { organisationId, status: 'PROCESSED' } }),
    prisma.report.findMany({ where: { organisationId }, orderBy: { createdAt: 'desc' } }),
  ]);

  const recommended = opportunities.filter(
    (o) => o.recommendation !== 'NOT_RECOMMENDED' && o.recommendation !== 'DO_NOTHING',
  );
  const notRecommended = opportunities.length - recommended.length;

  const sum = (pick: (c: NonNullable<(typeof opportunities)[number]['calculation']>) => number | null) =>
    recommended.reduce((total, o) => total + (o.calculation ? (pick(o.calculation) ?? 0) : 0), 0);

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
  const measured = comparisons.filter((c) => c.attainment != null);
  const performanceAttainment = measured.length
    ? measured.reduce((s, c) => s + (c.attainment ?? 0), 0) / measured.length
    : null;

  const summary: OrgSummary = {
    organisationId,
    organisationName: km.organisationName,
    km,
    aiMaturity: km.aiPosture.aiMaturityLevel,
    completeness: km.completeness.overall,
    assessmentStatus: assessment?.status ?? 'NOT_STARTED',
    assessmentProgress: assessment?.progress ?? 0,
    opportunityCount: recommended.length,
    notRecommendedCount: notRecommended,
    awaitingClientDecision: opportunities.filter((o) => o.status === 'SENT_TO_CLIENT').length,
    approvedCount: opportunities.filter((o) =>
      ['CLIENT_APPROVED', 'IN_IMPLEMENTATION', 'LIVE'].includes(o.status),
    ).length,
    activeProjects: projects,
    liveImplementations: implementations,
    capacityLowHrs: sum((c) => c.capacityReleasedLowHrs),
    capacityHighHrs: sum((c) => c.capacityReleasedHighHrs),
    valueLow: sum((c) => c.costSavingLow),
    valueHigh: sum((c) => c.costSavingHigh),
    implementationLow: sum((c) => c.implementationCostLow),
    implementationHigh: sum((c) => c.implementationCostHigh),
    currency: km.financials.currency,
    phaseCounts: {
      phase1: recommended.filter((o) => o.priorityBand === 'PHASE_1').length,
      phase2: recommended.filter((o) => o.priorityBand === 'PHASE_2').length,
      phase3: recommended.filter((o) => o.priorityBand === 'PHASE_3').length,
    },
    performanceAttainment,
    measuredKpis: measured.length,
    totalKpis: comparisons.length,
    pendingInterviewQuestions,
    documentsProcessed,
    reportsAwaitingReview: reports.filter((r) => r.status === 'CONSULTANT_REVIEW').length,
    latestReportId: reports[0]?.id ?? null,
    nextAction: null,
  };

  summary.nextAction = decideNextAction(summary, opportunities);
  return summary;
}

/**
 * Works out the single most useful thing this business could do next (§17,
 * "Next opportunity"). Ordered by what unblocks the most downstream value.
 */
function decideNextAction(
  summary: OrgSummary,
  opportunities: { id: string; name: string; status: string; priorityBand: string; recommendation: string }[],
): OrgSummary['nextAction'] {
  const base = `/app/${summary.organisationId}`;

  if (summary.assessmentStatus !== 'COMPLETE') {
    return {
      label: 'Complete the AI business assessment',
      href: `${base}/assessment`,
      reason: `The assessment is ${Math.round(summary.assessmentProgress * 100)}% done. Nothing can be analysed until the platform understands how the business runs.`,
    };
  }

  if (summary.pendingInterviewQuestions > 0) {
    return {
      label: `Answer ${summary.pendingInterviewQuestions} follow-up question${summary.pendingInterviewQuestions === 1 ? '' : 's'}`,
      href: `${base}/interview`,
      reason: 'These are the specific gaps that are currently limiting confidence in the figures.',
    };
  }

  if (summary.km.processes.length === 0) {
    return {
      label: 'Map your first business process',
      href: `${base}/processes`,
      reason: 'Opportunities are found inside processes. At least one is needed before an analysis can run.',
    };
  }

  if (summary.opportunityCount === 0 && summary.notRecommendedCount === 0) {
    return {
      label: 'Run the AI opportunity analysis',
      href: `${base}/opportunities`,
      reason: 'Enough is known about the business to identify where AI could realistically help.',
    };
  }

  if (summary.km.completeness.criticalGaps.length > 0) {
    return {
      label: 'Supply the missing figures',
      href: `${base}/interview`,
      reason: summary.km.completeness.criticalGaps[0],
    };
  }

  const awaiting = opportunities.find((o) => o.status === 'SENT_TO_CLIENT');
  if (awaiting) {
    return {
      label: `Decide on "${awaiting.name}"`,
      href: `${base}/opportunities/${awaiting.id}`,
      reason: 'Your consultant has reviewed this and it is waiting on your decision.',
    };
  }

  const approvedNoProject = opportunities.find((o) => o.status === 'CLIENT_APPROVED');
  if (approvedNoProject) {
    return {
      label: `Start the project for "${approvedNoProject.name}"`,
      href: `${base}/opportunities/${approvedNoProject.id}`,
      reason: 'This has been approved but has no implementation project yet.',
    };
  }

  if (summary.totalKpis > 0 && summary.measuredKpis === 0 && summary.liveImplementations > 0) {
    return {
      label: 'Record your first KPI results',
      href: `${base}/performance`,
      reason: 'An implementation is live but no actual figures have been recorded, so results cannot be proven.',
    };
  }

  const nextPhase1 = opportunities.find(
    (o) => o.priorityBand === 'PHASE_1' && o.status !== 'LIVE' && o.status !== 'IN_IMPLEMENTATION',
  );
  if (nextPhase1) {
    return {
      label: `Review "${nextPhase1.name}"`,
      href: `${base}/opportunities/${nextPhase1.id}`,
      reason: 'This is the highest-priority opportunity not yet in progress.',
    };
  }

  return {
    label: 'Run a continuous discovery cycle',
    href: `${base}/discovery`,
    reason: 'The current roadmap is under way. A discovery cycle looks for what has changed since the last assessment.',
  };
}

/** Parses roadmap phase counts from stored opportunities for the consultant list. */
export function readMissing(raw: string): string[] {
  return parseJson<string[]>(raw, []);
}
