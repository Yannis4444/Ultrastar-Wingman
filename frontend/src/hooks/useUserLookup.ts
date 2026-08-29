import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { lookupUsersOptions } from "../api/@tanstack/react-query.gen";

/** The backend answers nothing shorter, so nothing shorter is asked. */
const MIN_QUERY = 2;

/** Long enough that typing a name is one request, short enough to feel live. */
const DEBOUNCE_MS = 250;

/**
 * The "add people" search both the playlist's member list and the tag editor
 * put above their people rows: a field, a pause before the request goes out,
 * and the matching accounts.
 *
 * `enabled` is the caller's gate — the endpoint needs a right the page has
 * already worked out, and a reader who may not manage the thing must not send
 * the lookup at all.
 */
export function useUserLookup(enabled: boolean) {
  const [search, setSearch] = useState("");
  const [needle, setNeedle] = useState("");

  // One request per pause in the typing, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setNeedle(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const searching = needle.length >= MIN_QUERY;
  const suggestions = useQuery({
    ...lookupUsersOptions({ query: { q: needle } }),
    enabled: enabled && searching,
  });

  return {
    search,
    setSearch,
    /** Whether a request for the current needle is on its way or answered. */
    searching,
    suggestions,
    /** Empty the field without waiting for the debounce to catch up. */
    clear: () => {
      setSearch("");
      setNeedle("");
    },
  };
}
