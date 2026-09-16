import type { DocumentClass } from '../types';

/**
 * Document classification and fact extraction (§5, steps 2-4).
 *
 * Deterministic and explainable: a document is classified by weighted evidence
 * from its filename and its content, and every extracted fact records the text
 * it came from so the platform can cite the source later.
 */

interface ClassifierRule {
  klass: DocumentClass;
  fileNameHints: string[];
  contentHints: string[];
}

const RULES: ClassifierRule[] = [
  {
    klass: 'SOP',
    fileNameHints: ['sop', 'standard operating', 'procedure', 'work instruction'],
    contentHints: ['standard operating procedure', 'step 1', 'purpose', 'scope', 'responsibilities', 'procedure'],
  },
  {
    klass: 'HANDBOOK',
    fileNameHints: ['handbook', 'employee guide', 'staff guide'],
    contentHints: ['employee handbook', 'code of conduct', 'annual leave', 'disciplinary', 'induction'],
  },
  {
    klass: 'PROCESS_DOC',
    fileNameHints: ['process', 'workflow', 'flow'],
    contentHints: ['process map', 'workflow', 'hand off', 'handoff', 'trigger', 'inputs', 'outputs'],
  },
  {
    klass: 'ORG_CHART',
    fileNameHints: ['org chart', 'orgchart', 'organisation chart', 'organization chart', 'structure'],
    contentHints: ['reports to', 'line manager', 'head of', 'organisational structure'],
  },
  {
    klass: 'CONTRACT',
    fileNameHints: ['contract', 'agreement', 'terms', 'msa', 'sow'],
    contentHints: ['this agreement', 'parties', 'termination', 'liability', 'governing law'],
  },
  {
    klass: 'JOB_DESCRIPTION',
    fileNameHints: ['job description', 'role profile', 'vacancy'],
    contentHints: ['job title', 'reporting to', 'key responsibilities', 'person specification', 'essential criteria'],
  },
  {
    klass: 'POLICY',
    fileNameHints: ['policy', 'gdpr', 'privacy', 'security policy'],
    contentHints: ['this policy', 'policy statement', 'compliance', 'data protection', 'must not'],
  },
  {
    klass: 'FAQ',
    fileNameHints: ['faq', 'questions', 'help'],
    contentHints: ['frequently asked', 'how do i', 'what happens if'],
  },
  {
    klass: 'SALES_SCRIPT',
    fileNameHints: ['script', 'call guide', 'pitch', 'objection'],
    contentHints: ['objection', 'discovery call', 'qualifying questions', 'prospect'],
  },
  {
    klass: 'MARKETING',
    fileNameHints: ['marketing', 'campaign', 'brochure', 'brand'],
    contentHints: ['campaign', 'target audience', 'brand', 'messaging', 'value proposition'],
  },
  {
    klass: 'PRODUCT_INFO',
    fileNameHints: ['product', 'catalogue', 'catalog', 'spec', 'price list'],
    contentHints: ['specification', 'features', 'sku', 'price list'],
  },
  {
    klass: 'TRAINING',
    fileNameHints: ['training', 'course', 'onboarding', 'induction'],
    contentHints: ['learning objectives', 'module', 'training', 'exercise', 'by the end of'],
  },
  {
    klass: 'REPORT',
    fileNameHints: ['report', 'summary', 'review', 'analysis', 'results'],
    contentHints: ['executive summary', 'findings', 'conclusion', 'year on year', 'performance'],
  },
  {
    klass: 'SPREADSHEET',
    fileNameHints: ['.xlsx', '.xls', '.csv', 'tracker', 'log'],
    contentHints: ['# sheet:'],
  },
];

export interface Classification {
  classification: DocumentClass;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  matchedOn: string[];
}

export function classifyDocument(fileName: string, text: string, mimeType: string): Classification {
  const name = fileName.toLowerCase();
  const body = text.slice(0, 20_000).toLowerCase();

  let best: { klass: DocumentClass; score: number; matched: string[] } | null = null;

  for (const rule of RULES) {
    const nameHits = rule.fileNameHints.filter((h) => name.includes(h));
    const contentHits = rule.contentHints.filter((h) => body.includes(h));
    const score = nameHits.length * 3 + contentHits.length;
    if (score > 0 && (!best || score > best.score)) {
      best = { klass: rule.klass, score, matched: [...nameHits, ...contentHits] };
    }
  }

  // A spreadsheet is a spreadsheet unless something much stronger says otherwise.
  if (
    (mimeType.includes('spreadsheet') || name.endsWith('.csv') || name.endsWith('.xlsx')) &&
    (!best || best.score < 5)
  ) {
    return { classification: 'SPREADSHEET', confidence: 'HIGH', matchedOn: ['file type'] };
  }

  if (!best) return { classification: 'UNCLASSIFIED', confidence: 'LOW', matchedOn: [] };

  const confidence = best.score >= 6 ? 'HIGH' : best.score >= 3 ? 'MEDIUM' : 'LOW';
  return { classification: best.klass, confidence, matchedOn: best.matched.slice(0, 6) };
}

