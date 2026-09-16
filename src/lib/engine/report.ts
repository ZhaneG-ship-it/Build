import type { KnowledgeModel } from './knowledge-model';
import type { OpportunityDraft } from './opportunities';
import type { RiskAssessment } from '../ai/agents/risk';
import { aggregateOutcomes } from './financials';
import { AI_CATEGORY_LABELS, RECOMMENDATION_LABELS, type AiCategory, type Recommendation } from '../types';

/**
 * AI Opportunity Report (§12).
 *
 * The report is a structured document, not a blob of prose: each block is data
 * the UI renders and the consultant can edit. That keeps figures consistent with
 * the underlying calculations and makes every claim traceable.
 */

export type ReportBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'stat-grid'; stats: { label: string; value: string; caption?: string; tone?: 'neutral' | 'positive' | 'caution' }[] }
  | { type: 'table'; columns: string[]; rows: string[][]; caption?: string }
  | { type: 'callout'; tone: 'info' | 'caution' | 'critical'; title: string; text: string }
  | { type: 'opportunity'; opportunityKey: string }
  | { type: 'phases'; phases: { phase: string; title: string; description: string; items: string[] }[] }
  | { type: 'assumptions'; items: { label: string; value: string; source: string; isEstimate: boolean }[] };

export interface ReportSection {
  key: string;
  title: string;
  blocks: ReportBlock[];
}

export interface ReportContent {
  generatedAt: string;
  organisationName: string;
  currency: string;
  confidenceNote: string;
  sections: ReportSection[];
  /** Full opportunity payloads the renderer expands where an `opportunity` block sits. */
  opportunities: ReportOpportunity[];
}

export interface ReportOpportunity {
  key: string;
  name: string;
  currentProblem: string;
  proposedSolution: string;
  aiCategory: string;
  aiCategoryLabel: string;
  recommendation: string;
  recommendationLabel: string;
  notRecommendedReason: string | null;
  rationale: string;
  complexity: string;
  risk: string;
  oversight: string;
  priorityScore: number;
  priorityBand: string;
  confidence: string;
  missingInformation: string[];
  dependencies: Record<string, string[]>;
  kpis: { name: string; unit: string; baseline: number | null; projected: number | null }[];
  outcome: {
    currentHoursPerYear: number | null;
    currentAnnualCost: number | null;
    reductionLowPct: number | null;
    reductionHighPct: number | null;
    capacityLowHrs: number | null;
    capacityHighHrs: number | null;
    costSavingLow: number | null;
    costSavingHigh: number | null;
    revenueLow: number | null;
    revenueHigh: number | null;
    implementationLow: number;
    implementationHigh: number;
    runningCostPerYear: number;
    paybackMonthsLow: number | null;
    paybackMonthsHigh: number | null;
  };
  assumptions: { label: string; value: string; source: string; isEstimate: boolean }[];
  formulas: { label: string; expression: string; result: string }[];
  sources: { type: string; ref: string; detail?: string }[];
}

export function fmtMoney(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return 'not estimated';
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : `${currency} `;
  return `${symbol}${Math.round(value).toLocaleString()}`;
}

export function fmtRange(
  low: number | null | undefined,
  high: number | null | undefined,
  currency: string,
): string {
  if (low === null || low === undefined || high === null || high === undefined) return 'not estimated';
  if (Math.round(low) === Math.round(high)) return fmtMoney(low, currency);
  return `${fmtMoney(low, currency)} – ${fmtMoney(high, currency)}`;
}

export function fmtHours(low: number | null | undefined, high: number | null | undefined): string {
  if (low === null || low === undefined || high === null || high === undefined) return 'not estimated';
  return `${Math.round(low).toLocaleString()} – ${Math.round(high).toLocaleString()} hours/year`;
}

export function opportunityKey(draft: OpportunityDraft): string {
  return draft.processId ?? `problem:${draft.problemId}`;
}

