# Single sign-on

Wingman can put a sign-in button under the login form and let a login provider
answer for it. Local accounts keep working next to it. This is a second way in,
never a replacement.

Setting it up needs the right to change the settings, which Admin holds. It
takes a provider that speaks OpenID Connect and offers PKCE. Keycloak is one.

## Register Wingman at the provider

1. Create a client for the authorization code flow with PKCE.
2. Register one redirect address: the address your singers use, plus
   `/api/v1/auth/oidc/callback`.
3. Leave the client public, or note its secret for the next step.

Register that one address and no wildcard. Wingman builds the redirect from the
address the browser asked it under. The exact list at the provider is what keeps
a login code from going anywhere else.

!!! example "The redirect address"
    Your guests open Wingman at `http://192.168.1.50:8080`. Then the redirect
    address is `http://192.168.1.50:8080/api/v1/auth/oidc/callback`, and that
    exact string is what the provider has to hold.

## Fill in the settings

Open **User** > **Settings** and the **Auth** group.

1. Type the issuer URL into **OIDC issuer**. Wingman reads everything else from
   `<issuer>/.well-known/openid-configuration`.
2. Type the client id into **OIDC client ID**.
3. Type the client secret into **OIDC client secret**, or leave it empty for a
   public client. Wingman always sends PKCE.
4. Name the button in **OIDC display name**. It reads *Sign in with* and this
   value, and starts at *SSO*.
5. Turn **OIDC enabled** on.

**OIDC scopes** sits behind **Advanced** and holds `openid profile`. Add `email`
so the address can stand in when the provider sends no username and no name.

The button appears under the login form as soon as it can work, which takes the
switch, an issuer, and a client id. Until then the room only sees the normal
form. See [All settings](../settings/reference.md).

## What a singer gets

They tap the button, log in at the provider, and land back on the **User** tab
logged in.

- The account is named after the provider's username, or the full name, or the
  part of the email address before the `@`. A name Wingman already has becomes
  *name-2*.
- A player of that name is created, or an existing guest player of that name
  becomes theirs. That is the same takeover registering does.
- The name then stays. Renaming somebody at the provider changes nothing here,
  so their scores, playlists, and wishes stay theirs.
- Wishes made on that browser as a guest come along.
- The account has no password. The login form lets nobody in under that name,
  and there is nothing to reset.

Everything else is normal. It holds a role, it stands in the permissions table,
and it can be deleted. See [Roles and permissions](roles.md).

!!! warning
    The first account ever created is the administrator, and a single sign-on
    login counts. If the provider lets a whole company in, create your own
    account before you turn the switch on.

## When a login does not work

Nobody is logged in, and the login form says which of these happened.

| What you read | What to do |
|---|---|
| *Single sign-on is switched off. Log in with a name instead.* | Turn **OIDC enabled** back on |
| *The login provider refused the sign-in.* | Check the account at the provider |
| *That sign-in came back incomplete. Try again.* | Start again from the button |
| *That sign-in took too long or was already used. Try again.* | Finish within 10 minutes, in the browser that started |
| *Wingman could not reach the login provider. Ask the host to check the SSO settings.* | Check **OIDC issuer** and the network |
| *The login provider did not finish the sign-in. Try again.* | Check **OIDC client ID** and the secret |
| *The login provider's answer could not be trusted, so nobody was logged in.* | Check that the client id matches the one the token is for |
| *The sign-in did not work. Try again.* | Read the Wingman console for the reason |
