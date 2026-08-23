import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { DownloadRead } from "../api";
import {
  createDownloadMutation,
  listDownloadsOptions,
  updateSettingMutation,
  usdbSearchOptions,
  usdbStatusOptions,
  usdbStatusQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import DownloadsPanel from "../components/DownloadsPanel";
import UsdbSongItem from "../components/UsdbSongItem";
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

function statusMessage(code: string | null | undefined): string {
  return STATUS_MESSAGES[code ?? ""] ?? "USDB is not usable right now.";
}

export default function Usdb() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  useDownloadEvents();

  const [form, setForm] = useState({ artist: "", title: "" });
  const [submitted, setSubmitted] = useState({ artist: "", title: "" });
  const [page, setPage] = useState(1);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const maySearch = auth.can("usdb.search");
  const maySeeDownloads = auth.can("downloads.view");

  const status = useQuery({ ...usdbStatusOptions(), enabled: maySearch });
  const loggedIn = status.data?.logged_in === true;

  const search = useQuery({
    ...usdbSearchOptions({
      query: {
        artist: submitted.artist || undefined,
        title: submitted.title || undefined,
        page,
      },
    }),
    enabled: loggedIn,
  });

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

  if (!maySearch) {
    return (
      <>
        <h1>Explore USDB</h1>
        <p className="usdb-notice usdb-muted">
          Searching and downloading songs needs access the host has to grant.
          Log in on the User tab, or ask the host to give your account the
          rights.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Explore USDB</h1>

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

      {loggedIn && <p className="usdb-logged-in">Logged in to USDB.</p>}

      <form
        className="usdb-search"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted({ ...form });
          setPage(1);
        }}
      >
        <input
          className="text-input"
          value={form.artist}
          placeholder="Artist"
          aria-label="Artist"
          onChange={(event) =>
            setForm((old) => ({ ...old, artist: event.target.value }))
          }
        />
        <input
          className="text-input"
          value={form.title}
          placeholder="Title"
          aria-label="Title"
          onChange={(event) =>
            setForm((old) => ({ ...old, title: event.target.value }))
          }
        />
        <button
          type="submit"
          className="button button-primary"
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

      {search.isError && (
        <p className="error-notice usdb-notice" role="alert">
          {statusMessage(errorDetail(search.error))}
        </p>
      )}

      {loggedIn && search.isPending && (
        <p className="usdb-notice usdb-muted">Searching USDB…</p>
      )}

      {results?.length === 0 && (
        <p className="usdb-notice usdb-muted">
          {page > 1 ? "No more results." : "Nothing matches that search."}
        </p>
      )}

      {results && results.length > 0 && (
        <div className="usdb-results">
          {results.map((song) => {
            const id = String(song.usdb_id);
            const row = byKey.get(downloadKey("usdb", id));
            return (
              <UsdbSongItem
                key={song.usdb_id}
                song={song}
                download={row}
                onDownload={() => start("usdb", id, row?.status === "failed")}
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
          <span>{pages === null ? `Page ${page}` : `${page} / ${pages}`}</span>
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

      {maySeeDownloads && (
        <DownloadsPanel
          downloads={downloads.data?.downloads ?? []}
          onRetry={retry}
        />
      )}
    </>
  );
}
