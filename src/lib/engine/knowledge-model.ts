import 'server-only';
import { prisma } from '../db';
import { parseJson, parseAnswer, stringify } from '../json';
import type { Confidence } from '../types';

/**
 * The Business Knowledge Model (§6).
 *
 * A single, always-current structured representation of one business, assembled
 * from assessment answers, interview turns, uploaded documents and consultant
 * edits. Every agent and every calculation reads the business through this shape
 * rather than touching tables directly.
 */

export interface KmCompany {
  name: string;
  legalName: string | null;
  industry: string | null;
  subIndustry: string | null;
  companySize: string | null;
  employeeCount: number | null;
  locations: string[];
  website: string | null;
  businessModel: string | null;
  productsServices: string | null;
  targetCustomers: string | null;
  annualTurnover: number | null;
  currency: string;
}

export interface KmFinancials {
  avgHourlyLabourCost: number | null;
  avgSalary: number | null;
  avgCustomerValue: number | null;
  monthlyLeadVolume: number | null;
  conversionRate: number | null;
  operatingCosts: number | null;
  aiBudget: number | null;
  currency: string;
}

export interface KmProcess {
  id: string;
  name: string;
  description: string | null;
  department: string | null;
  owner: string | null;
  trigger: string | null;
  frequency: string | null;
  hoursPerWeek: number | null;
  avgDurationMins: number | null;
  volumePerPeriod: number | null;
  costPerYear: number | null;
  employeesInvolved: number | null;
  systemsUsed: string[];
  inputs: string | null;
  outputs: string | null;
  errorRate: number | null;
  errorImpact: string | null;
  delayDescription: string | null;
  customerImpact: string | null;
  revenueImpact: string | null;
  manualScore: number | null;
  repetitivenessScore: number | null;
  dataReadiness: number | null;
  aiPotential: number | null;
  automationPotential: number | null;
  riskLevel: string;
  source: string;
  confidence: string;
  stepCount: number;
  bottleneckSteps: string[];
}

export interface KmProblem {
  id: string;
  title: string;
  description: string | null;
  category: string;
  severity: string;
  rootCause: string | null;
  annualCostEstimate: number | null;
  hoursLostPerWeek: number | null;
  processId: string | null;
  processName: string | null;
  department: string | null;
  source: string;
  confidence: string;
}

export interface KmDocumentRef {
  id: string;
  fileName: string;
  classification: string;
  summary: string | null;
  wordCount: number;
}

export interface KnowledgeModel {
  organisationId: string;
  organisationName: string;
  version: number;
  company: KmCompany;
  strategy: {
    biggestGoals: string | null;
    biggestProblems: string | null;
    growthLimiters: string | null;
    inefficientAreas: string | null;
    timeSinks: string | null;
    errorAreas: string | null;
    delayAreas: string | null;
    aiAmbition: string | null;
  };
  customers: {
    targetCustomers: string | null;
    avgCustomerValue: number | null;
    monthlyLeadVolume: number | null;
    conversionRate: number | null;
  };
  departments: {
    id: string;
    name: string;
    function: string | null;
    headcount: number | null;
    annualCost: number | null;
  }[];
  people: {
    employeeCount: number | null;
    recordedEmployees: number;
    repetitiveHoursPerWeek: number | null;
    aiLiteracyMix: Record<string, number>;
    trainingNeeds: string[];
  };
  processes: KmProcess[];
  technology: {
    systems: { id: string; name: string; category: string; hasApi: boolean; dataQuality: number | null }[];
    integrations: { provider: string; status: string; lastSyncAt: Date | null }[];
    spreadsheetReliance: boolean;
  };
  problems: KmProblem[];
  objectives: { id: string; title: string; category: string; horizon: string | null; priority: number }[];
  financials: KmFinancials;
  risk: {
    handlesSensitiveData: boolean;
    regulations: string[];
    securityConcerns: string | null;
    noAutonomyProcesses: string | null;
  };
  aiPosture: {
    currentAiUsage: string | null;
    aiTools: string[];
    aiMaturityLevel: number;
    automationAppetite: string | null;
    oversightPreference: string | null;
  };
  documents: KmDocumentRef[];
  assessmentAnswers: Record<string, { value: unknown; confidence: string; source: string; area: string }>;
  interviewFacts: { question: string; answer: string; area: string; reason: string }[];
  completeness: KmCompleteness;
}

