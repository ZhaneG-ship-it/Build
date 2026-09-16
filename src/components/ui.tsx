import Link from 'next/link';
import type { ReactNode } from 'react';

/** Shared presentation primitives. Server-component safe — no client state here. */

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  return (
    <Tag className={`rounded-xl border border-line bg-surface shadow-card ${className}`}>{children}</Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{eyebrow}</p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

// ---------------------------------------------------------------------------

type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonTone, string> = {
  primary: 'bg-brand text-brandInk hover:brightness-110 border-transparent',
  secondary: 'bg-surface text-ink border-line hover:bg-raised',
  ghost: 'bg-transparent text-muted border-transparent hover:bg-raised hover:text-ink',
  danger: 'bg-transparent text-critical border-line hover:bg-critical/10',
};

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

export function Button({
  children,
  tone = 'primary',
  type = 'button',
  name,
  value,
  disabled,
  className = '',
  title,
}: {
  children: ReactNode;
  tone?: ButtonTone;
  type?: 'button' | 'submit';
  name?: string;
  value?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type={type}
      name={name}
      value={value}
      disabled={disabled}
      title={title}
      className={`${BUTTON_BASE} ${BUTTON_STYLES[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  tone = 'secondary',
  className = '',
}: {
  href: string;
  children: ReactNode;
  tone?: ButtonTone;
  className?: string;
}) {
  return (
    <Link href={href} className={`${BUTTON_BASE} ${BUTTON_STYLES[tone]} ${className}`}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------

type BadgeTone = 'neutral' | 'brand' | 'positive' | 'caution' | 'critical' | 'serious';

const BADGE_STYLES: Record<BadgeTone, string> = {
  neutral: 'bg-raised text-muted border-line',
  brand: 'bg-brand/10 text-brand border-brand/25',
  positive: 'bg-positive/10 text-positive border-positive/30',
  caution: 'bg-caution/15 text-ink border-caution/40',
  serious: 'bg-serious/15 text-ink border-serious/40',
  critical: 'bg-critical/10 text-critical border-critical/30',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium ${BADGE_STYLES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Confidence is shown everywhere a figure is (§23). Status colour never carries
 * the meaning alone — the word is always present.
 */
export function ConfidenceBadge({ level }: { level: string }) {
  const tone: BadgeTone = level === 'HIGH' ? 'positive' : level === 'MEDIUM' ? 'caution' : 'critical';
  const label = level === 'HIGH' ? 'High confidence' : level === 'MEDIUM' ? 'Medium confidence' : 'Low confidence';
  return <Badge tone={tone}>{label}</Badge>;
}

export function RecommendationBadge({ recommendation }: { recommendation: string }) {
  switch (recommendation) {
    case 'IMPLEMENT':
      return <Badge tone="positive">Recommended</Badge>;
    case 'INVESTIGATE':
      return <Badge tone="brand">Investigate</Badge>;
    case 'DEFER':
      return <Badge tone="neutral">Defer</Badge>;
    case 'NOT_RECOMMENDED':
    case 'DO_NOTHING':
      return <Badge tone="serious">AI not recommended</Badge>;
    default:
      return <Badge>{recommendation}</Badge>;
  }
}

export function LevelBadge({ level, label }: { level: string; label: string }) {
  const tone: BadgeTone = level === 'LOW' ? 'positive' : level === 'MEDIUM' ? 'caution' : 'critical';
  return (
    <Badge tone={tone}>
      {label}: {level.toLowerCase()}
    </Badge>
  );
}

// ---------------------------------------------------------------------------

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'caution' | 'critical' | 'positive';
  title: string;
  children: ReactNode;
}) {
  const styles = {
    info: 'border-brand/30 bg-brand/[0.06]',
    caution: 'border-caution/40 bg-caution/[0.08]',
    critical: 'border-critical/30 bg-critical/[0.06]',
    positive: 'border-positive/30 bg-positive/[0.06]',
  }[tone];

  // Icon plus label, so the status is never carried by colour alone.
  const icon = { info: 'i', caution: '!', critical: '!', positive: '✓' }[tone];
  const iconStyles = {
    info: 'bg-brand text-brandInk',
    caution: 'bg-caution text-[#0b0b0b]',
    critical: 'bg-critical text-white',
    positive: 'bg-positive text-white',
  }[tone];

  return (
    <div className={`flex gap-3 rounded-lg border p-4 ${styles}`}>
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${iconStyles}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <div className="mt-1 text-[13px] leading-relaxed text-muted">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-raised/50 px-6 py-12 text-center">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function DataTable({
  columns,
  rows,
  caption,
  align,
}: {
  columns: string[];
  rows: ReactNode[][];
  caption?: string;
  /** Column indexes to right-align (numeric columns). */
  align?: number[];
}) {
  const right = new Set(align ?? []);
  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              {columns.map((col, i) => (
                <th
                  key={col}
                  scope="col"
                  className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint ${
                    right.has(i) ? 'text-right' : 'text-left'
                  }`}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-line/60 last:border-0">
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={`px-3 py-2.5 align-top text-muted ${right.has(c) ? 'tabular text-right' : ''} ${
                      c === 0 ? 'font-medium text-ink' : ''
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption ? <figcaption className="mt-2 px-3 text-[12px] text-faint">{caption}</figcaption> : null}
    </figure>
  );
}

// ---------------------------------------------------------------------------

export function Field({
  label,
  help,
  children,
  required,
}: {
  label: string;
  help?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">
        {label}
        {required ? <span className="ml-1 text-critical">*</span> : null}
      </span>
      {help ? <span className="mb-2 block text-[12px] leading-relaxed text-faint">{help}</span> : null}
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-faint transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{children}</p>
  );
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-b border-line/60 py-2 last:border-0">
      <dt className="text-[12px] text-faint">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-ink">{value}</dd>
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="flex items-start gap-1.5 text-[13px] text-critical">
      <span aria-hidden className="mt-[3px] text-[10px]">
        ●
      </span>
      <span>{children}</span>
    </p>
  );
}
