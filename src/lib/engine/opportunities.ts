import { AI_CATEGORY_LABELS, type AiCategory, type Confidence, type EvidenceRef, type Recommendation } from '../types';
import type { KmProcess, KnowledgeModel } from './knowledge-model';
import { calculateOutcome, type OutcomeResult } from './financials';

/**
 * AI Opportunity Engine (§9) and prioritisation model (§11).
 *
 * The engine starts from how the business actually works — the mapped processes
 * and recorded problems — and asks whether AI or automation could realistically
 * improve each one. It is explicitly allowed, and expected, to conclude that AI
 * is not appropriate, or that the right answer is to do nothing.
 */

export interface OpportunityDraft {
  processId: string | null;
  problemId: string | null;
  name: string;
  currentProblem: string;
  proposedSolution: string;
  aiCategory: AiCategory;
  rationale: string;
  recommendation: Recommendation;
  notRecommendedReason: string | null;
  implementationComplexity: 'LOW' | 'MEDIUM' | 'HIGH';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  humanOversight: 'HUMAN_IN_LOOP' | 'HUMAN_ON_LOOP' | 'PERIODIC_AUDIT' | 'AUTONOMOUS';
  dependencies: Dependencies;
  kpis: KpiDraft[];
  priorityScore: number;
  priorityBand: 'PHASE_1' | 'PHASE_2' | 'PHASE_3' | 'NOT_RECOMMENDED';
  confidence: Confidence;
  missingInformation: string[];
  sources: EvidenceRef[];
  outcome: OutcomeResult;
  scoreBreakdown: Record<string, number>;
}

export interface Dependencies {
  data: string[];
  software: string[];
  apis: string[];
  integrations: string[];
  training: string[];
  security: string[];
  policies: string[];
}

export interface KpiDraft {
  name: string;
  metricKey: string;
  unit: string;
  direction: 'INCREASE' | 'DECREASE';
  baselineValue: number | null;
  projectedValue: number | null;
}

// ---------------------------------------------------------------------------
// Category classification
// ---------------------------------------------------------------------------

interface CategoryRule {
  category: AiCategory;
  keywords: string[];
  solution: (p: KmProcess) => string;
  revenueLinked?: boolean;
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'DOCUMENT_AI',
    keywords: ['invoice', 'receipt', 'document', 'form', 'paperwork', 'data entry', 'scan', 'purchase order', 'statement', 'expense', 'timesheet', 'contract review'],
    solution: (p) =>
      `Use document AI to read incoming items automatically, extract the fields that matter, and post them into ${
        p.systemsUsed[0] ?? 'your system of record'
      } for a person to approve rather than retype.`,
  },
  {
    category: 'AI_CHATBOT',
    keywords: ['enquiry', 'enquiries', 'inquiry', 'customer question', 'support ticket', 'helpdesk', 'faq', 'first line', 'live chat'],
    solution: () =>
      'Use an AI assistant on the front line to answer routine questions from approved content, and hand anything unusual straight to a person with the context already gathered.',
    revenueLinked: true,
  },
  {
    category: 'VOICE_AI',
    keywords: ['phone', 'call', 'inbound calls', 'voicemail', 'switchboard', 'answering'],
    solution: () =>
      'Use voice AI to handle routine inbound calls, capture the caller’s details and reason for calling, and route or escalate with a written summary.',
  },
  {
    category: 'AI_REPORTING',
    keywords: ['report', 'reporting', 'dashboard', 'management pack', 'kpi', 'month end', 'board pack'],
    solution: () =>
      'Generate the recurring reporting pack automatically from the source systems, leaving people to review the commentary rather than assemble the numbers.',
  },
  {
    category: 'GENERATIVE_AI',
    keywords: ['proposal', 'quote', 'draft', 'content', 'copy', 'marketing', 'social', 'newsletter', 'job advert', 'tender', 'writing'],
    solution: () =>
      'Use generative AI to produce a first draft from your own approved material and past examples, with a person editing and approving before anything goes out.',
    revenueLinked: true,
  },
  {
    category: 'KNOWLEDGE_MANAGEMENT',
    keywords: ['find information', 'knowledge', 'search', 'looking for', 'handbook', 'policy question', 'onboarding question', 'where is'],
    solution: () =>
      'Put your procedures and policies behind an internal assistant that answers staff questions with a citation back to the source document.',
  },
  {
    category: 'AI_FORECASTING',
    keywords: ['forecast', 'demand', 'stock', 'inventory', 'capacity planning', 'cash flow'],
    solution: () => 'Use forecasting models over your own history to produce a baseline forecast that a person adjusts, rather than building it from scratch each cycle.',
  },
  {
    category: 'PREDICTIVE_ANALYTICS',
    keywords: ['prioritise', 'prioritize', 'triage', 'scoring', 'churn', 'risk of', 'which customers', 'allocate'],
    solution: () => 'Score and rank the queue so attention goes to the items most likely to matter, with the ranking explained and overridable.',
    revenueLinked: true,
  },
  {
    category: 'COMPUTER_VISION',
    keywords: ['inspection', 'photo', 'image', 'visual check', 'defect', 'damage'],
    solution: () => 'Use image recognition to carry out the first-pass visual check and flag anything uncertain for human inspection.',
  },
  {
    category: 'WORKFLOW_AUTOMATION',
    keywords: ['follow up', 'follow-up', 'reminder', 'chase', 'copy', 'rekey', 're-key', 'transfer between', 'update the spreadsheet', 'manual update', 'scheduling', 'booking', 'onboarding'],
    solution: (p) => {
      const systems = p.systemsUsed.slice(0, 2);
      const where =
        systems.length >= 2
          ? `between ${systems.join(' and ')}`
          : systems.length === 1
            ? `into and out of ${systems[0]}`
            : 'between your systems';
      return `Automate the hand-offs in this process so records move ${where} without anyone rekeying them, with alerts when something needs a decision.`;
    },
    revenueLinked: true,
  },
];

