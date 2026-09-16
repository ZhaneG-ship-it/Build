import 'server-only';
import { z } from 'zod';
import { runAgent, SAFETY_PREAMBLE } from '../provider';
import { assembleContext, renderChunksForPrompt } from '../retrieval';
import { renderKnowledgeModelForPrompt, type KnowledgeModel } from '../../engine/knowledge-model';

/**
 * Adaptive AI Interview (§7).
 *
 * After the assessment, the platform works out what it still does not know and
 * asks only for that. Every question carries the reason it was asked, the
 * business area it belongs to, and the knowledge-model field it fills, so an
 * answer becomes a structured fact rather than more prose.
 *
 * The interview stops on its own once it can make a reliable assessment.
 */

export const InterviewQuestionSchema = z.object({
  question: z.string().describe('The question to put to the client, in plain business English.'),
  reasonForQuestion: z
    .string()
    .describe('Why this is being asked and what it will let the platform calculate.'),
  businessArea: z
    .enum(['company', 'strategy', 'operations', 'people', 'technology', 'financial', 'risk', 'ai'])
    .describe('Which part of the business this fills in.'),
  targetField: z
    .string()
    .nullable()
    .describe(
      'The knowledge-model field this answer fills, e.g. "process:<id>:hoursPerWeek" or "profile:avgHourlyLabourCost". Null if it is exploratory.',
    ),
  inputType: z.enum(['TEXT', 'LONGTEXT', 'NUMBER', 'CURRENCY', 'PERCENT', 'SELECT']),
  options: z.array(z.string()).describe('Choices when inputType is SELECT, otherwise an empty array.'),
});

export const InterviewPlanSchema = z.object({
  hasEnoughInformation: z
    .boolean()
    .describe('True when the platform can already produce a reliable assessment without asking more.'),
  stopReason: z
    .string()
    .nullable()
    .describe('If stopping, the plain-English reason. Null when continuing.'),
  questions: z.array(InterviewQuestionSchema).max(8),
});

export type InterviewPlan = z.infer<typeof InterviewPlanSchema>;
export type InterviewQuestion = z.infer<typeof InterviewQuestionSchema>;

const MAX_QUESTIONS_PER_ROUND = 6;
const MAX_ROUNDS = 4;

/**
 * Deterministic gap analysis. Walks the knowledge model looking for the specific
 * fields that block a defensible estimate, most valuable first.
 */
