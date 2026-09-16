import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { calculateOutcome, aggregateOutcomes, deriveAnnualHours } from '../src/lib/engine/financials';
import { generateOpportunities, scoreProcessPotential } from '../src/lib/engine/opportunities';
import type { KmProcess, KnowledgeModel } from '../src/lib/engine/knowledge-model';
import type { Assumption, Formula } from '../src/lib/types';

function makeProcess(overrides: Partial<KmProcess> = {}): KmProcess {
  return {
    id: 'p1',
    name: 'Supplier invoice processing',
    description: 'Typing supplier invoices into the accounting system.',
    department: 'Finance',
    owner: 'Finance Manager',
    trigger: 'Invoice arrives by email',
    frequency: 'DAILY',
    hoursPerWeek: 16,
    avgDurationMins: null,
    volumePerPeriod: null,
    costPerYear: null,
    employeesInvolved: 1,
    systemsUsed: ['Sage'],
    inputs: 'Invoice PDF',
    outputs: 'Posted invoice',
    errorRate: 4,
    errorImpact: 'Mis-keyed job numbers',
    delayDescription: null,
    customerImpact: 'NONE',
    revenueImpact: 'NONE',
    manualScore: 5,
    repetitivenessScore: 5,
    dataReadiness: 4,
    aiPotential: null,
    automationPotential: null,
    riskLevel: 'LOW',
    source: 'ASSESSMENT',
    confidence: 'HIGH',
    stepCount: 5,
    bottleneckSteps: [],
    ...overrides,
  };
}

function makeKm(overrides: Partial<KnowledgeModel> = {}): KnowledgeModel {
  const base: KnowledgeModel = {
    organisationId: 'org1',
    organisationName: 'Test Ltd',
    version: 1,
    company: {
      name: 'Test Ltd',
      legalName: null,
      industry: 'Construction',
      subIndustry: null,
      companySize: '10-49',
      employeeCount: 30,
      locations: [],
      website: null,
      businessModel: 'B2B',
      productsServices: 'Roofing',
      targetCustomers: 'Commercial landlords',
      annualTurnover: 4_000_000,
      currency: 'GBP',
    },
    strategy: {
      biggestGoals: 'Grow without adding admin headcount',
      biggestProblems: 'Quotes take too long',
      growthLimiters: null,
      inefficientAreas: null,
      timeSinks: null,
      errorAreas: null,
      delayAreas: null,
      aiAmbition: null,
    },
    customers: {
      targetCustomers: null,
      avgCustomerValue: 24_000,
      monthlyLeadVolume: 45,
      conversionRate: 22,
    },
    departments: [],
    people: {
      employeeCount: 30,
      recordedEmployees: 0,
      repetitiveHoursPerWeek: null,
      aiLiteracyMix: {},
      trainingNeeds: [],
    },
    processes: [],
    technology: { systems: [], integrations: [], spreadsheetReliance: false },
    problems: [],
    objectives: [],
    financials: {
      avgHourlyLabourCost: 29,
      avgSalary: null,
      avgCustomerValue: 24_000,
      monthlyLeadVolume: 45,
      conversionRate: 22,
      operatingCosts: null,
      aiBudget: 40_000,
      currency: 'GBP',
    },
    risk: {
      handlesSensitiveData: false,
      regulations: [],
      securityConcerns: null,
      noAutonomyProcesses: null,
    },
    aiPosture: {
      currentAiUsage: null,
      aiTools: [],
      aiMaturityLevel: 1,
      automationAppetite: 'MEDIUM',
      oversightPreference: 'HUMAN_IN_LOOP',
    },
    documents: [],
    assessmentAnswers: {},
    interviewFacts: [],
    completeness: { overall: 0.8, byArea: {}, criticalGaps: [] },
  };
  return { ...base, ...overrides };
}

describe('deriveAnnualHours', () => {
  test('prefers stated weekly hours', () => {
    const assumptions: Assumption[] = [];
    const formulas: Formula[] = [];
    const missing: string[] = [];
    const hours = deriveAnnualHours(
      { hoursPerWeek: 10, avgDurationMins: null, volumePerPeriod: null, frequency: 'WEEKLY' },
      assumptions,
      formulas,
      missing,
    );
    assert.equal(hours, 460); // 10 hrs x 46 working weeks
    assert.equal(missing.length, 0);
    assert.ok(formulas.some((f) => f.label === 'Current annual hours'));
  });

  test('falls back to volume multiplied by duration', () => {
    const hours = deriveAnnualHours(
      { hoursPerWeek: null, avgDurationMins: 30, volumePerPeriod: 20, frequency: 'MONTHLY' },
      [],
      [],
      [],
    );
    assert.equal(hours, 120); // 30 mins x 20 x 12 / 60
  });

  test('records a missing input when time is unknown', () => {
    const missing: string[] = [];
    const hours = deriveAnnualHours(
      { hoursPerWeek: null, avgDurationMins: null, volumePerPeriod: null, frequency: null },
      [],
      [],
      missing,
    );
    assert.equal(hours, null);
    assert.equal(missing.length, 1);
  });
});

