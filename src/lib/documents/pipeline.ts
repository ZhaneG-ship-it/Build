import 'server-only';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { stringify } from '../json';
import { embed, EMBEDDING_MODEL } from '../ai/embeddings';
import { extractText } from './extract';
import { classifyDocument, extractEntities, extractFacts, summarise } from './classify';

/**
 * Document intelligence pipeline (§5).
 *
 *   store -> extract text -> classify -> extract entities & facts
 *         -> chunk -> embed -> persist, all scoped to one organisation.
 *
 * Files are stored under FILE_STORAGE_DIR/<organisationId>/, so a file on disk
 * is unambiguously owned by one tenant.
 */

const CHUNK_TARGET_CHARS = 1100;
const CHUNK_OVERLAP_CHARS = 150;

export function storageRoot(): string {
  return process.env.FILE_STORAGE_DIR?.trim() || './storage';
}

export async function storeUpload(
  organisationId: string,
  fileName: string,
  buffer: Buffer,
): Promise<string> {
  const dir = join(storageRoot(), organisationId);
  await mkdir(dir, { recursive: true });
  const safeExt = extname(fileName).slice(0, 12).replace(/[^A-Za-z0-9.]/g, '');
  const storagePath = join(dir, `${randomUUID()}${safeExt}`);
  await writeFile(storagePath, buffer);
  return storagePath;
}

/**
 * Splits text on paragraph boundaries, packing paragraphs up to the target size
 * and carrying a small overlap so a sentence spanning a boundary is still
 * retrievable from both sides.
 */
export function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  for (const paragraph of paragraphs) {
    // A single oversized paragraph is split on sentence boundaries.
    if (paragraph.length > CHUNK_TARGET_CHARS * 1.6) {
      flush();
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      let buffer = '';
      for (const sentence of sentences) {
        if (buffer.length + sentence.length > CHUNK_TARGET_CHARS && buffer) {
          chunks.push(buffer.trim());
          buffer = buffer.slice(-CHUNK_OVERLAP_CHARS);
        }
        buffer += (buffer ? ' ' : '') + sentence;
      }
      if (buffer.trim()) chunks.push(buffer.trim());
      continue;
    }

    if (current.length + paragraph.length > CHUNK_TARGET_CHARS && current) {
      const tail = current.slice(-CHUNK_OVERLAP_CHARS);
      flush();
      current = tail;
    }
    current += (current ? '\n\n' : '') + paragraph;
  }
  flush();

  return chunks.filter((c) => c.length > 40);
}

export interface ProcessingOutcome {
  documentId: string;
  status: 'PROCESSED' | 'FAILED';
  chunkCount: number;
  classification: string;
  factCount: number;
  entityCount: number;
  warning?: string;
}

export async function processDocument(documentId: string, organisationId: string): Promise<ProcessingOutcome> {
  const document = await prisma.document.findFirst({ where: { id: documentId, organisationId } });
  if (!document) throw new Error('Document not found in this organisation');

  await prisma.document.update({ where: { id: documentId }, data: { status: 'PROCESSING' } });

  try {
    const buffer = await readFile(document.storagePath);
    const extraction = await extractText(buffer, document.fileName, document.mimeType);

    if (!extraction.text) {
      await prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'FAILED',
          error: extraction.warning ?? 'No readable text could be extracted.',
          processedAt: new Date(),
        },
      });
      return {
        documentId,
        status: 'FAILED',
        chunkCount: 0,
        classification: 'UNCLASSIFIED',
        factCount: 0,
        entityCount: 0,
        warning: extraction.warning,
      };
    }

    const classification = classifyDocument(document.fileName, extraction.text, document.mimeType);
    const entities = extractEntities(extraction.text);
    const facts = extractFacts(extraction.text, classification.classification);
    const summary = summarise(extraction.text);

    const chunks = chunkText(extraction.text);

    // Replace any previous chunks for this document so reprocessing is idempotent.
    await prisma.documentChunk.deleteMany({ where: { documentId, organisationId } });

    if (chunks.length) {
      await prisma.documentChunk.createMany({
        data: chunks.map((content, index) => ({
          organisationId,
          documentId,
          chunkIndex: index,
          content,
          tokenEstimate: Math.ceil(content.length / 4),
          embedding: stringify(embed(content)),
          embeddingModel: EMBEDDING_MODEL,
        })),
      });
    }

    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'PROCESSED',
        classification: classification.classification,
        classificationConfidence: classification.confidence,
        extractedText: extraction.text.slice(0, 400_000),
        summary,
        wordCount: extraction.wordCount,
        entities: stringify(entities),
        facts: stringify(facts),
        error: null,
        processedAt: new Date(),
      },
    });

    // Systems named in a document are real evidence about the technology estate.
    await recordDiscoveredSystems(organisationId, entities, document.fileName);

    return {
      documentId,
      status: 'PROCESSED',
      chunkCount: chunks.length,
      classification: classification.classification,
      factCount: facts.length,
      entityCount: entities.length,
      warning: extraction.warning,
    };
  } catch (err) {
    const message = (err as Error).message;
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'FAILED', error: message, processedAt: new Date() },
    });
    return {
      documentId,
      status: 'FAILED',
      chunkCount: 0,
      classification: 'UNCLASSIFIED',
      factCount: 0,
      entityCount: 0,
      warning: message,
    };
  }
}

