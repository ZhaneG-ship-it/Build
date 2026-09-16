import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/tenancy';
import { getOrgSummary } from '@/lib/engine/summary';
import { fmtRange, fmtHours } from '@/lib/engine/report';
import { Card, CardBody, CardHeader, PageHeader, LinkButton, Callout, Badge } from '@/components/ui';
import { StatGrid, StatTile, MaturityRing, PhaseDistribution, ProgressMeter } from '@/components/charts';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requireOrg(orgId);
  if (!ctx) notFound();

  const s = await getOrgSummary(orgId);
  const cur = s.currency;

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={s.organisationName}
        description="Where this business stands with AI today, and the single most useful thing to do next."
        actions={
          s.latestReportId ? (
            <LinkButton href={`/app/${orgId}/reports/${s.latestReportId}`} tone="secondary">
              Latest report
            </LinkButton>
          ) : null
        }
      />

      {s.nextAction ? (
        <div className="mb-6">
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
                  Next step
                </p>
                <p className="mt-1 text-[15px] font-medium text-ink">{s.nextAction.label}</p>
                <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
                  {s.nextAction.reason}
                </p>
              </div>
              <LinkButton href={s.nextAction.href} tone="primary">
                Continue
              </LinkButton>
            </CardBody>
          </Card>
        </div>
      ) : null}

      <StatGrid cols={4}>
        <StatTile
          label="Opportunities"
          value={String(s.opportunityCount)}
          caption={
            s.notRecommendedCount > 0
              ? `${s.notRecommendedCount} assessed and not recommended`
              : 'Identified across your processes'
          }
        />
        <StatTile
          label="Active projects"
          value={String(s.activeProjects)}
          caption={`${s.liveImplementations} AI system${s.liveImplementations === 1 ? '' : 's'} live`}
        />
        <StatTile
          label="Potential capacity"
          value={s.capacityHighHrs > 0 ? fmtHours(s.capacityLowHrs, s.capacityHighHrs) : 'Not yet estimated'}
          caption="Estimated hours per year, across recommended opportunities"
          tone={s.capacityHighHrs > 0 ? 'positive' : 'neutral'}
        />
        <StatTile
          label="Estimated value"
          value={s.valueHigh > 0 ? fmtRange(s.valueLow, s.valueHigh, cur) : 'Not yet estimated'}
          caption="Value of released capacity. An estimate, not a guarantee."
          tone={s.valueHigh > 0 ? 'positive' : 'neutral'}
        />
      </StatGrid>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="AI maturity"
            description="Where this business currently sits, from no structured use through to a managed capability."
          />
          <CardBody>
            <MaturityRing level={s.aiMaturity} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="What the platform knows"
            description="How complete the picture of your business is."
          />
          <CardBody className="space-y-4">
            <ProgressMeter value={s.completeness} label="Overall completeness" />
            <div className="space-y-2.5 border-t border-line pt-4">
              {Object.entries(s.km.completeness.byArea)
                .sort((a, b) => a[1].score - b[1].score)
                .slice(0, 5)
                .map(([area, detail]) => (
                  <div key={area}>
                    <ProgressMeter
                      value={detail.score}
                      label={area.charAt(0).toUpperCase() + area.slice(1)}
                    />
                  </div>
                ))}
            </div>
          </CardBody>
        </Card>
      </div>

      {s.km.completeness.criticalGaps.length > 0 ? (
        <div className="mt-6">
          <Callout tone="caution" title="These gaps are limiting confidence in the figures">
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {s.km.completeness.criticalGaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
            <p className="mt-2">
              <Link href={`/app/${orgId}/interview`} className="font-medium text-brand hover:underline">
                Answer the outstanding questions
              </Link>
            </p>
          </Callout>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Roadmap"
            description="How the recommended opportunities are sequenced."
            action={
              <LinkButton href={`/app/${orgId}/roadmap`} tone="ghost">
                View
              </LinkButton>
            }
          />
          <CardBody>
            <PhaseDistribution
              phases={[
                { label: 'Phase 1', count: s.phaseCounts.phase1, description: 'start here' },
                { label: 'Phase 2', count: s.phaseCounts.phase2, description: 'next' },
                { label: 'Phase 3', count: s.phaseCounts.phase3, description: 'later' },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Performance"
            description="Projected against actual, once results are recorded."
            action={
              <LinkButton href={`/app/${orgId}/performance`} tone="ghost">
                View
              </LinkButton>
            }
          />
          <CardBody>
            {s.performanceAttainment === null ? (
              <p className="py-4 text-[13px] leading-relaxed text-muted">
                No actual results recorded yet.{' '}
                {s.totalKpis > 0
                  ? `${s.totalKpis} KPI${s.totalKpis === 1 ? ' is' : 's are'} defined and waiting for figures.`
                  : 'KPIs are created automatically when an opportunity is identified.'}
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-[22px] font-semibold tracking-tight text-ink">
                  {Math.round(s.performanceAttainment * 100)}%
                </p>
                <p className="text-[13px] leading-relaxed text-muted">
                  of the projected improvement delivered so far, across {s.measuredKpis} measured
                  KPI{s.measuredKpis === 1 ? '' : 's'} of {s.totalKpis}.
                </p>
                <ProgressMeter value={Math.min(1, s.performanceAttainment)} showPercent={false} />
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="Evidence behind the analysis" />
          <CardBody>
            <div className="flex flex-wrap gap-2">
              <Badge>{s.km.processes.length} processes mapped</Badge>
              <Badge>{s.km.problems.length} problems identified</Badge>
              <Badge>{s.documentsProcessed} documents processed</Badge>
              <Badge>{s.km.interviewFacts.length} interview answers</Badge>
              <Badge>{s.km.technology.systems.length} systems recorded</Badge>
              <Badge>{s.km.objectives.length} objectives</Badge>
              <Badge>Knowledge model v{s.km.version}</Badge>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
