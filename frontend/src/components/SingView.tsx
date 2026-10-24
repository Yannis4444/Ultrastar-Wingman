import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ScoreWithContext, SongRead } from "../api";
import {
  listPlayersOptions,
  readSingOptions,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { cardDate, shortTime } from "../duration";
import { errorMessage } from "../errors";
import { useWingmanEvent, type WingmanEvent } from "../hooks/useWingmanEvents";
import { difficultyLabel } from "../stats";
import { Icon } from "./icons";
import Loading from "./Loading";
import Modal from "./Modal";
import RankedScoreList from "./RankedScoreList";
import { MissingCover } from "./ScoreGroupList";
import ShareCardPanel, { type ShareTarget } from "./ShareCardPanel";
import SongCover from "./SongCover";
import SongDetails from "./SongDetails";
import "./SingView.css";

interface SingViewProps {
  /** The score row that was tapped: the hero stands from it at once, and it
   * is the row the view opens pressed. */
  score: ScoreWithContext;
  onClose: () => void;
}

/** What `scores.changed` carries: the sing a correction touched. */
interface ScoresChanged extends WingmanEvent {
  sing_id: string;
}

/** The second line of a row: how hard it was sung. The day is the view's own
 * line, so it is not repeated per row; no difficulty, no line. */
function difficultyCaption(score: ScoreWithContext): string {
  const difficulty = difficultyLabel(score.difficulty);
  return difficulty === "—" ? "" : difficulty;
}

/**
 * The hero's three: the cover — or the `?` tile of a song that left the
 * library — over the title and the artist. Spans, so the same content fits a
 * `<button>` and a `<div>` alike and nothing moves when the one turns into the
 * other.
 */
function SongHero({ song, title }: { song: SongRead | null; title: string }) {
  return (
    <>
      {song === null ? (
        <MissingCover className="sing-view-cover" />
      ) : (
        <SongCover song={song} className="sing-view-cover" />
      )}
      <span className="sing-view-title">{title}</span>
      {song !== null && <span className="sing-view-artist">{song.artist}</span>}
    </>
  );
}

/**
 * One sing (share-cards §8): what was sung, when, who sang it and what they
 * got — and where a score is shared from. What opens it is a score row on
 * `/scores` or on `/user/stats`; the rows here choose the score the card is
 * of, so a duet partner's score is shared from the same place as your own.
 *
 * A bare modal, the song modal's surface. It reads `GET /stats/sings/{id}`
 * and owns the two modals it opens over itself, the song and the share panel.
 */
export default function SingView({ score, onClose }: SingViewProps) {
  const auth = useAuth();
  const [pressedId, setPressedId] = useState(score.id);
  const [songOpen, setSongOpen] = useState(false);
  // Set once per press of Share, so the panel is handed one stable target and
  // never redraws because this view rendered again.
  const [sharing, setSharing] = useState<ShareTarget | null>(null);

  const sing = useQuery(readSingOptions({ path: { sing_id: score.sing_id } }));
  // A moderator moving or deleting one of these scores while the view is open.
  useWingmanEvent<ScoresChanged>("scores.changed", (message) => {
    if (message.sing_id === score.sing_id) void sing.refetch();
  });

  // For the avatars and the card's pictures. A singer without a player record,
  // or a reader who may not list players, still gets the initial.
  const playerList = useQuery({
    ...listPlayersOptions(),
    enabled: auth.loaded && auth.can("players.view"),
  });
  const players = new Map(
    (playerList.data?.players ?? []).map((player) => [player.id, player]),
  );

  const detail = sing.data;
  // The tapped row until the read is in; the read from then on.
  const song = detail === undefined ? score.song : detail.song;
  const title = song?.title ?? "Unknown song";
  const listed = detail?.song_listed === true && detail.song !== null;
  const started = detail?.started_at ?? score.sing_started_at;
  const partyName = detail?.session?.name?.trim() ?? "";
  // A nameless party, or a sing from before parties were recorded, is the
  // date alone: the line already says when (share-cards §8).
  const when = [
    `${cardDate(started)}, ${shortTime(started)}`,
    ...(partyName === "" ? [] : [partyName]),
  ].join(" · ");

  const scores = detail?.scores ?? [];
  // The score the card will be of: the one tapped, or — should a correction
  // have taken it off the record meanwhile — the sing's best.
  const chosen =
    scores.find((entry) => entry.id === pressedId) ?? scores[0] ?? null;

  return (
    <>
      <Modal title={`Sing of ${title}`} hideTitle bare onClose={onClose}>
        <div className="sing-view">
          <div className="sing-view-hero">
            {/* Cover, title and artist are one way into the song modal — the
                cover a second door to the one action, never a second control
                (share-cards §8). Listed implies a song, so the `?` tile of a
                song that left the library is never inside the button. */}
            {listed ? (
              <button
                type="button"
                className="sing-view-song"
                aria-label={title}
                onClick={() => setSongOpen(true)}
              >
                <SongHero song={song} title={title} />
              </button>
            ) : (
              <div className="sing-view-song">
                <SongHero song={song} title={title} />
              </div>
            )}
            <p className="sing-view-when">{when}</p>
          </div>

          <div className="sing-view-scores">
            {sing.isPending ? (
              <Loading />
            ) : sing.isError ? (
              <p className="error-notice sing-view-error" role="alert">
                {errorMessage(sing.error, "Could not load this sing.")}
              </p>
            ) : scores.length === 0 ? (
              <p className="section-note sing-view-empty">
                Every score of this sing was taken off the record.
              </p>
            ) : (
              <RankedScoreList
                scores={scores}
                players={players}
                label="Who sang"
                caption={difficultyCaption}
                // The stored place, never a recount; a solo sing is not a win,
                // so a sing of one score has no rank at all.
                rank={(entry) => (scores.length === 1 ? null : entry.placement)}
                pressed={{
                  id: chosen?.id ?? null,
                  onPress: (entry) => setPressedId(entry.id),
                }}
                ownPlayerId={auth.user?.player_id ?? null}
              />
            )}
          </div>

          {/* Not while the rows' place holds a refusal: a refetch that fails
              keeps the last answer in `data`, and Share beside the notice
              would share a sing the reader may no longer open. */}
          {detail !== undefined && !sing.isError && chosen !== null && (
            <div className="sing-view-actions">
              <button
                type="button"
                className="button sing-view-share"
                onClick={() =>
                  setSharing({
                    kind: "score",
                    score: chosen,
                    session: detail.session,
                    singScores: detail.scores,
                  })
                }
              >
                <Icon name="share" />
                Share
              </button>
            </div>
          )}
        </div>
      </Modal>

      {songOpen && detail !== undefined && detail.song !== null && (
        <SongDetails song={detail.song} onClose={() => setSongOpen(false)} />
      )}

      {sharing !== null && (
        <ShareCardPanel
          target={sharing}
          players={players}
          onClose={() => setSharing(null)}
        />
      )}
    </>
  );
}
