import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import {
  getTemplate,
  isQuestionVisible,
  computeProgress,
  missingRequired,
} from '@/lib/engine/assessment-template';
import { loadAnswers, saveAssessmentSection, completeAssessment } from '@/app/actions/assessment';
import { Card, CardBody, CardHeader, PageHeader, Button, Field, Callout, Badge } from '@/components/ui';
import { ProgressMeter } from '@/components/charts';
import { QuestionInput } from '@/components/question-input';

export const metadata = { title: 'Assessment' };

export default async function AssessmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ section?: string; saved?: string; missing?: string }>;
}) {
  const { orgId } = await params;
  const { section: sectionParam, saved, missing } = await searchParams;

  const ctx = await requireOrg(orgId, 'assessment.complete');
  if (!ctx) notFound();

  let assessment = await prisma.assessment.findFirst({
    where: { organisationId: orgId },
    orderBy: { createdAt: 'asc' },
  });

  if (!assessment) {
    assessment = await prisma.assessment.create({
      data: { organisationId: orgId, name: 'AI Business Assessment' },
    });
  }

  const template = getTemplate(assessment.templateKey);
  const answers = await loadAnswers(assessment.id);
  const progress = computeProgress(template, answers);
  const outstanding = missingRequired(template, answers);

  const activeKey = sectionParam ?? template.sections[0].key;
  const activeIndex = Math.max(
    0,
    template.sections.findIndex((s) => s.key === activeKey),
  );
  const section = template.sections[activeIndex];
  const nextSection = template.sections[activeIndex + 1];

  const visible = section.questions.filter((q) => isQuestionVisible(q, answers));
  const hidden = section.questions.length - visible.length;

  const sectionProgress = (key: string) => {
    const questions = template.sections
      .find((s) => s.key === key)!
      .questions.filter((q) => isQuestionVisible(q, answers));
    if (!questions.length) return 1;
    const done = questions.filter((q) => {
      const v = answers[q.key];
      return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
    }).length;
    return done / questions.length;
  };

  return (
    <>
      <PageHeader
        eyebrow="Understand the business"
        title={template.name}
        description={template.description}
      />

      <div className="mb-6">
        <ProgressMeter value={progress} label="Assessment progress" />
      </div>

      {saved ? (
        <div className="mb-5">
          <Callout tone="positive" title="Saved">
            Your answers for this section have been recorded and added to the business knowledge model.
          </Callout>
        </div>
      ) : null}

      {missing ? (
        <div className="mb-5">
          <Callout tone="caution" title="A required answer is still missing">
            {decodeURIComponent(missing)}
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Assessment sections">
          <ol className="space-y-1">
            {template.sections.map((s, index) => {
              const done = sectionProgress(s.key);
              const isActive = s.key === section.key;
              return (
                <li key={s.key}>
                  <Link
                    href={`/app/${orgId}/assessment?section=${s.key}`}
                    aria-current={isActive ? 'step' : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition ${
                      isActive ? 'bg-brand/10 font-medium text-brand' : 'text-muted hover:bg-raised hover:text-ink'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`tabular flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                        done >= 1
                          ? 'bg-positive text-white'
                          : isActive
                            ? 'bg-brand text-brandInk'
                            : 'bg-raised text-faint ring-1 ring-line'
                      }`}
                    >
                      {done >= 1 ? '✓' : index + 1}
                    </span>
                    <span className="truncate">{s.name}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="min-w-0">
          <Card>
            <CardHeader title={section.name} description={section.description} />
            <CardBody>
              <form action={saveAssessmentSection} className="space-y-6">
                <input type="hidden" name="assessmentId" value={assessment.id} />
                <input type="hidden" name="organisationId" value={orgId} />
                <input type="hidden" name="sectionKey" value={section.key} />

                {visible.map((question) => (
                  <Field
                    key={question.key}
                    label={question.prompt}
                    help={question.helpText}
                    required={question.required}
                  >
                    <QuestionInput question={question} value={answers[question.key]} />
                  </Field>
                ))}

                {hidden > 0 ? (
                  <p className="text-[12px] text-faint">
                    {hidden} further question{hidden === 1 ? '' : 's'} in this section will appear
                    based on your answers. Questions that do not apply to your business are not asked.
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2 border-t border-line pt-5">
                  <Button type="submit" tone="secondary">
                    Save
                  </Button>
                  {nextSection ? (
                    <Button type="submit" name="nextSection" value={nextSection.key} tone="primary">
                      Save and continue to {nextSection.name.toLowerCase()}
                    </Button>
                  ) : null}
                </div>
              </form>
            </CardBody>
          </Card>

          {!nextSection ? (
            <div className="mt-6">
              <Card>
                <CardHeader
                  title="Finish the assessment"
                  description="This builds your business knowledge model and starts the adaptive interview, which asks only about what is still missing."
                />
                <CardBody>
                  {outstanding.length > 0 ? (
                    <div className="mb-4">
                      <Callout tone="caution" title={`${outstanding.length} required answer${outstanding.length === 1 ? '' : 's'} outstanding`}>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          {outstanding.slice(0, 5).map((q) => (
                            <li key={q.key}>{q.prompt}</li>
                          ))}
                        </ul>
                      </Callout>
                    </div>
                  ) : null}
                  <form action={completeAssessment}>
                    <input type="hidden" name="assessmentId" value={assessment.id} />
                    <input type="hidden" name="organisationId" value={orgId} />
                    <Button type="submit" tone="primary" disabled={outstanding.length > 0}>
                      Complete assessment
                    </Button>
                  </form>
                </CardBody>
              </Card>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2">
            <Badge>{Object.keys(answers).length} answers recorded</Badge>
            <Badge tone={assessment.status === 'COMPLETE' ? 'positive' : 'neutral'}>
              {assessment.status === 'COMPLETE' ? 'Complete' : 'In progress'}
            </Badge>
          </div>
        </div>
      </div>
    </>
  );
}
