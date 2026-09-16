import 'server-only';
import { z } from 'zod';
import { runAgent, SAFETY_PREAMBLE } from '../provider';
import { assembleContext, renderChunksForPrompt } from '../retrieval';
import { renderKnowledgeModelForPrompt, type KnowledgeModel } from '../../engine/knowledge-model';
import { AI_CATEGORIES } from '../../types';
import type { OpportunityDraft } from '../../engine/opportunities';

/**
 * AI Opportunity Agent (§22).
 *
 * The arithmetic stays in the outcome engine: this agent never produces a
 * figure. It works on the language and the judgement — what the problem really
 * is, what could realistically change, whether AI is the right answer at all,
 * and what the business would have to put in place first.
 */

export const OpportunityEnrichmentSchema = z.object({
  key: z.string().describe('The exact opportunity key supplied in the context.'),
  name: z.string().describe('A short, plain-English name a business owner would recognise.'),
  currentProblem: z.string().describe('What happens today and why it costs the business something.'),
  proposedSolution: z
    .string()
    .describe('What AI or automation could realistically change. Concrete, not aspirational.'),
  aiCategory: z.enum(AI_CATEGORIES),
  rationale: z.string().describe('Why this is the right category and the right priority.'),
  recommendation: z.enum(['IMPLEMENT', 'INVESTIGATE', 'DEFER', 'NOT_RECOMMENDED', 'DO_NOTHING']),
  notRecommendedReason: z
    .string()
    .nullable()
    .describe('Required when the recommendation is NOT_RECOMMENDED or DO_NOTHING.'),
  humanOversight: z.enum(['HUMAN_IN_LOOP', 'HUMAN_ON_LOOP', 'PERIODIC_AUDIT', 'AUTONOMOUS']),
  dependencies: z.object({
    data: z.array(z.string()),
    software: z.array(z.string()),
    apis: z.array(z.string()),
    integrations: z.array(z.string()),
    training: z.array(z.string()),
    security: z.array(z.string()),
    policies: z.array(z.string()),
  }),
  missingInformation: z
    .array(z.string())
    .describe('What the client would need to supply to raise confidence in this opportunity.'),
});

export const OpportunityReviewSchema = z.object({
  enrichments: z.array(OpportunityEnrichmentSchema).max(20),
  processesWhereAiIsWrong: z
    .array(
      z.object({
        processId: z.string(),
        reason: z.string().describe('Why AI is not the right answer for this process.'),
      }),
    )
    .describe('Processes where the honest recommendation is to leave things alone or fix something else first.'),
});

export type OpportunityReview = z.infer<typeof OpportunityReviewSchema>;

function draftKey(draft: OpportunityDraft): string {
  return draft.processId ?? `problem:${draft.problemId}`;
}

