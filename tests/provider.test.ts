import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { runAgent, isLlmConfigured, SAFETY_PREAMBLE } from '../src/lib/ai/provider';
import { planInterviewFromGaps } from '../src/lib/ai/agents/interview';
import { assessRisksLocally } from '../src/lib/ai/agents/risk';
import { reviewPerformanceLocally, compareKpis } from '../src/lib/ai/agents/performance';
import { buildPlanLocally } from '../src/lib/ai/agents/implementation';
import type { KnowledgeModel } from '../src/lib/engine/knowledge-model';

function km(overrides: Partial<KnowledgeModel> = {}): KnowledgeModel {
  const base: KnowledgeModel = {
    organisationId: 'org-test',
    organisationName: 'Test Ltd',
    version: 1,
    company: {
      name: 'Test Ltd', legalName: null, industry: 'Construction', subIndustry: null,
      companySize: '10-49', employeeCount: 30, locations: [], website: null,
      businessModel: 'B2B', productsServices: 'Roofing', targetCustomers: 'Landlords',
      annualTurnover: 4_000_000, currency: 'GBP',
    },
    strategy: {
      biggestGoals: 'Grow without more admin', biggestProblems: 'Quotes are slow',
      growthLimiters: null, inefficientAreas: null, timeSinks: null, errorAreas: null,
      delayAreas: null, aiAmbition: null,
    },
    customers: { targetCustomers: null, avgCustomerValue: null, monthlyLeadVolume: null, conversionRate: null },
    departments: [],
    people: { employeeCount: 30, recordedEmployees: 0, repetitiveHoursPerWeek: null, aiLiteracyMix: { NONE: 4 }, trainingNeeds: [] },
    processes: [],
    technology: { systems: [], integrations: [], spreadsheetReliance: false },
    problems: [],
    objectives: [],
    financials: {
      avgHourlyLabourCost: null, avgSalary: null, avgCustomerValue: null, monthlyLeadVolume: null,
      conversionRate: null, operatingCosts: null, aiBudget: null, currency: 'GBP',
    },
    risk: { handlesSensitiveData: true, regulations: ['UK GDPR'], securityConcerns: null, noAutonomyProcesses: null },
    aiPosture: { currentAiUsage: null, aiTools: [], aiMaturityLevel: 0, automationAppetite: null, oversightPreference: null },
    documents: [],
    assessmentAnswers: {},
    interviewFacts: [],
    completeness: { overall: 0.2, byArea: {}, criticalGaps: ['Average hourly labour cost'] },
  };
  return { ...base, ...overrides };
}

describe('provider fallback', () => {
  test('without an API key the deterministic engine produces the result', async () => {
    assert.equal(isLlmConfigured(), false, 'this test assumes no key is configured');

    const { result, provider, model } = await runAgent({
      agent: 'TestAgent',
      task: 'unit-test',
      system: SAFETY_PREAMBLE,
      prompt: 'anything',
      schema: z.object({ verdict: z.string() }),
      fallback: () => ({ verdict: 'engine-produced' }),
    });

    assert.equal(provider, 'engine');
    assert.equal(model, null);
    assert.deepEqual(result, { verdict: 'engine-produced' });
  });

  test('the fallback is always evaluated, so a result always exists', async () => {
    let called = 0;
    await runAgent({
      agent: 'TestAgent',
      task: 'unit-test',
      system: 'x',
      prompt: 'y',
      schema: z.object({ n: z.number() }),
      fallback: () => {
        called++;
        return { n: 1 };
      },
    });
    assert.equal(called, 1);
  });

  test('the safety preamble states the rules the product depends on', () => {
    for (const rule of [
      /NEVER invent facts/i,
      /Label every estimate/i,
      /never appropriate|not appropriate|say so plainly/i,
      /Do nothing.*valid|valid.*conclusion/i,
      /human review/i,
    ]) {
      assert.match(SAFETY_PREAMBLE, rule, `safety preamble is missing: ${rule}`);
    }
  });
});