function classify(process: KmProcess): { rule: CategoryRule; matched: string[] } {
  const haystack = [
    process.name,
    process.description ?? '',
    process.inputs ?? '',
    process.outputs ?? '',
    process.trigger ?? '',
    process.delayDescription ?? '',
    process.errorImpact ?? '',
  ]
    .join(' ')
    .toLowerCase();

  let best: { rule: CategoryRule; matched: string[] } | null = null;

  for (const rule of CATEGORY_RULES) {
    const matched = rule.keywords.filter((k) => haystack.includes(k));
    if (matched.length && (!best || matched.length > best.matched.length)) {
      best = { rule, matched };
    }
  }

  if (best) return best;

  // No keyword signal: fall back on the shape of the work. A multi-system,
  // multi-step process is agent-shaped; anything else is workflow automation.
  const agentShaped = process.systemsUsed.length >= 2 && process.stepCount >= 4;
  const fallback: CategoryRule = agentShaped
    ? {
        category: 'AI_AGENT',
        keywords: [],
        solution: (p) =>
          `Use a supervised AI agent to carry this process across ${p.systemsUsed.join(', ')}, completing the routine path and escalating exceptions to its owner.`,
      }
    : CATEGORY_RULES.find((r) => r.category === 'WORKFLOW_AUTOMATION')!;

  return { rule: fallback, matched: [] };
}

// ---------------------------------------------------------------------------
// Suitability — is AI actually the right answer? (§11, §27)
// ---------------------------------------------------------------------------

interface Suitability {
  suitable: boolean;
  reason: string | null;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  oversight: OpportunityDraft['humanOversight'];
}

const MIN_ANNUAL_HOURS_TO_BOTHER = 26; // half an hour a week

