import 'server-only';
import { prisma } from '../db';
import { stringify } from '../json';
import { SYSTEM_CATEGORY_LABELS } from '../types';
import { scoreProcessPotential } from './opportunities';

/**
 * Ingest (§4 -> §6).
 *
 * Turns assessment answers into rows in the Business Knowledge Model. Every row
 * it creates records `source` so the platform can always say where a fact came
 * from, and it never overwrites a value a consultant has edited by hand.
 */

type Answers = Record<string, unknown>;

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes';
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  const s = str(value);
  if (!s) return [];
  return s
    .split(/\r?\n|;/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
}

/** Shortens text at a word boundary, so a title never breaks mid-word. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

/** Splits a narrative answer into discrete, sentence-sized items. */
function sentences(value: unknown, max = 6): string[] {
  const s = str(value);
  if (!s) return [];
  return s
    .split(/(?<=[.!?])\s+|\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.length > 12)
    .slice(0, max);
}

const AI_MATURITY_BY_USAGE: Record<string, number> = {
  'Not at all': 0,
  'A few people experimenting': 1,
  'Used in one area': 2,
  'Used across several areas': 3,
};

export interface IngestSummary {
  profileUpdated: boolean;
  departmentsCreated: number;
  systemsCreated: number;
  processesCreated: number;
  problemsCreated: number;
  objectivesCreated: number;
}

export async function applyAssessmentAnswers(
  organisationId: string,
  answers: Answers,
): Promise<IngestSummary> {
  const summary: IngestSummary = {
    profileUpdated: false,
    departmentsCreated: 0,
    systemsCreated: 0,
    processesCreated: 0,
    problemsCreated: 0,
    objectivesCreated: 0,
  };

  // --- business profile ----------------------------------------------------
  const profileData = {
    industry: str(answers['company.industry']),
    subIndustry: str(answers['company.subIndustry']),
    companySize: str(answers['company.companySize']),
    employeeCount: num(answers['company.employeeCount']),
    locations: stringify(list(answers['company.locations'])),
    website: str(answers['company.website']),
    businessModel: str(answers['company.businessModel']),
    productsServices: str(answers['company.productsServices']),
    targetCustomers: str(answers['company.targetCustomers']),
    annualTurnover: num(answers['company.annualTurnover']),

    biggestGoals: str(answers['strategy.biggestGoals']),
    biggestProblems: str(answers['strategy.biggestProblems']),
    growthLimiters: str(answers['strategy.growthLimiters']),
    inefficientAreas: str(answers['ops.bottlenecks']),
    timeSinks: str(answers['ops.timeSinks']),
    errorAreas: str(answers['ops.errors']),
    delayAreas: str(answers['ops.delays']),
    aiAmbition: str(answers['strategy.aiAmbition']),

    avgHourlyLabourCost: num(answers['fin.avgHourlyLabourCost']),
    avgSalary: num(answers['fin.avgSalary']),
    avgCustomerValue: num(answers['fin.avgCustomerValue']),
    monthlyLeadVolume: num(answers['fin.monthlyLeadVolume']),
    conversionRate: num(answers['fin.conversionRate']),
    operatingCosts: num(answers['fin.operatingCosts']),
    aiBudget: num(answers['fin.aiBudget']),

    handlesSensitiveData: bool(answers['risk.sensitiveData']),
    regulations: stringify(list(answers['risk.regulations'])),
    securityConcerns: str(answers['risk.securityConcerns']),
    noAutonomyProcesses: str(answers['risk.noAutonomy']),

    currentAiUsage: str(answers['ai.currentUsage']),
    aiTools: stringify(list(answers['ai.tools'])),
    aiMaturityLevel: AI_MATURITY_BY_USAGE[str(answers['ai.currentUsage']) ?? ''] ?? 0,
    automationAppetite: str(answers['ai.automationAppetite']),
    oversightPreference: str(answers['ai.oversightPreference']),
  };

  // Only write keys that actually have a value, so a partial save never blanks
  // information gathered elsewhere (documents, interview, consultant edits).
  const cleaned = Object.fromEntries(
    Object.entries(profileData).filter(([key, value]) => {
      if (value === null) return false;
      if (key === 'locations' || key === 'regulations' || key === 'aiTools') return value !== '[]';
      return true;
    }),
  );

  const existing = await prisma.businessProfile.findFirst({ where: { organisationId, isCurrent: true } });
  if (existing) {
    await prisma.businessProfile.update({ where: { id: existing.id }, data: cleaned });
  } else {
    await prisma.businessProfile.create({ data: { organisationId, ...cleaned } });
  }
  summary.profileUpdated = true;

  // --- departments ---------------------------------------------------------
  const departmentNames = list(answers['company.departments']);
  if (departmentNames.length) {
    const current = await prisma.department.findMany({ where: { organisationId } });
    const currentLower = new Set(current.map((d) => d.name.toLowerCase()));
    const toCreate = departmentNames
      .filter((name) => !currentLower.has(name.toLowerCase()))
      .map((name) => ({ organisationId, name, source: 'ASSESSMENT' }));
    if (toCreate.length) {
      await prisma.department.createMany({ data: toCreate });
      summary.departmentsCreated = toCreate.length;
    }
  }

  // --- systems -------------------------------------------------------------
  summary.systemsCreated = await ingestSystems(organisationId, answers);

  // --- processes -----------------------------------------------------------
  summary.processesCreated = await ingestProcesses(organisationId, answers);

  // --- problems ------------------------------------------------------------
  summary.problemsCreated = await ingestProblems(organisationId, answers);

  // --- objectives ----------------------------------------------------------
  summary.objectivesCreated = await ingestObjectives(organisationId, answers);

  return summary;
}

