import Link from 'next/link';
import type { ReportBlock, ReportContent, ReportOpportunity } from '@/lib/engine/report';
import { fmtHours, fmtMoney, fmtRange } from '@/lib/engine/report';
import { Badge, Callout, DataTable, SectionLabel, ConfidenceBadge, RecommendationBadge } from './ui';
import { StatGrid, StatTile } from './charts';

/** Renders the structured report document produced by the report engine (§12). */

export function ReportView({
  content,
  orgId,
  consultantEdits,
}: {
  content: ReportContent;
  orgId: string;
  consultantEdits: Record<string, string>;
}) {
  const opportunities = new Map(content.opportunities.map((o) => [o.key, o]));

  return (
    <article className="space-y-10">
      {content.sections.map((section) => (
        <section key={section.key} id={section.key} className="scroll-mt-20">
          <h2 className="mb-4 border-b border-line pb-2 text-lg font-semibold tracking-tight text-ink">
            {section.title}
          </h2>

          {consultantEdits[section.key] ? (
            <div className="mb-4">
              <Callout tone="info" title="Consultant commentary">
                <div className="prose-body whitespace-pre-line">{consultantEdits[section.key]}</div>
              </Callout>
            </div>
          ) : null}

          <div className="space-y-4">
            {section.blocks.map((block, index) => (
              <Block
                key={index}
                block={block}
                currency={content.currency}
                opportunities={opportunities}
                orgId={orgId}
              />
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}

function Block({
  block,
  currency,
  opportunities,
  orgId,
}: {
  block: ReportBlock;
  currency: string;
  opportunities: Map<string, ReportOpportunity>;
  orgId: string;
}) {
  switch (block.type) {
    case 'paragraph':
      return <p className="text-[14px] leading-relaxed text-muted">{block.text}</p>;

    case 'bullets':
      return (
        <ul className="list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-muted">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );

    case 'stat-grid':
      return (
        <StatGrid cols={3}>
          {block.stats.map((stat) => (
            <StatTile
              key={stat.label}
              label={stat.label}
              value={stat.value}
              caption={stat.caption}
              tone={stat.tone === 'positive' ? 'positive' : stat.tone === 'caution' ? 'caution' : 'neutral'}
            />
          ))}
        </StatGrid>
      );

    case 'table':
      return <DataTable columns={block.columns} rows={block.rows} caption={block.caption} />;

    case 'callout':
      return (
        <Callout tone={block.tone} title={block.title}>
          {block.text}
        </Callout>
      );

    case 'phases':
      return (
        <div className="space-y-4">
          {block.phases.map((phase, index) => (
            <div key={phase.phase} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: `rgb(var(--phase-${index + 1}))` }}
                />
                <p className="text-[14px] font-semibold text-ink">
                  {phase.phase}: {phase.title}
                </p>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{phase.description}</p>
              {phase.items.length ? (
                <ul className="mt-2.5 list-disc space-y-1 pl-5 text-[13px] text-muted">
                  {phase.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-faint">Nothing scheduled in this phase.</p>
              )}
            </div>
          ))}
        </div>
      );

    case 'assumptions':
      return (
        <div className="rounded-lg border border-line bg-raised/50 p-4">
          <SectionLabel>Assumptions</SectionLabel>
          <ul className="space-y-2">
            {block.items.map((item, i) => (
              <li key={i} className="text-[12px] leading-relaxed">
                <span className="font-medium text-ink">{item.label}: </span>
                <span className="text-muted">{item.value}</span>
                <Badge tone={item.isEstimate ? 'caution' : 'positive'} className="ml-1.5">
                  {item.isEstimate ? 'Estimate' : 'Supplied'}
                </Badge>
                <span className="mt-0.5 block text-faint">Source: {item.source}</span>
              </li>
            ))}
          </ul>
        </div>
      );

    case 'opportunity': {
      const opportunity = opportunities.get(block.opportunityKey);
      if (!opportunity) return null;
      return <OpportunityCard opportunity={opportunity} currency={currency} orgId={orgId} />;
    }

    default:
      return null;
  }
}

function OpportunityCard({
  opportunity,
  currency,
  orgId,
}: {
  opportunity: ReportOpportunity;
  currency: string;
  orgId: string;
}) {
  const o = opportunity.outcome;
  const notRecommended =
    opportunity.recommendation === 'NOT_RECOMMENDED' || opportunity.recommendation === 'DO_NOTHING';

  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{opportunity.name}</h3>
        <div className="flex flex-wrap gap-1.5">
          <RecommendationBadge recommendation={opportunity.recommendation} />
          <ConfidenceBadge level={opportunity.confidence} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="brand">{opportunity.aiCategoryLabel}</Badge>
        <Badge>Complexity: {opportunity.complexity.toLowerCase()}</Badge>
        <Badge>Risk: {opportunity.risk.toLowerCase()}</Badge>
      </div>

      {notRecommended ? (
        <div className="mt-3">
          <Callout tone="caution" title="AI is not recommended here">
            {opportunity.notRecommendedReason ?? opportunity.rationale}
          </Callout>
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-3">
            <div>
              <SectionLabel>The problem</SectionLabel>
              <p className="text-[13px] leading-relaxed text-muted">{opportunity.currentProblem}</p>
            </div>
            <div>
              <SectionLabel>Proposed solution</SectionLabel>
              <p className="text-[13px] leading-relaxed text-muted">{opportunity.proposedSolution}</p>
            </div>
          </div>

          <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-line pt-4 text-[12px] sm:grid-cols-3">
            <div>
              <dt className="text-faint">Currently costs</dt>
              <dd className="tabular mt-0.5 text-ink">
                {o.currentHoursPerYear != null
                  ? `${Math.round(o.currentHoursPerYear).toLocaleString()} hrs/year`
                  : 'not sized'}
                {o.currentAnnualCost != null ? ` · ${fmtMoney(o.currentAnnualCost, currency)}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Capacity released</dt>
              <dd className="tabular mt-0.5 text-ink">
                {fmtHours(o.capacityLowHrs, o.capacityHighHrs)}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Value of that capacity</dt>
              <dd className="tabular mt-0.5 text-ink">
                {fmtRange(o.costSavingLow, o.costSavingHigh, currency)}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Revenue opportunity</dt>
              <dd className="tabular mt-0.5 text-ink">
                {o.revenueLow != null ? fmtRange(o.revenueLow, o.revenueHigh, currency) : 'Not estimated'}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Implementation cost</dt>
              <dd className="tabular mt-0.5 text-ink">
                {fmtRange(o.implementationLow, o.implementationHigh, currency)}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Payback</dt>
              <dd className="tabular mt-0.5 text-ink">
                {o.paybackMonthsLow != null || o.paybackMonthsHigh != null
                  ? `${o.paybackMonthsLow ?? '?'}–${o.paybackMonthsHigh ?? '?'} months`
                  : 'Not calculated'}
              </dd>
            </div>
          </dl>

          {opportunity.kpis.length > 0 ? (
            <div className="mt-4 border-t border-line pt-3">
              <SectionLabel>Success measures</SectionLabel>
              <ul className="list-disc space-y-1 pl-5 text-[12px] text-muted">
                {opportunity.kpis.slice(0, 4).map((kpi, i) => (
                  <li key={i}>
                    {kpi.name}
                    {kpi.projected != null ? ` — target ${kpi.projected}${kpi.unit ? ` ${kpi.unit}` : ''}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {opportunity.missingInformation.length > 0 ? (
            <p className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-faint">
              <span className="font-medium text-ink">To improve this estimate: </span>
              {opportunity.missingInformation.join(' ')}
            </p>
          ) : null}
        </>
      )}

      <p className="mt-4 text-[12px]">
        <Link
          href={`/app/${orgId}/opportunities`}
          className="font-medium text-brand hover:underline"
        >
          Open in the opportunity list
        </Link>
      </p>
    </div>
  );
}
