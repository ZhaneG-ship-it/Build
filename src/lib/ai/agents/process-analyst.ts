import 'server-only';
import { z } from 'zod';
import { runAgent, SAFETY_PREAMBLE } from '../provider';
import { assembleContext, renderChunksForPrompt } from '../retrieval';
import { renderKnowledgeModelForPrompt, type KnowledgeModel } from '../../engine/knowledge-model';

/**
 * Process Analyst Agent (§22).
 *
 * Reads the mapped processes plus any uploaded procedure documents, proposes the
 * steps a process is actually made of, and names the inefficiencies in it. It
 * describes what happens today — it does not propose solutions; that is the
 * Opportunity Agent's job.
 */

export const ProcessStepSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  role: z.string().nullable().describe('Who performs this step, if stated.'),
  systemUsed: z.string().nullable(),
  durationMins: z.number().nullable(),
  isManual: z.boolean(),
  isBottleneck: z.boolean().describe('True if work waits or piles up at this step.'),
  automatable: z.boolean().describe('True if this step follows rules that do not need judgement.'),
});

export const ProcessInsightSchema = z.object({
  processId: z.string().describe('The exact process id from the supplied context.'),
  steps: z.array(ProcessStepSchema).max(12),
  inefficiencies: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        category: z.enum(['BOTTLENECK', 'COST', 'ERROR', 'DELAY', 'CAPACITY', 'QUALITY', 'VISIBILITY']),
        severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
        rootCause: z.string().nullable(),
        evidence: z.string().describe('The specific fact or document quote this rests on.'),
      }),
    )
    .max(4),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
});

export const ProcessAnalysisSchema = z.object({
  insights: z.array(ProcessInsightSchema).max(12),
  overallObservation: z.string().describe('What the shape of these processes says about the business.'),
});

export type ProcessAnalysis = z.infer<typeof ProcessAnalysisSchema>;

/**
 * Deterministic analysis. Derives steps from the process record and any document
 * facts, and names inefficiencies from the signals that are actually recorded.
 */
