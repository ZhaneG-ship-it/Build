/**
 * Industry benchmarks (§10).
 *
 * These are used ONLY to bound an estimate range when the client has not
 * supplied their own figure, and every benchmark that influences a number is
 * surfaced to the reader with its source. They are deliberately expressed as
 * wide ranges: the platform must never present a benchmark as this business's
 * actual performance.
 */

export interface Benchmark {
  key: string;
  label: string;
  low: number;
  high: number;
  unit: string;
  source: string;
  note?: string;
}

/**
 * Automation/AI time-reduction ranges by the kind of work involved. Ranges are
 * intentionally conservative and wide — they express plausible outcomes, not
 * promises.
 */
export const REDUCTION_BENCHMARKS: Record<string, Benchmark> = {
  DOCUMENT_AI: {
    key: 'DOCUMENT_AI',
    label: 'Document extraction and classification',
    low: 40,
    high: 70,
    unit: '% of handling time',
    source: 'Platform benchmark range for structured document processing',
    note: 'Assumes documents are reasonably consistent in layout.',
  },
  WORKFLOW_AUTOMATION: {
    key: 'WORKFLOW_AUTOMATION',
    label: 'Rules-based workflow automation',
    low: 45,
    high: 75,
    unit: '% of handling time',
    source: 'Platform benchmark range for deterministic workflow automation',
    note: 'Applies where the rules are stable and systems expose APIs.',
  },
  GENERATIVE_AI: {
    key: 'GENERATIVE_AI',
    label: 'Drafting and content generation',
    low: 25,
    high: 50,
    unit: '% of drafting time',
    source: 'Platform benchmark range for assisted drafting',
    note: 'Assumes a human reviews and approves every output.',
  },
  AI_ASSISTANT: {
    key: 'AI_ASSISTANT',
    label: 'Assisted lookup and summarisation',
    low: 20,
    high: 40,
    unit: '% of task time',
    source: 'Platform benchmark range for retrieval assistants',
  },
  AI_AGENT: {
    key: 'AI_AGENT',
    label: 'Multi-step agent handling',
    low: 30,
    high: 60,
    unit: '% of task time',
    source: 'Platform benchmark range for supervised task agents',
    note: 'Requires strong oversight and clear escalation rules.',
  },
  AI_CHATBOT: {
    key: 'AI_CHATBOT',
    label: 'First-line enquiry handling',
    low: 25,
    high: 55,
    unit: '% of enquiry volume deflected',
    source: 'Platform benchmark range for enquiry deflection',
  },
  KNOWLEDGE_MANAGEMENT: {
    key: 'KNOWLEDGE_MANAGEMENT',
    label: 'Internal knowledge search',
    low: 20,
    high: 45,
    unit: '% of information-seeking time',
    source: 'Platform benchmark range for internal knowledge retrieval',
  },
  AI_REPORTING: {
    key: 'AI_REPORTING',
    label: 'Report preparation',
    low: 35,
    high: 65,
    unit: '% of reporting time',
    source: 'Platform benchmark range for automated reporting',
  },
  PREDICTIVE_ANALYTICS: {
    key: 'PREDICTIVE_ANALYTICS',
    label: 'Predictive prioritisation',
    low: 10,
    high: 30,
    unit: '% efficiency gain',
    source: 'Platform benchmark range for predictive prioritisation',
    note: 'Value comes mainly from better targeting rather than time saved.',
  },
  AI_FORECASTING: {
    key: 'AI_FORECASTING',
    label: 'Demand and revenue forecasting',
    low: 10,
    high: 25,
    unit: '% forecasting effort reduction',
    source: 'Platform benchmark range for forecasting support',
  },
  VOICE_AI: {
    key: 'VOICE_AI',
    label: 'Voice call handling',
    low: 20,
    high: 45,
    unit: '% of call handling time',
    source: 'Platform benchmark range for voice handling',
  },
  COMPUTER_VISION: {
    key: 'COMPUTER_VISION',
    label: 'Visual inspection',
    low: 30,
    high: 60,
    unit: '% of inspection time',
    source: 'Platform benchmark range for visual inspection',
  },
};

/**
 * Implementation cost bands by complexity, expressed in the organisation's
 * currency. These are order-of-magnitude planning figures for a small or
 * mid-sized business, not quotes.
 */
export const IMPLEMENTATION_COST_BANDS: Record<string, { low: number; high: number; runningPerYear: number }> = {
  LOW: { low: 2_000, high: 8_000, runningPerYear: 1_200 },
  MEDIUM: { low: 8_000, high: 30_000, runningPerYear: 4_800 },
  HIGH: { low: 30_000, high: 120_000, runningPerYear: 18_000 },
};

/** Fallback hourly labour cost by company size band, used only when the client supplies none. */
export const FALLBACK_HOURLY_COST: Record<string, Benchmark> = {
  DEFAULT: {
    key: 'HOURLY_COST_DEFAULT',
    label: 'Fully-loaded hourly employee cost',
    low: 18,
    high: 35,
    unit: 'per hour',
    source: 'Generic small-business fully-loaded cost range',
    note: 'Replace with your own figure for a meaningful estimate.',
  },
};

export const WORKING_WEEKS_PER_YEAR = 46; // 52 weeks less leave and public holidays

export function reductionBenchmark(category: string): Benchmark {
  return REDUCTION_BENCHMARKS[category] ?? REDUCTION_BENCHMARKS.WORKFLOW_AUTOMATION;
}
