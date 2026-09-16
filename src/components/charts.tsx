'use client';

import { useId, useState, type ReactNode } from 'react';

/**
 * Chart components.
 *
 * Conventions applied throughout, per the platform's visualisation rules:
 *  - Single axis only; two measures of different scale are never overlaid.
 *  - Categorical hues assigned in fixed order (series 1, 2, 3), never cycled.
 *  - Roadmap phases use an ordinal ramp of one hue, light to dark.
 *  - Data ends are 4px-rounded and anchored to the baseline; adjacent fills
 *    carry a 2px surface gap.
 *  - Values are direct-labelled, so identity and magnitude never rest on colour
 *    alone; a legend appears whenever there is more than one series.
 *  - Grid and axis lines are recessive; text uses ink tokens, not series colour.
 */

// ---------------------------------------------------------------------------
// Stat tiles — a headline number is not a chart, so it carries no hover layer.
// ---------------------------------------------------------------------------

export type StatTone = 'neutral' | 'positive' | 'caution' | 'critical' | 'brand';

const TONE_TEXT: Record<StatTone, string> = {
  neutral: 'text-ink',
  positive: 'text-positive',
  caution: 'text-ink',
  critical: 'text-critical',
  brand: 'text-brand',
};

export function StatTile({
  label,
  value,
  caption,
  tone = 'neutral',
  footer,
}: {
  label: string;
  value: ReactNode;
  caption?: string;
  tone?: StatTone;
  footer?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{label}</p>
      <p className={`mt-1.5 text-[22px] font-semibold leading-tight tracking-tight ${TONE_TEXT[tone]}`}>
        {value}
      </p>
      {caption ? <p className="mt-1 text-[12px] leading-snug text-muted">{caption}</p> : null}
      {footer ? <div className="mt-2">{footer}</div> : null}
    </div>
  );
}

export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const grid = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols];
  return <div className={`grid grid-cols-1 gap-3 ${grid}`}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Maturity ring — one value against a fixed 0-5 scale, directly labelled.
// ---------------------------------------------------------------------------

export function MaturityRing({ level, max = 5 }: { level: number; max?: number }) {
  return (
    <div className="space-y-5">
      <MaturityDial level={level} max={max} />
      <MaturityScale level={level} max={max} />
    </div>
  );
}

/**
 * The whole 0-5 scale, with the current position marked. An ordinal ramp of one
 * hue, and every step is labelled, so the position never rests on colour alone.
 */