const SYSTEM_CATEGORY_GUESS: Record<string, string> = {
  salesforce: 'CRM', hubspot: 'CRM', pipedrive: 'CRM', zoho: 'CRM', dynamics: 'CRM',
  sage: 'ACCOUNTING', xero: 'ACCOUNTING', quickbooks: 'ACCOUNTING', freeagent: 'ACCOUNTING',
  quickfile: 'ACCOUNTING', stripe: 'ACCOUNTING',
  netsuite: 'ERP', sap: 'ERP', oracle: 'ERP', epicor: 'ERP',
  workday: 'HR', bamboohr: 'HR', breathehr: 'HR', peoplehr: 'HR',
  outlook: 'EMAIL', gmail: 'EMAIL', mailchimp: 'EMAIL',
  'office 365': 'STORAGE', 'microsoft 365': 'STORAGE', 'google workspace': 'STORAGE',
  sharepoint: 'STORAGE', dropbox: 'STORAGE', onedrive: 'STORAGE', 'google drive': 'STORAGE',
  asana: 'PROJECT_MGMT', trello: 'PROJECT_MGMT', 'monday.com': 'PROJECT_MGMT',
  jira: 'PROJECT_MGMT', clickup: 'PROJECT_MGMT', notion: 'PROJECT_MGMT',
  slack: 'OTHER', teams: 'OTHER', zoom: 'OTHER',
  shopify: 'ECOMMERCE', woocommerce: 'ECOMMERCE', magento: 'ECOMMERCE',
  wordpress: 'WEBSITE', squarespace: 'WEBSITE',
  excel: 'SPREADSHEET', 'google sheets': 'SPREADSHEET',
  zendesk: 'OTHER', intercom: 'OTHER', freshdesk: 'OTHER',
  autocad: 'INDUSTRY', revit: 'INDUSTRY',
};

const API_CAPABLE = new Set([
  'salesforce', 'hubspot', 'pipedrive', 'zoho', 'dynamics', 'xero', 'quickbooks', 'sage',
  'netsuite', 'shopify', 'stripe', 'jira', 'asana', 'monday.com', 'clickup', 'notion',
  'slack', 'zendesk', 'intercom', 'freshdesk', 'google workspace', 'microsoft 365',
]);

async function recordDiscoveredSystems(
  organisationId: string,
  entities: { type: string; value: string }[],
  sourceFile: string,
) {
  const systemNames = entities.filter((e) => e.type === 'SYSTEM').map((e) => e.value);
  if (systemNames.length === 0) return;

  const existing = await prisma.businessSystem.findMany({ where: { organisationId } });
  const existingLower = new Set(existing.map((s) => s.name.toLowerCase()));

  const toCreate = systemNames
    .filter((name) => !existingLower.has(name.toLowerCase()))
    .map((name) => ({
      organisationId,
      name,
      category: SYSTEM_CATEGORY_GUESS[name.toLowerCase()] ?? 'OTHER',
      hasApi: API_CAPABLE.has(name.toLowerCase()),
      usageNotes: `Identified in ${sourceFile}`,
      source: 'DOCUMENT',
    }));

  if (toCreate.length) await prisma.businessSystem.createMany({ data: toCreate });
}
