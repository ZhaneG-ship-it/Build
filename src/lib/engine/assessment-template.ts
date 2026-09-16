/**
 * Core AI Readiness Assessment (§4).
 *
 * Declared as data rather than code so a platform administrator can version and
 * edit it (see /admin/templates). Question `key`s are stable identifiers that
 * the ingest step maps onto the Business Knowledge Model, so renaming a prompt
 * never breaks the analysis.
 *
 * `dependsOn` drives the branching that stops every company being asked the
 * same questions (§3): a question only appears when its condition is met.
 */

export type InputType =
  | 'TEXT'
  | 'LONGTEXT'
  | 'NUMBER'
  | 'CURRENCY'
  | 'PERCENT'
  | 'SELECT'
  | 'MULTISELECT'
  | 'BOOLEAN'
  | 'SCALE'
  | 'LIST';

export interface DependsOnRule {
  questionKey: string;
  equals?: string | boolean;
  includes?: string;
  gt?: number;
  isAnswered?: boolean;
}

export interface TemplateQuestion {
  key: string;
  prompt: string;
  helpText?: string;
  inputType: InputType;
  options?: string[];
  required?: boolean;
  businessArea: string;
  dependsOn?: DependsOnRule;
}

export interface TemplateSection {
  key: string;
  name: string;
  description: string;
  questions: TemplateQuestion[];
}

export interface AssessmentTemplateDefinition {
  key: string;
  name: string;
  description: string;
  version: number;
  sections: TemplateSection[];
}

export const INDUSTRIES = [
  'Accounting & finance', 'Architecture & design', 'Automotive', 'Construction',
  'Consulting & professional services', 'Education & training', 'Energy & utilities',
  'Engineering & manufacturing', 'Estate agency & property', 'Food & beverage',
  'Healthcare & medical', 'Hospitality & tourism', 'Insurance', 'Legal services',
  'Logistics & transport', 'Marketing & creative', 'Non-profit & charity',
  'Recruitment & HR services', 'Retail & e-commerce', 'Software & technology',
  'Trades & field services', 'Wholesale & distribution', 'Other',
];

