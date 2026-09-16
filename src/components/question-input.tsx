import { inputClass } from './ui';
import type { TemplateQuestion } from '@/lib/engine/assessment-template';

/** Renders one assessment question in the shape its answer type needs. */
export function QuestionInput({
  question,
  value,
}: {
  question: TemplateQuestion;
  value: unknown;
}) {
  const name = question.key;

  switch (question.inputType) {
    case 'LONGTEXT':
      return (
        <textarea
          name={name}
          rows={4}
          defaultValue={typeof value === 'string' ? value : ''}
          className={inputClass}
          required={question.required}
        />
      );

    case 'LIST':
      return (
        <textarea
          name={name}
          rows={5}
          defaultValue={Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : ''}
          className={`${inputClass} font-mono text-[12px]`}
          placeholder="One per line"
          required={question.required}
        />
      );

    case 'SELECT':
      return (
        <select
          name={name}
          defaultValue={typeof value === 'string' ? value : ''}
          className={inputClass}
          required={question.required}
        >
          <option value="">Select…</option>
          {(question.options ?? []).map((option) => (
            <option key={option} value={option}>
              {humanise(option)}
            </option>
          ))}
        </select>
      );

    case 'MULTISELECT': {
      const selected = new Set(Array.isArray(value) ? value.map(String) : []);
      return (
        <div className="flex flex-wrap gap-2">
          {(question.options ?? []).map((option) => (
            <label
              key={option}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-ink transition hover:bg-raised has-[:checked]:border-brand has-[:checked]:bg-brand/10 has-[:checked]:text-brand"
            >
              <input
                type="checkbox"
                name={name}
                value={option}
                defaultChecked={selected.has(option)}
                className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
              />
              {humanise(option)}
            </label>
          ))}
        </div>
      );
    }

    case 'BOOLEAN':
      return (
        <div className="flex gap-2">
          {[
            { label: 'Yes', val: 'true' },
            { label: 'No', val: 'false' },
          ].map((option) => (
            <label
              key={option.val}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-1.5 text-[13px] text-ink transition hover:bg-raised has-[:checked]:border-brand has-[:checked]:bg-brand/10 has-[:checked]:text-brand"
            >
              <input
                type="radio"
                name={name}
                value={option.val}
                defaultChecked={String(value === true) === option.val || (value === undefined && option.val === 'false' && false)}
                className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
              />
              {option.label}
            </label>
          ))}
        </div>
      );

    case 'SCALE': {
      const current = typeof value === 'number' ? value : null;
      return (
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-[13px] font-medium text-ink transition hover:bg-raised has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-brandInk"
            >
              <input
                type="radio"
                name={name}
                value={n}
                defaultChecked={current === n}
                className="sr-only"
                required={question.required && n === 1 && current === null}
              />
              {n}
            </label>
          ))}
        </div>
      );
    }

    case 'CURRENCY':
    case 'PERCENT':
    case 'NUMBER':
      return (
        <div className="relative">
          <input
            type="number"
            step="any"
            min="0"
            name={name}
            defaultValue={typeof value === 'number' ? value : ''}
            className={`${inputClass} tabular ${question.inputType === 'CURRENCY' ? 'pl-7' : ''} ${
              question.inputType === 'PERCENT' ? 'pr-8' : ''
            }`}
            required={question.required}
          />
          {question.inputType === 'CURRENCY' ? (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-faint">
              £
            </span>
          ) : null}
          {question.inputType === 'PERCENT' ? (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-faint">
              %
            </span>
          ) : null}
        </div>
      );

    default:
      return (
        <input
          type="text"
          name={name}
          defaultValue={typeof value === 'string' ? value : ''}
          className={inputClass}
          required={question.required}
        />
      );
  }
}

export function humanise(value: string): string {
  if (value === value.toUpperCase() && value.includes('_')) {
    const text = value.replace(/_/g, ' ').toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  if (value === 'B2B' || value === 'B2C' || value === 'B2B2C' || value === 'CRM' || value === 'ERP' || value === 'HR') {
    return value;
  }
  if (value === value.toUpperCase() && value.length > 3) {
    const text = value.toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return value;
}
