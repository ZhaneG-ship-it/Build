import 'server-only';

/**
 * Text extraction (§5, step 1).
 *
 * Handles the file types businesses actually send: plain text and markdown,
 * CSV/TSV, JSON, PDF, Word, and spreadsheets. Each extractor is loaded lazily so
 * a missing optional parser never breaks an upload of a different type.
 */

export interface ExtractionResult {
  text: string;
  wordCount: number;
  method: string;
  warning?: string;
}

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.log', '.json', '.yaml', '.yml', '.html', '.htm'];

export function isProbablyText(fileName: string, mimeType: string): boolean {
  if (TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return true;
  if (mimeType === 'application/json') return true;
  const lower = fileName.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function extractText(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<ExtractionResult> {
  const lower = fileName.toLowerCase();

  // --- Word ----------------------------------------------------------------
  if (lower.endsWith('.docx') || mimeType.includes('wordprocessingml')) {
    try {
      const mammoth = (await import('mammoth')).default;
      const { value } = await mammoth.extractRawText({ buffer });
      const text = value.trim();
      return { text, wordCount: countWords(text), method: 'mammoth/docx' };
    } catch (err) {
      return {
        text: '',
        wordCount: 0,
        method: 'mammoth/docx',
        warning: `Could not read this Word document: ${(err as Error).message}`,
      };
    }
  }

  // --- Spreadsheets --------------------------------------------------------
  if (
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    lower.endsWith('.ods') ||
    mimeType.includes('spreadsheetml') ||
    mimeType === 'application/vnd.ms-excel'
  ) {
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const parts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        if (csv.trim()) parts.push(`# Sheet: ${sheetName}\n${csv.trim()}`);
      }
      const text = parts.join('\n\n');
      return { text, wordCount: countWords(text), method: 'xlsx' };
    } catch (err) {
      return {
        text: '',
        wordCount: 0,
        method: 'xlsx',
        warning: `Could not read this spreadsheet: ${(err as Error).message}`,
      };
    }
  }

  // --- PDF -----------------------------------------------------------------
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') {
    try {
      // pdf-parse is CommonJS and runs its own debug harness when the package
      // root is imported, so the library entry point is imported directly.
      const mod = await import('pdf-parse/lib/pdf-parse.js');
      const pdfParse = ((mod as { default?: unknown }).default ?? mod) as (
        b: Buffer,
      ) => Promise<{ text: string }>;
      const { text } = await pdfParse(buffer);
      const cleaned = text.replace(/\n{3,}/g, '\n\n').trim();
      if (!cleaned) {
        return {
          text: '',
          wordCount: 0,
          method: 'pdf-parse',
          warning: 'No text layer found. This looks like a scanned PDF and would need OCR.',
        };
      }
      return { text: cleaned, wordCount: countWords(cleaned), method: 'pdf-parse' };
    } catch (err) {
      return {
        text: '',
        wordCount: 0,
        method: 'pdf-parse',
        warning: `Could not read this PDF: ${(err as Error).message}`,
      };
    }
  }

  // --- Text-ish ------------------------------------------------------------
  if (isProbablyText(fileName, mimeType)) {
    let text = buffer.toString('utf8');
    if (lower.endsWith('.html') || lower.endsWith('.htm') || mimeType.includes('html')) {
      text = stripHtml(text);
    }
    // Strip NUL bytes, which SQLite will not store in a text column.
    text = text.split('\0').join('').trim();
    return { text, wordCount: countWords(text), method: 'utf8' };
  }

  return {
    text: '',
    wordCount: 0,
    method: 'none',
    warning: `${mimeType || 'This file type'} is not supported for text extraction. Supported: PDF, Word, Excel, CSV, text and Markdown.`,
  };
}
