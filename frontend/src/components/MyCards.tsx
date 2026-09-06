import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CardRead } from "../api";
import {
  claimCardMutation,
  forgetCardMutation,
  listMyCardsOptions,
  listMyCardsQueryKey,
  listUnknownCardsOptions,
  listUnknownCardsQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { errorDetail, errorMessage } from "../errors";
import { useSelectorStatus } from "../hooks/useSelectorStatus";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import ConfirmModal from "./ConfirmModal";
import { Icon } from "./icons";
import "./MyCards.css";

/** The one refusal a claim can meet that the reader can do something about:
 *  somebody was faster, or the card was already theirs before tonight. */
const CARD_TAKEN = "Somebody else already holds that card.";

/**
 * The cards on the reader's own page: what is lying on the player selector
 * right now and belongs to nobody, and what already belongs to them.
 *
 * Identity, not a capability (`player-selector.md` §11.2): claiming a card is
 * the same kind of act as changing your own picture, so nothing here is gated
 * on `devices.manage`. The host's own list of every card in the party is the
 * admin page's, behind that right.
 *
 * The block is drawn for a signed-in account and for nobody else — the host
 * session is a browser, not a person, and has no player to put a card on — and
 * it is drawn at all only where there is something to say: a selector in the
 * room, or cards this account already holds. A party without a device never
 * meets it.
 */
export default function MyCards() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  // The host session has `auth.user === null` and would be answered 401 by
  // `/devices/cards/mine`. Checked here rather than trusted to the page, so the
  // component is safe to mount anywhere.
  const signedIn = auth.loaded && auth.user !== null;

  const selector = useSelectorStatus();
  const unknown = useQuery({
    ...listUnknownCardsOptions(),
    enabled: signedIn,
  });
  const mine = useQuery({ ...listMyCardsOptions(), enabled: signedIn });

  const [forgetting, setForgetting] = useState<CardRead | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = (): void => {
    for (const key of [listUnknownCardsQueryKey(), listMyCardsQueryKey()])
      void queryClient.invalidateQueries({ queryKey: key });
  };

  // A card put down on the selector reaches this page without a reload: the
  // report path broadcasts on every state change, which is exactly the moment
  // a new uid becomes claimable.
  useWingmanEvent("devices.changed", refresh);

  const claim = useMutation({
    ...claimCardMutation(),
    onSuccess: () => {
      setNotice(null);
      refresh();
    },
    onError: (cause) =>
      setNotice(
        errorDetail(cause) === "card_taken"
          ? CARD_TAKEN
          : // `no_player` cannot reach a signed-in account that sings as
            // somebody, and a 401 means the session went while the page stood
            // open: neither is worth a sentence of its own.
            errorMessage(cause, "Could not claim that card."),
      ),
  });

  const forget = useMutation({
    ...forgetCardMutation(),
    onSettled: () => setForgetting(null),
    onSuccess: () => {
      setNotice(null);
      refresh();
    },
    onError: (cause) =>
      setNotice(errorMessage(cause, "Could not forget that card.")),
  });

  const held = mine.data?.cards ?? [];
  const loose = unknown.data?.uids ?? [];

  if (!signedIn) return null;
  // Nothing until both answers are in: a block that appears a request late is
  // worse than one that appears a moment later, and "you have no cards" must
  // never be said on the strength of an unanswered request.
  // `unknown.isPending` and not `unknown.data === undefined`: a failed listing
  // of the loose cards must not take the reader's own cards off the page with
  // it, but one still in flight would draw the invitation for a request and
  // then replace it with a row.
  if (mine.data === undefined || unknown.isPending || !selector.isSuccess)
    return null;
  // A room with no selector in it and an account with no card has no business
  // being told about either.
  if (!selector.online && held.length === 0) return null;

  return (
    <>
      <h2 className="my-cards-title">My cards</h2>
      <p className="section-note">
        A card on the player selector picks you as the singer.
      </p>

      {notice !== null && (
        <p className="error-notice my-cards-notice" role="alert">
          {notice}
        </p>
      )}

      {loose.length === 0 && held.length === 0 && (
        <p className="section-note my-cards-empty">
          Put a card on the player selector to claim it.
        </p>
      )}

      {loose.length > 0 && (
        <ul className="my-cards-list">
          {loose.map((uid) => (
            <li key={uid}>
              <span className="my-cards-row">
                <span className="my-cards-square" aria-hidden="true">
                  <Icon name="card" />
                </span>
                <span className="my-cards-uid">{uid}</span>
                <button
                  type="button"
                  className="button"
                  disabled={claim.isPending}
                  onClick={() => {
                    setNotice(null);
                    claim.mutate({ path: { uid } });
                  }}
                >
                  This is mine
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {held.length > 0 && (
        <ul className="my-cards-list">
          {held.map((card) => (
            <li key={card.uid}>
              <span className="my-cards-row">
                <span className="my-cards-square" aria-hidden="true">
                  <Icon name="card" />
                </span>
                <span className="my-cards-uid">{card.uid}</span>
                <button
                  type="button"
                  className="icon-button icon-button-danger"
                  aria-label="Forget card"
                  title="Forget card"
                  disabled={forget.isPending}
                  onClick={() => {
                    setNotice(null);
                    setForgetting(card);
                  }}
                >
                  <Icon name="close" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {forgetting !== null && (
        <ConfirmModal
          title="Forget this card?"
          message={`Forget card ${forgetting.uid}? It stops selecting you.`}
          confirmLabel="Forget"
          danger
          onConfirm={() => forget.mutate({ path: { uid: forgetting.uid } })}
          onCancel={() => setForgetting(null)}
        />
      )}
    </>
  );
}
