import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/db';
import { retrieveChunks, assembleContext } from '../src/lib/ai/retrieval';
import { embed, cosineSimilarity } from '../src/lib/ai/embeddings';
import { stringify } from '../src/lib/json';

/**
 * Organisation-level data isolation is the platform's most important guarantee.
 * These tests create two tenants holding deliberately similar documents and
 * assert that nothing ever crosses between them.
 */

const ALPHA_TEXT =
  'Alpha Roofing processes supplier invoices manually in Sage. The finance team spends 16 hours per week typing invoice data. The secret Alpha margin is 34 percent.';
const BETA_TEXT =
  'Beta Roofing processes supplier invoices manually in Sage. The finance team spends 18 hours per week typing invoice data. The secret Beta margin is 41 percent.';

let alphaId: string;
let betaId: string;

before(async () => {
  const alpha = await prisma.organisation.create({
    data: { name: 'Alpha Test Org', slug: `alpha-${Date.now()}` },
  });
  const beta = await prisma.organisation.create({
    data: { name: 'Beta Test Org', slug: `beta-${Date.now()}` },
  });
  alphaId = alpha.id;
  betaId = beta.id;

  for (const [orgId, text, name] of [
    [alphaId, ALPHA_TEXT, 'alpha-sop.md'],
    [betaId, BETA_TEXT, 'beta-sop.md'],
  ] as const) {
    const document = await prisma.document.create({
      data: {
        organisationId: orgId,
        fileName: name,
        mimeType: 'text/markdown',
        sizeBytes: text.length,
        storagePath: `/tmp/${name}`,
        status: 'PROCESSED',
        classification: 'SOP',
        extractedText: text,
        wordCount: text.split(/\s+/).length,
      },
    });
    await prisma.documentChunk.create({
      data: {
        organisationId: orgId,
        documentId: document.id,
        chunkIndex: 0,
        content: text,
        embedding: stringify(embed(text)),
      },
    });
  }
});

after(async () => {
  await prisma.documentChunk.deleteMany({ where: { organisationId: { in: [alphaId, betaId] } } });
  await prisma.document.deleteMany({ where: { organisationId: { in: [alphaId, betaId] } } });
  await prisma.organisation.deleteMany({ where: { id: { in: [alphaId, betaId] } } });
  await prisma.$disconnect();
});

describe('retrieval is scoped to one organisation', () => {
  test('a query only ever returns the calling tenant’s own passages', async () => {
    const results = await retrieveChunks(alphaId, 'supplier invoices typed into Sage');

    assert.ok(results.length > 0, 'expected the tenant to find its own document');
    for (const chunk of results) {
      assert.match(chunk.content, /Alpha/);
      assert.doesNotMatch(chunk.content, /Beta/, 'another tenant’s content must never be returned');
    }
  });

  test('a query crafted to match the other tenant still returns nothing of theirs', async () => {
    const results = await retrieveChunks(alphaId, 'secret Beta margin 41 percent 18 hours');

    for (const chunk of results) {
      assert.doesNotMatch(chunk.content, /Beta/);
    }
  });

  test('multi-query context assembly stays inside the tenant', async () => {
    const chunks = await assembleContext(betaId, [
      'invoice processing',
      'finance team hours',
      'secret margin',
    ]);

    assert.ok(chunks.length > 0);
    for (const chunk of chunks) {
      assert.match(chunk.content, /Beta/);
      assert.doesNotMatch(chunk.content, /Alpha/);
    }
  });

  test('an organisation with no documents retrieves nothing rather than someone else’s', async () => {
    const empty = await prisma.organisation.create({
      data: { name: 'Empty Test Org', slug: `empty-${Date.now()}` },
    });
    const results = await retrieveChunks(empty.id, 'supplier invoices Sage finance');
    assert.equal(results.length, 0);
    await prisma.organisation.delete({ where: { id: empty.id } });
  });
});

describe('embeddings', () => {
  test('a vector is unit length, so cosine similarity is a dot product', () => {
    const vector = embed('supplier invoice processing in Sage');
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    assert.ok(Math.abs(norm - 1) < 1e-9, `expected unit length, got ${norm}`);
  });

  test('related text scores higher than unrelated text', () => {
    const query = embed('supplier invoice processing');
    const related = embed('the finance team types supplier invoices into the accounting system');
    const unrelated = embed('roof membrane installation and scaffolding access');

    assert.ok(
      cosineSimilarity(query, related) > cosineSimilarity(query, unrelated),
      'related content must rank above unrelated content',
    );
  });

  test('an empty document produces a zero vector rather than throwing', () => {
    const vector = embed('');
    assert.equal(vector.length, 512);
    assert.ok(vector.every((v) => v === 0));
  });
});
