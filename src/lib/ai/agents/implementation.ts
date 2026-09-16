import 'server-only';
import { z } from 'zod';
import { runAgent, SAFETY_PREAMBLE } from '../provider';
import { PROJECT_STAGES } from '../../types';
import type { KnowledgeModel } from '../../engine/knowledge-model';

/**
 * Implementation Agent (§13, §14, §22).
 *
 * Turns an approved opportunity into a project: scope, milestones across the
 * nine delivery stages, and the tasks that actually have to happen.
 */

export const ImplementationPlanSchema = z.object({
  objective: z.string().describe('One sentence: what this project is for, in business terms.'),
  scope: z.string().describe('What is in scope and, just as importantly, what is not.'),
  aiTechnology: z.string().describe('The kind of technology involved, in plain language.'),
  integrations: z.array(z.string()),
  dataRequirements: z.string(),
  securityRequirements: z.string(),
  testingRequirements: z.string(),
  launchRequirements: z.string(),
  trainingRequirements: z.string(),
  humanOversight: z.string(),
  monitoringRequirements: z.string(),
  estimatedWeeks: z.number().describe('Realistic elapsed weeks from discovery to launch.'),
  milestones: z
    .array(
      z.object({
        name: z.string(),
        stage: z.enum(PROJECT_STAGES),
        weekOffset: z.number().describe('Weeks from project start.'),
      }),
    )
    .max(12),
  tasks: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        stage: z.enum(PROJECT_STAGES),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
      }),
    )
    .max(30),
});

export type ImplementationPlan = z.infer<typeof ImplementationPlanSchema>;

export interface OpportunityForPlanning {
  name: string;
  currentProblem: string;
  proposedSolution: string;
  aiCategory: string;
  implementationComplexity: string;
  riskLevel: string;
  humanOversight: string;
  dependencies: {
    data: string[];
    software: string[];
    apis: string[];
    integrations: string[];
    training: string[];
    security: string[];
    policies: string[];
  };
}

const WEEKS_BY_COMPLEXITY: Record<string, number> = { LOW: 6, MEDIUM: 12, HIGH: 22 };

export function buildPlanLocally(
  opportunity: OpportunityForPlanning,
  km: KnowledgeModel,
): ImplementationPlan {
  const weeks = WEEKS_BY_COMPLEXITY[opportunity.implementationComplexity] ?? 12;
  const deps = opportunity.dependencies;
  const oversightText =
    opportunity.humanOversight === 'HUMAN_IN_LOOP'
      ? 'A named person approves every output before it is acted on or sent.'
      : opportunity.humanOversight === 'HUMAN_ON_LOOP'
        ? 'The system runs on its own; a named person reviews a sample daily and can intervene at any point.'
        : 'The system runs on its own and is audited on a fixed schedule against an agreed standard.';

  const milestones: ImplementationPlan['milestones'] = [
    { name: 'Discovery complete and current process confirmed', stage: 'DISCOVERY', weekOffset: 1 },
    { name: 'Requirements signed off', stage: 'REQUIREMENTS', weekOffset: Math.round(weeks * 0.2) },
    { name: 'Solution design agreed', stage: 'DESIGN', weekOffset: Math.round(weeks * 0.3) },
    { name: 'First working version', stage: 'BUILD', weekOffset: Math.round(weeks * 0.55) },
    { name: 'Testing passed against acceptance criteria', stage: 'TESTING', weekOffset: Math.round(weeks * 0.7) },
    { name: 'Pilot complete with a single team', stage: 'PILOT', weekOffset: Math.round(weeks * 0.85) },
    { name: 'Live to all users', stage: 'LAUNCH', weekOffset: weeks },
    { name: 'First performance review', stage: 'MONITORING', weekOffset: weeks + 4 },
  ];

  const tasks: ImplementationPlan['tasks'] = [
    {
      title: 'Confirm the current process end to end',
      description: `Walk through ${opportunity.name.toLowerCase()} with the people who do it and record the real steps, including the exceptions nobody documents.`,
      stage: 'DISCOVERY',
      priority: 'HIGH',
    },
    {
      title: 'Record the baseline measurements',
      description: 'Capture time taken, volume and error rate before anything changes. Without a baseline there is nothing to compare results against later.',
      stage: 'DISCOVERY',
      priority: 'HIGH',
    },
    {
      title: 'Agree success criteria',
      description: 'Write down what "working" means in numbers, and who decides whether it has been met.',
      stage: 'REQUIREMENTS',
      priority: 'HIGH',
    },
    ...deps.data.map((item) => ({
      title: `Prepare data: ${item}`,
      description: `Gather and check this before build starts: ${item}`,
      stage: 'REQUIREMENTS' as const,
      priority: 'HIGH' as const,
    })),
    ...deps.apis.concat(deps.integrations).map((item) => ({
      title: `Confirm integration: ${item}`,
      description: `Establish access and test the connection: ${item}`,
      stage: 'DESIGN' as const,
      priority: 'MEDIUM' as const,
    })),
    ...deps.security.map((item) => ({
      title: `Security: ${item}`,
      description: item,
      stage: 'DESIGN' as const,
      priority: 'HIGH' as const,
    })),
    {
      title: 'Design the escalation path',
      description: 'Decide exactly what happens when the system is unsure, and who picks it up.',
      stage: 'DESIGN',
      priority: 'HIGH',
    },
    {
      title: 'Build the first working version',
      description: opportunity.proposedSolution,
      stage: 'BUILD',
      priority: 'HIGH',
    },
    {
      title: 'Build the monitoring and audit trail',
      description: 'Record every decision the system makes so performance can be reviewed and mistakes traced.',
      stage: 'BUILD',
      priority: 'MEDIUM',
    },
    {
      title: 'Test against real historical cases',
      description: 'Run the system over work that has already been done and compare against what actually happened, including the awkward cases.',
      stage: 'TESTING',
      priority: 'HIGH',
    },
    {
      title: 'Run a pilot with one team',
      description: 'Keep the existing process running alongside it. Compare both for the length of the pilot.',
      stage: 'PILOT',
      priority: 'HIGH',
    },
    ...deps.training.map((item) => ({
      title: `Training: ${item}`,
      description: item,
      stage: 'PILOT' as const,
      priority: 'MEDIUM' as const,
    })),
    ...deps.policies.map((item) => ({
      title: `Policy: ${item}`,
      description: item,
      stage: 'LAUNCH' as const,
      priority: 'MEDIUM' as const,
    })),
    {
      title: 'Go live and retire the old process',
      description: 'Switch over only once the pilot has met its success criteria. Keep the manual process documented as a fallback.',
      stage: 'LAUNCH',
      priority: 'HIGH',
    },
    {
      title: 'Record actual results against projections',
      description: 'Enter the real KPI figures monthly so projected and actual can be compared honestly.',
      stage: 'MONITORING',
      priority: 'HIGH',
    },
    {
      title: 'Review and tune after the first quarter',
      description: 'Look at where the system is escalating most often and decide whether to extend it, adjust it, or stop.',
      stage: 'OPTIMISATION',
      priority: 'MEDIUM',
    },
  ];

  return {
    objective: `Reduce the time and errors involved in ${opportunity.name.toLowerCase()} by ${opportunity.proposedSolution.toLowerCase()}`,
    scope: `In scope: ${opportunity.name}. Out of scope: any change to pricing, staffing or the commercial terms of this work. The existing process stays available as a fallback until the pilot has met its criteria.`,
    aiTechnology: opportunity.aiCategory.replace(/_/g, ' ').toLowerCase(),
    integrations: [...deps.apis, ...deps.integrations],
    dataRequirements: deps.data.join('; ') || 'Access to the records this process reads and writes.',
    securityRequirements:
      deps.security.join('; ') ||
      `Confirm where data is processed and retained.${km.risk.handlesSensitiveData ? ' A data protection impact assessment is required before go-live.' : ''}`,
    testingRequirements:
      'Test against at least 30 real historical cases covering the routine path and the known exceptions. Agree the accuracy threshold before testing begins.',
    launchRequirements:
      'Pilot success criteria met, the escalation path staffed, the team trained, and the manual fallback documented.',
    trainingRequirements: deps.training.join('; ') || 'Short practical training for everyone who touches this process.',
    humanOversight: oversightText,
    monitoringRequirements:
      'Track the agreed KPIs monthly, review escalation rate and accuracy, and hold a formal performance review at the end of the first quarter.',
    estimatedWeeks: weeks,
    milestones,
    tasks: tasks.slice(0, 30),
  };
}

