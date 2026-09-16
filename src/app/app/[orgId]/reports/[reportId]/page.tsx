import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { parseJson } from '@/lib/json';
import type { ReportContent } from '@/lib/engine/report';
import { publishReport, editReportSection } from '@/app/actions/opportunities';
import { ReportView } from '@/components/report-view';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Badge,
  Button,
  Callout,
  Field,
  inputClass,
  LinkButton,
} from '@/components/ui';

export const metadata = { title: 'Report' };

export default async function ReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; reportId: string }>;
  searchParams: Promise<{ published?: string; edited?: string }>;
}) {
  const { orgId, reportId } = await params;
  const { published, edited } = await searchParams;

  const ctx = await requireOrg(orgId, 'report.view');
  if (!ctx) notFound();

  const report = await prisma.report.findFirst({
    where: { id: reportId, organisationId: orgId },
  });
  if (!report) notFound();

  const content = parseJson<ReportContent | null>(report.content, null);
  if (!content) notFound();

  const consultantEdits = parseJson<Record<string, string>>(report.consultantEdits, {});
  const canEdit = ctx.can('report.edit');
  const canApprove = ctx.can('report.approve');

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/app/${orgId}/reports`} className="hover:underline">
            Reports
          </Link>
        }
        title={report.title}
        description={content.confidenceNote}
        actions={
          <>
            <LinkButton href={`/app/${orgId}/roadmap`}>View roadmap</LinkButton>
            {canApprove && report.status !== 'PUBLISHED' ? (
              <form action={publishReport}>
                <input type="hidden" name="organisationId" value={orgId} />
                <input type="hidden" name="reportId" value={report.id} />
                <Button type="submit" tone="primary">
                  Approve and publish
                </Button>
              </form>
            ) : null}
          </>
        }
      />

      {published ? (
        <div className="mb-5 no-print">
          <Callout tone="positive" title="Report published">
            The client can now see this report.
          </Callout>
        </div>
      ) : null}
      {edited ? (
        <div className="mb-5 no-print">
          <Callout tone="positive" title="Commentary saved">
            Your commentary now appears at the top of that section.
          </Callout>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-1.5">
        <Badge tone={report.status === 'PUBLISHED' ? 'positive' : 'caution'}>
          {report.status.replace(/_/g, ' ').toLowerCase()}
        </Badge>
        <Badge>Version {report.version}</Badge>
        <Badge>{report.generatedBy === 'llm' ? 'Claude-assisted' : 'Analysis engine'}</Badge>
        <Badge>
          Generated {new Date(content.generatedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}
        </Badge>
      </div>

      <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
        <nav className="no-print" aria-label="Report contents">
          <div className="sticky top-[90px]">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
              Contents
            </p>
            <ol className="space-y-1">
              {content.sections.map((section, index) => (
                <li key={section.key}>
                  <a
                    href={`#${section.key}`}
                    className="flex gap-2 rounded-lg px-2 py-1 text-[12px] text-muted transition hover:bg-raised hover:text-ink"
                  >
                    <span className="tabular text-faint">{index + 1}</span>
                    <span>{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <div className="min-w-0">
          <ReportView content={content} orgId={orgId} consultantEdits={consultantEdits} />

          {canEdit ? (
            <div className="mt-10 no-print">
              <Card>
                <CardHeader
                  title="Consultant commentary"
                  description="Add your own wording to any section. It appears at the top of that section, above the generated content, and is never overwritten."
                />
                <CardBody>
                  <form action={editReportSection} className="space-y-4">
                    <input type="hidden" name="organisationId" value={orgId} />
                    <input type="hidden" name="reportId" value={report.id} />

                    <Field label="Section">
                      <select name="sectionKey" className={inputClass}>
                        {content.sections.map((section) => (
                          <option key={section.key} value={section.key}>
                            {section.title}
                            {consultantEdits[section.key] ? ' (has commentary)' : ''}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Your commentary" help="Leave blank to remove existing commentary.">
                      <textarea name="replacement" rows={5} className={inputClass} />
                    </Field>

                    <Button type="submit" tone="secondary">
                      Save commentary
                    </Button>
                  </form>
                </CardBody>
              </Card>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