describe('interview gap analysis', () => {
  test('asks for the hourly labour cost before anything else', () => {
    const plan = planInterviewFromGaps(km(), new Set());

    assert.equal(plan.hasEnoughInformation, false);
    assert.match(plan.questions[0].targetField!, /profile:avgHourlyLabourCost/);
    assert.ok(plan.questions[0].reasonForQuestion.length > 40, 'every question must justify itself');
  });

  test('never repeats a question already asked', () => {
    const asked = new Set(['profile:avgHourlyLabourCost']);
    const plan = planInterviewFromGaps(km(), asked);
    assert.ok(!plan.questions.some((q) => q.targetField === 'profile:avgHourlyLabourCost'));
  });

  test('asks for time against each unsized process, naming it', () => {
    const model = km({
      processes: [
        {
          id: 'p1', name: 'Quote preparation', description: null, department: null, owner: null,
          trigger: null, frequency: null, hoursPerWeek: null, avgDurationMins: null,
          volumePerPeriod: null, costPerYear: null, employeesInvolved: null, systemsUsed: [],
          inputs: null, outputs: null, errorRate: null, errorImpact: null, delayDescription: null,
          customerImpact: null, revenueImpact: null, manualScore: 4, repetitivenessScore: 4,
          dataReadiness: 3, aiPotential: null, automationPotential: null, riskLevel: 'LOW',
          source: 'ASSESSMENT', confidence: 'MEDIUM', stepCount: 0, bottleneckSteps: [],
        },
      ],
    });

    const plan = planInterviewFromGaps(model, new Set());
    const timeQuestion = plan.questions.find((q) => q.targetField === 'process:p1:hoursPerWeek');

    assert.ok(timeQuestion, 'expected a question sizing the process');
    assert.match(timeQuestion!.question, /Quote preparation/);
  });

  test('keeps asking while a revenue story has no revenue inputs', () => {
    // "Quotes are slow" is a revenue story, so the platform must not stop until
    // it can either estimate the revenue effect or say why it cannot.
    const model = km({
      financials: { ...km().financials, avgHourlyLabourCost: 29 },
      risk: { ...km().risk, noAutonomyProcesses: 'Final pricing' },
    });

    const plan = planInterviewFromGaps(model, new Set());
    assert.equal(plan.hasEnoughInformation, false);
    assert.ok(plan.questions.some((q) => q.targetField === 'profile:monthlyLeadVolume'));
    assert.ok(plan.questions.some((q) => q.targetField === 'profile:conversionRate'));
  });

  test('stops when there is genuinely nothing worth asking', () => {
    const complete = km({
      strategy: {
        biggestGoals: 'Reduce internal admin effort', biggestProblems: 'Too much rekeying',
        growthLimiters: null, inefficientAreas: null, timeSinks: null, errorAreas: null,
        delayAreas: null, aiAmbition: null,
      },
      financials: {
        avgHourlyLabourCost: 29, avgSalary: 38_000, avgCustomerValue: 24_000,
        monthlyLeadVolume: 45, conversionRate: 22, operatingCosts: null,
        aiBudget: 40_000, currency: 'GBP',
      },
      risk: { ...km().risk, noAutonomyProcesses: 'Final pricing' },
    });

    const plan = planInterviewFromGaps(complete, new Set());
    assert.equal(plan.hasEnoughInformation, true, JSON.stringify(plan.questions.map((q) => q.targetField)));
    assert.equal(plan.questions.length, 0);
    assert.ok(plan.stopReason);
  });
});

describe('risk assessment', () => {
  test('raises privacy and compliance risk when the business is exposed to it', () => {
    const assessment = assessRisksLocally(km(), []);

    assert.equal(assessment.requiresHumanReview, true);
    assert.ok(assessment.risks.some((r) => r.category === 'PRIVACY'));
    assert.ok(assessment.risks.some((r) => r.category === 'COMPLIANCE' && /UK GDPR/.test(r.title)));
  });

  test('every risk carries a control the business could actually apply', () => {
    const assessment = assessRisksLocally(km(), []);
    for (const risk of assessment.risks) {
      assert.ok(risk.mitigation.length > 20, `${risk.title} has no usable mitigation`);
    }
  });

  test('a low-exposure business gets a proportionate answer', () => {
    const safe = km({
      risk: { handlesSensitiveData: false, regulations: [], securityConcerns: null, noAutonomyProcesses: null },
      people: { ...km().people, aiLiteracyMix: { CONFIDENT: 5 } },
      aiPosture: { ...km().aiPosture, aiMaturityLevel: 2 },
    });
    const assessment = assessRisksLocally(safe, []);

    assert.equal(assessment.requiresHumanReview, false);
    assert.ok(!assessment.risks.some((r) => r.category === 'PRIVACY'));
  });
});

