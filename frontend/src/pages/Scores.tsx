import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SessionList, SessionRead, SongRead } from "../api";
import {
  listPlayersOptions,
  listSessionScoresOptions,
  listSessionScoresQueryKey,
  listSessionsOptions,
  listSessionsQueryKey,
  renameSessionMutation,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import Chart from "../components/Chart";
import { Icon } from "../components/icons";
import ScoreGroupList from "../components/ScoreGroupList";
import ScoresEmpty from "../components/ScoresEmpty";
import SessionSummaryRow from "../components/SessionSummaryRow";
import SongDetails from "../components/SongDetails";
import Loading from "../components/Loading";
import { errorMessage } from "../errors";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import {
  boxplotHeight,
  buildBoxplotOption,
  groupScores,
  sessionLabel,
  sortGroups,
  type Grouping,
  type Sorting,
} from "../stats";
import "./Scores.css";

/** The old app's grouping and sorting choices, wording included. */
const GROUPINGS: { value: Grouping; label: string }[] = [
  { value: "none", label: "don't group" },
  { value: "player", label: "group by player" },
  { value: "song", label: "group by song" },
];

const SORTINGS: { value: Sorting; label: string }[] = [
  { value: "alphabetically", label: "alphabetically" },
  { value: "average", label: "average score" },
  { value: "best", label: "best score" },
  { value: "worst", label: "worst score" },
];

interface SessionBarProps {
  session: SessionRead;
  sessions: SessionRead[];
  onSelect: (id: string) => void;
  canManage: boolean;
}

/** The session picker, with an inline rename for whoever may manage stats.
 * While renaming, the input takes the select's place in the same row. */
function SessionBar({
  session,
  sessions,
  onSelect,
  canManage,
}: SessionBarProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rename = useMutation({
    ...renameSessionMutation(),
    onSuccess: (updated) => {
      setDraft(null);
      // PATCH answers with the whole row, counts included — no refetch needed.
      queryClient.setQueryData<SessionList>(listSessionsQueryKey(), (old) =>
        old == null
          ? old
          : {
              sessions: old.sessions.map((entry) =>
                entry.id === updated.id ? updated : entry,
              ),
            },
      );
    },
    onError: (failure) =>
      setError(errorMessage(failure, "Could not rename the session.")),
  });

  return (
    <>
      {draft === null ? (
        <div className="scores-session">
          <label>
            <span className="visually-hidden">Session</span>
            <select
              className="text-input"
              value={session.id}
              onChange={(event) => onSelect(event.target.value)}
            >
              {sessions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {sessionLabel(entry)}
                </option>
              ))}
            </select>
          </label>
          {canManage && (
            <button
              type="button"
              className="icon-button icon-button-bordered"
              aria-label="Rename session"
              onClick={() => {
                setError(null);
                setDraft(session.name ?? "");
              }}
            >
              <Icon name="pencil" />
            </button>
          )}
        </div>
      ) : (
        <form
          className="scores-session"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            rename.mutate({
              path: { session_id: session.id },
              // The backend stores an empty string verbatim; clearing means null.
              body: { name: draft.trim() === "" ? null : draft.trim() },
            });
          }}
        >
          <label>
            <span className="visually-hidden">Session name</span>
            <input
              className="text-input"
              value={draft}
              placeholder="Yannis’ birthday"
              onChange={(event) => setDraft(event.target.value)}
              autoFocus
            />
          </label>
          <button
            type="submit"
            className="icon-button icon-button-bordered"
            aria-label="Save"
            disabled={rename.isPending}
          >
            <Icon name="check" />
          </button>
          <button
            type="button"
            className="icon-button icon-button-bordered"
            aria-label="Cancel"
            onClick={() => setDraft(null)}
          >
            <Icon name="close" />
          </button>
        </form>
      )}
      {error && (
        <p className="error-notice scores-session-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Statistics of one party: who sang what and how well it went. */
export default function Scores() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Grouping>("player");
  // The old app's default order, and the one a scoreboard is read for.
  const [sorting, setSorting] = useState<Sorting>("best");
  const [openSong, setOpenSong] = useState<SongRead | null>(null);

  const canView = auth.can("stats.view");
  const sessions = useQuery({
    ...listSessionsOptions(),
    enabled: auth.loaded && canView,
  });

  // Only for the avatars: a singer without a player record — a guest, or a
  // deleted player — still gets the initial `PlayerAvatar` draws for them.
  const playerList = useQuery({
    ...listPlayersOptions(),
    enabled: auth.loaded && auth.can("players.view"),
  });
  const players = new Map(
    (playerList.data?.players ?? []).map((player) => [player.id, player]),
  );

  // Newest first from the backend, so the default selection is the first row.
  const all = sessions.data?.sessions ?? [];
  const session =
    all.find((entry) => entry.id === selectedId) ?? all[0] ?? null;

  const scores = useQuery({
    ...listSessionScoresOptions({ path: { session_id: session?.id ?? "" } }),
    enabled: session !== null,
  });

  // A finished song changes both the session's counts and its score list.
  useWingmanEvent("scores.recorded", () => {
    void queryClient.invalidateQueries({ queryKey: listSessionsQueryKey() });
    if (session !== null) {
      void queryClient.invalidateQueries({
        queryKey: listSessionScoresQueryKey({
          path: { session_id: session.id },
        }),
      });
    }
  });

  if (!canView) {
    return (
      <>
        <h1>Scores</h1>
        <p>
          Statistics are not open to your role. Log in or ask the host for
          access.
        </p>
      </>
    );
  }

  if (sessions.isPending) return <Loading />;

  if (session === null) {
    return (
      <div className="scores-page">
        <h1>Scores</h1>
        <ScoresEmpty>
          Sing a song and the results land here — one page per party.
        </ScoresEmpty>
      </div>
    );
  }

  const rows = scores.data?.scores ?? [];
  const groups = sortGroups(groupScores(rows, grouping), sorting);
  // One group's chart says nothing the single ranking row does not.
  const showChart = groups.length >= 2;
  // Ungrouped there is no spread to draw — the chart becomes a plain ranking of
  // the head of the list. It therefore may not claim a ranking the reader's
  // order does not have: "worst score" puts the *lowest* scores on top, and
  // alphabetically the eight drawn bars are no ranking at all.
  const chartTitle =
    grouping !== "none"
      ? "Score spread"
      : sorting === "worst"
        ? "Lowest scores"
        : sorting === "alphabetically"
          ? "Scores"
          : "Top scores";
  const chartLabel =
    grouping === "none"
      ? `${chartTitle} in this session`
      : `Score spread per ${grouping}`;

  // Two quiet selects on one line: the reader sets these once an evening, so
  // they get a row, not the two blocks of radios that used to own the first
  // screen. The `<label>` wraps its select, which is what names it.
  const controls = (
    <div className="scores-controls">
      <label className="scores-control">
        <span className="scores-control-label">Group</span>
        <select
          className="text-input text-input-quiet"
          value={grouping}
          onChange={(event) => setGrouping(event.target.value as Grouping)}
        >
          {GROUPINGS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="scores-control">
        <span className="scores-control-label">Sort</span>
        <select
          className="text-input text-input-quiet"
          value={sorting}
          onChange={(event) => setSorting(event.target.value as Sorting)}
        >
          {SORTINGS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <div className="scores-page">
      <h1>Scores</h1>

      {/* Keyed: switching sessions must not carry an open rename draft over
          to a different session and save it there. */}
      <SessionBar
        key={session.id}
        session={session}
        sessions={all}
        onSelect={setSelectedId}
        canManage={auth.can("stats.manage")}
      />

      {scores.isPending ? (
        <Loading />
      ) : scores.isError ? (
        /* Before the empty state, never instead of it: a failed request also
           leaves `rows` empty, and "Sing a song" is a lie about a session that
           may be full of scores nobody could fetch. */
        <p className="error-notice scores-session-error" role="alert">
          {errorMessage(scores.error, "Could not load this session's scores.")}
        </p>
      ) : groups.length === 0 ? (
        <ScoresEmpty>
          {/* `sing_count` counts songs *started*, which is exactly the right
              number here: every one of them ended without a score. */}
          {session.sing_count > 0
            ? `${session.sing_count} songs started so far, none scored — ` +
              "Ultrastar Deluxe reports a score when a song runs to the end."
            : "Pick a song, sing it, and the ranking builds itself."}
        </ScoresEmpty>
      ) : (
        <>
          <SessionSummaryRow session={session} scores={rows} />

          {/* Above both things they reorder: the two selects rebuild the chart
              — its title included — as well as the ranking below it. */}
          {controls}

          {showChart && (
            <div className="scores-chart">
              <h2 className="scores-chart-title">{chartTitle}</h2>
              <Chart
                option={buildBoxplotOption(groups)}
                height={boxplotHeight(groups.length)}
                label={chartLabel}
              />
            </div>
          )}

          <ScoreGroupList
            groups={groups}
            grouping={grouping}
            sorting={sorting}
            players={players}
            onOpenSong={setOpenSong}
          />
        </>
      )}

      {openSong !== null && (
        <SongDetails song={openSong} onClose={() => setOpenSong(null)} />
      )}
    </div>
  );
}
