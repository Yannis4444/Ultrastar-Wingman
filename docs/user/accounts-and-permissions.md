# Accounts and permissions

Wingman is built for a party: a guest needs no account to browse, wish and sing.
Accounts exist for the things that belong to one person, and for the rights the
host hands out.

## Register and log in

Open the **User** tab and use the form.

- The username is 3 to 32 characters, and may contain anything — a guest who sang
  as "Jörg" can register under exactly that name and keeps their scores.
- The password is at least 8 characters.
- Registering creates a player of the same name at once, so you can sing.

You stay logged in for 90 days, and every visit pushes that further out. A host
does not have to log in again next weekend.

!!! warning
    The very first account ever created is the administrator. There is nobody who
    could have granted it — so create it yourself, before the party.

## Your own page

Once you are logged in, the **User** tab shows you instead of the login form.

- **Tap your picture** to change it — the same jpeg, png or webp upload as for
  any other player (see [Singing](singing.md)). Your picture then replaces the
  generic icon on the User tab itself, so you can see at a glance who this phone
  is logged in as.
- Under your name stand your totals over every party you ever sang at: how many
  performances were scored, your best score, your average, how many different
  songs you sang and how many songs you marked as favorites.

A singer who has not been scored yet gets an invitation to sing instead of a row
of zeroes.

## Log in with single sign-on (Keycloak and friends)

If you already run a login server — Keycloak, Authentik, Entra, anything that
speaks OpenID Connect — Wingman can put a **Sign in with …** button under the
login form. Local accounts keep working next to it; this is an extra way in, not
a replacement.

**1. Register Wingman at your provider.** Create a client with the authorization
code flow and PKCE, and register exactly one redirect URI: the address your
singers use, plus `/api/v1/auth/oidc/callback`. For a Wingman on
`http://192.168.1.50:8080` that is

```
http://192.168.1.50:8080/api/v1/auth/oidc/callback
```

!!! warning
    Register that one exact address, never a wildcard like `http://*/…`. Wingman
    builds the redirect address from the address the browser asked it under, and
    the exact-match list at your provider is what makes sure a login code can
    only ever come back to Wingman itself.

**2. Fill in the settings** under **User → Settings → Auth**:

| Field | What to put in |
|---|---|
| **OIDC enabled** (`auth.oidc_enabled`) | Tick it to show the button. |
| **OIDC issuer** (`auth.oidc_issuer`) | The issuer URL, e.g. `https://keycloak.example/realms/party`. Wingman reads everything else from `<issuer>/.well-known/openid-configuration`. |
| **OIDC client ID** (`auth.oidc_client_id`) | The client id you registered Wingman as. |
| **OIDC client secret** (`auth.oidc_client_secret`) | The client secret. Leave it empty for a public client — Wingman always uses PKCE. Stored but never shown again, like the USDB password. |
| **OIDC display name** (`auth.oidc_display_name`) | What the button is called: *Sign in with **this***. Default *SSO*. |
| **OIDC scopes** (`auth.oidc_scopes`) | Space-separated scopes. Default `openid profile`; add `email` if the name should be taken from the email address. |

The button appears as soon as it can actually work — switched on, with an issuer
and a client id. Until then, and after you switch it off again, guests only see
the normal login form.

**What a singer gets.** They press the button, log in at your provider, and come
back to the **User** tab logged in:

- The account is named after the provider's username (or the full name, or the
  part of the email address before the `@`). If a Wingman account already has
  that name, the new one becomes *name-2*.
- A player of that name is created at once, or an existing guest player of that
  name is taken over — the same as registering.
- That name then stays. Renaming someone at the provider does not rename them
  here, so their scores, playlists and wishes stay theirs.
- The account has no password. The login form will never let anybody in under
  that name, and there is nothing to reset.
- Everything else is normal: roles, the permission table, deleting the account.

If something goes wrong on the way back — the provider refused, the settings
point nowhere, the sign-in sat around too long — the login form says so in one
line and nobody is logged in.

!!! warning
    The first account created is the administrator, and an SSO login counts. If
    your provider lets a whole company in, create your own account **before**
    switching single sign-on on, or the first colleague who tries it owns your
    party.

## The host screen

The browser the host opened with the one-time host link is not an account. It is a
session with full administrator rights, marked *This browser is the host screen —
full access* on the **User** tab. It may change every setting, but it cannot own
favorites or playlists — those need a real account.

## The four roles

| Role | Who has it |
|---|---|
| **guest** | Everybody without an account, including every guest phone |
| **user** | Every new account |
| **trusted** | Given out by the host to helpers |
| **admin** | The first account, plus whoever the host promotes |

What each role may do by default:

| | guest | user | trusted | admin |
|---|---|---|---|---|
| See the song list | yes | yes | yes | yes |
| See the players | yes | yes | yes | yes |
| Start a song | yes | yes | yes | yes |
| See and add wishes | yes | yes | yes | yes |
| See playlists | yes | yes | yes | yes |
| See the statistics | yes | yes | yes | yes |
| Stop a running song | – | yes | yes | yes |
| Add, change and delete players | – | yes | yes | yes |
| Create and edit own playlists | – | yes | yes | yes |
| Search USDB | – | – | yes | yes |
| See and start downloads | – | – | yes | yes |
| Rescan the song folders | – | – | yes | yes |
| Rename a party in the statistics | – | – | yes | yes |
| See and change the settings | – | – | – | yes |
| Manage users | – | – | – | yes |
| Change these permissions | – | – | – | yes |

Favorites are in no row on purpose: they belong to whoever made them, and there is
nothing for an administrator to grant.

## Manage users

An administrator gets an **Accounts** page under **User → Accounts**: every
account with its role, and a way to change it or delete it.

- A role can be set to **user**, **trusted** or **admin**. Nobody is put back to
  **guest** — that is the role for people without an account. Take the account
  away instead.
- The last administrator cannot be demoted or deleted. Wingman would lock
  everybody out.
- Deleting an account keeps its player and its scores, under the same name, and
  removes its wishes, favorites and playlists.

## Change what a role may do

**User → Permissions** is the table above made editable. Pick **guest**,
**user** or **trusted** at the top, then tick or untick what that role may do.
Every tick is saved right away and takes effect immediately, for everybody who
is already looking at a page.

Useful in practice:

- A quiet party: untick *Start a song* for **guest** so only accounts start songs.
- A helper who should download songs: give their account the **trusted** role, or
  tick the download rights for **user**.

!!! note
    The **admin** row cannot be changed. An administrator always holds every
    right, so no mistake in this table can lock the host out of their own app.
