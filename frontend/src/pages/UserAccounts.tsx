import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import PeopleAdmin from "../components/PeopleAdmin";

/**
 * Everybody in the party on one page: the accounts and the guests who sing
 * without one. Four rights lead here — the players, their pictures, reading the
 * accounts and managing them — and each shows only what it may.
 *
 * `players.view` is deliberately not one of them: every guest phone holds it for
 * the singer picker, so it would leave this page open to the whole party.
 */
export default function UserAccounts() {
  const auth = useAuth();
  const mayLook =
    auth.can("players.manage") ||
    auth.can("players.avatar") ||
    auth.can("users.view") ||
    auth.can("users.manage");

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
