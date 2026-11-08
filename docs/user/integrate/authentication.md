# Authenticate a script

A script talks to Wingman as an account. Log in once, keep the cookie you get
back, and send it with every request after that.

## Log in and keep the cookie

1. Register an account for your script, or use one somebody made for it.
2. Send the name and password to `POST /api/v1/auth/login` as JSON, under the
   fields `username` and `password`.
3. Read the `wingman_session` cookie out of the response. The body carries the
   account, not the token.
4. Send that cookie back on every later request.

The cookie is `HttpOnly`, it covers the whole site at path `/`, and it lasts 90
days. The session behind it slides forward while your script keeps calling, so
a bot that runs every weekend stays logged in. Log in again whenever a request
answers `401`.

Wrong name or wrong password is `401` with `invalid_credentials`. Wingman
answers the same way for both, so a probe learns nothing.

!!! example "Log in, then ask who you are"
    A cookie jar is all the session handling a script needs.

    ```bash
    curl -c wingman.jar -X POST http://localhost:8080/api/v1/auth/login \
      -H "Content-Type: application/json" \
      -d '{"username": "overlay-bot", "password": "<the password>"}'

    curl -b wingman.jar http://localhost:8080/api/v1/auth/me
    ```

    `GET /auth/me` answers with your account, your groups, and the exact list of
    capabilities you hold. Call it first when a request is refused.

## Register the account and give it a role

`POST /api/v1/auth/register` takes the same two fields, creates the account,
and logs it in. A name is 3 to 32 characters, and a password is at least 8.
A name somebody already took is `409` with `duplicate_username`.

!!! warning
    A script that registers before anybody else becomes the administrator. The
    first account on an install always does, and a host who only ever used the
    host screen has no account yet. Have the host register their own account
    before the bot gets one.

A new account holds the `user` role. An administrator changes that on **User** >
**Players & accounts**. Over the API it is a `PUT` to
`/api/v1/users/{user_id}/groups` with the account's whole list of `groups`,
and it takes `users.manage`.

Give the script the smallest role that covers what it does. See
[Roles and permissions](../people/roles.md) for what the four roles are for,
and **User** > **Permissions** for the exact rights each one holds today.

## A guest cookie

A caller with no session is the `guest` role rather than a rejected request. By
default a guest may read the song list, see the players, and start a song. They
may also read the wishlist, add a wish, open a shared playlist, and watch
tonight's scores.

Wishing hands out a second cookie. The first wish from a client that has none
gets `wingman_guest`, which holds one id, no name, and lasts a year. It is what
makes those wishes yours, so a script that wishes has to keep it to take a wish
back. Log in on a client holding that cookie and the wishes come along to the
account.

## The host token

The browser Wingman opens on the karaoke PC at startup carries a one-time token
that makes that one browser an administrator. The token works once, and the next
start mints a new one. That makes it useless to a script, so log in with an
account instead.

Logging in through an identity provider is for people at a browser, not for
scripts. See [Single sign-on](../people/single-sign-on.md).

## When a request is refused

`401` and `403` mean different things, and the body says which.

- `401` with `not_authenticated`: the route wants an account and your cookie is
  missing, expired, or points at an account that was deleted. Log in again.
- `403` with `missing_permission:<capability>`: your role does not hold that
  right. `missing_permission:settings.view` names it exactly. An administrator
  grants it to your role on **User** > **Permissions**.
- `404` on a song you know is there: a tag hides it from you. It answers
  the same as an unknown id on purpose.

## Log out

`POST /api/v1/auth/logout` ends the session and clears the cookie. It answers
`204`, and `401` with `not_authenticated` when you were not logged in. A script
that runs on a schedule has no reason to call it.
