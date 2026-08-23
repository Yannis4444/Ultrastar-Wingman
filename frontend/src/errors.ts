/**
 * The generated client throws the parsed error body. FastAPI puts a
 * machine-readable slug in `detail` — except for validation errors and the
 * USDX path report, where `detail` is an object; those get `null` here.
 */
export function errorDetail(error: unknown): string | null {
  const detail = (error as { detail?: unknown } | null | undefined)?.detail;
  return typeof detail === "string" ? detail : null;
}
