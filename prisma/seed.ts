/**
 * Seeds a complete, realistic worked example so the whole journey can be
 * inspected immediately: assessment -> documents -> interview -> knowledge model
 * -> opportunities -> report -> roadmap -> project -> KPIs -> performance review.
 *
 * Run with: npm run db:seed
 */

import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

import { applyAssessmentAnswers, applyInterviewAnswer } from '../src/lib/engine/ingest';
import { snapshotKnowledgeModel } from '../src/lib/engine/knowledge-model';
import { runFullAnalysis } from '../src/lib/engine/orchestrator';
import { processDocument } from '../src/lib/documents/pipeline';
import { buildImplementationPlan } from '../src/lib/ai/agents/implementation';
import { buildKnowledgeModel } from '../src/lib/engine/knowledge-model';
import { compareKpis, reviewPerformance } from '../src/lib/ai/agents/performance';
import { getTemplate, computeProgress } from '../src/lib/engine/assessment-template';
import { parseJson, stringify } from '../src/lib/json';
import type { Dependencies } from '../src/lib/engine/opportunities';

const prisma = new PrismaClient();
const scrypt = promisify(_scrypt) as (p: string, s: string, k: number) => Promise<Buffer>;

async function hash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

const DEMO_PASSWORD = 'clarity123';

// ---------------------------------------------------------------------------
// The worked example: a roofing contractor with a real, recognisable problem.
// ---------------------------------------------------------------------------

