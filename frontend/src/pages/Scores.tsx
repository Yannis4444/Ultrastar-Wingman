import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import ScoreGroupList from "../components/ScoreGroupList";
import SessionSummaryRow from "../components/SessionSummaryRow";
import Spinner from "../components/Spinner";
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

/** Inline "rename this session" control, shown to whoever may manage stats. */
function SessionName({ session }: { session: SessionRead }) {
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

  if (draft === null) {
    return (
      <button
        type="button"
        className="button scores-rename"
        onClick={() => {
          setError(null);
          setDraft(session.name ?? "");
        }}
      >
        Rename session
      </button>
    );
  }

  return (
    <form
      className="scores-rename-form"
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
        className="button button-primary"
        disabled={rename.isPending}
      >
        Save
      </button>
      <button type="button" className="button" onClick={() => setDraft(null)}>
        Cancel
      </button>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
    </form>
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

  if (sessions.isPending) return <Spinner />;

  if (session === null) {
    return (
      <>
        <h1>Scores</h1>
        <p>
          No scores yet. Sing a song and the results show up here — one page per
          party.
        </p>
      </>
    );
  }

  const rows = scores.data?.scores ?? [];
  const groups = groupScores(rows, grouping);

  return (
    <div className="scores-page">
      <h1>Scores</h1>

      <div className="scores-picker">
        <label>
          <span className="visually-hidden">Session</span>
          <select
            className="text-input"
            value={session.id}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {all.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {sessionLabel(entry)}
              </option>
            ))}
          </select>
        </label>
        {/* Keyed: switching sessions must not carry an open rename draft over
            to a different session and save it there. */}
        {auth.can("stats.manage") && (
          <SessionName key={session.id} session={session} />
        )}
      </div>

      <SessionSummaryRow session={session} scores={rows} />

      {scores.isPending ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <p>This session has no scores yet.</p>
      ) : (
        <>
          <fieldset className="scores-grouping">
            <legend>Group by</legend>
            {(["player", "song"] as const).map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="grouping"
                  value={option}
                  checked={grouping === option}
                  onChange={() => setGrouping(option)}
                />
                {option}
              </label>
            ))}
          </fieldset>

          <div className="scores-chart">
            <Chart
              option={buildBoxplotOption(rows, grouping)}
              height={boxplotHeight(groups.length)}
              label={`Score spread per ${grouping}, best median first`}
            />
          </div>

          <ScoreGroupList groups={groups} grouping={grouping} />
        </>
      )}
    </div>
  );
}
