/**
 * The generated client throws the parsed error body. FastAPI puts a
 * machine-readable slug in `detail` — except for validation errors and the
 * USDX path report, where `detail` is an object. `errorDetail` reports those as
 * `null`; the USDX report has its own extractor below.
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

/**
 * The USDX setup problems behind a 400 from the sing endpoint, or `null` for
 * every other error. The body is `{detail: {error, problems}}` — an object, so
 * `errorDetail` cannot carry it.
 */
export function usdxProblems(error: unknown): string[] | null {
  const detail = (error as { detail?: unknown } | null | undefined)?.detail;
  if (typeof detail !== "object" || detail === null) return null;
  const { error: code, problems } = detail as {
    error?: unknown;
    problems?: unknown;
  };
  if (code !== "usdx_not_configured" || !Array.isArray(problems)) return null;
  return problems.filter(
    (problem): problem is string => typeof problem === "string",
  );
}

/**
 * Every problem `resolve_usdx_paths` (backend `karaoke/usdx_paths.py`) can
 * report, in words a host understands. The backend strings name settings keys
 * and paths, which is exactly what a report should say and exactly what a
 * dialog should not.
 */
const USDX_EXPLANATIONS: [RegExp, string][] = [
  [
    /^'usdx\.executable' is not set/,
    "Wingman does not know where Ultrastar Deluxe is installed. Fill in the USDX base path — the folder that contains ultrastardx.exe.",
  ],
  [
    /^'usdx\.executable' is not a file/,
    "There is no Ultrastar Deluxe program at that path. Either the base path points somewhere else, or the program has another name.",
  ],
  [
    /^'usdx\.config_file' is not set/,
    "Wingman cannot find USDX's config.ini, where it writes the players and their colors.",
  ],
  [
    /^'usdx\.avatars_dir' is not set/,
    "Wingman does not know USDX's avatars folder, so player pictures cannot reach USDX.",
  ],
  [
    /^'usdx\.ultrastar_db' is not set/,
    "Wingman does not know where USDX keeps its scores (Ultrastar.db), so nothing would be recorded after a song.",
  ],
  [
    /^'songs\.directory' is not set/,
    "Wingman does not know where your songs are. Fill in the songs directory.",
  ],
  [
    /^'songs\.directory' is not a directory/,
    "The songs directory does not exist. Check the spelling, and whether the drive it is on is connected.",
  ],
  // Not a settings problem: `service.start_sing` reports a failed launch as a path
  // problem too, and its raw text carries a host path and a Windows error code.
  [
    /^cannot start /,
    "Ultrastar Deluxe is where Wingman expects it, but the program refused to start. Start Ultrastar Deluxe by hand once, then try again.",
  ],
];

/**
 * A backend USDX problem as a sentence. An unrecognised one is passed through
 * unchanged: a raw string still tells the host something, a swallowed problem
 * tells them nothing.
 */
export function explainUsdxProblem(problem: string): string {
  return (
    USDX_EXPLANATIONS.find(([pattern]) => pattern.test(problem))?.[1] ?? problem
  );
}