const ASSESSMENT_ANSWERS: Record<string, unknown> = {
  'company.industry': 'Construction',
  'company.subIndustry': 'Commercial and industrial roofing',
  'company.companySize': '10-49',
  'company.employeeCount': 34,
  'company.locations': ['Leeds (head office)', 'Sheffield depot'],
  'company.website': 'https://northgateroofing.example',
  'company.businessModel': 'B2B',
  'company.productsServices':
    'Flat roof installation, roof refurbishment and planned maintenance contracts for commercial landlords, schools and NHS trusts.',
  'company.targetCustomers':
    'Facilities managers and property managers responsible for portfolios of commercial buildings across Yorkshire.',
  'company.departments': ['Sales & Estimating', 'Operations', 'Finance', 'Admin'],
  'company.annualTurnover': 4200000,

  'strategy.biggestGoals':
    'Grow turnover to £6m over two years without adding back-office headcount. Win more planned maintenance contracts, because they are recurring and higher margin than one-off installs.',
  'strategy.biggestProblems':
    'We lose quotes because we are too slow to get them out. A surveyor visits, writes notes on a tablet, then it sits in a queue for days before anyone turns it into a priced quote. We also spend an enormous amount of time keying supplier invoices into Sage.',
  'strategy.growthLimiters':
    'Estimating capacity is the bottleneck. We have two estimators and they are the constraint on how much work we can bid for.',
  'strategy.objectives': [
    'Cut quote turnaround from 9 days to under 48 hours',
    'Win 3 more planned maintenance contracts per year',
    'Stop adding admin headcount as turnover grows',
  ],
  'strategy.aiAmbition':
    'Honestly we are not sure. We keep hearing about AI but we do not want to buy a tool that sits unused. We want to know where it would actually pay for itself.',

  'ops.coreProcesses': [
    'Quote preparation and pricing',
    'Site survey and measurement',
    'Supplier invoice processing',
    'Job scheduling and labour allocation',
    'Planned maintenance visit reporting',
    'Health and safety documentation',
  ],
  'ops.repetitiveTasks': [
    'Entering supplier invoices into Sage',
    'Producing monthly management reports',
    'Answering routine customer enquiries about job status',
  ],
  'ops.manualTasks': [
    'Copying survey measurements from tablet notes into the quoting spreadsheet',
    'Re-keying approved quotes into the job scheduling system',
  ],
  'ops.timeSinks':
    'Estimating is the biggest. Two estimators spend most of their week turning survey notes into priced quotes. Finance spends about two days a week on invoice entry.',
  'ops.bottlenecks':
    'Everything queues behind the two estimators. A survey can sit for a week before it is priced, and by then the customer has often gone elsewhere.',
  'ops.delays':
    'Quote turnaround averages nine days against a target of two. Supplier invoices are often entered a fortnight late, which makes cash position reporting unreliable.',
  'ops.errors':
    'Measurements get transposed between the tablet notes and the pricing spreadsheet, which causes under-quoting. We estimate around one in twelve quotes has a pricing error that we later absorb.',
  'ops.adminHoursPerWeek': 95,
  'ops.customerEnquiryVolume': 180,

  'people.repetitiveHoursPerPerson': 11,
  'people.aiLiteracy': 'BASIC',
  'people.trainingNeeds':
    'The estimating team would need hands-on training. The finance manager is comfortable with new systems; the site teams are not.',
  'people.changeAppetite': 'Cautious',

  'tech.categories': ['CRM', 'ACCOUNTING', 'EMAIL', 'STORAGE', 'PROJECT_MGMT', 'SPREADSHEET', 'INDUSTRY'],
  'tech.crm': 'HubSpot',
  'tech.accounting': 'Sage',
  'tech.projectManagement': 'Asana',
  'tech.industrySoftware': 'PlanSwift',
  'tech.spreadsheetUse':
    'All pricing lives in a shared Excel workbook. It has grown over eleven years and only two people fully understand it.',
  'tech.otherSystems': ['Microsoft 365', 'SharePoint'],
  'tech.dataQuality': 3,

  'ai.currentUsage': 'A few people experimenting',
  'ai.tools': ['ChatGPT for drafting emails'],
  'ai.whatWorked':
    'Drafting tender responses has been genuinely useful. An attempt to use it for pricing was abandoned because it invented figures.',
  'ai.automationAppetite': 'MEDIUM',
  'ai.oversightPreference': 'HUMAN_IN_LOOP',

  'fin.avgHourlyLabourCost': 29,
  'fin.avgSalary': 38000,
  'fin.avgCustomerValue': 24000,
  'fin.monthlyLeadVolume': 45,
  'fin.conversionRate': 22,
  'fin.operatingCosts': 3600000,
  'fin.aiBudget': 40000,

  'risk.sensitiveData': true,
  'risk.regulations': ['UK GDPR', 'ISO 27001'],
  'risk.securityConcerns':
    'We hold client site access details and staff records. Client contracts restrict where their data can be processed.',
  'risk.noAutonomy':
    'Final quote pricing must always be approved by an estimator. Health and safety sign-off must always be done by a person. Nothing may be sent to a customer without a human reading it first.',
};

/** Weekly hours per named process, as would come from the adaptive interview. */
const PROCESS_HOURS: Record<string, number> = {
  'Quote preparation and pricing': 52,
  'Site survey and measurement': 30,
  'Supplier invoice processing': 16,
  'Job scheduling and labour allocation': 12,
  'Planned maintenance visit reporting': 9,
  'Health and safety documentation': 7,
  'Entering supplier invoices into Sage': 16,
  'Producing monthly management reports': 6,
  'Answering routine customer enquiries about job status': 14,
  'Copying survey measurements from tablet notes into the quoting spreadsheet': 11,
  'Re-keying approved quotes into the job scheduling system': 4,
};

