import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { PageHeader } from '@/components/ui';
import { ProcessForm } from '@/components/process-form';

export const metadata = { title: 'Add a process' };

const EMPTY = {
  name: '',
  description: '',
  departmentId: '',
  owner: '',
  trigger: '',
  frequency: '',
  employeesInvolved: '',
  hoursPerWeek: '',
  avgDurationMins: '',
  volumePerPeriod: '',
  inputs: '',
  outputs: '',
  errorRate: '',
  errorImpact: '',
  delayDescription: '',
  customerImpact: '',
  revenueImpact: '',
  manualScore: '3',
  repetitivenessScore: '3',
  dataReadiness: '3',
  riskLevel: 'LOW',
  systemsUsed: '',
};

export default async function NewProcessPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requireOrg(orgId, 'process.edit');
  if (!ctx) notFound();

  const departments = await prisma.department.findMany({
    where: { organisationId: orgId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  return (
    <>
      <PageHeader
        eyebrow="Process map"
        title="Add a process"
        description="Describe how a piece of work actually happens today. The platform uses this to decide whether AI or automation could realistically improve it."
      />
      <ProcessForm organisationId={orgId} departments={departments} values={EMPTY} />
    </>
  );
}
