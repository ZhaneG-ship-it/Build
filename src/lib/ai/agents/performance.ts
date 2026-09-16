import 'server-only';
import { z } from 'zod';
import { runAgent, SAFETY_PREAMBLE } from '../provider';

/**
 * Performance Agent (§15, §22).
 *
 * Compares what was projected against what actually happened, and is explicit
 * when the honest answer is that there is not yet enough data to tell.
 */

export const PerformanceReviewSchema = z.object({
  verdict: z.enum(['EXCEEDING', 'ON_TRACK', 'BELOW', 'INCONCLUSIVE']),
  narrative: z.string().describe('A short, plain assessment a business owner can act on.'),
  recommendations: z.array(z.string()).max(6),
});

export type PerformanceReview = z.infer<typeof PerformanceReviewSchema>;

export interface KpiComparison {
  name: string;
  metricKey: string;
  unit: string;
  direction: 'INCREASE' | 'DECREASE';
  baseline: number | null;
  projected: number | null;
  actual: number | null;
  /** Share of the projected movement actually achieved, where both are known. */
  attainment: number | null;
}

/**
 * Works out, for each KPI, how much of the projected movement was actually
 * delivered. Direction matters: for a DECREASE metric, going down is good.
 */
export function compareKpis(
  kpis: {
    name: string;
    metricKey: string;
    unit: string;
    direction: string;
    baselineValue: number | null;
    projectedValue: number | null;
    results: { actualValue: number; periodEnd: Date }[];
  }[],
): KpiComparison[] {
  return kpis.map((kpi) => {
    const latest = [...kpi.results].sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime())[0];
    const actual = latest?.actualValue ?? null;
    const direction = kpi.direction === 'DECREASE' ? 'DECREASE' : 'INCREASE';

    let attainment: number | null = null;
    if (kpi.baselineValue != null && kpi.projectedValue != null && actual != null) {
      const projectedMovement = kpi.projectedValue - kpi.baselineValue;
      const actualMovement = actual - kpi.baselineValue;
      if (Math.abs(projectedMovement) > 0.0001) {
        attainment = actualMovement / projectedMovement;
      }
    }

    return {
      name: kpi.name,
      metricKey: kpi.metricKey,
      unit: kpi.unit,
      direction,
      baseline: kpi.baselineValue,
      projected: kpi.projectedValue,
      actual,
      attainment,
    };
  });
}

export function reviewPerformanceLocally(comparisons: KpiComparison[]): PerformanceReview {
  const measured = comparisons.filter((c) => c.attainment != null);

  if (measured.length === 0) {
    return {
      verdict: 'INCONCLUSIVE',
      narrative:
        'There is not yet enough recorded data to judge performance. Record actual figures against the baseline KPIs for at least one full period before drawing any conclusion.',
      recommendations: [
        'Record actual values for each KPI for the period just ended.',
        'Confirm the baseline figures are still the right comparison.',
      ],
    };
  }

  const average = measured.reduce((sum, c) => sum + (c.attainment ?? 0), 0) / measured.length;
  const verdict: PerformanceReview['verdict'] =
    average >= 1.1 ? 'EXCEEDING' : average >= 0.75 ? 'ON_TRACK' : 'BELOW';

  const underperforming = measured.filter((c) => (c.attainment ?? 0) < 0.6);
  const outperforming = measured.filter((c) => (c.attainment ?? 0) >= 1.1);

  const parts: string[] = [];
  parts.push(
    `Across ${measured.length} measured KPI${measured.length === 1 ? '' : 's'}, about ${Math.round(average * 100)}% of the projected improvement has been delivered so far.`,
  );
  if (outperforming.length) {
    parts.push(`${outperforming.map((c) => c.name).join(', ')} ${outperforming.length === 1 ? 'is' : 'are'} ahead of projection.`);
  }
  if (underperforming.length) {
    parts.push(
      `${underperforming.map((c) => c.name).join(', ')} ${underperforming.length === 1 ? 'is' : 'are'} behind. This is usually adoption rather than the technology itself.`,
    );
  }
  if (comparisons.length > measured.length) {
    parts.push(
      `${comparisons.length - measured.length} KPI${comparisons.length - measured.length === 1 ? '' : 's'} still ${comparisons.length - measured.length === 1 ? 'has' : 'have'} no recorded result, so this picture is incomplete.`,
    );
  }

  const recommendations: string[] = [];
  if (underperforming.length) {
    recommendations.push(`Find out why ${underperforming[0].name} is behind before changing anything else.`);
    recommendations.push('Check whether the team is actually using the system, and whether anything is pushing them back to the old way.');
  }
  if (verdict === 'EXCEEDING') {
    recommendations.push('Consider widening the scope of this implementation, or applying the same pattern to a comparable process.');
  }
  if (comparisons.length > measured.length) {
    recommendations.push('Record the missing KPI results so the next review is based on the full picture.');
  }
  recommendations.push('Re-baseline the projections if the underlying volumes have changed materially since launch.');

  return { verdict, narrative: parts.join(' '), recommendations: recommendations.slice(0, 6) };
}

export async function reviewPerformance(
  organisationId: string,
  implementationName: string,
  comparisons: KpiComparison[],
  periodLabel: string,
): Promise<{ review: PerformanceReview; provider: string }> {
  const table = comparisons
    .map(
      (c) =>
        `- ${c.name} (${c.unit}, better when it goes ${c.direction === 'DECREASE' ? 'down' : 'up'}): baseline ${c.baseline ?? 'not recorded'}, projected ${c.projected ?? 'not projected'}, actual ${c.actual ?? 'not recorded'}${
          c.attainment != null ? `, attainment ${Math.round(c.attainment * 100)}%` : ''
        }`,
    )
    .join('\n');

  const prompt = `## Implementation under review
${implementationName}
Period: ${periodLabel}

## Projected versus actual
${table || 'No KPIs recorded.'}

## Your task
Give an honest assessment of how this implementation is performing.

Rules:
- If the recorded data does not support a conclusion, say INCONCLUSIVE and say what is missing.
- Do not credit the AI with an improvement the figures do not show.
- Where something is behind, suggest the most likely cause based on what the numbers show.
- Keep the recommendations to things the business can do in the next month.`;

  const { result, provider } = await runAgent({
    agent: 'PerformanceAgent',
    task: 'review-performance',
    organisationId,
    system: `${SAFETY_PREAMBLE}

You are the Performance Agent. You compare what was projected against what actually happened
and report it straight. You never flatter an implementation that is not working, and you say
so clearly when there is not enough data to judge.`,
    prompt,
    schema: PerformanceReviewSchema,
    fallback: () => reviewPerformanceLocally(comparisons),
  });

  return { review: result, provider };
}
