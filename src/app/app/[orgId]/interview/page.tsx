import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { parseJson } from '@/lib/json';
import { buildKnowledgeModel } from '@/lib/engine/knowledge-model';
import {
  generateInterviewRound,
  submitInterviewAnswers,
  closeInterview,
} from '@/app/actions/interview';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Button,
  Callout,
  Badge,
  EmptyState,
  LinkButton,
  inputClass,
} from '@/components/ui';

export const metadata = { title: 'AI interview' };

const AREA_LABELS: Record<string, string> = {
  company: 'Company',
  strategy: 'Strategy',
  operations: 'Operations',
  people: 'People',
  technology: 'Technology',
  financial: 'Financial',
  risk: 'Risk',
  ai: 'AI',
};

export default async function InterviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ complete?: string; saved?: string; started?: string }>;
}) {
  const { orgId } = await params;
  const { complete, saved } = await searchParams;

  const ctx = await requireOrg(orgId, 'assessment.complete');
  if (!ctx) notFound();

  const [session, km, answeredCount] = await Promise.all([
    prisma.interviewSession.findFirst({
      where: { organisationId: orgId },
      orderBy: { createdAt: 'desc' },
      include: { turns: { orderBy: [{ round: 'asc' }, { order: 'asc' }] } },
    }),
    buildKnowledgeModel(orgId),
    prisma.interviewTurn.count({
      where: { session: { organisationId: orgId }, answeredAt: { not: null } },
    }),
  ]);

  const pending = (session?.turns ?? []).filter((t) => !t.answeredAt);
  const answered = (session?.turns ?? []).filter((t) => t.answeredAt);
  const isActive = session?.status === 'ACTIVE';

  return (
    <>
      <PageHeader
        eyebrow="Understand the business"
        title="Adaptive AI interview"
        description="The platform works out what it still needs to know and asks only about that. Every question shows why it is being asked and what it will let the platform calculate."
        actions={
          pending.length === 0 && isActive ? (
            <form action={generateInterviewRound}>
              <input type="hidden" name="organisationId" value={orgId} />
              <Button type="submit" tone="primary">
                Generate questions
              </Button>
            </form>
          ) : null
        }
      />

      {saved ? (
        <div className="mb-5">
          <Callout tone="positive" title={`${saved} answer${saved === '1' ? '' : 's'} recorded`}>
            These have been written into your business knowledge model and will be used in the
            analysis.
          </Callout>
        </div>
      ) : null}

      {complete || session?.status === 'SUFFICIENT' || session?.status === 'CLOSED' ? (
        <div className="mb-5">
          <Callout
            tone={session?.status === 'CLOSED' ? 'caution' : 'positive'}
            title={
              session?.status === 'CLOSED'
                ? 'Interview closed early'
                : 'The platform has enough information'
            }
          >
            {session?.stopReason ??
              'The platform has enough to produce a reliable assessment.'}{' '}
            <span className="mt-2 block">
              <LinkButton href={`/app/${orgId}/opportunities`} tone="primary">
                Continue to the analysis
              </LinkButton>
            </span>
          </Callout>
        </div>
      ) : null}

      {km.completeness.criticalGaps.length > 0 && pending.length === 0 && isActive ? (
        <div className="mb-5">
          <Callout tone="caution" title="Known gaps">
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {km.completeness.criticalGaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </Callout>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <Card>
          <CardHeader
            title={`Round ${session?.roundsRun ?? 1}`}
            description={`${pending.length} question${pending.length === 1 ? '' : 's'}. Answer what you can — leave anything you are unsure of blank and the platform will report lower confidence rather than guess.`}
          />
          <CardBody>
            <form action={submitInterviewAnswers} className="space-y-6">
              <input type="hidden" name="organisationId" value={orgId} />

              {pending.map((turn, index) => {
                const options = parseJson<string[]>(turn.options, []);
                return (
                  <div key={turn.id} className="border-b border-line pb-6 last:border-0 last:pb-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="tabular text-[11px] font-semibold text-faint">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <Badge tone="brand">{AREA_LABELS[turn.businessArea] ?? turn.businessArea}</Badge>
                      {turn.targetField ? <Badge>Fills a specific field</Badge> : null}
                    </div>

                    <label className="block">
                      <span className="block text-[14px] font-medium leading-snug text-ink">
                        {turn.question}
                      </span>
                      <span className="mt-1.5 block rounded-lg border-l-2 border-brand/40 bg-raised px-3 py-2 text-[12px] leading-relaxed text-muted">
                        <span className="font-medium text-ink">Why this is being asked: </span>
                        {turn.reasonForQuestion}
                      </span>

                      <span className="mt-3 block">
                        {turn.inputType === 'SELECT' && options.length ? (
                          <select name={`turn:${turn.id}`} className={inputClass} defaultValue="">
                            <option value="">Select…</option>
                            {options.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : turn.inputType === 'LONGTEXT' ? (
                          <textarea name={`turn:${turn.id}`} rows={3} className={inputClass} />
                        ) : turn.inputType === 'NUMBER' ||
                          turn.inputType === 'CURRENCY' ||
                          turn.inputType === 'PERCENT' ? (
                          <input
                            type="number"
                            step="any"
                            min="0"
                            name={`turn:${turn.id}`}
                            className={`${inputClass} tabular`}
                            placeholder={
                              turn.inputType === 'CURRENCY'
                                ? 'Amount'
                                : turn.inputType === 'PERCENT'
                                  ? 'Percentage'
                                  : 'Number'
                            }
                          />
                        ) : (
                          <input type="text" name={`turn:${turn.id}`} className={inputClass} />
                        )}
                      </span>
                    </label>
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-2 border-t border-line pt-5">
                <Button type="submit" tone="primary">
                  Save answers
                </Button>
              </div>
            </form>

            <form action={closeInterview} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="organisationId" value={orgId} />
              <Button type="submit" tone="ghost">
                Skip the rest and go straight to the analysis
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : isActive ? (
        <EmptyState
          title="Ready for the next round of questions"
          description="The platform will look at what it currently knows about your business and generate only the questions that would materially improve the analysis."
          action={
            <form action={generateInterviewRound}>
              <input type="hidden" name="organisationId" value={orgId} />
              <Button type="submit" tone="primary">
                Generate questions
              </Button>
            </form>
          }
        />
      ) : null}

      {answered.length > 0 ? (
        <div className="mt-6">
          <Card>
            <CardHeader
              title="Answers so far"
              description={`${answeredCount} question${answeredCount === 1 ? '' : 's'} answered. Each one is stored with the reason it was asked, so every conclusion can be traced back.`}
            />
            <CardBody className="space-y-4">
              {answered.map((turn) => (
                <div key={turn.id} className="border-b border-line pb-4 last:border-0 last:pb-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge>{AREA_LABELS[turn.businessArea] ?? turn.businessArea}</Badge>
                    <span className="text-[11px] text-faint">Round {turn.round}</span>
                  </div>
                  <p className="text-[13px] font-medium text-ink">{turn.question}</p>
                  <p className="mt-1 text-[13px] text-muted">{turn.answer}</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
                    Asked because: {turn.reasonForQuestion}
                  </p>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </>
  );
}
