import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { logGeneration } from '../audit';

/**
 * The platform has two analysis providers:
 *
 *  - `anthropic`  — Claude runs the agent and returns a schema-validated object.
 *  - `engine`     — a deterministic, in-process rules engine that derives the
 *                   same structured result from the business knowledge model.
 *
 * The engine is not a stub: it is the platform's own analysis implementation and
 * every agent supplies one. Claude is used to enrich and phrase the analysis when
 * an API key is configured; without a key the product still runs end to end, and
 * outputs are labelled with the provider that produced them.
 */
export type ProviderName = 'anthropic' | 'engine';

let client: Anthropic | null = null;

export function isLlmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function getClient(): Anthropic | null {
  if (!isLlmConfigured()) return null;
  if (!client) client = new Anthropic();
  return client;
}

export function analysisModel(): string {
  return process.env.ANTHROPIC_ANALYSIS_MODEL?.trim() || 'claude-opus-5';
}

export function reportModel(): string {
  return process.env.ANTHROPIC_REPORT_MODEL?.trim() || 'claude-opus-5';
}

export interface AgentRunOptions<T> {
  /** Agent name, e.g. "AIOpportunityAgent" — used for audit logging. */
  agent: string;
  /** Short task label, e.g. "identify-opportunities". */
  task: string;
  organisationId?: string | null;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Deterministic implementation. Always required — it is the safety net. */
  fallback: () => T | Promise<T>;
  model?: string;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Called with the LLM result so an agent can merge it with engine output. */
  reconcile?: (llm: T, engine: T) => T;
}

export interface AgentRunResult<T> {
  result: T;
  provider: ProviderName;
  model: string | null;
  warning?: string;
}

const MAX_ATTEMPTS = 2;

export async function runAgent<T>(options: AgentRunOptions<T>): Promise<AgentRunResult<T>> {
  const started = Date.now();
  const engineResult = await options.fallback();
  const anthropic = getClient();

  if (!anthropic) {
    await logGeneration({
      organisationId: options.organisationId,
      agent: options.agent,
      provider: 'engine',
      task: options.task,
      inputSummary: options.prompt.slice(0, 500),
      durationMs: Date.now() - started,
    });
    return { result: engineResult, provider: 'engine', model: null };
  }

  const model = options.model ?? analysisModel();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await anthropic.messages.parse({
        model,
        max_tokens: options.maxTokens ?? 16000,
        system: options.system,
        thinking: { type: 'adaptive' },
        output_config: {
          format: zodOutputFormat(options.schema as never),
          effort: options.effort ?? 'high',
        },
        messages: [{ role: 'user', content: options.prompt }],
      });

      if (response.stop_reason === 'refusal') {
        throw new Error(`Model declined the request (${response.stop_details?.category ?? 'unknown'})`);
      }

      const parsed = response.parsed_output as T | null;
      if (!parsed) throw new Error('Model returned no parseable structured output');

      const merged = options.reconcile ? options.reconcile(parsed, engineResult) : parsed;

      await logGeneration({
        organisationId: options.organisationId,
        agent: options.agent,
        provider: 'anthropic',
        model,
        task: options.task,
        inputSummary: options.prompt.slice(0, 500),
        outputSummary: JSON.stringify(merged).slice(0, 1500),
        durationMs: Date.now() - started,
      });

      return { result: merged, provider: 'anthropic', model };
    } catch (err) {
      lastError = err;
      if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.AuthenticationError) {
        break; // not worth retrying
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  await logGeneration({
    organisationId: options.organisationId,
    agent: options.agent,
    provider: 'engine',
    model,
    task: options.task,
    inputSummary: options.prompt.slice(0, 500),
    durationMs: Date.now() - started,
    status: 'FALLBACK',
    error: message,
  });

  return {
    result: engineResult,
    provider: 'engine',
    model: null,
    warning: `Claude analysis unavailable, used the built-in analysis engine (${message})`,
  };
}

/** Shared system-prompt preamble encoding the platform's AI safety rules (§19). */
export const SAFETY_PREAMBLE = `You are an analyst inside a business-consulting platform.

Non-negotiable rules:
- NEVER invent facts about the business. Use only the supplied context.
- Distinguish facts (supplied by the client) from assumptions (your inference).
- Label every estimate as an estimate. Never state a financial outcome as guaranteed.
- Where information is missing, say so and name exactly what is needed.
- If AI or automation is not appropriate for a process, say so plainly rather than
  recommending AI for its own sake. "Do nothing" is a valid, respectable conclusion.
- Recommend human review for anything high-risk, regulated, or safety-critical.
- Write in clear British English for a business reader. Avoid AI jargon.
- Quote the supplied source identifiers when you rely on a specific piece of evidence.`;
