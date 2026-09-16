import { prisma } from '@/lib/db';
import { INTEGRATION_REGISTRY } from '@/lib/integrations/registry';
import { PageHeader, Card, CardBody, CardHeader, Badge, DataTable } from '@/components/ui';

export const metadata = { title: 'Integrations' };

export default async function AdminIntegrations() {
  const connections = await prisma.integration.groupBy({
    by: ['provider', 'status'],
    _count: { _all: true },
  });

  const countFor = (provider: string) =>
    connections.filter((c) => c.provider === provider).reduce((sum, c) => sum + c._count._all, 0);

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connectors the platform declares. Those not yet built are shown as planned throughout the product rather than presented as working."
      />

      <Card>
        <CardHeader
          title="Connector registry"
          description="Defined in lib/integrations/registry.ts. Each entry states what it would contribute to a business knowledge model."
        />
        <CardBody>
          <DataTable
            columns={['Connector', 'Category', 'Status', 'Organisations connected', 'Would supply']}
            align={[3]}
            rows={INTEGRATION_REGISTRY.map((integration) => [
              integration.name,
              integration.category,
              <Badge key={integration.provider} tone={integration.available ? 'positive' : 'caution'}>
                {integration.available ? 'Available' : 'Planned'}
              </Badge>,
              String(countFor(integration.provider)),
              integration.contributes.join(', '),
            ])}
          />
        </CardBody>
      </Card>
    </>
  );
}