describe('performance review', () => {
  test('refuses to draw a conclusion without recorded results', () => {
    const review = reviewPerformanceLocally(
      compareKpis([
        {
          name: 'Hours', metricKey: 'HOURS_SAVED', unit: 'hrs', direction: 'DECREASE',
          baselineValue: 100, projectedValue: 40, results: [],
        },
      ]),
    );

    assert.equal(review.verdict, 'INCONCLUSIVE');
    assert.match(review.narrative, /not yet enough recorded data/i);
  });

  test('measures attainment against the projected movement, not the raw value', () => {
    const comparisons = compareKpis([
      {
        name: 'Hours', metricKey: 'HOURS_SAVED', unit: 'hrs', direction: 'DECREASE',
        baselineValue: 100, projectedValue: 40,
        results: [{ actualValue: 70, periodEnd: new Date() }],
      },
    ]);

    // Moved 30 of the 60 projected, so exactly half.
    assert.equal(comparisons[0].attainment, 0.5);
    assert.equal(reviewPerformanceLocally(comparisons).verdict, 'BELOW');
  });

  test('reports honestly when results beat the projection', () => {
    const comparisons = compareKpis([
      {
        name: 'Hours', metricKey: 'HOURS_SAVED', unit: 'hrs', direction: 'DECREASE',
        baselineValue: 100, projectedValue: 40,
        results: [{ actualValue: 30, periodEnd: new Date() }],
      },
    ]);
    assert.equal(reviewPerformanceLocally(comparisons).verdict, 'EXCEEDING');
  });
});

describe('implementation planning', () => {
  test('always includes baselining, a pilot and training', () => {
    const plan = buildPlanLocally(
      {
        name: 'Automate invoice entry',
        currentProblem: 'Invoices are typed by hand.',
        proposedSolution: 'Extract invoice fields automatically.',
        aiCategory: 'DOCUMENT_AI',
        implementationComplexity: 'MEDIUM',
        riskLevel: 'LOW',
        humanOversight: 'HUMAN_IN_LOOP',
        dependencies: {
          data: ['50 sample invoices'], software: ['Sage'], apis: [], integrations: [],
          training: ['Finance team training'], security: [], policies: [],
        },
      },
      km(),
    );

    const titles = plan.tasks.map((t) => t.title.toLowerCase()).join(' | ');
    assert.match(titles, /baseline/, 'a plan without baselining can never prove its results');
    assert.match(titles, /pilot/);
    assert.match(titles, /training/);

    const stages = new Set(plan.milestones.map((m) => m.stage));
    for (const stage of ['DISCOVERY', 'TESTING', 'PILOT', 'LAUNCH', 'MONITORING']) {
      assert.ok(stages.has(stage as never), `missing milestone stage ${stage}`);
    }
  });

  test('a more complex implementation is given more time', () => {
    const base = {
      name: 'x', currentProblem: 'y', proposedSolution: 'z', aiCategory: 'DOCUMENT_AI',
      riskLevel: 'LOW', humanOversight: 'HUMAN_IN_LOOP',
      dependencies: { data: [], software: [], apis: [], integrations: [], training: [], security: [], policies: [] },
    };
    const low = buildPlanLocally({ ...base, implementationComplexity: 'LOW' }, km());
    const high = buildPlanLocally({ ...base, implementationComplexity: 'HIGH' }, km());

    assert.ok(high.estimatedWeeks > low.estimatedWeeks);
  });
});
