import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  loginMutation,
  oidcConfigOptions,
  registerMutation,
} from "../api/@tanstack/react-query.gen";
import { errorDetail } from "../errors";
import "./LoginForm.css";

/** Mirrors the backend's constraints so the obvious mistakes never leave the browser. */
const MIN_PASSWORD_LENGTH = 8;
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 32;

const MESSAGES: Record<string, string> = {
  duplicate_username: "That name is taken. Log in instead?",
  invalid_credentials: "Wrong name or password.",
};

interface Props {
  /**
   * A failed SSO round trip, already in words (see `User.tsx`, which owns the
   * `?login=` parameter the provider sends the browser back with).
   */
  ssoError?: string | null;
}

/** Login and registration; the first account ever created becomes the admin. */
export default function LoginForm({ ssoError = null }: Props) {
  const queryClient = useQueryClient();
  // Public on purpose: nobody is logged in yet when the page asks whether to
  // offer the button.
  const oidc = useQuery(oidcConfigOptions()).data;
  const [registering, setRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Everything on the page depends on who the browser is, so nothing keeps its
  // cached answer: the guest's song list is not the user's song list.
  const onSuccess = (): void => {
    setError(null);
    setPassword("");
    void queryClient.invalidateQueries();
  };

  const onError = (cause: unknown): void =>
    setError(
      MESSAGES[errorDetail(cause) ?? ""] ??
        (registering ? "Could not create the account." : "Could not log in."),
    );

  const logIn = useMutation({ ...loginMutation(), onSuccess, onError });
  const signUp = useMutation({ ...registerMutation(), onSuccess, onError });
  const pending = logIn.isPending || signUp.isPending;

  const name = username.trim();
  const localError =
    name.length > 0 && name.length < MIN_USERNAME_LENGTH
      ? `The name needs at least ${MIN_USERNAME_LENGTH} characters.`
      : password.length > 0 && password.length < MIN_PASSWORD_LENGTH
        ? `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`
        : null;

  const submit = (): void => {
    if (localError) return;
    const body = { username: name, password };
    if (registering) signUp.mutate({ body });
    else logIn.mutate({ body });
  };

  return (
    <form
      className="login-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {/* Tabs, not two buttons: "Log in" is also the submit label, and a mode
          switch that reads as a second submit button confuses everyone. */}
      <div className="login-tabs" role="tablist">
        {[false, true].map((mode) => (
          <button
            key={String(mode)}
            type="button"
            role="tab"
            className={registering === mode ? "active" : ""}
            aria-selected={registering === mode}
            onClick={() => {
              setRegistering(mode);
              setError(null);
            }}
          >
            {mode ? "Register" : "Log in"}
          </button>
        ))}
      </div>

      <input
        className="text-input"
        value={username}
        placeholder="Name"
        aria-label="Name"
        autoComplete="username"
        maxLength={MAX_USERNAME_LENGTH}
        onChange={(event) => setUsername(event.target.value)}
      />
      <input
        className="text-input"
        type="password"
        value={password}
        placeholder="Password"
        aria-label="Password"
        autoComplete={registering ? "new-password" : "current-password"}
        onChange={(event) => setPassword(event.target.value)}
      />

      {(localError ?? error) && (
        <p className="error-notice" role="alert">
          {localError ?? error}
        </p>
      )}

      <button
        type="submit"
        className="button button-primary"
        disabled={pending || name === "" || password === "" || !!localError}
      >
        {registering ? "Create account" : "Log in"}
      </button>

      {registering && (
        <p className="login-hint">
          Registering keeps your scores: an existing player with the same name
          becomes yours.
        </p>
      )}

      {/* Outside the `enabled` gate: an admin who switched SSO off mid-flow
          still owes the browser coming back an explanation. */}
      {ssoError && (
        <p className="error-notice" role="alert">
          {ssoError}
        </p>
      )}

      {oidc?.enabled && (
        <>
          <div className="login-divider">or</div>
          {/* A plain link, not a fetch: the provider answers with a redirect to
              its own login page, which only a full navigation can follow. */}
          <a className="button login-sso" href="/api/v1/auth/oidc/login">
            Sign in with {oidc.display_name}
          </a>
        </>
      )}
    </form>
  );
}
