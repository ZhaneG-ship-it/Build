import 'server-only';
import { z } from 'zod';
import { runAgent, SAFETY_PREAMBLE, reportModel } from '../provider';
import { renderKnowledgeModelForPrompt, type KnowledgeModel } from '../../engine/knowledge-model';
import { aggregateOutcomes } from '../../engine/financials';
import { fmtHours, fmtRange, type ExecutiveNarrative } from '../../engine/report';
import type { OpportunityDraft } from '../../engine/opportunities';
import type { RiskAssessment } from './risk';

/**
 * Report Agent (§22).
 *
 * Writes the client-facing narrative. It is given the figures the engine already
 * calculated and must not restate them differently; its job is to explain what
 * they mean and what the business should do about them.
 */

export const ExecutiveNarrativeSchema = z.object({
  overview: z.string().describe('Two or three sentences on the business and what this assessment found.'),
  maturityNarrative: z.string().describe('Where this business stands with AI today, said plainly and without judgement.'),
  keyProblems: z.array(z.string()).max(5).describe('The problems that matter most, in the business own terms.'),
  keyOpportunities: z.array(z.string()).max(5),
  potentialOutcomes: z
    .string()
    .describe('What could change if the recommendations are followed. Ranges and estimates only, never promises.'),
  nextSteps: z.array(z.string()).max(6).describe('Concrete actions, in the order they should happen.'),
});

export function buildNarrativeLocally(
  km: KnowledgeModel,
  drafts: OpportunityDraft[],
  risk: RiskAssessment,
): ExecutiveNarrative {
  const currency = km.financials.currency;
  const recommended = drafts.filter(
    (d) => d.recommendation !== 'NOT_RECOMMENDED' && d.recommendation !== 'DO_NOTHING',
  );
  const notRecommended = drafts.length - recommended.length;
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

  const phase1 = recommended.filter((d) => d.priorityBand === 'PHASE_1');

  const maturityWords: Record<number, string> = {
    0: 'is not yet using AI in any structured way',
    1: 'has a few people experimenting with AI informally',
    2: 'is using AI in one area of the business',
    3: 'is using AI across several areas',
    4: 'has AI embedded in day-to-day operations',
    5: 'runs AI as a managed capability',
  };

  const overview = `${km.company.name} ${
    km.company.industry ? `operates in ${km.company.industry.toLowerCase()} and ` : ''
  }${maturityWords[km.aiPosture.aiMaturityLevel] ?? 'is at an early stage with AI'}. This assessment mapped ${
    km.processes.length
  } process${km.processes.length === 1 ? '' : 'es'}, identified ${km.problems.length} problem${
    km.problems.length === 1 ? '' : 's'
  }, and found ${recommended.length} opportunit${recommended.length === 1 ? 'y' : 'ies'} where AI or automation could realistically help${
    notRecommended > 0 ? `, along with ${notRecommended} where it could not` : ''
  }.`;

  const maturityNarrative = `On a scale of 0 to 5, the business currently sits at level ${km.aiPosture.aiMaturityLevel}. ${
    km.aiPosture.aiMaturityLevel <= 1
      ? 'That is a perfectly normal starting point and is not a disadvantage: it means the first implementation can be chosen for the clearest return rather than to fit around existing systems.'
      : 'Existing experience with AI lowers the risk of the next implementation, because the team already understands what these tools can and cannot do.'
  }${
    km.aiPosture.automationAppetite
      ? ` The business has described its appetite for automation as ${km.aiPosture.automationAppetite.toLowerCase()}, and the recommendations reflect that.`
      : ''
  }`;

  const keyProblems = km.problems
    .slice()
    .sort((a, b) => {
      const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
    })
    .slice(0, 5)
    .map((p) => {
      // The stored title is shortened for lists; the summary reads better from
      // the full description where one exists.
      const text = (p.description ?? p.title).trim();
      const sentence = text.length > 180 ? `${text.slice(0, text.lastIndexOf(' ', 180))}…` : text;
      return `${sentence}${p.hoursLostPerWeek ? ` — costing roughly ${p.hoursLostPerWeek} hours a week` : ''}`;
    });

  const keyOpportunities = recommended.slice(0, 5).map((d) => {
    const capacity =
      d.outcome.capacityReleasedLowHrs != null
        ? ` (estimated ${fmtHours(d.outcome.capacityReleasedLowHrs, d.outcome.capacityReleasedHighHrs)} released)`
        : '';
    return `${d.name}${capacity}`;
  });

  const potentialOutcomes = recommended.length
    ? `Taken together, the recommended opportunities could release an estimated ${fmtHours(
        totals.capacityLowHrs,
        totals.capacityHighHrs,
      )}, worth ${fmtRange(totals.costSavingLow, totals.costSavingHigh, currency)} at the labour cost supplied${
        totals.revenueHigh > 0
          ? `, with a separate potential revenue opportunity of ${fmtRange(totals.revenueLow, totals.revenueHigh, currency)}`
          : ''
      }. Implementing all of them is estimated at ${fmtRange(
        totals.implementationLow,
        totals.implementationHigh,
        currency,
      )}. These are estimates built from the figures this business supplied, presented as ranges, and are not guaranteed outcomes.`
    : 'No opportunity currently justifies the cost of implementing it. The most valuable next step is to record where time actually goes, so that a future assessment has something concrete to work from.';

  const nextSteps: string[] = [];
  if (phase1.length) {
    nextSteps.push(`Approve ${phase1[0].name} as the first implementation and confirm who will own it internally.`);
    nextSteps.push('Record the baseline measurements for that process before anything changes, so results can be proven later.');
  } else if (recommended.length) {
    nextSteps.push(`Investigate ${recommended[0].name} further before committing to an implementation.`);
  }
  if (km.completeness.criticalGaps.length) {
    nextSteps.push(`Supply the missing information that limits confidence: ${km.completeness.criticalGaps[0]}`);
  }
  if (risk.requiresHumanReview) {
    nextSteps.push('Complete the data protection and compliance review before any system goes live.');
  }
  nextSteps.push('Agree the KPIs for the first implementation and who records them each month.');
  if (recommended.length > 1) {
    nextSteps.push('Leave the later phases alone until the first implementation is delivering measured results.');
  }

  return {
    overview,
    maturityNarrative,
    keyProblems,
    keyOpportunities,
    potentialOutcomes,
    nextSteps: nextSteps.slice(0, 6),
  };
}

