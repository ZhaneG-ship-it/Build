import 'server-only';
import { prisma } from '../db';
import { stringify } from '../json';
import { recordAudit } from '../audit';
import { buildKnowledgeModel, snapshotKnowledgeModel } from './knowledge-model';
import { generateOpportunities, type OpportunityDraft } from './opportunities';
import { buildReportContent } from './report';
import { analyseProcesses } from '../ai/agents/process-analyst';
import { reviewOpportunities } from '../ai/agents/opportunity';
import { assessRisks } from '../ai/agents/risk';
import { writeExecutiveNarrative } from '../ai/agents/report';
import { refreshProcessScores } from './ingest';

/**
 * Agent orchestration (§22).
 *
 * The agents run in sequence and hand structured results to one another:
 *
 *   Process Analyst -> (steps, inefficiencies)
 *      -> Opportunity Engine + AI Opportunity Agent -> (opportunities)
 *      -> Financial engine (already embedded in the drafts)
 *      -> Risk Agent -> (risk register)
 *      -> Report Agent -> (narrative) -> report document
 *
 * Nothing here invents a number: figures come from the outcome engine, and the
 * agents supply judgement and language around them.
 */

export interface AnalysisResult {
  opportunitiesCreated: number;
  opportunitiesUpdated: number;
  notRecommended: number;
  reportId: string;
  roadmapId: string;
  knowledgeVersion: number;
  providers: Record<string, string>;
  warnings: string[];
}

export async function runFullAnalysis(
  organisationId: string,
  userId: string | null,
): Promise<AnalysisResult> {
  const providers: Record<string, string> = {};
  const warnings: string[] = [];

  // --- 1. Process analysis -------------------------------------------------
  let km = await buildKnowledgeModel(organisationId);

  if (km.processes.length === 0) {
    throw new Error(
      'No business processes have been recorded yet. Complete the assessment, or add processes in the process map, before running an analysis.',
    );
  }

  const { analysis, provider: processProvider } = await analyseProcesses(km);
  providers.processAnalyst = processProvider;

  await persistProcessAnalysis(organisationId, analysis);
  await refreshProcessScores(organisationId);

  // Rebuild so the opportunity engine sees the steps and problems just written.
  km = await buildKnowledgeModel(organisationId);

  // --- 2. Opportunities ----------------------------------------------------
  const engineDrafts = generateOpportunities(km);
  const { drafts, provider: opportunityProvider } = await reviewOpportunities(km, engineDrafts);
  providers.opportunityAgent = opportunityProvider;

  // --- 3. Risk -------------------------------------------------------------
  const { assessment: risk, provider: riskProvider } = await assessRisks(km, drafts);
  providers.riskAgent = riskProvider;

  // --- 4. Persist opportunities -------------------------------------------
  const { created, updated } = await persistOpportunities(organisationId, drafts);

  // --- 5. Roadmap ----------------------------------------------------------
  const roadmapId = await buildRoadmap(organisationId, drafts);

  // --- 6. Report -----------------------------------------------------------
  const { narrative, provider: reportProvider } = await writeExecutiveNarrative(km, drafts, risk);
  providers.reportAgent = reportProvider;

  const content = buildReportContent(km, drafts, risk, narrative);

  const previousReport = await prisma.report.findFirst({
    where: { organisationId, type: 'AI_OPPORTUNITY' },
    orderBy: { version: 'desc' },
  });

  const report = await prisma.report.create({
    data: {
      organisationId,
      type: 'AI_OPPORTUNITY',
      title: `AI Opportunity Report — ${km.company.name}`,
      version: (previousReport?.version ?? 0) + 1,
      status: 'CONSULTANT_REVIEW',
      content: stringify(content),
      summary: narrative.overview,
      generatedBy: reportProvider === 'anthropic' ? 'llm' : 'engine',
    },
  });

  // --- 7. Version the knowledge model --------------------------------------
  const knowledgeVersion = await snapshotKnowledgeModel(
    organisationId,
    'ASSESSMENT',
    `Analysis run: ${drafts.length} opportunities assessed, ${created} created.`,
  );

  for (const [agent, provider] of Object.entries(providers)) {
    if (provider === 'engine') {
      warnings.push(`${agent} ran on the built-in analysis engine.`);
    }
  }

  await recordAudit({
    organisationId,
    userId,
    action: 'analysis.run',
    entityType: 'Report',
    entityId: report.id,
    metadata: { opportunities: drafts.length, created, updated, providers },
  });

  return {
    opportunitiesCreated: created,
    opportunitiesUpdated: updated,
    notRecommended: drafts.filter(
      (d) => d.recommendation === 'NOT_RECOMMENDED' || d.recommendation === 'DO_NOTHING',
    ).length,
    reportId: report.id,
    roadmapId,
    knowledgeVersion,
    providers,
    warnings,
  };
}

