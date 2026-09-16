import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { parseJson } from '@/lib/json';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Badge,
  EmptyState,
  LinkButton,
  Callout,
} from '@/components/ui';
import { HorizontalBarChart } from '@/components/charts';

export const metadata = { title: 'Process map' };

export default async function ProcessesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { orgId } = await params;
  const { error } = await searchParams;

  const ctx = await requireOrg(orgId, 'process.view');
  if (!ctx) notFound();

  const processes = await prisma.process.findMany({
    where: { organisationId: orgId },
    include: { department: true, _count: { select: { steps: true, problems: true } } },
    orderBy: [{ aiPotential: 'desc' }, { name: 'asc' }],
  });

  const canEdit = ctx.can('process.edit');
  const sized = processes.filter((p) => p.hoursPerWeek != null);
  const unsized = processes.length - sized.length;

  const chartData = sized
    .slice()
    .sort((a, b) => (b.hoursPerWeek ?? 0) - (a.hoursPerWeek ?? 0))
    .slice(0, 8)
    .map((p) => ({
      label: p.name,
      value: (p.hoursPerWeek ?? 0) * 46,
      meta: `${p.hoursPerWeek} hrs/week · AI potential ${p.aiPotential ?? 0}%`,
    }));

  return (
    <>
      <PageHeader
        eyebrow="Understand the business"
        title="Process map"
        description="Every process the platform knows about. Opportunities are found inside these, so the more accurately they are described, the better the analysis."
        actions={
          canEdit ? (
            <LinkButton href={`/app/${orgId}/processes/new`} tone="primary">
              Add a process
            </LinkButton>
          ) : null
        }
      />

      {error ? (
        <div className="mb-5">
          <Callout tone="critical" title="Could not save">
            {decodeURIComponent(error)}
          </Callout>
        </div>
      ) : null}

      {processes.length === 0 ? (
        <EmptyState
          title="No processes mapped yet"
          description="Complete the assessment to have processes created from your answers, or add one directly. At least one process is needed before an analysis can run."
          action={
            canEdit ? (
              <LinkButton href={`/app/${orgId}/processes/new`} tone="primary">
                Add your first process
              </LinkButton>
            ) : null
          }
        />
      ) : (
        <>
          {chartData.length > 0 ? (
            <div className="mb-6">
              <Card>
                <CardHeader
                  title="Where the time goes"
                  description="Estimated annual hours per process, based on the weekly hours recorded against each one."
                />
                <CardBody>
                  <HorizontalBarChart
                    data={chartData}
                    unit="hrs/year"
                    seriesLabel="Annual hours"
                  />
                </CardBody>
              </Card>
            </div>
          ) : null}

          {unsized > 0 ? (
            <div className="mb-5">
              <Callout tone="caution" title={`${unsized} process${unsized === 1 ? ' has' : 'es have'} no time recorded`}>
                A process with no hours against it cannot be sized, so any opportunity found in it
                will be low confidence. The AI interview asks for exactly these figures.
                <span className="mt-1 block">
                  <Link href={`/app/${orgId}/interview`} className="font-medium text-brand hover:underline">
                    Go to the interview
                  </Link>
                </span>
              </Callout>
            </div>
          ) : null}

          <div className="space-y-3">
            {processes.map((process) => {
              const systems = parseJson<string[]>(process.systemsUsed, []);
              return (
                <Card key={process.id}>
                  <CardBody>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/app/${orgId}/processes/${process.id}`}
                          className="text-[14px] font-medium text-ink hover:text-brand hover:underline"
                        >
                          {process.name}
                        </Link>
                        {process.description ? (
                          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
                            {process.description}
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {process.department ? <Badge>{process.department.name}</Badge> : null}
                          {process.frequency ? (
                            <Badge>{process.frequency.toLowerCase().replace('_', ' ')}</Badge>
                          ) : null}
                          <Badge tone={process.hoursPerWeek != null ? 'neutral' : 'caution'}>
                            {process.hoursPerWeek != null
                              ? `${process.hoursPerWeek} hrs/week`
                              : 'Time not recorded'}
                          </Badge>
                          {process._count.steps > 0 ? (
                            <Badge>{process._count.steps} steps</Badge>
                          ) : null}
                          {process._count.problems > 0 ? (
                            <Badge tone="serious">{process._count.problems} problems</Badge>
                          ) : null}
                          {process.editedByConsultant ? <Badge tone="brand">Consultant edited</Badge> : null}
                        </div>
                        {systems.length > 0 ? (
                          <p className="mt-2 text-[12px] text-faint">
                            Systems: {systems.join(', ')}
                          </p>
                        ) : null}
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-[11px] uppercase tracking-[0.06em] text-faint">AI potential</p>
                        <p className="tabular text-[20px] font-semibold text-ink">
                          {process.aiPotential ?? 0}%
                        </p>
                        <p className="text-[11px] text-faint">
                          automation {process.automationPotential ?? 0}%
                        </p>
                      </div>
                    </div>
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