function MaturityScale({ level, max }: { level: number; max: number }) {
  const steps = Array.from({ length: max + 1 }, (_, i) => i);
  const current = Math.round(level);

  return (
    <ol className="space-y-1.5 border-t border-line pt-4">
      {steps.map((step) => {
        const isCurrent = step === current;
        const reached = step <= current;
        return (
          <li
            key={step}
            aria-current={isCurrent ? 'step' : undefined}
            className={`flex items-start gap-3 rounded-lg px-2 py-1.5 ${isCurrent ? 'bg-brand/10' : ''}`}
          >
            <span
              aria-hidden
              className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{
                background: reached ? 'rgb(var(--series-1))' : 'rgb(var(--line))',
                opacity: reached && !isCurrent ? 0.45 : 1,
              }}
            />
            <span className="min-w-0">
              <span className={`text-[12px] ${isCurrent ? 'font-semibold text-ink' : 'text-muted'}`}>
                Level {step} — {MATURITY_LABELS[step]}
                {isCurrent ? <span className="ml-1.5 text-brand">you are here</span> : null}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function MaturityDial({ level, max }: { level: number; max: number }) {
  const size = 132;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.max(0, Math.min(1, level / max));

  return (
    <figure className="m-0 flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
           aria-label={`AI maturity level ${level} of ${max}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(var(--line))"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(var(--series-1))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x={size / 2}
          y={size / 2 - 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-ink"
          style={{ fontSize: 30, fontWeight: 600 }}
        >
          {level}
        </text>
        <text
          x={size / 2}
          y={size / 2 + 22}
          textAnchor="middle"
          className="fill-faint"
          style={{ fontSize: 12 }}
        >
          of {max}
        </text>
      </svg>
      <figcaption className="text-[13px] leading-relaxed text-muted">
        <span className="block font-semibold text-ink">{MATURITY_LABELS[Math.round(level)] ?? 'Not assessed'}</span>
        {MATURITY_DESCRIPTIONS[Math.round(level)] ?? ''}
      </figcaption>
    </figure>
  );
}

const MATURITY_LABELS: Record<number, string> = {
  0: 'Not started',
  1: 'Experimenting',
  2: 'Applied in one area',
  3: 'Applied across the business',
  4: 'Embedded in operations',
  5: 'Managed capability',
};

const MATURITY_DESCRIPTIONS: Record<number, string> = {
  0: 'No AI in structured use. A clean starting point — the first project can be chosen purely for return.',
  1: 'Individuals are trying tools informally. Useful learning, but nothing measured yet.',
  2: 'One area is getting real value. The next step is to repeat the pattern deliberately.',
  3: 'Several areas are live. Governance and measurement matter more than new tools now.',
  4: 'AI is part of how the work gets done, with owners and measurement in place.',
  5: 'Run as a managed capability with continuous review.',
};

// ---------------------------------------------------------------------------
// Horizontal bar chart — magnitude comparison across named items.
// ---------------------------------------------------------------------------

export interface BarDatum {
  label: string;
  value: number;
  /** Optional second measure on the SAME scale and unit (e.g. projected vs actual). */
  compareValue?: number;
  meta?: string;
}

export function HorizontalBarChart({
  data,
  unit = '',
  seriesLabel,
  compareLabel,
  formatValue,
  maxOverride,
}: {
  data: BarDatum[];
  unit?: string;
  seriesLabel?: string;
  compareLabel?: string;
  formatValue?: (value: number) => string;
  maxOverride?: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const tooltipId = useId();

  if (data.length === 0) {
    return <p className="py-6 text-center text-[13px] text-faint">No data to display yet.</p>;
  }

  const hasCompare = data.some((d) => d.compareValue !== undefined);
  const max = maxOverride ?? Math.max(...data.flatMap((d) => [d.value, d.compareValue ?? 0]), 1);
  const fmt = formatValue ?? ((v: number) => `${Math.round(v).toLocaleString()}${unit ? ` ${unit}` : ''}`);

  return (
    <figure className="m-0">
      {hasCompare ? (
        <div className="mb-3 flex flex-wrap items-center gap-4 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: 'rgb(var(--series-1))' }} />
            {seriesLabel ?? 'Projected'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: 'rgb(var(--series-2))' }} />
            {compareLabel ?? 'Actual'}
          </span>
        </div>
      ) : null}

      <div className="space-y-3" role="list">
        {data.map((datum, index) => {
          const primaryPct = (datum.value / max) * 100;
          const comparePct = datum.compareValue !== undefined ? (datum.compareValue / max) * 100 : null;
          const isHovered = hovered === index;

          return (
            <div
              key={`${datum.label}-${index}`}
              role="listitem"
              className="group relative"
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
              tabIndex={0}
              aria-describedby={isHovered ? `${tooltipId}-${index}` : undefined}
            >
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] text-ink">{datum.label}</span>
                <span className="tabular shrink-0 text-[13px] font-medium text-ink">{fmt(datum.value)}</span>
              </div>

              <div className="space-y-[2px]">
                <div className="h-2.5 w-full overflow-hidden rounded-sm bg-raised">
                  <div
                    className="h-full rounded-r-[4px] transition-[width]"
                    style={{
                      width: `${Math.max(primaryPct, 0.5)}%`,
                      background: 'rgb(var(--series-1))',
                      opacity: hovered === null || isHovered ? 1 : 0.55,
                    }}
                  />
                </div>
                {comparePct !== null ? (
                  <div className="h-2.5 w-full overflow-hidden rounded-sm bg-raised">
                    <div
                      className="h-full rounded-r-[4px] transition-[width]"
                      style={{
                        width: `${Math.max(comparePct, 0.5)}%`,
                        background: 'rgb(var(--series-2))',
                        opacity: hovered === null || isHovered ? 1 : 0.55,
                      }}
                    />
                  </div>
                ) : null}
              </div>

              {isHovered ? (
                <div
                  id={`${tooltipId}-${index}`}
                  role="tooltip"
                  className="pointer-events-none absolute right-0 top-full z-20 mt-1 w-max max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-lift"
                >
                  <p className="font-semibold text-ink">{datum.label}</p>
                  <p className="tabular mt-0.5 text-muted">
                    {seriesLabel ?? 'Value'}: {fmt(datum.value)}
                  </p>
                  {datum.compareValue !== undefined ? (
                    <p className="tabular text-muted">
                      {compareLabel ?? 'Actual'}: {fmt(datum.compareValue)}
                    </p>
                  ) : null}
                  {datum.meta ? <p className="mt-1 max-w-[16rem] text-faint">{datum.meta}</p> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Phase distribution — ordinal ramp, one hue light to dark, 2px surface gaps.
// ---------------------------------------------------------------------------

export function PhaseDistribution({
  phases,
}: {
  phases: { label: string; count: number; description: string }[];
}) {
  const total = phases.reduce((sum, p) => sum + p.count, 0);
  const vars = ['--phase-1', '--phase-2', '--phase-3'];

  if (total === 0) {
    return <p className="py-4 text-center text-[13px] text-faint">No opportunities scheduled yet.</p>;
  }

  return (
    <figure className="m-0">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-sm" role="img"
           aria-label={phases.map((p) => `${p.label}: ${p.count}`).join(', ')}>
        {phases.map((phase, i) =>
          phase.count > 0 ? (
            <div
              key={phase.label}
              className="h-full first:rounded-l-[4px] last:rounded-r-[4px]"
              style={{
                width: `${(phase.count / total) * 100}%`,
                background: `rgb(var(${vars[i] ?? '--phase-3'}))`,
              }}
            />
          ) : null,
        )}
      </div>
      <figcaption className="mt-3 space-y-2">
        {phases.map((phase, i) => (
          <div key={phase.label} className="flex items-start gap-2.5 text-[12px]">
            <span
              aria-hidden
              className="mt-[3px] h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: `rgb(var(${vars[i] ?? '--phase-3'}))` }}
            />
            <span className="min-w-0">
              <span className="font-medium text-ink">
                {phase.label} — {phase.count}
              </span>
              <span className="ml-1 text-muted">{phase.description}</span>
            </span>
          </div>
        ))}
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Completeness / progress meter.
// ---------------------------------------------------------------------------

export function ProgressMeter({
  value,
  label,
  showPercent = true,
}: {
  value: number;
  label?: string;
  showPercent?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div>
      {label || showPercent ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label ? <span className="text-[13px] text-muted">{label}</span> : <span />}
          {showPercent ? <span className="tabular text-[13px] font-medium text-ink">{Math.round(pct)}%</span> : null}
        </div>
      ) : null}
      <div
        className="h-2 w-full overflow-hidden rounded-sm bg-raised"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div
          className="h-full rounded-r-[4px]"
          style={{ width: `${Math.max(pct, 1)}%`, background: 'rgb(var(--series-1))' }}
        />
      </div>
    </div>
  );
}

/**
 * Priority score meter. The score is always printed beside the bar, so the
 * comparison never depends on bar length alone.
 */
export function ScoreMeter({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-sm bg-raised">
        <div
          className="h-full rounded-r-[4px]"
          style={{ width: `${Math.max(score, 1)}%`, background: 'rgb(var(--series-1))' }}
        />
      </div>
      <span className="tabular text-[12px] font-medium text-ink">{score.toFixed(1)}</span>
    </div>
  );
}
