import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { usdxStatusOptions } from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { explainUsdxProblem } from "../errors";
import Modal from "./Modal";
import "./UsdxSetupGuide.css";

interface UsdxSetupGuideProps {
  /** What the backend reported. Empty for a caller who may not see the
      settings — the dialog then only explains the situation. */
  problems: string[];
  onClose: () => void;
}

/** Why Ultrastar Deluxe cannot be started, and what to do about it. */
export default function UsdxSetupGuide({
  problems,
  onClose,
}: UsdxSetupGuideProps) {
  const auth = useAuth();
  // The banner's own cache entry, so opening the dialog from there costs
  // nothing. Read here rather than handed in: Play opens this dialog too, and
  // a Wingman that brings its own Ultrastar Deluxe has no base path to ask for.
  const status = useQuery({
    ...usdxStatusOptions(),
    enabled: auth.loaded && auth.can("songs.view"),
  });
  const bundled = status.data?.bundled === true;

  return (
    <Modal title="Ultrastar Deluxe is not set up" onClose={onClose}>
      <div className="usdx-setup-guide">
        {/* No claim about the cause: the same dialog carries a missing path and a
            program that would not start. */}
        <p>Wingman cannot start Ultrastar Deluxe yet.</p>

        {problems.length > 0 && (
          <ul className="usdx-setup-problems">
            {problems.map((problem) => (
              <li key={problem}>{explainUsdxProblem(problem)}</li>
            ))}
          </ul>
        )}

        {auth.can("settings.manage") ? (
          <>
            {bundled ? (
              <p>
                Ultrastar Deluxe comes with this installation, so it needs no
                path. The songs directory is in the <strong>Songs</strong> group
                of the settings.
              </p>
            ) : (
              <p>
                All of it lives in the <strong>USDX</strong> and{" "}
                <strong>Songs</strong> groups of the settings. Fill in the base
                path and the songs directory first. The rest is derived from
                them.
              </p>
            )}
            <Link className="button button-primary" to="/settings">
              Open the settings
            </Link>
          </>
        ) : (
          <p>
            Ask the host to set it up. Only they can change Wingman's settings.
          </p>
        )}
      </div>
    </Modal>
  );
}
