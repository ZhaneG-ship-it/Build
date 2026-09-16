import type { Assumption, Confidence, Formula } from '../types';
import type { KmProcess, KnowledgeModel } from './knowledge-model';
import {
  FALLBACK_HOURLY_COST,
  IMPLEMENTATION_COST_BANDS,
  WORKING_WEEKS_PER_YEAR,
  reductionBenchmark,
} from './benchmarks';

/**
 * Projected Outcomes Engine (§10).
 *
 * Rules this module enforces:
 *  - Nothing is invented. Every figure traces to a client-supplied input or to a
 *    named benchmark, and which one it was is recorded.
 *  - Outcomes are ranges, never single points.
 *  - Cost saving, released capacity, revenue opportunity and productivity are
 *    reported as separate things and never summed into one headline.
 *  - When an input is missing the result says so and the confidence drops.
 */

export interface OutcomeResult {
  currency: string;

  currentHoursPerYear: number | null;
  currentAnnualCost: number | null;

  reductionLowPct: number | null;
  reductionHighPct: number | null;
  capacityReleasedLowHrs: number | null;
  capacityReleasedHighHrs: number | null;

  /** Value of released capacity. Only a cash saving if headcount or spend falls. */
  costSavingLow: number | null;
  costSavingHigh: number | null;

  revenueOpportunityLow: number | null;
  revenueOpportunityHigh: number | null;

  implementationCostLow: number;
  implementationCostHigh: number;
  runningCostPerYear: number;

  paybackMonthsLow: number | null;
  paybackMonthsHigh: number | null;

  assumptions: Assumption[];
  formulas: Formula[];
  inputs: Record<string, unknown>;
  benchmarksUsed: string[];
  missingInputs: string[];
  confidence: Confidence;
}

const PERIODS_PER_YEAR: Record<string, number> = {
  CONTINUOUS: 230,
  DAILY: 230,
  WEEKLY: WORKING_WEEKS_PER_YEAR,
  MONTHLY: 12,
  QUARTERLY: 4,
  ANNUAL: 1,
  AD_HOC: 12,
};

function round(value: number, dp = 0): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function money(value: number): number {
  return Math.round(value);
}

/**
 * Derives annual hours for a process from whatever the client supplied,
 * preferring directly-stated weekly hours over a volume x duration calculation.
 */
export function deriveAnnualHours(
  process: Pick<KmProcess, 'hoursPerWeek' | 'avgDurationMins' | 'volumePerPeriod' | 'frequency'>,
  assumptions: Assumption[],
  formulas: Formula[],
  missing: string[],
): number | null {
  if (process.hoursPerWeek != null && process.hoursPerWeek > 0) {
    const hours = process.hoursPerWeek * WORKING_WEEKS_PER_YEAR;
    formulas.push({
      label: 'Current annual hours',
      expression: `${process.hoursPerWeek} hrs/week x ${WORKING_WEEKS_PER_YEAR} working weeks`,
      result: `${round(hours)} hours/year`,
    });
    assumptions.push({
      label: 'Working weeks per year',
      value: String(WORKING_WEEKS_PER_YEAR),
      source: 'Platform default (52 weeks less leave and public holidays)',
      isEstimate: true,
    });
    return hours;
  }

  if (process.avgDurationMins != null && process.volumePerPeriod != null && process.frequency) {
    const periods = PERIODS_PER_YEAR[process.frequency] ?? 12;
    const hours = (process.avgDurationMins * process.volumePerPeriod * periods) / 60;
    formulas.push({
      label: 'Current annual hours',
      expression: `${process.avgDurationMins} mins x ${process.volumePerPeriod} per ${process.frequency.toLowerCase()} x ${periods} periods / 60`,
      result: `${round(hours)} hours/year`,
    });
    assumptions.push({
      label: `Periods per year for ${process.frequency.toLowerCase()} work`,
      value: String(periods),
      source: 'Platform calendar assumption',
      isEstimate: true,
    });
    return hours;
  }

  missing.push('Time spent on this process (hours per week, or volume and average duration)');
  return null;
}

/**
 * Narrows the benchmark reduction range using what we know about the process.
 * A highly manual, highly repetitive process with good data sits at the top of
 * the benchmark band; a variable process with poor data sits at the bottom.
 */
