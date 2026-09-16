import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { parseJson } from '@/lib/json';
import { PROJECT_STAGES, STAGE_LABELS, type ProjectStage } from '@/lib/types';
import {
  updateTaskStatus,
  addTask,
  updateProjectStage,
  completeMilestone,
  addComment,
} from '@/app/actions/projects';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Badge,
  Button,
  Field,
  inputClass,
  KeyValue,
  LinkButton,
  SectionLabel,
} from '@/components/ui';
import { ProgressMeter } from '@/components/charts';

export const metadata = { title: 'Project' };

const STATUS_NEXT: Record<string, { label: string; value: string; tone: 'primary' | 'secondary' }[]> = {
  TODO: [{ label: 'Start', value: 'IN_PROGRESS', tone: 'secondary' }],
  IN_PROGRESS: [
    { label: 'Complete', value: 'DONE', tone: 'primary' },
    { label: 'Block', value: 'BLOCKED', tone: 'secondary' },
  ],
  BLOCKED: [{ label: 'Unblock', value: 'IN_PROGRESS', tone: 'secondary' }],
  DONE: [{ label: 'Reopen', value: 'TODO', tone: 'secondary' }],
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; projectId: string }>;
}) {
  const { orgId, projectId } = await params;
  const ctx = await requireOrg(orgId, 'project.view');
  if (!ctx) notFound();

  const project = await prisma.project.findFirst({
    where: { id: projectId, organisationId: orgId },
    include: {
      tasks: { orderBy: [{ order: 'asc' }], include: { assignee: true } },
      milestones: { orderBy: { order: 'asc' } },
      comments: { orderBy: { createdAt: 'desc' }, include: { author: true } },
      kpis: { include: { results: { orderBy: { periodEnd: 'desc' }, take: 1 } } },
      opportunity: true,
    },
  });
  if (!project) notFound();

  const members = await prisma.membership.findMany({
    where: { organisationId: orgId },
    include: { user: { select: { id: true, name: true } } },
  });

  const canManage = ctx.can('project.manage');
  const canParticipate = ctx.can('project.participate') || canManage;
  const integrations = parseJson<string[]>(project.integrations, []);

  const done = project.tasks.filter((t) => t.status === 'DONE').length;
  const taskProgress = project.tasks.length ? done / project.tasks.length : 0;
  const stageIndex = PROJECT_STAGES.indexOf(project.stage as ProjectStage);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/app/${orgId}/projects`} className="hover:underline">
            Projects
          </Link>
        }
        title={project.name}
        description={project.objective ?? undefined}
        actions={<LinkButton href={`/app/${orgId}/performance`}>Performance</LinkButton>}
      />

      <div className="mb-6 flex flex-wrap gap-1.5">
        <Badge tone="brand">{STAGE_LABELS[project.stage as ProjectStage] ?? project.stage}</Badge>
        <Badge>{project.status.toLowerCase()}</Badge>
        <Badge
          tone={
            project.health === 'ON_TRACK' ? 'positive' : project.health === 'AT_RISK' ? 'caution' : 'critical'
          }
        >
          {project.health.replace(/_/g, ' ').toLowerCase()}
        </Badge>
        {project.opportunity ? (
          <Link
            href={`/app/${orgId}/opportunities/${project.opportunity.id}`}
            className="text-[12px] font-medium text-brand hover:underline"
          >
            View source opportunity →
          </Link>
        ) : null}
      </div>

      {/* Stage pipeline */}
      <div className="mb-6">
        <Card>
          <CardBody>
            <SectionLabel>Delivery stage</SectionLabel>
            <ol className="flex flex-wrap gap-1.5">
              {PROJECT_STAGES.map((stage, index) => (
                <li key={stage}>
                  <span
                    className={`inline-block rounded-lg px-2.5 py-1 text-[12px] ${
                      index < stageIndex
                        ? 'bg-brand/10 text-brand'
                        : index === stageIndex
                          ? 'bg-brand font-medium text-brandInk'
                          : 'bg-raised text-faint'
                    }`}
                  >
                    {STAGE_LABELS[stage]}
                  </span>
                </li>
              ))}
            </ol>

            {canManage ? (
              <form action={updateProjectStage} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
                <input type="hidden" name="organisationId" value={orgId} />
                <input type="hidden" name="projectId" value={project.id} />
                <div className="w-44">
                  <Field label="Stage">
                    <select name="stage" defaultValue={project.stage} className={inputClass}>
                      {PROJECT_STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                          {STAGE_LABELS[stage]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="w-36">
                  <Field label="Status">
                    <select name="status" defaultValue={project.status} className={inputClass}>
                      {['ACTIVE', 'ON_HOLD', 'COMPLETE', 'CANCELLED'].map((status) => (
                        <option key={status} value={status}>
                          {status.replace(/_/g, ' ').toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="w-36">
                  <Field label="Health">
                    <select name="health" defaultValue={project.health} className={inputClass}>
                      {['ON_TRACK', 'AT_RISK', 'OFF_TRACK'].map((health) => (
                        <option key={health} value={health}>
                          {health.replace(/_/g, ' ').toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Button type="submit" tone="secondary">
                  Update
                </Button>
              </form>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Tasks"
              description={`${done} of ${project.tasks.length} complete.`}
            />
            <CardBody className="space-y-4">
              <ProgressMeter value={taskProgress} label="Progress" />

              {PROJECT_STAGES.map((stage) => {
                const stageTasks = project.tasks.filter((t) => t.stage === stage);
                if (!stageTasks.length) return null;

                return (
                  <div key={stage} className="border-t border-line pt-3">
                    <SectionLabel>{STAGE_LABELS[stage]}</SectionLabel>
                    <ul className="space-y-2">
                      {stageTasks.map((task) => (
                        <li
                          key={task.id}
                          className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-[13px] font-medium ${
                                task.status === 'DONE' ? 'text-faint line-through' : 'text-ink'
                              }`}
                            >
                              {task.title}
                            </p>
                            {task.description ? (
                              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                                {task.description}
                              </p>
                            ) : null}
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              <Badge
                                tone={
                                  task.status === 'DONE'
                                    ? 'positive'
                                    : task.status === 'BLOCKED'
                                      ? 'critical'
                                      : 'neutral'
                                }
                              >
                                {task.status.replace(/_/g, ' ').toLowerCase()}
                              </Badge>
                              <Badge>{task.priority.toLowerCase()} priority</Badge>
                              {task.assignee ? <Badge>{task.assignee.name}</Badge> : null}
                            </div>
                          </div>

                          {canParticipate ? (
                            <div className="flex shrink-0 gap-1.5">
                              {(STATUS_NEXT[task.status] ?? []).map((action) => (
                                <form key={action.value} action={updateTaskStatus}>
                                  <input type="hidden" name="organisationId" value={orgId} />
                                  <input type="hidden" name="taskId" value={task.id} />
                                  <input type="hidden" name="status" value={action.value} />
                                  <Button type="submit" tone={action.tone}>
                                    {action.label}
                                  </Button>
                                </form>
                              ))}
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}

              {canManage ? (
                <form action={addTask} className="space-y-3 border-t border-line pt-4">
                  <input type="hidden" name="organisationId" value={orgId} />
                  <input type="hidden" name="projectId" value={project.id} />
                  <Field label="Add a task">
                    <input name="title" className={inputClass} placeholder="What needs doing" required />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <select name="stage" defaultValue={project.stage} className={inputClass}>
                      {PROJECT_STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                          {STAGE_LABELS[stage]}
                        </option>
                      ))}
                    </select>
                    <select name="priority" defaultValue="MEDIUM" className={inputClass}>
                      {['LOW', 'MEDIUM', 'HIGH'].map((priority) => (
                        <option key={priority} value={priority}>
                          {priority.toLowerCase()} priority
                        </option>
                      ))}
                    </select>
                    <select name="assigneeId" defaultValue="" className={inputClass}>
                      <option value="">Unassigned</option>
                      {members.map((member) => (
                        <option key={member.user.id} value={member.user.id}>
                          {member.user.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button type="submit" tone="secondary">
                    Add task
                  </Button>
                </form>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Discussion" />
            <CardBody className="space-y-4">
              {canParticipate ? (
                <form action={addComment} className="space-y-2">
                  <input type="hidden" name="organisationId" value={orgId} />
                  <input type="hidden" name="projectId" value={project.id} />
                  <textarea
                    name="body"
                    rows={2}
                    className={inputClass}
                    placeholder="Add a comment"
                    required
                  />
                  <Button type="submit" tone="secondary">
                    Post
                  </Button>
                </form>
              ) : null}

              {project.comments.length ? (
                <ul className="space-y-3 border-t border-line pt-3">
                  {project.comments.map((comment) => (
                    <li key={comment.id}>
                      <p className="text-[12px] text-faint">
                        <span className="font-medium text-ink">{comment.author.name}</span>{' '}
                        {comment.createdAt.toLocaleString('en-GB', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </p>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{comment.body}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-faint">No comments yet.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Milestones" />
            <CardBody>
              <ul className="space-y-2.5">
                {project.milestones.map((milestone) => (
                  <li key={milestone.id} className="flex items-start gap-2.5">
                    {canManage ? (
                      <form action={completeMilestone}>
                        <input type="hidden" name="organisationId" value={orgId} />
                        <input type="hidden" name="milestoneId" value={milestone.id} />
                        <button
                          type="submit"
                          aria-label={milestone.completedAt ? 'Mark incomplete' : 'Mark complete'}
                          className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border text-[9px] ${
                            milestone.completedAt
                              ? 'border-positive bg-positive text-white'
                              : 'border-line bg-surface text-transparent hover:border-brand'
                          }`}
                        >
                          ✓
                        </button>
                      </form>
                    ) : (
                      <span
                        aria-hidden
                        className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border text-[9px] ${
                          milestone.completedAt
                            ? 'border-positive bg-positive text-white'
                            : 'border-line text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                    )}
                    <div className="min-w-0">
                      <p
                        className={`text-[12px] ${
                          milestone.completedAt ? 'text-faint line-through' : 'text-ink'
                        }`}
                      >
                        {milestone.name}
                      </p>
                      <p className="text-[11px] text-faint">
                        {STAGE_LABELS[milestone.stage as ProjectStage] ?? milestone.stage}
                        {milestone.dueDate
                          ? ` · due ${milestone.dueDate.toLocaleDateString('en-GB', { dateStyle: 'medium' })}`
                          : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Requirements" />
            <CardBody>
              <dl>
                <KeyValue label="Scope" value={project.scope ?? 'Not recorded'} />
                <KeyValue label="AI technology" value={project.aiTechnology ?? 'Not recorded'} />
                <KeyValue
                  label="Integrations"
                  value={integrations.length ? integrations.join(', ') : 'None identified'}
                />
                <KeyValue label="Data requirements" value={project.dataRequirements ?? 'Not recorded'} />
                <KeyValue label="Security" value={project.securityRequirements ?? 'Not recorded'} />
                <KeyValue label="Testing" value={project.testingRequirements ?? 'Not recorded'} />
                <KeyValue label="Launch" value={project.launchRequirements ?? 'Not recorded'} />
                <KeyValue label="Training" value={project.trainingRequirements ?? 'Not recorded'} />
                <KeyValue label="Human oversight" value={project.humanOversight ?? 'Not recorded'} />
                <KeyValue label="Monitoring" value={project.monitoringRequirements ?? 'Not recorded'} />
              </dl>
            </CardBody>
          </Card>

          {project.kpis.length > 0 ? (
            <Card>
              <CardHeader
                title="KPIs"
                description="Recorded against this project so projected and actual can be compared."
              />
              <CardBody>
                <ul className="space-y-3">
                  {project.kpis.map((kpi) => (
                    <li key={kpi.id} className="border-b border-line pb-2.5 last:border-0 last:pb-0">
                      <p className="text-[12px] font-medium text-ink">{kpi.name}</p>
                      <p className="tabular mt-0.5 text-[12px] text-muted">
                        baseline {kpi.baselineValue ?? '—'} · projected {kpi.projectedValue ?? '—'} ·
                        actual {kpi.results[0]?.actualValue ?? 'not recorded'} {kpi.unit}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="mt-3">
                  <Link
                    href={`/app/${orgId}/performance`}
                    className="text-[12px] font-medium text-brand hover:underline"
                  >
                    Record results →
                  </Link>
                </p>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
