import { prisma } from '@/lib/db';
import { isLlmConfigured, analysisModel, reportModel } from '@/lib/ai/provider';
import { PageHeader, Card, CardBody, CardHeader, Callout, DataTable } from '@/components/ui';
import { StatGrid, StatTile } from '@/components/charts';

export const metadata = { title: 'Platform overview' };

export default async function AdminOverview() {
  const [
    organisations,
    users,
    opportunities,
    projects,
    documents,
    reports,
    generations,
  ] = await Promise.all([
    prisma.organisation.count(),
    prisma.user.count(),
    prisma.aIOpportunity.count(),
    prisma.project.count(),
    prisma.document.count(),
    prisma.report.count(),
    prisma.aIGenerationLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);

  const byProvider = generations.reduce<Record<string, number>>((acc, log) => {
    acc[log.provider] = (acc[log.provider] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="Usage across every organisation on the platform."
      />

      {!isLlmConfigured() ? (
        <div className="mb-6">
          <Callout tone="caution" title="No Anthropic API key configured">
            The platform is running its built-in deterministic analysis engine. Every part of the
            workflow works, and all figures are calculated the same way; what is missing is the
            Claude-written judgement and phrasing layer. Set ANTHROPIC_API_KEY to enable it.
          </Callout>
        </div>
      ) : null}

      <StatGrid cols={4}>
        <StatTile label="Organisations" value={String(organisations)} />
        <StatTile label="Users" value={String(users)} />
        <StatTile label="Opportunities identified" value={String(opportunities)} />
        <StatTile label="Implementation projects" value={String(projects)} />
        <StatTile label="Documents processed" value={String(documents)} />
        <StatTile label="Reports generated" value={String(reports)} />
        <StatTile
          label="Analysis provider"
          value={isLlmConfigured() ? 'Claude' : 'Engine'}
          caption={isLlmConfigured() ? `${analysisModel()} · ${reportModel()}` : 'Deterministic in-process engine'}
        />
        <StatTile
          label="Recent agent runs"
          value={String(generations.length)}
          caption={Object.entries(byProvider)
            .map(([provider, count]) => `${provider}: ${count}`)
            .join(', ')}
        />
      </StatGrid>

      <div className="mt-6">
        <Card>
          <CardHeader
            title="Recent AI agent runs"
            description="Every agent invocation is logged, with which provider served it and how long it took."
          />
          <CardBody>
            {generations.length ? (
              <DataTable
                columns={['When', 'Agent', 'Task', 'Provider', 'Model', 'Duration', 'Status']}
                align={[5]}
                rows={generations.map((log) => [
                  log.createdAt.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }),
                  log.agent,
                  log.task,
                  log.provider,
                  log.model ?? '—',
                  log.durationMs != null ? `${log.durationMs} ms` : '—',
                  log.status,
                ])}
              />
            ) : (
              <p className="text-[13px] text-faint">No agent runs recorded yet.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
