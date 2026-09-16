'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { recordAudit } from '@/lib/audit';
import { stringify } from '@/lib/json';
import { buildKnowledgeModel, snapshotKnowledgeModel } from '@/lib/engine/knowledge-model';
import { applyInterviewAnswer } from '@/lib/engine/ingest';
import { planInterview } from '@/lib/ai/agents/interview';

/**
 * Runs one round of the adaptive interview: works out what is still missing,
 * generates the questions for it, and stores each with the reason it was asked.
 */
export async function generateInterviewRound(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const ctx = await requireOrg(organisationId, 'assessment.complete');

  let session = await prisma.interviewSession.findFirst({
    where: { organisationId, status: 'ACTIVE' },
    include: { turns: true },
  });

  if (!session) {
    const created = await prisma.interviewSession.create({ data: { organisationId } });
    session = { ...created, turns: [] };
  }

  // Never re-ask something already put to the client.
  const previous = await prisma.interviewTurn.findMany({
    where: { session: { organisationId } },
  });
  const alreadyAsked = new Set(previous.map((t) => t.targetField ?? t.question));

  const unanswered = session.turns.filter((t) => !t.answeredAt).length;
  if (unanswered > 0) {
    redirect(`/app/${organisationId}/interview`);
  }

  const km = await buildKnowledgeModel(organisationId);
  const round = session.roundsRun + 1;
  const { plan, provider } = await planInterview(km, alreadyAsked, round);

  if (plan.hasEnoughInformation || plan.questions.length === 0) {
    await prisma.interviewSession.update({
      where: { id: session.id },
      data: {
        status: 'SUFFICIENT',
        roundsRun: round,
        stopReason:
          plan.stopReason ??
          'The platform has enough information to produce a reliable assessment.',
      },
    });

    await recordAudit({
      organisationId,
      userId: ctx.user.id,
      action: 'interview.complete',
      entityType: 'InterviewSession',
      entityId: session.id,
      metadata: { round, provider },
    });

    revalidatePath(`/app/${organisationId}`, 'layout');
    redirect(`/app/${organisationId}/interview?complete=1`);
  }

  await prisma.interviewTurn.createMany({
    data: plan.questions.map((q, index) => ({
      sessionId: session.id,
      question: q.question,
      reasonForQuestion: q.reasonForQuestion,
      businessArea: q.businessArea,
      targetField: q.targetField,
      inputType: q.inputType,
      options: stringify(q.options ?? []),
      source: provider === 'anthropic' ? 'AI' : 'ENGINE',
      round,
      order: index,
    })),
  });

  await prisma.interviewSession.update({
    where: { id: session.id },
    data: { roundsRun: round },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'interview.round_generated',
    entityType: 'InterviewSession',
    entityId: session.id,
    metadata: { round, questions: plan.questions.length, provider },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/interview`);
}

/** Saves the answers for the current round and writes them into the model. */
export async function submitInterviewAnswers(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const ctx = await requireOrg(organisationId, 'assessment.complete');

  const session = await prisma.interviewSession.findFirst({
    where: { organisationId, status: 'ACTIVE' },
    include: { turns: { where: { answeredAt: null } } },
  });
  if (!session) redirect(`/app/${organisationId}/interview`);

  let applied = 0;
  let answered = 0;

  for (const turn of session.turns) {
    const raw = formData.get(`turn:${turn.id}`);
    if (raw === null) continue;
    const answer = String(raw).trim();
    if (!answer) continue;

    await prisma.interviewTurn.update({
      where: { id: turn.id },
      data: { answer, answeredAt: new Date(), confidence: 'HIGH' },
    });
    answered++;

    if (await applyInterviewAnswer(organisationId, turn.targetField, answer)) applied++;
  }

  if (answered > 0) {
    await snapshotKnowledgeModel(
      organisationId,
      'INTERVIEW',
      `${answered} interview answers recorded, ${applied} written into the model.`,
    );
  }

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'interview.answers_submitted',
    entityType: 'InterviewSession',
    entityId: session.id,
    metadata: { answered, applied },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/interview?saved=${answered}`);
}

/** Lets the client stop the interview early and proceed with what is known. */
export async function closeInterview(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const ctx = await requireOrg(organisationId, 'assessment.complete');

  await prisma.interviewSession.updateMany({
    where: { organisationId, status: 'ACTIVE' },
    data: {
      status: 'CLOSED',
      stopReason: 'Closed by the client. Remaining gaps are reported as low confidence.',
    },
  });

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'interview.closed_early',
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/interview?complete=1`);
}
