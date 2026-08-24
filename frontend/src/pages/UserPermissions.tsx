import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import RolePermissions from "../components/RolePermissions";

export default function UserPermissions() {
  const auth = useAuth();

  return (
    <>
      <PageHeader title="Permissions" back="/user" />
      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded &&
        (auth.can("permissions.manage") ? (
          <RolePermissions />
        ) : (
          <p className="settings-notice">
            Managing permissions is for the host. Ask the host to give your
            account the rights.
          </p>
        ))}
    </>
  );
}
