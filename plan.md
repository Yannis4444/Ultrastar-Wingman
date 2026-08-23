I want to basically rewrite the project at D:\git\ultrastar-wingman. Same name, same basic functionality.
Treat that project as a general idea, not as the ground-truth.
Do not blindly copy the code from there, think about how to improve it.
If anything in there is not good enough, rewrite it.

Before starting with any implementation, create a detailed plan of what to do.
Divide it into features and plan the correct order of implementation.

Discuss the plan with the user before starting.

Make sure to create good guidelines for the project to ensure excellent code quality.
Write tests for everything important.

# General guidelines

Write this down for later to always adhere to these guidelines

- Stick to all standards of good software design. Write guides for how to write code to be adhered to for all the implementation.
- Use conventional commits, commit in sensible chunks, never sign commits as claude.
- Use good branching for features and stuff.
- Make the software modular. Things like song sources and starting a song in Ultrastar Deluxe should be written so they can easily be swapped out or additional sources can be added.
- write good documentation for everything. Mainly user-facing stuff. Create a guideline for good documentation before starting with it. Use markdown to be used with zensical.
- before writing a new feature, plan it out and think about how to integrate it into the project.
- When you have good ideas of how to improve a feature, discuss them with the user.

# Ultrastar Deluxe

Ultrastar Deluxe is the application actually handling the karaoke part.
It is a bit weird in some aspects and interacting with it can be challenging.
Take a look at the other project for how integration can be done.

Feel free to improve anything about that integration if possible.

# UI

I like the general current design of the UI. Stick with it.

Feel free to update the structure to match current best practices.

# Integrations / Song sources

These are the current sources that songs can be gotten from (some of them are not finished).

In general, the source of the songs should be open and expandable.
Design it so that in the future, other sources like USDB can be added.

It is important that songs can be identified correctly.
The current id system is ok, but think about it and improve it if it makes sense.

## USDB

Keep the integration of usdb.animux.de.

The User integration probably needs some reworking.

## Spotify integration

drop this, it is no longer feasible with the new API

## Ultra Singer

For now leave this out, we might revisit it later.

# yt-dlp

For the song downloads, yt-dlp is used.
Currently, it is often outdated and needs updating.
Can we make it auto-update?

# Accounts

I want to support user accounts.
Both locally managed and optionally through a third-party service like keycloak (OIDC).

I also need permissions for different parts of the app.
Some groundwork for this was already done, but it should probably be remade.

The Host UI shown on the TV where Ultrastar Deluxe is running should always have admin access.

# Settings

Currently, the settings are pretty simple and only stored in a file.

Create a UI section for the settings.
Make it expandable so that more settings can be added later.

# Song List

The current song list is pretty simple.

I would like to add stuff like personal and shared playlists, favorites, etc.

Some of this will have to be linked to the user.

# Randomizer

I really like the casino-style spinner wheel on the front page.

# Statistics

I want to get as much data as possible for statistics.

Currently, some stats are collected, but they are partially stored by Ultrastar Deluxe which comes with downsides.
I want to use a different system.
Create a new database for statistics with identifiers for songs and players.
Use good user ids and song ids.

For the UI stick to something like the current state. We can expand on it later.

# Player selector

The current player selector is pretty simple but works well.

## External player selector

I would like to add the option of an external player selector.

Specifically, I want to create a device with NFC tags where players can put their tag on their player slot and have the app automatically select it.
For now, just keep that in mind and build everything else so that it is open enough to add this later.

# API

I would like to create a REST API for the application where songs can be started etc.