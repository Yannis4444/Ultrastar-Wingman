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

/** What pydantic puts in front of a message its own validator raised. */
const VALUE_ERROR = /^Value error, /;

/**
 * The sentence behind a 422, or `null` when the error is not one.
 *
 * FastAPI's validation body is `{detail: [{loc, msg, type}, …]}` — a list, so
 * `errorDetail` reports it as `null`, there being no slug in it. The first
 * `msg` is the refusal itself, and for a refusal a model raised by hand it is a
 * sentence somebody can act on: *"'(a+' is not a valid regular expression:
 * missing ), unterminated subpattern at position 0"*. There is exactly one
 * refusal a form cannot make for itself — a regular expression, Python's
 * dialect being the only authority on one (`achievements.ts`, `REGEX_NOTE`) —
 * and a generic "could not save" would leave its author with nothing to fix.
 *
 * The first message and not all of them: pydantic reports one entry per failed
 * union member as well, and a page has room for the thing that went wrong, not
 * for a schema.
 */
export function validationMessage(error: unknown): string | null {
  const detail = (error as { detail?: unknown } | null | undefined)?.detail;
  if (!Array.isArray(detail)) return null;
  const first = detail.find(
    (item): item is { msg: string } =>
      typeof (item as { msg?: unknown } | null)?.msg === "string",
  );
  const message = first?.msg.replace(VALUE_ERROR, "").trim() ?? "";
  if (message === "") return null;
  // Sentence-cased and stopped: it is written as a clause ("a regular
  // expression cannot be empty") and read as a notice.
  const stopped = /[.!?]$/.test(message) ? message : `${message}.`;
  return `${stopped[0].toUpperCase()}${stopped.slice(1)}`;
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
 * UI hides most of them, but somebody's groups can change while a page is
 * open), everything else falls back to the caller's message. It says "you",
 * never a group: a caller holds rights through several groups at once, so no
 * one of them is "yours".
 */
export function errorMessage(error: unknown, fallback: string): string {
  const capability = missingPermission(error);
  return capability === null
    ? fallback
    : `You may not do this (${capability}). Ask the host for access.`;
}

/**
 * The refusals of the groups API and the membership write
 * (permission-groups.md §5, §6), in words. A `missing_permission` from rule 2
 * is worded by `errorMessage`, like every other 403.
 */
const GROUP_REFUSALS: Record<string, string> = {
  admin_required:
    "Only an administrator can change who is in Admin or delete an administrator.",
  built_in_group:
    "Guest, User, and Admin are built in. They keep their names and cannot be deleted.",
  admin_not_editable:
    "Admin holds every right, always. Its rights cannot be changed.",
  duplicate_group_name: "A group with that name already exists. Pick another.",
  unknown_group: "That group no longer exists. Reload the page and try again.",
  not_assignable:
    "Nobody is put in Guest or User. Every account is in User already.",
  last_admin: "There has to be one administrator left.",
};

/** Notice text for a failed write to a group or to somebody's groups. */
export function groupMessage(error: unknown, fallback: string): string {
  return (
    GROUP_REFUSALS[errorDetail(error) ?? ""] ?? errorMessage(error, fallback)
  );
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
 * What a Wingman that brings its own Ultrastar Deluxe says where the USDX paths
 * would be asked for: the settings page's USDX group and the setup dialog. Each
 * adds what it needs after it; the phrase "comes with this installation" is the
 * one every surface uses for the fact.
 */
export const BUNDLED_USDX_NOTE =
  "Ultrastar Deluxe comes with this installation, so there are no paths to set for it.";

/**
 * Every problem `resolve_usdx_paths` (backend `karaoke/usdx_paths.py`) can
 * report, in words a host understands. The backend strings name settings keys
 * and paths, which is exactly what a report should say and exactly what a
 * dialog should not.
 */
const USDX_EXPLANATIONS: [RegExp, string][] = [
  // Never from a Wingman that brings its own Ultrastar Deluxe, which works
  // every path out of its usdx folder: naming the base path is right here.
  [
    /^'usdx\.executable' is not set/,
    "Wingman does not know where Ultrastar Deluxe is installed. Fill in the USDX base path, the folder that contains ultrastardx.exe.",
  ],
  [
    /^'usdx\.executable' is not a file/,
    "There is no Ultrastar Deluxe program at that path. Either the base path points somewhere else, or the program has another name.",
  ],
  // Only from a Wingman that brings its own Ultrastar Deluxe: no setting names
  // that path, so the sentence must not send the host looking for one.
  [
    /^the bundled Ultrastar Deluxe is missing/,
    "The Ultrastar Deluxe that comes with this installation is missing. Its program was moved or deleted.",
  ],
  // The setup asks before it installs into such a folder, but a silent one goes
  // on, and the host may have said yes. Moving the folder by hand would break
  // the Start menu entries and the uninstaller.
  [
    /^the bundled Ultrastar Deluxe is in a folder that is not plain ASCII/,
    "The Ultrastar Deluxe that comes with this installation is in a folder whose path has letters beyond A to Z, such as an ä in a Windows user name. It cannot start songs from there. Uninstall Wingman and install it again into a plain folder, such as C:\\Karaoke\\Ultrastar Wingman.",
  ],
  [
    /^the bundled songs folder cannot be written to/,
    "Wingman may not write to the songs folder of the Ultrastar Deluxe that comes with this installation, and some songs have to be copied in there to start. Give your Windows account the right to change usdx\\songs in the install folder, under Security in the folder's properties.",
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
    /^'usdx\.songs_dir' is not set/,
    "Wingman does not know USDX's own songs folder. It has to start a song from inside it, otherwise Ultrastar Deluxe opens with the whole library instead.",
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

/**
 * Why `POST /karaoke/usdx/launch` was refused, as sentences: a song is playing
 * (that Ultrastar Deluxe is busy), or each setup problem in a host's words.
 * `null` for every other failure, which each caller words for where it stands:
 * the Settings row points at the paths below it, the host screen has none.
 */
export function usdxLaunchRefusal(error: unknown): string[] | null {
  if (errorDetail(error) === "already_playing")
    return ["A song is playing right now. Ultrastar Deluxe is busy with it."];
  return usdxProblems(error)?.map(explainUsdxProblem) ?? null;
}
