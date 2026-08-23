/**
 * The generated client throws the parsed error body. FastAPI puts a
 * machine-readable slug in `detail` — except for validation errors and the
 * USDX path report, where `detail` is an object; those get `null` here.
 */
export function errorDetail(error: unknown): string | null {
  const detail = (error as { detail?: unknown } | null | undefined)?.detail;
  return typeof detail === "string" ? detail : null;
}

const MISSING_PERMISSION = "missing_permission:";

/** The capability a 403 was denied for, `null` for every other error. */
export function missingPermission(error: unknown): string | null {
  const detail = errorDetail(error);
  return detail?.startsWith(MISSING_PERMISSION)
    ? detail.slice(MISSING_PERMISSION.length)
    : null;
}

/**
 * Notice text for a failed request: a permission denial explains itself (the
 * UI hides most of them, but a role can change while a page is open),
 * everything else falls back to the caller's message.
 */
export function errorMessage(error: unknown, fallback: string): string {
  const capability = missingPermission(error);
  return capability === null
    ? fallback
    : `Your role may not do this (${capability}). Ask the host for access.`;
}