const SYSTEM_FIELD_MAP: [string, string][] = [
  ['tech.crm', 'CRM'],
  ['tech.erp', 'ERP'],
  ['tech.accounting', 'ACCOUNTING'],
  ['tech.hr', 'HR'],
  ['tech.projectManagement', 'PROJECT_MGMT'],
  ['tech.ecommerce', 'ECOMMERCE'],
  ['tech.industrySoftware', 'INDUSTRY'],
];

const API_CAPABLE = new Set([
  'salesforce', 'hubspot', 'pipedrive', 'zoho', 'dynamics', 'xero', 'quickbooks', 'sage',
  'netsuite', 'shopify', 'stripe', 'jira', 'asana', 'monday.com', 'clickup', 'notion',
  'slack', 'zendesk', 'intercom', 'freshdesk',
]);

async function ingestSystems(organisationId: string, answers: Answers): Promise<number> {
  const existing = await prisma.businessSystem.findMany({ where: { organisationId } });
  const existingLower = new Set(existing.map((s) => s.name.toLowerCase()));
  const dataQuality = num(answers['tech.dataQuality']);

  const candidates: { name: string; category: string }[] = [];

  for (const [key, category] of SYSTEM_FIELD_MAP) {
    for (const name of list(answers[key])) candidates.push({ name, category });
  }
  for (const name of list(answers['tech.otherSystems'])) {
    candidates.push({ name, category: 'OTHER' });
  }

  const categories = Array.isArray(answers['tech.categories'])
    ? (answers['tech.categories'] as string[])
    : [];
  if (categories.includes('SPREADSHEET')) {
    candidates.push({ name: 'Spreadsheets', category: 'SPREADSHEET' });
  }
  if (categories.includes('EMAIL') && !candidates.some((c) => c.category === 'EMAIL')) {
    candidates.push({ name: 'Email', category: 'EMAIL' });
  }
  if (categories.includes('STORAGE') && !candidates.some((c) => c.category === 'STORAGE')) {
    candidates.push({ name: 'Cloud storage', category: 'STORAGE' });
  }
  if (categories.includes('WEBSITE') && !candidates.some((c) => c.category === 'WEBSITE')) {
    candidates.push({ name: 'Website', category: 'WEBSITE' });
  }

  const seen = new Set<string>();
  const toCreate = candidates
    .filter(({ name }) => {
      const key = name.toLowerCase();
      if (existingLower.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ name, category }) => ({
      organisationId,
      name,
      category,
      hasApi: API_CAPABLE.has(name.toLowerCase()),
      dataQuality,
      usageNotes: `Reported in the assessment as ${SYSTEM_CATEGORY_LABELS[category] ?? category}`,
      source: 'ASSESSMENT',
    }));

  if (toCreate.length) await prisma.businessSystem.createMany({ data: toCreate });

  // Keep data-quality current on systems the assessment already knows about.
  if (dataQuality != null) {
    await prisma.businessSystem.updateMany({
      where: { organisationId, source: 'ASSESSMENT' },
      data: { dataQuality },
    });
  }

  return toCreate.length;
}