const PROCESS_EXTRAS: Record<string, { frequency: string; systems: string[]; customerImpact: string; revenueImpact: string; errorRate?: number }> = {
  'Quote preparation and pricing': {
    frequency: 'DAILY',
    systems: ['HubSpot', 'Spreadsheets', 'PlanSwift'],
    customerImpact: 'HIGH',
    revenueImpact: 'HIGH',
    errorRate: 8,
  },
  'Supplier invoice processing': {
    frequency: 'DAILY',
    systems: ['Sage', 'Microsoft 365'],
    customerImpact: 'NONE',
    revenueImpact: 'LOW',
    errorRate: 4,
  },
  'Entering supplier invoices into Sage': {
    frequency: 'DAILY',
    systems: ['Sage', 'Microsoft 365'],
    customerImpact: 'NONE',
    revenueImpact: 'LOW',
    errorRate: 4,
  },
  'Answering routine customer enquiries about job status': {
    frequency: 'DAILY',
    systems: ['HubSpot', 'Microsoft 365'],
    customerImpact: 'HIGH',
    revenueImpact: 'MEDIUM',
  },
  'Copying survey measurements from tablet notes into the quoting spreadsheet': {
    frequency: 'DAILY',
    systems: ['Spreadsheets', 'PlanSwift'],
    customerImpact: 'MEDIUM',
    revenueImpact: 'HIGH',
    errorRate: 9,
  },
  'Producing monthly management reports': {
    frequency: 'MONTHLY',
    systems: ['Sage', 'Spreadsheets'],
    customerImpact: 'NONE',
    revenueImpact: 'LOW',
  },
  'Site survey and measurement': {
    frequency: 'DAILY',
    systems: ['PlanSwift'],
    customerImpact: 'MEDIUM',
    revenueImpact: 'MEDIUM',
  },
  'Job scheduling and labour allocation': {
    frequency: 'DAILY',
    systems: ['Asana', 'Spreadsheets'],
    customerImpact: 'MEDIUM',
    revenueImpact: 'MEDIUM',
  },
  'Planned maintenance visit reporting': {
    frequency: 'WEEKLY',
    systems: ['Microsoft 365', 'SharePoint'],
    customerImpact: 'HIGH',
    revenueImpact: 'MEDIUM',
  },
  'Health and safety documentation': {
    frequency: 'WEEKLY',
    systems: ['SharePoint'],
    customerImpact: 'LOW',
    revenueImpact: 'NONE',
  },
  'Re-keying approved quotes into the job scheduling system': {
    frequency: 'WEEKLY',
    systems: ['HubSpot', 'Asana'],
    customerImpact: 'LOW',
    revenueImpact: 'LOW',
  },
};

const DOCUMENTS: { fileName: string; content: string }[] = [
  {
    fileName: 'SOP-quote-preparation.md',
    content: `Standard Operating Procedure: Quote Preparation and Pricing

Purpose: To produce an accurate priced quotation from a completed site survey.
Scope: All commercial roofing enquiries over £5,000.
Owner: Estimating Manager

Trigger: A completed site survey is uploaded to SharePoint by the surveyor.

Step 1. The estimator downloads the survey notes and photographs from SharePoint.
Step 2. Measurements are read from the surveyor's tablet notes and typed into the pricing workbook.
Step 3. The estimator selects the appropriate build-up from the materials sheet.
Step 4. Current supplier pricing is checked against the latest price list.
Step 5. Labour is estimated using the day-rate table.
Step 6. Access and scaffolding costs are added.
Step 7. The draft quote is reviewed by a second estimator.
Step 8. The quote is produced as a PDF and emailed to the customer.
Step 9. The quote is logged in HubSpot against the deal record.

Timing: The full process takes 4 to 6 hours of estimator time per quote. Current
turnaround from survey to issued quote averages 9 days against a target of 2 days.

Known issues: Measurements are transposed incorrectly between the tablet notes and
the pricing workbook on a regular basis. Error rate is approximately 8%. Where a
quote is under-priced the difference is absorbed on the job.

Volume: Approximately 45 enquiries per month. Conversion rate 22%.
`,
  },
  {
    fileName: 'finance-invoice-process.md',
    content: `Process Documentation: Supplier Invoice Processing

Owner: Finance Manager
Trigger: Supplier invoices arrive by email to accounts@northgateroofing.example

Step 1. The finance assistant opens each invoice PDF.
Step 2. Supplier name, invoice number, date, net, VAT and gross are typed into Sage.
Step 3. The invoice is matched to a purchase order where one exists.
Step 4. The invoice is coded to a job number.
Step 5. The PDF is filed in SharePoint under the supplier folder.

Volume: Approximately 340 invoices per month.
Timing: 16 hours per week of finance assistant time.
Error rate: 4% require correction, usually a mis-keyed job number.

Known issues: Invoices are frequently entered up to a fortnight late, which makes
the cash position report unreliable for management purposes.
`,
  },
  {
    fileName: 'customer-faq.md',
    content: `Customer FAQ — Frequently Asked Questions

How do I get a quote?
Contact our office and we will arrange a site survey, usually within five working days.

How long does a quote take?
We aim to issue quotes within two working days of the survey.

What happens if it rains during my installation?
Work is paused and rescheduled. We will contact you to agree a revised date.

What guarantee do you provide?
All flat roof installations carry a 20 year manufacturer guarantee and a 10 year
workmanship guarantee.

How do I check on the progress of my job?
Contact the office and we will check with the site manager.

Do you carry out planned maintenance?
Yes. We offer annual and biannual planned maintenance contracts including gutter
clearance, inspection and minor repairs.
`,
  },
];

