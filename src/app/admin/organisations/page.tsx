import Link from 'next/link';
import { prisma } from '@/lib/db';
import { setOrganisationStatus, setOrganisationPlan } from '@/app/actions/admin';
import { PageHeader, Card, CardBody, Badge, Button, inputClass } from '@/components/ui';

export const metadata = { title: 'Organisations' };

export default async function AdminOrganisations() {
  const [organisations, plans] = await Promise.all([
    prisma.organisation.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        plan: true,
        _count: {
          select: { memberships: true, processes: true, opportunities: true, projects: true, documents: true },
        },
      },
    }),
    prisma.pricingPlan.findMany({ orderBy: { monthlyPrice: 'asc' } }),
  ]);

  return (
    <>
      <PageHeader
        title="Organisations"
        description="Every business on the platform. Data is isolated per organisation; opening one here is recorded in its audit log."
      />

      <div className="space-y-3">
        {organisations.map((organisation) => (
          <Card key={organisation.id}>
            <CardBody>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link
                    href={`/app/${organisation.id}`}
                    className="text-[14px] font-medium text-ink hover:text-brand hover:underline"
                  >
                    {organisation.name}
                  </Link>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone={organisation.status === 'ACTIVE' ? 'positive' : 'critical'}>
                      {organisation.status.toLowerCase()}
                    </Badge>
                    <Badge>{organisation.plan?.name ?? 'No plan'}</Badge>
                    <Badge>{organisation._count.memberships} members</Badge>
                    <Badge>{organisation._count.processes} processes</Badge>
                    <Badge>{organisation._count.opportunities} opportunities</Badge>
                    <Badge>{organisation._count.projects} projects</Badge>
                    <Badge>{organisation._count.documents} documents</Badge>
                  </div>
                  <p className="mt-1.5 text-[11px] text-faint">
                    Created {organisation.createdAt.toLocaleDateString('en-GB', { dateStyle: 'medium' })} ·{' '}
                    {organisation.slug}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <form action={setOrganisationPlan} className="flex items-center gap-2">
                    <input type="hidden" name="organisationId" value={organisation.id} />
                    <select
                      name="planId"
                      defaultValue={organisation.planId ?? ''}
                      className={`${inputClass} w-36`}
                    >
                      <option value="">No plan</option>
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" tone="ghost">
                      Set plan
                    </Button>
                  </form>

                  <form action={setOrganisationStatus}>
                    <input type="hidden" name="organisationId" value={organisation.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={organisation.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}
                    />
                    <Button type="submit" tone={organisation.status === 'ACTIVE' ? 'danger' : 'secondary'}>
                      {organisation.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                    </Button>
                  </form>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