interface ProcessCandidate {
  name: string;
  manualScore: number;
  repetitivenessScore: number;
  source: string;
  note: string;
}

async function ingestProcesses(organisationId: string, answers: Answers): Promise<number> {
  const existing = await prisma.process.findMany({ where: { organisationId } });
  const existingLower = new Set(existing.map((p) => p.name.toLowerCase()));

  const candidates: ProcessCandidate[] = [
    ...list(answers['ops.coreProcesses']).map((name) => ({
      name,
      manualScore: 3,
      repetitivenessScore: 3,
      source: 'ASSESSMENT',
      note: 'Identified as a core business process.',
    })),
    ...list(answers['ops.repetitiveTasks']).map((name) => ({
      name,
      manualScore: 4,
      repetitivenessScore: 5,
      source: 'ASSESSMENT',
      note: 'Reported as highly repetitive work.',
    })),
    ...list(answers['ops.manualTasks']).map((name) => ({
      name,
      manualScore: 5,
      repetitivenessScore: 4,
      source: 'ASSESSMENT',
      note: 'Reported as manual rekeying between systems.',
    })),
  ];

  const departments = await prisma.department.findMany({ where: { organisationId } });
  const dataQuality = num(answers['tech.dataQuality']);
  const sensitive = bool(answers['risk.sensitiveData']);

  const seen = new Set<string>();
  const created: string[] = [];

  for (const candidate of candidates) {
    const key = candidate.name.toLowerCase();
    if (existingLower.has(key) || seen.has(key)) continue;
    seen.add(key);

    // Attribute to a department when the process name mentions one.
    const department = departments.find((d) => key.includes(d.name.toLowerCase()));

    const row = await prisma.process.create({
      data: {
        organisationId,
        departmentId: department?.id ?? null,
        name: candidate.name,
        description: candidate.note,
        manualScore: candidate.manualScore,
        repetitivenessScore: candidate.repetitivenessScore,
        dataReadiness: dataQuality,
        riskLevel: sensitive ? 'MEDIUM' : 'LOW',
        systemsUsed: stringify([]),
        source: candidate.source,
        confidence: 'MEDIUM',
      },
    });
    created.push(row.id);
  }

  await refreshProcessScores(organisationId);
  return created.length;
}

/** Recomputes the derived AI/automation potential on every process. */
export async function refreshProcessScores(organisationId: string): Promise<void> {
  const processes = await prisma.process.findMany({ where: { organisationId } });
  for (const p of processes) {
    const { aiPotential, automationPotential } = scoreProcessPotential({
      manualScore: p.manualScore,
      repetitivenessScore: p.repetitivenessScore,
      dataReadiness: p.dataReadiness,
      hoursPerWeek: p.hoursPerWeek,
      riskLevel: p.riskLevel,
    } as never);
    if (p.aiPotential !== aiPotential || p.automationPotential !== automationPotential) {
      await prisma.process.update({
        where: { id: p.id },
        data: { aiPotential, automationPotential },
      });
    }
  }
}

const PROBLEM_SOURCES: { key: string; category: string; severity: string }[] = [
  { key: 'ops.bottlenecks', category: 'BOTTLENECK', severity: 'HIGH' },
  { key: 'ops.delays', category: 'DELAY', severity: 'MEDIUM' },
  { key: 'ops.errors', category: 'ERROR', severity: 'HIGH' },
  { key: 'strategy.biggestProblems', category: 'CAPACITY', severity: 'HIGH' },
  { key: 'strategy.growthLimiters', category: 'CAPACITY', severity: 'MEDIUM' },
];