function assessSuitability(process: KmProcess, km: KnowledgeModel, annualHours: number | null): Suitability {
  const noAutonomyText = (km.risk.noAutonomyProcesses ?? '').toLowerCase();
  const mentionedAsHumanOnly =
    noAutonomyText.length > 0 &&
    process.name
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .some((word) => noAutonomyText.includes(word));

  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = process.riskLevel as 'LOW' | 'MEDIUM' | 'HIGH';
  if (km.risk.handlesSensitiveData && process.customerImpact === 'HIGH') riskLevel = 'HIGH';
  else if (km.risk.regulations.length > 0 && riskLevel === 'LOW') riskLevel = 'MEDIUM';

  let oversight: OpportunityDraft['humanOversight'] = 'HUMAN_IN_LOOP';
  if (riskLevel === 'LOW' && (process.repetitivenessScore ?? 0) >= 4 && process.customerImpact !== 'HIGH') {
    oversight = 'HUMAN_ON_LOOP';
  }
  if (mentionedAsHumanOnly || riskLevel === 'HIGH') oversight = 'HUMAN_IN_LOOP';
  if (km.aiPosture.oversightPreference === 'HUMAN_IN_LOOP') oversight = 'HUMAN_IN_LOOP';

  // Too small to be worth the effort.
  if (annualHours != null && annualHours < MIN_ANNUAL_HOURS_TO_BOTHER) {
    return {
      suitable: false,
      reason: `This process consumes roughly ${Math.round(annualHours)} hours a year. Even a complete automation would release less time than the implementation and ongoing maintenance would consume. The cost of change is not justified here.`,
      riskLevel,
      oversight,
    };
  }

  // Already largely automated.
  if (process.manualScore != null && process.manualScore <= 1 && (process.errorRate ?? 0) < 2) {
    return {
      suitable: false,
      reason:
        'This process is already largely automated and is not producing errors. There is no meaningful inefficiency for AI to remove, and changing it would introduce risk for no return.',
      riskLevel,
      oversight,
    };
  }

  // Highly variable judgement work with poor data and real consequences.
  const lowRepeat = (process.repetitivenessScore ?? 3) <= 2;
  const poorData = (process.dataReadiness ?? 3) <= 2;
  if (lowRepeat && poorData && (process.customerImpact === 'HIGH' || riskLevel === 'HIGH')) {
    return {
      suitable: false,
      reason:
        'This work varies case by case, the underlying data is not in good enough shape to learn from, and mistakes reach the customer directly. AI would need close supervision on every case, which removes the saving. Improving the underlying data and process documentation is the sensible first step, and AI can be reconsidered afterwards.',
      riskLevel,
      oversight,
    };
  }

  return { suitable: true, reason: null, riskLevel, oversight };
}

// ---------------------------------------------------------------------------
// Complexity & dependencies
// ---------------------------------------------------------------------------

function assessComplexity(process: KmProcess, km: KnowledgeModel, category: AiCategory): 'LOW' | 'MEDIUM' | 'HIGH' {
  let score = 0;

  if (process.systemsUsed.length >= 3) score += 2;
  else if (process.systemsUsed.length === 2) score += 1;

  const namedSystems = km.technology.systems.filter((s) =>
    process.systemsUsed.some((u) => u.toLowerCase().includes(s.name.toLowerCase())),
  );
  const anyWithoutApi = namedSystems.some((s) => !s.hasApi);
  if (anyWithoutApi || namedSystems.length === 0) score += 1;

  if ((process.dataReadiness ?? 3) <= 2) score += 2;
  if (process.stepCount >= 6) score += 1;
  if (km.risk.handlesSensitiveData) score += 1;
  if (km.risk.regulations.length > 0) score += 1;

  if (category === 'AI_AGENT' || category === 'COMPUTER_VISION' || category === 'VOICE_AI') score += 2;
  if (category === 'PREDICTIVE_ANALYTICS' || category === 'AI_FORECASTING') score += 1;

  if (score >= 6) return 'HIGH';
  if (score >= 3) return 'MEDIUM';
  return 'LOW';
}

function buildDependencies(process: KmProcess, km: KnowledgeModel, category: AiCategory): Dependencies {
  const systemNames = process.systemsUsed.length ? process.systemsUsed : ['your current systems'];
  const known = km.technology.systems.filter((s) =>
    process.systemsUsed.some((u) => u.toLowerCase().includes(s.name.toLowerCase())),
  );

  const deps: Dependencies = {
    data: [],
    software: systemNames,
    apis: [],
    integrations: [],
    training: [],
    security: [],
    policies: [],
  };

  switch (category) {
    case 'DOCUMENT_AI':
      deps.data.push('A sample of at least 50 representative documents, including the awkward ones');
      deps.data.push('An agreed list of the fields to extract and what each one means');
      break;
    case 'AI_CHATBOT':
    case 'KNOWLEDGE_MANAGEMENT':
      deps.data.push('Current, approved answer content — policies, FAQs and procedures');
      deps.policies.push('An agreed rule for what the assistant must never answer on its own');
      break;
    case 'AI_FORECASTING':
    case 'PREDICTIVE_ANALYTICS':
      deps.data.push('At least 12 months of clean history for the thing being predicted');
      deps.data.push('An agreed definition of the outcome being predicted');
      break;
    case 'AI_AGENT':
      deps.data.push('A written description of the routine path and the exception paths');
      deps.policies.push('Explicit limits on what the agent may do without approval');
      break;
    default:
      deps.data.push('Access to the records this process reads and writes');
  }

  for (const system of known) {
    if (system.hasApi) deps.apis.push(`${system.name} API access`);
    else deps.integrations.push(`${system.name} — confirm whether an API or export exists`);
  }
  if (known.length === 0) {
    deps.integrations.push(`Confirm integration options for ${systemNames.join(', ')}`);
  }

  deps.training.push(`Short training for the ${process.department ?? 'team'} on how to use and check the output`);
  if (process.owner) deps.training.push(`Handover to ${process.owner} as the process owner`);

  if (km.risk.handlesSensitiveData) {
    deps.security.push('Data protection review before any personal data is processed');
    deps.security.push('Agreement on where data is processed and how long it is retained');
  } else {
    deps.security.push('Confirmation of what data leaves your systems and where it is processed');
  }

  if (km.risk.regulations.length > 0) {
    deps.policies.push(`Compliance sign-off against ${km.risk.regulations.join(', ')}`);
  }
  deps.policies.push('An agreed escalation route when the AI is unsure');

  return deps;
}