export function toReportOpportunity(draft: OpportunityDraft): ReportOpportunity {
  const o = draft.outcome;
  return {
    key: opportunityKey(draft),
    name: draft.name,
    currentProblem: draft.currentProblem,
    proposedSolution: draft.proposedSolution,
    aiCategory: draft.aiCategory,
    aiCategoryLabel: AI_CATEGORY_LABELS[draft.aiCategory as AiCategory] ?? draft.aiCategory,
    recommendation: draft.recommendation,
    recommendationLabel: RECOMMENDATION_LABELS[draft.recommendation as Recommendation] ?? draft.recommendation,
    notRecommendedReason: draft.notRecommendedReason,
    rationale: draft.rationale,
    complexity: draft.implementationComplexity,
    risk: draft.riskLevel,
    oversight: draft.humanOversight,
    priorityScore: draft.priorityScore,
    priorityBand: draft.priorityBand,
    confidence: draft.confidence,
    missingInformation: draft.missingInformation,
    dependencies: draft.dependencies as unknown as Record<string, string[]>,
    kpis: draft.kpis.map((k) => ({
      name: k.name,
      unit: k.unit,
      baseline: k.baselineValue,
      projected: k.projectedValue,
    })),
    outcome: {
      currentHoursPerYear: o.currentHoursPerYear,
      currentAnnualCost: o.currentAnnualCost,
      reductionLowPct: o.reductionLowPct,
      reductionHighPct: o.reductionHighPct,
      capacityLowHrs: o.capacityReleasedLowHrs,
      capacityHighHrs: o.capacityReleasedHighHrs,
      costSavingLow: o.costSavingLow,
      costSavingHigh: o.costSavingHigh,
      revenueLow: o.revenueOpportunityLow,
      revenueHigh: o.revenueOpportunityHigh,
      implementationLow: o.implementationCostLow,
      implementationHigh: o.implementationCostHigh,
      runningCostPerYear: o.runningCostPerYear,
      paybackMonthsLow: o.paybackMonthsLow,
      paybackMonthsHigh: o.paybackMonthsHigh,
    },
    assumptions: o.assumptions,
    formulas: o.formulas,
    sources: draft.sources,
  };
}

export interface ExecutiveNarrative {
  overview: string;
  maturityNarrative: string;
  keyProblems: string[];
  keyOpportunities: string[];
  potentialOutcomes: string;
  nextSteps: string[];
}

