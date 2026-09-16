import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { parseJson } from '@/lib/json';
import { METRIC_LABELS, type MetricKey } from '@/lib/types';
import { compareKpis } from '@/lib/ai/agents/performance';
import {
  recordKpiResult,
  createKpi,
  generatePerformanceReview,
} from '@/app/actions/performance';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Badge,
  Button,
  Callout,
  EmptyState,
  Field,
  inputClass,
  DataTable,
  LinkButton,
} from '@/components/ui';
import { HorizontalBarChart, StatGrid, StatTile } from '@/components/charts';

export const metadata = { title: 'Performance' };

const VERDICT_TONE: Record<string, 'positive' | 'caution' | 'critical' | 'neutral'> = {
  EXCEEDING: 'positive',
  ON_TRACK: 'positive',
  BELOW: 'critical',
  INCONCLUSIVE: 'caution',
};

const VERDICT_LABEL: Record<string, string> = {
  EXCEEDING: 'Exceeding projection',
  ON_TRACK: 'On track',
  BELOW: 'Below projection',
  INCONCLUSIVE: 'Not enough data',
};

export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ recorded?: string; created?: string; error?: string }>;
}) {
  const { orgId } = await params;
  const { recorded, created, error } = await searchParams;

  const ctx = await requireOrg(orgId, 'kpi.view');
  if (!ctx) notFound();

  const [kpis, implementations, reviews, projects] = await Promise.all([
    prisma.kpi.findMany({
      where: { organisationId: orgId },
      include: {
        results: { orderBy: { periodEnd: 'desc' } },
        opportunity: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.aIImplementation.findMany({
      where: { organisationId: orgId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.aIReview.findMany({
      where: { organisationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: { implementation: { select: { name: true } } },
    }),
    prisma.project.findMany({
      where: { organisationId: orgId },
      select: { id: true, name: true },
    }),
  ]);

  const canRecord = ctx.can('kpi.record');
  const canManage = ctx.can('kpi.manage');

  const comparisons = compareKpis(
    kpis.map((k) => ({
      name: k.name,
      metricKey: k.metricKey,
      unit: k.unit,
      direction: k.direction,
      baselineValue: k.baselineValue,
      projectedValue: k.projectedValue,
      results: k.results.map((r) => ({ actualValue: r.actualValue, periodEnd: r.periodEnd })),
    })),
  );
  const measured = comparisons.filter((c) => c.attainment != null);
  const attainment = measured.length
    ? measured.reduce((s, c) => s + (c.attainment ?? 0), 0) / measured.length
    : null;

  // Only KPIs sharing a unit and scale are charted together, never mixed axes.
  const hoursKpis = comparisons.filter(
    (c) => c.metricKey === 'HOURS_SAVED' && c.projected != null && c.actual != null,
  );

  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        title="AI performance"
        description="What was projected against what actually happened. Figures are only shown once they have been recorded — nothing here is inferred."
        actions={
          <form action={generatePerformanceReview}>
            <input type="hidden" name="organisationId" value={orgId} />
            <Button type="submit" tone="primary" disabled={kpis.length === 0}>
              Generate performance review
            </Button>
          </form>
        }
      />

      {recorded ? (
        <div className="mb-5">
          <Callout tone="positive" title="Result recorded">
            The projected-versus-actual comparison has been updated.
          </Callout>
        </div>
      ) : null}
      {created ? (
        <div className="mb-5">
          <Callout tone="positive" title="KPI created">
            Record results against it each period to build the comparison.
          </Callout>
        </div>
      ) : null}
      {error ? (
        <div className="mb-5">
          <Callout tone="critical" title="Could not record">
            {decodeURIComponent(error)}
          </Callout>
        </div>
      ) : null}

      {kpis.length === 0 ? (
        <EmptyState
          title="No KPIs defined yet"
          description="KPIs are created automatically when an opportunity is identified, so the way success will be measured is agreed before anything is built."
          action={
            <LinkButton href={`/app/${orgId}/opportunities`} tone="primary">
              Go to opportunities
            </LinkButton>
          }
        />
      ) : (
        <>
          <StatGrid cols={4}>
            <StatTile
              label="Live AI systems"
              value={String(implementations.filter((i) => i.status === 'LIVE').length)}
              caption={`${implementations.length} recorded in total`}
            />
            <StatTile label="KPIs defined" value={String(kpis.length)} caption="Across all opportunities" />
            <StatTile
              label="KPIs with results"
              value={`${measured.length} of ${comparisons.length}`}
              caption="Comparison needs a baseline, a projection and an actual"
              tone={measured.length === 0 ? 'caution' : 'neutral'}
            />
            <StatTile
              label="Projection delivered"
              value={attainment !== null ? `${Math.round(attainment * 100)}%` : 'Not measurable'}
              caption={
                attainment !== null
                  ? 'Average share of projected movement achieved'
                  : 'Record actual figures to measure this'
              }
              tone={attainment !== null && attainment >= 0.75 ? 'positive' : 'neutral'}
            />
          </StatGrid>

          {hoursKpis.length > 0 ? (
            <div className="mt-6">
              <Card>
                <CardHeader
                  title="Hours: projected against actual"
                  description="Only metrics sharing the same unit and scale are compared on one axis."
                />
                <CardBody>
                  <HorizontalBarChart
                    data={hoursKpis.map((c) => ({
                      label: c.name,
                      value: c.projected ?? 0,
                      compareValue: c.actual ?? 0,
                      meta: c.attainment != null ? `${Math.round(c.attainment * 100)}% of projection` : undefined,
                    }))}
                    unit="hrs/month"
                    seriesLabel="Projected"
                    compareLabel="Actual"
                  />
                </CardBody>
              </Card>
            </div>
          ) : null}

          <div className="mt-6">
            <Card>
              <CardHeader title="All KPIs" />
              <CardBody>
                <DataTable
                  columns={['KPI', 'Unit', 'Better when', 'Baseline', 'Projected', 'Latest actual', 'Delivered']}
                  align={[3, 4, 5, 6]}
                  rows={comparisons.map((c) => [
                    c.name,
                    c.unit || '—',
                    c.direction === 'DECREASE' ? 'lower' : 'higher',
                    c.baseline != null ? String(c.baseline) : 'not recorded',
                    c.projected != null ? String(c.projected) : '—',
                    c.actual != null ? String(c.actual) : 'not recorded',
                    c.attainment != null ? `${Math.round(c.attainment * 100)}%` : 'not measurable',
                  ])}
                  caption="Delivered is the share of the projected movement achieved so far."
                />
              </CardBody>
            </Card>
          </div>

          {canRecord ? (
            <div className="mt-6">
              <Card>
                <CardHeader
                  title="Record an actual result"
                  description="Enter the real figure for a period. This is what turns a projection into evidence."
                />
                <CardBody>
                  <form action={recordKpiResult} className="grid gap-4 sm:grid-cols-2">
                    <input type="hidden" name="organisationId" value={orgId} />
                    <Field label="KPI" required>
                      <select name="kpiId" className={inputClass} required>
                        {kpis.map((kpi) => (
                          <option key={kpi.id} value={kpi.id}>
                            {kpi.name}
                            {kpi.unit ? ` (${kpi.unit})` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Actual value" required>
                      <input
                        name="actualValue"
                        type="number"
                        step="any"
                        className={`${inputClass} tabular`}
                        required
                      />
                    </Field>
                    <Field label="Period start">
                      <input name="periodStart" type="date" className={inputClass} />
                    </Field>
                    <Field label="Period end">
                      <input name="periodEnd" type="date" className={inputClass} />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Note">
                        <input name="note" className={inputClass} placeholder="Anything that explains this figure" />
                      </Field>
                    </div>
                    <div>
                      <Button type="submit" tone="primary">
                        Record result
                      </Button>
                    </div>
                  </form>
                </CardBody>
              </Card>
            </div>
          ) : null}

          {canManage ? (
            <div className="mt-6">
              <Card>
                <CardHeader title="Add a KPI" description="For anything the automatic KPIs do not cover." />
                <CardBody>
                  <form action={createKpi} className="grid gap-4 sm:grid-cols-3">
                    <input type="hidden" name="organisationId" value={orgId} />
                    <div className="sm:col-span-3">
                      <Field label="Name" required>
                        <input name="name" className={inputClass} required />
                      </Field>
                    </div>
                    <Field label="Metric type">
                      <select name="metricKey" defaultValue="CUSTOM" className={inputClass}>
                        {(Object.keys(METRIC_LABELS) as MetricKey[]).map((key) => (
                          <option key={key} value={key}>
                            {METRIC_LABELS[key]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Unit">
                      <input name="unit" className={inputClass} placeholder="hours/month" />
                    </Field>
                    <Field label="Better when">
                      <select name="direction" defaultValue="INCREASE" className={inputClass}>
                        <option value="INCREASE">Higher</option>
                        <option value="DECREASE">Lower</option>
                      </select>
                    </Field>
                    <Field label="Baseline">
                      <input name="baselineValue" type="number" step="any" className={`${inputClass} tabular`} />
                    </Field>
                    <Field label="Projected">
                      <input name="projectedValue" type="number" step="any" className={`${inputClass} tabular`} />
                    </Field>
                    <Field label="Project">
                      <select name="projectId" defaultValue="" className={inputClass}>
                        <option value="">Not linked</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="sm:col-span-3">
                      <Button type="submit" tone="secondary">
                        Add KPI
                      </Button>
                    </div>
                  </form>
                </CardBody>
              </Card>
            </div>
          ) : null}

          {reviews.length > 0 ? (
            <div className="mt-6">
              <Card>
                <CardHeader title="Performance reviews" description="Generated comparisons of projected against actual." />
                <CardBody className="space-y-5">
                  {reviews.map((review) => {
                    const recommendations = parseJson<string[]>(review.recommendations, []);
                    return (
                      <div key={review.id} className="border-b border-line pb-4 last:border-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={VERDICT_TONE[review.verdict] ?? 'neutral'}>
                            {VERDICT_LABEL[review.verdict] ?? review.verdict}
                          </Badge>
                          <span className="text-[12px] text-faint">
                            {review.implementation?.name ?? 'All implementations'} ·{' '}
                            {review.periodStart.toLocaleDateString('en-GB', {
                              month: 'long',
                              year: 'numeric',
                            })}
                          </span>
                        </div>
                        {review.narrative ? (
                          <p className="mt-2 text-[13px] leading-relaxed text-muted">{review.narrative}</p>
                        ) : null}
                        {recommendations.length > 0 ? (
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-muted">
                            {recommendations.map((recommendation, i) => (
                              <li key={i}>{recommendation}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
