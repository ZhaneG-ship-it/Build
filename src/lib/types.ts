/** Shared domain vocabulary. Stored as strings in SQLite, narrowed here. */

export type PlatformRole = 'USER' | 'PLATFORM_ADMIN';
export type OrgRole = 'OWNER' | 'EMPLOYEE' | 'CONSULTANT';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Level = 'LOW' | 'MEDIUM' | 'HIGH';

export const AI_CATEGORIES = [
  'GENERATIVE_AI',
  'AI_ASSISTANT',
  'AI_AGENT',
  'WORKFLOW_AUTOMATION',
  'DOCUMENT_AI',
  'PREDICTIVE_ANALYTICS',
  'VOICE_AI',
  'COMPUTER_VISION',
  'KNOWLEDGE_MANAGEMENT',
  'AI_CHATBOT',
  'AI_REPORTING',
  'AI_FORECASTING',
  'NOT_RECOMMENDED',
] as const;
export type AiCategory = (typeof AI_CATEGORIES)[number];

export const AI_CATEGORY_LABELS: Record<AiCategory, string> = {
  GENERATIVE_AI: 'Generative AI',
  AI_ASSISTANT: 'AI assistant',
  AI_AGENT: 'AI agent',
  WORKFLOW_AUTOMATION: 'Workflow automation',
  DOCUMENT_AI: 'Document AI',
  PREDICTIVE_ANALYTICS: 'Predictive analytics',
  VOICE_AI: 'Voice AI',
  COMPUTER_VISION: 'Computer vision',
  KNOWLEDGE_MANAGEMENT: 'Knowledge management',
  AI_CHATBOT: 'AI chatbot',
  AI_REPORTING: 'AI reporting',
  AI_FORECASTING: 'AI forecasting',
  NOT_RECOMMENDED: 'No AI recommended',
};

export type Recommendation =
  | 'IMPLEMENT'
  | 'INVESTIGATE'
  | 'DEFER'
  | 'NOT_RECOMMENDED'
  | 'DO_NOTHING';

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  IMPLEMENT: 'Recommended',
  INVESTIGATE: 'Investigate further',
  DEFER: 'Defer',
  NOT_RECOMMENDED: 'AI not recommended',
  DO_NOTHING: 'Do nothing',
};

export const PROJECT_STAGES = [
  'DISCOVERY',
  'REQUIREMENTS',
  'DESIGN',
  'BUILD',
  'TESTING',
  'PILOT',
  'LAUNCH',
  'MONITORING',
  'OPTIMISATION',
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const STAGE_LABELS: Record<ProjectStage, string> = {
  DISCOVERY: 'Discovery',
  REQUIREMENTS: 'Requirements',
  DESIGN: 'Design',
  BUILD: 'Build',
  TESTING: 'Testing',
  PILOT: 'Pilot',
  LAUNCH: 'Launch',
  MONITORING: 'Monitoring',
  OPTIMISATION: 'Optimisation',
};

export const DOCUMENT_CLASSES = [
  'SOP',
  'HANDBOOK',
  'PROCESS_DOC',
  'SPREADSHEET',
  'REPORT',
  'ORG_CHART',
  'CONTRACT',
  'PRODUCT_INFO',
  'FAQ',
  'MARKETING',
  'SALES_SCRIPT',
  'JOB_DESCRIPTION',
  'POLICY',
  'TRAINING',
  'UNCLASSIFIED',
] as const;
export type DocumentClass = (typeof DOCUMENT_CLASSES)[number];

export const DOCUMENT_CLASS_LABELS: Record<DocumentClass, string> = {
  SOP: 'Standard operating procedure',
  HANDBOOK: 'Employee handbook',
  PROCESS_DOC: 'Process documentation',
  SPREADSHEET: 'Spreadsheet',
  REPORT: 'Report',
  ORG_CHART: 'Organisation chart',
  CONTRACT: 'Contract',
  PRODUCT_INFO: 'Product information',
  FAQ: 'Customer FAQ',
  MARKETING: 'Marketing document',
  SALES_SCRIPT: 'Sales script',
  JOB_DESCRIPTION: 'Job description',
  POLICY: 'Policy',
  TRAINING: 'Training material',
  UNCLASSIFIED: 'Unclassified',
};

export const SYSTEM_CATEGORIES = [
  'CRM',
  'ERP',
  'ACCOUNTING',
  'HR',
  'EMAIL',
  'STORAGE',
  'PROJECT_MGMT',
  'ECOMMERCE',
  'WEBSITE',
  'INDUSTRY',
  'SPREADSHEET',
  'OTHER',
] as const;

export const SYSTEM_CATEGORY_LABELS: Record<string, string> = {
  CRM: 'CRM',
  ERP: 'ERP',
  ACCOUNTING: 'Accounting',
  HR: 'HR',
  EMAIL: 'Email',
  STORAGE: 'Cloud storage',
  PROJECT_MGMT: 'Project management',
  ECOMMERCE: 'E-commerce',
  WEBSITE: 'Website',
  INDUSTRY: 'Industry software',
  SPREADSHEET: 'Spreadsheets',
  OTHER: 'Other',
};

export const PROBLEM_CATEGORIES = [
  'BOTTLENECK',
  'COST',
  'ERROR',
  'DELAY',
  'CAPACITY',
  'QUALITY',
  'VISIBILITY',
] as const;

export const OBJECTIVE_CATEGORIES = [
  'REVENUE',
  'COST',
  'GROWTH',
  'PRODUCTIVITY',
  'CUSTOMER_EXPERIENCE',
  'QUALITY',
  'RISK',
] as const;

export const METRIC_KEYS = [
  'HOURS_SAVED',
  'COST',
  'REVENUE',
  'ACCURACY',
  'RESPONSE_TIME',
  'CSAT',
  'ADOPTION',
  'AI_USAGE',
  'ERROR_RATE',
  'ESCALATION_RATE',
  'CUSTOM',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABELS: Record<MetricKey, string> = {
  HOURS_SAVED: 'Hours saved',
  COST: 'Cost',
  REVENUE: 'Revenue',
  ACCURACY: 'Accuracy',
  RESPONSE_TIME: 'Response time',
  CSAT: 'Customer satisfaction',
  ADOPTION: 'Employee adoption',
  AI_USAGE: 'AI usage',
  ERROR_RATE: 'Error rate',
  ESCALATION_RATE: 'Escalation rate',
  CUSTOM: 'Custom metric',
};

/** A fact the platform holds about a business, with its provenance (§19). */
export interface SourcedFact {
  field: string;
  value: unknown;
  source: 'USER' | 'DOCUMENT' | 'AI_INFERRED' | 'INTEGRATION' | 'BENCHMARK';
  sourceRef?: string;
  confidence: Confidence;
}

export interface Assumption {
  label: string;
  value: string;
  source: string;
  isEstimate: boolean;
}

export interface Formula {
  label: string;
  expression: string;
  result: string;
}

export interface EvidenceRef {
  type: 'ASSESSMENT' | 'DOCUMENT' | 'INTERVIEW' | 'PROCESS' | 'BENCHMARK' | 'CONSULTANT';
  ref: string;
  detail?: string;
}