function buildKpis(process: KmProcess, outcome: OutcomeResult, category: AiCategory): KpiDraft[] {
  const kpis: KpiDraft[] = [
    {
      name: `Hours spent on ${process.name}`,
      metricKey: 'HOURS_SAVED',
      unit: 'hours/month',
      direction: 'DECREASE',
      baselineValue: outcome.currentHoursPerYear != null ? Math.round(outcome.currentHoursPerYear / 12) : null,
      projectedValue:
        outcome.currentHoursPerYear != null && outcome.capacityReleasedHighHrs != null
          ? Math.round((outcome.currentHoursPerYear - outcome.capacityReleasedHighHrs) / 12)
          : null,
    },
    {
      name: 'Output accepted without correction',
      metricKey: 'ACCURACY',
      unit: '%',
      direction: 'INCREASE',
      baselineValue: null,
      projectedValue: 90,
    },
    {
      name: 'Team adoption',
      metricKey: 'ADOPTION',
      unit: '% of team using it weekly',
      direction: 'INCREASE',
      baselineValue: 0,
      projectedValue: 80,
    },
  ];

  if (process.errorRate != null) {
    kpis.push({
      name: `Error rate on ${process.name}`,
      metricKey: 'ERROR_RATE',
      unit: '%',
      direction: 'DECREASE',
      baselineValue: process.errorRate,
      projectedValue: Math.max(0.5, Math.round(process.errorRate * 0.4 * 10) / 10),
    });
  }

  if (category === 'AI_CHATBOT' || category === 'VOICE_AI') {
    kpis.push({
      name: 'Enquiries resolved without a person',
      metricKey: 'ESCALATION_RATE',
      unit: '% escalated',
      direction: 'DECREASE',
      baselineValue: 100,
      projectedValue: 55,
    });
    kpis.push({
      name: 'Customer satisfaction',
      metricKey: 'CSAT',
      unit: '/5',
      direction: 'INCREASE',
      baselineValue: null,
      projectedValue: null,
    });
  }

  if (outcome.revenueOpportunityLow != null) {
    kpis.push({
      name: 'Revenue attributed to this change',
      metricKey: 'REVENUE',
      unit: outcome.currency,
      direction: 'INCREASE',
      baselineValue: 0,
      projectedValue: outcome.revenueOpportunityLow,
    });
  }

  return kpis;
}

// ---------------------------------------------------------------------------
// Prioritisation (§11)
// ---------------------------------------------------------------------------

const WEIGHTS = {
  businessImpact: 20,
  strategicFit: 12,
  timeConsumed: 14,
  frequency: 6,
  automationPotential: 12,
  revenueOpportunity: 10,
  costReduction: 10,
  dataReadiness: 6,
  implementationEase: 10,
  costEase: 5,
  riskSafety: 8,
  integrationSimplicity: 5,
};