async function ingestProblems(organisationId: string, answers: Answers): Promise<number> {
  const existing = await prisma.problem.findMany({ where: { organisationId } });
  const existingLower = new Set(existing.map((p) => p.title.toLowerCase()));
  const processes = await prisma.process.findMany({ where: { organisationId } });

  const rows: { title: string; description: string; category: string; severity: string; processId: string | null }[] = [];
  const seen = new Set<string>();

  for (const { key, category, severity } of PROBLEM_SOURCES) {
    for (const sentence of sentences(answers[key])) {
      const title = shorten(sentence, 110);
      const lower = title.toLowerCase();
      if (existingLower.has(lower) || seen.has(lower)) continue;
      seen.add(lower);

      // Link the problem to a process when the text names one.
      const match = processes.find((p) => {
        const words = p.name.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
        return words.length > 0 && words.some((w) => sentence.toLowerCase().includes(w));
      });

      rows.push({
        title,
        description: sentence,
        category,
        severity,
        processId: match?.id ?? null,
      });
    }
  }

  if (rows.length) {
    await prisma.problem.createMany({
      data: rows.map((r) => ({
        organisationId,
        title: r.title,
        description: r.description,
        category: r.category,
        severity: r.severity,
        processId: r.processId,
        source: 'ASSESSMENT',
        confidence: 'MEDIUM',
        evidence: stringify([{ type: 'ASSESSMENT', ref: 'assessment', quote: r.description }]),
      })),
    });
  }

  return rows.length;
}

const OBJECTIVE_KEYWORDS: [RegExp, string][] = [
  [/revenue|sales|turnover|win more|grow sales/i, 'REVENUE'],
  [/cost|cheaper|reduce spend|margin|overhead/i, 'COST'],
  [/grow|expand|scale|new market|headcount/i, 'GROWTH'],
  [/time|faster|quicker|efficien|productiv|capacity/i, 'PRODUCTIVITY'],
  [/customer|client|service|satisfaction|retention/i, 'CUSTOMER_EXPERIENCE'],
  [/quality|error|accuracy|mistake|defect/i, 'QUALITY'],
  [/risk|compliance|security|regulat/i, 'RISK'],
];

function categoriseObjective(text: string): string {
  for (const [pattern, category] of OBJECTIVE_KEYWORDS) {
    if (pattern.test(text)) return category;
  }
  return 'GROWTH';
}

