# Let guests in

Everybody at the party uses Wingman from their own phone. There is nothing to
install, and nobody needs an account.

## Scan the code

1. Put the host screen on the TV. See
   [The host screen](../host-screen/index.md).
2. Ask the room to point a phone camera at the QR code under **Scan to join**.
3. Anybody whose camera will not cooperate types the address printed under the
   code into a browser instead.

Guests land on the same Wingman the host is running, on **Home**.

That address is the karaoke PC's address on the local network, never
`localhost`. Wingman works it out itself, so a guest reaches your PC and not
their own phone.

## When the address is wrong

A VPN, a virtual machine adapter, or a second network card can make Wingman
pick the wrong one of your PC's addresses. Set it yourself then.

1. Open **User** > **Settings**.
2. In the **Host** group, type the right address into **Join URL**.
3. Read the line under the field. It names the address the QR code carries
   right now.

The QR code on the TV changes as soon as the setting is saved, with no reload.
Empty the field to let Wingman pick again.

!!! example "One address, three ways to write it"
    Your PC is at 192.168.1.20 and Wingman listens on port 8080. Type
    `192.168.1.20` and Wingman hands out `http://192.168.1.20:8080`, filling in
    the scheme and its own port. `192.168.1.20:8080` and
    `http://192.168.1.20:8080` give the same result. Write a scheme yourself,
    as in `https://party.example`, and Wingman changes nothing. That is how you
    point the code at a reverse proxy.

## Everybody on the same network

- Guests have to be on the same Wi-Fi as the karaoke PC. A phone on mobile data
  cannot reach it.
- Windows asks about the firewall the first time Wingman starts. Allow it, or
  no phone gets through.
- The address carries the port. `http://192.168.1.20:8080` works, plain
  `192.168.1.20` does not.

See [Fix a problem](../help/index.md) when a phone still cannot open Wingman.

## What a guest may do

A guest gets most of the app without an account. By default they may:

- browse and search the song list,
- see the players and start a song with them,
- read the wishlist and add a wish,
- open a playlist somebody shared,
- watch tonight's scores.

Favorites, playlists of their own, their own record of scores, and comments all
need an account. So does opening any party but tonight's. Those are the
defaults, and the host can change what each role may do. See
[Roles and permissions](../people/roles.md).

## The wishes on a guest phone

The first wish somebody makes hands their browser a cookie. It holds one id and
nothing else, no name and no account, and it lasts a year. It is what keeps a
guest's wishes theirs. Register or log in on that same browser and those wishes
come along to the account.