const FREQUENCY_SCORE: Record<string, number> = {
  CONTINUOUS: 1,
  DAILY: 1,
  WEEKLY: 0.8,
  MONTHLY: 0.5,
  QUARTERLY: 0.25,
  ANNUAL: 0.1,
  AD_HOC: 0.4,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function prioritise(
  process: KmProcess,
  km: KnowledgeModel,
  outcome: OutcomeResult,
  complexity: 'LOW' | 'MEDIUM' | 'HIGH',
  risk: 'LOW' | 'MEDIUM' | 'HIGH',
): { score: number; breakdown: Record<string, number> } {
  const impactMap: Record<string, number> = { NONE: 0, LOW: 0.33, MEDIUM: 0.66, HIGH: 1 };

  // Business impact blends customer and revenue exposure with problem severity.
  const linkedProblems = km.problems.filter((p) => p.processId === process.id);
  const severityScore = linkedProblems.length
    ? Math.max(
        ...linkedProblems.map((p) => ({ LOW: 0.25, MEDIUM: 0.5, HIGH: 0.8, CRITICAL: 1 })[p.severity] ?? 0.5),
      )
    : 0.3;
  const businessImpact = clamp01(
    (impactMap[process.customerImpact ?? 'NONE'] ?? 0) * 0.4 +
      (impactMap[process.revenueImpact ?? 'NONE'] ?? 0) * 0.3 +
      severityScore * 0.3,
  );

  // Strategic fit: does this process touch a stated objective or stated problem?
  const objectiveText = km.objectives.map((o) => `${o.title} ${o.category}`).join(' ').toLowerCase();
  const strategyText = [km.strategy.biggestGoals, km.strategy.biggestProblems, km.strategy.timeSinks, km.strategy.inefficientAreas]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const processWords = process.name.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
  const objectiveHit = processWords.some((w) => objectiveText.includes(w));
  const strategyHit = processWords.some((w) => strategyText.includes(w));
  const strategicFit = clamp01((objectiveHit ? 0.6 : 0) + (strategyHit ? 0.4 : 0) + (linkedProblems.length ? 0.2 : 0));

  // Time consumed, normalised against 1,000 hours/year as a strong signal.
  const timeConsumed = outcome.currentHoursPerYear != null ? clamp01(outcome.currentHoursPerYear / 1000) : 0.2;

  const frequency = FREQUENCY_SCORE[process.frequency ?? 'AD_HOC'] ?? 0.4;

  const automationPotential = clamp01(
    (((process.manualScore ?? 3) + (process.repetitivenessScore ?? 3)) / 10) *
      ((outcome.reductionHighPct ?? 40) / 100 + 0.5),
  );

  const maxRevenue = Math.max(
    1,
    ...km.processes.map(() => outcome.revenueOpportunityHigh ?? 0),
  );
  const revenueOpportunity = outcome.revenueOpportunityHigh
    ? clamp01(outcome.revenueOpportunityHigh / Math.max(maxRevenue, 20_000))
    : 0;

  const costReduction = outcome.costSavingHigh ? clamp01(outcome.costSavingHigh / 50_000) : 0;

  const dataReadiness = clamp01((process.dataReadiness ?? 3) / 5);

  const implementationEase = { LOW: 1, MEDIUM: 0.6, HIGH: 0.25 }[complexity];
  const costEase = clamp01(
    1 - outcome.implementationCostHigh / Math.max(km.financials.aiBudget ?? 60_000, 20_000),
  );
  const riskSafety = { LOW: 1, MEDIUM: 0.6, HIGH: 0.25 }[risk];
  const integrationSimplicity = clamp01(1 - (process.systemsUsed.length - 1) / 4);

  const breakdown: Record<string, number> = {
    businessImpact: businessImpact * WEIGHTS.businessImpact,
    strategicFit: strategicFit * WEIGHTS.strategicFit,
    timeConsumed: timeConsumed * WEIGHTS.timeConsumed,
    frequency: frequency * WEIGHTS.frequency,
    automationPotential: automationPotential * WEIGHTS.automationPotential,
    revenueOpportunity: revenueOpportunity * WEIGHTS.revenueOpportunity,
    costReduction: costReduction * WEIGHTS.costReduction,
    dataReadiness: dataReadiness * WEIGHTS.dataReadiness,
    implementationEase: implementationEase * WEIGHTS.implementationEase,
    costEase: costEase * WEIGHTS.costEase,
    riskSafety: riskSafety * WEIGHTS.riskSafety,
    integrationSimplicity: integrationSimplicity * WEIGHTS.integrationSimplicity,
  };

  const total = Object.values(breakdown).reduce((s, v) => s + v, 0);
  const maxPossible = Object.values(WEIGHTS).reduce((s, v) => s + v, 0);

  return {
    score: Math.round((total / maxPossible) * 1000) / 10,
    breakdown: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, Math.round(v * 10) / 10])),
  };
}