function adjustReduction(
  base: { low: number; high: number },
  process: Pick<KmProcess, 'manualScore' | 'repetitivenessScore' | 'dataReadiness'>,
  assumptions: Assumption[],
): { low: number; high: number } {
  const signals = [process.manualScore, process.repetitivenessScore, process.dataReadiness].filter(
    (s): s is number => s != null,
  );

  if (signals.length === 0) {
    assumptions.push({
      label: 'Process suitability signals',
      value: 'Not supplied — full benchmark range used',
      source: 'Benchmark range applied unmodified',
      isEstimate: true,
    });
    return base;
  }

  const avg = signals.reduce((s, v) => s + v, 0) / signals.length; // 1..5
  // Map 1..5 onto -0.35..+0.25 of the band width.
  const factor = (avg - 3) / 2; // -1 .. +1
  const width = base.high - base.low;
  const shift = factor * width * 0.3;

  const low = Math.max(5, Math.min(base.high, base.low + shift));
  const high = Math.max(low + 5, Math.min(95, base.high + shift));

  assumptions.push({
    label: 'Process suitability adjustment',
    value: `Manual/repetitiveness/data-readiness average ${round(avg, 1)}/5 shifted the benchmark band by ${round(shift, 1)} points`,
    source: 'Client-supplied process scores',
    isEstimate: true,
  });

  return { low: round(low), high: round(high) };
}

export interface OutcomeOptions {
  aiCategory: string;
  complexity: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Set when the opportunity plausibly affects revenue, not just cost. */
  revenueImpact?: string | null;
}

