import 'server-only';
import { prisma } from './db';
import { stringify } from './json';

export async function recordAudit(entry: {
  organisationId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        organisationId: entry.organisationId ?? null,
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: stringify(entry.metadata ?? {}),
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (err) {
    // Auditing must never break the user-facing action.
    console.error('[audit] failed to record', entry.action, err);
  }
}

export async function logGeneration(entry: {
  organisationId?: string | null;
  agent: string;
  provider: string;
  model?: string | null;
  task: string;
  inputSummary?: string;
  outputSummary?: string;
  confidence?: string;
  durationMs?: number;
  status?: string;
  error?: string;
}) {
  try {
    await prisma.aIGenerationLog.create({
      data: {
        organisationId: entry.organisationId ?? null,
        agent: entry.agent,
        provider: entry.provider,
        model: entry.model ?? null,
        task: entry.task,
        inputSummary: entry.inputSummary?.slice(0, 2000),
        outputSummary: entry.outputSummary?.slice(0, 2000),
        confidence: entry.confidence,
        durationMs: entry.durationMs,
        status: entry.status ?? 'OK',
        error: entry.error?.slice(0, 1000),
      },
    });
  } catch (err) {
    console.error('[ai-log] failed to record', entry.agent, err);
  }
}
