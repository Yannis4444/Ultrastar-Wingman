import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  completeOidcLoginMutation,
  forgetOidcLoginMutation,
} from "../api/@tanstack/react-query.gen";
import { errorDetail } from "../errors";
// The same surface in another step: this form stands exactly where the login
// form stands, so it wears the login form's tile rather than a second one
// (ui-guidelines.md §1.2 whitelists that tile, and this is it).
import "./LoginForm.css";

/** Mirrors the backend's constraints so the obvious mistakes never leave the browser. */
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 32;

/** The refusal the form can do something about by asking for another name. */
const TAKEN = "duplicate_username";

/**
 * The two that end the round trip: there is nothing left to name, so the page
 * takes over and says so. Anything else — a 500, a dropped connection, a body
 * this frontend has no slug for — leaves the pending login standing, and a
 * form that vanished over it would throw away a sign-in that still works.
 */
const LOST = ["no_pending_login", "oidc_disabled"];

interface Props {
  /**
   * The name the account would have been given without asking — free at the
   * moment the provider answered, so the field opens on one that works.
   */
  preset: string;
  /** Give up on the name: the pending login is dropped and the page moves on. */
  onCancel: () => void;
  /**
   * The pending login is gone (it expired, or an admin switched SSO off while
   * this was on screen). The slug is one of `User.tsx`'s SSO messages.
   */
  onLost: (slug: string) => void;
}

/**
 * The last step of a first sign-on: what to call the account.
 *
 * The provider's idea of somebody's name is only a proposal here. The name is
 * what players, scores and playlists hang off afterwards, which is why this is
 * asked once and never again.
 */
export default function ChooseNameForm({ preset, onCancel, onLost }: Props) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(preset);
  const [error, setError] = useState<string | null>(null);

  const complete = useMutation({
    ...completeOidcLoginMutation(),
    // Everything on the page depends on who the browser is, and it just became
    // somebody: the guest's song list is not the account's song list.
    onSuccess: () => void queryClient.invalidateQueries(),
    onError: (cause: unknown) => {
      const detail = errorDetail(cause);
      if (detail === TAKEN) setError("That name is taken. Pick another one.");
      else if (detail !== null && LOST.includes(detail)) onLost(detail);
      else setError("Could not finish the sign-in.");
    },
  });
  const giveUp = useMutation({
    ...forgetOidcLoginMutation(),
    // A pending login nobody can reach any more is the same as none: the page
    // goes back to the login form either way.
    onSettled: onCancel,
  });
  const pending = complete.isPending || giveUp.isPending;

  const name = username.trim();
  const localError =
    name.length > 0 && name.length < MIN_USERNAME_LENGTH
      ? `The name needs at least ${MIN_USERNAME_LENGTH} characters.`
      : null;

  return (
    <form
      className="login-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (localError) return;
        setError(null);
        complete.mutate({ body: { username: name } });
      }}
    >
      {/* Not "you are signed in": there is no account yet and no session —
          that is what this form is for, and saying otherwise would make the
          Cancel button next to it read as a logout. */}
      <p className="login-hint">
        That sign-in worked. Pick the name you sing under.
      </p>

      <input
        className="text-input"
        value={username}
        // The field opens filled in, so this is only ever read by somebody who
        // cleared it — the login form's own empty state, in its own word.
        placeholder="Name"
        aria-label="Your name"
        autoComplete="username"
        maxLength={MAX_USERNAME_LENGTH}
        onChange={(event) => {
          setUsername(event.target.value);
          setError(null);
        }}
      />

      <p className="login-hint">
        Your scores are saved under this name, and it cannot be changed later.
      </p>

      {(localError ?? error) && (
        <p className="error-notice" role="alert">
          {localError ?? error}
        </p>
      )}

      <button
        type="submit"
        className="button button-primary"
        disabled={pending || name === "" || !!localError}
      >
        Create account
      </button>
      <button
        type="button"
        className="button"
        disabled={pending}
        onClick={() => giveUp.mutate({})}
      >
        Cancel
      </button>
    </form>
  );
}
