import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SessionList, SessionRead, SongRead } from "../api";
import {
  listAllScoresOptions,
  listAllScoresQueryKey,
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
import Modal from "../components/Modal";
import ScoreGroupList from "../components/ScoreGroupList";
import ScoresEmpty from "../components/ScoresEmpty";
import SessionSummaryRow from "../components/SessionSummaryRow";
import SongDetails from "../components/SongDetails";
import Loading from "../components/Loading";
import { errorMessage } from "../errors";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import {
  BOXPLOT_HEIGHT,
  allSessionsMeta,
  boxplotWidth,
  buildBoxplotOption,
  groupScores,
  sessionLabel,
  sessionMeta,
  sortGroups,
  type Grouping,
  type Sorting,
} from "../stats";
// The picker's rows are the shape `PickerRow` draws — a title over a quiet line
// — so they wear its stylesheet rather than a second copy of it. Not the
// component: its trailing `list` mark says "already on the list", and a party
// is not something a song is on.
import "../components/PickerRow.css";
import "./Scores.css";

/** The old app's grouping and sorting choices, wording included. */
const GROUPINGS: { value: Grouping; label: string }[] = [
  { value: "none", label: "don't group" },
  { value: "player", label: "group by player" },
  { value: "song", label: "group by song" },
];

/** The old app's four orders plus `chronological`, kept alphabetical by label
 * so a reader can find one in a five-option list without reading all five. */
const SORTINGS: { value: Sorting; label: string }[] = [
  { value: "alphabetically", label: "alphabetically" },
  { value: "average", label: "average score" },
  { value: "best", label: "best score" },
  { value: "chronological", label: "chronological" },
  { value: "worst", label: "worst score" },
];

/**
 * The picker's head row: every party this reader may open, added up as one
 * list. A word and not an id — a session id is 32 hex characters, so the two
 * can never collide.
 */
export const ALL_SESSIONS = "all";

interface SessionRowProps {
  /**
   * Whether this is the head row — the one that is every party at once. It
   * wears the `layers` glyph in front of its name rather than the 40px square
   * an icon-led picker row leads with: a party row has no lead of its own, and
   * a square here would push one title 52px off every other one.
   */
  everything?: boolean;
  title: string;
  meta: string;
  /** Whether this is the row the page is currently showing. */
  pressed: boolean;
  onClick: () => void;
}

/** One row of the session picker: what the party was called, and what it was. */
function SessionRow({
  everything,
  title,
  meta,
  pressed,
  onClick,
}: SessionRowProps) {
  return (
    <li>
      <button
        type="button"
        className="picker-row session-row"
        aria-pressed={pressed}
        onClick={onClick}
      >
        <span className="picker-row-text">
          <span className="picker-row-title" title={title}>
            {everything === true && (
              <Icon name="layers" className="session-row-glyph" />
            )}
            {title}
          </span>
          <span className="picker-row-meta">{meta}</span>
        </span>
      </button>
    </li>
  );
}

interface SessionBarProps {
  /** The party being shown, or `null` while the head row is selected. */
  session: SessionRead | null;
  /** What the picker stands on: a session id, or `ALL_SESSIONS`. */
  selected: string;
  sessions: SessionRead[];
  /** The head row's wording, or `null` when there is no head row to draw. */
  metaLabel: string | null;
  onSelect: (id: string) => void;
  canManage: boolean;
}

/** The session bar, with an inline rename for whoever may manage stats. While
 * renaming, the input takes the picker button's place in the same row. */
function SessionBar({
  session,
  selected,
  sessions,
  metaLabel,
  onSelect,
  canManage,
}: SessionBarProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The bar stays mounted across a change of party — a remount would hand the
  // picker's focus back to a button that is no longer in the document, and a
  // keyboard reader would land on `document.body` and re-tab from the top of
  // the page. So what belongs to *this* party is dropped by hand instead: an
  // open rename draft must never be carried to another party and saved there,
  // and a failure of the party just left is not this one's.
  const [shown, setShown] = useState(selected);
  if (shown !== selected) {
    setShown(selected);
    setDraft(null);
    setError(null);
  }

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

  // What the button stands on, and whether it needs saying what it is. The
  // hidden prefix is there for a party called "Yannis' birthday"; a nameless
  // one is already called "Session 8/23/2026, 20:00" and the head row "All
  // sessions", and "Session: Session 8/23/2026" is what a screen reader would
  // have to read out loud.
  const name = session === null ? (metaLabel ?? "") : sessionLabel(session);
  const namesItself = /session/i.test(name);

  return (
    <>
      {draft === null || session === null ? (
        <div className="scores-session">
          {/* A party is more than its name — a date, who was there, how much
              was sung — and none of that fits in an `<option>`. The button
              carries the name it stands on; the panel behind it carries the
              rest. */}
          <button
            type="button"
            className="scores-session-button"
            aria-haspopup="dialog"
            onClick={() => setPicking(true)}
          >
            {!namesItself && <span className="visually-hidden">Session: </span>}
            <span className="scores-session-name">{name}</span>
            <Icon name="chevron-right" className="scores-session-chevron" />
          </button>
          {/* Nothing to rename while the head row is selected: it is every
              party at once, not a party. */}
          {canManage && session !== null && (
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

      {picking && (
        <Modal title="Session" onClose={() => setPicking(false)}>
          <ul className="picker-list">
            {/* At the head, so "everything at once" is where the list starts
                rather than something to scroll past. */}
            {metaLabel !== null && (
              <SessionRow
                everything
                title={metaLabel}
                meta={allSessionsMeta(sessions)}
                pressed={selected === ALL_SESSIONS}
                onClick={() => {
                  onSelect(ALL_SESSIONS);
                  setPicking(false);
                }}
              />
            )}
            {sessions.map((entry) => (
              <SessionRow
                key={entry.id}
                title={sessionLabel(entry)}
                meta={sessionMeta(entry)}
                pressed={selected === entry.id}
                onClick={() => {
                  // The choice made, the panel is done — and closing it is what
                  // gives the focus back to the button that opened it.
                  onSelect(entry.id);
                  setPicking(false);
                }}
              />
            ))}
          </ul>
        </Modal>
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
  // The backend hands over exactly the parties this reader may open, so the
  // head row adds them all up — every party for a reader with the history
  // right, the ones they sang at for everybody else. With a single party in
  // the list it would only repeat that party, so it stays away.
  const metaLabel =
    all.length < 2
      ? null
      : auth.can("stats.history")
        ? "All sessions"
        : "All my scores";
  const meta = metaLabel !== null && selectedId === ALL_SESSIONS;
  const session = meta
    ? null
    : (all.find((entry) => entry.id === selectedId) ?? all[0] ?? null);

  const sessionScores = useQuery({
    ...listSessionScoresOptions({ path: { session_id: session?.id ?? "" } }),
    enabled: session !== null,
  });
  const allScores = useQuery({ ...listAllScoresOptions(), enabled: meta });
  const scores = meta ? allScores : sessionScores;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: listSessionsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: listAllScoresQueryKey() });
    if (session !== null) {
      void queryClient.invalidateQueries({
        queryKey: listSessionScoresQueryKey({
          path: { session_id: session.id },
        }),
      });
    }
  };

  // A finished song changes both the session's counts and its score list.
  useWingmanEvent("scores.recorded", refresh);
  // A moderator moved a score to another singer, or took one off the record —
  // possibly on another screen in the room.
  useWingmanEvent("scores.changed", refresh);

  if (!canView) {
    return (
      <div className="scores-page">
        <h1 className="visually-hidden">Scores</h1>
        <p className="scores-notice">
          Statistics are not open to your role. Log in or ask the host for
          access.
        </p>
      </div>
    );
  }

  if (sessions.isPending) return <Loading />;

  if (session === null && !meta) {
    return (
      <div className="scores-page">
        <h1 className="visually-hidden">Scores</h1>
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
  // order does not have: "worst score" puts the *lowest* scores first, and
  // alphabetically or chronologically the eight drawn bars are no ranking at
  // all.
  const chartTitle =
    grouping !== "none"
      ? "Score spread"
      : sorting === "worst"
        ? "Lowest scores"
        : sorting === "alphabetically" || sorting === "chronological"
          ? "Scores"
          : "Top scores";
  const chartLabel =
    grouping === "none"
      ? `${chartTitle} in ${meta ? "every session" : "this session"}`
      : `Score spread per ${grouping}`;

  // A time order says nothing about a *singer* — a player is not an event, and
  // "who sang first" is not a property of a person — so grouped by player the
  // option leaves the list rather than sitting there meaning nothing.
  const sortings = SORTINGS.filter(
    (option) => option.value !== "chronological" || grouping !== "player",
  );

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
          onChange={(event) => {
            const next = event.target.value as Grouping;
            setGrouping(next);
            // The order that is about to leave the list has to be *replaced*,
            // not merely hidden: a `<select>` whose value matches no option of
            // its own draws blank.
            if (next === "player" && sorting === "chronological")
              setSorting("best");
          }}
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
          {sortings.map((option) => (
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
      {/* The bottom nav already names the page; the heading stays for the
          document outline and for screen readers. */}
      <h1 className="visually-hidden">Scores</h1>

      <SessionBar
        session={session}
        selected={session?.id ?? ALL_SESSIONS}
        sessions={all}
        metaLabel={metaLabel}
        onSelect={setSelectedId}
        canManage={auth.can("stats.manage")}
      />

      {scores.isPending ? (
        <Loading />
      ) : scores.isError ? (
        /* Before the empty state, never instead of it: a failed request also
           leaves `rows` empty, and "Sing a song" is a lie about a session that
           may be full of scores nobody could fetch. One party or every party at
           once — the bar right above says which, so the line does not. */
        <p className="error-notice scores-session-error" role="alert">
          {errorMessage(scores.error, "Could not load the scores.")}
        </p>
      ) : groups.length === 0 ? (
        <ScoresEmpty>
          {/* `sing_count` counts songs *started*, which is exactly the right
              number here: every one of them ended without a score. */}
          {session !== null && session.sing_count > 0
            ? `${session.sing_count} songs started so far, none scored — ` +
              "Ultrastar Deluxe reports a score when a song runs to the end."
            : "Pick a song, sing it, and the ranking builds itself."}
        </ScoresEmpty>
      ) : (
        <>
          {/* Every party at once is no party: it has no date to head, and the
              figures of the row below are one evening's. */}
          {session !== null && (
            <SessionSummaryRow session={session} scores={rows} />
          )}

          {/* Above both things they reorder: the two selects rebuild the chart
              — its title included — as well as the ranking below it. */}
          {controls}

          {showChart && (
            <div className="scores-chart">
              <h2 className="scores-chart-title">{chartTitle}</h2>
              {/* The groups stand up, so a wide chart grows sideways. It
                  scrolls inside its own box — the page never does (§1.11). */}
              <div className="scores-chart-scroll">
                <Chart
                  option={buildBoxplotOption(groups)}
                  height={BOXPLOT_HEIGHT}
                  width={boxplotWidth(groups.length)}
                  label={chartLabel}
                />
              </div>
            </div>
          )}

          <ScoreGroupList
            groups={groups}
            grouping={grouping}
            sorting={sorting}
            players={players}
            onOpenSong={setOpenSong}
            canModerate={auth.can("stats.moderate")}
            onModerated={refresh}
          />
        </>
      )}

      {openSong !== null && (
        <SongDetails song={openSong} onClose={() => setOpenSong(null)} />
      )}
    </div>
  );
}
