---
icon: wingman/tv
---

# The host screen

The host screen is the Wingman page on the TV, next to Ultrastar Deluxe. It is
how the room gets in, and it is the scoreboard between songs. Wingman opens it
on the karaoke PC by itself when it starts.

The browser that opened it holds host rights. Those rights are not an account.
They may change every setting and stop a running song, and they own no
favorites and no playlists.

## Put it on the TV

1. Start Wingman on the karaoke PC. See
   [Install and run](../start/install.md).
2. Let it open your browser. The page it opens is the host screen.
3. Put that browser window on the TV, in full screen. The button for that is
   among [the controls that fade](#the-controls-that-fade).

The link Wingman opens carries a one-time token, and trading it for host rights
is what makes that browser the host. The same link stands in the console
window, on the line with `Host UI:`. Copy it into a browser when none opened,
or when the wrong one did. Set `WINGMAN_OPEN_BROWSER` to `false` to stop
Wingman opening a browser at all.

!!! warning
    The host link works once. Wingman prints a new one every time it starts. A
    page saying the link does not work any more means you need that new line
    from the console. Browsers that already hold host rights keep them.

See [People](../people/index.md) for what a browser with host rights may do.

## What stands where

The screen has two columns. The left one is the stage, and it always shows what
the party is doing right now. The right one is the rail, and it is how to take
part.

![The host screen on a TV, with the last song's result on the left and the QR card, Tonight, and Most wished down the right](../assets/screenshots/host-screen/host-screen.png){ width="720" loading=lazy }
/// caption
The rail stays up for most of what the stage shows. New badges take the whole
screen.
///

The rail holds three blocks, top to bottom:

- The QR code, under **Scan to join**, with the same address written out below
  it. See [Let guests in](../start/join.md).
- **Tonight**, the standing of the party so far.
- **Most wished**, what the room has asked for.

**Tonight** appears once two songs of this party have been scored, and it lists
the five strongest singers. A screen too short for five shows as many as fit,
and never half a singer. The three words beside the heading say how they are
ranked: **best score**, **average**, or **sings**. Click one to change it. The
first three places carry a highlighted rank number.

**Most wished** is the wishlist, most wished song first, with the number of
wishes beside each. It holds five songs on its own, and three while **Tonight**
is up. On a short screen, such as a 720p TV, **Tonight** leaves room for two,
or for one while the music's line or its controls stand along the bottom. A
screen too short for all of them shows as many as fit, and never half a song.
See [Wish for a song](../party/wishlist.md).

## While singers are picked

When somebody taps **Sing** on a phone, or puts a card on the player selector,
the room is picking singers. The stage takes the whole screen for it, and the
rail is down until the song starts or the pick is given up. The song stands in
one centered column: the cover, the title, the artist, and the line *Picking
singers*. Along the foot stands one card per microphone slot, filling up as
singers are picked. When every slot holds a known singer and the selector
starts songs on its own, that line counts down instead: *Starting in 3…*. The
TV plays the song meanwhile, from where its singing starts. See
[Sing a song](../party/sing.md), [Player selector](../selector/index.md), and
[Background music](../party/music.md#the-song-being-picked).

When the reel spins on the host screen, it stands where the cover would, and
the line reads *Spinning…* while the covers scroll past. The title and the
artist appear when the reel lands, and the song starts playing then. A spin
from a phone shows the reel and the song alone. The slot cards appear once
that phone taps **Play**, the song playing on, and a room the cards already
fill counts down from that moment. A spin from the
selector's start button keeps the cards under the reel, and its countdown
waits for the reel to land. See [Let the reel pick](../party/reel.md).

![The host screen picking singers with the reel at rest over the title and the artist, and the slot cards along the foot](../assets/screenshots/host-screen/host-reel.png){ width="720" loading=lazy }
/// caption
The selector's start button spun this reel, so two of the slots hold its cards.
///

## While a song plays

The stage shows the cover, the title, and the artist. Under them stand the time
played against the song's length, a progress bar, and every singer on the color
of their microphone. The rail carries on beside it, so the QR code and the
standing stay up the whole time.

![The host screen while Walking on Sunshine plays, with the cover, the elapsed time, a progress bar, and Fry and Leela on their colors](../assets/screenshots/host-screen/host-playing.png){ width="720" loading=lazy }
/// caption
Fry sings on blue and Leela on red, the colors they were given.
///

## When a song ends

Wingman reads the scores and the stage turns into the result screen for the
song that finished:

- its cover, title, and artist,
- **Sings**, **Best**, **Average**, and **Worst** over the whole life of that
  song, beside the cover and under the artist, with the name of whoever holds
  the best and the worst,
- one bar per singer of this run, with their name, their evaluation, and their
  number, best singer first.

A singer who beat the song's own record gets **New Highscore** next to their
score. The three all-time numbers are marked on the same scale as the bars, so
you can see at a glance where tonight's run landed. Marks that would sit on top
of each other are left out: a song everybody scores about the same on keeps one
mark for the average, and the numbers themselves are printed above in full
either way.

Badges come before all of that. If the song earned somebody an achievement, the
stage holds the results back and throws the badges up first, over the whole
screen. They come one singer at a time, four badges to a row. How long a row
stays is set on **User** > **Achievements**. See
[Manage achievements](../achievements/manage/index.md).

## While nothing plays

The result screen stands there until the next song starts, so a host screen
opened cold shows the last song anybody scored. That can be a song from an
earlier party.

The stage carries the Wingman logo, its name, and the line *Scan the code to
pick a song* in two cases. One is a Wingman that has never scored a song. The
other is a song that was started and scored nothing, which is what a stopped
song leaves behind.

## The music between songs

The host screen is what plays the background music, so it has to stay open for
the room to hear anything. One quiet line along the bottom of the screen names
what is playing, whether the brand or the scores are up. See [Play background music](../party/music.md).

A browser plays no sound until somebody has pressed something on the page, and a
TV gets no presses. When that is what is stopping it, a large **Turn on sound**
appears at the bottom of the screen, in the middle, even while the room picks
singers. One click anywhere on the page does the same thing.

## Sound effects

The host screen makes two short sounds of its own: every new badge after a
song flies in with a whoosh and lands with a thud. Like the music, they wait
for one click or key press anywhere on the page, and only the host screen that
plays the music makes them. The phones make none of these sounds, and nothing plays during a song.
Switch them off with **Sound effects** in the **Sound** group of the settings,
and set how loud they are with **Effects volume** there. See
[All settings](../settings/reference.md#sound).

## The controls that fade

The controls are only for whoever is at the karaoke PC. They stand in two
groups, the screen's and the music's. Both fade out after a few seconds without
a mouse or a keyboard, and come back together on the next movement. So do the
three ranking words beside **Tonight**.

The screen's controls stand in the top left corner: a row of buttons, and the
keyboard shortcuts under it.

- :wingman-gear: **Manage** opens the management page. See
  [Manage from the TV](manage.md).
- :wingman-fullscreen: **Full screen** puts the page on the whole screen, where
  it turns into :wingman-fullscreen-exit: **Leave full screen**. Esc leaves too.
  A browser that refuses says *The browser would not go full screen. Press F11
  instead.*
- :wingman-stop: **Stop** ends the song. It asks first, and it names the song.
  It is there while a song plays, for a browser that may stop one.
- :wingman-power: **Open Ultrastar Deluxe** stands in the same place while no
  song plays, as quiet as the buttons beside it, with *For settings like
  microphones* under it. It opens Ultrastar Deluxe for the settings only it
  has, such as which microphone is player one, and brings its window to the
  front when it is already open. It is there for a browser that may change the
  settings. See
  [Start Ultrastar Deluxe on its own](../start/ultrastar-deluxe.md#start-ultrastar-deluxe-on-its-own).

!!! warning
    A song that is stopped scores nothing. Ultrastar Deluxe writes a score only
    for a song sung to the end.

When Ultrastar Deluxe will not start, the corner says why under the shortcuts,
until the mouse rests. A song playing is one reason. Settings that do not point
at Ultrastar Deluxe are another. See
[Ultrastar Deluxe](../help/ultrastar-deluxe.md).

The music's controls stand at the bottom of the screen, around the line naming
the background song, for a browser that may control the music. While the music
is paused, the song's name stays there in gray beside **Play**, and fades with
the controls. While the room picks singers or new badges are up, the line is
gone and the music's controls stand in the top right corner instead.

- :wingman-pause: **Pause** or :wingman-play: **Play**, and :wingman-skip:
  **Skip**, to the left of the song, while the background music is on, no song
  plays, and Ultrastar Deluxe is closed. See
  [Play background music](../party/music.md).
- :wingman-volume: The overall volume, with its number beside it, to the right
  of the song. It is the **Master volume** in the **Sound** group of the
  settings, so it turns the background music, the song being picked, and the
  sound effects up or down together. During a song and with the music off it
  stands there alone.

The line of keyboard shortcuts names each key before what it does: ++space++
**Play or pause**, ++n++ **Skip**, ++arrow-up++ ++arrow-down++ **Volume**, and
++f++ **Full screen**. It names only the keys whose button is on the screen
right now. So it says less during a song, and a browser that may not control
the music sees ++f++ at most.

## Keyboard shortcuts

A keyboard on the karaoke PC works the same controls without the mouse. A key
does nothing while a dialog is open, while you type in a field, or with
++ctrl++, ++alt++, or the Windows key held down. Pressing one shows the
controls, so you see what changed.

| Key | What it does |
|---|---|
| ++space++ or ++k++ | Pauses the background music, or plays it again |
| ++n++ | Skips to the next song of the background music |
| ++arrow-up++ / ++arrow-down++ | Turns the overall volume up or down by 5. Hold the key to keep going |
| ++f++ | Puts the page on the whole screen, or takes it back off |
| ++esc++ | Leaves full screen |

Each key works where its button is drawn, so the music keys need a browser
that may control the music. Hover a button to see its key, or read the line of
shortcuts in the corner.
