import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { prisma } from '@/lib/db';
import { getOrgContext } from '@/lib/tenancy';
import { logoutAction } from '@/app/actions/auth';
import { SideNav, type NavGroup } from '@/components/nav';

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const ctx = await getOrgContext(orgId);
  if (!ctx) notFound();

  const base = `/app/${orgId}`;

  const [openOpportunities, activeProjects, pendingInterview, unprocessedDocs] = await Promise.all([
    prisma.aIOpportunity.count({
      where: { organisationId: orgId, recommendation: { notIn: ['NOT_RECOMMENDED', 'DO_NOTHING'] } },
    }),
    prisma.project.count({ where: { organisationId: orgId, status: 'ACTIVE' } }),
    prisma.interviewTurn.count({
      where: { session: { organisationId: orgId, status: 'ACTIVE' }, answeredAt: null },
    }),
    prisma.document.count({ where: { organisationId: orgId, status: 'PENDING' } }),
  ]);

  const groups: NavGroup[] = [
    {
      label: 'Overview',
      items: [{ href: base, label: 'Dashboard' }],
    },
    {
      label: 'Understand the business',
      items: [
        { href: `${base}/onboarding`, label: 'Business profile' },
        { href: `${base}/assessment`, label: 'Assessment' },
        {
          href: `${base}/interview`,
          label: 'AI interview',
          badge: pendingInterview ? String(pendingInterview) : null,
        },
        {
          href: `${base}/documents`,
          label: 'Documents',
          badge: unprocessedDocs ? String(unprocessedDocs) : null,
        },
        { href: `${base}/knowledge`, label: 'Knowledge model' },
        { href: `${base}/processes`, label: 'Process map' },
      ],
    },
    {
      label: 'Analysis',
      items: [
        {
          href: `${base}/opportunities`,
          label: 'Opportunities',
          badge: openOpportunities ? String(openOpportunities) : null,
        },
        { href: `${base}/reports`, label: 'Reports' },
        { href: `${base}/roadmap`, label: 'Roadmap' },
      ],
    },
    {
      label: 'Delivery',
      items: [
        {
          href: `${base}/projects`,
          label: 'Projects',
          badge: activeProjects ? String(activeProjects) : null,
        },
        { href: `${base}/performance`, label: 'Performance' },
        { href: `${base}/discovery`, label: 'Continuous discovery' },
      ],
    },
    {
      label: 'Manage',
      items: [{ href: `${base}/settings`, label: 'Settings' }],
    },
  ];

  const roleLabel =
    ctx.role === 'PLATFORM_ADMIN'
      ? 'Platform admin'
      : ctx.role.charAt(0) + ctx.role.slice(1).toLowerCase();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/app" className="flex shrink-0 items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-brand text-[11px] font-bold text-brandInk">
                C
              </span>
              <span className="hidden text-[14px] font-semibold tracking-tight text-ink sm:inline">
                Clarity
              </span>
            </Link>
            <span aria-hidden className="text-line">
              /
            </span>
            <span className="truncate text-[14px] font-medium text-ink">{ctx.organisationName}</span>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {ctx.role === 'CONSULTANT' || ctx.role === 'PLATFORM_ADMIN' ? (
              <Link
                href="/consultant"
                className="hidden rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted transition hover:bg-raised hover:text-ink sm:block"
              >
                Consultant view
              </Link>
            ) : null}
            <span className="hidden text-right sm:block">
              <span className="block text-[12px] font-medium leading-tight text-ink">{ctx.user.name}</span>
              <span className="block text-[11px] leading-tight text-faint">{roleLabel}</span>
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition hover:bg-raised hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px] gap-6 px-4 py-6">
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-[73px]">
            <SideNav groups={groups} />
          </div>
        </aside>
        <main className="min-w-0 flex-1 pb-16">{children}</main>
      </div>

      {/* Compact navigation for narrow viewports. */}
      <div className="sticky bottom-0 z-20 border-t border-line bg-surface/95 px-2 py-2 backdrop-blur lg:hidden">
        <div className="flex gap-1 overflow-x-auto">
          {groups.flatMap((g) => g.items).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] text-muted transition hover:bg-raised hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