export function calculateOutcome(
  process: KmProcess,
  km: KnowledgeModel,
  options: OutcomeOptions,
): OutcomeResult {
  const assumptions: Assumption[] = [];
  const formulas: Formula[] = [];
  const missingInputs: string[] = [];
  const benchmarksUsed: string[] = [];
  const currency = km.financials.currency;

  // --- current state -------------------------------------------------------
  const currentHoursPerYear = deriveAnnualHours(process, assumptions, formulas, missingInputs);

  let hourlyCost = km.financials.avgHourlyLabourCost;
  let hourlyCostIsEstimate = false;

  if (hourlyCost == null && km.financials.avgSalary != null) {
    // 1,760 = 220 working days x 8 hours.
    hourlyCost = km.financials.avgSalary / 1760;
    hourlyCostIsEstimate = true;
    assumptions.push({
      label: 'Hourly labour cost',
      value: `${currency} ${round(hourlyCost, 2)} derived from the supplied average salary`,
      source: 'Client-supplied average salary / 1,760 working hours',
      isEstimate: true,
    });
  }

  if (hourlyCost == null) {
    const bench = FALLBACK_HOURLY_COST.DEFAULT;
    hourlyCost = (bench.low + bench.high) / 2;
    hourlyCostIsEstimate = true;
    benchmarksUsed.push(bench.source);
    missingInputs.push('Average hourly labour cost — supply this to replace the generic benchmark');
    assumptions.push({
      label: 'Hourly labour cost',
      value: `${currency} ${hourlyCost} (generic benchmark, ${currency} ${bench.low}-${bench.high})`,
      source: bench.source,
      isEstimate: true,
    });
  } else if (!hourlyCostIsEstimate) {
    assumptions.push({
      label: 'Hourly labour cost',
      value: `${currency} ${hourlyCost}`,
      source: 'Supplied by the client',
      isEstimate: false,
    });
  }

  const currentAnnualCost =
    currentHoursPerYear != null ? money(currentHoursPerYear * hourlyCost) : process.costPerYear ?? null;

  if (currentHoursPerYear != null) {
    formulas.push({
      label: 'Current annual cost of this process',
      expression: `${round(currentHoursPerYear)} hrs/year x ${currency} ${round(hourlyCost, 2)}/hr`,
      result: `${currency} ${currentAnnualCost?.toLocaleString()}`,
    });
  }

  // --- reduction range -----------------------------------------------------
  const benchmark = reductionBenchmark(options.aiCategory);
  benchmarksUsed.push(`${benchmark.label}: ${benchmark.low}-${benchmark.high}${benchmark.unit} (${benchmark.source})`);

  const reduction = adjustReduction({ low: benchmark.low, high: benchmark.high }, process, assumptions);

  const capacityReleasedLowHrs =
    currentHoursPerYear != null ? round(currentHoursPerYear * (reduction.low / 100)) : null;
  const capacityReleasedHighHrs =
    currentHoursPerYear != null ? round(currentHoursPerYear * (reduction.high / 100)) : null;

  if (currentHoursPerYear != null) {
    formulas.push({
      label: 'Potential capacity released',
      expression: `${round(currentHoursPerYear)} hrs/year x ${reduction.low}-${reduction.high}%`,
      result: `${capacityReleasedLowHrs}-${capacityReleasedHighHrs} hours/year`,
    });
  }

  const costSavingLow = capacityReleasedLowHrs != null ? money(capacityReleasedLowHrs * hourlyCost) : null;
  const costSavingHigh = capacityReleasedHighHrs != null ? money(capacityReleasedHighHrs * hourlyCost) : null;

  if (costSavingLow != null) {
    formulas.push({
      label: 'Value of released capacity',
      expression: `${capacityReleasedLowHrs}-${capacityReleasedHighHrs} hrs x ${currency} ${round(hourlyCost, 2)}/hr`,
      result: `${currency} ${costSavingLow.toLocaleString()}-${costSavingHigh?.toLocaleString()}/year`,
    });
    assumptions.push({
      label: 'How released capacity converts to money',
      value:
        'Released capacity becomes a cash saving only if headcount, overtime or contractor spend actually falls. Otherwise it is time redeployed to other work.',
      source: 'Platform reporting rule',
      isEstimate: false,
    });
  }

  // --- revenue -------------------------------------------------------------
  let revenueOpportunityLow: number | null = null;
  let revenueOpportunityHigh: number | null = null;

  const revenueRelevant = options.revenueImpact === 'MEDIUM' || options.revenueImpact === 'HIGH';
  const { avgCustomerValue, monthlyLeadVolume, conversionRate } = km.financials;

  if (revenueRelevant) {
    if (avgCustomerValue != null && monthlyLeadVolume != null && conversionRate != null) {
      // Model a conservative uplift in conversion, not in lead volume: better
      // follow-up converts leads that already exist.
      const upliftLowPct = 3;
      const upliftHighPct = 10;
      const annualLeads = monthlyLeadVolume * 12;
      const baselineCustomers = annualLeads * (conversionRate / 100);

      revenueOpportunityLow = money(baselineCustomers * (upliftLowPct / 100) * avgCustomerValue);
      revenueOpportunityHigh = money(baselineCustomers * (upliftHighPct / 100) * avgCustomerValue);

      formulas.push({
        label: 'Potential revenue opportunity',
        expression: `${annualLeads} leads/year x ${conversionRate}% conversion x ${upliftLowPct}-${upliftHighPct}% relative uplift x ${currency} ${avgCustomerValue} average value`,
        result: `${currency} ${revenueOpportunityLow.toLocaleString()}-${revenueOpportunityHigh.toLocaleString()}/year`,
      });
      assumptions.push({
        label: 'Conversion uplift range',
        value: `${upliftLowPct}-${upliftHighPct}% relative improvement in conversion of existing leads`,
        source: 'Platform benchmark for improved follow-up consistency',
        isEstimate: true,
      });
      assumptions.push({
        label: 'Revenue is attributed once',
        value:
          'This uplift draws on the same pool of leads as every other opportunity. It is counted against one opportunity only, never added up across several.',
        source: 'Platform reporting rule',
        isEstimate: false,
      });
      benchmarksUsed.push('Conversion uplift from consistent follow-up: 3-10% relative');
    } else {
      const absent: string[] = [];
      if (avgCustomerValue == null) absent.push('average customer value');
      if (monthlyLeadVolume == null) absent.push('monthly lead volume');
      if (conversionRate == null) absent.push('conversion rate');
      missingInputs.push(
        `Revenue impact not estimated. Supply ${absent.join(', ')} to produce a revenue range.`,
      );
    }
  }

  // --- implementation cost -------------------------------------------------
  const band = IMPLEMENTATION_COST_BANDS[options.complexity] ?? IMPLEMENTATION_COST_BANDS.MEDIUM;
  benchmarksUsed.push(
    `Implementation cost band for ${options.complexity.toLowerCase()} complexity: ${currency} ${band.low.toLocaleString()}-${band.high.toLocaleString()}`,
  );
  assumptions.push({
    label: 'Implementation cost',
    value: `${currency} ${band.low.toLocaleString()}-${band.high.toLocaleString()} one-off, plus about ${currency} ${band.runningPerYear.toLocaleString()}/year running cost`,
    source: 'Platform planning band by implementation complexity — not a quotation',
    isEstimate: true,
  });

  // --- payback -------------------------------------------------------------
  let paybackMonthsLow: number | null = null;
  let paybackMonthsHigh: number | null = null;

  // Payback is deliberately funded by cost saving alone. Revenue opportunity is
  // real but speculative, and letting it drive payback produces the flattering,
  // indefensible figures this platform exists to avoid.
  const annualBenefitHigh = (costSavingHigh ?? 0) - band.runningPerYear;
  const annualBenefitLow = (costSavingLow ?? 0) - band.runningPerYear;

  if (annualBenefitHigh > 0) {
    // Best case: cheapest build against the strongest benefit.
    paybackMonthsLow = round((band.low / annualBenefitHigh) * 12, 1);
    formulas.push({
      label: 'Payback (best case)',
      expression: `${currency} ${band.low.toLocaleString()} build / (${currency} ${annualBenefitHigh.toLocaleString()} net annual cost saving, excluding revenue) x 12`,
      result: `${paybackMonthsLow} months`,
    });
  }
  if (annualBenefitLow > 0) {
    paybackMonthsHigh = round((band.high / annualBenefitLow) * 12, 1);
    formulas.push({
      label: 'Payback (cautious case)',
      expression: `${currency} ${band.high.toLocaleString()} build / (${currency} ${annualBenefitLow.toLocaleString()} net annual cost saving, excluding revenue) x 12`,
      result: `${paybackMonthsHigh} months`,
    });
  }
  if (paybackMonthsLow == null && paybackMonthsHigh == null) {
    missingInputs.push(
      'Payback period not calculated. On cost saving alone, the supplied figures do not cover the running cost, so payback would depend on the revenue effect rather than on savings.',
    );
  }

  // --- confidence (§23) ----------------------------------------------------
  const confidence = scoreConfidence({
    hasHours: currentHoursPerYear != null,
    hourlyCostSupplied: !hourlyCostIsEstimate,
    hasSuitabilityScores:
      process.manualScore != null || process.repetitivenessScore != null || process.dataReadiness != null,
    revenueRelevant,
    revenueEstimated: revenueOpportunityLow != null,
    missingCount: missingInputs.length,
  });

  return {
    currency,
    currentHoursPerYear,
    currentAnnualCost,
    reductionLowPct: currentHoursPerYear != null ? reduction.low : null,
    reductionHighPct: currentHoursPerYear != null ? reduction.high : null,
    capacityReleasedLowHrs,
    capacityReleasedHighHrs,
    costSavingLow,
    costSavingHigh,
    revenueOpportunityLow,
    revenueOpportunityHigh,
    implementationCostLow: band.low,
    implementationCostHigh: band.high,
    runningCostPerYear: band.runningPerYear,
    paybackMonthsLow,
    paybackMonthsHigh,
    assumptions,
    formulas,
    inputs: {
      hoursPerWeek: process.hoursPerWeek,
      avgDurationMins: process.avgDurationMins,
      volumePerPeriod: process.volumePerPeriod,
      frequency: process.frequency,
      hourlyCost,
      hourlyCostSupplied: !hourlyCostIsEstimate,
      avgCustomerValue,
      monthlyLeadVolume,
      conversionRate,
      manualScore: process.manualScore,
      repetitivenessScore: process.repetitivenessScore,
      dataReadiness: process.dataReadiness,
      aiCategory: options.aiCategory,
      complexity: options.complexity,
    },
    benchmarksUsed,
    missingInputs,
    confidence,
  };
}

