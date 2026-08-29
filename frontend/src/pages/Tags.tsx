import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { TagRead } from "../api";
import {
  listTagAssignmentsOptions,
  listTagAssignmentsQueryKey,
  listTagsOptions,
  listTagsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import EmptyState from "../components/EmptyState";
import { Icon } from "../components/icons";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import { tagColorClass, tagGlyph } from "../tags";
import "./Tags.css";

/**
 * What a row says about a tag under its name: how many songs wear it, and the
 * two flags that change what everybody else sees. Both flags are left out when
 * they are off — a meta line is for what is unusual about this row.
 */
function meta(tag: TagRead, songs: number): string {
  const parts = [songs === 1 ? "1 song" : `${songs} songs`];
  if (tag.hide_by_default) parts.push("hidden by default");
  if (tag.show_in_list) parts.push("shown in list");
  return parts.join(" · ");
}

/**
 * The tags of the party, one row each, behind the `tags.manage` entry of the
 * manage menu (§7). A row leads into the editor; the header's `+` starts a new
 * tag. Both the tags and how many songs carry each of them come from the two
 * requests the song list already makes, so the page costs nothing new.
 */
export default function Tags() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const allowed = auth.loaded && auth.can("tags.manage");

  const tags = useQuery({ ...listTagsOptions(), enabled: allowed });
  const assignments = useQuery({
    ...listTagAssignmentsOptions(),
    enabled: allowed,
  });

  useWingmanEvent("tags.changed", () => {
    void queryClient.invalidateQueries({ queryKey: listTagsQueryKey() });
    void queryClient.invalidateQueries({
      queryKey: listTagAssignmentsQueryKey(),
    });
  });
  useWingmanEvent("song_tags.changed", () => {
    void queryClient.invalidateQueries({
      queryKey: listTagAssignmentsQueryKey(),
    });
  });

  // tag id -> how many songs carry it. A tag nobody has used is simply absent.
  const counts = new Map(
    (assignments.data?.assignments ?? []).map((row) => [
      row.tag_id,
      row.song_ids.length,
    ]),
  );
  const rows = tags.data?.tags ?? [];

  return (
    <div className="tags-page">
      <PageHeader title="Tags" back="/user">
        {allowed && (
          <Link
            className="icon-button"
            to="/user/tags/new"
            aria-label="New tag"
            title="New tag"
          >
            <Icon name="plus" />
          </Link>
        )}
      </PageHeader>

      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded && (
        <>
          {!allowed && (
            <p className="settings-notice">
              Tags are set up by trusted accounts and the host. Ask the host for
              access.
            </p>
          )}

          {allowed && (
            <>
              {tags.isPending && <Loading />}

              {tags.isError && (
                <p className="error-notice tags-notice" role="alert">
                  Could not load the tags.
                </p>
              )}

              {tags.isSuccess && rows.length === 0 && (
                <EmptyState icon="tag" title="No tags yet">
                  A tag marks songs — the broken ones, the ones nobody should
                  find tonight — and you decide who it is for.
                </EmptyState>
              )}

              {rows.length > 0 && (
                <ul className="tags-list">
                  {rows.map((tag) => (
                    <li key={tag.id}>
                      <Link
                        className="tags-open"
                        to={`/user/tags/${encodeURIComponent(tag.id)}`}
                      >
                        <span
                          className={`tags-square ${tagColorClass(tag.color)}`}
                          aria-hidden="true"
                        >
                          <Icon name={tagGlyph(tag.icon)} />
                        </span>
                        <span className="tags-text">
                          <span className="tags-name">{tag.name}</span>
                          <span className="tags-meta">
                            {meta(tag, counts.get(tag.id) ?? 0)}
                          </span>
                        </span>
                        <Icon name="chevron-right" className="tags-chevron" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