async function main() {
  console.log('Seeding Clarity demo data…');

  // --- clean -------------------------------------------------------------
  await prisma.$transaction([
    prisma.kpiResult.deleteMany(),
    prisma.kpi.deleteMany(),
    prisma.aIReview.deleteMany(),
    prisma.aIImplementation.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.projectFile.deleteMany(),
    prisma.task.deleteMany(),
    prisma.milestone.deleteMany(),
    prisma.project.deleteMany(),
    prisma.roadmapItem.deleteMany(),
    prisma.roadmap.deleteMany(),
    prisma.opportunityCalculation.deleteMany(),
    prisma.aIOpportunity.deleteMany(),
    prisma.report.deleteMany(),
    prisma.discoveryCycle.deleteMany(),
    prisma.problem.deleteMany(),
    prisma.objective.deleteMany(),
    prisma.processStep.deleteMany(),
    prisma.process.deleteMany(),
    prisma.documentChunk.deleteMany(),
    prisma.document.deleteMany(),
    prisma.businessSystem.deleteMany(),
    prisma.integration.deleteMany(),
    prisma.interviewTurn.deleteMany(),
    prisma.interviewSession.deleteMany(),
    prisma.assessmentAnswer.deleteMany(),
    prisma.assessmentQuestion.deleteMany(),
    prisma.assessment.deleteMany(),
    prisma.knowledgeModelVersion.deleteMany(),
    prisma.businessProfile.deleteMany(),
    prisma.employee.deleteMany(),
    prisma.department.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.session.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.aIGenerationLog.deleteMany(),
    prisma.organisation.deleteMany(),
    prisma.user.deleteMany(),
    prisma.pricingPlan.deleteMany(),
    prisma.aIModelConfig.deleteMany(),
  ]);

  // --- plans -------------------------------------------------------------
  const [starter, growth] = await Promise.all([
    prisma.pricingPlan.create({
      data: {
        name: 'Starter',
        monthlyPrice: 149,
        maxUsers: 5,
        maxDocuments: 50,
        features: stringify(['AI business assessment', 'Opportunity report', 'Roadmap']),
      },
    }),
    prisma.pricingPlan.create({
      data: {
        name: 'Growth',
        monthlyPrice: 399,
        maxUsers: 25,
        maxDocuments: 500,
        features: stringify([
          'Everything in Starter',
          'Implementation workspace',
          'KPI tracking and performance reviews',
          'Consultant review',
          'Continuous discovery',
        ]),
      },
    }),
  ]);

  // --- users -------------------------------------------------------------
  const passwordHash = await hash(DEMO_PASSWORD);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@clarity.example',
      name: 'Priya Raman',
      jobTitle: 'Platform administrator',
      passwordHash,
      platformRole: 'PLATFORM_ADMIN',
    },
  });

  const owner = await prisma.user.create({
    data: {
      email: 'owner@northgateroofing.example',
      name: 'David Whitfield',
      jobTitle: 'Managing Director',
      passwordHash,
    },
  });

  const employee = await prisma.user.create({
    data: {
      email: 'estimator@northgateroofing.example',
      name: 'Sam Okafor',
      jobTitle: 'Estimating Manager',
      passwordHash,
    },
  });

  const consultant = await prisma.user.create({
    data: {
      email: 'consultant@clarity.example',
      name: 'Ellen Marsh',
      jobTitle: 'AI Implementation Consultant',
      passwordHash,
    },
  });

  // --- organisation ------------------------------------------------------
  const org = await prisma.organisation.create({
    data: {
      name: 'Northgate Roofing Ltd',
      slug: 'northgate-roofing',
      planId: growth.id,
      memberships: {
        create: [
          { userId: owner.id, role: 'OWNER' },
          { userId: employee.id, role: 'EMPLOYEE' },
          { userId: consultant.id, role: 'CONSULTANT' },
        ],
      },
    },
  });

  // A second, near-empty client so the consultant view has more than one row.
  const secondOrg = await prisma.organisation.create({
    data: {
      name: 'Halden Dental Group',
      slug: 'halden-dental',
      planId: starter.id,
      memberships: { create: [{ userId: consultant.id, role: 'CONSULTANT' }] },
    },
  });
  await prisma.businessProfile.create({
    data: {
      organisationId: secondOrg.id,
      industry: 'Healthcare & medical',
      companySize: '10-49',
      employeeCount: 28,
    },
  });
  await prisma.assessment.create({
    data: { organisationId: secondOrg.id, name: 'AI Business Assessment', progress: 0.15 },
  });

  console.log('  organisations created');

  // --- assessment --------------------------------------------------------
  await prisma.businessProfile.create({ data: { organisationId: org.id } });

  const assessment = await prisma.assessment.create({
    data: {
      organisationId: org.id,
      name: 'AI Business Assessment',
      assignedToId: owner.id,
      status: 'COMPLETE',
      completedAt: new Date(),
    },
  });

  const template = getTemplate(assessment.templateKey);
  for (const section of template.sections) {
    for (const question of section.questions) {
      const value = ASSESSMENT_ANSWERS[question.key];
      if (value === undefined) continue;

      const record = await prisma.assessmentQuestion.create({
        data: {
          id: `${assessment.id}:${question.key}`,
          assessmentId: assessment.id,
          section: section.key,
          businessArea: question.businessArea,
          key: question.key,
          prompt: question.prompt,
          helpText: question.helpText,
          inputType: question.inputType,
          options: stringify(question.options ?? []),
          required: question.required ?? false,
        },
      });

      await prisma.assessmentAnswer.create({
        data: {
          assessmentId: assessment.id,
          questionId: record.id,
          questionKey: question.key,
          value: stringify(value),
          answeredById: owner.id,
          source: 'USER',
          confidence: 'HIGH',
        },
      });
    }
  }

  await prisma.assessment.update({
    where: { id: assessment.id },
    data: { progress: computeProgress(template, ASSESSMENT_ANSWERS) },
  });

  await applyAssessmentAnswers(org.id, ASSESSMENT_ANSWERS);
  await snapshotKnowledgeModel(org.id, 'ASSESSMENT', 'Assessment completed.');
  console.log('  assessment answers applied');

  // --- documents ---------------------------------------------------------
  const storageDir = join(process.env.FILE_STORAGE_DIR ?? './storage', org.id);
  await mkdir(storageDir, { recursive: true });

  for (const doc of DOCUMENTS) {
    const storagePath = join(storageDir, doc.fileName);
    await writeFile(storagePath, doc.content, 'utf8');

    const record = await prisma.document.create({
      data: {
        organisationId: org.id,
        fileName: doc.fileName,
        mimeType: 'text/markdown',
        sizeBytes: Buffer.byteLength(doc.content),
        storagePath,
        uploadedById: owner.id,
      },
    });

    const outcome = await processDocument(record.id, org.id);
    console.log(`  document ${doc.fileName}: ${outcome.status}, ${outcome.chunkCount} passages, ${outcome.factCount} facts`);
  }
  await snapshotKnowledgeModel(org.id, 'DOCUMENT', `${DOCUMENTS.length} documents processed.`);

  // --- interview ---------------------------------------------------------
  const interview = await prisma.interviewSession.create({
    data: { organisationId: org.id, roundsRun: 1, status: 'SUFFICIENT', stopReason: 'Enough information gathered to produce a reliable assessment.' },
  });

  const processes = await prisma.process.findMany({ where: { organisationId: org.id } });
  let order = 0;

  for (const process of processes) {
    const hours = PROCESS_HOURS[process.name];
    if (hours === undefined) continue;

    await prisma.interviewTurn.create({
      data: {
        sessionId: interview.id,
        question: `Across everyone involved, how many hours a week does "${process.name}" take?`,
        reasonForQuestion: `"${process.name}" is recorded as a process but has no time against it, so the platform cannot tell whether it is worth automating. This converts it into an annual hours figure.`,
        businessArea: 'operations',
        targetField: `process:${process.id}:hoursPerWeek`,
        inputType: 'NUMBER',
        answer: String(hours),
        answeredAt: new Date(),
        confidence: 'HIGH',
        round: 1,
        order: order++,
      },
    });
    await applyInterviewAnswer(org.id, `process:${process.id}:hoursPerWeek`, String(hours));

    const extras = PROCESS_EXTRAS[process.name];
    if (extras) {
      await prisma.process.update({
        where: { id: process.id },
        data: {
          frequency: extras.frequency,
          systemsUsed: stringify(extras.systems),
          customerImpact: extras.customerImpact,
          revenueImpact: extras.revenueImpact,
          errorRate: extras.errorRate ?? null,
          confidence: 'HIGH',
        },
      });
    }
  }

  // A low-volume process, so the engine has something to correctly decline.
  await prisma.process.create({
    data: {
      organisationId: org.id,
      name: 'Annual insurance renewal',
      description: 'Renewing the company insurance policies once a year.',
      frequency: 'ANNUAL',
      hoursPerWeek: 0.2,
      manualScore: 4,
      repetitivenessScore: 2,
      dataReadiness: 2,
      riskLevel: 'MEDIUM',
      customerImpact: 'NONE',
      revenueImpact: 'NONE',
      systemsUsed: stringify(['Microsoft 365']),
      source: 'ASSESSMENT',
      confidence: 'HIGH',
    },
  });

  await snapshotKnowledgeModel(org.id, 'INTERVIEW', 'Interview answers recorded against processes.');
  console.log('  interview answers applied');

  // --- full analysis -----------------------------------------------------
  const analysis = await runFullAnalysis(org.id, owner.id);
  console.log(
    `  analysis: ${analysis.opportunitiesCreated} opportunities created, ${analysis.notRecommended} not recommended, report ${analysis.reportId}`,
  );
  for (const warning of analysis.warnings) console.log(`    note: ${warning}`);

  // --- consultant review and client approval -----------------------------
  const top = await prisma.aIOpportunity.findFirst({
    where: {
      organisationId: org.id,
      recommendation: { notIn: ['NOT_RECOMMENDED', 'DO_NOTHING'] },
    },
    orderBy: { priorityScore: 'desc' },
  });

  if (!top) throw new Error('Seed expected at least one recommended opportunity');

  await prisma.aIOpportunity.update({
    where: { id: top.id },
    data: {
      status: 'CLIENT_APPROVED',
      editedByConsultant: true,
      consultantNotes:
        'Reviewed with David. Agreed this is the right first project: it is the constraint on the whole business, and the pricing workbook is the one thing that must not be replaced in phase one.',
      clientDecisionNote: 'Approved at the board meeting. Sam to own it.',
    },
  });
  await prisma.roadmapItem.updateMany({
    where: { opportunityId: top.id },
    data: { clientDecision: 'APPROVED', decidedAt: new Date(), decidedById: owner.id },
  });

  const report = await prisma.report.findFirst({
    where: { organisationId: org.id },
    orderBy: { createdAt: 'desc' },
  });
  if (report) {
    await prisma.report.update({
      where: { id: report.id },
      data: {
        status: 'PUBLISHED',
        approvedById: consultant.id,
        approvedAt: new Date(),
        publishedAt: new Date(),
        consultantEdits: stringify({
          'next-steps':
            'Agreed with the board on 14 March: we start with quote preparation only. Invoice processing is deferred to phase two so the finance team is not absorbing two changes at once.',
        }),
      },
    });
  }

  // --- implementation project -------------------------------------------
  const km = await buildKnowledgeModel(org.id);
  const { plan } = await buildImplementationPlan(
    {
      name: top.name,
      currentProblem: top.currentProblem,
      proposedSolution: top.proposedSolution,
      aiCategory: top.aiCategory,
      implementationComplexity: top.implementationComplexity,
      riskLevel: top.riskLevel,
      humanOversight: top.humanOversight,
      dependencies: parseJson<Dependencies>(top.dependencies, {
        data: [], software: [], apis: [], integrations: [], training: [], security: [], policies: [],
      }),
    },
    km,
  );

  const started = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000);
  const calculation = await prisma.opportunityCalculation.findUnique({ where: { opportunityId: top.id } });

  const project = await prisma.project.create({
    data: {
      organisationId: org.id,
      opportunityId: top.id,
      name: top.name,
      objective: plan.objective,
      scope: plan.scope,
      ownerUserId: employee.id,
      aiTechnology: plan.aiTechnology,
      integrations: stringify(plan.integrations),
      dataRequirements: plan.dataRequirements,
      securityRequirements: plan.securityRequirements,
      testingRequirements: plan.testingRequirements,
      launchRequirements: plan.launchRequirements,
      trainingRequirements: plan.trainingRequirements,
      humanOversight: plan.humanOversight,
      monitoringRequirements: plan.monitoringRequirements,
      stage: 'MONITORING',
      health: 'ON_TRACK',
      budget: calculation?.implementationCostHigh ?? null,
      spend: calculation?.implementationCostLow ?? null,
      startDate: started,
      targetDate: new Date(started.getTime() + plan.estimatedWeeks * 7 * 24 * 60 * 60 * 1000),
      milestones: {
        create: plan.milestones.map((m, index) => ({
          name: m.name,
          stage: m.stage,
          order: index,
          dueDate: new Date(started.getTime() + m.weekOffset * 7 * 24 * 60 * 60 * 1000),
          // Everything up to launch is done; monitoring is in progress.
          completedAt:
            m.stage === 'MONITORING'
              ? null
              : new Date(started.getTime() + m.weekOffset * 7 * 24 * 60 * 60 * 1000),
        })),
      },
      tasks: {
        create: plan.tasks.map((t, index) => ({
          title: t.title,
          description: t.description,
          stage: t.stage,
          priority: t.priority,
          order: index,
          assigneeId: index % 3 === 0 ? employee.id : index % 3 === 1 ? owner.id : consultant.id,
          status: ['MONITORING', 'OPTIMISATION'].includes(t.stage) ? 'IN_PROGRESS' : 'DONE',
          completedAt: ['MONITORING', 'OPTIMISATION'].includes(t.stage) ? null : new Date(),
        })),
      },
      comments: {
        create: [
          {
            authorId: consultant.id,
            body: 'Pilot finished on Friday. Eight of the ten test quotes came back within tolerance; the two that did not were both unusual access situations, which we expected. Recommend we go live with estimator approval on every quote.',
          },
          {
            authorId: employee.id,
            body: 'Agreed. The team is comfortable with it now. The time saving is real but it is smaller than the projection because we still read every line before it goes out — which I think is the right call.',
          },
        ],
      },
    },
  });

  await prisma.kpi.updateMany({
    where: { organisationId: org.id, opportunityId: top.id },
    data: { projectId: project.id },
  });

  const implementation = await prisma.aIImplementation.create({
    data: {
      organisationId: org.id,
      opportunityId: top.id,
      name: top.name,
      technology: plan.aiTechnology,
      status: 'LIVE',
      goLiveDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      oversightModel: plan.humanOversight,
    },
  });

  await prisma.aIOpportunity.update({ where: { id: top.id }, data: { status: 'LIVE' } });

  // --- real KPI results, deliberately short of projection ----------------
  const kpis = await prisma.kpi.findMany({ where: { organisationId: org.id, opportunityId: top.id } });

  for (const kpi of kpis) {
    if (kpi.baselineValue === null || kpi.projectedValue === null) continue;

    // Two months of results that land at roughly 60-80% of the projection.
    for (let monthsAgo = 2; monthsAgo >= 1; monthsAgo--) {
      const periodStart = new Date();
      periodStart.setMonth(periodStart.getMonth() - monthsAgo, 1);
      periodStart.setHours(0, 0, 0, 0);
      const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0, 23, 59, 59);

      const share = monthsAgo === 2 ? 0.55 : 0.78;
      const actual = kpi.baselineValue + (kpi.projectedValue - kpi.baselineValue) * share;

      await prisma.kpiResult.create({
        data: {
          kpiId: kpi.id,
          periodStart,
          periodEnd,
          actualValue: Math.round(actual * 10) / 10,
          note: monthsAgo === 2 ? 'First full month after launch.' : 'Adoption improving as the team settles in.',
          recordedById: employee.id,
        },
      });
    }
  }

  // --- performance review ------------------------------------------------
  const kpisWithResults = await prisma.kpi.findMany({
    where: { organisationId: org.id, opportunityId: top.id },
    include: { results: true },
  });

  const comparisons = compareKpis(
    kpisWithResults.map((k) => ({
      name: k.name,
      metricKey: k.metricKey,
      unit: k.unit,
      direction: k.direction,
      baselineValue: k.baselineValue,
      projectedValue: k.projectedValue,
      results: k.results.map((r) => ({ actualValue: r.actualValue, periodEnd: r.periodEnd })),
    })),
  );

  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1, 1);
  const { review } = await reviewPerformance(
    org.id,
    implementation.name,
    comparisons,
    lastMonth.toLocaleString('en-GB', { month: 'long', year: 'numeric' }),
  );

  await prisma.aIReview.create({
    data: {
      organisationId: org.id,
      implementationId: implementation.id,
      periodStart: lastMonth,
      periodEnd: new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0),
      projected: stringify(Object.fromEntries(comparisons.map((c) => [c.name, c.projected]))),
      actual: stringify(Object.fromEntries(comparisons.map((c) => [c.name, c.actual]))),
      variance: stringify(Object.fromEntries(comparisons.map((c) => [c.name, c.attainment]))),
      verdict: review.verdict,
      narrative: review.narrative,
      recommendations: stringify(review.recommendations),
    },
  });

  // --- integration + model config ---------------------------------------
  await prisma.integration.create({
    data: { organisationId: org.id, provider: 'MANUAL_SYSTEMS', status: 'CONNECTED' },
  });

  await prisma.aIModelConfig.createMany({
    data: [
      { key: 'analysis', label: 'Analysis agents', modelId: 'claude-opus-5', maxTokens: 16000 },
      { key: 'report', label: 'Report agent', modelId: 'claude-opus-5', maxTokens: 12000 },
      { key: 'interview', label: 'Interview agent', modelId: 'claude-opus-5', maxTokens: 8000 },
    ],
  });

  await prisma.auditLog.create({
    data: {
      organisationId: org.id,
      userId: admin.id,
      action: 'seed.complete',
      metadata: stringify({ opportunities: analysis.opportunitiesCreated }),
    },
  });

  console.log('\nSeed complete.\n');
  console.log('  Sign in with any of these (password: %s)', DEMO_PASSWORD);
  console.log('    owner@northgateroofing.example       Business owner');
  console.log('    estimator@northgateroofing.example   Business employee');
  console.log('    consultant@clarity.example           AI consultant');
  console.log('    admin@clarity.example                Platform administrator');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
