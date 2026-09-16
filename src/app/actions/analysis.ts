'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireOrg } from '@/lib/tenancy';
import { runFullAnalysis } from '@/lib/engine/orchestrator';

/**
 * Runs the full agent pipeline: process analysis, opportunity identification,
 * outcome calculation, risk review, roadmap and report generation.
 */
export async function runAnalysisAction(formData: FormData) {
  const organisationId = String(formData.get('organisationId'));
  const ctx = await requireOrg(organisationId, 'analysis.run');

  let reportId: string;
  try {
    const result = await runFullAnalysis(organisationId, ctx.user.id);
    reportId = result.reportId;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The analysis could not be completed';
    redirect(`/app/${organisationId}/opportunities?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/app/${organisationId}`, 'layout');
  redirect(`/app/${organisationId}/reports/${reportId}`);
}
