import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { PermissionsRead } from "../api";
import {
  getPermissionsOptions,
  getPermissionsQueryKey,
  updateRolePermissionsMutation,
} from "../api/@tanstack/react-query.gen";
import { errorMessage } from "../errors";
import "./PermissionsMatrix.css";

/** The backend hardwires admin to every capability, so it is never editable. */
const LOCKED_ROLE = "admin";

/** What a role may do, per capability. Needs `permissions.manage`. */
export default function PermissionsMatrix() {
  const queryClient = useQueryClient();
  const key = getPermissionsQueryKey();
  const permissions = useQuery(getPermissionsOptions());
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
  // Admin always holds everything, which makes its row the full capability list.
  const capabilities = roles?.[LOCKED_ROLE] ?? [];

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
      <h2>Permissions</h2>

      {(permissions.isError || error) && (
        <p className="error-notice permissions-notice" role="alert">
          {error ?? "Could not load the permissions."}
        </p>
      )}

      {roles && (
        <div className="permissions-scroll">
          <table className="permissions-matrix">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                {Object.keys(roles).map((role) => (
                  <th key={role} scope="col">
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {capabilities.map((capability) => (
                <tr key={capability}>
                  <th scope="row">{capability}</th>
                  {Object.keys(roles).map((role) => (
                    <td key={role}>
                      <input
                        type="checkbox"
                        aria-label={`${capability} for ${role}`}
                        checked={roles[role].includes(capability)}
                        disabled={role === LOCKED_ROLE}
                        onChange={(event) =>
                          toggle(role, capability, event.target.checked)
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
