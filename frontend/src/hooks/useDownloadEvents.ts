import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { DownloadList, DownloadRead } from "../api";
import {
  listDownloadsQueryKey,
  listSongsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useWingmanEvent, type WingmanEvent } from "./useWingmanEvents";

interface DownloadUpdated extends WingmanEvent {
  download: DownloadRead;
}

/** Mirrors the backend's `HISTORY_LIMIT` so the cache can't grow past the list. */
const HISTORY_LIMIT = 100;

/** The download and everything about it, keyed the way a song id is. */
export function downloadKey(source: string, sourceSongId: string): string {
  return `${source}:${sourceSongId}`;
}

/**
 * Folds one row into the downloads cache, whether it came from a broadcast or
 * straight out of a mutation. A dismissed row is dropped instead of stored: the
 * backend's list does not carry it either, so keeping it would resurrect the
 * entry until the next refetch.
 */
export function applyDownload(
  queryClient: QueryClient,
  download: DownloadRead,
): void {
  queryClient.setQueryData(
    listDownloadsQueryKey(),
    (previous: DownloadList | undefined) => ({
      downloads: [
        ...(download.dismissed_at === null ? [download] : []),
        ...(previous?.downloads ?? []).filter((row) => row.id !== download.id),
      ]
        .sort((left, right) => right.id - left.id)
        .slice(0, HISTORY_LIMIT),
    }),
  );
}

/**
 * Folds `download.updated` broadcasts into the `listDownloads` cache — the one
 * place download state lives, so progress bars and the per-song badges read the
 * same rows. A finished download also invalidates the song list, which is why
 * every page that shows songs calls this: the new song appears without a rescan.
 */
export function useDownloadEvents(): void {
  const queryClient = useQueryClient();

  useWingmanEvent<DownloadUpdated>("download.updated", ({ download }) => {
    applyDownload(queryClient, download);
    if (download.status === "finished") {
      void queryClient.invalidateQueries({ queryKey: listSongsQueryKey() });
    }
  });
}