/** Renders the engine's drafts for review, including the numbers it derived. */
function renderDrafts(drafts: OpportunityDraft[], currency: string): string {
  return drafts
    .map((d) => {
      const o = d.outcome;
      const lines = [
        `### [${draftKey(d)}] ${d.name}`,
        `Engine category: ${d.aiCategory}`,
        `Engine recommendation: ${d.recommendation}${d.notRecommendedReason ? ` — ${d.notRecommendedReason}` : ''}`,
        `Priority score: ${d.priorityScore} (${d.priorityBand})`,
        `Complexity: ${d.implementationComplexity}; risk: ${d.riskLevel}; oversight: ${d.humanOversight}`,
        `Current state: ${d.currentProblem}`,
      ];
      if (o.currentHoursPerYear != null) {
        lines.push(`Measured: ~${Math.round(o.currentHoursPerYear)} hrs/year, about ${currency} ${o.currentAnnualCost?.toLocaleString()}/year`);
      }
      if (o.capacityReleasedLowHrs != null) {
        lines.push(
          `Engine estimate: ${o.reductionLowPct}-${o.reductionHighPct}% reduction, releasing ${o.capacityReleasedLowHrs}-${o.capacityReleasedHighHrs} hrs/year`,
        );
      }
      if (o.missingInputs.length) lines.push(`Missing inputs: ${o.missingInputs.join('; ')}`);
      lines.push(`Confidence: ${o.confidence}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

export async function reviewOpportunities(
  km: KnowledgeModel,
  drafts: OpportunityDraft[],
): Promise<{ drafts: OpportunityDraft[]; provider: string }> {
  if (drafts.length === 0) return { drafts, provider: 'engine' };

  const chunks = await assembleContext(km.organisationId, [
    'process bottleneck manual work time consuming',
    'customer enquiries leads follow up',
    'documents invoices data entry',
  ]);

  const prompt = `${renderKnowledgeModelForPrompt(km)}

## Supporting document extracts
${renderChunksForPrompt(chunks)}

## Opportunities identified by the platform's analysis engine
The engine has already sized these from the client's own figures. The numbers are fixed and
are not yours to change. Your job is the judgement and the wording.

${renderDrafts(drafts, km.financials.currency)}

## Your task
For each opportunity, write it the way a good consultant would put it to this client:

- Name it in language the business already uses.
- State the current problem concretely, referring to this company's own processes and systems.
- Describe what AI or automation could realistically change — specific enough to act on,
  honest about what still needs a person.
- Confirm or correct the AI category and the level of human oversight required.
- List what must be in place first: data, software, APIs, integrations, training, security, policies.

Be willing to disagree with the engine. If a process should not be automated — because the
volume is too low, the data is not ready, the work needs human judgement, or the real problem
is something else entirely — set the recommendation to NOT_RECOMMENDED and explain why in
notRecommendedReason. Recommending nothing is a valid and often correct answer.

Never state or imply that a financial outcome is guaranteed.`;

  const { result, provider } = await runAgent({
    agent: 'AIOpportunityAgent',
    task: 'review-opportunities',
    organisationId: km.organisationId,
    system: `${SAFETY_PREAMBLE}

You are the AI Opportunity Agent. You decide where AI or automation would genuinely help this
business, and where it would not. You never recommend AI because AI exists. You are specific
about what would change, plain about what it requires, and honest when the answer is to leave
something alone.`,
    prompt,
    schema: OpportunityReviewSchema,
    fallback: () => ({ enrichments: [], processesWhereAiIsWrong: [] }),
    maxTokens: 20000,
  });

  if (result.enrichments.length === 0) return { drafts, provider };

  const byKey = new Map(result.enrichments.map((e) => [e.key, e]));
  const vetoed = new Map(result.processesWhereAiIsWrong.map((p) => [p.processId, p.reason]));

  const merged = drafts.map((draft) => {
    const key = draftKey(draft);
    const enrichment = byKey.get(key);
    const veto = draft.processId ? vetoed.get(draft.processId) : undefined;

    let next: OpportunityDraft = { ...draft, generatedBy: 'llm' } as OpportunityDraft & { generatedBy: string };

    if (enrichment) {
      next = {
        ...next,
        name: enrichment.name || draft.name,
        currentProblem: enrichment.currentProblem || draft.currentProblem,
        proposedSolution: enrichment.proposedSolution || draft.proposedSolution,
        aiCategory: enrichment.aiCategory,
        rationale: enrichment.rationale || draft.rationale,
        recommendation: enrichment.recommendation,
        notRecommendedReason: enrichment.notRecommendedReason,
        humanOversight: enrichment.humanOversight,
        dependencies: enrichment.dependencies,
        missingInformation: Array.from(
          new Set([...draft.missingInformation, ...enrichment.missingInformation]),
        ),
      };
    }

    // A veto always wins: the platform errs towards not recommending AI.
    if (veto) {
      next = {
        ...next,
        recommendation: 'NOT_RECOMMENDED',
        aiCategory: 'NOT_RECOMMENDED',
        notRecommendedReason: veto,
        priorityBand: 'NOT_RECOMMENDED',
        priorityScore: 0,
      };
    }

    if (next.recommendation === 'NOT_RECOMMENDED' || next.recommendation === 'DO_NOTHING') {
      next.priorityBand = 'NOT_RECOMMENDED';
      next.priorityScore = 0;
      if (!next.notRecommendedReason) {
        next.notRecommendedReason = 'AI is not recommended for this process at present.';
      }
    }

    return next;
  });

  return { drafts: merged, provider };
}
