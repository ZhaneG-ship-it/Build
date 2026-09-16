import 'server-only';
import { z } from 'zod';
import { runAgent, SAFETY_PREAMBLE } from '../provider';
import { renderKnowledgeModelForPrompt, type KnowledgeModel } from '../../engine/knowledge-model';
import type { OpportunityDraft } from '../../engine/opportunities';

/** Risk Agent (§22) — security, privacy, accuracy, compliance and dependency risk. */

export const RiskItemSchema = z.object({
  category: z.enum(['PRIVACY', 'SECURITY', 'ACCURACY', 'COMPLIANCE', 'OVERSIGHT', 'OPERATIONAL_DEPENDENCY']),
  title: z.string(),
  description: z.string(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  appliesTo: z.string().describe('"All" or the name of the specific opportunity.'),
  mitigation: z.string().describe('The practical control that reduces this risk.'),
});

export const RiskAssessmentSchema = z.object({
  overallPosture: z.string().describe('A short, honest summary of the risk position.'),
  requiresHumanReview: z.boolean(),
  risks: z.array(RiskItemSchema).max(14),
});

export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

export function assessRisksLocally(km: KnowledgeModel, drafts: OpportunityDraft[]): RiskAssessment {
  const risks: RiskAssessment['risks'] = [];

  if (km.risk.handlesSensitiveData) {
    risks.push({
      category: 'PRIVACY',
      title: 'Personal or sensitive data would be processed by AI systems',
      description:
        'The business has confirmed it handles sensitive data. Any AI system touching that data needs a lawful basis, a record of where processing happens and a retention position.',
      severity: 'HIGH',
      appliesTo: 'All',
      mitigation:
        'Complete a data protection impact assessment before the first implementation. Prefer providers offering no-training guarantees and a data processing agreement, and restrict each system to the minimum data it needs.',
    });
  }

  for (const regulation of km.risk.regulations.filter((r) => r && r !== 'None')) {
    risks.push({
      category: 'COMPLIANCE',
      title: `${regulation} obligations apply`,
      description: `The business operates under ${regulation}. Automated handling of regulated work needs to be demonstrably controlled and auditable.`,
      severity: 'HIGH',
      appliesTo: 'All',
      mitigation: `Have the ${regulation} position reviewed before go-live, and keep a decision log showing where a person approved each output.`,
    });
  }

  const highRisk = drafts.filter((d) => d.riskLevel === 'HIGH' && d.recommendation !== 'NOT_RECOMMENDED');
  for (const draft of highRisk.slice(0, 4)) {
    risks.push({
      category: 'OVERSIGHT',
      title: `${draft.name} needs a person to approve each output`,
      description:
        'This opportunity touches work where a mistake reaches the customer or carries regulatory weight.',
      severity: 'HIGH',
      appliesTo: draft.name,
      mitigation:
        'Run it with a person approving every output until the accuracy KPI has held for at least one full review period.',
    });
  }

  if (drafts.some((d) => d.aiCategory === 'GENERATIVE_AI' || d.aiCategory === 'AI_CHATBOT')) {
    risks.push({
      category: 'ACCURACY',
      title: 'Generated text can be confidently wrong',
      description:
        'Systems that write or answer can produce fluent output that is factually incorrect, which is harder to spot than an obvious error.',
      severity: 'MEDIUM',
      appliesTo: 'All generative opportunities',
      mitigation:
        'Restrict answers to your own approved content, require a citation for anything factual, and sample-check output weekly against a written standard.',
    });
  }

  if (km.technology.systems.filter((s) => s.hasApi).length === 0 && km.technology.systems.length > 0) {
    risks.push({
      category: 'OPERATIONAL_DEPENDENCY',
      title: 'No confirmed integration route into the current systems',
      description:
        'None of the recorded systems is confirmed as offering an API. Without one, automation depends on exports, file drops or screen automation, all of which are more fragile.',
      severity: 'MEDIUM',
      appliesTo: 'All',
      mitigation:
        'Confirm the integration options for each system before committing to a build, and prefer opportunities whose systems do expose an API.',
    });
  }

  risks.push({
    category: 'OPERATIONAL_DEPENDENCY',
    title: 'The business would depend on a system it does not control',
    description:
      'Once a process runs through an AI system, an outage, a price change or a model change becomes an operational issue for the business.',
    severity: 'MEDIUM',
    appliesTo: 'All',
    mitigation:
      'Keep the manual process documented and rehearsed, agree who owns each system internally, and review supplier terms annually.',
  });

  if (km.people.aiLiteracyMix.NONE || km.aiPosture.aiMaturityLevel === 0) {
    risks.push({
      category: 'OPERATIONAL_DEPENDENCY',
      title: 'Low AI familiarity across the team',
      description:
        'The team has little experience of working alongside AI tools, which is the most common reason implementations are abandoned after launch.',
      severity: 'MEDIUM',
      appliesTo: 'All',
      mitigation:
        'Budget for training in the first project rather than the last, and name one person per team as the point of contact.',
    });
  }

  const requiresHumanReview =
    km.risk.handlesSensitiveData ||
    km.risk.regulations.some((r) => r && r !== 'None') ||
    highRisk.length > 0;

  const posture = requiresHumanReview
    ? 'This business handles work where mistakes carry real consequences. AI is still appropriate here, but every recommendation in this report assumes a person stays accountable for the output.'
    : 'The risk position is manageable. The main exposures are accuracy and dependency rather than privacy or compliance, and both are addressed by keeping a person in the loop early on.';

  return { overallPosture: posture, requiresHumanReview, risks: risks.slice(0, 14) };
}

export async function assessRisks(
  km: KnowledgeModel,
  drafts: OpportunityDraft[],
): Promise<{ assessment: RiskAssessment; provider: string }> {
  const opportunitySummary = drafts
    .filter((d) => d.recommendation !== 'NOT_RECOMMENDED')
    .map((d) => `- ${d.name} (${d.aiCategory}, risk ${d.riskLevel}, oversight ${d.humanOversight})`)
    .join('\n');

  const prompt = `${renderKnowledgeModelForPrompt(km, { includeProcesses: true })}

## Opportunities under consideration
${opportunitySummary || '- None recommended'}

## Your task
Set out the risks this business would actually carry if it implemented these opportunities,
covering privacy, security, accuracy, compliance, human oversight and operational dependency.

Rules:
- Only raise a risk that follows from something stated above. Do not list generic AI risks
  that do not apply to this business.
- Give each risk a mitigation that this business could actually carry out.
- Say plainly if the overall position requires human review before anything goes live.`;

  const { result, provider } = await runAgent({
    agent: 'RiskAgent',
    task: 'assess-risks',
    organisationId: km.organisationId,
    system: `${SAFETY_PREAMBLE}

You are the Risk Agent. You review security, privacy, accuracy, compliance and operational
risk. You are direct without being alarmist, and every risk you raise comes with a control
the business could realistically put in place.`,
    prompt,
    schema: RiskAssessmentSchema,
    fallback: () => assessRisksLocally(km, drafts),
  });

  return { assessment: result, provider };
}
