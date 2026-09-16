import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { fmtHours, fmtRange } from '@/lib/engine/report';
import { recordClientDecision } from '@/app/actions/opportunities';
import { createProjectFromOpportunity } from '@/app/actions/projects';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Badge,
  Button,
  EmptyState,
  ConfidenceBadge,
  LinkButton,
} from '@/components/ui';
import { PhaseDistribution } from '@/components/charts';

export const metadata = { title: 'Roadmap' };

const PHASE_META: Record<string, { title: string; description: string }> = {
  PHASE_1: {
    title: 'Phase 1 — start here',
    description: 'Clear benefit, contained implementation, low risk. These prove the approach.',
  },
  PHASE_2: {
    title: 'Phase 2 — next',
    description: 'Worthwhile, but either more involved or dependent on something from Phase 1.',
  },
  PHASE_3: {
    title: 'Phase 3 — later',
    description: 'Genuine potential, but needs better data, more capacity or a clearer case first.',
  },
};

const DECISION_TONE: Record<string, 'neutral' | 'positive' | 'critical' | 'caution'> = {
  PENDING: 'caution',
  APPROVED: 'positive',
  REJECTED: 'critical',
  DEFERRED: 'neutral',
};

export default async function RoadmapPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requireOrg(orgId, 'roadmap.view');
  if (!ctx) notFound();

  const roadmap = await prisma.roadmap.findFirst({
    where: { organisationId: orgId },
    orderBy: { version: 'desc' },
    include: {
      items: {
        orderBy: [{ phase: 'asc' }, { sequence: 'asc' }],
        include: { opportunity: { include: { calculation: true, projects: true } } },
      },
    },
  });

  const canDecide = ctx.can('roadmap.decide') || ctx.can('opportunity.decide');
  const canManageProject = ctx.can('project.manage');

  if (!roadmap || roadmap.items.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Analysis"
          title="AI roadmap"
          description="A prioritised sequence for the opportunities worth pursuing."
        />
        <EmptyState
          title="No roadmap yet"
          description="A roadmap is produced automatically when the AI opportunity analysis runs."
          action={
            <LinkButton href={`/app/${orgId}/opportunities`} tone="primary">
              Go to opportunities
            </LinkButton>
          }
        />
      </>
    );
  }

  const phases = (['PHASE_1', 'PHASE_2', 'PHASE_3'] as const).map((phase) => ({
    phase,
    items: roadmap.items.filter((item) => item.phase === phase),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="AI roadmap"
        description="Opportunities sequenced on business impact, time consumed, data readiness, implementation difficulty, cost and risk — not on how interesting the technology is."
        actions={<LinkButton href={`/app/${orgId}/projects`}>Projects</LinkButton>}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone="brand">Version {roadmap.version}</Badge>
        <Badge>{roadmap.items.length} opportunities</Badge>
        <Badge>
          {roadmap.items.filter((item) => item.clientDecision === 'APPROVED').length} approved
        </Badge>
        <Badge>
          {roadmap.items.filter((item) => item.clientDecision === 'PENDING').length} awaiting decision
        </Badge>
      </div>

      <div className="mb-8">
        <Card>
          <CardBody>
            <PhaseDistribution
              phases={phases.map((p, i) => ({
                label: `Phase ${i + 1}`,
                count: p.items.length,
                description: PHASE_META[p.phase].description,
              }))}
            />
          </CardBody>
        </Card>
      </div>

      <div className="space-y-8">
        {phases.map(({ phase, items }, phaseIndex) =>
          items.length ? (
            <section key={phase}>
              <div className="mb-3 flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="h-3 w-3 rounded-sm"
                  style={{ background: `rgb(var(--phase-${phaseIndex + 1}))` }}
                />
                <h2 className="text-[15px] font-semibold tracking-tight text-ink">
                  {PHASE_META[phase].title}
                </h2>
                <span className="text-[12px] text-faint">{items[0]?.targetQuarter}</span>
              </div>
              <p className="mb-3 max-w-3xl text-[13px] leading-relaxed text-muted">
                {PHASE_META[phase].description}
              </p>

              <div className="space-y-3">
                {items.map((item) => {
                  const opportunity = item.opportunity;
                  const calc = opportunity.calculation;
                  const hasProject = opportunity.projects.length > 0;

                  return (
                    <Card key={item.id}>
                      <CardBody>
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/app/${orgId}/opportunities/${opportunity.id}`}
                              className="text-[14px] font-medium text-ink hover:text-brand hover:underline"
                            >
                              {opportunity.name}
                            </Link>
                            <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-muted">
                              {opportunity.proposedSolution}
                            </p>
                            {item.rationale ? (
                              <p className="mt-2 text-[12px] leading-relaxed text-faint">
                                Sequenced here because: {item.rationale}
                              </p>
                            ) : null}

                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                              <Badge tone={DECISION_TONE[item.clientDecision] ?? 'neutral'}>
                                {item.clientDecision === 'PENDING'
                                  ? 'Awaiting your decision'
                                  : item.clientDecision.toLowerCase()}
                              </Badge>
                              <ConfidenceBadge level={opportunity.confidence} />
                              <Badge>
                                Complexity: {opportunity.implementationComplexity.toLowerCase()}
                              </Badge>
                              {calc ? (
                                <>
                                  <Badge>
                                    {fmtHours(calc.capacityReleasedLowHrs, calc.capacityReleasedHighHrs)}
                                  </Badge>
                                  <Badge>
                                    {fmtRange(calc.costSavingLow, calc.costSavingHigh, calc.currency)}
                                  </Badge>
                                </>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-col gap-2">
                            {item.clientDecision === 'PENDING' && canDecide ? (
                              <form action={recordClientDecision} className="flex gap-2">
                                <input type="hidden" name="organisationId" value={orgId} />
                                <input type="hidden" name="opportunityId" value={opportunity.id} />
                                <Button type="submit" name="decision" value="APPROVE" tone="primary">
                                  Approve
                                </Button>
                                <Button type="submit" name="decision" value="REJECT" tone="secondary">
                                  Decline
                                </Button>
                              </form>
                            ) : null}

                            {item.clientDecision === 'APPROVED' && !hasProject && canManageProject ? (
                              <form action={createProjectFromOpportunity}>
                                <input type="hidden" name="organisationId" value={orgId} />
                                <input type="hidden" name="opportunityId" value={opportunity.id} />
                                <Button type="submit" tone="primary">
                                  Start project
                                </Button>
                              </form>
                            ) : null}

                            {hasProject ? (
                              <Link
                                href={`/app/${orgId}/projects/${opportunity.projects[0].id}`}
                                className="text-[12px] font-medium text-brand hover:underline"
                              >
                                View project →
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  );
                })}
              </div>
            </section>
          ) : null,
        )}
      </div>
    </>
  );
}
