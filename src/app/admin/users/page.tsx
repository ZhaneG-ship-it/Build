import { prisma } from '@/lib/db';
import { setUserActive, setPlatformRole } from '@/app/actions/admin';
import { PageHeader, Card, CardBody, Badge, Button, DataTable, Callout, inputClass } from '@/components/ui';

export const metadata = { title: 'Users' };

export default async function AdminUsers({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    include: { memberships: { include: { organisation: { select: { name: true } } } } },
  });

  return (
    <>
      <PageHeader title="Users" description="Every account on the platform." />

      {error ? (
        <div className="mb-5">
          <Callout tone="critical" title="Could not apply">
            {decodeURIComponent(error)}
          </Callout>
        </div>
      ) : null}

      <Card>
        <CardBody>
          <DataTable
            columns={['Name', 'Email', 'Platform role', 'Organisations', 'Last signed in', 'Status', '']}
            rows={users.map((user) => [
              user.name,
              user.email,
              <form key={`r-${user.id}`} action={setPlatformRole} className="flex items-center gap-1.5">
                <input type="hidden" name="userId" value={user.id} />
                <select
                  name="platformRole"
                  defaultValue={user.platformRole}
                  className={`${inputClass} w-32 py-1 text-[12px]`}
                >
                  <option value="USER">User</option>
                  <option value="PLATFORM_ADMIN">Platform admin</option>
                </select>
                <Button type="submit" tone="ghost">
                  Set
                </Button>
              </form>,
              user.memberships
                .map((m) => `${m.organisation.name} (${m.role.toLowerCase()})`)
                .join(', ') || '—',
              user.lastLoginAt
                ? user.lastLoginAt.toLocaleDateString('en-GB', { dateStyle: 'medium' })
                : 'never',
              <Badge key={`s-${user.id}`} tone={user.isActive ? 'positive' : 'critical'}>
                {user.isActive ? 'Active' : 'Deactivated'}
              </Badge>,
              <form key={`a-${user.id}`} action={setUserActive}>
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="isActive" value={user.isActive ? 'false' : 'true'} />
                <Button type="submit" tone={user.isActive ? 'danger' : 'secondary'}>
                  {user.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              </form>,
            ])}
          />
        </CardBody>
      </Card>
    </>
  );
}
