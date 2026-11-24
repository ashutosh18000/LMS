/**
 * Safely extracts an array from any data source.
 * 1. If data is already an Array, returns it.
 * 2. If data is an object with an `items` array (e.g. PaginatedResult), returns `data.items`.
 * 3. If data is an object with a `rows` array (e.g. BalanceSummaryReport), returns `data.rows`.
 * 4. Otherwise, returns `fallback` (default: empty array `[]`).
 * In development mode, if data is truthy and cannot be parsed to an array, logs a console.warn.
 */
export function safeArray<T = any>(
  data: unknown,
  contextName?: string,
  fallback: T[] = [],
): T[] {
  if (Array.isArray(data)) {
    return data as T[];
  }

  if (data && typeof data === 'object') {
    if (Array.isArray((data as any).items)) {
      return (data as any).items as T[];
    }
    if (Array.isArray((data as any).rows)) {
      return (data as any).rows as T[];
    }
  }

  if (data !== undefined && data !== null) {
    if (import.meta.env.DEV) {
      console.warn(
        `[safeArray] Expected Array or { items: [] } / { rows: [] }${
          contextName ? ` for "${contextName}"` : ''
        }, but received:`,
        data,
      );
    }
  }

  return fallback;
}

export function toArray<T = any>(val: unknown, fallback: T[] = []): T[] {
  return Array.isArray(val) ? val : fallback;
}
