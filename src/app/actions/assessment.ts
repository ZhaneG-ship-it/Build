'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { recordAudit } from '@/lib/audit';
import { parseAnswer, stringify } from '@/lib/json';
import {
  computeProgress,
  getTemplate,
  missingRequired,
  visibleQuestions,
} from '@/lib/engine/assessment-template';
import { applyAssessmentAnswers } from '@/lib/engine/ingest';
import { snapshotKnowledgeModel } from '@/lib/engine/knowledge-model';

/** Reads current answers for an assessment as a plain key -> value map. */
export async function loadAnswers(assessmentId: string): Promise<Record<string, unknown>> {
  const answers = await prisma.assessmentAnswer.findMany({ where: { assessmentId } });
  const map: Record<string, unknown> = {};
  for (const answer of answers) map[answer.questionKey] = parseAnswer(answer.value);
  return map;
}

/**
 * Coerces a form field into the value shape the question expects. Multi-select
 * values arrive as repeated fields; list values arrive as newline-delimited text.
 */
function readValue(formData: FormData, key: string, inputType: string): unknown {
  if (inputType === 'MULTISELECT') {
    const values = formData.getAll(key).map(String).filter((v) => v !== '');
    return values;
  }

  const raw = formData.get(key);
  if (raw === null) return undefined;
  const text = String(raw).trim();

  switch (inputType) {
    case 'BOOLEAN':
      return text === 'true' || text === 'on' || text === 'yes';
    case 'NUMBER':
    case 'CURRENCY':
    case 'PERCENT':
    case 'SCALE': {
      if (text === '') return null;
      const n = Number(text.replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    case 'LIST':
      return text
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*•]\s*/, '').trim())
        .filter(Boolean);
    default:
      return text === '' ? null : text;
  }
}

export async function saveAssessmentSection(formData: FormData) {
  const assessmentId = String(formData.get('assessmentId'));
  const organisationId = String(formData.get('organisationId'));
  const sectionKey = String(formData.get('sectionKey'));
  const nextSection = formData.get('nextSection') ? String(formData.get('nextSection')) : null;

  const ctx = await requireOrg(organisationId, 'assessment.complete');

  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, organisationId },
  });
  if (!assessment) throw new Error('Assessment not found in this organisation');

  const template = getTemplate(assessment.templateKey);
  const section = template.sections.find((s) => s.key === sectionKey);
  if (!section) throw new Error('Unknown assessment section');

  // Persist each answered question in this section.
  for (const question of section.questions) {
    const value = readValue(formData, question.key, question.inputType);
    if (value === undefined) continue;

    const record = await prisma.assessmentQuestion.upsert({
      where: { id: `${assessmentId}:${question.key}` },
      create: {
        id: `${assessmentId}:${question.key}`,
        assessmentId,
        section: section.key,
        businessArea: question.businessArea,
        key: question.key,
        prompt: question.prompt,
        helpText: question.helpText,
        inputType: question.inputType,
        options: stringify(question.options ?? []),
        required: question.required ?? false,
        dependsOn: question.dependsOn ? stringify(question.dependsOn) : null,
      },
      update: { prompt: question.prompt, inputType: question.inputType },
    });

    await prisma.assessmentAnswer.upsert({
      where: { assessmentId_questionId: { assessmentId, questionId: record.id } },
      create: {
        assessmentId,
        questionId: record.id,
        questionKey: question.key,
        value: stringify(value),
        answeredById: ctx.user.id,
        source: 'USER',
        confidence: 'HIGH',
      },
      update: { value: stringify(value), answeredById: ctx.user.id, confidence: 'HIGH' },
    });
  }

  const answers = await loadAnswers(assessmentId);
  const progress = computeProgress(template, answers);

  await prisma.assessment.update({
    where: { id: assessmentId },
    data: { progress, status: progress >= 1 ? 'COMPLETE' : 'IN_PROGRESS' },
  });

  // Push everything captured so far into the knowledge model.
  await applyAssessmentAnswers(organisationId, answers);

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'assessment.save_section',
    entityType: 'Assessment',
    entityId: assessmentId,
    metadata: { sectionKey, progress },
  });

  revalidatePath(`/app/${organisationId}/assessment`);
  revalidatePath(`/app/${organisationId}`);

  if (nextSection) {
    redirect(`/app/${organisationId}/assessment?section=${nextSection}`);
  }
  redirect(`/app/${organisationId}/assessment?section=${sectionKey}&saved=1`);
}

export async function completeAssessment(formData: FormData) {
  const assessmentId = String(formData.get('assessmentId'));
  const organisationId = String(formData.get('organisationId'));
  const ctx = await requireOrg(organisationId, 'assessment.complete');

  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, organisationId },
  });
  if (!assessment) throw new Error('Assessment not found in this organisation');

  const template = getTemplate(assessment.templateKey);
  const answers = await loadAnswers(assessmentId);
  const missing = missingRequired(template, answers);

  if (missing.length > 0) {
    const section = template.sections.find((s) =>
      s.questions.some((q) => q.key === missing[0].key),
    );
    redirect(
      `/app/${organisationId}/assessment?section=${section?.key ?? template.sections[0].key}&missing=${encodeURIComponent(
        missing[0].prompt,
      )}`,
    );
  }

  await applyAssessmentAnswers(organisationId, answers);
  await prisma.assessment.update({
    where: { id: assessmentId },
    data: {
      status: 'COMPLETE',
      progress: 1,
      completedAt: new Date(),
    },
  });

  await snapshotKnowledgeModel(organisationId, 'ASSESSMENT', 'Assessment completed.');

  await recordAudit({
    organisationId,
    userId: ctx.user.id,
    action: 'assessment.complete',
    entityType: 'Assessment',
    entityId: assessmentId,
    metadata: { questions: visibleQuestions(template, answers).length },
  });

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/interview?started=1`);
}
