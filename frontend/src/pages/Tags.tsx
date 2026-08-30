import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { TagRead, TagRuleKindRead } from "../api";
import {
  listTagRulesOptions,
  listTagsOptions,
  listTagsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import EmptyState from "../components/EmptyState";
import { Icon } from "../components/icons";
import Loading from "../components/Loading";
import PageHeader from "../components/PageHeader";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import {
  BUILT_IN_TAG_IDS,
  BUILT_IN_TAGS,
  builtInTags,
  ruleSummary,
  tagColorClass,
  tagGlyph,
} from "../tags";
import "./Tags.css";

/**
 * What a row says about a tag under its name: how many songs wear it, the rule
 * that put them there if it was not a person, and the two flags that change
 * what everybody else sees. Everything but the count is left out when it does
 * not apply — a meta line is for what is unusual about this row.
 */
function meta(tag: TagRead, kinds: readonly TagRuleKindRead[]): string {
  const songs = tag.song_count;
  const parts = [songs === 1 ? "1 song" : `${songs} songs`];
  // First of the three, right behind the count (§7): how the songs got there
  // comes before what the tag does to a list.
  if (tag.rule !== null)
    parts.push(`automatic: ${ruleSummary(tag.rule, kinds)}`);
  if (tag.hide_by_default) parts.push("hidden by default");
  if (tag.show_in_list) parts.push("shown in list");
  return parts.join(" · ");
}

/**
 * The tags of the party, one row each, behind the `tags.manage` entry of the
 * manage menu (§7). A row leads into the editor; the header's `+` starts a new
 * tag. The tags and their counts come from the one request the song list
 * already makes, so the page costs nothing new.
 */
export default function Tags() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const allowed = auth.loaded && auth.can("tags.manage");

  const tags = useQuery({ ...listTagsOptions(), enabled: allowed });
  // What a rule is called, for the meta line of an automatic tag. Its own
  // request, and the same cache the editor and the song modal read.
  const ruleKinds = useQuery({ ...listTagRulesOptions(), enabled: allowed });

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: listTagsQueryKey() });
  useWingmanEvent("tags.changed", refresh);
  // The counts live on the listing, so tagging a song moves it too.
  useWingmanEvent("song_tags.changed", refresh);

  const rows = tags.data?.tags ?? [];
  const builtIns = builtInTags(tags.data?.built_ins);

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
                            {meta(tag, ruleKinds.data?.rules ?? [])}
                          </span>
                        </span>
                        <Icon name="chevron-right" className="tags-chevron" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {/* The two marks the app brings with it, after the rows `+` and
                  Delete govern: they are not tags, so nothing here creates or
                  removes one. *Recent* is a mode — a time-ordered list — and
                  has no row at all. */}
              {tags.isSuccess && (
                <>
                  <h2>Built-in</h2>
                  <ul className="tags-list">
                    {BUILT_IN_TAG_IDS.map((id) => (
                      <li key={id}>
                        <Link className="tags-open" to={`/user/tags/${id}`}>
                          <span
                            className={`tags-square ${tagColorClass(builtIns[id].color)}`}
                            aria-hidden="true"
                          >
                            <Icon name={BUILT_IN_TAGS[id].icon} />
                          </span>
                          <span className="tags-text">
                            <span className="tags-name">
                              {BUILT_IN_TAGS[id].name}
                            </span>
                            {/* Never a song count: how many songs wear this one
                                is a different number for every reader. */}
                            <span className="tags-meta">
                              {builtIns[id].show_in_list
                                ? "per person · shown in list"
                                : "per person"}
                            </span>
                          </span>
                          <Icon name="chevron-right" className="tags-chevron" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
