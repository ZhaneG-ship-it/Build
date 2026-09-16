import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { runAnalysisAction } from '@/app/actions/analysis';
import { Card, CardBody, PageHeader, Badge, Button, EmptyState } from '@/components/ui';

export const metadata = { title: 'Reports' };

const STATUS_TONE: Record<string, 'neutral' | 'brand' | 'positive' | 'caution'> = {
  DRAFT: 'neutral',
  CONSULTANT_REVIEW: 'caution',
  APPROVED: 'brand',
  PUBLISHED: 'positive',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  CONSULTANT_REVIEW: 'Awaiting consultant review',
  APPROVED: 'Approved',
  PUBLISHED: 'Published',
};

export default async function ReportsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requireOrg(orgId, 'report.view');
  if (!ctx) notFound();

  const [reports, processCount] = await Promise.all([
    prisma.report.findMany({ where: { organisationId: orgId }, orderBy: { createdAt: 'desc' } }),
    prisma.process.count({ where: { organisationId: orgId } }),
  ]);

  const canRun = ctx.can('analysis.run');

  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="Reports"
        description="Each analysis run produces a versioned AI Opportunity Report. Earlier versions are kept so you can see how the picture changed."
        actions={
          canRun ? (
            <form action={runAnalysisAction}>
              <input type="hidden" name="organisationId" value={orgId} />
              <Button type="submit" tone="primary" disabled={processCount === 0}>
                Generate a new report
              </Button>
            </form>
          ) : null
        }
      />

      {reports.length === 0 ? (
        <EmptyState
          title="No reports yet"
          description={
            processCount === 0
              ? 'Map at least one business process, then run the analysis to produce your first report.'
              : 'Run the AI opportunity analysis to produce your first report.'
          }
        />
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <Card key={report.id}>
              <CardBody className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link
                    href={`/app/${orgId}/reports/${report.id}`}
                    className="text-[14px] font-medium text-ink hover:text-brand hover:underline"
                  >
                    {report.title}
                  </Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[report.status] ?? 'neutral'}>
                      {STATUS_LABEL[report.status] ?? report.status}
                    </Badge>
                    <Badge>Version {report.version}</Badge>
                    <Badge>
                      {report.generatedBy === 'llm' ? 'Claude-assisted' : 'Analysis engine'}
                    </Badge>
                    <span className="text-[11px] text-faint">
                      {report.createdAt.toLocaleString('en-GB', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>
                  {report.summary ? (
                    <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted">
                      {report.summary}
                    </p>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
