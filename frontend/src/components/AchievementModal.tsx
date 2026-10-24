import { useMemo, useState } from "react";
import type { PlayerAchievementRead, PlayerRead } from "../api";
import {
  achievementDescription,
  achievementName,
  holdersLine,
  isMasked,
} from "../achievements";
import { cardDate } from "../duration";
import AchievementBadge from "./AchievementBadge";
import AchievementProgress from "./AchievementProgress";
import { Icon } from "./icons";
import Modal from "./Modal";
import ShareCardPanel, { type ShareTarget } from "./ShareCardPanel";
import "./AchievementModal.css";

/** The reader, on their own record: their player row where the page read it
 * (`null` draws their initial on the card) and the name the page writes. */
export interface AchievementSharer {
  player: PlayerRead | null;
  name: string;
}

/** The card's one face is the sharer's, handed over apart: no roster. */
const NO_PLAYERS = new Map<string, PlayerRead>();

/**
 * One achievement, large: what a badge on the user page opens (ui-guidelines
 * §5). The picture at the song hero's size, the name, the sentence, and then
 * the facts: how many hold it, and the one line the row already carries — the
 * day it was earned, or the bar beside its "7 / 10".
 *
 * Bare, like the song modal and for the same reason: a picture wants the page
 * behind it darkened and blurred, not a tile drawn around it. The blur is
 * `Modal`'s own `bare` backdrop, not a second copy of it.
 *
 * It takes the record row rather than the achievement and the row separately —
 * the row carries its own `achievement`, which is what the list beside it draws
 * from too, so there is one thing to hand over and no way to pair the wrong two.
 *
 * Under the sentence, set apart as facts by a gap and a step down in size
 * rather than a hairline, the meta group: how many players hold it ("Earned by
 * 3 players") — a line this modal alone carries, never the rows it opens from —
 * then the day or the bar.
 *
 * A **masked** one is a bigger place to say the same nothing: the `lock` badge
 * over the stand-in name and sentence, and no bar and no holders line at all.
 *
 * On the reader's own record (`sharer`), an earned one ends in *Share*, its
 * one control, which opens the share panel on the achievement card over the
 * modal (share-cards §10).
 */
export default function AchievementModal({
  row,
  sharer,
  onClose,
}: {
  row: PlayerAchievementRead;
  /**
   * Who the record is, when it is the reader's own — the user page's record,
   * and only that: its presence is what offers *Share*. Left out by a
   * surface showing somebody else's record or the catalogue.
   */
  sharer?: AchievementSharer;
  onClose: () => void;
}) {
  const achievement = row.achievement;
  const earned = row.earned_at !== null;
  const [sharing, setSharing] = useState(false);
  // An earned one of the reader's own (share-cards §10): a masked row is one
  // nobody has earned, and one still out there is nothing to send around. A
  // switched-off one is no badge either: the record can still carry its row
  // until the pass the switch started has dropped it.
  const shareable =
    sharer !== undefined &&
    earned &&
    achievement.enabled &&
    !isMasked(achievement);
  // One target for as long as its parts hold still, so the panel works its
  // card out again only when the row or the sharer really changed.
  const player = sharer?.player ?? null;
  const name = sharer?.name ?? "";
  const target = useMemo<ShareTarget | null>(
    () => (shareable ? { kind: "achievement", row, player, name } : null),
    [shareable, row, player, name],
  );
  // The API blanks the count on a masked row, and `holdersLine` says so a
  // second time, the way the bar below does.
  const holders = holdersLine(achievement);
  // The API nulls both numbers on a masked row, and this says so a second
  // time: a modal is never a way around the masking. The bar itself draws
  // nothing where either number is missing.
  const showProgress =
    !earned &&
    !isMasked(achievement) &&
    row.progress_current !== null &&
    row.progress_target !== null;
  // The facts under the sentence, drawn only when there is one: an empty
  // group would still put its gap under the description.
  const meta = holders !== null || earned || showProgress;

  return (
    <>
      <Modal
        title={achievementName(achievement)}
        hideTitle
        bare
        onClose={onClose}
      >
        <div className="achievement-modal">
          <AchievementBadge
            achievement={achievement}
            earned={earned}
            // The full-resolution picture, asked for here and nowhere else. The
            // component only exists while the modal is open, so the megabyte is
            // fetched when somebody asks to see the badge and never before.
            resolution="full"
            className="achievement-modal-badge"
          />
          <h3 className="achievement-modal-name">
            {achievementName(achievement)}
          </h3>
          <p className="achievement-modal-description">
            {achievementDescription(achievement)}
          </p>
          {meta && (
            <div className="achievement-modal-meta">
              {holders !== null && (
                <p className="achievement-modal-holders">{holders}</p>
              )}
              {row.earned_at !== null ? (
                <p className="achievement-modal-earned">
                  Earned {cardDate(row.earned_at)}
                </p>
              ) : (
                showProgress && (
                  <AchievementProgress
                    current={row.progress_current}
                    target={row.progress_target}
                  />
                )
              )}
            </div>
          )}
          {shareable && (
            <button
              type="button"
              className="button achievement-modal-share"
              onClick={() => setSharing(true)}
            >
              <Icon name="share" />
              Share
            </button>
          )}
        </div>
      </Modal>
      {/* Over the modal, not instead of it: closing the panel comes back here,
        and the focus back onto Share. */}
      {sharing && target !== null && (
        <ShareCardPanel
          target={target}
          players={NO_PLAYERS}
          onClose={() => setSharing(false)}
        />
      )}
    </>
  );
}