export function planInterviewFromGaps(km: KnowledgeModel, alreadyAsked: Set<string>): InterviewPlan {
  const questions: InterviewQuestion[] = [];

  const push = (q: InterviewQuestion) => {
    if (questions.length >= MAX_QUESTIONS_PER_ROUND) return;
    const fingerprint = q.targetField ?? q.question;
    if (alreadyAsked.has(fingerprint)) return;
    alreadyAsked.add(fingerprint);
    questions.push(q);
  };

  // 1. Money first — without it no opportunity can be valued.
  if (km.financials.avgHourlyLabourCost == null) {
    push({
      question: `What does one hour of employee time cost ${km.company.name}, including employer costs and overheads?`,
      reasonForQuestion:
        'Every hour this platform says AI could release is valued using this figure. Without it, all financial estimates fall back to a generic benchmark and are marked low confidence.',
      businessArea: 'financial',
      targetField: 'profile:avgHourlyLabourCost',
      inputType: 'CURRENCY',
      options: [],
    });
  }

  // 2. Size the processes we already know about.
  const unsizedProcesses = km.processes.filter((p) => p.hoursPerWeek == null);
  for (const process of unsizedProcesses.slice(0, 4)) {
    push({
      question: `Across everyone involved, how many hours a week does "${process.name}" take?`,
      reasonForQuestion: `"${process.name}" is recorded as a process but has no time against it, so the platform cannot tell whether it is worth automating. This converts it into an annual hours figure.`,
      businessArea: 'operations',
      targetField: `process:${process.id}:hoursPerWeek`,
      inputType: 'NUMBER',
      options: [],
    });
  }

  const noFrequency = km.processes.filter((p) => !p.frequency && p.hoursPerWeek != null);
  for (const process of noFrequency.slice(0, 2)) {
    push({
      question: `How often does "${process.name}" happen?`,
      reasonForQuestion:
        'Frequency decides how much of the benefit is recurring, which directly affects where this sits on the roadmap.',
      businessArea: 'operations',
      targetField: `process:${process.id}:frequency`,
      inputType: 'SELECT',
      options: ['Continuous', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually', 'Ad hoc'],
    });
  }

  const noSystems = km.processes.filter((p) => p.systemsUsed.length === 0);
  for (const process of noSystems.slice(0, 2)) {
    push({
      question: `Which systems or tools are used during "${process.name}"?`,
      reasonForQuestion:
        'Which systems are involved determines whether this can be integrated, and how complex and expensive the implementation would be.',
      businessArea: 'technology',
      targetField: `process:${process.id}:systemsUsed`,
      inputType: 'TEXT',
      options: [],
    });
  }

  // 3. Revenue-side inputs, only when there is a plausible revenue story.
  const revenueRelevant = km.processes.some(
    (p) => p.revenueImpact === 'MEDIUM' || p.revenueImpact === 'HIGH',
  ) || /lead|sale|quote|enquir|customer/i.test(
    `${km.strategy.biggestGoals ?? ''} ${km.strategy.biggestProblems ?? ''}`,
  );

  if (revenueRelevant) {
    if (km.financials.monthlyLeadVolume == null) {
      push({
        question: 'How many leads or enquiries arrive each month?',
        reasonForQuestion:
          'Needed before the platform will put any number against a revenue opportunity. Without it, revenue impact is left unestimated rather than guessed.',
        businessArea: 'financial',
        targetField: 'profile:monthlyLeadVolume',
        inputType: 'NUMBER',
        options: [],
      });
    }
    if (km.financials.conversionRate == null) {
      push({
        question: 'What percentage of those leads become paying customers?',
        reasonForQuestion:
          'Combined with lead volume and average customer value, this is what allows a revenue range to be calculated rather than asserted.',
        businessArea: 'financial',
        targetField: 'profile:conversionRate',
        inputType: 'PERCENT',
        options: [],
      });
    }
    if (km.financials.avgCustomerValue == null) {
      push({
        question: 'What is an average customer worth to the business?',
        reasonForQuestion:
          'This turns a conversion improvement into a monetary range. Without it the platform will report revenue impact as "not estimated".',
        businessArea: 'financial',
        targetField: 'profile:avgCustomerValue',
        inputType: 'CURRENCY',
        options: [],
      });
    }
  }

  // 4. Quantify the problems that were described only in words.
  const unquantifiedProblems = km.problems.filter(
    (p) => p.hoursLostPerWeek == null && p.annualCostEstimate == null,
  );
  for (const problem of unquantifiedProblems.slice(0, 2)) {
    push({
      question: `You mentioned: "${problem.title}". Roughly how many hours a week does this cost the business?`,
      reasonForQuestion:
        'A problem described in words cannot be prioritised against the others. An hours figure makes it comparable.',
      businessArea: 'operations',
      targetField: `problem:${problem.id}:hoursLostPerWeek`,
      inputType: 'NUMBER',
      options: [],
    });
  }

  for (const problem of km.problems.filter((p) => !p.rootCause).slice(0, 1)) {
    push({
      question: `Why do you think "${problem.title}" happens?`,
      reasonForQuestion:
        'Understanding the cause prevents recommending AI for a problem that is really about process or staffing. Sometimes the honest answer is that AI is not the fix.',
      businessArea: 'operations',
      targetField: `problem:${problem.id}:rootCause`,
      inputType: 'LONGTEXT',
      options: [],
    });
  }

  // 5. Error rates, where errors were reported at all.
  if (km.strategy.errorAreas) {
    const noErrorRate = km.processes.filter((p) => p.errorRate == null && p.hoursPerWeek != null);
    for (const process of noErrorRate.slice(0, 1)) {
      push({
        question: `Roughly what percentage of "${process.name}" has to be corrected or redone?`,
        reasonForQuestion:
          'Rework is usually invisible in time estimates but is often the larger cost. This sets the baseline for an error-rate KPI after implementation.',
        businessArea: 'operations',
        targetField: `process:${process.id}:errorRate`,
        inputType: 'PERCENT',
        options: [],
      });
    }
  }

  // 6. Basics, if the assessment was skipped.
  if (!km.company.productsServices) {
    push({
      question: 'In plain terms, what does the business sell?',
      reasonForQuestion:
        'Nothing can be assessed without knowing what the business actually does. This is the foundation of every other conclusion.',
      businessArea: 'company',
      targetField: 'profile:productsServices',
      inputType: 'LONGTEXT',
      options: [],
    });
  }
  if (!km.risk.noAutonomyProcesses) {
    push({
      question: 'Which decisions in the business must always be made by a person?',
      reasonForQuestion:
        'Anything named here is excluded from autonomous automation in every recommendation the platform makes.',
      businessArea: 'risk',
      targetField: 'profile:noAutonomyProcesses',
      inputType: 'LONGTEXT',
      options: [],
    });
  }

  const enough = questions.length === 0;
  return {
    hasEnoughInformation: enough,
    stopReason: enough
      ? 'The platform has enough information about how the business runs, what it costs and where the problems are to produce a reliable assessment.'
      : null,
    questions,
  };
}

export async function planInterview(
  km: KnowledgeModel,
  alreadyAsked: Set<string>,
  round: number,
): Promise<{ plan: InterviewPlan; provider: string }> {
  // Hard stop so the interview can never loop indefinitely.
  if (round > MAX_ROUNDS) {
    return {
      plan: {
        hasEnoughInformation: true,
        stopReason: `The interview reached its limit of ${MAX_ROUNDS} rounds. The analysis will proceed and flag anything still missing as low confidence.`,
        questions: [],
      },
      provider: 'engine',
    };
  }

  const engineFallback = () => planInterviewFromGaps(km, new Set(alreadyAsked));

  const chunks = await assembleContext(km.organisationId, [
    'process steps responsibilities owner',
    'time taken hours per week volume',
    'systems software used',
  ]);

  const askedList = [...alreadyAsked].slice(-40);

  const prompt = `Here is everything currently known about this business.

${renderKnowledgeModelForPrompt(km)}

## Supporting document extracts
${renderChunksForPrompt(chunks)}

## Questions already asked (do not repeat these)
${askedList.length ? askedList.map((q) => `- ${q}`).join('\n') : '- None yet'}

## Your task
Decide what the platform still needs to know before it can produce a reliable AI opportunity
assessment for this business, and ask at most ${MAX_QUESTIONS_PER_ROUND} questions.

Prioritise in this order:
1. Figures needed to value time: the hourly cost of employee time.
2. Time and frequency for processes that have none recorded.
3. The inputs needed for any revenue estimate, but only if a revenue story is plausible here.
4. Quantifying problems that have been described only in words.
5. Anything specific to this industry that materially changes the analysis.

Rules:
- Ask about THIS business, using its own words and the names of its own processes.
- Never ask for something already recorded above.
- Set targetField whenever the answer maps to a known field. Use the exact process
  and problem ids shown in square brackets above.
- If you genuinely have enough to make a reliable assessment, set hasEnoughInformation
  to true and return no questions. Do not pad the interview.`;

  const { result, provider } = await runAgent({
    agent: 'BusinessAnalystAgent',
    task: 'adaptive-interview',
    organisationId: km.organisationId,
    system: `${SAFETY_PREAMBLE}

You are the Business Analyst Agent. Your job is to understand how a business works
well enough that the rest of the platform can make defensible recommendations. You ask
short, specific, answerable questions. You never ask a question whose answer you already
have, and you stop as soon as you know enough.`,
    prompt,
    schema: InterviewPlanSchema,
    fallback: engineFallback,
    reconcile: (llm, engine) => {
      // Trust the engine's judgement that a hard gap exists: if the model wants
      // to stop while a blocking field is still missing, keep asking.
      if (llm.hasEnoughInformation && !engine.hasEnoughInformation) {
        return engine;
      }
      // Drop anything the model asked that has already been asked.
      const filtered = llm.questions.filter(
        (q) => !alreadyAsked.has(q.targetField ?? q.question),
      );
      return { ...llm, questions: filtered.slice(0, MAX_QUESTIONS_PER_ROUND) };
    },
  });

  return { plan: result, provider };
}