export function buildReportContent(
  km: KnowledgeModel,
  drafts: OpportunityDraft[],
  risk: RiskAssessment,
  narrative: ExecutiveNarrative,
): ReportContent {
  const currency = km.financials.currency;
  const recommended = drafts.filter(
    (d) => d.recommendation !== 'NOT_RECOMMENDED' && d.recommendation !== 'DO_NOTHING',
  );
  const notRecommended = drafts.filter(
    (d) => d.recommendation === 'NOT_RECOMMENDED' || d.recommendation === 'DO_NOTHING',
  );

  const totals = aggregateOutcomes(
    recommended.map((d) => ({
      capacityReleasedLowHrs: d.outcome.capacityReleasedLowHrs,
      capacityReleasedHighHrs: d.outcome.capacityReleasedHighHrs,
      costSavingLow: d.outcome.costSavingLow,
      costSavingHigh: d.outcome.costSavingHigh,
      revenueOpportunityLow: d.outcome.revenueOpportunityLow,
      revenueOpportunityHigh: d.outcome.revenueOpportunityHigh,
      implementationCostLow: d.outcome.implementationCostLow,
      implementationCostHigh: d.outcome.implementationCostHigh,
    })),
  );

  const phase = (band: string) => recommended.filter((d) => d.priorityBand === band);
  const phase1 = phase('PHASE_1');
  const phase2 = phase('PHASE_2');
  const phase3 = phase('PHASE_3');

  const lowConfidence = drafts.filter((d) => d.confidence === 'LOW').length;

  const sections: ReportSection[] = [];

  // --- 1. Executive summary ------------------------------------------------
  sections.push({
    key: 'executive-summary',
    title: 'Executive summary',
    blocks: [
      { type: 'paragraph', text: narrative.overview },
      {
        type: 'stat-grid',
        stats: [
          { label: 'AI maturity', value: `${km.aiPosture.aiMaturityLevel} of 5`, caption: 'Where the business stands today' },
          { label: 'Opportunities identified', value: String(recommended.length), caption: `${notRecommended.length} assessed and not recommended` },
          {
            label: 'Potential capacity released',
            value: fmtHours(totals.capacityLowHrs, totals.capacityHighHrs),
            caption: 'Estimated range across recommended opportunities',
            tone: 'positive',
          },
          {
            label: 'Estimated value of that capacity',
            value: fmtRange(totals.costSavingLow, totals.costSavingHigh, currency),
            caption: 'Estimate, not a guarantee',
            tone: 'positive',
          },
          {
            label: 'Estimated implementation cost',
            value: fmtRange(totals.implementationLow, totals.implementationHigh, currency),
            caption: 'Planning range, not a quotation',
            tone: 'caution',
          },
          {
            label: 'Potential revenue opportunity',
            value: totals.revenueHigh > 0 ? fmtRange(totals.revenueLow, totals.revenueHigh, currency) : 'Not estimated',
            caption: totals.revenueHigh > 0 ? 'Separate from cost saving' : 'Insufficient data supplied',
          },
        ],
      },
      { type: 'paragraph', text: narrative.maturityNarrative },
      ...(narrative.keyProblems.length
        ? ([{ type: 'bullets', items: narrative.keyProblems } as ReportBlock])
        : []),
      { type: 'paragraph', text: narrative.potentialOutcomes },
      {
        type: 'callout',
        tone: 'info',
        title: 'How to read the figures in this report',
        text: 'Every figure here is an estimate presented as a range, calculated from information this business supplied. Released capacity becomes a cash saving only if headcount, overtime or contractor spend actually falls; otherwise it is time available for other work. Nothing in this report is a guaranteed outcome.',
      },
    ],
  });

  // --- 2. Business analysis ------------------------------------------------
  const businessBlocks: ReportBlock[] = [
    {
      type: 'paragraph',
      text: `${km.company.name} operates in ${km.company.industry ?? 'an industry not yet recorded'}${
        km.company.subIndustry ? ` (${km.company.subIndustry})` : ''
      }, selling ${km.company.businessModel ?? 'to a market not yet recorded'}${
        km.company.employeeCount ? ` with ${km.company.employeeCount} employees` : ''
      }${km.company.locations.length ? ` across ${km.company.locations.join(', ')}` : ''}. ${
        km.company.productsServices ?? ''
      }`,
    },
  ];

  if (km.departments.length) {
    businessBlocks.push({
      type: 'table',
      columns: ['Department', 'Function', 'Headcount'],
      rows: km.departments.map((d) => [d.name, d.function ?? '—', d.headcount ? String(d.headcount) : '—']),
      caption: 'Departments recorded in the assessment',
    });
  }

  if (km.objectives.length) {
    businessBlocks.push({ type: 'paragraph', text: 'The business is working towards the following objectives:' });
    businessBlocks.push({ type: 'bullets', items: km.objectives.map((o) => `${o.title} (${o.category.replace(/_/g, ' ').toLowerCase()})`) });
  }

  if (km.technology.systems.length) {
    businessBlocks.push({
      type: 'table',
      columns: ['System', 'Category', 'Integration route'],
      rows: km.technology.systems.map((s) => [
        s.name,
        s.category.replace(/_/g, ' '),
        s.hasApi ? 'API available' : 'To be confirmed',
      ]),
      caption: 'Systems the business runs on today',
    });
  }

  sections.push({ key: 'business-analysis', title: 'How the business works today', blocks: businessBlocks });

  // --- 3. Process analysis -------------------------------------------------
  const processBlocks: ReportBlock[] = [];
  if (km.processes.length) {
    processBlocks.push({
      type: 'table',
      columns: ['Process', 'Department', 'Frequency', 'Hours/week', 'Manual', 'AI potential'],
      rows: km.processes.map((p) => [
        p.name,
        p.department ?? '—',
        p.frequency ? p.frequency.toLowerCase().replace('_', ' ') : '—',
        p.hoursPerWeek != null ? String(p.hoursPerWeek) : 'not recorded',
        p.manualScore != null ? `${p.manualScore}/5` : '—',
        p.aiPotential != null ? `${p.aiPotential}%` : '—',
      ]),
      caption: 'Mapped processes and their characteristics',
    });
  } else {
    processBlocks.push({
      type: 'callout',
      tone: 'caution',
      title: 'No processes mapped',
      text: 'No business processes have been recorded yet, so this analysis cannot identify where time is going. Map at least three processes to get a meaningful assessment.',
    });
  }

  if (km.problems.length) {
    processBlocks.push({ type: 'paragraph', text: 'The following problems were identified:' });
    processBlocks.push({
      type: 'table',
      columns: ['Problem', 'Type', 'Severity', 'Hours lost/week'],
      rows: km.problems.map((p) => [
        p.title,
        p.category.replace(/_/g, ' ').toLowerCase(),
        p.severity.toLowerCase(),
        p.hoursLostPerWeek != null ? String(p.hoursLostPerWeek) : 'not quantified',
      ]),
    });
  }

  sections.push({ key: 'process-analysis', title: 'Processes and where they lose time', blocks: processBlocks });

  // --- 4. Opportunities ----------------------------------------------------
  const opportunityBlocks: ReportBlock[] = [];
  if (recommended.length) {
    opportunityBlocks.push({
      type: 'paragraph',
      text: `${recommended.length} opportunit${recommended.length === 1 ? 'y was' : 'ies were'} identified, ordered by the priority model described later in this report.`,
    });
    for (const draft of recommended) {
      opportunityBlocks.push({ type: 'opportunity', opportunityKey: opportunityKey(draft) });
    }
  } else {
    opportunityBlocks.push({
      type: 'callout',
      tone: 'info',
      title: 'No opportunities recommended at this stage',
      text: 'Based on what the business has told us, no AI or automation opportunity currently justifies the cost and disruption of implementing it. That is a legitimate result, not a failure of the assessment.',
    });
  }

  if (notRecommended.length) {
    opportunityBlocks.push({
      type: 'paragraph',
      text: `The following ${notRecommended.length === 1 ? 'process was' : `${notRecommended.length} processes were`} assessed and deliberately not recommended for AI. Knowing where not to spend is as valuable as knowing where to.`,
    });
    for (const draft of notRecommended) {
      opportunityBlocks.push({ type: 'opportunity', opportunityKey: opportunityKey(draft) });
    }
  }

  sections.push({ key: 'opportunities', title: 'AI opportunities', blocks: opportunityBlocks });

  // --- 5. Financial model --------------------------------------------------
  const financialBlocks: ReportBlock[] = [
    {
      type: 'paragraph',
      text: 'These figures combine the estimates for every recommended opportunity. They are ranges built from the information supplied, and the four measures below are deliberately kept separate — they are not the same kind of money and should not be added together.',
    },
    {
      type: 'table',
      columns: ['Measure', 'Estimated range', 'What it means'],
      rows: [
        [
          'Current cost of the affected work',
          fmtMoney(
            recommended.reduce((sum, d) => sum + (d.outcome.currentAnnualCost ?? 0), 0),
            currency,
          ),
          'What these processes cost to run today, at the supplied labour rate.',
        ],
        [
          'Potential capacity released',
          fmtHours(totals.capacityLowHrs, totals.capacityHighHrs),
          'Time that could be freed each year. Real, but not automatically cash.',
        ],
        [
          'Value of released capacity',
          fmtRange(totals.costSavingLow, totals.costSavingHigh, currency),
          'That time valued at the supplied hourly cost. A cash saving only if spend actually falls.',
        ],
        [
          'Potential revenue opportunity',
          totals.revenueHigh > 0 ? fmtRange(totals.revenueLow, totals.revenueHigh, currency) : 'Not estimated',
          totals.revenueHigh > 0
            ? 'Additional revenue from converting existing demand more consistently.'
            : 'Not enough information was supplied to estimate this responsibly.',
        ],
        [
          'Estimated implementation cost',
          fmtRange(totals.implementationLow, totals.implementationHigh, currency),
          'One-off build cost across all recommended opportunities. A planning band, not a quotation.',
        ],
        [
          'Estimated annual running cost',
          fmtMoney(
            recommended.reduce((sum, d) => sum + d.outcome.runningCostPerYear, 0),
            currency,
          ),
          'Licences, hosting and maintenance once live.',
        ],
      ],
    },
  ];

  const allAssumptions = new Map<string, { label: string; value: string; source: string; isEstimate: boolean }>();
  for (const draft of recommended) {
    for (const assumption of draft.outcome.assumptions) {
      allAssumptions.set(`${assumption.label}|${assumption.value}`, assumption);
    }
  }
  if (allAssumptions.size) {
    financialBlocks.push({ type: 'paragraph', text: 'Every figure above rests on the following assumptions:' });
    financialBlocks.push({ type: 'assumptions', items: [...allAssumptions.values()] });
  }

  if (km.completeness.criticalGaps.length) {
    financialBlocks.push({
      type: 'callout',
      tone: 'caution',
      title: 'Information that would improve these figures',
      text: km.completeness.criticalGaps.join(' '),
    });
  }

  sections.push({ key: 'financial-model', title: 'Financial model', blocks: financialBlocks });

  // --- 6. Roadmap ----------------------------------------------------------
  sections.push({
    key: 'roadmap',
    title: 'AI roadmap',
    blocks: [
      {
        type: 'paragraph',
        text: 'Opportunities are sequenced on business impact, the time the work consumes, how ready the data is, implementation difficulty, cost and risk — not on how interesting the technology is.',
      },
      {
        type: 'phases',
        phases: [
          {
            phase: 'Phase 1',
            title: 'Start here',
            description: 'Clear benefit, contained implementation, low risk. These prove the approach and build confidence.',
            items: phase1.map((d) => d.name),
          },
          {
            phase: 'Phase 2',
            title: 'Next, once Phase 1 is delivering',
            description: 'Worthwhile but either more involved or dependent on something from Phase 1.',
            items: phase2.map((d) => d.name),
          },
          {
            phase: 'Phase 3',
            title: 'Later',
            description: 'Genuine potential, but needs better data, more capacity or a clearer business case first.',
            items: phase3.map((d) => d.name),
          },
        ],
      },
    ],
  });

  // --- 7. Risk -------------------------------------------------------------
  sections.push({
    key: 'risk',
    title: 'Risk assessment',
    blocks: [
      { type: 'paragraph', text: risk.overallPosture },
      ...(risk.requiresHumanReview
        ? ([
            {
              type: 'callout',
              tone: 'critical',
              title: 'Human review required before implementation',
              text: 'Given the data this business handles and the obligations it operates under, a person must review and sign off each implementation before it goes live.',
            },
          ] as ReportBlock[])
        : []),
      {
        type: 'table',
        columns: ['Risk', 'Area', 'Severity', 'Control'],
        rows: risk.risks.map((r) => [r.title, r.category.replace(/_/g, ' ').toLowerCase(), r.severity.toLowerCase(), r.mitigation]),
      },
    ],
  });

  // --- 8. Next steps -------------------------------------------------------
  sections.push({
    key: 'next-steps',
    title: 'Recommended next steps',
    blocks: [
      { type: 'bullets', items: narrative.nextSteps },
      ...(lowConfidence > 0
        ? ([
            {
              type: 'callout',
              tone: 'caution',
              title: `${lowConfidence} opportunit${lowConfidence === 1 ? 'y is' : 'ies are'} low confidence`,
              text: 'These are included because the underlying problem is real, but the figures against them rest on benchmarks rather than your own data. Supplying the missing information listed against each one will materially improve the estimate.',
            },
          ] as ReportBlock[])
        : []),
    ],
  });

  const confidenceNote =
    km.completeness.overall >= 0.75
      ? 'This assessment is based on a well-populated picture of the business. The main figures rest on information you supplied rather than on benchmarks.'
      : km.completeness.overall >= 0.45
        ? 'This assessment is based on a reasonable picture of the business, but several figures rest on benchmarks rather than your own data. The gaps are listed against each opportunity.'
        : 'This assessment is based on limited information. Treat the figures as indicative only and complete the outstanding questions before making investment decisions.';

  return {
    generatedAt: new Date().toISOString(),
    organisationName: km.company.name,
    currency,
    confidenceNote,
    sections,
    opportunities: drafts.map(toReportOpportunity),
  };
}
