import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import PeopleAdmin from "../components/PeopleAdmin";

/**
 * Everybody in the party on one page: the accounts and the guests who sing
 * without one. Two rights lead here — seeing the players and managing the
 * accounts — and each shows only what it may.
 */
export default function UserAccounts() {
  const auth = useAuth();
  const mayLook = auth.can("players.view") || auth.can("users.manage");

  return (
    <>
      <PageHeader title="Players & accounts" back="/user" />
      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded &&
        (mayLook ? (
          <PeopleAdmin />
        ) : (
          <p className="settings-notice">
            Players and accounts are for the host. Ask the host to give your
            account the rights.
          </p>
        ))}
    </>
  );
}
