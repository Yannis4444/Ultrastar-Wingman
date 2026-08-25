import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { DownloadRead, SongRead, UsdbSong } from "../api";
import {
  createDownloadMutation,
  listDownloadsOptions,
  listSongsOptions,
  updateSettingMutation,
  usdbSearchOptions,
  usdbStatusOptions,
  usdbStatusQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import DownloadsPanel from "../components/DownloadsPanel";
import { Icon } from "../components/icons";
import Modal from "../components/Modal";
import PageHeader from "../components/PageHeader";
import SongDetails from "../components/SongDetails";
import UsdbSongItem, { Ring } from "../components/UsdbSongItem";
import { errorDetail, errorMessage } from "../errors";
import { downloadKey, useDownloadEvents } from "../hooks/useDownloadEvents";
import "./Usdb.css";

const STATUS_MESSAGES: Record<string, string> = {
  no_credentials: "Wingman has no USDB account yet.",
  invalid_credentials: "USDB rejected those credentials.",
  login_failed: "The USDB login failed.",
  unreachable: "USDB could not be reached.",
  no_songs_directory: "The song library directory is not configured yet.",
};

interface Sort {
  /** `<order>-<direction>`, the way the old app encoded the pair. */
  value: string;
  label: string;
  order: "id" | "artist" | "title" | "rating" | "views";
  direction: "asc" | "desc";
}

/** The orders USDB's result table can be asked for, as one control. */
const SORTS: Sort[] = [
  {
    value: "rating-desc",
    label: "Best rated",
    order: "rating",
    direction: "desc",
  },
  {
    value: "rating-asc",
    label: "Worst rated",
    order: "rating",
    direction: "asc",
  },
  { value: "id-desc", label: "Newest first", order: "id", direction: "desc" },
  { value: "id-asc", label: "Oldest first", order: "id", direction: "asc" },
  {
    value: "artist-asc",
    label: "Artist A–Z",
    order: "artist",
    direction: "asc",
  },
  {
    value: "artist-desc",
    label: "Artist Z–A",
    order: "artist",
    direction: "desc",
  },
  { value: "title-asc", label: "Title A–Z", order: "title", direction: "asc" },
  {
    value: "title-desc",
    label: "Title Z–A",
    order: "title",
    direction: "desc",
  },
  {
    value: "views-desc",
    label: "Most viewed",
    order: "views",
    direction: "desc",
  },
  {
    value: "views-asc",
    label: "Least viewed",
    order: "views",
    direction: "asc",
  },
];

/** Capped at the backend's `MAX_LIMIT`. */
const PAGE_SIZES = [30, 50, 100];

interface Query {
  artist: string;
  title: string;
  sort: string;
  limit: number;
}

const EMPTY_QUERY: Query = {
  artist: "",
  title: "",
  sort: SORTS[0].value,
  limit: 30,
};

function statusMessage(code: string | null | undefined): string {
  return STATUS_MESSAGES[code ?? ""] ?? "USDB is not usable right now.";
}

/** The single line above the result list: what USDB is doing, or what it said. */
function resultLine(
  loggedIn: boolean,
  pending: boolean,
  results: UsdbSong[] | undefined,
  page: number,
): string {
  if (!loggedIn) return "Log in to USDB to search it.";
  if (pending || results === undefined) return "Searching USDB…";
  if (results.length === 0)
    return page > 1 ? "No more results." : "Nothing matches that search.";
  return `${results.length} ${results.length === 1 ? "result" : "results"}`;
}

export default function Usdb() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  useDownloadEvents();

  const [form, setForm] = useState<Query>(EMPTY_QUERY);
  const [submitted, setSubmitted] = useState<Query>(EMPTY_QUERY);
  const [page, setPage] = useState(1);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState<SongRead | null>(null);

  const maySearch = auth.can("usdb.search");
  const maySeeDownloads = auth.can("downloads.view");

  const status = useQuery({ ...usdbStatusOptions(), enabled: maySearch });
  const loggedIn = status.data?.logged_in === true;

  const sort = SORTS.find((one) => one.value === submitted.sort) ?? SORTS[0];
  const search = useQuery({
    ...usdbSearchOptions({
      query: {
        artist: submitted.artist || undefined,
        title: submitted.title || undefined,
        order: sort.order,
        ud: sort.direction,
        limit: submitted.limit,
        page,
      },
    }),
    enabled: loggedIn,
  });

  // What the library already holds, so a result that is in it can be opened
  // like any other song instead of dead-ending in a checkmark.
  const library = useQuery({
    ...listSongsOptions(),
    enabled: auth.can("songs.view"),
  });
  const localSongs = useMemo(() => {
    const map = new Map<string, SongRead>();
    for (const song of library.data?.songs ?? []) map.set(song.id, song);
    return map;
  }, [library.data]);

  // Not gated on the login: a download queued before the session expired is
  // still running and the panel has to keep showing it.
  const downloads = useQuery({
    ...listDownloadsOptions(),
    enabled: maySeeDownloads,
  });
  const byKey = useMemo(() => {
    const map = new Map<string, DownloadRead>();
    // Newest first, so the first row for a song wins over its earlier attempts.
    for (const row of downloads.data?.downloads ?? []) {
      const key = downloadKey(row.source, row.source_song_id);
      if (!map.has(key)) map.set(key, row);
    }
    return map;
  }, [downloads.data]);

  const startDownload = useMutation({
    ...createDownloadMutation(),
    onSuccess: () => setDownloadError(null),
    onError: (error) =>
      setDownloadError(
        errorDetail(error) === "already_queued"
          ? "That song is already in the queue."
          : errorMessage(error, "Could not start the download."),
      ),
  });

  const saveSetting = useMutation(updateSettingMutation());
  const [credentialsError, setCredentialsError] = useState<string | null>(null);

  const saveCredentials = async (): Promise<void> => {
    try {
      await saveSetting.mutateAsync({
        path: { key: "usdb.username" },
        body: { value: username },
      });
      await saveSetting.mutateAsync({
        path: { key: "usdb.password" },
        body: { value: password },
      });
      // A fresh login attempt, not the cached verdict — then the page's own
      // status key gets the answer so the banner updates.
      const fresh = await queryClient.fetchQuery(
        usdbStatusOptions({ query: { refresh: true } }),
      );
      queryClient.setQueryData(usdbStatusQueryKey(), fresh);
      setCredentialsError(null);
      setPassword("");
    } catch {
      setCredentialsError("Could not save the credentials.");
    }
  };

  /** Searches with what is in the fields, plus the changed filter. A filter is
   *  worth nothing behind a Search button the user has to find again. */
  const apply = (change: Partial<Query>): void => {
    const next = { ...form, ...change };
    setForm(next);
    setSubmitted(next);
    setPage(1);
  };

  // `force` on a retry: a failed attempt may well have left a broken copy in
  // the library, and `already_downloaded` would then block the second try.
  const start = (source: string, sourceSongId: string, force: boolean): void =>
    startDownload.mutate({
      body: { source, source_song_id: sourceSongId, force },
    });

  const retry = (row: DownloadRead): void =>
    start(row.source, row.source_song_id, true);

  const results = search.data?.results;
  const pages = search.data?.pages ?? null;

  const rows = downloads.data?.downloads ?? [];
  const active = rows.filter(
    (row) => row.status === "queued" || row.status === "running",
  ).length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const downloadsLabel =
    active > 0
      ? `Downloads: ${active} running`
      : failed > 0
        ? `Downloads: ${failed} failed`
        : "Downloads";

  // The pager sits at the bottom; without this, a page flip leaves the view
  // at the bottom of results it has not seen the top of.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [page, submitted]);

  if (!maySearch) {
    return (
      <div className="usdb-page">
        <PageHeader title="USDB" back="/songs" />
        <p className="usdb-notice usdb-muted">
          Searching and downloading songs needs access the host has to grant.
          Log in on the User tab, or ask the host to give your account the
          rights.
        </p>
      </div>
    );
  }

  return (
    <div className="usdb-page">
      {/* Sticky, so the downloads status is reachable without scrolling past a
          955-page result list. Below the modal backdrop's z-index of 2000. */}
      <PageHeader title="USDB" back="/songs">
        {maySeeDownloads && (
          <button
            type="button"
            className={`icon-button usdb-downloads-button${
              active === 0 && failed > 0 ? " icon-button-danger" : ""
            }`}
            aria-label={downloadsLabel}
            onClick={() => setPanelOpen(true)}
          >
            {active > 0 ? (
              <Ring progress={null} />
            ) : failed > 0 ? (
              <Icon name="alert" />
            ) : (
              <Icon name="download" />
            )}
          </button>
        )}
      </PageHeader>

      {status.isError && (
        <p className="error-notice usdb-notice" role="alert">
          Could not ask the backend about USDB.
        </p>
      )}

      {status.data && !loggedIn && (
        <div className="usdb-login">
          <p className="usdb-login-message" role="alert">
            {statusMessage(status.data.error)}
          </p>
          {/* The credentials are settings, so only who may change settings
              gets the form — everybody else just sees why USDB is unusable. */}
          {auth.can("settings.manage") && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveCredentials();
              }}
            >
              <input
                className="text-input"
                value={username}
                placeholder="USDB username"
                aria-label="USDB username"
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
              />
              <input
                className="text-input"
                type="password"
                value={password}
                placeholder="USDB password"
                aria-label="USDB password"
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="submit"
                className="button button-primary"
                disabled={username.trim() === "" || saveSetting.isPending}
              >
                {saveSetting.isPending ? "Checking…" : "Log in"}
              </button>
            </form>
          )}
          {credentialsError && (
            <p className="error-notice usdb-notice" role="alert">
              {credentialsError}
            </p>
          )}
        </div>
      )}

      <form
        className="usdb-search"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted({ ...form });
          setPage(1);
        }}
      >
        <input
          className="text-input usdb-field"
          value={form.artist}
          placeholder="Artist"
          aria-label="Artist"
          onChange={(event) =>
            setForm((old) => ({ ...old, artist: event.target.value }))
          }
        />
        <input
          className="text-input usdb-field"
          value={form.title}
          placeholder="Title"
          aria-label="Title"
          onChange={(event) =>
            setForm((old) => ({ ...old, title: event.target.value }))
          }
        />
        {/* Collapsed by default: two fields are the search, the rest is tuning
            and must not push the results off a phone screen. */}
        <details className="usdb-filters">
          <summary>More filters</summary>
          <label className="usdb-filter">
            <span>Sort by</span>
            <select
              className="text-input"
              value={form.sort}
              onChange={(event) => apply({ sort: event.target.value })}
            >
              {SORTS.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </select>
          </label>
          <label className="usdb-filter">
            <span>Results per page</span>
            <select
              className="text-input"
              value={form.limit}
              onChange={(event) => apply({ limit: Number(event.target.value) })}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </details>
        {/* Primary only once it can do anything: while the login card is up, its
            "Log in" button is the one primary of the view. */}
        <button
          type="submit"
          className={`button usdb-submit${loggedIn ? " button-primary" : ""}`}
          disabled={!loggedIn}
        >
          Search
        </button>
      </form>

      {downloadError && (
        <p className="error-notice usdb-notice" role="alert">
          {downloadError}
        </p>
      )}

      {/* Everything below the hairline is the answer to the search above it. */}
      <section className="usdb-results-section" aria-label="Search results">
        {search.isError ? (
          <p className="error-notice usdb-notice" role="alert">
            {statusMessage(errorDetail(search.error))}
          </p>
        ) : status.isError ? null : (
          // Nothing to say about a search that was never possible: the notice
          // above already reports that the backend could not be asked.
          <p className="usdb-status">
            {resultLine(loggedIn, search.isPending, results, page)}
          </p>
        )}

        {results && results.length > 0 && (
          <div className="usdb-results">
            {results.map((song) => {
              const id = String(song.usdb_id);
              const row = byKey.get(downloadKey("usdb", id));
              const local = localSongs.get(`usdb:${id}`);
              return (
                <UsdbSongItem
                  key={song.usdb_id}
                  song={song}
                  download={row}
                  onDownload={() => start("usdb", id, row?.status === "failed")}
                  onOpen={local ? () => setSelected(local) : undefined}
                />
              );
            })}
          </div>
        )}

        {/* Also on an empty page: USDB often reports no page count at all, so
            stepping past the last page is how the end is found — and Previous
            has to be there to get back. */}
        {results && (results.length > 0 || page > 1) && (
          <div className="usdb-pager">
            <button
              type="button"
              className="button"
              disabled={page === 1 || search.isFetching}
              onClick={() => setPage((old) => old - 1)}
            >
              Previous
            </button>
            <span>
              {pages === null ? `Page ${page}` : `${page} / ${pages}`}
            </span>
            <button
              type="button"
              className="button"
              disabled={
                search.isFetching ||
                results.length === 0 ||
                (pages !== null && page >= pages)
              }
              onClick={() => setPage((old) => old + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>

      {panelOpen && (
        <Modal title="Downloads" onClose={() => setPanelOpen(false)}>
          <DownloadsPanel downloads={rows} onRetry={retry} />
        </Modal>
      )}

      {selected && (
        <SongDetails song={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
