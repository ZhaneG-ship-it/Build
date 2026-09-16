import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CORE_ASSESSMENT,
  allQuestions,
  computeProgress,
  isQuestionVisible,
  missingRequired,
  visibleQuestions,
} from '../src/lib/engine/assessment-template';
import { assessCompleteness, confidenceFromCompleteness } from '../src/lib/engine/knowledge-model';
import type { KnowledgeModel } from '../src/lib/engine/knowledge-model';

describe('assessment template', () => {
  test('every question key is unique', () => {
    const keys = allQuestions(CORE_ASSESSMENT).map((q) => q.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  test('every dependsOn rule points at a question that exists', () => {
    const keys = new Set(allQuestions(CORE_ASSESSMENT).map((q) => q.key));
    for (const question of allQuestions(CORE_ASSESSMENT)) {
      if (!question.dependsOn) continue;
      assert.ok(
        keys.has(question.dependsOn.questionKey),
        `${question.key} depends on unknown key ${question.dependsOn.questionKey}`,
      );
    }
  });

  test('covers every area the assessment is required to cover', () => {
    const areas = new Set(allQuestions(CORE_ASSESSMENT).map((q) => q.businessArea));
    for (const required of ['company', 'operations', 'people', 'technology', 'ai', 'financial', 'risk', 'strategy']) {
      assert.ok(areas.has(required), `missing coverage of ${required}`);
    }
  });
});

describe('conditional questions', () => {
  test('a CRM question is hidden until a CRM is reported', () => {
    const crm = allQuestions(CORE_ASSESSMENT).find((q) => q.key === 'tech.crm')!;
    assert.equal(isQuestionVisible(crm, {}), false);
    assert.equal(isQuestionVisible(crm, { 'tech.categories': ['ACCOUNTING'] }), false);
    assert.equal(isQuestionVisible(crm, { 'tech.categories': ['CRM', 'ACCOUNTING'] }), true);
  });

  test('security concerns are only asked of businesses holding sensitive data', () => {
    const security = allQuestions(CORE_ASSESSMENT).find((q) => q.key === 'risk.securityConcerns')!;
    assert.equal(isQuestionVisible(security, { 'risk.sensitiveData': false }), false);
    assert.equal(isQuestionVisible(security, { 'risk.sensitiveData': true }), true);
  });

  test('two different businesses are asked different questions', () => {
    const softwareCompany = visibleQuestions(CORE_ASSESSMENT, {
      'tech.categories': ['CRM', 'PROJECT_MGMT'],
      'risk.sensitiveData': true,
      'fin.monthlyLeadVolume': 200,
    });
    const tradesCompany = visibleQuestions(CORE_ASSESSMENT, {
      'tech.categories': ['ACCOUNTING', 'SPREADSHEET'],
      'risk.sensitiveData': false,
    });

    const softwareKeys = new Set(softwareCompany.map((q) => q.key));
    const tradesKeys = new Set(tradesCompany.map((q) => q.key));

    assert.notDeepEqual(softwareKeys, tradesKeys);
    assert.ok(softwareKeys.has('tech.crm') && !tradesKeys.has('tech.crm'));
    assert.ok(tradesKeys.has('tech.spreadsheetUse') && !softwareKeys.has('tech.spreadsheetUse'));
  });
});

describe('progress and validation', () => {
  test('progress only counts questions the business is actually shown', () => {
    const answers: Record<string, unknown> = {};
    assert.equal(computeProgress(CORE_ASSESSMENT, answers), 0);

    // Answering a question can reveal further questions, so the visible set has
    // to be re-read until it stops growing. That widening is the adaptive
    // behaviour working, not progress going backwards.
    let previous = -1;
    for (let pass = 0; pass < 10 && Object.keys(answers).length !== previous; pass++) {
      previous = Object.keys(answers).length;
      for (const question of visibleQuestions(CORE_ASSESSMENT, answers)) {
        if (answers[question.key] !== undefined) continue;
        answers[question.key] =
          question.inputType === 'NUMBER' || question.inputType === 'SCALE' ? 1 : 'answered';
      }
    }

    assert.equal(computeProgress(CORE_ASSESSMENT, answers), 1);
  });

  test('answering a question can widen the assessment', () => {
    const before = visibleQuestions(CORE_ASSESSMENT, {}).length;
    const after = visibleQuestions(CORE_ASSESSMENT, {
      'tech.categories': ['CRM', 'ERP', 'ACCOUNTING', 'SPREADSHEET'],
      'risk.sensitiveData': true,
      'fin.monthlyLeadVolume': 45,
      'ai.currentUsage': 'Used in one area',
    }).length;

    assert.ok(after > before, `expected the assessment to widen: ${before} -> ${after}`);
  });

  test('an empty list does not count as an answer', () => {
    const departments = allQuestions(CORE_ASSESSMENT).find((q) => q.key === 'company.departments')!;
    const outstanding = missingRequired(CORE_ASSESSMENT, { 'company.departments': [] });
    assert.ok(outstanding.some((q) => q.key === departments.key));
  });
});

function emptyKm(): KnowledgeModel {
  return {
    organisationId: 'o',
    organisationName: 'Empty Ltd',
    version: 1,
    company: {
      name: 'Empty Ltd', legalName: null, industry: null, subIndustry: null, companySize: null,
      employeeCount: null, locations: [], website: null, businessModel: null, productsServices: null,
      targetCustomers: null, annualTurnover: null, currency: 'GBP',
    },
    strategy: {
      biggestGoals: null, biggestProblems: null, growthLimiters: null, inefficientAreas: null,
      timeSinks: null, errorAreas: null, delayAreas: null, aiAmbition: null,
    },
    customers: { targetCustomers: null, avgCustomerValue: null, monthlyLeadVolume: null, conversionRate: null },
    departments: [],
    people: { employeeCount: null, recordedEmployees: 0, repetitiveHoursPerWeek: null, aiLiteracyMix: {}, trainingNeeds: [] },
    processes: [],
    technology: { systems: [], integrations: [], spreadsheetReliance: false },
    problems: [],
    objectives: [],
    financials: {
      avgHourlyLabourCost: null, avgSalary: null, avgCustomerValue: null, monthlyLeadVolume: null,
      conversionRate: null, operatingCosts: null, aiBudget: null, currency: 'GBP',
    },
    risk: { handlesSensitiveData: false, regulations: [], securityConcerns: null, noAutonomyProcesses: null },
    aiPosture: { currentAiUsage: null, aiTools: [], aiMaturityLevel: 0, automationAppetite: null, oversightPreference: null },
    documents: [],
    assessmentAnswers: {},
    interviewFacts: [],
    completeness: { overall: 0, byArea: {}, criticalGaps: [] },
  };
}

describe('completeness drives confidence', () => {
  test('an empty business is flagged as missing everything that blocks an estimate', () => {
    const result = assessCompleteness(emptyKm());

    assert.equal(result.overall, 0);
    assert.ok(result.criticalGaps.some((g) => /hourly labour cost/i.test(g)));
    assert.ok(result.criticalGaps.some((g) => /mapped business process/i.test(g)));
  });

  test('supplying the blocking figures clears the critical gaps', () => {
    const km = emptyKm();
    km.financials.avgHourlyLabourCost = 29;
    km.financials.avgCustomerValue = 24_000;
    km.financials.conversionRate = 22;
    km.processes = [
      {
        id: 'p', name: 'Invoicing', description: null, department: null, owner: null, trigger: null,
        frequency: 'WEEKLY', hoursPerWeek: 10, avgDurationMins: null, volumePerPeriod: null,
        costPerYear: null, employeesInvolved: null, systemsUsed: [], inputs: null, outputs: null,
        errorRate: null, errorImpact: null, delayDescription: null, customerImpact: null,
        revenueImpact: null, manualScore: 4, repetitivenessScore: 4, dataReadiness: 3,
        aiPotential: null, automationPotential: null, riskLevel: 'LOW', source: 'ASSESSMENT',
        confidence: 'HIGH', stepCount: 0, bottleneckSteps: [],
      },
    ];

    const result = assessCompleteness(km);
    assert.equal(result.criticalGaps.length, 0);
    assert.ok(result.overall > 0);
  });

  test('confidence bands follow completeness', () => {
    assert.equal(confidenceFromCompleteness(0.9), 'HIGH');
    assert.equal(confidenceFromCompleteness(0.5), 'MEDIUM');
    assert.equal(confidenceFromCompleteness(0.1), 'LOW');
  });
});
