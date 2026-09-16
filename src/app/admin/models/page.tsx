import { prisma } from '@/lib/db';
import { isLlmConfigured, analysisModel, reportModel } from '@/lib/ai/provider';
import { saveAIModelConfig } from '@/app/actions/admin';
import {
  PageHeader,
  Card,
  CardBody,
  CardHeader,
  Button,
  Field,
  inputClass,
  Callout,
  DataTable,
  Badge,
} from '@/components/ui';

export const metadata = { title: 'AI models' };

const SLOTS = [
  { key: 'analysis', label: 'Analysis agents', description: 'Process analysis, opportunity review and risk assessment.' },
  { key: 'report', label: 'Report agent', description: 'Client-facing narrative writing.' },
  { key: 'interview', label: 'Interview agent', description: 'Adaptive follow-up question generation.' },
];

export default async function AdminModels({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  const configs = await prisma.aIModelConfig.findMany();
  const byKey = new Map(configs.map((c) => [c.key, c]));

  return (
    <>
      <PageHeader
        title="AI models"
        description="Which model serves each agent. The platform always falls back to its deterministic analysis engine if a model call fails, so the workflow never breaks."
      />

      {saved ? (
        <div className="mb-5">
          <Callout tone="positive" title="Saved">
            The configuration has been recorded.
          </Callout>
        </div>
      ) : null}

      <div className="mb-6">
        <Callout tone={isLlmConfigured() ? 'positive' : 'caution'} title="Current provider">
          {isLlmConfigured() ? (
            <>
              Claude is configured. Analysis runs on <strong>{analysisModel()}</strong> and reports on{' '}
              <strong>{reportModel()}</strong>, set by the ANTHROPIC_ANALYSIS_MODEL and
              ANTHROPIC_REPORT_MODEL environment variables.
            </>
          ) : (
            <>
              No ANTHROPIC_API_KEY is set, so every agent is served by the built-in deterministic
              analysis engine. All figures, opportunities, roadmaps and reports are still produced —
              the engine is the platform&rsquo;s own implementation, not a placeholder — but the
              judgement and phrasing layer Claude adds is unavailable.
            </>
          )}
        </Callout>
      </div>

      <div className="space-y-5">
        {SLOTS.map((slot) => {
          const config = byKey.get(slot.key);
          return (
            <Card key={slot.key}>
              <CardHeader title={slot.label} description={slot.description} />
              <CardBody>
                <form action={saveAIModelConfig} className="grid gap-4 sm:grid-cols-4">
                  <input type="hidden" name="key" value={slot.key} />
                  <Field label="Label">
                    <input name="label" defaultValue={config?.label ?? slot.label} className={inputClass} />
                  </Field>
                  <Field label="Model ID">
                    <input
                      name="modelId"
                      defaultValue={config?.modelId ?? (slot.key === 'report' ? reportModel() : analysisModel())}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Max tokens">
                    <input
                      name="maxTokens"
                      type="number"
                      defaultValue={config?.maxTokens ?? 16000}
                      className={`${inputClass} tabular`}
                    />
                  </Field>
                  <div className="flex items-end gap-3 pb-2">
                    <label className="inline-flex items-center gap-2 text-[13px] text-muted">
                      <input
                        type="checkbox"
                        name="isActive"
                        defaultChecked={config?.isActive ?? true}
                        className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
                      />
                      Active
                    </label>
                    <Button type="submit" tone="secondary">
                      Save
                    </Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader
            title="The agents"
            description="Specialised roles that pass structured results to one another rather than one large prompt."
          />
          <CardBody>
            <DataTable
              columns={['Agent', 'Responsibility', 'Deterministic fallback']}
              rows={[
                ['Business Analyst', 'Understands the company and decides what still needs asking', 'Gap analysis over the knowledge model'],
                ['Process Analyst', 'Maps process steps and names inefficiencies', 'Rules over recorded process signals'],
                ['AI Opportunity', 'Decides where AI helps and where it does not', 'Keyword and suitability classification'],
                ['Financial Analyst', 'Calculates projected outcomes', 'Always deterministic — figures never come from a model'],
                ['Risk', 'Reviews privacy, security, accuracy and dependency risk', 'Rules over the risk posture'],
                ['Implementation', 'Produces delivery plans, milestones and tasks', 'Stage-based plan template'],
                ['Performance', 'Compares projected against actual', 'Attainment arithmetic over recorded KPIs'],
                ['Report', 'Writes the client-facing narrative', 'Templated narrative from the same figures'],
              ]}
            />
            <p className="mt-3 text-[12px] leading-relaxed text-faint">
              Financial figures are never generated by a language model. The Financial Analyst is the
              outcome engine, and the agents are given its results to explain rather than to compute.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