describe('calculateOutcome', () => {
  test('produces a range, never a single figure', () => {
    const result = calculateOutcome(makeProcess(), makeKm(), {
      aiCategory: 'DOCUMENT_AI',
      complexity: 'MEDIUM',
    });

    assert.ok(result.reductionLowPct! < result.reductionHighPct!);
    assert.ok(result.capacityReleasedLowHrs! < result.capacityReleasedHighHrs!);
    assert.ok(result.costSavingLow! < result.costSavingHigh!);
    assert.ok(result.implementationCostLow < result.implementationCostHigh);
  });

  test('values capacity using the supplied labour cost, and says so', () => {
    const result = calculateOutcome(makeProcess(), makeKm(), {
      aiCategory: 'DOCUMENT_AI',
      complexity: 'MEDIUM',
    });

    // 16 hrs/week x 46 weeks = 736 hrs/year at GBP 29 = GBP 21,344
    assert.equal(result.currentHoursPerYear, 736);
    assert.equal(result.currentAnnualCost, 21_344);

    const hourly = result.assumptions.find((a) => a.label === 'Hourly labour cost');
    assert.ok(hourly);
    assert.equal(hourly!.isEstimate, false, 'a supplied figure must not be labelled an estimate');
    assert.match(hourly!.source, /Supplied by the client/);
  });

  test('falls back to a benchmark labour cost and drops confidence', () => {
    const km = makeKm();
    km.financials.avgHourlyLabourCost = null;
    km.financials.avgSalary = null;

    const result = calculateOutcome(makeProcess(), km, {
      aiCategory: 'DOCUMENT_AI',
      complexity: 'MEDIUM',
    });

    assert.ok(result.missingInputs.some((m) => /hourly labour cost/i.test(m)));
    assert.ok(result.benchmarksUsed.length > 0);
    const hourly = result.assumptions.find((a) => a.label === 'Hourly labour cost');
    assert.equal(hourly!.isEstimate, true);
    assert.notEqual(result.confidence, 'HIGH');
  });

  test('refuses to estimate revenue without the inputs, and says what is missing', () => {
    const km = makeKm();
    km.financials.avgCustomerValue = null;
    km.financials.conversionRate = null;

    const result = calculateOutcome(makeProcess({ revenueImpact: 'HIGH' }), km, {
      aiCategory: 'WORKFLOW_AUTOMATION',
      complexity: 'MEDIUM',
      revenueImpact: 'HIGH',
    });

    assert.equal(result.revenueOpportunityLow, null);
    assert.ok(
      result.missingInputs.some((m) => /average customer value/i.test(m)),
      'must name the specific missing inputs',
    );
  });

  test('payback is funded by cost saving alone, not by speculative revenue', () => {
    const withRevenue = calculateOutcome(makeProcess({ revenueImpact: 'HIGH' }), makeKm(), {
      aiCategory: 'WORKFLOW_AUTOMATION',
      complexity: 'MEDIUM',
      revenueImpact: 'HIGH',
    });
    const withoutRevenue = calculateOutcome(makeProcess({ revenueImpact: 'NONE' }), makeKm(), {
      aiCategory: 'WORKFLOW_AUTOMATION',
      complexity: 'MEDIUM',
      revenueImpact: 'NONE',
    });

    assert.ok(withRevenue.revenueOpportunityHigh! > 0);
    assert.equal(
      withRevenue.paybackMonthsLow,
      withoutRevenue.paybackMonthsLow,
      'revenue must not shorten the payback period',
    );
  });

  test('every figure carries a formula that reproduces it', () => {
    const result = calculateOutcome(makeProcess(), makeKm(), {
      aiCategory: 'DOCUMENT_AI',
      complexity: 'MEDIUM',
    });
    for (const label of ['Current annual hours', 'Potential capacity released', 'Value of released capacity']) {
      assert.ok(
        result.formulas.some((f) => f.label === label),
        `missing formula: ${label}`,
      );
    }
  });
});

