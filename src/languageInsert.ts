import type { YamlCursorContext } from './languageContext';

export interface OffsetRange {
  start: number;
  end: number;
}

/** Replace the whole current YAML scalar, including dotted/slashed names. */
export function referenceReplacement(
  source: string,
  context: YamlCursorContext,
): OffsetRange | undefined {
  if (!context.valueRange) return undefined;
  let [start, end] = context.valueRange;
  const raw = source.slice(start, end);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    start++;
    end--;
  }
  return { start, end };
}

/** A substitution completion replaces only the token name, never its ${...} wrapper. */
export function tokenReplacement(
  source: string,
  context: YamlCursorContext,
  offset: number,
): OffsetRange | undefined {
  if (!context.valueRange) return undefined;
  const [valueStart, valueEnd] = context.valueRange;
  const raw = source.slice(valueStart, valueEnd);
  for (const match of raw.matchAll(/\$\{([^}\n]*)\}?/g)) {
    const start = valueStart + (match.index ?? 0) + 2;
    const end = start + (match[1]?.length ?? 0);
    if (start <= offset && offset <= end) return { start, end };
  }
  return undefined;
}
