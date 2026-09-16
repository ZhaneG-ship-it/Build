import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { buildKnowledgeModel } from '@/lib/engine/knowledge-model';
import { SYSTEM_CATEGORY_LABELS } from '@/lib/types';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Badge,
  DataTable,
  EmptyState,
  KeyValue,
  LinkButton,
} from '@/components/ui';
import { ProgressMeter } from '@/components/charts';

export const metadata = { title: 'Knowledge model' };

export default async function KnowledgePage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requireOrg(orgId, 'knowledge.view');
  if (!ctx) notFound();

  const [km, versions] = await Promise.all([
    buildKnowledgeModel(orgId),
    prisma.knowledgeModelVersion.findMany({
      where: { organisationId: orgId },
      orderBy: { version: 'desc' },
      take: 12,
      select: { version: true, changeSummary: true, triggeredBy: true, createdAt: true },
    }),
  ]);

  const cur = km.financials.currency;
  const money = (v: number | null) =>
    v === null ? 'Not supplied' : `${cur} ${v.toLocaleString()}`;

  return (
    <>
      <PageHeader
        eyebrow="Understand the business"
        title="Business knowledge model"
        description="Everything the platform knows about this business, in one structured place. It updates continuously as assessments, interviews, documents and consultant edits arrive."
        actions={<LinkButton href={`/app/${orgId}/processes`}>Process map</LinkButton>}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone="brand">Version {km.version}</Badge>
        <Badge>{Math.round(km.completeness.overall * 100)}% complete</Badge>
        <Badge>{km.processes.length} processes</Badge>
        <Badge>{km.problems.length} problems</Badge>
        <Badge>{km.documents.length} documents</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Company" />
            <CardBody>
              <dl className="grid gap-x-8 sm:grid-cols-2">
                <KeyValue label="Name" value={km.company.name} />
                <KeyValue label="Industry" value={km.company.industry ?? 'Not supplied'} />
                <KeyValue label="Niche" value={km.company.subIndustry ?? 'Not supplied'} />
                <KeyValue label="Size" value={km.company.companySize ?? 'Not supplied'} />
                <KeyValue
                  label="Employees"
                  value={km.company.employeeCount != null ? String(km.company.employeeCount) : 'Not supplied'}
                />
                <KeyValue label="Business model" value={km.company.businessModel ?? 'Not supplied'} />
                <KeyValue
                  label="Locations"
                  value={km.company.locations.length ? km.company.locations.join(', ') : 'Not supplied'}
                />
                <KeyValue label="Annual turnover" value={money(km.company.annualTurnover)} />
              </dl>
              {km.company.productsServices ? (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="text-[12px] text-faint">Products and services</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{km.company.productsServices}</p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Departments" description={`${km.departments.length} recorded.`} />
            <CardBody>
              {km.departments.length ? (
                <DataTable
                  columns={['Department', 'Function', 'Headcount']}
                  align={[2]}
                  rows={km.departments.map((d) => [
                    d.name,
                    d.function ?? '—',
                    d.headcount != null ? String(d.headcount) : '—',
                  ])}
                />
              ) : (
                <p className="text-[13px] text-faint">No departments recorded yet.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Processes"
              description="How the work actually gets done. Opportunities are found inside these."
            />
            <CardBody>
              {km.processes.length ? (
                <DataTable
                  columns={['Process', 'Department', 'Frequency', 'Hrs/week', 'AI potential']}
                  align={[3, 4]}
                  rows={km.processes.map((p) => [
                    p.name,
                    p.department ?? '—',
                    p.frequency ? p.frequency.toLowerCase().replace('_', ' ') : '—',
                    p.hoursPerWeek != null ? String(p.hoursPerWeek) : 'not recorded',
                    p.aiPotential != null ? `${p.aiPotential}%` : '—',
                  ])}
                  caption="AI potential is derived from how manual, repetitive and data-ready each process is."
                />
              ) : (
                <EmptyState
                  title="No processes mapped"
                  description="Complete the assessment or add processes directly to give the analysis something to work with."
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Problems" />
            <CardBody>
              {km.problems.length ? (
                <DataTable
                  columns={['Problem', 'Type', 'Severity', 'Hrs lost/week', 'Source']}
                  align={[3]}
                  rows={km.problems.map((p) => [
                    p.title,
                    p.category.replace(/_/g, ' ').toLowerCase(),
                    p.severity.toLowerCase(),
                    p.hoursLostPerWeek != null ? String(p.hoursLostPerWeek) : 'not quantified',
                    p.source.toLowerCase(),
                  ])}
                />
              ) : (
                <p className="text-[13px] text-faint">No problems recorded yet.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Technology" />
            <CardBody>
              {km.technology.systems.length ? (
                <DataTable
                  columns={['System', 'Category', 'Integration route', 'Data quality']}
                  rows={km.technology.systems.map((s) => [
                    s.name,
                    SYSTEM_CATEGORY_LABELS[s.category] ?? s.category,
                    s.hasApi ? 'API available' : 'To be confirmed',
                    s.dataQuality != null ? `${s.dataQuality}/5` : '—',
                  ])}
                />
              ) : (
                <p className="text-[13px] text-faint">No systems recorded yet.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Completeness by area" />
            <CardBody className="space-y-3">
              {Object.entries(km.completeness.byArea)
                .sort((a, b) => a[1].score - b[1].score)
                .map(([area, detail]) => (
                  <div key={area}>
                    <ProgressMeter
                      value={detail.score}
                      label={area.charAt(0).toUpperCase() + area.slice(1)}
                    />
                    {detail.missing.length > 0 ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-faint">
                        Missing: {detail.missing.join(', ')}
                      </p>
                    ) : null}
                  </div>
                ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Financial baselines" />
            <CardBody>
              <dl>
                <KeyValue label="Hourly labour cost" value={money(km.financials.avgHourlyLabourCost)} />
                <KeyValue label="Average customer value" value={money(km.financials.avgCustomerValue)} />
                <KeyValue
                  label="Monthly leads"
                  value={km.financials.monthlyLeadVolume != null ? String(km.financials.monthlyLeadVolume) : 'Not supplied'}
                />
                <KeyValue
                  label="Conversion rate"
                  value={km.financials.conversionRate != null ? `${km.financials.conversionRate}%` : 'Not supplied'}
                />
                <KeyValue label="AI budget" value={money(km.financials.aiBudget)} />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Risk position" />
            <CardBody>
              <dl>
                <KeyValue
                  label="Handles sensitive data"
                  value={km.risk.handlesSensitiveData ? 'Yes' : 'No'}
                />
                <KeyValue
                  label="Regulations"
                  value={km.risk.regulations.length ? km.risk.regulations.join(', ') : 'None stated'}
                />
                <KeyValue
                  label="Must stay human-decided"
                  value={km.risk.noAutonomyProcesses ?? 'Not stated'}
                />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Version history"
              description="The model is versioned, so you can see how understanding of the business developed."
            />
            <CardBody>
              <ol className="space-y-3">
                {versions.map((version) => (
                  <li key={version.version} className="border-l-2 border-line pl-3">
                    <p className="text-[12px] font-medium text-ink">
                      Version {version.version}
                      <span className="ml-2 font-normal text-faint">
                        {version.createdAt.toLocaleDateString('en-GB')}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                      {version.changeSummary ?? 'Snapshot recorded.'}
                    </p>
                    {version.triggeredBy ? (
                      <p className="mt-0.5 text-[11px] text-faint">
                        Triggered by {version.triggeredBy.toLowerCase()}
                      </p>
                    ) : null}
                  </li>
                ))}
                {versions.length === 0 ? (
                  <li className="text-[13px] text-faint">No versions recorded yet.</li>
                ) : null}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
