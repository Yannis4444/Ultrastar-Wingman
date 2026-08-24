import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useRef, useState } from "react";
import type { PermissionsRead } from "../api";
import {
  getPermissionsOptions,
  getPermissionsQueryKey,
  updateRolePermissionsMutation,
} from "../api/@tanstack/react-query.gen";
import { errorMessage } from "../errors";
import "./RolePermissions.css";

/** The backend hardwires admin to every capability, so it is never editable. */
const LOCKED_ROLE = "admin";

/** What a role may do: pick a role, then one flat row per capability. Needs
 * `permissions.manage`; the page around it gates. */
export default function RolePermissions() {
  const queryClient = useQueryClient();
  const key = getPermissionsQueryKey();
  const permissions = useQuery(getPermissionsOptions());
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The snapshot to restore when a PUT fails. A ref, not the mutation context,
  // because the generated mutation options fix the context type to `unknown`.
  const rollback = useRef<PermissionsRead | undefined>(undefined);

  const save = useMutation({
    ...updateRolePermissionsMutation(),
    onMutate: async (variables) => {
      // Without this a request already in flight can land after the optimistic
      // write and put the old checkboxes back.
      await queryClient.cancelQueries({ queryKey: key });
      rollback.current = queryClient.getQueryData<PermissionsRead>(key);
      setError(null);
      queryClient.setQueryData<PermissionsRead>(key, (old) =>
        old === undefined
          ? old
          : {
              roles: {
                ...old.roles,
                [variables.path.role]: variables.body.capabilities,
              },
            },
      );
    },
    onSuccess: (data) => queryClient.setQueryData<PermissionsRead>(key, data),
    onError: (cause) => {
      queryClient.setQueryData<PermissionsRead>(key, rollback.current);
      setError(errorMessage(cause, "Could not save the permissions."));
    },
  });

  const roles = permissions.data?.roles;
  const editableRoles = Object.keys(roles ?? {}).filter(
    (role) => role !== LOCKED_ROLE,
  );
  const selected = picked ?? editableRoles[0];
  // Admin always holds everything, which makes its list the full capability
  // list; sorted, so same-prefix capabilities sit together for grouping.
  const capabilities = [...(roles?.[LOCKED_ROLE] ?? [])].sort();
  const groups: [string, string[]][] = [];
  for (const capability of capabilities) {
    const group = capability.split(".")[0];
    const last = groups[groups.length - 1];
    if (last !== undefined && last[0] === group) last[1].push(capability);
    else groups.push([group, [capability]]);
  }

  const toggle = (role: string, capability: string, granted: boolean): void => {
    const current = roles?.[role] ?? [];
    save.mutate({
      path: { role },
      body: {
        capabilities: granted
          ? [...current, capability]
          : current.filter((name) => name !== capability),
      },
    });
  };

  return (
    <>
      {(permissions.isError || error) && (
        <p className="error-notice permissions-notice" role="alert">
          {error ?? "Could not load the permissions."}
        </p>
      )}

      {roles && selected !== undefined && (
        <>
          <div className="perm-roles" role="group" aria-label="Role">
            {editableRoles.map((role) => (
              <button
                type="button"
                key={role}
                className={role === selected ? "active" : ""}
                aria-pressed={role === selected}
                onClick={() => setPicked(role)}
              >
                {role}
              </button>
            ))}
          </div>
          <p className="perm-hint">
            Admins can always do everything. Pick a role to change what it may
            do.
          </p>
          {groups.map(([group, names]) => (
            <Fragment key={group}>
              <h2 className="perm-group">{group}</h2>
              <ul className="perm-list">
                {names.map((capability) => (
                  <li key={capability}>
                    <label className="perm-row">
                      {/* The group heading carries the noun, the row the verb. */}
                      <span className="perm-name">
                        {capability.slice(capability.indexOf(".") + 1)}
                      </span>
                      <input
                        type="checkbox"
                        aria-label={`${capability} for ${selected}`}
                        checked={roles[selected].includes(capability)}
                        onChange={(event) =>
                          toggle(selected, capability, event.target.checked)
                        }
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </Fragment>
          ))}
        </>
      )}
    </>
  );
}
