import { prisma } from '@/lib/db';
import { PageHeader, Card, CardBody, DataTable } from '@/components/ui';

export const metadata = { title: 'Audit log' };

export default async function AdminAudit() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      user: { select: { name: true, email: true } },
      organisation: { select: { name: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every significant action across the platform, in order. Auditability is a product requirement, not an add-on."
      />

      <Card>
        <CardBody>
          {logs.length ? (
            <DataTable
              columns={['When', 'Organisation', 'User', 'Action', 'Entity', 'Entity ID']}
              rows={logs.map((log) => [
                log.createdAt.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' }),
                log.organisation?.name ?? '—',
                log.user?.name ?? 'System',
                log.action,
                log.entityType ?? '—',
                log.entityId ? `${log.entityId.slice(0, 10)}…` : '—',
              ])}
            />
          ) : (
            <p className="text-[13px] text-faint">No activity recorded yet.</p>
          )}
        </CardBody>
      </Card>
    </>
  );
}
