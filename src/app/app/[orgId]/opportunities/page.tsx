import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { parseJson } from '@/lib/json';
import { AI_CATEGORY_LABELS, type AiCategory } from '@/lib/types';
import { fmtHours, fmtRange } from '@/lib/engine/report';
import { runAnalysisAction } from '@/app/actions/analysis';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Badge,
  Button,
  Callout,
  EmptyState,
  ConfidenceBadge,
  RecommendationBadge,
  LinkButton,
} from '@/components/ui';
import { StatGrid, StatTile, ScoreMeter, PhaseDistribution } from '@/components/charts';

export const metadata = { title: 'Opportunities' };

const PHASE_LABELS: Record<string, string> = {
  PHASE_1: 'Phase 1 — start here',
  PHASE_2: 'Phase 2 — next',
  PHASE_3: 'Phase 3 — later',
};

export default async function OpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { orgId } = await params;
  const { error } = await searchParams;

  const ctx = await requireOrg(orgId, 'opportunity.view');
  if (!ctx) notFound();

  const [opportunities, processCount] = await Promise.all([
    prisma.aIOpportunity.findMany({
      where: { organisationId: orgId },
      include: { calculation: true, process: true },
      orderBy: [{ priorityScore: 'desc' }],
    }),
    prisma.process.count({ where: { organisationId: orgId } }),
  ]);

  const canRun = ctx.can('analysis.run');
  const recommended = opportunities.filter(
    (o) => o.recommendation !== 'NOT_RECOMMENDED' && o.recommendation !== 'DO_NOTHING',
  );
  const notRecommended = opportunities.filter(
    (o) => o.recommendation === 'NOT_RECOMMENDED' || o.recommendation === 'DO_NOTHING',
  );

  const currency = opportunities[0]?.calculation?.currency ?? 'GBP';
  const sum = (pick: (c: NonNullable<(typeof opportunities)[number]['calculation']>) => number | null) =>
    recommended.reduce((t, o) => t + (o.calculation ? (pick(o.calculation) ?? 0) : 0), 0);

  const runForm = canRun ? (
    <form action={runAnalysisAction}>
      <input type="hidden" name="organisationId" value={orgId} />
      <Button type="submit" tone="primary" disabled={processCount === 0}>
        {opportunities.length ? 'Re-run analysis' : 'Run AI opportunity analysis'}
      </Button>
    </form>
  ) : null;

  return (
    <>
      <PageHeader
        eyebrow="Analysis"
        title="AI opportunities"
        description="Where AI or automation could realistically help this business — and where it could not. Every figure is an estimate calculated from your own data and shown as a range."
        actions={runForm}
      />

      {error ? (
        <div className="mb-5">
          <Callout tone="critical" title="The analysis could not run">
            {decodeURIComponent(error)}
          </Callout>
        </div>
      ) : null}

      {opportunities.length === 0 ? (
        <EmptyState
          title="No analysis has been run yet"
          description={
            processCount === 0
              ? 'At least one business process needs to be mapped before an analysis can run. Complete the assessment, or add a process directly.'
              : `${processCount} process${processCount === 1 ? ' is' : 'es are'} mapped. Run the analysis to identify where AI could realistically help.`
          }
          action={
            processCount === 0 ? (
              <LinkButton href={`/app/${orgId}/processes/new`} tone="primary">
                Add a process
              </LinkButton>
            ) : (
              runForm
            )
          }
        />
      ) : (
        <>
          <StatGrid cols={4}>
            <StatTile
              label="Recommended"
              value={String(recommended.length)}
              caption={`from ${opportunities.length} processes assessed`}
            />
            <StatTile
              label="Potential capacity"
              value={fmtHours(sum((c) => c.capacityReleasedLowHrs), sum((c) => c.capacityReleasedHighHrs))}
              caption="Estimated hours released each year"
              tone="positive"
            />
            <StatTile
              label="Value of that capacity"
              value={fmtRange(sum((c) => c.costSavingLow), sum((c) => c.costSavingHigh), currency)}
              caption="Estimate, not a guarantee"
              tone="positive"
            />
            <StatTile
              label="Implementation cost"
              value={fmtRange(
                sum((c) => c.implementationCostLow),
                sum((c) => c.implementationCostHigh),
                currency,
              )}
              caption="Planning range, not a quotation"
              tone="caution"
            />
          </StatGrid>

          <div className="mt-6">
            <Card>
              <CardHeader title="How these are sequenced" />
              <CardBody>
                <PhaseDistribution
                  phases={[
                    {
                      label: 'Phase 1',
                      count: recommended.filter((o) => o.priorityBand === 'PHASE_1').length,
                      description: 'clear benefit, contained implementation',
                    },
                    {
                      label: 'Phase 2',
                      count: recommended.filter((o) => o.priorityBand === 'PHASE_2').length,
                      description: 'worthwhile but more involved',
                    },
                    {
                      label: 'Phase 3',
                      count: recommended.filter((o) => o.priorityBand === 'PHASE_3').length,
                      description: 'needs better data or a clearer case first',
                    },
                  ]}
                />
              </CardBody>
            </Card>
          </div>

          {(['PHASE_1', 'PHASE_2', 'PHASE_3'] as const).map((band) => {
            const inBand = recommended.filter((o) => o.priorityBand === band);
            if (!inBand.length) return null;

            return (
              <section key={band} className="mt-8">
                <h2 className="mb-3 text-[15px] font-semibold tracking-tight text-ink">
                  {PHASE_LABELS[band]}
                </h2>
                <div className="space-y-3">
                  {inBand.map((opportunity) => {
                    const calc = opportunity.calculation;
                    const missing = parseJson<string[]>(opportunity.missingInformation, []);

                    return (
                      <Card key={opportunity.id}>
                        <CardBody>
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <Link
                                href={`/app/${orgId}/opportunities/${opportunity.id}`}
                                className="text-[15px] font-medium text-ink hover:text-brand hover:underline"
                              >
                                {opportunity.name}
                              </Link>
                              <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-muted">
                                {opportunity.proposedSolution}
                              </p>

                              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                <RecommendationBadge recommendation={opportunity.recommendation} />
                                <Badge tone="brand">
                                  {AI_CATEGORY_LABELS[opportunity.aiCategory as AiCategory] ??
                                    opportunity.aiCategory}
                                </Badge>
                                <ConfidenceBadge level={opportunity.confidence} />
                                <Badge>
                                  Complexity: {opportunity.implementationComplexity.toLowerCase()}
                                </Badge>
                                <Badge>Risk: {opportunity.riskLevel.toLowerCase()}</Badge>
                                {opportunity.editedByConsultant ? (
                                  <Badge tone="brand">Consultant reviewed</Badge>
                                ) : null}
                              </div>

                              {calc ? (
                                <dl className="mt-4 grid gap-x-6 gap-y-2 text-[12px] sm:grid-cols-3">
                                  <div>
                                    <dt className="text-faint">Currently costs</dt>
                                    <dd className="tabular mt-0.5 text-ink">
                                      {calc.currentHoursPerYear != null
                                        ? `${Math.round(calc.currentHoursPerYear).toLocaleString()} hrs/year`
                                        : 'not sized'}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-faint">Could release</dt>
                                    <dd className="tabular mt-0.5 text-ink">
                                      {fmtHours(calc.capacityReleasedLowHrs, calc.capacityReleasedHighHrs)}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-faint">Estimated value</dt>
                                    <dd className="tabular mt-0.5 text-ink">
                                      {fmtRange(calc.costSavingLow, calc.costSavingHigh, calc.currency)}
                                    </dd>
                                  </div>
                                </dl>
                              ) : null}

                              {missing.length > 0 ? (
                                <p className="mt-3 text-[12px] leading-relaxed text-faint">
                                  To improve this estimate: {missing[0]}
                                </p>
                              ) : null}
                            </div>

                            <div className="shrink-0">
                              <p className="mb-1 text-[11px] uppercase tracking-[0.06em] text-faint">
                                Priority
                              </p>
                              <ScoreMeter score={opportunity.priorityScore} />
                            </div>
                          </div>
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {notRecommended.length > 0 ? (
            <section className="mt-10">
              <h2 className="mb-2 text-[15px] font-semibold tracking-tight text-ink">
                Assessed, and AI is not recommended
              </h2>
              <p className="mb-3 max-w-3xl text-[13px] leading-relaxed text-muted">
                These processes were examined properly and the honest conclusion is to leave them
                alone for now. Knowing where not to spend is worth as much as knowing where to.
              </p>
              <div className="space-y-3">
                {notRecommended.map((opportunity) => (
                  <Card key={opportunity.id}>
                    <CardBody>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/app/${orgId}/opportunities/${opportunity.id}`}
                            className="text-[14px] font-medium text-ink hover:text-brand hover:underline"
                          >
                            {opportunity.process?.name ?? opportunity.name}
                          </Link>
                          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-muted">
                            {opportunity.notRecommendedReason ?? opportunity.rationale}
                          </p>
                        </div>
                        <RecommendationBadge recommendation={opportunity.recommendation} />
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
