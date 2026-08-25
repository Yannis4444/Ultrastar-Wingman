/**
 * Where a sub-page's back arrow leads when it was not opened from its usual
 * parent. The host manage view opens the very same `/settings` the phone's user
 * page opens, so the linking page names the way back in the router state rather
 * than every sub-page hardcoding one destination.
 *
 * Router state belongs to the history entry (`history.state`), so it outlives a
 * reload of that entry — the host may refresh `/settings` and still find its way
 * home. What carries none is an entry nobody linked to: a typed or shared URL, a
 * new tab, or a page navigated to *onward* from a page that had state. Such a
 * reader falls back to the page's own default, which is why every sub-page keeps
 * its `back` prop. None of the three management pages navigates onward today; a
 * new link out of one would have to pass the state along.
 */
export function backTarget(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const back = (state as { back?: unknown }).back;
  return typeof back === "string" ? back : null;
}