async function ingestObjectives(organisationId: string, answers: Answers): Promise<number> {
  const existing = await prisma.objective.findMany({ where: { organisationId } });
  const existingLower = new Set(existing.map((o) => o.title.toLowerCase()));

  const explicit = list(answers['strategy.objectives']);
  const derived = explicit.length ? explicit : sentences(answers['strategy.biggestGoals'], 4);

  const seen = new Set<string>();
  const rows = derived
    .filter((title) => {
      const lower = title.toLowerCase();
      if (existingLower.has(lower) || seen.has(lower)) return false;
      seen.add(lower);
      return true;
    })
    .map((title, index) => ({
      organisationId,
      title: shorten(title, 140),
      category: categoriseObjective(title),
      horizon: index < 2 ? 'SHORT' : 'MEDIUM',
      priority: Math.min(5, index + 1),
      source: 'ASSESSMENT',
    }));

  if (rows.length) await prisma.objective.createMany({ data: rows });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Interview write-back
// ---------------------------------------------------------------------------

/**
 * Applies an adaptive interview answer to the knowledge model. `targetField`
 * uses the form `process:<id>:<field>`, `profile:<field>` or `problem:<id>:<field>`,
 * which is how a free-text answer becomes a structured fact.
 */
export async function applyInterviewAnswer(
  organisationId: string,
  targetField: string | null,
  answer: string,
): Promise<boolean> {
  if (!targetField) return false;
  const [kind, a, b] = targetField.split(':');

  const numeric = Number(answer.replace(/[^0-9.]/g, ''));
  const hasNumber = Number.isFinite(numeric) && /\d/.test(answer);

  if (kind === 'process' && a && b) {
    const process = await prisma.process.findFirst({ where: { id: a, organisationId } });
    if (!process) return false;

    const data: Record<string, unknown> = {};
    switch (b) {
      case 'hoursPerWeek':
        if (!hasNumber) return false;
        data.hoursPerWeek = numeric;
        break;
      case 'frequency':
        data.frequency = normaliseFrequency(answer);
        break;
      case 'employeesInvolved':
        if (!hasNumber) return false;
        data.employeesInvolved = Math.round(numeric);
        break;
      case 'errorRate':
        if (!hasNumber) return false;
        data.errorRate = numeric;
        break;
      case 'systemsUsed':
        data.systemsUsed = stringify(list(answer));
        break;
      case 'owner':
        data.owner = answer.trim();
        break;
      case 'trigger':
        data.trigger = answer.trim();
        break;
      case 'volumePerPeriod':
        if (!hasNumber) return false;
        data.volumePerPeriod = numeric;
        break;
      case 'avgDurationMins':
        if (!hasNumber) return false;
        data.avgDurationMins = numeric;
        break;
      case 'customerImpact':
        data.customerImpact = normaliseLevel(answer);
        break;
      case 'revenueImpact':
        data.revenueImpact = normaliseLevel(answer);
        break;
      case 'dataReadiness':
        if (!hasNumber) return false;
        data.dataReadiness = Math.max(1, Math.min(5, Math.round(numeric)));
        break;
      default:
        return false;
    }

    data.confidence = 'HIGH';
    await prisma.process.update({ where: { id: a }, data });
    await refreshProcessScores(organisationId);
    return true;
  }

  if (kind === 'profile' && a) {
    const profile = await prisma.businessProfile.findFirst({ where: { organisationId, isCurrent: true } });
    if (!profile) return false;

    const numericFields = new Set([
      'avgHourlyLabourCost', 'avgSalary', 'avgCustomerValue', 'monthlyLeadVolume',
      'conversionRate', 'operatingCosts', 'aiBudget', 'annualTurnover', 'employeeCount',
    ]);

    if (numericFields.has(a)) {
      if (!hasNumber) return false;
      await prisma.businessProfile.update({ where: { id: profile.id }, data: { [a]: numeric } });
      return true;
    }

    const textFields = new Set([
      'productsServices', 'targetCustomers', 'biggestGoals', 'biggestProblems',
      'growthLimiters', 'timeSinks', 'errorAreas', 'delayAreas', 'aiAmbition',
      'securityConcerns', 'noAutonomyProcesses', 'currentAiUsage',
    ]);
    if (textFields.has(a)) {
      await prisma.businessProfile.update({ where: { id: profile.id }, data: { [a]: answer.trim() } });
      return true;
    }
    return false;
  }

  if (kind === 'problem' && a && b) {
    const problem = await prisma.problem.findFirst({ where: { id: a, organisationId } });
    if (!problem) return false;

    if (b === 'hoursLostPerWeek' && hasNumber) {
      await prisma.problem.update({ where: { id: a }, data: { hoursLostPerWeek: numeric, confidence: 'HIGH' } });
      return true;
    }
    if (b === 'annualCostEstimate' && hasNumber) {
      await prisma.problem.update({ where: { id: a }, data: { annualCostEstimate: numeric, confidence: 'HIGH' } });
      return true;
    }
    if (b === 'rootCause') {
      await prisma.problem.update({ where: { id: a }, data: { rootCause: answer.trim() } });
      return true;
    }
    return false;
  }

  return false;
}

function normaliseFrequency(answer: string): string {
  const a = answer.toLowerCase();
  if (/continuous|all day|constant/.test(a)) return 'CONTINUOUS';
  if (/daily|every day|each day/.test(a)) return 'DAILY';
  if (/week/.test(a)) return 'WEEKLY';
  if (/month/.test(a)) return 'MONTHLY';
  if (/quarter/.test(a)) return 'QUARTERLY';
  if (/year|annual/.test(a)) return 'ANNUAL';
  return 'AD_HOC';
}

function normaliseLevel(answer: string): string {
  const a = answer.toLowerCase();
  if (/none|no impact|not at all/.test(a)) return 'NONE';
  if (/high|major|significant|critical/.test(a)) return 'HIGH';
  if (/low|minor|slight/.test(a)) return 'LOW';
  return 'MEDIUM';
}
