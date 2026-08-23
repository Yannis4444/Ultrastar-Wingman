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

An administrator gets a **Users** panel on the **User** tab: every account with
its role, and a way to change it or delete it.

- A role can be set to **user**, **trusted** or **admin**. Nobody is put back to
  **guest** — that is the role for people without an account. Take the account
  away instead.
- The last administrator cannot be demoted or deleted. Wingman would lock
  everybody out.
- Deleting an account keeps its player and its scores, under the same name, and
  removes its wishes, favorites and playlists.

## Change what a role may do

The **Permissions** matrix, also on the **User** tab, is the table above made
editable. Tick or untick what **guest**, **user** and **trusted** may do. Every
tick is saved right away and takes effect immediately, for everybody who is
already looking at a page.

Useful in practice:

- A quiet party: untick *Start a song* for **guest** so only accounts start songs.
- A helper who should download songs: give their account the **trusted** role, or
  tick the download rights for **user**.

!!! note
    The **admin** row cannot be changed. An administrator always holds every
    right, so no mistake in this table can lock the host out of their own app.
