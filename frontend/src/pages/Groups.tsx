import { Link } from "react-router-dom";
import type { GroupRead } from "../api";
import { useAuth } from "../auth";
import GroupSquare from "../components/GroupSquare";
import { Icon } from "../components/icons";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import { ADMIN, addedRights, memberWords } from "../groups";
import { useGroups } from "../hooks/useGroups";
import "./Tags.css";
import "./Groups.css";

/** What a row says under the group's name: who is in it and what it gives,
 *  out of `member_count` and `right_count` alone. */
function meta(group: GroupRead): string {
  return `${memberWords(group)} · ${addedRights(group)}`;
}

/** The two lines of a row, shared by the link rows and Admin's. */
function RowBody({ group }: { group: GroupRead }) {
  return (
    <>
      <GroupSquare groupId={group.id} />
      <span className="tags-text">
        <span className="tags-name">{group.name}</span>
        <span className="tags-meta">{meta(group)}</span>
      </span>
    </>
  );
}

/**
 * The permission groups (permission-groups.md §9.1), the tags admin's shape:
 * one row per group in the backend's one order — Guest, User, the host's own
 * groups by name, Admin last — each leading into its editor, and the header's
 * `+` starting a new one. Admin's row is no link: it holds every right by rule
 * and there is nothing to edit, which its meta line already says. Behind
 * `permissions.manage`, like the manage entry that opens it.
 */
export default function Groups() {
  const auth = useAuth();
  const allowed = auth.loaded && auth.can("permissions.manage");
  const groups = useGroups(allowed);
  const rows = groups.data?.groups ?? [];

  return (
    <div className="tags-page groups-page">
      <PageHeader title="Groups" back="/user">
        {allowed && (
          <Link
            className="icon-button"
            to="/user/groups/new"
            aria-label="New group"
            title="New group"
          >
            <Icon name="plus" />
          </Link>
        )}
      </PageHeader>

      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded &&
        (!allowed ? (
          <p className="settings-notice">
            Groups are the host's to set up. Ask the host for access.
          </p>
        ) : (
          <>
            {groups.isPending && <Loading />}

            {groups.isError && (
              <p className="error-notice tags-notice" role="alert">
                Could not load the groups.
              </p>
            )}

            {rows.length > 0 && (
              <>
                <p className="section-note groups-note">
                  Every account is in User. A group adds its rights to User's.
                  Admins hold every right, so nothing here can lock the host
                  out.
                </p>
                <ul className="tags-list" aria-label="Groups">
                  {rows.map((group) => (
                    <li key={group.id}>
                      {group.id === ADMIN ? (
                        <div className="groups-static">
                          <RowBody group={group} />
                        </div>
                      ) : (
                        <Link
                          className="tags-open"
                          to={`/user/groups/${encodeURIComponent(group.id)}`}
                        >
                          <RowBody group={group} />
                          <Icon name="chevron-right" className="tags-chevron" />
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ))}
    </div>
  );
}
