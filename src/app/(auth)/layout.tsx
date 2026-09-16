import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col bg-canvas">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-[13px] font-bold text-brandInk">
              C
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink">Clarity</span>
          </Link>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </main>
  );
}
