import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { getOrgSummary } from '@/lib/engine/summary';
import { fmtHours, fmtRange } from '@/lib/engine/report';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Badge,
  EmptyState,
  DataTable,
  ConfidenceBadge,
} from '@/components/ui';
import { StatGrid, StatTile, ProgressMeter } from '@/components/charts';

export const metadata = { title: 'Consultant dashboard' };

export default async function ConsultantDashboard() {
  const user = await requireUser();

  // A consultant sees the clients they are assigned to. A platform admin sees all.
  const organisationIds =
    user.platformRole === 'PLATFORM_ADMIN'
      ? (await prisma.organisation.findMany({ select: { id: true } })).map((o) => o.id)
      : user.memberships.filter((m) => m.role === 'CONSULTANT').map((m) => m.organisationId);

  if (organisationIds.length === 0) {
    return (
      <>
        <PageHeader title="Consultant dashboard" description="Your client businesses." />
        <EmptyState
          title="No clients assigned yet"
          description="A business owner adds you as a consultant from their organisation settings. Once added, their assessment, opportunities and projects appear here."
        />
      </>
    );
  }

  const summaries = await Promise.all(organisationIds.map((id) => getOrgSummary(id)));

  const [pendingReports, recentAlerts] = await Promise.all([
    prisma.report.findMany({
      where: { organisationId: { in: organisationIds }, status: 'CONSULTANT_REVIEW' },
      include: { organisation: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.aIOpportunity.findMany({
      where: {
        organisationId: { in: organisationIds },
        status: 'CONSULTANT_REVIEW',
      },
      include: { organisation: { select: { id: true, name: true } } },
      orderBy: { priorityScore: 'desc' },
      take: 12,
    }),
  ]);

  const totals = summaries.reduce(
    (acc, s) => ({
      opportunities: acc.opportunities + s.opportunityCount,
      projects: acc.projects + s.activeProjects,
      capacityLow: acc.capacityLow + s.capacityLowHrs,
      capacityHigh: acc.capacityHigh + s.capacityHighHrs,
    }),
    { opportunities: 0, projects: 0, capacityLow: 0, capacityHigh: 0 },
  );

  return (
    <>
      <PageHeader
        title="Consultant dashboard"
        description="Every client business, where each stands, and what is waiting on you."
      />

      <StatGrid cols={4}>
        <StatTile label="Clients" value={String(summaries.length)} caption="Businesses you are working with" />
        <StatTile
          label="Reports awaiting review"
          value={String(pendingReports.length)}
          caption="Generated and not yet approved"
          tone={pendingReports.length > 0 ? 'caution' : 'neutral'}
        />
        <StatTile
          label="Opportunities to review"
          value={String(recentAlerts.length)}
          caption="Not yet released to a client"
        />
        <StatTile
          label="Active projects"
          value={String(totals.projects)}
          caption={`${totals.opportunities} opportunities identified in total`}
        />
      </StatGrid>

      {pendingReports.length > 0 ? (
        <div className="mt-6">
          <Card>
            <CardHeader
              title="Reports awaiting your review"
              description="A generated report is not shown to the client as final until you approve it."
            />
            <CardBody>
              <ul className="space-y-2">
                {pendingReports.map((report) => (
                  <li key={report.id} className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/app/${report.organisationId}/reports/${report.id}`}
                        className="text-[13px] font-medium text-ink hover:text-brand hover:underline"
                      >
                        {report.title}
                      </Link>
                      <span className="ml-2 text-[12px] text-faint">
                        {report.organisation.name} · v{report.version} ·{' '}
                        {report.createdAt.toLocaleDateString('en-GB', { dateStyle: 'medium' })}
                      </span>
                    </div>
                    <Badge tone="caution">Awaiting review</Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">Clients</h2>

        {summaries.map((s) => (
          <Card key={s.organisationId}>
            <CardBody>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/app/${s.organisationId}`}
                    className="text-[15px] font-medium text-ink hover:text-brand hover:underline"
                  >
                    {s.organisationName}
                  </Link>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge
                      tone={
                        s.assessmentStatus === 'COMPLETE'
                          ? 'positive'
                          : s.assessmentStatus === 'IN_PROGRESS'
                            ? 'caution'
                            : 'neutral'
                      }
                    >
                      Assessment: {s.assessmentStatus.replace(/_/g, ' ').toLowerCase()}
                    </Badge>
                    <Badge tone="brand">AI maturity {s.aiMaturity}/5</Badge>
                    <Badge>{s.opportunityCount} opportunities</Badge>
                    <Badge>{s.activeProjects} projects</Badge>
                    {s.notRecommendedCount > 0 ? (
                      <Badge tone="serious">{s.notRecommendedCount} not recommended</Badge>
                    ) : null}
                    {s.awaitingClientDecision > 0 ? (
                      <Badge tone="caution">{s.awaitingClientDecision} awaiting client decision</Badge>
                    ) : null}
                    {s.reportsAwaitingReview > 0 ? (
                      <Badge tone="caution">{s.reportsAwaitingReview} reports to review</Badge>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <ProgressMeter value={s.completeness} label="Information completeness" />
                    <div className="text-[12px]">
                      <p className="text-faint">Estimated capacity and value</p>
                      <p className="tabular mt-0.5 text-ink">
                        {s.capacityHighHrs > 0
                          ? `${fmtHours(s.capacityLowHrs, s.capacityHighHrs)} · ${fmtRange(s.valueLow, s.valueHigh, s.currency)}`
                          : 'Not yet estimated'}
                      </p>
                    </div>
                  </div>

                  {s.nextAction ? (
                    <p className="mt-3 rounded-lg border-l-2 border-brand/40 bg-raised px-3 py-2 text-[12px] leading-relaxed text-muted">
                      <span className="font-medium text-ink">Next: </span>
                      {s.nextAction.label} — {s.nextAction.reason}
                    </p>
                  ) : null}

                  {s.km.completeness.criticalGaps.length > 0 ? (
                    <p className="mt-2 text-[12px] leading-relaxed text-faint">
                      <span className="font-medium text-ink">Blocking confidence: </span>
                      {s.km.completeness.criticalGaps[0]}
                    </p>
                  ) : null}
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-[11px] uppercase tracking-[0.06em] text-faint">Performance</p>
                  <p className="tabular text-[20px] font-semibold text-ink">
                    {s.performanceAttainment !== null
                      ? `${Math.round(s.performanceAttainment * 100)}%`
                      : '—'}
                  </p>
                  <p className="text-[11px] text-faint">
                    {s.measuredKpis} of {s.totalKpis} KPIs measured
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {recentAlerts.length > 0 ? (
        <div className="mt-6">
          <Card>
            <CardHeader
              title="Opportunities to review"
              description="These have been generated but not yet released to a client. You can edit any of them before the client sees it."
            />
            <CardBody>
              <DataTable
                columns={['Opportunity', 'Client', 'Priority', 'Confidence', 'Phase']}
                align={[2]}
                rows={recentAlerts.map((opportunity) => [
                  <Link
                    key={opportunity.id}
                    href={`/app/${opportunity.organisationId}/opportunities/${opportunity.id}`}
                    className="font-medium text-brand hover:underline"
                  >
                    {opportunity.name}
                  </Link>,
                  opportunity.organisation.name,
                  opportunity.priorityScore.toFixed(1),
                  <ConfidenceBadge key={`c-${opportunity.id}`} level={opportunity.confidence} />,
                  opportunity.priorityBand.replace(/_/g, ' ').toLowerCase(),
                ])}
              />
            </CardBody>
          </Card>
        </div>
      ) : null}
    </>
  );
}
