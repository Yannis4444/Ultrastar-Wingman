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

They tap the button and log in at the provider. The first time, they land back
on the **User** tab and pick the name they sing under. Every login after that
lands them on the **User** tab logged in, with nothing to fill in.

### The first login

Wingman proposes a name and the singer types over it if they want another one.

- The proposal is the provider's username, or the full name, or the part of the
  email address before the `@`. A name Wingman already has becomes *name-2*.
- A name somebody else holds is refused, and the form asks for another one.
  Wingman never quietly renames what a singer typed.
- **Cancel** drops the sign-in and brings the login form back.
- The form stands for 10 minutes. After that the sign-in starts again from the
  button.

Wingman creates nothing until the name is in. While the form is on screen there
is no account yet, and nobody is logged in.

### From then on

- A player of that name is created, or an existing guest player of that name
  becomes theirs. That is the same takeover registering does.
- The name stays. It is picked once, at that first login, and nothing renames
  the account afterwards. Renaming somebody at the provider changes nothing
  here either, so their scores, playlists, and wishes stay theirs.
- Wishes made on that browser as a guest come along.
- The account has no password. The login form lets nobody in under that name,
  and there is nothing to reset.
- **Players & accounts** says *Signs in with* and the button's name under the
  account's name. See [Players and avatars](players.md).

Everything else is normal. It holds a role, it stands in the permissions table,
and it can be deleted. See [Roles and permissions](roles.md).

### The picture

A provider that has a picture of the singer hands it over at every login.
Wingman makes it the player's picture, so a new picture at the provider shows up
here at the next login. The very first login brings it too, once the name is
in.

- A picture somebody uploaded in Wingman wins. From then on no login replaces
  it, whoever uploaded it. The same goes for a guest player's picture that the
  new account takes over.
- An unchanged picture is not downloaded again when the provider can say so.
- A picture that cannot be used leaves the old one in place, and the login goes
  through anyway. The download gets 5 seconds at most, and so does asking the
  userinfo endpoint. The console names the account and says why, as a warning.
- Wingman takes jpeg, png, and webp pictures of at most 5 MB, the same rules as
  an upload. It only follows `http` and `https` addresses.

The picture comes with the `profile` scope, which **OIDC scopes** already holds.
Some providers put it into the login token. For the others Wingman asks the
provider's userinfo endpoint once per login.

!!! warning
    The first account ever created is the administrator, and a single sign-on
    login counts. If the provider lets a whole company in, create your own
    account before you turn the switch on.

## When a login does not work

Nobody is logged in, and Wingman says which of these happened. The last two rows
come from the name form, the rest from the login form.

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
| *That sign-in took too long or was already finished. Try again.* | Pick the name within 10 minutes, in the browser that started |
| *That name is taken. Pick another one.* | Type a name nobody in Wingman holds |
| *Could not finish the sign-in.* | Tap **Create account** again. Read the Wingman console if it keeps happening |