// ---------------------------------------------------------------------------

async function persistProcessAnalysis(
  organisationId: string,
  analysis: Awaited<ReturnType<typeof analyseProcesses>>['analysis'],
) {
  for (const insight of analysis.insights) {
    const process = await prisma.process.findFirst({
      where: { id: insight.processId, organisationId },
      include: { steps: true },
    });
    if (!process) continue;

    // A consultant's hand-drawn map is never overwritten by a regenerated one.
    if (insight.steps.length && !process.editedByConsultant && process.steps.length === 0) {
      await prisma.processStep.createMany({
        data: insight.steps.map((step, index) => ({
          processId: process.id,
          order: index,
          name: step.name,
          description: step.description,
          role: step.role,
          systemUsed: step.systemUsed,
          durationMins: step.durationMins,
          isManual: step.isManual,
          isBottleneck: step.isBottleneck,
          automatable: step.automatable,
        })),
      });
    }

    const existingProblems = await prisma.problem.findMany({
      where: { organisationId, processId: process.id },
    });
    const existingTitles = new Set(existingProblems.map((p) => p.title.toLowerCase()));

    const newProblems = insight.inefficiencies.filter(
      (i) => !existingTitles.has(i.title.toLowerCase()),
    );

    if (newProblems.length) {
      await prisma.problem.createMany({
        data: newProblems.map((i) => ({
          organisationId,
          processId: process.id,
          departmentId: process.departmentId,
          title: i.title,
          description: i.description,
          category: i.category,
          severity: i.severity,
          rootCause: i.rootCause,
          source: 'AI',
          confidence: insight.confidence,
          evidence: stringify([{ type: 'PROCESS', ref: process.id, quote: i.evidence }]),
        })),
      });
    }
  }
}