export interface KmCompleteness {
  overall: number;
  byArea: Record<string, { score: number; missing: string[] }>;
  criticalGaps: string[];
}

const EMPTY_COMPANY: KmCompany = {
  name: '',
  legalName: null,
  industry: null,
  subIndustry: null,
  companySize: null,
  employeeCount: null,
  locations: [],
  website: null,
  businessModel: null,
  productsServices: null,
  targetCustomers: null,
  annualTurnover: null,
  currency: 'GBP',
};

export async function buildKnowledgeModel(organisationId: string): Promise<KnowledgeModel> {
  const [org, profile, departments, employees, processes, systems, integrations, problems, objectives, documents, assessments, interviews] =
    await Promise.all([
      prisma.organisation.findUniqueOrThrow({ where: { id: organisationId } }),
      prisma.businessProfile.findFirst({ where: { organisationId, isCurrent: true } }),
      prisma.department.findMany({ where: { organisationId }, orderBy: { name: 'asc' } }),
      prisma.employee.findMany({ where: { organisationId } }),
      prisma.process.findMany({
        where: { organisationId },
        include: { department: true, steps: { orderBy: { order: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.businessSystem.findMany({ where: { organisationId } }),
      prisma.integration.findMany({ where: { organisationId } }),
      prisma.problem.findMany({
        where: { organisationId },
        include: { process: true, department: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.objective.findMany({ where: { organisationId }, orderBy: { priority: 'asc' } }),
      prisma.document.findMany({ where: { organisationId, status: 'PROCESSED' } }),
      prisma.assessment.findMany({
        where: { organisationId },
        include: { answers: { include: { question: true } } },
      }),
      prisma.interviewSession.findMany({
        where: { organisationId },
        include: { turns: { orderBy: { order: 'asc' } } },
      }),
    ]);

  const currency = profile?.currency ?? 'GBP';

  const company: KmCompany = profile
    ? {
        name: org.name,
        legalName: profile.legalName,
        industry: profile.industry,
        subIndustry: profile.subIndustry,
        companySize: profile.companySize,
        employeeCount: profile.employeeCount,
        locations: parseJson<string[]>(profile.locations, []),
        website: profile.website,
        businessModel: profile.businessModel,
        productsServices: profile.productsServices,
        targetCustomers: profile.targetCustomers,
        annualTurnover: profile.annualTurnover,
        currency,
      }
    : { ...EMPTY_COMPANY, name: org.name };

  const assessmentAnswers: KnowledgeModel['assessmentAnswers'] = {};
  for (const assessment of assessments) {
    for (const answer of assessment.answers) {
      assessmentAnswers[answer.questionKey] = {
        value: parseAnswer(answer.value),
        confidence: answer.confidence,
        source: answer.source,
        area: answer.question?.businessArea ?? 'general',
      };
    }
  }

  const interviewFacts = interviews.flatMap((session) =>
    session.turns
      .filter((turn) => turn.answer)
      .map((turn) => ({
        question: turn.question,
        answer: turn.answer as string,
        area: turn.businessArea,
        reason: turn.reasonForQuestion,
      })),
  );

  const aiLiteracyMix: Record<string, number> = {};
  for (const employee of employees) {
    const key = employee.aiLiteracy ?? 'UNKNOWN';
    aiLiteracyMix[key] = (aiLiteracyMix[key] ?? 0) + 1;
  }

  const kmProcesses: KmProcess[] = processes.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    department: p.department?.name ?? null,
    owner: p.owner,
    trigger: p.trigger,
    frequency: p.frequency,
    hoursPerWeek: p.hoursPerWeek,
    avgDurationMins: p.avgDurationMins,
    volumePerPeriod: p.volumePerPeriod,
    costPerYear: p.costPerYear,
    employeesInvolved: p.employeesInvolved,
    systemsUsed: parseJson<string[]>(p.systemsUsed, []),
    inputs: p.inputs,
    outputs: p.outputs,
    errorRate: p.errorRate,
    errorImpact: p.errorImpact,
    delayDescription: p.delayDescription,
    customerImpact: p.customerImpact,
    revenueImpact: p.revenueImpact,
    manualScore: p.manualScore,
    repetitivenessScore: p.repetitivenessScore,
    dataReadiness: p.dataReadiness,
    aiPotential: p.aiPotential,
    automationPotential: p.automationPotential,
    riskLevel: p.riskLevel,
    source: p.source,
    confidence: p.confidence,
    stepCount: p.steps.length,
    bottleneckSteps: p.steps.filter((s) => s.isBottleneck).map((s) => s.name),
  }));

  const model: KnowledgeModel = {
    organisationId,
    organisationName: org.name,
    version: profile?.version ?? 1,
    company,
    strategy: {
      biggestGoals: profile?.biggestGoals ?? null,
      biggestProblems: profile?.biggestProblems ?? null,
      growthLimiters: profile?.growthLimiters ?? null,
      inefficientAreas: profile?.inefficientAreas ?? null,
      timeSinks: profile?.timeSinks ?? null,
      errorAreas: profile?.errorAreas ?? null,
      delayAreas: profile?.delayAreas ?? null,
      aiAmbition: profile?.aiAmbition ?? null,
    },
    customers: {
      targetCustomers: profile?.targetCustomers ?? null,
      avgCustomerValue: profile?.avgCustomerValue ?? null,
      monthlyLeadVolume: profile?.monthlyLeadVolume ?? null,
      conversionRate: profile?.conversionRate ?? null,
    },
    departments: departments.map((d) => ({
      id: d.id,
      name: d.name,
      function: d.function,
      headcount: d.headcount,
      annualCost: d.annualCost,
    })),
    people: {
      employeeCount: profile?.employeeCount ?? null,
      recordedEmployees: employees.length,
      repetitiveHoursPerWeek: employees.length
        ? employees.reduce((sum, e) => sum + (e.repetitiveHoursPerWeek ?? 0), 0)
        : null,
      aiLiteracyMix,
      trainingNeeds: employees.map((e) => e.trainingNeeds).filter((n): n is string => Boolean(n)),
    },
    processes: kmProcesses,
    technology: {
      systems: systems.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        hasApi: s.hasApi,
        dataQuality: s.dataQuality,
      })),
      integrations: integrations.map((i) => ({
        provider: i.provider,
        status: i.status,
        lastSyncAt: i.lastSyncAt,
      })),
      spreadsheetReliance: systems.some((s) => s.category === 'SPREADSHEET'),
    },
    problems: problems.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      category: p.category,
      severity: p.severity,
      rootCause: p.rootCause,
      annualCostEstimate: p.annualCostEstimate,
      hoursLostPerWeek: p.hoursLostPerWeek,
      processId: p.processId,
      processName: p.process?.name ?? null,
      department: p.department?.name ?? null,
      source: p.source,
      confidence: p.confidence,
    })),
    objectives: objectives.map((o) => ({
      id: o.id,
      title: o.title,
      category: o.category,
      horizon: o.horizon,
      priority: o.priority,
    })),
    financials: {
      avgHourlyLabourCost: profile?.avgHourlyLabourCost ?? null,
      avgSalary: profile?.avgSalary ?? null,
      avgCustomerValue: profile?.avgCustomerValue ?? null,
      monthlyLeadVolume: profile?.monthlyLeadVolume ?? null,
      conversionRate: profile?.conversionRate ?? null,
      operatingCosts: profile?.operatingCosts ?? null,
      aiBudget: profile?.aiBudget ?? null,
      currency,
    },
    risk: {
      handlesSensitiveData: profile?.handlesSensitiveData ?? false,
      regulations: parseJson<string[]>(profile?.regulations, []),
      securityConcerns: profile?.securityConcerns ?? null,
      noAutonomyProcesses: profile?.noAutonomyProcesses ?? null,
    },
    aiPosture: {
      currentAiUsage: profile?.currentAiUsage ?? null,
      aiTools: parseJson<string[]>(profile?.aiTools, []),
      aiMaturityLevel: profile?.aiMaturityLevel ?? 0,
      automationAppetite: profile?.automationAppetite ?? null,
      oversightPreference: profile?.oversightPreference ?? null,
    },
    documents: documents.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      classification: d.classification,
      summary: d.summary,
      wordCount: d.wordCount,
    })),
    assessmentAnswers,
    interviewFacts,
    completeness: { overall: 0, byArea: {}, criticalGaps: [] },
  };

  model.completeness = assessCompleteness(model);
  return model;
}

