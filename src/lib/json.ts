/** Safe JSON helpers — the SQLite schema stores arrays/objects as JSON text. */

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function stringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Parses an answer value stored as JSON, tolerating legacy plain strings. */
export function parseAnswer(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
