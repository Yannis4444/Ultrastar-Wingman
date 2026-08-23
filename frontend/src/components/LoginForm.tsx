import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  loginMutation,
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

/** Login and registration; the first account ever created becomes the admin. */
export default function LoginForm() {
  const queryClient = useQueryClient();
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
    </form>
  );
}