export const CORE_ASSESSMENT: AssessmentTemplateDefinition = {
  key: 'core-ai-readiness',
  name: 'AI Business Assessment',
  description:
    'Builds the picture of how your business runs today: operations, people, technology, money and risk. Everything the platform later recommends is traced back to an answer here.',
  version: 1,
  sections: [
    // -----------------------------------------------------------------------
    {
      key: 'business',
      name: 'The business',
      description: 'What the company does, who it serves and where it wants to get to.',
      questions: [
        {
          key: 'company.industry',
          prompt: 'Which industry best describes the business?',
          inputType: 'SELECT',
          options: INDUSTRIES,
          required: true,
          businessArea: 'company',
        },
        {
          key: 'company.subIndustry',
          prompt: 'How would you describe your specific niche within that industry?',
          helpText: 'For example "commercial roofing" rather than simply "construction".',
          inputType: 'TEXT',
          businessArea: 'company',
        },
        {
          key: 'company.companySize',
          prompt: 'How many people work in the business?',
          inputType: 'SELECT',
          options: ['1-9', '10-49', '50-249', '250-999', '1000+'],
          required: true,
          businessArea: 'company',
        },
        {
          key: 'company.employeeCount',
          prompt: 'Exactly how many employees are there?',
          inputType: 'NUMBER',
          required: true,
          businessArea: 'company',
        },
        {
          key: 'company.locations',
          prompt: 'Which locations does the business operate from?',
          helpText: 'One per line.',
          inputType: 'LIST',
          businessArea: 'company',
        },
        {
          key: 'company.website',
          prompt: 'What is the company website?',
          inputType: 'TEXT',
          businessArea: 'company',
        },
        {
          key: 'company.businessModel',
          prompt: 'Who does the business sell to?',
          inputType: 'SELECT',
          options: ['B2B', 'B2C', 'B2B2C', 'MARKETPLACE', 'OTHER'],
          required: true,
          businessArea: 'company',
        },
        {
          key: 'company.productsServices',
          prompt: 'What does the business actually sell?',
          helpText: 'The main products or services, in plain terms.',
          inputType: 'LONGTEXT',
          required: true,
          businessArea: 'company',
        },
        {
          key: 'company.targetCustomers',
          prompt: 'Who are your typical customers?',
          inputType: 'LONGTEXT',
          businessArea: 'company',
        },
        {
          key: 'company.departments',
          prompt: 'Which departments or teams exist?',
          helpText: 'One per line, for example: Sales, Operations, Finance.',
          inputType: 'LIST',
          required: true,
          businessArea: 'company',
        },
        {
          key: 'company.annualTurnover',
          prompt: 'What is the approximate annual turnover?',
          helpText: 'Used to size opportunities proportionately. An approximate figure is fine.',
          inputType: 'CURRENCY',
          businessArea: 'financial',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      key: 'strategy',
      name: 'Goals and problems',
      description: 'Where the business is trying to get to, and what is currently in the way.',
      questions: [
        {
          key: 'strategy.biggestGoals',
          prompt: 'What are the company’s biggest goals over the next 12 to 24 months?',
          inputType: 'LONGTEXT',
          required: true,
          businessArea: 'strategy',
        },
        {
          key: 'strategy.biggestProblems',
          prompt: 'What are the company’s biggest problems right now?',
          inputType: 'LONGTEXT',
          required: true,
          businessArea: 'strategy',
        },
        {
          key: 'strategy.growthLimiters',
          prompt: 'What is currently limiting growth?',
          helpText: 'For example: not enough leads, not enough capacity, cash, recruitment.',
          inputType: 'LONGTEXT',
          businessArea: 'strategy',
        },
        {
          key: 'strategy.objectives',
          prompt: 'List the specific objectives you are working towards.',
          helpText: 'One per line. For example "Cut quote turnaround to 24 hours".',
          inputType: 'LIST',
          businessArea: 'strategy',
        },
        {
          key: 'strategy.aiAmbition',
          prompt: 'What would you like AI to achieve for the business?',
          helpText: 'If you are not sure, say so — that is a perfectly normal answer.',
          inputType: 'LONGTEXT',
          businessArea: 'ai',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      key: 'operations',
      name: 'How the work gets done',
      description:
        'The most important section. The platform can only find opportunities in processes it knows about.',
      questions: [
        {
          key: 'ops.coreProcesses',
          prompt: 'What are the core processes that keep the business running?',
          helpText:
            'One per line. Think of the path from an enquiry arriving to the job being delivered and paid for.',
          inputType: 'LIST',
          required: true,
          businessArea: 'operations',
        },
        {
          key: 'ops.repetitiveTasks',
          prompt: 'Which tasks are done over and over again, the same way each time?',
          helpText: 'One per line. These are usually the strongest automation candidates.',
          inputType: 'LIST',
          required: true,
          businessArea: 'operations',
        },
        {
          key: 'ops.manualTasks',
          prompt: 'Which tasks involve people rekeying or copying information between systems?',
          helpText: 'One per line.',
          inputType: 'LIST',
          businessArea: 'operations',
        },
        {
          key: 'ops.timeSinks',
          prompt: 'Where do employees spend the most time?',
          inputType: 'LONGTEXT',
          required: true,
          businessArea: 'operations',
        },
        {
          key: 'ops.bottlenecks',
          prompt: 'Where does work pile up or get stuck?',
          inputType: 'LONGTEXT',
          businessArea: 'operations',
        },
        {
          key: 'ops.delays',
          prompt: 'Where do delays happen, and what causes them?',
          inputType: 'LONGTEXT',
          businessArea: 'operations',
        },
        {
          key: 'ops.errors',
          prompt: 'Where do mistakes happen, and what do they cost when they do?',
          inputType: 'LONGTEXT',
          businessArea: 'operations',
        },
        {
          key: 'ops.adminHoursPerWeek',
          prompt: 'Across the whole business, roughly how many hours a week go on administration?',
          helpText: 'A considered estimate is genuinely useful here.',
          inputType: 'NUMBER',
          businessArea: 'operations',
        },
        {
          key: 'ops.customerEnquiryVolume',
          prompt: 'Roughly how many customer enquiries arrive each month?',
          inputType: 'NUMBER',
          businessArea: 'operations',
          dependsOn: { questionKey: 'company.businessModel', isAnswered: true },
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      key: 'people',
      name: 'People',
      description: 'Who does the work, and how much of their time goes on repetitive tasks.',
      questions: [
        {
          key: 'people.repetitiveHoursPerPerson',
          prompt: 'On average, how many hours a week does one employee spend on repetitive work?',
          inputType: 'NUMBER',
          required: true,
          businessArea: 'people',
        },
        {
          key: 'people.aiLiteracy',
          prompt: 'How comfortable is the team with AI tools today?',
          inputType: 'SELECT',
          options: ['NONE', 'BASIC', 'CONFIDENT', 'ADVANCED'],
          required: true,
          businessArea: 'people',
        },
        {
          key: 'people.trainingNeeds',
          prompt: 'What training would the team need to adopt new tools successfully?',
          inputType: 'LONGTEXT',
          businessArea: 'people',
        },
        {
          key: 'people.changeAppetite',
          prompt: 'How does the team usually react to new systems?',
          inputType: 'SELECT',
          options: ['Resistant', 'Cautious', 'Open', 'Enthusiastic'],
          businessArea: 'people',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      key: 'technology',
      name: 'Systems',
      description: 'What the business runs on today. Integration options depend on this.',
      questions: [
        {
          key: 'tech.categories',
          prompt: 'Which kinds of systems does the business use?',
          inputType: 'MULTISELECT',
          options: [
            'CRM', 'ERP', 'ACCOUNTING', 'HR', 'EMAIL', 'STORAGE',
            'PROJECT_MGMT', 'ECOMMERCE', 'WEBSITE', 'INDUSTRY', 'SPREADSHEET',
          ],
          required: true,
          businessArea: 'technology',
        },
        {
          key: 'tech.crm',
          prompt: 'Which CRM do you use?',
          inputType: 'TEXT',
          businessArea: 'technology',
          dependsOn: { questionKey: 'tech.categories', includes: 'CRM' },
        },
        {
          key: 'tech.erp',
          prompt: 'Which ERP system do you use?',
          inputType: 'TEXT',
          businessArea: 'technology',
          dependsOn: { questionKey: 'tech.categories', includes: 'ERP' },
        },
        {
          key: 'tech.accounting',
          prompt: 'Which accounting software do you use?',
          inputType: 'TEXT',
          businessArea: 'technology',
          dependsOn: { questionKey: 'tech.categories', includes: 'ACCOUNTING' },
        },
        {
          key: 'tech.hr',
          prompt: 'Which HR system do you use?',
          inputType: 'TEXT',
          businessArea: 'technology',
          dependsOn: { questionKey: 'tech.categories', includes: 'HR' },
        },
        {
          key: 'tech.projectManagement',
          prompt: 'Which project management tool do you use?',
          inputType: 'TEXT',
          businessArea: 'technology',
          dependsOn: { questionKey: 'tech.categories', includes: 'PROJECT_MGMT' },
        },
        {
          key: 'tech.ecommerce',
          prompt: 'Which e-commerce platform do you use?',
          inputType: 'TEXT',
          businessArea: 'technology',
          dependsOn: { questionKey: 'tech.categories', includes: 'ECOMMERCE' },
        },
        {
          key: 'tech.industrySoftware',
          prompt: 'Which industry-specific software do you rely on?',
          inputType: 'TEXT',
          businessArea: 'technology',
          dependsOn: { questionKey: 'tech.categories', includes: 'INDUSTRY' },
        },
        {
          key: 'tech.spreadsheetUse',
          prompt: 'What do you still run on spreadsheets?',
          helpText: 'Spreadsheets holding a critical process are often the clearest opportunity.',
          inputType: 'LONGTEXT',
          businessArea: 'technology',
          dependsOn: { questionKey: 'tech.categories', includes: 'SPREADSHEET' },
        },
        {
          key: 'tech.otherSystems',
          prompt: 'Any other systems worth knowing about?',
          helpText: 'One per line.',
          inputType: 'LIST',
          businessArea: 'technology',
        },
        {
          key: 'tech.dataQuality',
          prompt: 'How good is the data in those systems?',
          helpText: '1 = scattered and unreliable, 5 = clean, consistent and trusted.',
          inputType: 'SCALE',
          required: true,
          businessArea: 'technology',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      key: 'ai',
      name: 'AI today',
      description: 'Where the business already stands with AI.',
      questions: [
        {
          key: 'ai.currentUsage',
          prompt: 'Is the business using AI in any form today?',
          inputType: 'SELECT',
          options: ['Not at all', 'A few people experimenting', 'Used in one area', 'Used across several areas'],
          required: true,
          businessArea: 'ai',
        },
        {
          key: 'ai.tools',
          prompt: 'Which AI tools are in use?',
          helpText: 'One per line.',
          inputType: 'LIST',
          businessArea: 'ai',
          dependsOn: { questionKey: 'ai.currentUsage', isAnswered: true },
        },
        {
          key: 'ai.whatWorked',
          prompt: 'What has worked well, and what has not?',
          inputType: 'LONGTEXT',
          businessArea: 'ai',
          dependsOn: { questionKey: 'ai.currentUsage', isAnswered: true },
        },
        {
          key: 'ai.automationAppetite',
          prompt: 'How much automation is the business comfortable with?',
          inputType: 'SELECT',
          options: ['LOW', 'MEDIUM', 'HIGH'],
          required: true,
          businessArea: 'ai',
        },
        {
          key: 'ai.oversightPreference',
          prompt: 'How much human oversight should AI have?',
          helpText:
            'In the loop: a person approves every output. On the loop: a person monitors and can intervene.',
          inputType: 'SELECT',
          options: ['HUMAN_IN_LOOP', 'HUMAN_ON_LOOP', 'AUTONOMOUS'],
          required: true,
          businessArea: 'ai',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      key: 'financial',
      name: 'The numbers',
      description:
        'These figures are what turn an opinion into an estimate. Without them the platform will say so rather than guess.',
      questions: [
        {
          key: 'fin.avgHourlyLabourCost',
          prompt: 'What does an hour of employee time cost the business?',
          helpText:
            'Fully loaded: salary, employer contributions and overheads. If unsure, take the average salary, add about 25%, and divide by 1,760.',
          inputType: 'CURRENCY',
          required: true,
          businessArea: 'financial',
        },
        {
          key: 'fin.avgSalary',
          prompt: 'What is the average salary in the business?',
          inputType: 'CURRENCY',
          businessArea: 'financial',
        },
        {
          key: 'fin.avgCustomerValue',
          prompt: 'What is an average customer worth?',
          helpText: 'Either the average order value or the lifetime value — whichever you think in.',
          inputType: 'CURRENCY',
          businessArea: 'financial',
        },
        {
          key: 'fin.monthlyLeadVolume',
          prompt: 'How many leads or enquiries arrive each month?',
          inputType: 'NUMBER',
          businessArea: 'financial',
        },
        {
          key: 'fin.conversionRate',
          prompt: 'What percentage of those leads become customers?',
          inputType: 'PERCENT',
          businessArea: 'financial',
          dependsOn: { questionKey: 'fin.monthlyLeadVolume', isAnswered: true },
        },
        {
          key: 'fin.operatingCosts',
          prompt: 'What are the annual operating costs?',
          inputType: 'CURRENCY',
          businessArea: 'financial',
        },
        {
          key: 'fin.aiBudget',
          prompt: 'What could the business realistically invest in AI over the next year?',
          helpText: 'A range is fine. This shapes what gets recommended first.',
          inputType: 'CURRENCY',
          required: true,
          businessArea: 'financial',
        },
      ],
    },

    // -----------------------------------------------------------------------
    {
      key: 'risk',
      name: 'Risk and governance',
      description: 'What AI must not be allowed to do, and what it must be careful with.',
      questions: [
        {
          key: 'risk.sensitiveData',
          prompt: 'Does the business handle personal, financial or otherwise sensitive data?',
          inputType: 'BOOLEAN',
          required: true,
          businessArea: 'risk',
        },
        {
          key: 'risk.regulations',
          prompt: 'Which regulations apply to the business?',
          inputType: 'MULTISELECT',
          options: ['UK GDPR', 'EU GDPR', 'FCA', 'HIPAA', 'PCI DSS', 'ISO 27001', 'CQC', 'SRA', 'Other', 'None'],
          businessArea: 'risk',
        },
        {
          key: 'risk.securityConcerns',
          prompt: 'What security or privacy concerns would you have about using AI?',
          inputType: 'LONGTEXT',
          businessArea: 'risk',
          dependsOn: { questionKey: 'risk.sensitiveData', equals: true },
        },
        {
          key: 'risk.noAutonomy',
          prompt: 'Which decisions must always be made by a person?',
          helpText:
            'Be specific. Anything named here will be excluded from autonomous automation in every recommendation.',
          inputType: 'LONGTEXT',
          required: true,
          businessArea: 'risk',
        },
      ],
    },
  ],
};

export const TEMPLATES: Record<string, AssessmentTemplateDefinition> = {
  [CORE_ASSESSMENT.key]: CORE_ASSESSMENT,
};

export function getTemplate(key: string): AssessmentTemplateDefinition {
  return TEMPLATES[key] ?? CORE_ASSESSMENT;
}

export function allQuestions(template: AssessmentTemplateDefinition): TemplateQuestion[] {
  return template.sections.flatMap((s) => s.questions);
}

/** Evaluates a question's `dependsOn` rule against the answers supplied so far. */
export function isQuestionVisible(
  question: TemplateQuestion,
  answers: Record<string, unknown>,
): boolean {
  const rule = question.dependsOn;
  if (!rule) return true;

  const value = answers[rule.questionKey];

  if (rule.isAnswered) {
    return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);
  }
  if (rule.equals !== undefined) return value === rule.equals;
  if (rule.includes !== undefined) {
    return Array.isArray(value) ? value.includes(rule.includes) : value === rule.includes;
  }
  if (rule.gt !== undefined) return typeof value === 'number' && value > rule.gt;
  return true;
}

/** Questions the user should currently see, given their answers so far. */
export function visibleQuestions(
  template: AssessmentTemplateDefinition,
  answers: Record<string, unknown>,
): TemplateQuestion[] {
  return allQuestions(template).filter((q) => isQuestionVisible(q, answers));
}

export function computeProgress(
  template: AssessmentTemplateDefinition,
  answers: Record<string, unknown>,
): number {
  const visible = visibleQuestions(template, answers);
  if (visible.length === 0) return 0;
  const answered = visible.filter((q) => {
    const value = answers[q.key];
    return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);
  });
  return answered.length / visible.length;
}

/** Required questions that are visible but still unanswered. */
export function missingRequired(
  template: AssessmentTemplateDefinition,
  answers: Record<string, unknown>,
): TemplateQuestion[] {
  return visibleQuestions(template, answers).filter((q) => {
    if (!q.required) return false;
    const value = answers[q.key];
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  });
}