export function analyseProcessesLocally(km: KnowledgeModel): ProcessAnalysis {
  const insights: ProcessAnalysis['insights'] = [];

  for (const process of km.processes) {
    const inefficiencies: ProcessAnalysis['insights'][number]['inefficiencies'] = [];

    if ((process.manualScore ?? 0) >= 4) {
      inefficiencies.push({
        title: `${process.name} is handled manually`,
        description: `This process scores ${process.manualScore}/5 for manual effort, which means people are doing work a system could carry.`,
        category: 'CAPACITY',
        severity: (process.hoursPerWeek ?? 0) >= 8 ? 'HIGH' : 'MEDIUM',
        rootCause: 'The work has never been automated, usually because no single system covers it end to end.',
        evidence: `Manual effort score ${process.manualScore}/5 recorded against process ${process.id}.`,
      });
    }

    if (process.systemsUsed.length >= 2) {
      inefficiencies.push({
        title: `Information is moved by hand between ${process.systemsUsed.length} systems`,
        description: `${process.name} spans ${process.systemsUsed.join(', ')}. Every hand-off between them is a chance to lose time or introduce an error.`,
        category: 'ERROR',
        severity: 'MEDIUM',
        rootCause: 'These systems are not integrated, so a person is acting as the integration.',
        evidence: `Systems recorded on process ${process.id}: ${process.systemsUsed.join(', ')}.`,
      });
    }

    if (process.errorRate != null && process.errorRate > 3) {
      inefficiencies.push({
        title: `${process.name} has a ${process.errorRate}% error rate`,
        description: `Roughly ${process.errorRate}% of this work has to be corrected, which adds rework on top of the original effort.`,
        category: 'ERROR',
        severity: process.errorRate > 10 ? 'HIGH' : 'MEDIUM',
        rootCause: process.errorImpact ?? null,
        evidence: `Error rate of ${process.errorRate}% recorded against process ${process.id}.`,
      });
    }

    if (process.delayDescription) {
      inefficiencies.push({
        title: `Delays in ${process.name}`,
        description: process.delayDescription,
        category: 'DELAY',
        severity: process.customerImpact === 'HIGH' ? 'HIGH' : 'MEDIUM',
        rootCause: null,
        evidence: `Delay reported by the client against process ${process.id}.`,
      });
    }

    // Without documented steps, propose the generic shape of the work so the
    // consultant has something concrete to correct rather than a blank map.
    const steps: ProcessAnalysis['insights'][number]['steps'] =
      process.stepCount > 0
        ? []
        : [
            {
              name: process.trigger ? `Trigger: ${process.trigger}` : 'Work arrives',
              description: 'The event that starts this process.',
              role: process.owner,
              systemUsed: process.systemsUsed[0] ?? null,
              durationMins: null,
              isManual: true,
              isBottleneck: false,
              automatable: false,
            },
            {
              name: 'Information is gathered and checked',
              description: 'Details are collected from the customer, a system or a document.',
              role: null,
              systemUsed: process.systemsUsed[0] ?? null,
              durationMins: null,
              isManual: true,
              isBottleneck: false,
              automatable: true,
            },
            {
              name: 'Information is entered into the system of record',
              description: 'The gathered details are recorded, often by retyping.',
              role: null,
              systemUsed: process.systemsUsed[1] ?? process.systemsUsed[0] ?? null,
              durationMins: null,
              isManual: true,
              isBottleneck: process.systemsUsed.length >= 2,
              automatable: true,
            },
            {
              name: 'Output is produced and sent',
              description: process.outputs ?? 'The result of the process is delivered.',
              role: process.owner,
              systemUsed: null,
              durationMins: null,
              isManual: true,
              isBottleneck: false,
              automatable: true,
            },
          ];

    insights.push({
      processId: process.id,
      steps,
      inefficiencies: inefficiencies.slice(0, 4),
      confidence: process.hoursPerWeek != null ? 'MEDIUM' : 'LOW',
    });
  }

  const manualHeavy = km.processes.filter((p) => (p.manualScore ?? 0) >= 4).length;
  const observation = km.processes.length
    ? `${manualHeavy} of ${km.processes.length} mapped processes are largely manual. ${
        km.technology.spreadsheetReliance
          ? 'Spreadsheets are carrying work that a system should hold, which is a common source of both delay and error.'
          : 'The systems in place cover most of the work, so the opportunity is mainly in the hand-offs between them.'
      }`
    : 'No processes have been mapped yet, so there is nothing to analyse.';

  return { insights, overallObservation: observation };
}

export async function analyseProcesses(
  km: KnowledgeModel,
): Promise<{ analysis: ProcessAnalysis; provider: string }> {
  if (km.processes.length === 0) {
    return { analysis: { insights: [], overallObservation: 'No processes mapped.' }, provider: 'engine' };
  }

  const chunks = await assembleContext(km.organisationId, [
    'procedure steps process how we do this',
    'responsibilities owner who does',
    'delay bottleneck waiting error rework',
  ]);

  const prompt = `${renderKnowledgeModelForPrompt(km)}

## Supporting document extracts
${renderChunksForPrompt(chunks)}

## Your task
For each process listed above, set out the steps it is actually made of and name the
inefficiencies in it.

Rules:
- Use the exact process id shown in square brackets. Do not invent processes.
- Where a procedure document describes the steps, follow the document and cite it.
- Where no document exists, propose the most likely steps and mark the analysis LOW confidence.
- Only report an inefficiency you can point to evidence for. Do not manufacture problems.
- Describe what happens today. Do not propose solutions.`;

  const { result, provider } = await runAgent({
    agent: 'ProcessAnalystAgent',
    task: 'analyse-processes',
    organisationId: km.organisationId,
    system: `${SAFETY_PREAMBLE}

You are the Process Analyst Agent. You map how work actually flows through a business and
name where it is slow, error-prone or duplicated. You are precise and evidence-led, and you
are comfortable saying that a process looks well run.`,
    prompt,
    schema: ProcessAnalysisSchema,
    fallback: () => analyseProcessesLocally(km),
    reconcile: (llm, engine) => {
      // Keep only insights that name a real process in this organisation.
      const validIds = new Set(km.processes.map((p) => p.id));
      const filtered = llm.insights.filter((i) => validIds.has(i.processId));
      return filtered.length ? { ...llm, insights: filtered } : engine;
    },
  });

  return { analysis: result, provider };
}