export async function buildImplementationPlan(
  opportunity: OpportunityForPlanning,
  km: KnowledgeModel,
): Promise<{ plan: ImplementationPlan; provider: string }> {
  const prompt = `## The business
${km.company.name} — ${km.company.industry ?? 'industry not stated'}, ${km.company.companySize ?? 'size not stated'} employees.
Systems in use: ${km.technology.systems.map((s) => `${s.name} (${s.category})`).join(', ') || 'none recorded'}.
Team AI familiarity: ${JSON.stringify(km.people.aiLiteracyMix)}.
Handles sensitive data: ${km.risk.handlesSensitiveData ? 'yes' : 'no'}.
Regulations: ${km.risk.regulations.join(', ') || 'none stated'}.

## The approved opportunity
Name: ${opportunity.name}
Current problem: ${opportunity.currentProblem}
Proposed solution: ${opportunity.proposedSolution}
Category: ${opportunity.aiCategory}
Complexity: ${opportunity.implementationComplexity}
Risk: ${opportunity.riskLevel}
Required oversight: ${opportunity.humanOversight}
Dependencies: ${JSON.stringify(opportunity.dependencies)}

## Your task
Produce a delivery plan a small business could actually follow, across the stages
Discovery, Requirements, Design, Build, Testing, Pilot, Launch, Monitoring and Optimisation.

Rules:
- Baseline measurement in discovery is mandatory: without it, results can never be proven.
- Include a pilot that runs alongside the existing process.
- Include the training and the escalation path. Implementations fail on these, not on the technology.
- Be realistic about elapsed time for a business that has other work to do.`;

  const { result, provider } = await runAgent({
    agent: 'ImplementationAgent',
    task: 'build-implementation-plan',
    organisationId: km.organisationId,
    system: `${SAFETY_PREAMBLE}

You are the Implementation Agent. You turn an approved recommendation into a plan that a
small business can actually deliver. You are practical, sequence work sensibly, and you never
skip baselining, piloting or training.`,
    prompt,
    schema: ImplementationPlanSchema,
    fallback: () => buildPlanLocally(opportunity, km),
    maxTokens: 20000,
  });

  return { plan: result, provider };
}