function scoreConfidence(signals: {
  hasHours: boolean;
  hourlyCostSupplied: boolean;
  hasSuitabilityScores: boolean;
  revenueRelevant: boolean;
  revenueEstimated: boolean;
  missingCount: number;
}): Confidence {
  let score = 0;
  if (signals.hasHours) score += 2;
  if (signals.hourlyCostSupplied) score += 2;
  if (signals.hasSuitabilityScores) score += 1;
  if (!signals.revenueRelevant || signals.revenueEstimated) score += 1;

  if (score >= 5 && signals.missingCount === 0) return 'HIGH';
  if (score >= 3) return 'MEDIUM';
  return 'LOW';
}

/**
 * Aggregates opportunity outcomes for the dashboard and report.
 *
 * Capacity, cost saving and implementation cost are additive: each opportunity
 * releases its own hours and carries its own build cost. Revenue is NOT. Every
 * revenue estimate draws on the same pool of leads, so summing them would count
 * the same money several times. The engine attributes revenue to a single
 * opportunity, and this function takes the maximum as a safeguard.
 */
export function aggregateOutcomes(
  results: {
    capacityReleasedLowHrs: number | null;
    capacityReleasedHighHrs: number | null;
    costSavingLow: number | null;
    costSavingHigh: number | null;
    revenueOpportunityLow: number | null;
    revenueOpportunityHigh: number | null;
    implementationCostLow: number | null;
    implementationCostHigh: number | null;
  }[],
) {
  const sum = (pick: (r: (typeof results)[number]) => number | null) =>
    results.reduce((total, r) => total + (pick(r) ?? 0), 0);

  return {
    capacityLowHrs: sum((r) => r.capacityReleasedLowHrs),
    capacityHighHrs: sum((r) => r.capacityReleasedHighHrs),
    costSavingLow: sum((r) => r.costSavingLow),
    costSavingHigh: sum((r) => r.costSavingHigh),
    revenueLow: Math.max(0, ...results.map((r) => r.revenueOpportunityLow ?? 0)),
    revenueHigh: Math.max(0, ...results.map((r) => r.revenueOpportunityHigh ?? 0)),
    implementationLow: sum((r) => r.implementationCostLow),
    implementationHigh: sum((r) => r.implementationCostHigh),
  };
}