/**
 * Scores how much the platform actually knows, per business area. This drives
 * the adaptive interview (§7), the confidence system (§23), and the dashboard's
 * "what to do next" prompt.
 */
export function assessCompleteness(km: KnowledgeModel): KmCompleteness {
  const areas: Record<string, { checks: [string, boolean][]; weight: number }> = {
    company: {
      weight: 1,
      checks: [
        ['Industry', Boolean(km.company.industry)],
        ['Company size', Boolean(km.company.companySize)],
        ['Business model', Boolean(km.company.businessModel)],
        ['Products or services', Boolean(km.company.productsServices)],
        ['Target customers', Boolean(km.company.targetCustomers)],
      ],
    },
    strategy: {
      weight: 1,
      checks: [
        ['Business goals', Boolean(km.strategy.biggestGoals)],
        ['Biggest problems', Boolean(km.strategy.biggestProblems)],
        ['Growth limiters', Boolean(km.strategy.growthLimiters)],
        ['Recorded objectives', km.objectives.length > 0],
      ],
    },
    operations: {
      weight: 2,
      checks: [
        ['At least one mapped process', km.processes.length > 0],
        ['Three or more mapped processes', km.processes.length >= 3],
        ['Process time recorded', km.processes.some((p) => p.hoursPerWeek != null)],
        ['Process frequency recorded', km.processes.some((p) => Boolean(p.frequency))],
        ['Identified problems', km.problems.length > 0],
      ],
    },
    people: {
      weight: 1,
      checks: [
        ['Employee count', km.people.employeeCount != null],
        ['Departments recorded', km.departments.length > 0],
        ['Time spent on repetitive work', km.people.repetitiveHoursPerWeek != null],
      ],
    },
    technology: {
      weight: 1,
      checks: [
        ['Business systems recorded', km.technology.systems.length > 0],
        ['System categories cover core functions', km.technology.systems.length >= 3],
      ],
    },
    financial: {
      weight: 2,
      checks: [
        ['Hourly labour cost', km.financials.avgHourlyLabourCost != null],
        ['Annual turnover', km.company.annualTurnover != null],
        ['Average customer value', km.financials.avgCustomerValue != null],
        ['AI budget', km.financials.aiBudget != null],
      ],
    },
    risk: {
      weight: 1,
      checks: [
        ['Sensitive-data position stated', km.risk.handlesSensitiveData || km.risk.regulations.length > 0 || Boolean(km.risk.securityConcerns)],
        ['Processes requiring human decisions', Boolean(km.risk.noAutonomyProcesses)],
      ],
    },
    ai: {
      weight: 1,
      checks: [
        ['Current AI usage', Boolean(km.aiPosture.currentAiUsage)],
        ['Automation appetite', Boolean(km.aiPosture.automationAppetite)],
        ['Oversight preference', Boolean(km.aiPosture.oversightPreference)],
      ],
    },
    evidence: {
      weight: 1,
      checks: [
        ['At least one document processed', km.documents.length > 0],
        ['Interview answers captured', km.interviewFacts.length > 0],
      ],
    },
  };

  const byArea: KmCompleteness['byArea'] = {};
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [area, { checks, weight }] of Object.entries(areas)) {
    const passed = checks.filter(([, ok]) => ok).length;
    const score = checks.length ? passed / checks.length : 0;
    byArea[area] = { score, missing: checks.filter(([, ok]) => !ok).map(([label]) => label) };
    weightedSum += score * weight;
    totalWeight += weight;
  }

  // Anything that materially blocks a defensible financial estimate.
  const criticalGaps: string[] = [];
  if (km.financials.avgHourlyLabourCost == null) {
    criticalGaps.push('Average hourly labour cost — required to value released capacity');
  }
  if (km.processes.length === 0) {
    criticalGaps.push('At least one mapped business process — required to find opportunities');
  }
  if (!km.processes.some((p) => p.hoursPerWeek != null)) {
    criticalGaps.push('Time spent on at least one process — required to size the prize');
  }
  if (km.financials.avgCustomerValue == null || km.financials.conversionRate == null) {
    criticalGaps.push('Average customer value and conversion rate — required for any revenue estimate');
  }

  return {
    overall: totalWeight ? weightedSum / totalWeight : 0,
    byArea,
    criticalGaps,
  };
}

