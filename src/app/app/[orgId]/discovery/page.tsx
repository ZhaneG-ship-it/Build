import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { parseJson } from '@/lib/json';
import {
  startDiscoveryCycle,
  submitDiscoveryChanges,
  analyseDiscoveryCycle,
} from '@/app/actions/discovery';
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
} from '@/components/ui';

export const metadata = { title: 'Continuous discovery' };

const QUESTIONS = [
  {
    name: 'newProcesses',
    label: 'New or changed processes',
    help: 'One per line. Anything named here becomes a process the platform will size and assess.',
  },
  { name: 'newPeople', label: 'New people or roles', help: 'Changes to the team since the last assessment.' },
  { name: 'newSoftware', label: 'New software', help: 'Systems adopted or retired.' },
  { name: 'newProblems', label: 'New problems', help: 'Anything that has started going wrong, or got worse.' },
  { name: 'newCosts', label: 'New costs', help: 'Costs that have appeared or changed materially.' },
  { name: 'newGoals', label: 'New goals', help: 'Changes to what the business is trying to achieve.' },
  {
    name: 'aiPerformance',
    label: 'How is the AI you have already implemented performing?',
    help: 'Be honest — if something is not working, that is the most useful answer here.',
  },
];

export default async function DiscoveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ answered?: string; analysed?: string; error?: string }>;
}) {
  const { orgId } = await params;
  const { answered, analysed, error } = await searchParams;

  const ctx = await requireOrg(orgId, 'knowledge.view');
  if (!ctx) notFound();

  const [cycles, versions] = await Promise.all([
    prisma.discoveryCycle.findMany({
      where: { organisationId: orgId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.knowledgeModelVersion.findMany({
      where: { organisationId: orgId },
      orderBy: { version: 'desc' },
      take: 8,
      select: { version: true, changeSummary: true, triggeredBy: true, createdAt: true },
    }),
  ]);

  const openCycle = cycles.find((c) => c.status === 'OPEN');
  const answeredCycle = cycles.find((c) => c.status === 'ANSWERED');
  const canRun = ctx.can('discovery.run');

  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        title="Continuous AI discovery"
        description="Businesses change. A discovery cycle asks what has moved since the last assessment, updates the knowledge model, then re-analyses to see whether anything new is worth doing."
        actions={
          canRun && !openCycle && !answeredCycle ? (
            <form action={startDiscoveryCycle}>
              <input type="hidden" name="organisationId" value={orgId} />
              <Button type="submit" tone="primary">
                Start a discovery cycle
              </Button>
            </form>
          ) : null
        }
      />

      {answered ? (
        <div className="mb-5">
          <Callout tone="positive" title="Changes recorded">
            Your knowledge model has been updated. Run the re-analysis to see whether these changes
            create any new opportunities.
          </Callout>
        </div>
      ) : null}
      {analysed ? (
        <div className="mb-5">
          <Callout tone="positive" title="Re-analysis complete">
            The findings are shown below and your opportunities have been refreshed.
          </Callout>
        </div>
      ) : null}
      {error ? (
        <div className="mb-5">
          <Callout tone="critical" title="Could not complete">
            {decodeURIComponent(error)}
          </Callout>
        </div>
      ) : null}

      {openCycle && canRun ? (
        <div className="mb-6">
          <Card>
            <CardHeader
              title="What has changed since the last assessment?"
              description="Leave anything blank that has not changed. Only what you write here is recorded — nothing is assumed."
            />
            <CardBody>
              <form action={submitDiscoveryChanges} className="space-y-5">
                <input type="hidden" name="organisationId" value={orgId} />
                <input type="hidden" name="cycleId" value={openCycle.id} />

                {QUESTIONS.map((question) => (
                  <Field key={question.name} label={question.label} help={question.help}>
                    <textarea name={question.name} rows={3} className={inputClass} />
                  </Field>
                ))}

                <Button type="submit" tone="primary">
                  Record changes
                </Button>
              </form>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {answeredCycle && canRun ? (
        <div className="mb-6">
          <Card>
            <CardHeader
              title="Ready to re-analyse"
              description="Your changes have been recorded. Re-running the analysis will assess the updated picture and identify anything new."
            />
            <CardBody>
              {answeredCycle.changesReported ? (
                <div className="mb-4 whitespace-pre-line rounded-lg border border-line bg-raised p-4 text-[13px] leading-relaxed text-muted">
                  {answeredCycle.changesReported}
                </div>
              ) : null}
              <form action={analyseDiscoveryCycle}>
                <input type="hidden" name="organisationId" value={orgId} />
                <input type="hidden" name="cycleId" value={answeredCycle.id} />
                <Button type="submit" tone="primary">
                  Re-analyse the business
                </Button>
              </form>
            </CardBody>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Discovery history" />
          <CardBody>
            {cycles.length === 0 ? (
              <EmptyState
                title="No discovery cycles yet"
                description="Run one every quarter, or whenever something material changes in the business."
              />
            ) : (
              <ol className="space-y-4">
                {cycles.map((cycle) => {
                  const findings = parseJson<string[]>(cycle.findings, []);
                  const newIds = parseJson<string[]>(cycle.newOpportunityIds, []);
                  return (
                    <li key={cycle.id} className="border-b border-line pb-4 last:border-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            cycle.status === 'ANALYSED'
                              ? 'positive'
                              : cycle.status === 'ANSWERED'
                                ? 'brand'
                                : 'caution'
                          }
                        >
                          {cycle.status.toLowerCase()}
                        </Badge>
                        <span className="text-[12px] text-faint">
                          {cycle.createdAt.toLocaleDateString('en-GB', { dateStyle: 'medium' })}
                          {cycle.fromVersion != null && cycle.toVersion != null
                            ? ` · knowledge model v${cycle.fromVersion} → v${cycle.toVersion}`
                            : ''}
                        </span>
                      </div>
                      {findings.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-muted">
                          {findings.map((finding, i) => (
                            <li key={i}>{finding}</li>
                          ))}
                        </ul>
                      ) : null}
                      {newIds.length > 0 ? (
                        <p className="mt-2 text-[12px]">
                          <Link
                            href={`/app/${orgId}/opportunities`}
                            className="font-medium text-brand hover:underline"
                          >
                            View the {newIds.length} new opportunit{newIds.length === 1 ? 'y' : 'ies'} →
                          </Link>
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="How the business profile evolved"
            description="Each change to what the platform knows creates a new version, so you can see the picture developing."
          />
          <CardBody>
            <ol className="space-y-3">
              {versions.map((version) => (
                <li key={version.version} className="border-l-2 border-line pl-3">
                  <p className="text-[12px] font-medium text-ink">
                    Business profile v{version.version}
                    <span className="ml-2 font-normal text-faint">
                      {version.createdAt.toLocaleDateString('en-GB', { dateStyle: 'medium' })}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                    {version.changeSummary ?? 'Snapshot recorded.'}
                  </p>
                </li>
              ))}
              {versions.length === 0 ? (
                <li className="text-[13px] text-faint">No versions recorded yet.</li>
              ) : null}
            </ol>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
