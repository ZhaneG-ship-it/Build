'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
  badge?: string | null;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export function SideNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-6" aria-label="Main">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              // Exact match for the section root, prefix match for its children.
              const isActive =
                pathname === item.href ||
                (item.href.split('/').length > 3 && pathname.startsWith(`${item.href}/`));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-[13px] transition ${
                      isActive
                        ? 'bg-brand/10 font-medium text-brand'
                        : 'text-muted hover:bg-raised hover:text-ink'
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="tabular shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-faint ring-1 ring-line">
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