function bandFor(score: number): 'PHASE_1' | 'PHASE_2' | 'PHASE_3' {
  if (score >= 58) return 'PHASE_1';
  if (score >= 38) return 'PHASE_2';
  return 'PHASE_3';
}

// ---------------------------------------------------------------------------
// Process scoring (used by the process map)
// ---------------------------------------------------------------------------

export function scoreProcessPotential(process: KmProcess): {
  aiPotential: number;
  automationPotential: number;
} {
  const manual = process.manualScore ?? 3;
  const repetitive = process.repetitivenessScore ?? 3;
  const data = process.dataReadiness ?? 3;
  const volume = process.hoursPerWeek != null ? Math.min(1, process.hoursPerWeek / 20) : 0.4;
  const riskPenalty = { LOW: 0, MEDIUM: 0.08, HIGH: 0.2 }[process.riskLevel] ?? 0;

  const automation = clamp01((manual / 5) * 0.4 + (repetitive / 5) * 0.4 + volume * 0.2 - riskPenalty);
  const ai = clamp01((repetitive / 5) * 0.3 + (data / 5) * 0.3 + (manual / 5) * 0.2 + volume * 0.2 - riskPenalty);

  return {
    automationPotential: Math.round(automation * 100),
    aiPotential: Math.round(ai * 100),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function generateOpportunities(km: KnowledgeModel): OpportunityDraft[] {
  const drafts: OpportunityDraft[] = [];

  for (const process of km.processes) {
    const { rule, matched } = classify(process);
    const category = rule.category;

    const linkedProblem = km.problems.find((p) => p.processId === process.id) ?? null;

    // Cost the current state first, so suitability can use real annual hours.
    const provisional = calculateOutcome(process, km, {
      aiCategory: category,
      complexity: 'MEDIUM',
      revenueImpact: process.revenueImpact,
    });

    const suitability = assessSuitability(process, km, provisional.currentHoursPerYear);
    const complexity = assessComplexity(process, km, category);

    const outcome = calculateOutcome(process, km, {
      aiCategory: category,
      complexity,
      revenueImpact: rule.revenueLinked ? process.revenueImpact ?? 'MEDIUM' : process.revenueImpact,
    });

    const sources: EvidenceRef[] = [
      { type: 'PROCESS', ref: process.id, detail: `Process "${process.name}" as mapped (source: ${process.source})` },
    ];
    if (linkedProblem) {
      sources.push({ type: 'ASSESSMENT', ref: linkedProblem.id, detail: `Recorded problem: ${linkedProblem.title}` });
    }
    for (const benchmark of outcome.benchmarksUsed) {
      sources.push({ type: 'BENCHMARK', ref: benchmark, detail: 'Used only to bound the estimate range' });
    }

    const currentProblem = linkedProblem?.description
      ? `${linkedProblem.title}. ${linkedProblem.description}`
      : describeCurrentState(process);

    if (!suitability.suitable) {
      drafts.push({
        processId: process.id,
        problemId: linkedProblem?.id ?? null,
        name: `${process.name} — AI not recommended`,
        currentProblem,
        proposedSolution:
          'No AI or automation change is recommended for this process at present. The practical next step is described below.',
        aiCategory: 'NOT_RECOMMENDED',
        rationale: suitability.reason ?? 'AI is not appropriate for this process.',
        recommendation: 'NOT_RECOMMENDED',
        notRecommendedReason: suitability.reason,
        implementationComplexity: complexity,
        riskLevel: suitability.riskLevel,
        humanOversight: suitability.oversight,
        dependencies: { data: [], software: [], apis: [], integrations: [], training: [], security: [], policies: [] },
        kpis: [],
        priorityScore: 0,
        priorityBand: 'NOT_RECOMMENDED',
        confidence: outcome.confidence,
        missingInformation: outcome.missingInputs,
        sources,
        outcome,
        scoreBreakdown: {},
      });
      continue;
    }

    const { score, breakdown } = prioritise(process, km, outcome, complexity, suitability.riskLevel);

    // Anything genuinely marginal is presented as "investigate", not "implement".
    const recommendation: Recommendation =
      score >= 58 ? 'IMPLEMENT' : score >= 38 ? 'INVESTIGATE' : 'DEFER';

    const rationaleBits: string[] = [];
    if (matched.length) {
      rationaleBits.push(
        `The way this process is described ("${matched.slice(0, 3).join('", "')}") points to ${
          AI_CATEGORY_LABELS[rule.category] ?? rule.category
        }.`,
      );
    }
    if (outcome.currentHoursPerYear != null) {
      rationaleBits.push(
        `It consumes about ${Math.round(outcome.currentHoursPerYear).toLocaleString()} hours a year, which is what makes it worth addressing.`,
      );
    }
    if (process.errorRate != null) rationaleBits.push(`A recorded error rate of ${process.errorRate}% adds rework on top of the direct time.`);
    if (complexity === 'HIGH') rationaleBits.push('Implementation is involved, so this is sequenced accordingly rather than started first.');
    if (suitability.riskLevel === 'HIGH') rationaleBits.push('The risk profile requires a person to approve each output.');

    drafts.push({
      processId: process.id,
      problemId: linkedProblem?.id ?? null,
      name: opportunityName(process, category),
      currentProblem,
      proposedSolution: rule.solution(process),
      aiCategory: category,
      rationale: rationaleBits.join(' '),
      recommendation,
      notRecommendedReason: null,
      implementationComplexity: complexity,
      riskLevel: suitability.riskLevel,
      humanOversight: suitability.oversight,
      dependencies: buildDependencies(process, km, category),
      kpis: buildKpis(process, outcome, category),
      priorityScore: score,
      priorityBand: bandFor(score),
      confidence: outcome.confidence,
      missingInformation: outcome.missingInputs,
      sources,
      outcome,
      scoreBreakdown: breakdown,
    });
  }

  // Problems with no mapped process still deserve a considered answer.
  for (const problem of km.problems.filter((p) => !p.processId)) {
    drafts.push(orphanProblemDraft(problem, km));
  }

  const sorted = drafts.sort((a, b) => b.priorityScore - a.priorityScore);
  return attributeRevenueOnce(sorted);
}

/**
 * Every revenue estimate is derived from the same lead volume, conversion rate
 * and customer value, so several opportunities each claiming it would be the
 * same money counted repeatedly. Revenue is therefore attributed to exactly one
 * opportunity — the highest-priority one that plausibly moves conversion — and
 * cleared from the rest with the reason recorded.
 */
function attributeRevenueOnce(drafts: OpportunityDraft[]): OpportunityDraft[] {
  const bearers = drafts.filter(
    (d) =>
      d.outcome.revenueOpportunityHigh != null &&
      d.outcome.revenueOpportunityHigh > 0 &&
      d.recommendation !== 'NOT_RECOMMENDED' &&
      d.recommendation !== 'DO_NOTHING',
  );

  if (bearers.length <= 1) return drafts;

  // Highest priority wins; ties break towards the larger estimate.
  const owner = bearers.reduce((best, candidate) =>
    candidate.priorityScore > best.priorityScore ||
    (candidate.priorityScore === best.priorityScore &&
      (candidate.outcome.revenueOpportunityHigh ?? 0) > (best.outcome.revenueOpportunityHigh ?? 0))
      ? candidate
      : best,
  );

  for (const draft of bearers) {
    if (draft === owner) {
      draft.outcome.assumptions.push({
        label: 'Revenue attribution',
        value: `The revenue opportunity for this business is counted here, against "${owner.name}", and nowhere else.`,
        source: 'Platform reporting rule',
        isEstimate: false,
      });
      continue;
    }

    draft.outcome.revenueOpportunityLow = null;
    draft.outcome.revenueOpportunityHigh = null;
    draft.outcome.formulas = draft.outcome.formulas.filter(
      (f) => f.label !== 'Potential revenue opportunity',
    );
    draft.outcome.assumptions.push({
      label: 'Revenue attribution',
      value: `Not counted here. This business has one pool of leads, and the revenue effect is counted once, against "${owner.name}". Adding it here as well would be the same money twice.`,
      source: 'Platform reporting rule',
      isEstimate: false,
    });
  }

  return drafts;
}

function opportunityName(process: KmProcess, category: AiCategory): string {
  const verbs: Partial<Record<AiCategory, string>> = {
    DOCUMENT_AI: 'Automate document handling in',
    AI_CHATBOT: 'Deflect routine enquiries in',
    VOICE_AI: 'Handle routine calls in',
    AI_REPORTING: 'Automate reporting for',
    GENERATIVE_AI: 'Draft with AI in',
    KNOWLEDGE_MANAGEMENT: 'Make knowledge searchable for',
    AI_FORECASTING: 'Forecast with AI in',
    PREDICTIVE_ANALYTICS: 'Prioritise intelligently in',
    COMPUTER_VISION: 'Automate visual checks in',
    WORKFLOW_AUTOMATION: 'Automate the workflow in',
    AI_AGENT: 'Run a supervised AI agent for',
  };
  return `${verbs[category] ?? 'Improve'} ${process.name}`;
}

function describeCurrentState(process: KmProcess): string {
  const bits: string[] = [];
  bits.push(
    `${process.name} is handled ${process.frequency ? process.frequency.toLowerCase().replace('_', ' ') : 'on an ad hoc basis'}${
      process.department ? ` by ${process.department}` : ''
    }${process.owner ? `, owned by ${process.owner}` : ''}.`,
  );
  if (process.hoursPerWeek != null) bits.push(`It takes about ${process.hoursPerWeek} hours a week.`);
  if (process.manualScore != null && process.manualScore >= 4) bits.push('It is largely manual.');
  if (process.systemsUsed.length >= 2) {
    bits.push(`Information is moved by hand between ${process.systemsUsed.join(', ')}.`);
  }
  if (process.delayDescription) bits.push(`Delays: ${process.delayDescription}`);
  if (process.errorImpact) bits.push(`Errors: ${process.errorImpact}`);
  if (process.bottleneckSteps.length) bits.push(`Bottleneck steps: ${process.bottleneckSteps.join(', ')}.`);
  return bits.join(' ');
}

function orphanProblemDraft(problem: KnowledgeModel['problems'][number], km: KnowledgeModel): OpportunityDraft {
  const synthetic: KmProcess = {
    id: `problem:${problem.id}`,
    name: problem.title,
    description: problem.description,
    department: problem.department,
    owner: null,
    trigger: null,
    frequency: 'WEEKLY',
    hoursPerWeek: problem.hoursLostPerWeek,
    avgDurationMins: null,
    volumePerPeriod: null,
    costPerYear: problem.annualCostEstimate,
    employeesInvolved: null,
    systemsUsed: [],
    inputs: null,
    outputs: null,
    errorRate: null,
    errorImpact: null,
    delayDescription: null,
    customerImpact: problem.severity === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
    revenueImpact: problem.category === 'COST' ? 'LOW' : 'MEDIUM',
    manualScore: 4,
    repetitivenessScore: 3,
    dataReadiness: null,
    aiPotential: null,
    automationPotential: null,
    riskLevel: 'MEDIUM',
    source: 'ASSESSMENT',
    confidence: problem.confidence,
    stepCount: 0,
    bottleneckSteps: [],
  };

  const { rule } = classify(synthetic);
  const outcome = calculateOutcome(synthetic, km, {
    aiCategory: rule.category,
    complexity: 'MEDIUM',
    revenueImpact: synthetic.revenueImpact,
  });

  const missing = [
    ...outcome.missingInputs,
    'This problem is not yet linked to a mapped process. Map the process to size it properly.',
  ];

  return {
    processId: null,
    problemId: problem.id,
    name: `Investigate: ${problem.title}`,
    currentProblem: problem.description ?? problem.title,
    proposedSolution: rule.solution(synthetic),
    aiCategory: rule.category,
    rationale:
      'This was raised as a problem but the underlying process has not been mapped yet, so it is presented for investigation rather than implementation.',
    recommendation: 'INVESTIGATE',
    notRecommendedReason: null,
    implementationComplexity: 'MEDIUM',
    riskLevel: 'MEDIUM',
    humanOversight: 'HUMAN_IN_LOOP',
    dependencies: buildDependencies(synthetic, km, rule.category),
    kpis: buildKpis(synthetic, outcome, rule.category),
    priorityScore: 30,
    priorityBand: 'PHASE_3',
    confidence: 'LOW',
    missingInformation: missing,
    sources: [{ type: 'ASSESSMENT', ref: problem.id, detail: `Recorded problem: ${problem.title}` }],
    outcome,
    scoreBreakdown: {},
  };
}