// ---------------------------------------------------------------------------
// Entities and facts
// ---------------------------------------------------------------------------

export interface ExtractedEntity {
  type: 'SYSTEM' | 'ROLE' | 'DEPARTMENT' | 'METRIC' | 'MONEY' | 'DURATION' | 'FREQUENCY';
  value: string;
  context: string;
}

const KNOWN_SYSTEMS = [
  'salesforce', 'hubspot', 'pipedrive', 'zoho', 'dynamics', 'sage', 'xero', 'quickbooks',
  'freeagent', 'netsuite', 'sap', 'oracle', 'workday', 'bamboohr', 'breathehr', 'peoplehr',
  'outlook', 'gmail', 'office 365', 'microsoft 365', 'google workspace', 'sharepoint',
  'dropbox', 'onedrive', 'google drive', 'asana', 'trello', 'monday.com', 'jira',
  'clickup', 'notion', 'slack', 'teams', 'zoom', 'shopify', 'woocommerce', 'magento',
  'wordpress', 'squarespace', 'excel', 'google sheets', 'mailchimp', 'zendesk', 'intercom',
  'freshdesk', 'stripe', 'quickfile', 'autocad', 'revit', 'epicor',
];

const DEPARTMENT_WORDS = [
  'sales', 'marketing', 'operations', 'finance', 'accounts', 'human resources',
  'customer service', 'customer support', 'production', 'warehouse', 'logistics',
  'procurement', 'legal', 'engineering', 'management',
];

const ROLE_PATTERNS = [
  /\b(?:head of|director of|manager of)\s+([a-z][a-z\s]{2,30})/gi,
  /\b([a-z][a-z\s]{2,25}?)\s+(?:manager|coordinator|administrator|assistant|executive|officer|analyst|technician)\b/gi,
];

