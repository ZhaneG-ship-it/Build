import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireUser } from '@/lib/auth';
import { logoutAction } from '@/app/actions/auth';

export default async function ConsultantLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const isConsultant =
    user.platformRole === 'PLATFORM_ADMIN' || user.memberships.some((m) => m.role === 'CONSULTANT');

  if (!isConsultant) redirect('/app');

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/consultant" className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-brand text-[11px] font-bold text-brandInk">
                C
              </span>
              <span className="text-[14px] font-semibold tracking-tight text-ink">Clarity</span>
            </Link>
            <span aria-hidden className="text-line">/</span>
            <span className="text-[14px] font-medium text-ink">Consultant</span>
          </div>
          <div className="flex items-center gap-3">
            {user.platformRole === 'PLATFORM_ADMIN' ? (
              <Link
                href="/admin"
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted transition hover:bg-raised hover:text-ink"
              >
                Admin
              </Link>
            ) : null}
            <span className="hidden text-[12px] text-muted sm:inline">{user.name}</span>
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
      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
    </div>
  );
}
