import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { PROJECT_STAGES, STAGE_LABELS, type ProjectStage } from '@/lib/types';
import { Card, CardBody, PageHeader, Badge, EmptyState, LinkButton } from '@/components/ui';
import { ProgressMeter } from '@/components/charts';

export const metadata = { title: 'Projects' };

const HEALTH_TONE: Record<string, 'positive' | 'caution' | 'critical'> = {
  ON_TRACK: 'positive',
  AT_RISK: 'caution',
  OFF_TRACK: 'critical',
};

const HEALTH_LABEL: Record<string, string> = {
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  OFF_TRACK: 'Off track',
};

export default async function ProjectsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requireOrg(orgId, 'project.view');
  if (!ctx) notFound();

  const projects = await prisma.project.findMany({
    where: { organisationId: orgId },
    include: {
      tasks: { select: { status: true } },
      milestones: { select: { completedAt: true } },
      opportunity: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        title="Implementation projects"
        description="Each approved opportunity becomes a project that runs through discovery, requirements, design, build, testing, pilot, launch, monitoring and optimisation."
        actions={<LinkButton href={`/app/${orgId}/roadmap`}>Roadmap</LinkButton>}
      />

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Approve an opportunity on the roadmap, then create an implementation project from it. The plan, milestones and tasks are generated from the opportunity."
          action={
            <LinkButton href={`/app/${orgId}/roadmap`} tone="primary">
              Go to roadmap
            </LinkButton>
          }
        />
      ) : (
        <div className="space-y-3">
          {projects.map((project) => {
            const done = project.tasks.filter((t) => t.status === 'DONE').length;
            const taskProgress = project.tasks.length ? done / project.tasks.length : 0;
            const milestonesDone = project.milestones.filter((m) => m.completedAt).length;
            const stageIndex = PROJECT_STAGES.indexOf(project.stage as ProjectStage);

            return (
              <Card key={project.id}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/app/${orgId}/projects/${project.id}`}
                        className="text-[14px] font-medium text-ink hover:text-brand hover:underline"
                      >
                        {project.name}
                      </Link>
                      {project.objective ? (
                        <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-muted">
                          {project.objective}
                        </p>
                      ) : null}

                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Badge tone="brand">
                          {STAGE_LABELS[project.stage as ProjectStage] ?? project.stage}
                        </Badge>
                        <Badge tone={HEALTH_TONE[project.health] ?? 'neutral'}>
                          {HEALTH_LABEL[project.health] ?? project.health}
                        </Badge>
                        <Badge>{project.status.toLowerCase()}</Badge>
                        <Badge>
                          {done} of {project.tasks.length} tasks done
                        </Badge>
                        <Badge>
                          {milestonesDone} of {project.milestones.length} milestones
                        </Badge>
                        {project.targetDate ? (
                          <Badge>
                            Target {project.targetDate.toLocaleDateString('en-GB', { dateStyle: 'medium' })}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-4 max-w-md">
                        <ProgressMeter value={taskProgress} label="Tasks complete" />
                      </div>

                      {/* Stage pipeline — the position is labelled, not colour-coded alone. */}
                      <ol className="mt-4 flex flex-wrap gap-1">
                        {PROJECT_STAGES.map((stage, index) => (
                          <li
                            key={stage}
                            className={`rounded px-1.5 py-0.5 text-[10px] ${
                              index < stageIndex
                                ? 'bg-brand/10 text-brand'
                                : index === stageIndex
                                  ? 'bg-brand text-brandInk'
                                  : 'bg-raised text-faint'
                            }`}
                          >
                            {STAGE_LABELS[stage]}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
