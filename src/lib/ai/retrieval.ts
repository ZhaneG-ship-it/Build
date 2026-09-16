import 'server-only';
import { prisma } from '../db';
import { parseJson } from '../json';
import { cosineSimilarity, embed, keywordOverlap } from './embeddings';

/**
 * Retrieval layer (§21).
 *
 * Agents never receive the whole business. They receive: the structured
 * knowledge model for the task, plus the top-k document chunks retrieved for the
 * current question. Retrieval is always filtered by `organisationId` in the SQL
 * query itself, so cross-tenant leakage is impossible by construction.
 */

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  classification: string;
  chunkIndex: number;
  content: string;
  score: number;
}

export interface RetrievalOptions {
  topK?: number;
  minScore?: number;
  /** Restrict to specific document classifications. */
  classifications?: string[];
}

export async function retrieveChunks(
  organisationId: string,
  query: string,
  options: RetrievalOptions = {},
): Promise<RetrievedChunk[]> {
  const { topK = 8, minScore = 0.04, classifications } = options;

  const chunks = await prisma.documentChunk.findMany({
    where: {
      organisationId, // tenancy filter — non-negotiable
      ...(classifications?.length
        ? { document: { classification: { in: classifications } } }
        : {}),
    },
    include: { document: { select: { fileName: true, classification: true } } },
  });

  if (chunks.length === 0) return [];

  const queryVector = embed(query);

  const scored = chunks.map((chunk) => {
    const vector = parseJson<number[]>(chunk.embedding, []);
    const semantic = vector.length ? cosineSimilarity(queryVector, vector) : 0;
    const lexical = keywordOverlap(query, chunk.content);
    // Blend: the hashed vector carries phrase structure, the overlap term
    // rewards exact operational vocabulary ("purchase order", "Xero").
    return {
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentName: chunk.document.fileName,
      classification: chunk.document.classification,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      score: semantic * 0.65 + lexical * 0.35,
    };
  });

  return scored
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Renders retrieved chunks with citation handles the agent is told to quote. */
export function renderChunksForPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return 'No supporting documents were retrieved for this question.';
  }
  return chunks
    .map(
      (c) =>
        `[doc:${c.documentId}#${c.chunkIndex}] (${c.documentName}, ${c.classification})\n${c.content.trim()}`,
    )
    .join('\n\n---\n\n');
}

/**
 * Builds the retrieval context for a task by running several focused queries and
 * de-duplicating, rather than one broad query. Keeps recall up without inflating
 * the prompt.
 */
export async function assembleContext(
  organisationId: string,
  queries: string[],
  perQuery = 4,
  cap = 14,
): Promise<RetrievedChunk[]> {
  const seen = new Map<string, RetrievedChunk>();
  for (const query of queries) {
    const results = await retrieveChunks(organisationId, query, { topK: perQuery });
    for (const chunk of results) {
      const existing = seen.get(chunk.chunkId);
      if (!existing || chunk.score > existing.score) seen.set(chunk.chunkId, chunk);
    }
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, cap);
}
