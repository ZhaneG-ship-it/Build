import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { parseJson } from '@/lib/json';
import { AI_CATEGORY_LABELS, AI_CATEGORIES, type AiCategory, type Assumption, type EvidenceRef, type Formula } from '@/lib/types';
import { fmtHours, fmtMoney, fmtRange } from '@/lib/engine/report';
import {
  updateOpportunity,
  approveOpportunity,
  recordClientDecision,
} from '@/app/actions/opportunities';
import { createProjectFromOpportunity } from '@/app/actions/projects';
import type { Dependencies } from '@/lib/engine/opportunities';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Badge,
  Button,
  Callout,
  ConfidenceBadge,
  RecommendationBadge,
  DataTable,
  Field,
  inputClass,
  LinkButton,
  SectionLabel,
} from '@/components/ui';

export const metadata = { title: 'Opportunity' };

const DEPENDENCY_LABELS: Record<string, string> = {
  data: 'Data',
  software: 'Software',
  apis: 'APIs',
  integrations: 'Integrations',
  training: 'Training',
  security: 'Security',
  policies: 'Policies',
};

const OVERSIGHT_LABELS: Record<string, string> = {
  HUMAN_IN_LOOP: 'A person approves every output',
  HUMAN_ON_LOOP: 'A person monitors and can intervene',
  PERIODIC_AUDIT: 'Audited on a fixed schedule',
  AUTONOMOUS: 'Runs without routine human review',
};

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; opportunityId: string }>;
  searchParams: Promise<{ saved?: string; approved?: string; decided?: string }>;
}) {
  const { orgId, opportunityId } = await params;
  const { saved, approved, decided } = await searchParams;

  const ctx = await requireOrg(orgId, 'opportunity.view');
  if (!ctx) notFound();

  const opportunity = await prisma.aIOpportunity.findFirst({
    where: { id: opportunityId, organisationId: orgId },
    include: {
      calculation: true,
      process: true,
      problem: true,
      kpis: true,
      projects: true,
    },
  });
  if (!opportunity) notFound();

  const calc = opportunity.calculation;
  const currency = calc?.currency ?? 'GBP';
  const assumptions = parseJson<Assumption[]>(calc?.assumptions, []);
  const formulas = parseJson<Formula[]>(calc?.formulas, []);
  const benchmarks = parseJson<string[]>(calc?.benchmarksUsed, []);
  const missing = parseJson<string[]>(opportunity.missingInformation, []);
  const sources = parseJson<EvidenceRef[]>(opportunity.sources, []);
  const dependencies = parseJson<Dependencies>(opportunity.dependencies, {
    data: [], software: [], apis: [], integrations: [], training: [], security: [], policies: [],
  });

  const canEdit = ctx.can('opportunity.edit');
  const canApprove = ctx.can('opportunity.approve');
  const canDecide = ctx.can('opportunity.decide');
  const canManageProject = ctx.can('project.manage');
  const notRecommended =
    opportunity.recommendation === 'NOT_RECOMMENDED' || opportunity.recommendation === 'DO_NOTHING';

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/app/${orgId}/opportunities`} className="hover:underline">
            Opportunities
          </Link>
        }
        title={opportunity.name}
        actions={<LinkButton href={`/app/${orgId}/opportunities`}>All opportunities</LinkButton>}
      />

      {saved ? (
        <div className="mb-5">
          <Callout tone="positive" title="Saved">
            Your changes are recorded. This opportunity is now marked as consultant-edited and will
            not be overwritten when the analysis is re-run.
          </Callout>
        </div>
      ) : null}
      {approved ? (
        <div className="mb-5">
          <Callout tone="positive" title="Sent to the client">
            The client can now review this recommendation and decide.
          </Callout>
        </div>
      ) : null}
      {decided ? (
        <div className="mb-5">
          <Callout tone="positive" title="Decision recorded">
            Your decision has been recorded against this opportunity and the roadmap updated.
          </Callout>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-1.5">
        <RecommendationBadge recommendation={opportunity.recommendation} />
        <Badge tone="brand">
          {AI_CATEGORY_LABELS[opportunity.aiCategory as AiCategory] ?? opportunity.aiCategory}
        </Badge>
        <ConfidenceBadge level={opportunity.confidence} />
        <Badge>Complexity: {opportunity.implementationComplexity.toLowerCase()}</Badge>
        <Badge>Risk: {opportunity.riskLevel.toLowerCase()}</Badge>
        <Badge>Status: {opportunity.status.replace(/_/g, ' ').toLowerCase()}</Badge>
        {opportunity.editedByConsultant ? <Badge tone="brand">Consultant reviewed</Badge> : null}
      </div>

      {notRecommended ? (
        <div className="mb-6">
          <Callout tone="caution" title="AI is not recommended for this process">
            {opportunity.notRecommendedReason ?? opportunity.rationale}
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="What happens today" />
            <CardBody className="prose-body">
              <p>{opportunity.currentProblem}</p>
              {opportunity.process ? (
                <p className="text-[12px] text-faint">
                  Based on the mapped process{' '}
                  <Link
                    href={`/app/${orgId}/processes/${opportunity.process.id}`}
                    className="text-brand hover:underline"
                  >
                    {opportunity.process.name}
                  </Link>
                  .
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="What could change" />
            <CardBody className="prose-body">
              <p>{opportunity.proposedSolution}</p>
              {opportunity.rationale ? (
                <>
                  <SectionLabel>Why this, and why now</SectionLabel>
                  <p>{opportunity.rationale}</p>
                </>
              ) : null}
            </CardBody>
          </Card>

          {calc ? (
            <Card>
              <CardHeader
                title="Projected outcome"
                description="Every figure here is an estimate calculated from information this business supplied, shown as a range. Released capacity and cost saving are reported separately because they are not the same thing."
              />
              <CardBody className="space-y-5">
                <DataTable
                  columns={['Measure', 'Estimate', 'What it means']}
                  rows={[
                    [
                      'Current cost of this work',
                      calc.currentHoursPerYear != null
                        ? `${Math.round(calc.currentHoursPerYear).toLocaleString()} hrs/year · ${fmtMoney(calc.currentAnnualCost, currency)}`
                        : 'Not sized',
                      'What this process costs to run today at the supplied labour rate.',
                    ],
                    [
                      'Estimated time reduction',
                      calc.reductionLowPct != null
                        ? `${calc.reductionLowPct}–${calc.reductionHighPct}%`
                        : 'Not estimated',
                      'How much of the handling time this could realistically remove.',
                    ],
                    [
                      'Potential capacity released',
                      fmtHours(calc.capacityReleasedLowHrs, calc.capacityReleasedHighHrs),
                      'Time freed each year. Real, but not automatically cash.',
                    ],
                    [
                      'Value of released capacity',
                      fmtRange(calc.costSavingLow, calc.costSavingHigh, currency),
                      'A cash saving only if headcount, overtime or contractor spend actually falls.',
                    ],
                    [
                      'Potential revenue opportunity',
                      calc.revenueOpportunityLow != null
                        ? fmtRange(calc.revenueOpportunityLow, calc.revenueOpportunityHigh, currency)
                        : 'Not estimated',
                      calc.revenueOpportunityLow != null
                        ? 'Separate from cost saving. Never add the two together.'
                        : 'Not enough information supplied to estimate this responsibly.',
                    ],
                    [
                      'Implementation cost',
                      fmtRange(calc.implementationCostLow, calc.implementationCostHigh, currency),
                      'One-off build cost. A planning band, not a quotation.',
                    ],
                    [
                      'Annual running cost',
                      fmtMoney(calc.runningCostPerYear, currency),
                      'Licences, hosting and maintenance once live.',
                    ],
                    [
                      'Payback period',
                      calc.paybackMonthsLow != null || calc.paybackMonthsHigh != null
                        ? `${calc.paybackMonthsLow ?? '?'}–${calc.paybackMonthsHigh ?? '?'} months`
                        : 'Not calculated',
                      calc.paybackMonthsLow != null
                        ? 'Best case against cautious case.'
                        : 'The supplied information does not support a positive net annual benefit.',
                    ],
                  ]}
                />

                {formulas.length > 0 ? (
                  <div className="border-t border-line pt-4">
                    <SectionLabel>How these numbers were calculated</SectionLabel>
                    <ul className="space-y-2">
                      {formulas.map((formula, i) => (
                        <li key={i} className="text-[12px] leading-relaxed">
                          <span className="font-medium text-ink">{formula.label}: </span>
                          <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">
                            {formula.expression}
                          </code>
                          <span className="ml-1.5 text-ink">= {formula.result}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {assumptions.length > 0 ? (
                  <div className="border-t border-line pt-4">
                    <SectionLabel>Assumptions behind these figures</SectionLabel>
                    <ul className="space-y-2">
                      {assumptions.map((assumption, i) => (
                        <li key={i} className="text-[12px] leading-relaxed">
                          <span className="font-medium text-ink">{assumption.label}: </span>
                          <span className="text-muted">{assumption.value}</span>
                          <Badge
                            tone={assumption.isEstimate ? 'caution' : 'positive'}
                            className="ml-1.5"
                          >
                            {assumption.isEstimate ? 'Estimate' : 'Supplied'}
                          </Badge>
                          <span className="mt-0.5 block text-faint">Source: {assumption.source}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {benchmarks.length > 0 ? (
                  <div className="border-t border-line pt-4">
                    <SectionLabel>Benchmarks used</SectionLabel>
                    <ul className="list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-muted">
                      {benchmarks.map((benchmark, i) => (
                        <li key={i}>{benchmark}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {!notRecommended ? (
            <Card>
              <CardHeader
                title="What would need to be in place"
                description="Implementation dependencies. Most AI projects fail on these rather than on the technology."
              />
              <CardBody>
                <div className="grid gap-5 sm:grid-cols-2">
                  {Object.entries(dependencies).map(([key, items]) =>
                    items.length ? (
                      <div key={key}>
                        <SectionLabel>{DEPENDENCY_LABELS[key] ?? key}</SectionLabel>
                        <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-muted">
                          {items.map((item: string, i: number) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null,
                  )}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {opportunity.kpis.length > 0 ? (
            <Card>
              <CardHeader
                title="How success would be measured"
                description="These KPIs are created with the opportunity, so projected and actual can be compared after go-live."
              />
              <CardBody>
                <DataTable
                  columns={['KPI', 'Unit', 'Baseline', 'Projected', 'Better when']}
                  align={[2, 3]}
                  rows={opportunity.kpis.map((kpi) => [
                    kpi.name,
                    kpi.unit || '—',
                    kpi.baselineValue != null ? String(kpi.baselineValue) : 'to be recorded',
                    kpi.projectedValue != null ? String(kpi.projectedValue) : '—',
                    kpi.direction === 'DECREASE' ? 'lower' : 'higher',
                  ])}
                />
              </CardBody>
            </Card>
          ) : null}

          {canEdit ? (
            <Card>
              <CardHeader
                title="Consultant review"
                description="Rewrite any part of this recommendation before it reaches the client. Saving marks it as consultant-edited and protects it from being regenerated."
              />
              <CardBody>
                <form action={updateOpportunity} className="space-y-5">
                  <input type="hidden" name="organisationId" value={orgId} />
                  <input type="hidden" name="opportunityId" value={opportunity.id} />

                  <Field label="Name">
                    <input name="name" defaultValue={opportunity.name} className={inputClass} />
                  </Field>
                  <Field label="Current problem">
                    <textarea
                      name="currentProblem"
                      rows={3}
                      defaultValue={opportunity.currentProblem}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Proposed solution">
                    <textarea
                      name="proposedSolution"
                      rows={3}
                      defaultValue={opportunity.proposedSolution}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Rationale">
                    <textarea
                      name="rationale"
                      rows={3}
                      defaultValue={opportunity.rationale ?? ''}
                      className={inputClass}
                    />
                  </Field>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="AI category">
                      <select name="aiCategory" defaultValue={opportunity.aiCategory} className={inputClass}>
                        {AI_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {AI_CATEGORY_LABELS[category]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Recommendation">
                      <select
                        name="recommendation"
                        defaultValue={opportunity.recommendation}
                        className={inputClass}
                      >
                        {['IMPLEMENT', 'INVESTIGATE', 'DEFER', 'NOT_RECOMMENDED', 'DO_NOTHING'].map((r) => (
                          <option key={r} value={r}>
                            {r.replace(/_/g, ' ').toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Phase">
                      <select name="priorityBand" defaultValue={opportunity.priorityBand} className={inputClass}>
                        {['PHASE_1', 'PHASE_2', 'PHASE_3', 'NOT_RECOMMENDED'].map((b) => (
                          <option key={b} value={b}>
                            {b.replace(/_/g, ' ').toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Complexity">
                      <select
                        name="implementationComplexity"
                        defaultValue={opportunity.implementationComplexity}
                        className={inputClass}
                      >
                        {['LOW', 'MEDIUM', 'HIGH'].map((c) => (
                          <option key={c} value={c}>
                            {c.toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Risk">
                      <select name="riskLevel" defaultValue={opportunity.riskLevel} className={inputClass}>
                        {['LOW', 'MEDIUM', 'HIGH'].map((r) => (
                          <option key={r} value={r}>
                            {r.toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Human oversight">
                      <select
                        name="humanOversight"
                        defaultValue={opportunity.humanOversight}
                        className={inputClass}
                      >
                        {Object.entries(OVERSIGHT_LABELS).map(([value, labelText]) => (
                          <option key={value} value={value}>
                            {labelText}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <Field
                    label="Reason AI is not recommended"
                    help="Required if you set the recommendation to not recommended or do nothing."
                  >
                    <textarea
                      name="notRecommendedReason"
                      rows={2}
                      defaultValue={opportunity.notRecommendedReason ?? ''}
                      className={inputClass}
                    />
                  </Field>

                  <Field label="Internal notes" help="Visible to consultants only.">
                    <textarea
                      name="consultantNotes"
                      rows={2}
                      defaultValue={opportunity.consultantNotes ?? ''}
                      className={inputClass}
                    />
                  </Field>

                  <Button type="submit" tone="primary">
                    Save changes
                  </Button>
                </form>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Human oversight" />
            <CardBody>
              <p className="text-[13px] leading-relaxed text-ink">
                {OVERSIGHT_LABELS[opportunity.humanOversight] ?? opportunity.humanOversight}
              </p>
            </CardBody>
          </Card>

          {missing.length > 0 ? (
            <Card>
              <CardHeader
                title="What would improve confidence"
                description={`Confidence is ${opportunity.confidence.toLowerCase()}.`}
              />
              <CardBody>
                <ul className="list-disc space-y-2 pl-4 text-[13px] leading-relaxed text-muted">
                  {missing.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
                <p className="mt-3">
                  <Link href={`/app/${orgId}/interview`} className="text-[13px] font-medium text-brand hover:underline">
                    Answer the outstanding questions
                  </Link>
                </p>
              </CardBody>
            </Card>
          ) : null}

          {sources.length > 0 ? (
            <Card>
              <CardHeader
                title="Sources"
                description="Everything this recommendation rests on."
              />
              <CardBody>
                <ul className="space-y-2.5">
                  {sources.map((source, i) => (
                    <li key={i} className="text-[12px] leading-relaxed">
                      <Badge>{source.type.toLowerCase()}</Badge>
                      <span className="mt-1 block text-muted">{source.detail ?? source.ref}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          {canApprove && opportunity.status === 'CONSULTANT_REVIEW' ? (
            <Card>
              <CardHeader
                title="Release to the client"
                description="Once released, the client can review this and decide whether to proceed."
              />
              <CardBody>
                <form action={approveOpportunity}>
                  <input type="hidden" name="organisationId" value={orgId} />
                  <input type="hidden" name="opportunityId" value={opportunity.id} />
                  <Button type="submit" tone="primary" className="w-full">
                    Approve and send to client
                  </Button>
                </form>
              </CardBody>
            </Card>
          ) : null}

          {canDecide &&
          !notRecommended &&
          ['SENT_TO_CLIENT', 'CONSULTANT_REVIEW', 'DRAFT'].includes(opportunity.status) ? (
            <Card>
              <CardHeader
                title="Your decision"
                description="Approving this adds it to your roadmap and lets an implementation project be created."
              />
              <CardBody>
                <form action={recordClientDecision} className="space-y-3">
                  <input type="hidden" name="organisationId" value={orgId} />
                  <input type="hidden" name="opportunityId" value={opportunity.id} />
                  <Field label="Note (optional)">
                    <textarea name="note" rows={2} className={inputClass} />
                  </Field>
                  <div className="flex gap-2">
                    <Button type="submit" name="decision" value="APPROVE" tone="primary">
                      Approve
                    </Button>
                    <Button type="submit" name="decision" value="REJECT" tone="secondary">
                      Decline
                    </Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          ) : null}

          {opportunity.projects.length > 0 ? (
            <Card>
              <CardHeader title="Implementation" />
              <CardBody>
                {opportunity.projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/app/${orgId}/projects/${project.id}`}
                    className="block text-[13px] font-medium text-brand hover:underline"
                  >
                    {project.name} — {project.stage.toLowerCase()}
                  </Link>
                ))}
              </CardBody>
            </Card>
          ) : canManageProject && opportunity.status === 'CLIENT_APPROVED' ? (
            <Card>
              <CardHeader
                title="Start implementation"
                description="Creates a project with milestones, tasks and KPI tracking across the nine delivery stages."
              />
              <CardBody>
                <form action={createProjectFromOpportunity}>
                  <input type="hidden" name="organisationId" value={orgId} />
                  <input type="hidden" name="opportunityId" value={opportunity.id} />
                  <Button type="submit" tone="primary" className="w-full">
                    Create implementation project
                  </Button>
                </form>
              </CardBody>
            </Card>
          ) : null}

          {opportunity.consultantNotes && canEdit ? (
            <Card>
              <CardHeader title="Internal notes" />
              <CardBody>
                <p className="text-[13px] leading-relaxed text-muted">{opportunity.consultantNotes}</p>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