export async function writeExecutiveNarrative(
  km: KnowledgeModel,
  drafts: OpportunityDraft[],
  risk: RiskAssessment,
): Promise<{ narrative: ExecutiveNarrative; provider: string }> {
  const currency = km.financials.currency;
  const recommended = drafts.filter(
    (d) => d.recommendation !== 'NOT_RECOMMENDED' && d.recommendation !== 'DO_NOTHING',
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

  const prompt = `${renderKnowledgeModelForPrompt(km)}

## Opportunities the platform is recommending
${
  recommended
    .map(
      (d) =>
        `- ${d.name} [${d.priorityBand}] — ${d.proposedSolution} (releases ${fmtHours(
          d.outcome.capacityReleasedLowHrs,
          d.outcome.capacityReleasedHighHrs,
        )}, confidence ${d.confidence})`,
    )
    .join('\n') || '- None'
}

## Assessed and NOT recommended
${
  drafts
    .filter((d) => d.recommendation === 'NOT_RECOMMENDED' || d.recommendation === 'DO_NOTHING')
    .map((d) => `- ${d.name}: ${d.notRecommendedReason}`)
    .join('\n') || '- None'
}

## Totals calculated by the engine — use these exact figures, do not recalculate
- Potential capacity released: ${fmtHours(totals.capacityLowHrs, totals.capacityHighHrs)}
- Value of that capacity: ${fmtRange(totals.costSavingLow, totals.costSavingHigh, currency)}
- Potential revenue opportunity: ${totals.revenueHigh > 0 ? fmtRange(totals.revenueLow, totals.revenueHigh, currency) : 'not estimated — insufficient data'}
- Estimated implementation cost: ${fmtRange(totals.implementationLow, totals.implementationHigh, currency)}

## Risk position
${risk.overallPosture}

## Your task
Write the executive summary of this report for the owner of the business.

Rules:
- Write for someone who is good at running their business and knows nothing about AI.
- Use only the figures given above, exactly as given. Do not compute new ones.
- Always present outcomes as estimates and ranges. Never imply a guarantee.
- If the honest answer is that little should change right now, say so.
- No AI jargon. No hype. Short sentences.`;

  const { result, provider } = await runAgent({
    agent: 'ReportAgent',
    task: 'executive-narrative',
    organisationId: km.organisationId,
    system: `${SAFETY_PREAMBLE}

You are the Report Agent. You write the client-facing narrative of a professional consulting
report. You are measured, specific and readable. You never inflate a result, and you are
comfortable telling a client that the right answer is to do very little.`,
    prompt,
    schema: ExecutiveNarrativeSchema,
    fallback: () => buildNarrativeLocally(km, drafts, risk),
    model: reportModel(),
    maxTokens: 12000,
  });

  return { narrative: result, provider };
}
