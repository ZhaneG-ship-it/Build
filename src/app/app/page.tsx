import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { Card, CardBody, EmptyState, LinkButton, PageHeader } from '@/components/ui';

export const metadata = { title: 'Your organisations' };

export default async function OrganisationPicker() {
  const user = await requireUser();

  if (user.memberships.length === 1) {
    redirect(`/app/${user.memberships[0].organisationId}`);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <PageHeader title="Your organisations" description="Choose which business to work on." />

      {user.memberships.length === 0 ? (
        <EmptyState
          title="You are not a member of any organisation yet"
          description="Ask the business owner to invite you, or create your own organisation to get started."
          action={<LinkButton href="/register" tone="primary">Create an organisation</LinkButton>}
        />
      ) : (
        <div className="space-y-3">
          {user.memberships.map((membership) => (
            <Card key={membership.organisationId}>
              <CardBody className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-ink">{membership.organisationName}</p>
                  <p className="text-[12px] text-faint">Your role: {membership.role.toLowerCase()}</p>
                </div>
                <Link
                  href={`/app/${membership.organisationId}`}
                  className="shrink-0 rounded-lg border border-line px-3.5 py-2 text-[13px] font-medium text-ink transition hover:bg-raised"
                >
                  Open
                </Link>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
