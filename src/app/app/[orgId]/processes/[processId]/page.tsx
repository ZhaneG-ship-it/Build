import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { parseJson } from '@/lib/json';
import { deleteProcess, saveProcessSteps } from '@/app/actions/processes';
import { ProcessForm } from '@/components/process-form';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Badge,
  Button,
  Callout,
  inputClass,
  LinkButton,
} from '@/components/ui';

export const metadata = { title: 'Process' };

const BLANK_STEPS = 3;

export default async function ProcessDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; processId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { orgId, processId } = await params;
  const { saved } = await searchParams;

  const ctx = await requireOrg(orgId, 'process.view');
  if (!ctx) notFound();

  const process = await prisma.process.findFirst({
    where: { id: processId, organisationId: orgId },
    include: {
      steps: { orderBy: { order: 'asc' } },
      problems: true,
      opportunities: { include: { calculation: true } },
      department: true,
    },
  });
  if (!process) notFound();

  const departments = await prisma.department.findMany({
    where: { organisationId: orgId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  const canEdit = ctx.can('process.edit');
  const systems = parseJson<string[]>(process.systemsUsed, []);

  const stepRows = [
    ...process.steps,
    ...Array.from({ length: BLANK_STEPS }, () => null),
  ];

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/app/${orgId}/processes`} className="hover:underline">
            Process map
          </Link>
        }
        title={process.name}
        description={process.description ?? undefined}
        actions={
          <>
            <LinkButton href={`/app/${orgId}/processes`}>Back to all processes</LinkButton>
            {canEdit ? (
              <form action={deleteProcess}>
                <input type="hidden" name="organisationId" value={orgId} />
                <input type="hidden" name="processId" value={process.id} />
                <Button type="submit" tone="danger">
                  Delete
                </Button>
              </form>
            ) : null}
          </>
        }
      />

      {saved ? (
        <div className="mb-5">
          <Callout tone="positive" title="Saved">
            {saved === 'steps'
              ? 'The step map has been saved and is now protected from being regenerated.'
              : 'The process has been saved and its AI potential recalculated.'}
          </Callout>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        {process.department ? <Badge>{process.department.name}</Badge> : null}
        <Badge tone="brand">AI potential {process.aiPotential ?? 0}%</Badge>
        <Badge>Automation potential {process.automationPotential ?? 0}%</Badge>
        <Badge tone={process.hoursPerWeek != null ? 'neutral' : 'caution'}>
          {process.hoursPerWeek != null ? `${process.hoursPerWeek} hrs/week` : 'Time not recorded'}
        </Badge>
        <Badge>Source: {process.source.toLowerCase()}</Badge>
        <Badge>{process.confidence.toLowerCase()} confidence</Badge>
        {systems.length ? <Badge>{systems.join(', ')}</Badge> : null}
      </div>

      {process.problems.length > 0 ? (
        <div className="mb-6">
          <Card>
            <CardHeader
              title="Problems identified in this process"
              description="Each one comes from the assessment, a document, or the process analysis."
            />
            <CardBody>
              <ul className="space-y-3">
                {process.problems.map((problem) => (
                  <li key={problem.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-medium text-ink">{problem.title}</p>
                      <Badge
                        tone={
                          problem.severity === 'CRITICAL' || problem.severity === 'HIGH'
                            ? 'critical'
                            : 'caution'
                        }
                      >
                        {problem.severity.toLowerCase()}
                      </Badge>
                      <Badge>{problem.category.replace(/_/g, ' ').toLowerCase()}</Badge>
                    </div>
                    {problem.description ? (
                      <p className="mt-1 text-[13px] leading-relaxed text-muted">{problem.description}</p>
                    ) : null}
                    {problem.rootCause ? (
                      <p className="mt-1 text-[12px] text-faint">Root cause: {problem.rootCause}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {process.opportunities.length > 0 ? (
        <div className="mb-6">
          <Card>
            <CardHeader title="Opportunities from this process" />
            <CardBody>
              <ul className="space-y-2">
                {process.opportunities.map((opportunity) => (
                  <li key={opportunity.id}>
                    <Link
                      href={`/app/${orgId}/opportunities/${opportunity.id}`}
                      className="text-[13px] font-medium text-brand hover:underline"
                    >
                      {opportunity.name}
                    </Link>
                    <span className="ml-2 text-[12px] text-faint">
                      {opportunity.recommendation === 'NOT_RECOMMENDED'
                        ? 'AI not recommended'
                        : `priority ${opportunity.priorityScore.toFixed(1)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      ) : null}

      <div className="mb-6">
        <Card>
          <CardHeader
            title="Step map"
            description="The steps this process is actually made of. Mark the ones where work waits, and the ones that follow rules rather than judgement."
          />
          <CardBody>
            {canEdit ? (
              <form action={saveProcessSteps} className="space-y-3">
                <input type="hidden" name="organisationId" value={orgId} />
                <input type="hidden" name="processId" value={process.id} />

                {stepRows.map((step, index) => (
                  <div
                    key={step?.id ?? `blank-${index}`}
                    className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1.5fr_1fr_1fr_80px]"
                  >
                    <input
                      name="stepName"
                      defaultValue={step?.name ?? ''}
                      placeholder={`Step ${index + 1}`}
                      className={inputClass}
                    />
                    <input
                      name="stepRole"
                      defaultValue={step?.role ?? ''}
                      placeholder="Who does it"
                      className={inputClass}
                    />
                    <input
                      name="stepSystem"
                      defaultValue={step?.systemUsed ?? ''}
                      placeholder="System used"
                      className={inputClass}
                    />
                    <input
                      name="stepDuration"
                      type="number"
                      min="0"
                      defaultValue={step?.durationMins ?? ''}
                      placeholder="Mins"
                      className={`${inputClass} tabular`}
                    />
                    <input type="hidden" name="stepDescription" value={step?.description ?? ''} />

                    <div className="flex flex-wrap gap-3 sm:col-span-4">
                      {[
                        { name: 'stepManual', label: 'Manual', checked: step?.isManual ?? true },
                        { name: 'stepBottleneck', label: 'Work waits here', checked: step?.isBottleneck ?? false },
                        { name: 'stepAutomatable', label: 'Rules-based', checked: step?.automatable ?? false },
                      ].map((flag) => (
                        <label key={flag.name} className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                          <input
                            type="checkbox"
                            name={flag.name}
                            value={index}
                            defaultChecked={flag.checked}
                            className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
                          />
                          {flag.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}

                <Button type="submit" tone="secondary">
                  Save step map
                </Button>
              </form>
            ) : process.steps.length ? (
              <ol className="space-y-2">
                {process.steps.map((step, index) => (
                  <li key={step.id} className="flex gap-3 text-[13px]">
                    <span className="tabular text-faint">{index + 1}.</span>
                    <span>
                      <span className="text-ink">{step.name}</span>
                      {step.isBottleneck ? (
                        <Badge tone="serious" className="ml-2">
                          Work waits here
                        </Badge>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-faint">No steps recorded yet.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {canEdit ? (
        <ProcessForm
          organisationId={orgId}
          departments={departments}
          values={{
            id: process.id,
            name: process.name,
            description: process.description ?? '',
            departmentId: process.departmentId ?? '',
            owner: process.owner ?? '',
            trigger: process.trigger ?? '',
            frequency: process.frequency ?? '',
            employeesInvolved: process.employeesInvolved?.toString() ?? '',
            hoursPerWeek: process.hoursPerWeek?.toString() ?? '',
            avgDurationMins: process.avgDurationMins?.toString() ?? '',
            volumePerPeriod: process.volumePerPeriod?.toString() ?? '',
            inputs: process.inputs ?? '',
            outputs: process.outputs ?? '',
            errorRate: process.errorRate?.toString() ?? '',
            errorImpact: process.errorImpact ?? '',
            delayDescription: process.delayDescription ?? '',
            customerImpact: process.customerImpact ?? '',
            revenueImpact: process.revenueImpact ?? '',
            manualScore: process.manualScore?.toString() ?? '3',
            repetitivenessScore: process.repetitivenessScore?.toString() ?? '3',
            dataReadiness: process.dataReadiness?.toString() ?? '3',
            riskLevel: process.riskLevel,
            systemsUsed: systems.join(', '),
          }}
        />
      ) : null}
    </>
  );
}
