'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { recordAudit } from '@/lib/audit';
import { parseJson, stringify } from '@/lib/json';
import { buildKnowledgeModel } from '@/lib/engine/knowledge-model';
import { buildImplementationPlan } from '@/lib/ai/agents/implementation';
import type { Dependencies } from '@/lib/engine/opportunities';

/**
 * Creates an implementation project from an approved opportunity (§13, §14).
 * The Implementation Agent produces the plan; milestones, tasks and the KPI
 * links are written from it.
 */
export async function createProjectFromOpportunity(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const opportunityId = String(formData.get('opportunityId'));
  const ctx = await requireOrg(organisationId, 'project.manage');

  const opportunity = await prisma.aIOpportunity.findFirst({
    where: { id: opportunityId, organisationId },
    include: { kpis: true, projects: true },
  });
  if (!opportunity) throw new Error('Opportunity not found in this organisation');

  if (opportunity.projects.length > 0) {
    redirect(`/app/${organisationId}/projects/${opportunity.projects[0].id}`);
  }

  const km = await buildKnowledgeModel(organisationId);
  const { plan } = await buildImplementationPlan(
    {
      name: opportunity.name,
      currentProblem: opportunity.currentProblem,
      proposedSolution: opportunity.proposedSolution,
      aiCategory: opportunity.aiCategory,
      implementationComplexity: opportunity.implementationComplexity,
      riskLevel: opportunity.riskLevel,
      humanOversight: opportunity.humanOversight,
      dependencies: parseJson<Dependencies>(opportunity.dependencies, {
        data: [],
        software: [],
        apis: [],
        integrations: [],
        training: [],
        security: [],
        policies: [],
      }),
    },
    km,
  );

  const start = new Date();
  const target = new Date(start.getTime() + plan.estimatedWeeks * 7 * 24 * 60 * 60 * 1000);
  const calculation = await prisma.opportunityCalculation.findUnique({ where: { opportunityId } });

  const project = await prisma.project.create({
    data: {
      organisationId,
      opportunityId,
      name: opportunity.name,
      objective: plan.objective,
      scope: plan.scope,
      ownerUserId: ctx.user.id,
      aiTechnology: plan.aiTechnology,
      integrations: stringify(plan.integrations),
      dataRequirements: plan.dataRequirements,
      securityRequirements: plan.securityRequirements,
      testingRequirements: plan.testingRequirements,
      launchRequirements: plan.launchRequirements,
      trainingRequirements: plan.trainingRequirements,
      humanOversight: plan.humanOversight,
      monitoringRequirements: plan.monitoringRequirements,
      budget: calculation?.implementationCostHigh ?? null,
      startDate: start,
      targetDate: target,
      milestones: {
        create: plan.milestones.map((m, index) => ({
          name: m.name,
          stage: m.stage,
          order: index,
          dueDate: new Date(start.getTime() + m.weekOffset * 7 * 24 * 60 * 60 * 1000),
        })),
      },
      tasks: {
        create: plan.tasks.map((t, index) => ({
          title: t.title,
          description: t.description,
          stage: t.stage,
          priority: t.priority,
          order: index,
        })),
      },
    },
  });

  // Attach the opportunity's KPIs so projected and actual live in one place.
  await prisma.kpi.updateMany({
    where: { organisationId, opportunityId, projectId: null },
    data: { projectId: project.id },
  });

  await prisma.aIOpportunity.update({
    where: { id: opportunityId },
    data: { status: 'IN_IMPLEMENTATION' },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'project.create',
    entityType: 'Project',
    entityId: project.id,
    metadata: { opportunityId, tasks: plan.tasks.length },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/projects/${project.id}`);
}

export async function updateTaskStatus(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const taskId = String(formData.get('taskId'));
  const status = String(formData.get('status'));
  const ctx = await requireOrg(organisationId, 'project.participate');

  const task = await prisma.task.findFirst({
    where: { id: taskId, project: { organisationId } },
    include: { project: true },
  });
  if (!task) throw new Error('Task not found in this organisation');

  await prisma.task.update({
    where: { id: taskId },
    data: { status, completedAt: status === 'DONE' ? new Date() : null },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'task.status_change',
    entityType: 'Task',
    entityId: taskId,
    metadata: { status },
  });

  revalidatePath(`/app/${organisationId}/projects/${task.projectId}`);
}

export async function addTask(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const projectId = String(formData.get('projectId'));
  const ctx = await requireOrg(organisationId, 'project.manage');

  const project = await prisma.project.findFirst({ where: { id: projectId, organisationId } });
  if (!project) throw new Error('Project not found in this organisation');

  const title = String(formData.get('title') ?? '').trim();
  if (!title) redirect(`/app/${organisationId}/projects/${projectId}`);

  const count = await prisma.task.count({ where: { projectId } });

  await prisma.task.create({
    data: {
      projectId,
      title,
      description: String(formData.get('description') ?? '').trim() || null,
      stage: String(formData.get('stage') ?? project.stage),
      priority: String(formData.get('priority') ?? 'MEDIUM'),
      assigneeId: String(formData.get('assigneeId') ?? '') || null,
      order: count,
    },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'task.create',
    entityType: 'Project',
    entityId: projectId,
    metadata: { title },
  });

  revalidatePath(`/app/${organisationId}/projects/${projectId}`);
}

export async function updateProjectStage(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const projectId = String(formData.get('projectId'));
  const ctx = await requireOrg(organisationId, 'project.manage');

  const project = await prisma.project.findFirst({ where: { id: projectId, organisationId } });
  if (!project) throw new Error('Project not found in this organisation');

  const stage = String(formData.get('stage') ?? project.stage);
  const status = String(formData.get('status') ?? project.status);
  const health = String(formData.get('health') ?? project.health);

  await prisma.project.update({
    where: { id: projectId },
    data: { stage, status, health },
  });

  // Reaching monitoring means the AI is live — record it as an implementation.
  if (stage === 'MONITORING' && project.opportunityId) {
    const existing = await prisma.aIImplementation.findUnique({
      where: { opportunityId: project.opportunityId },
    });
    if (!existing) {
      await prisma.aIImplementation.create({
        data: {
          organisationId,
          opportunityId: project.opportunityId,
          name: project.name,
          technology: project.aiTechnology,
          status: 'LIVE',
          goLiveDate: new Date(),
          oversightModel: project.humanOversight,
        },
      });
      await prisma.aIOpportunity.update({
        where: { id: project.opportunityId },
        data: { status: 'LIVE' },
      });
    }
  }

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'project.stage_change',
    entityType: 'Project',
    entityId: projectId,
    metadata: { stage, status, health },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
}

export async function completeMilestone(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const milestoneId = String(formData.get('milestoneId'));
  const ctx = await requireOrg(organisationId, 'project.manage');

  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, project: { organisationId } },
  });
  if (!milestone) throw new Error('Milestone not found in this organisation');

  await prisma.milestone.update({
    where: { id: milestoneId },
    data: { completedAt: milestone.completedAt ? null : new Date() },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'milestone.toggle',
    entityType: 'Milestone',
    entityId: milestoneId,
  });

  revalidatePath(`/app/${organisationId}/projects/${milestone.projectId}`);
}

export async function addComment(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const projectId = String(formData.get('projectId'));
  const body = String(formData.get('body') ?? '').trim();
  const ctx = await requireOrg(organisationId, 'project.participate');

  const project = await prisma.project.findFirst({ where: { id: projectId, organisationId } });
  if (!project) throw new Error('Project not found in this organisation');
  if (!body) redirect(`/app/${organisationId}/projects/${projectId}`);

  await prisma.comment.create({ data: { projectId, authorId: ctx.user.id, body } });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'project.comment',
    entityType: 'Project',
    entityId: projectId,
  });

  revalidatePath(`/app/${organisationId}/projects/${projectId}`);
}
