import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { SessionList, SessionRead } from "../api";
import {
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
import SessionSummaryRow from "../components/SessionSummaryRow";
import Loading from "../components/Loading";
import { errorMessage } from "../errors";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import {
  boxplotHeight,
  buildBoxplotOption,
  groupScores,
  sessionLabel,
  type Grouping,
} from "../stats";
import "./Scores.css";

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

/** An empty page that says what to do about it, not just that it is empty. */
function ScoresEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="scores-empty">
      <Icon name="chart" className="scores-empty-icon" />
      <h2>No scores yet</h2>
      <p>{children}</p>
      <Link className="button button-primary" to="/songs">
        Browse songs
      </Link>
    </div>
  );
}

/** Statistics of one party: who sang what and how well it went. */
export default function Scores() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Grouping>("player");

  const canView = auth.can("stats.view");
  const sessions = useQuery({
    ...listSessionsOptions(),
    enabled: auth.loaded && canView,
  });

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
  const groups = groupScores(rows, grouping);
  // One group's chart says nothing the single ranking row does not.
  const showChart = groups.length >= 2;

  const groupingControl = (
    <fieldset className="scores-grouping">
      <legend className="visually-hidden">Group by</legend>
      {(["player", "song"] as const).map((option) => (
        <label key={option} className="scores-grouping-option">
          <input
            type="radio"
            className="visually-hidden"
            name="grouping"
            value={option}
            checked={grouping === option}
            onChange={() => setGrouping(option)}
          />
          <span>{option}</span>
        </label>
      ))}
    </fieldset>
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
      ) : groups.length === 0 ? (
        <ScoresEmpty>
          {session.sing_count > 0
            ? `${session.sing_count} sings so far, none scored — Ultrastar ` +
              "Deluxe reports a score when a song runs to the end."
            : "Pick a song, sing it, and the ranking builds itself."}
        </ScoresEmpty>
      ) : (
        <>
          <SessionSummaryRow session={session} scores={rows} />

          {showChart ? (
            <div className="scores-chart">
              <div className="scores-chart-header">
                <h2 className="scores-chart-title">Score spread</h2>
                {groupingControl}
              </div>
              <Chart
                option={buildBoxplotOption(rows, grouping)}
                height={boxplotHeight(groups.length)}
                label={`Score spread per ${grouping}, best median first`}
              />
            </div>
          ) : (
            groupingControl
          )}

          <ScoreGroupList groups={groups} grouping={grouping} />
        </>
      )}
    </div>
  );
}