describe('aggregateOutcomes', () => {
  test('sums capacity and cost but never sums revenue', () => {
    const totals = aggregateOutcomes([
      {
        capacityReleasedLowHrs: 100,
        capacityReleasedHighHrs: 200,
        costSavingLow: 1_000,
        costSavingHigh: 2_000,
        revenueOpportunityLow: 50_000,
        revenueOpportunityHigh: 90_000,
        implementationCostLow: 8_000,
        implementationCostHigh: 30_000,
      },
      {
        capacityReleasedLowHrs: 50,
        capacityReleasedHighHrs: 80,
        costSavingLow: 500,
        costSavingHigh: 900,
        revenueOpportunityLow: 40_000,
        revenueOpportunityHigh: 70_000,
        implementationCostLow: 2_000,
        implementationCostHigh: 8_000,
      },
    ]);

    assert.equal(totals.capacityLowHrs, 150);
    assert.equal(totals.costSavingHigh, 2_900);
    assert.equal(totals.implementationHigh, 38_000);

    // The same pool of leads must not be counted twice.
    assert.equal(totals.revenueHigh, 90_000);
    assert.equal(totals.revenueLow, 50_000);
  });
});

describe('scoreProcessPotential', () => {
  test('rates a manual, repetitive, data-ready process highly', () => {
    const score = scoreProcessPotential(makeProcess());
    assert.ok(score.automationPotential > 70, `got ${score.automationPotential}`);
  });

  test('rates a variable, high-risk process lower', () => {
    const score = scoreProcessPotential(
      makeProcess({ manualScore: 2, repetitivenessScore: 1, dataReadiness: 1, riskLevel: 'HIGH', hoursPerWeek: 1 }),
    );
    assert.ok(score.aiPotential < 40, `got ${score.aiPotential}`);
  });
});

describe('generateOpportunities', () => {
  test('declines a process too small to be worth automating', () => {
    const tiny = makeProcess({
      id: 'tiny',
      name: 'Annual insurance renewal',
      hoursPerWeek: 0.2,
      frequency: 'ANNUAL',
    });
    const drafts = generateOpportunities(makeKm({ processes: [tiny] }));

    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].recommendation, 'NOT_RECOMMENDED');
    assert.equal(drafts[0].aiCategory, 'NOT_RECOMMENDED');
    assert.equal(drafts[0].priorityScore, 0);
    assert.match(drafts[0].notRecommendedReason!, /hours a year/);
  });

  test('declines a process that is already automated and working', () => {
    const automated = makeProcess({ id: 'auto', manualScore: 1, errorRate: 0.5 });
    const drafts = generateOpportunities(makeKm({ processes: [automated] }));

    assert.equal(drafts[0].recommendation, 'NOT_RECOMMENDED');
    assert.match(drafts[0].notRecommendedReason!, /already largely automated/);
  });

  test('declines variable judgement work with poor data and customer exposure', () => {
    const judgement = makeProcess({
      id: 'judge',
      name: 'Handling formal customer complaints',
      repetitivenessScore: 1,
      dataReadiness: 1,
      customerImpact: 'HIGH',
    });
    const drafts = generateOpportunities(makeKm({ processes: [judgement] }));

    assert.equal(drafts[0].recommendation, 'NOT_RECOMMENDED');
    assert.match(drafts[0].notRecommendedReason!, /varies case by case/);
  });

  test('attributes the revenue opportunity to exactly one opportunity', () => {
    const km = makeKm({
      processes: [
        makeProcess({ id: 'a', name: 'Quote preparation', revenueImpact: 'HIGH', hoursPerWeek: 50 }),
        makeProcess({ id: 'b', name: 'Lead follow up', revenueImpact: 'HIGH', hoursPerWeek: 20 }),
        makeProcess({ id: 'c', name: 'Enquiry handling', revenueImpact: 'HIGH', hoursPerWeek: 15 }),
      ],
    });

    const drafts = generateOpportunities(km);
    const withRevenue = drafts.filter((d) => (d.outcome.revenueOpportunityHigh ?? 0) > 0);

    assert.equal(withRevenue.length, 1, 'revenue must be counted against one opportunity only');

    for (const draft of drafts.filter((d) => d !== withRevenue[0])) {
      const note = draft.outcome.assumptions.find((a) => a.label === 'Revenue attribution');
      assert.ok(note, 'each other opportunity must record why revenue is not counted there');
      assert.match(note!.value, /same money twice|counted once/);
    }
  });

  test('recommends implementation for a strong candidate', () => {
    const strong = makeProcess({ id: 'strong', hoursPerWeek: 40 });
    const drafts = generateOpportunities(makeKm({ processes: [strong] }));

    assert.equal(drafts[0].recommendation, 'IMPLEMENT');
    assert.equal(drafts[0].priorityBand, 'PHASE_1');
    assert.ok(drafts[0].kpis.length > 0, 'a recommendation must define how success is measured');
    assert.ok(drafts[0].dependencies.data.length > 0, 'a recommendation must state what it needs');
    assert.ok(drafts[0].sources.length > 0, 'a recommendation must cite its sources');
  });
});
