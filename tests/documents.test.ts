import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { chunkText } from '../src/lib/documents/pipeline';
import { classifyDocument, extractEntities, extractFacts, summarise } from '../src/lib/documents/classify';

const SOP = `Standard Operating Procedure: Quote Preparation

Purpose: To produce an accurate priced quotation from a completed site survey.
Owner: Estimating Manager
Trigger: A completed site survey is uploaded to SharePoint.

Step 1. The estimator downloads the survey notes from SharePoint.
Step 2. Measurements are typed into the pricing workbook.
Step 3. Current supplier pricing is checked against the latest price list.

Timing: The process takes 5 hours per week of estimator time.
Error rate: 8% of quotes contain a pricing error.
Volume: 45 enquiries per month. Conversion rate 22%.
`;

describe('classifyDocument', () => {
  test('recognises a standard operating procedure', () => {
    const result = classifyDocument('SOP-quote-preparation.md', SOP, 'text/markdown');
    assert.equal(result.classification, 'SOP');
    assert.equal(result.confidence, 'HIGH');
    assert.ok(result.matchedOn.length > 0, 'must record what it matched on');
  });

  test('treats a spreadsheet as a spreadsheet', () => {
    const result = classifyDocument('cost-tracker.xlsx', '# Sheet: Costs\na,b,c', 'application/vnd.ms-excel');
    assert.equal(result.classification, 'SPREADSHEET');
  });

  test('admits when it does not know', () => {
    const result = classifyDocument('notes.txt', 'wednesday. blue. seventeen.', 'text/plain');
    assert.equal(result.classification, 'UNCLASSIFIED');
    assert.equal(result.confidence, 'LOW');
  });
});

describe('extractFacts', () => {
  test('extracts quantities and always keeps the quote they came from', () => {
    const facts = extractFacts(SOP, 'SOP');

    const time = facts.find((f) => f.field === 'process.timeSpent');
    assert.ok(time, 'expected the time figure to be extracted');
    assert.match(time!.value, /5 hours per week/);
    assert.ok(time!.quote.length > 0, 'every fact must carry its source text');

    assert.ok(facts.some((f) => f.field === 'process.errorRate' && f.value === '8'));
    assert.ok(facts.some((f) => f.field === 'financials.conversionRate' && f.value === '22'));
    assert.ok(facts.some((f) => f.field === 'financials.monthlyLeadVolume' && f.value === '45'));
  });

  test('extracts procedure steps from an SOP', () => {
    const steps = extractFacts(SOP, 'SOP').filter((f) => f.field === 'process.step');
    assert.ok(steps.length >= 3, `expected the numbered steps, got ${steps.length}`);
  });

  test('invents nothing when there is nothing to find', () => {
    const facts = extractFacts('We are a friendly company that values our people.', 'UNCLASSIFIED');
    assert.equal(facts.length, 0);
  });
});

describe('extractEntities', () => {
  test('identifies the systems a business names', () => {
    const entities = extractEntities('We use HubSpot for CRM, Sage for accounts and SharePoint for files.');
    const systems = entities.filter((e) => e.type === 'SYSTEM').map((e) => e.value.toLowerCase());

    assert.ok(systems.includes('hubspot'));
    assert.ok(systems.includes('sage'));
    assert.ok(systems.includes('sharepoint'));
  });

  test('every entity carries the surrounding context', () => {
    const entities = extractEntities(SOP);
    for (const entity of entities) {
      assert.ok(entity.context.length > 0, `${entity.value} has no context`);
    }
  });
});

describe('chunkText', () => {
  test('splits on paragraph boundaries and keeps chunks whole', () => {
    // Comfortably past the ~1,100 character chunk target, so splitting must occur.
    const text = Array.from(
      { length: 60 },
      (_, i) => `Paragraph ${i} describes how the roofing team handles supplier invoices and site surveys.`,
    ).join('\n\n');
    const chunks = chunkText(text);

    assert.ok(chunks.length > 1, 'long text must be split');
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 2200, `chunk too large: ${chunk.length}`);
      assert.equal(chunk, chunk.trim());
    }
  });

  test('discards fragments too short to be worth retrieving', () => {
    const chunks = chunkText('Hi.\n\nOk.\n\nYes.');
    assert.equal(chunks.length, 0);
  });

  test('splits an oversized single paragraph on sentence boundaries', () => {
    const long = Array.from({ length: 60 }, (_, i) => `This is sentence number ${i} in a very long block.`).join(' ');
    const chunks = chunkText(long);
    assert.ok(chunks.length > 1);
  });
});

describe('summarise', () => {
  test('returns short text unchanged', () => {
    const text = 'A short description of the process.';
    assert.equal(summarise(text), text);
  });

  test('keeps the summary within the requested budget', () => {
    const long = Array.from({ length: 80 }, (_, i) => `Sentence ${i} carries 12 units of detail.`).join(' ');
    const summary = summarise(long, 300);
    assert.ok(summary.length <= 320, `got ${summary.length}`);
    assert.ok(summary.length > 0);
  });
});
