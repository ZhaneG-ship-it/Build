import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireOrg } from '@/lib/tenancy';
import { SYSTEM_CATEGORIES, SYSTEM_CATEGORY_LABELS } from '@/lib/types';
import { INTEGRATION_REGISTRY } from '@/lib/integrations/registry';
import {
  inviteMember,
  removeMember,
  addSystem,
  deleteSystem,
  toggleIntegration,
} from '@/app/actions/org';
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Badge,
  Button,
  Callout,
  Field,
  inputClass,
  DataTable,
  ErrorText,
} from '@/components/ui';

export const metadata = { title: 'Settings' };

const ROLE_DESCRIPTIONS: Record<string, string> = {
  OWNER: 'Full control: assessment, documents, decisions, projects and members.',
  EMPLOYEE: 'Can complete assigned assessments, supply process information and take part in projects.',
  CONSULTANT: 'Can review and edit AI-generated analysis, approve reports and manage implementations.',
};

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ invited?: string; error?: string; system?: string }>;
}) {
  const { orgId } = await params;
  const { invited, error, system } = await searchParams;

  const ctx = await requireOrg(orgId);
  if (!ctx) notFound();

  const [organisation, memberships, systems, integrations, auditLogs] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.membership.findMany({
      where: { organisationId: orgId },
      include: { user: { select: { id: true, name: true, email: true, jobTitle: true, lastLoginAt: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.businessSystem.findMany({ where: { organisationId: orgId }, orderBy: { category: 'asc' } }),
    prisma.integration.findMany({ where: { organisationId: orgId } }),
    prisma.auditLog.findMany({
      where: { organisationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const canManageMembers = ctx.can('org.members.manage');
  const canEditKnowledge = ctx.can('knowledge.edit');
  const canManageIntegrations = ctx.can('integrations.manage');
  const connected = new Set(integrations.map((i) => i.provider));

  return (
    <>
      <PageHeader
        eyebrow="Manage"
        title="Settings"
        description={`${organisation.name} · your role: ${ctx.role.toLowerCase().replace('_', ' ')}`}
      />

      {invited ? (
        <div className="mb-5">
          <Callout tone="positive" title="Member added">
            They can sign in with the email address and password you set.
          </Callout>
        </div>
      ) : null}
      {system ? (
        <div className="mb-5">
          <Callout tone="positive" title="System recorded">
            It will be considered when assessing integration complexity.
          </Callout>
        </div>
      ) : null}

      <div className="space-y-6">
        <Card>
          <CardHeader
            title="People"
            description="Who has access to this organisation, and what they can do."
          />
          <CardBody className="space-y-5">
            <DataTable
              columns={['Name', 'Email', 'Role', 'Last signed in', '']}
              rows={memberships.map((membership) => [
                membership.user.name,
                membership.user.email,
                <span key={membership.id}>
                  <Badge tone={membership.role === 'CONSULTANT' ? 'brand' : 'neutral'}>
                    {membership.role.toLowerCase()}
                  </Badge>
                </span>,
                membership.user.lastLoginAt
                  ? membership.user.lastLoginAt.toLocaleDateString('en-GB', { dateStyle: 'medium' })
                  : 'never',
                canManageMembers && membership.userId !== ctx.user.id ? (
                  <form key={`f-${membership.id}`} action={removeMember}>
                    <input type="hidden" name="organisationId" value={orgId} />
                    <input type="hidden" name="membershipId" value={membership.id} />
                    <Button type="submit" tone="danger">
                      Remove
                    </Button>
                  </form>
                ) : (
                  ''
                ),
              ])}
            />

            {canManageMembers ? (
              <form action={inviteMember} className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
                <input type="hidden" name="organisationId" value={orgId} />
                {error ? (
                  <div className="sm:col-span-2">
                    <ErrorText>{decodeURIComponent(error)}</ErrorText>
                  </div>
                ) : null}
                <Field label="Name" required>
                  <input name="name" className={inputClass} required />
                </Field>
                <Field label="Email" required>
                  <input name="email" type="email" className={inputClass} required />
                </Field>
                <Field label="Job title">
                  <input name="jobTitle" className={inputClass} />
                </Field>
                <Field label="Role" required>
                  <select name="role" defaultValue="EMPLOYEE" className={inputClass}>
                    {Object.entries(ROLE_DESCRIPTIONS).map(([role, description]) => (
                      <option key={role} value={role} title={description}>
                        {role.toLowerCase()} — {description}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field
                    label="Initial password"
                    help="At least 8 characters. Share it with them directly; they can change it later."
                    required
                  >
                    <input name="password" type="password" minLength={8} className={inputClass} required />
                  </Field>
                </div>
                <div>
                  <Button type="submit" tone="primary">
                    Add member
                  </Button>
                </div>
              </form>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Business systems"
            description="What the business runs on. Integration complexity and implementation cost estimates depend on this."
          />
          <CardBody className="space-y-5">
            {systems.length ? (
              <DataTable
                columns={['System', 'Category', 'Integration route', 'Data quality', 'Source', '']}
                rows={systems.map((s) => [
                  s.name,
                  SYSTEM_CATEGORY_LABELS[s.category] ?? s.category,
                  s.hasApi ? 'API available' : 'To be confirmed',
                  s.dataQuality != null ? `${s.dataQuality}/5` : '—',
                  s.source.toLowerCase(),
                  canEditKnowledge ? (
                    <form key={`s-${s.id}`} action={deleteSystem}>
                      <input type="hidden" name="organisationId" value={orgId} />
                      <input type="hidden" name="systemId" value={s.id} />
                      <Button type="submit" tone="danger">
                        Remove
                      </Button>
                    </form>
                  ) : (
                    ''
                  ),
                ])}
              />
            ) : (
              <p className="text-[13px] text-faint">No systems recorded yet.</p>
            )}

            {canEditKnowledge ? (
              <form action={addSystem} className="grid gap-4 border-t border-line pt-5 sm:grid-cols-3">
                <input type="hidden" name="organisationId" value={orgId} />
                <Field label="System name" required>
                  <input name="name" className={inputClass} required />
                </Field>
                <Field label="Category">
                  <select name="category" defaultValue="OTHER" className={inputClass}>
                    {SYSTEM_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {SYSTEM_CATEGORY_LABELS[category]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Data quality (1-5)">
                  <input
                    name="dataQuality"
                    type="number"
                    min="1"
                    max="5"
                    className={`${inputClass} tabular`}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="How it is used">
                    <input name="usageNotes" className={inputClass} />
                  </Field>
                </div>
                <div className="flex items-end gap-3">
                  <label className="mb-2 inline-flex items-center gap-2 text-[13px] text-muted">
                    <input type="checkbox" name="hasApi" className="h-3.5 w-3.5 accent-[rgb(var(--brand))]" />
                    Has an API
                  </label>
                </div>
                <div className="sm:col-span-3">
                  <Button type="submit" tone="secondary">
                    Add system
                  </Button>
                </div>
              </form>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Integrations"
            description="Connectors that would let the platform read figures directly instead of asking for them. Those not yet built are marked as planned rather than pretending to connect."
          />
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-2">
              {INTEGRATION_REGISTRY.map((integration) => {
                const isConnected = connected.has(integration.provider);
                return (
                  <div key={integration.provider} className="rounded-lg border border-line p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-ink">{integration.name}</p>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted">
                          {integration.description}
                        </p>
                      </div>
                      <Badge tone={integration.available ? (isConnected ? 'positive' : 'neutral') : 'caution'}>
                        {!integration.available ? 'Planned' : isConnected ? 'Connected' : 'Available'}
                      </Badge>
                    </div>

                    <p className="mt-2 text-[11px] leading-relaxed text-faint">
                      Would supply: {integration.contributes.join(', ')}
                    </p>

                    {canManageIntegrations && integration.available ? (
                      <form action={toggleIntegration} className="mt-3">
                        <input type="hidden" name="organisationId" value={orgId} />
                        <input type="hidden" name="provider" value={integration.provider} />
                        <Button type="submit" tone={isConnected ? 'secondary' : 'primary'}>
                          {isConnected ? 'Disconnect' : 'Connect'}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Activity log"
            description="Every significant action in this organisation is recorded."
          />
          <CardBody>
            {auditLogs.length ? (
              <DataTable
                columns={['When', 'Who', 'Action', 'Entity']}
                rows={auditLogs.map((log) => [
                  log.createdAt.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }),
                  log.user?.name ?? 'System',
                  log.action,
                  log.entityType ?? '—',
                ])}
              />
            ) : (
              <p className="text-[13px] text-faint">No activity recorded yet.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
