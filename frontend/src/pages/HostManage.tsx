import { useAuth } from "../auth";
import ManageMenu from "../components/ManageMenu";
import PageHeader from "../components/PageHeader";
import { manageEntries } from "../manage";
import "./HostManage.css";

/** Named in the row links so every page behind them returns to the stage. */
const BACK_TO_HERE = { back: "/host/manage" };

/**
 * The karaoke PC's way into the management pages. It exists so the host screen
 * never drops into the phone-shaped user page, which is an identity and login
 * surface with a tab bar that leads the TV nowhere.
 *
 * The pages behind the rows are the ordinary ones — they work as they are, only
 * their back arrow has to come home here instead of to /user.
 */
export default function HostManage() {
  const auth = useAuth();
  const entries = manageEntries(auth);

  return (
    <div className="host-manage-page">
      <PageHeader title="Manage" back="/host" />
      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded &&
        (entries.length > 0 ? (
          <ManageMenu entries={entries} linkState={BACK_TO_HERE} />
        ) : (
          <p className="settings-notice">
            This browser has no management rights. Open the host link from the
            server log to run the party from this screen.
          </p>
        ))}
    </div>
  );
}