export function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();
  const lower = text.toLowerCase();

  const push = (entity: ExtractedEntity) => {
    const key = `${entity.type}:${entity.value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push(entity);
  };

  const contextAround = (index: number, length = 120): string => {
    const start = Math.max(0, index - length / 2);
    return text.slice(start, start + length).replace(/\s+/g, ' ').trim();
  };

  for (const system of KNOWN_SYSTEMS) {
    const index = lower.indexOf(system);
    if (index >= 0) {
      push({
        type: 'SYSTEM',
        value: system.replace(/\b\w/g, (c) => c.toUpperCase()),
        context: contextAround(index),
      });
    }
  }

  for (const dept of DEPARTMENT_WORDS) {
    const index = lower.indexOf(dept);
    if (index >= 0) {
      push({
        type: 'DEPARTMENT',
        value: dept.replace(/\b\w/g, (c) => c.toUpperCase()),
        context: contextAround(index),
      });
    }
  }

  for (const pattern of ROLE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0].replace(/\s+/g, ' ').trim();
      if (value.length < 60) push({ type: 'ROLE', value, context: contextAround(match.index ?? 0) });
    }
  }

  // Money, durations and frequencies — useful hints for the outcome engine.
  for (const match of text.matchAll(/[£$€]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|million|per year|pa))?/gi)) {
    push({ type: 'MONEY', value: match[0].trim(), context: contextAround(match.index ?? 0) });
  }
  for (const match of text.matchAll(
    /\b\d+(?:\.\d+)?\s?(?:hours?|hrs?|minutes?|mins?|days?)\b(?:\s+(?:per|a|each)\s+(?:day|week|month|year))?/gi,
  )) {
    push({ type: 'DURATION', value: match[0].trim(), context: contextAround(match.index ?? 0) });
  }
  for (const match of text.matchAll(
    /\b(?:daily|weekly|fortnightly|monthly|quarterly|annually|every\s+(?:day|week|month|quarter|year))\b/gi,
  )) {
    push({ type: 'FREQUENCY', value: match[0].trim(), context: contextAround(match.index ?? 0) });
  }
  for (const match of text.matchAll(/\b\d+(?:\.\d+)?%/g)) {
    push({ type: 'METRIC', value: match[0], context: contextAround(match.index ?? 0) });
  }

  return entities.slice(0, 120);
}

export interface ExtractedFact {
  field: string;
  value: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  quote: string;
}

/**
 * Pulls structured, business-relevant facts out of a document. Conservative by
 * design: it only records things it can quote, and every fact is attributed to
 * the document it came from so nothing is ever presented as unsourced.
 */
export function extractFacts(text: string, classification: DocumentClass): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  const addFact = (
    field: string,
    value: string,
    quote: string,
    confidence: ExtractedFact['confidence'] = 'MEDIUM',
  ) => {
    if (facts.some((f) => f.field === field && f.value === value)) return;
    facts.push({ field, value, confidence, quote: quote.slice(0, 300) });
  };

  for (const line of lines.slice(0, 600)) {
    const lower = line.toLowerCase();

    const hours = line.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s+(?:per|a|each)\s+(week|day|month)/i);
    if (hours) {
      addFact('process.timeSpent', `${hours[1]} hours per ${hours[2].toLowerCase()}`, line, 'HIGH');
    }

    const headcount = line.match(/(\d+)\s+(?:employees|staff|people|team members|fte)/i);
    if (headcount) addFact('company.employeeCount', headcount[1], line, 'MEDIUM');

    const turnover = line.match(
      /(?:turnover|revenue|sales)\D{0,20}([£$€]\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|million)?)/i,
    );
    if (turnover) addFact('company.annualTurnover', turnover[1].trim(), line, 'MEDIUM');

    const conversion = line.match(/conversion\s+rate\D{0,15}(\d+(?:\.\d+)?)\s?%/i);
    if (conversion) addFact('financials.conversionRate', conversion[1], line, 'HIGH');

    const leads = line.match(/(\d[\d,]*)\s+(?:leads|enquiries|inquiries)\s+(?:per|a|each)\s+month/i);
    if (leads) addFact('financials.monthlyLeadVolume', leads[1].replace(/,/g, ''), line, 'HIGH');

    const errorRate = line.match(/error\s+rate\D{0,15}(\d+(?:\.\d+)?)\s?%/i);
    if (errorRate) addFact('process.errorRate', errorRate[1], line, 'HIGH');

    if (classification === 'SOP' || classification === 'PROCESS_DOC') {
      if (/^(?:step\s*\d+[.):]?|[0-9]+[.)])\s+/i.test(line) && line.length < 220) {
        addFact('process.step', line.replace(/^(?:step\s*\d+[.):]?|[0-9]+[.)])\s*/i, ''), line, 'HIGH');
      }
      if (lower.startsWith('purpose') || lower.startsWith('scope')) {
        addFact('process.description', line.replace(/^(purpose|scope)\s*:?\s*/i, ''), line, 'MEDIUM');
      }
      if (lower.startsWith('owner') || lower.startsWith('responsible')) {
        addFact('process.owner', line.replace(/^(owner|responsible)\s*:?\s*/i, ''), line, 'MEDIUM');
      }
      if (lower.startsWith('trigger') || lower.startsWith('when')) {
        addFact('process.trigger', line.replace(/^(trigger|when)\s*:?\s*/i, ''), line, 'MEDIUM');
      }
    }
  }

  return facts.slice(0, 80);
}

/** Short extractive summary — the opening plus the most information-dense lines. */
export function summarise(text: string, maxChars = 700): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;

  const sentences = clean.split(/(?<=[.!?])\s+/);
  const scored = sentences.map((sentence, index) => {
    const numbers = (sentence.match(/\d/g) ?? []).length;
    const positionBonus = index < 3 ? 6 : 0;
    const lengthPenalty = sentence.length > 320 ? -4 : 0;
    return { sentence, score: numbers + positionBonus + lengthPenalty + Math.min(sentence.length / 60, 4) };
  });

  const picked = new Set<string>();
  let used = 0;
  for (const { sentence } of [...scored].sort((a, b) => b.score - a.score)) {
    if (used + sentence.length > maxChars) continue;
    picked.add(sentence);
    used += sentence.length;
    if (picked.size >= 6) break;
  }

  // Restore original order so the summary reads naturally.
  return sentences.filter((s) => picked.has(s)).join(' ').trim() || clean.slice(0, maxChars);
}