/** Confidence band for a claim derived from N supporting facts. */
export function confidenceFromCompleteness(score: number): Confidence {
  if (score >= 0.75) return 'HIGH';
  if (score >= 0.45) return 'MEDIUM';
  return 'LOW';
}

/**
 * Writes an immutable snapshot so the business can see how its profile evolved
 * (§16). Returns the new version number.
 */
export async function snapshotKnowledgeModel(
  organisationId: string,
  triggeredBy: string,
  changeSummary?: string,
): Promise<number> {
  const km = await buildKnowledgeModel(organisationId);
  const latest = await prisma.knowledgeModelVersion.findFirst({
    where: { organisationId },
    orderBy: { version: 'desc' },
  });
  const version = (latest?.version ?? 0) + 1;

  await prisma.knowledgeModelVersion.create({
    data: {
      organisationId,
      version,
      snapshot: stringify(km),
      changeSummary,
      triggeredBy,
    },
  });

  await prisma.businessProfile.updateMany({
    where: { organisationId, isCurrent: true },
    data: { version, completeness: km.completeness.overall },
  });

  return version;
}

/** Compact, token-efficient rendering of the model for an agent prompt (§21). */
export function renderKnowledgeModelForPrompt(km: KnowledgeModel, options?: { includeProcesses?: boolean }): string {
  const cur = km.company.currency;
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return;
    lines.push(`${label}: ${Array.isArray(value) ? value.join(', ') : value}`);
  };

  lines.push(`## Company`);
  add('Name', km.company.name);
  add('Industry', km.company.industry);
  add('Size band', km.company.companySize);
  add('Employees', km.company.employeeCount);
  add('Locations', km.company.locations);
  add('Business model', km.company.businessModel);
  add('Products/services', km.company.productsServices);
  add('Target customers', km.company.targetCustomers);
  add('Annual turnover', km.company.annualTurnover ? `${cur} ${km.company.annualTurnover.toLocaleString()}` : null);

  lines.push(`\n## Strategy`);
  add('Goals', km.strategy.biggestGoals);
  add('Problems', km.strategy.biggestProblems);
  add('Growth limiters', km.strategy.growthLimiters);
  add('Inefficient areas', km.strategy.inefficientAreas);
  add('Time sinks', km.strategy.timeSinks);
  add('Error areas', km.strategy.errorAreas);
  add('Delay areas', km.strategy.delayAreas);
  add('AI ambition', km.strategy.aiAmbition);

  lines.push(`\n## Financial baselines (client-supplied)`);
  add('Hourly labour cost', km.financials.avgHourlyLabourCost ? `${cur} ${km.financials.avgHourlyLabourCost}` : null);
  add('Average salary', km.financials.avgSalary ? `${cur} ${km.financials.avgSalary}` : null);
  add('Average customer value', km.financials.avgCustomerValue ? `${cur} ${km.financials.avgCustomerValue}` : null);
  add('Monthly leads', km.financials.monthlyLeadVolume);
  add('Conversion rate', km.financials.conversionRate ? `${km.financials.conversionRate}%` : null);
  add('Operating costs', km.financials.operatingCosts ? `${cur} ${km.financials.operatingCosts}` : null);
  add('AI budget', km.financials.aiBudget ? `${cur} ${km.financials.aiBudget}` : null);

  if (km.departments.length) {
    lines.push(`\n## Departments`);
    for (const d of km.departments) {
      lines.push(`- ${d.name}${d.headcount ? ` (${d.headcount} people)` : ''}${d.function ? ` — ${d.function}` : ''}`);
    }
  }

  if (options?.includeProcesses !== false && km.processes.length) {
    lines.push(`\n## Processes`);
    for (const p of km.processes) {
      const bits = [
        p.department ? `dept ${p.department}` : null,
        p.frequency ? `frequency ${p.frequency}` : null,
        p.hoursPerWeek != null ? `${p.hoursPerWeek} hrs/week` : null,
        p.employeesInvolved != null ? `${p.employeesInvolved} people` : null,
        p.manualScore != null ? `manual ${p.manualScore}/5` : null,
        p.repetitivenessScore != null ? `repetitive ${p.repetitivenessScore}/5` : null,
        p.dataReadiness != null ? `data readiness ${p.dataReadiness}/5` : null,
        p.errorRate != null ? `error rate ${p.errorRate}%` : null,
        p.systemsUsed.length ? `systems ${p.systemsUsed.join('/')}` : null,
      ].filter(Boolean);
      lines.push(`- [${p.id}] ${p.name}: ${bits.join(', ')}`);
      if (p.description) lines.push(`    ${p.description}`);
    }
  }

  if (km.problems.length) {
    lines.push(`\n## Recorded problems`);
    for (const p of km.problems) {
      lines.push(
        `- [${p.id}] ${p.title} (${p.category}, ${p.severity})${p.processName ? ` on process ${p.processName}` : ''}${
          p.hoursLostPerWeek ? `, ~${p.hoursLostPerWeek} hrs/week lost` : ''
        }`,
      );
    }
  }

  if (km.objectives.length) {
    lines.push(`\n## Objectives`);
    for (const o of km.objectives) lines.push(`- ${o.title} (${o.category}, priority ${o.priority})`);
  }

  lines.push(`\n## Technology`);
  if (km.technology.systems.length) {
    for (const s of km.technology.systems) {
      lines.push(`- ${s.name} (${s.category})${s.hasApi ? ', has API' : ', no known API'}`);
    }
  } else {
    lines.push('- No systems recorded');
  }

  lines.push(`\n## AI posture`);
  add('Current usage', km.aiPosture.currentAiUsage);
  add('Tools', km.aiPosture.aiTools);
  add('Maturity (0-5)', km.aiPosture.aiMaturityLevel);
  add('Automation appetite', km.aiPosture.automationAppetite);
  add('Oversight preference', km.aiPosture.oversightPreference);

  lines.push(`\n## Risk`);
  add('Handles sensitive data', km.risk.handlesSensitiveData ? 'yes' : 'no');
  add('Regulations', km.risk.regulations);
  add('Security concerns', km.risk.securityConcerns);
  add('Must stay human-decided', km.risk.noAutonomyProcesses);

  if (km.interviewFacts.length) {
    lines.push(`\n## Interview answers`);
    for (const f of km.interviewFacts.slice(0, 40)) {
      lines.push(`- Q: ${f.question}\n  A: ${f.answer}`);
    }
  }

  lines.push(`\n## Known gaps`);
  if (km.completeness.criticalGaps.length) {
    for (const gap of km.completeness.criticalGaps) lines.push(`- ${gap}`);
  } else {
    lines.push('- None blocking');
  }

  return lines.join('\n');
}
