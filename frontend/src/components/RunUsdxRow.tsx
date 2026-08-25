import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { launchUsdxMutation } from "../api/@tanstack/react-query.gen";
import {
  errorDetail,
  errorMessage,
  explainUsdxProblem,
  usdxProblems,
} from "../errors";
import { Icon } from "./icons";
import "./SettingField.css";
import "./RunUsdxRow.css";

interface Props {
  /** Holds `settings.view` but not `settings.manage`: nothing to press. */
  readOnly: boolean;
}

/**
 * An action, not a setting: some of what a karaoke evening needs — which
 * microphone is player one, above all — can only be set inside Ultrastar
 * Deluxe, so the settings offer a way to get there.
 */
export default function RunUsdxRow({ readOnly }: Props) {
  const launch = useMutation(launchUsdxMutation());

  // "Started"/"Running" acknowledges the press, like the "Saved" of a field —
  // it must not stay: nothing tells us when the host closes USDX again, so a
  // word that stood there would be claiming a state it cannot know. Failures
  // stay: their sentences are what the fields below have to be fixed against.
  const { isSuccess, reset } = launch;
  useEffect(() => {
    if (!isSuccess) return;
    const timer = setTimeout(reset, 2000);
    return () => clearTimeout(timer);
  }, [isSuccess, reset]);

  // The two refusals worth their own sentence: a song is playing (that USDX is
  // busy), and USDX is not set up yet (the fields right below this row).
  const problems = launch.isError ? usdxProblems(launch.error) : null;
  const playing =
    launch.isError && errorDetail(launch.error) === "already_playing";

  return (
    <div className="setting-field">
      <div className="setting-row">
        <Icon name="power" className="run-usdx-icon" />
        <span className="setting-label run-usdx-label">
          Run Ultrastar Deluxe
        </span>
        {!readOnly && (
          <button
            type="button"
            className="button run-usdx-button"
            disabled={launch.isPending}
            onClick={() => launch.mutate({})}
          >
            {launch.isPending ? "Starting…" : "Launch"}
          </button>
        )}
        {launch.isSuccess && (
          <span className="setting-saved run-usdx-state" role="status">
            {launch.data.started ? "Started" : "Running"}
          </span>
        )}
      </div>

      <p className="setting-description">
        Some settings, like microphones, can only be changed in Ultrastar Deluxe
        itself.
      </p>

      {launch.isError && (
        <div className="error-notice setting-error" role="alert">
          {playing ? (
            <p className="run-usdx-problem">
              A song is playing right now — Ultrastar Deluxe is busy with it.
            </p>
          ) : problems !== null ? (
            problems.map((problem) => (
              <p className="run-usdx-problem" key={problem}>
                {explainUsdxProblem(problem)}
              </p>
            ))
          ) : (
            <p className="run-usdx-problem">
              {errorMessage(
                launch.error,
                "Could not start Ultrastar Deluxe. Check the paths below.",
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
