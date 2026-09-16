import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { parseJson } from '@/lib/json';
import { DOCUMENT_CLASS_LABELS, type DocumentClass } from '@/lib/types';
import { uploadDocuments, reprocessDocument, deleteDocument } from '@/app/actions/documents';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Button,
  Field,
  inputClass,
  Callout,
  Badge,
  EmptyState,
  ErrorText,
} from '@/components/ui';

export const metadata = { title: 'Documents' };

interface ExtractedFact {
  field: string;
  value: string;
  confidence: string;
  quote: string;
}

interface ExtractedEntity {
  type: string;
  value: string;
}

const ACCEPTED_TYPES = [
  'SOPs', 'employee handbooks', 'process documentation', 'spreadsheets', 'reports',
  'organisation charts', 'contracts', 'product information', 'customer FAQs',
  'marketing documents', 'sales scripts', 'job descriptions', 'policies', 'training material',
];

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ uploaded?: string; error?: string }>;
}) {
  const { orgId } = await params;
  const { uploaded, error } = await searchParams;

  const ctx = await requireOrg(orgId, 'documents.view');
  if (!ctx) notFound();

  const documents = await prisma.document.findMany({
    where: { organisationId: orgId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { chunks: true } } },
  });

  const canUpload = ctx.can('documents.upload');
  const totalChunks = documents.reduce((sum, d) => sum + d._count.chunks, 0);

  return (
    <>
      <PageHeader
        eyebrow="Understand the business"
        title="Documents"
        description="Upload what already describes how your business works. The platform reads each file, classifies it, extracts the facts it can quote, and makes it searchable so recommendations can cite their source."
      />

      {uploaded ? (
        <div className="mb-5">
          <Callout tone="positive" title="Documents processed">
            The extracted information has been added to your business knowledge model.
          </Callout>
        </div>
      ) : null}

      {canUpload ? (
        <div className="mb-6">
          <Card>
            <CardHeader
              title="Upload documents"
              description="PDF, Word, Excel, CSV, text and Markdown. Up to 20MB each. Your files are stored against your organisation only and are never shared with any other business."
            />
            <CardBody>
              <form action={uploadDocuments} className="space-y-4">
                <input type="hidden" name="organisationId" value={orgId} />
                {error ? <ErrorText>{decodeURIComponent(error)}</ErrorText> : null}

                <Field label="Choose files" help={`Useful documents include: ${ACCEPTED_TYPES.join(', ')}.`}>
                  <input
                    type="file"
                    name="files"
                    multiple
                    accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json,.html"
                    className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-raised file:px-3 file:py-1 file:text-[12px] file:text-ink`}
                    required
                  />
                </Field>

                <Button type="submit" tone="primary">
                  Upload and process
                </Button>
              </form>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description="Uploading even one procedure document materially improves the analysis: it lets the platform describe your processes in your own words and cite where each fact came from."
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge>{documents.length} documents</Badge>
            <Badge>{documents.filter((d) => d.status === 'PROCESSED').length} processed</Badge>
            <Badge>{totalChunks} searchable passages</Badge>
          </div>

          <div className="space-y-4">
            {documents.map((document) => {
              const facts = parseJson<ExtractedFact[]>(document.facts, []);
              const entities = parseJson<ExtractedEntity[]>(document.entities, []);
              const systems = entities.filter((e) => e.type === 'SYSTEM');

              return (
                <Card key={document.id}>
                  <CardBody>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium text-ink">{document.fileName}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <Badge
                            tone={
                              document.status === 'PROCESSED'
                                ? 'positive'
                                : document.status === 'FAILED'
                                  ? 'critical'
                                  : 'neutral'
                            }
                          >
                            {document.status === 'PROCESSED'
                              ? 'Processed'
                              : document.status === 'FAILED'
                                ? 'Could not read'
                                : 'Pending'}
                          </Badge>
                          <Badge tone="brand">
                            {DOCUMENT_CLASS_LABELS[document.classification as DocumentClass] ??
                              document.classification}
                          </Badge>
                          <span className="text-[11px] text-faint">
                            {document.classificationConfidence.toLowerCase()} confidence ·{' '}
                            {document.wordCount.toLocaleString()} words · {document._count.chunks} passages
                          </span>
                        </div>
                      </div>

                      {canUpload ? (
                        <div className="flex shrink-0 gap-2">
                          <form action={reprocessDocument}>
                            <input type="hidden" name="organisationId" value={orgId} />
                            <input type="hidden" name="documentId" value={document.id} />
                            <Button type="submit" tone="ghost">
                              Reprocess
                            </Button>
                          </form>
                          <form action={deleteDocument}>
                            <input type="hidden" name="organisationId" value={orgId} />
                            <input type="hidden" name="documentId" value={document.id} />
                            <Button type="submit" tone="danger">
                              Delete
                            </Button>
                          </form>
                        </div>
                      ) : null}
                    </div>

                    {document.error ? (
                      <p className="mt-3 text-[13px] text-critical">{document.error}</p>
                    ) : null}

                    {document.summary ? (
                      <p className="mt-3 text-[13px] leading-relaxed text-muted">{document.summary}</p>
                    ) : null}

                    {facts.length > 0 ? (
                      <div className="mt-4 border-t border-line pt-3">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
                          Facts extracted ({facts.length})
                        </p>
                        <ul className="space-y-1.5">
                          {facts.slice(0, 6).map((fact, i) => (
                            <li key={i} className="text-[12px] leading-relaxed">
                              <span className="font-medium text-ink">{fact.field}:</span>{' '}
                              <span className="text-muted">{fact.value}</span>
                              <span className="ml-1.5 text-faint">
                                — quoted from &ldquo;{fact.quote.slice(0, 90)}
                                {fact.quote.length > 90 ? '…' : ''}&rdquo;
                              </span>
                            </li>
                          ))}
                        </ul>
                        {facts.length > 6 ? (
                          <p className="mt-1.5 text-[12px] text-faint">
                            and {facts.length - 6} more.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {systems.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {systems.slice(0, 8).map((system) => (
                          <Badge key={system.value}>{system.value}</Badge>
                        ))}
                      </div>
                    ) : null}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
