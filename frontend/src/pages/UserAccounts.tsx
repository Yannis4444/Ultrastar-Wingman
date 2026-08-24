import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import UsersAdmin from "../components/UsersAdmin";

export default function UserAccounts() {
  const auth = useAuth();

  return (
    <>
      <PageHeader title="Accounts" back="/user" />
      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded &&
        (auth.can("users.manage") ? (
          <UsersAdmin />
        ) : (
          <p className="settings-notice">
            Managing accounts is for the host. Ask the host to give your account
            the rights.
          </p>
        ))}
    </>
  );
}