async function persistOpportunities(
  organisationId: string,
  drafts: OpportunityDraft[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const draft of drafts) {
    const existing = await prisma.aIOpportunity.findFirst({
      where: {
        organisationId,
        ...(draft.processId ? { processId: draft.processId } : { problemId: draft.problemId }),
      },
    });

    const calculationData = {
      currentHoursPerYear: draft.outcome.currentHoursPerYear,
      currentAnnualCost: draft.outcome.currentAnnualCost,
      reductionLowPct: draft.outcome.reductionLowPct,
      reductionHighPct: draft.outcome.reductionHighPct,
      capacityReleasedLowHrs: draft.outcome.capacityReleasedLowHrs,
      capacityReleasedHighHrs: draft.outcome.capacityReleasedHighHrs,
      costSavingLow: draft.outcome.costSavingLow,
      costSavingHigh: draft.outcome.costSavingHigh,
      revenueOpportunityLow: draft.outcome.revenueOpportunityLow,
      revenueOpportunityHigh: draft.outcome.revenueOpportunityHigh,
      implementationCostLow: draft.outcome.implementationCostLow,
      implementationCostHigh: draft.outcome.implementationCostHigh,
      runningCostPerYear: draft.outcome.runningCostPerYear,
      paybackMonthsLow: draft.outcome.paybackMonthsLow,
      paybackMonthsHigh: draft.outcome.paybackMonthsHigh,
      currency: draft.outcome.currency,
      assumptions: stringify(draft.outcome.assumptions),
      formulas: stringify(draft.outcome.formulas),
      inputs: stringify(draft.outcome.inputs),
      benchmarksUsed: stringify(draft.outcome.benchmarksUsed),
      confidence: draft.outcome.confidence,
      missingInputs: stringify(draft.outcome.missingInputs),
      calculatedAt: new Date(),
    };

    if (existing) {
      // Recalculate the figures always; leave consultant-edited wording alone.
      const textFields = existing.editedByConsultant
        ? {}
        : {
            name: draft.name,
            currentProblem: draft.currentProblem,
            proposedSolution: draft.proposedSolution,
            rationale: draft.rationale,
            aiCategory: draft.aiCategory,
            recommendation: draft.recommendation,
            notRecommendedReason: draft.notRecommendedReason,
            humanOversight: draft.humanOversight,
            dependencies: stringify(draft.dependencies),
          };

      await prisma.aIOpportunity.update({
        where: { id: existing.id },
        data: {
          ...textFields,
          implementationComplexity: draft.implementationComplexity,
          riskLevel: draft.riskLevel,
          priorityScore: draft.priorityScore,
          priorityBand: draft.priorityBand,
          confidence: draft.confidence,
          missingInformation: stringify(draft.missingInformation),
          sources: stringify(draft.sources),
        },
      });

      await prisma.opportunityCalculation.upsert({
        where: { opportunityId: existing.id },
        create: { opportunityId: existing.id, ...calculationData },
        update: calculationData,
      });

      updated++;
      continue;
    }

    const row = await prisma.aIOpportunity.create({
      data: {
        organisationId,
        processId: draft.processId,
        problemId: draft.problemId,
        name: draft.name,
        currentProblem: draft.currentProblem,
        proposedSolution: draft.proposedSolution,
        aiCategory: draft.aiCategory,
        rationale: draft.rationale,
        recommendation: draft.recommendation,
        notRecommendedReason: draft.notRecommendedReason,
        implementationComplexity: draft.implementationComplexity,
        riskLevel: draft.riskLevel,
        humanOversight: draft.humanOversight,
        dependencies: stringify(draft.dependencies),
        priorityScore: draft.priorityScore,
        priorityBand: draft.priorityBand,
        confidence: draft.confidence,
        missingInformation: stringify(draft.missingInformation),
        status: 'CONSULTANT_REVIEW',
        sources: stringify(draft.sources),
        calculation: { create: calculationData },
      },
    });

    if (draft.kpis.length) {
      await prisma.kpi.createMany({
        data: draft.kpis.map((k) => ({
          organisationId,
          opportunityId: row.id,
          name: k.name,
          metricKey: k.metricKey,
          unit: k.unit,
          direction: k.direction,
          baselineValue: k.baselineValue,
          projectedValue: k.projectedValue,
        })),
      });
    }

    created++;
  }

  return { created, updated };
}

async function buildRoadmap(organisationId: string, drafts: OpportunityDraft[]): Promise<string> {
  const recommended = drafts.filter(
    (d) => d.recommendation !== 'NOT_RECOMMENDED' && d.recommendation !== 'DO_NOTHING',
  );

  const previous = await prisma.roadmap.findFirst({
    where: { organisationId },
    orderBy: { version: 'desc' },
    include: { items: true },
  });

  // Preserve any decision the client already made on an opportunity.
  const priorDecisions = new Map(
    (previous?.items ?? []).map((item) => [item.opportunityId, item]),
  );

  const roadmap = await prisma.roadmap.create({
    data: {
      organisationId,
      title: 'AI Roadmap',
      version: (previous?.version ?? 0) + 1,
      status: 'DRAFT',
    },
  });

  const opportunities = await prisma.aIOpportunity.findMany({ where: { organisationId } });
  const byProcess = new Map(opportunities.filter((o) => o.processId).map((o) => [o.processId as string, o]));
  const byProblem = new Map(opportunities.filter((o) => o.problemId).map((o) => [o.problemId as string, o]));

  const quarters = ['Next quarter', 'Within 6 months', 'Within 12 months'];
  let sequence = 0;

  for (const band of ['PHASE_1', 'PHASE_2', 'PHASE_3'] as const) {
    const inBand = recommended.filter((d) => d.priorityBand === band);
    for (const draft of inBand) {
      const row = draft.processId ? byProcess.get(draft.processId) : byProblem.get(draft.problemId ?? '');
      if (!row) continue;

      const prior = priorDecisions.get(row.id);

      await prisma.roadmapItem.create({
        data: {
          roadmapId: roadmap.id,
          opportunityId: row.id,
          phase: band,
          sequence: sequence++,
          targetQuarter: quarters[['PHASE_1', 'PHASE_2', 'PHASE_3'].indexOf(band)],
          rationale: draft.rationale,
          clientDecision: prior?.clientDecision ?? 'PENDING',
          decidedAt: prior?.decidedAt ?? null,
          decidedById: prior?.decidedById ?? null,
        },
      });
    }
  }

  return roadmap.id;
}
