/**
 * Integration registry (§26).
 *
 * Connectors are declared here so the platform can show what it supports, what
 * is planned, and what each would contribute to the knowledge model. Connectors
 * marked `available: false` are shown as planned — the platform never pretends
 * to hold data it does not have.
 */

export interface IntegrationDefinition {
  provider: string;
  name: string;
  category: string;
  description: string;
  /** What this connector would add to the Business Knowledge Model. */
  contributes: string[];
  available: boolean;
}

export const INTEGRATION_REGISTRY: IntegrationDefinition[] = [
  {
    provider: 'MANUAL_SYSTEMS',
    name: 'Manually recorded systems',
    category: 'OTHER',
    description:
      'Systems entered by hand in settings. Always available, and enough for the platform to assess integration complexity.',
    contributes: ['System names', 'Categories', 'Whether an API exists', 'Data quality rating'],
    available: true,
  },
  {
    provider: 'HUBSPOT',
    name: 'HubSpot',
    category: 'CRM',
    description: 'Read lead volume, pipeline stages and conversion rates directly instead of asking for them.',
    contributes: ['Monthly lead volume', 'Conversion rate', 'Average customer value', 'Sales process stages'],
    available: false,
  },
  {
    provider: 'SALESFORCE',
    name: 'Salesforce',
    category: 'CRM',
    description: 'Read opportunity flow and sales-process structure.',
    contributes: ['Lead volume', 'Conversion rate', 'Sales cycle length'],
    available: false,
  },
  {
    provider: 'XERO',
    name: 'Xero',
    category: 'ACCOUNTING',
    description: 'Read turnover, payroll cost and operating costs to replace estimated financial inputs.',
    contributes: ['Annual turnover', 'Payroll cost', 'Operating costs', 'Invoice volume'],
    available: false,
  },
  {
    provider: 'QUICKBOOKS',
    name: 'QuickBooks',
    category: 'ACCOUNTING',
    description: 'Read financial baselines used by the outcome engine.',
    contributes: ['Annual turnover', 'Operating costs', 'Invoice volume'],
    available: false,
  },
  {
    provider: 'MS365',
    name: 'Microsoft 365',
    category: 'STORAGE',
    description: 'Read documents from SharePoint and analyse calendar and email load.',
    contributes: ['Procedure documents', 'Meeting load', 'Email volume per role'],
    available: false,
  },
  {
    provider: 'GOOGLE_WORKSPACE',
    name: 'Google Workspace',
    category: 'STORAGE',
    description: 'Read documents from Drive and analyse calendar load.',
    contributes: ['Procedure documents', 'Meeting load'],
    available: false,
  },
  {
    provider: 'SLACK',
    name: 'Slack',
    category: 'OTHER',
    description: 'Identify where repeated questions are being asked, which points to knowledge-management opportunities.',
    contributes: ['Repeated internal questions', 'Escalation patterns'],
    available: false,
  },
];
