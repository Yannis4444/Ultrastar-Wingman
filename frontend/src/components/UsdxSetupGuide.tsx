import { Link } from "react-router-dom";
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
            <p>
              All of it lives in the <strong>USDX</strong> and{" "}
              <strong>Songs</strong> groups of the settings. Fill in the base
              path and the songs directory first. The rest is derived from them.
            </p>
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
