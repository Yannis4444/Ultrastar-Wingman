# Reel weighting

*Design, 2026-11-08. Branch `feat/groups-reel-sfx`. Nothing of it is built yet: this document
is what the implementation builds from, and every number and name in it is decided. The
user's request is quoted in §1; everything else is made here and open to a veto (§6 lists the
ones that matter most). Where this document and the code disagree after the round, the code
is right and this document is updated.*

*Wishlist (weighted)* puts every wished song into the reel once per wish. So the more songs
somebody wishes for, the larger their share of every spin: a guest with twenty wishes owns
five sixths of a pool next to a guest with three and a guest with one. This round gives each
wisher's songs a fairer share without making one lonely wish worth a whole long list, and
lets a song the reel on the TV landed on, and the room passed over, sit out for a while.

## 1. Decisions

The user asked (2026-11-08), in their words:

> Make the weighted wishlist configurable. Currently it is just weighted by the number of
> wishes. That means that the more wishes you have, the more likely you are to get a wish.
> How about giving an option to take into account how many wishes a player has? So A user
> with 3 wishes and a player with 20 wishes have similar chances of getting their wish?
> I would not scale this linearly, as that would mean, a single song wished by one player
> would be about as likely to be selected as the 20 songs wished by another player together.
> That would probably be annoying when a few users have just one wished song.
> […] Should we add a setting for this?
> Any other things that should be taken into account? Like if the song was sung before and
> not selected (should only be for the spins on the host screen (including player selector)
> then as the other ones would punish songs silently) - maybe by taking into account when
> the song was last spun, punishing an age up to 30 by decreasing the song's weight? I would
> not remove the song from the options entirely, just make it less likely to be selected.

"Sung before and not selected" is read as **spun** before and not sung: the rest of the
sentence is about when the song was last *spun*, and a song the room sang is exactly one it
did select.

Made here, open to a veto:

1. **Fair wishes** (§3). One wish of somebody who holds `n` wishes weighs `(1 + ln n) / n`,
   so all of one person's wishes together weigh `1 + ln n`: the first few wishes count
   almost fully, a long list flattens out. A song's weight is the sum of its wishes'
   weights. It is a property of the *Wishlist (weighted)* scope, so it reaches **every** path
   that picks from that scope, the background music included (§2).
2. **Two switches, both on by default**, in the **Karaoke** group of the Settings page,
   `settings.manage` (§4): `karaoke.fair_wishes` (*Fair wishes*) and
   `karaoke.rest_skipped_songs` (*Rest skipped songs*). No select over strengths: a switch is
   drawn by the Settings page with no new component, and *off* is today's behaviour exactly.
   On by default because the user's complaint is about today's rule: an update that kept it
   unless somebody found the switch would fix nothing at the party that asked.
3. **Resting a skipped song** (§5). Every host spin — a phone spinning the TV's reel, a
   respin, the player selector's random start — remembers the song it landed on. Until that
   song is sung, a host spin weighs it at `0.2 + 0.8 · min(age, 30) / 30`, `age` in
   **minutes** since the reel last landed on it: a fifth right after, full weight after half
   an hour. Never zero. Every scope of a host spin, never the phone's own reel, never the
   background music.
4. **Remembered in the process, not in the database** (§5.5): a dictionary in
   `karaoke/reel.py`. No migration. A restart forgets at most half an hour.
5. **The phone's own reel keeps picking on the phone** (§2.1): the server sends each wish
   row's `weight` on `WishRead`, and the phone draws with it. The formula lives on the server
   alone.
6. **Every server pick is one weighted draw**: `random.choices(ids, weights=…, k=1)` over the
   candidate ids sorted, a weight of `1.0` where a scope has nothing to weigh.

## 2. Every pick

Six places choose a song for somebody. Five are on the server and go through
`karaoke/reel.py`; one is the phone's own reel.

| # | Path | File, function | Scopes | Triggered by | Fair wishes | Rest skipped |
|---|---|---|---|---|---|---|
| 1 | The phone's own reel | `frontend/src/components/SongSpinner.tsx`, `startSpin` over `pool()` (and `PlaylistSpinner`'s fixed pool) | all, favorites, wishlist, weighted; a playlist's songs | a phone on *This screen* | **yes**, on weighted, through `WishRead.weight` | no |
| 2 | A phone spins the TV | `karaoke/selection.py`, `open_selection(spin=…)` → `reel.pick_song` | all, favorites, wishlist, weighted, playlist | a phone on *Host screen*, on the Random song page or a playlist's reel (`useHostSpin.press`, `POST /karaoke/selection` with `spin`); a take-over (`force`) and a press over another pool than the TV's open anew the same way | **yes**, on weighted | **yes** |
| 3 | A respin | `selection.respin` / `button_pressed` → `_respin_locked` → `reel.pick_song` | the spin's own scope | the opener's phone (`POST /karaoke/selection/spin`), or the selector's start button at a spun selection whose reel has landed and where no slot holds a known player (an unknown card counts as nobody), whoever opened it | **yes**, on weighted | **yes** |
| 4 | The selector's random start | `selection._spin_without_selection_locked` → `reel.pick_song` (a second call on the playlist fallback) | all, wishlist, weighted, playlist (`devices.random_scope`) | the selector's start button, `start_without_selection = random` | **yes**, on weighted | **yes** |
| 5 | The selector's top wish | `selection._start_without_selection_locked` → `reel.top_wish` | none: the wishlist's first row | the selector's start button, `start_without_selection = top_wish` | no | no |
| 6 | The background music | `music/service.py`, `_pick` → `reel.pick_song` (`require_audio`, `exclude`, `PICK_ATTEMPTS`) | all, wishlist, weighted, playlist (`music.scope`) | `_evaluate` → `_start_next`, whenever the music has no track and nothing holds it back: the one-second tick, Play and Next (`POST /music/play`, `POST /music/skip`), a sink registering and its `ended` and `error` reports, every write of the music's options (`apply_settings`) — and **the player selector's cancel button** at a quiet room (`devices.cancel_without_selection = skip_music`: `button_pressed` → `_skip_music_locked` → `music.skip`) | **yes**, on weighted | no |

`_reveal_locked` (a press while the reel still runs) is not a pick: it lands the song the
reel already has and marks nothing. `top_wish` is not a draw at all: it takes the song most
people wished for (`library.service.wishlist`'s order), and one person can wish for a song
only once, so a long list cannot tilt it. It stays as it is.

The selector's cancel button is the one press on the player selector that picks a song and
is **not** a host spin: it is the background music moving on to its next track, drawn by
nobody's reel and shown on no screen as a choice the room passed over. It takes the music's
row — fair wishes on *Wishlist (weighted)*, no rest, no mark. "Including the player selector"
in the user's sentence is the start button's spins, rows 3 and 4.

**Fair wishes reaches rows 1, 2, 3, 4 and 6** because it is what *Wishlist (weighted)*
means, and the reel's own docstring already holds that a scope means one thing on the phone,
the TV, the selector and the speakers. Turning the switch off turns it off everywhere.

**Rest skipped reaches rows 2, 3 and 4**, the host spins, as the user asked: those are the
spins the whole room watches and passes over by spinning again. The phone's own reel is one
person playing, and the background music is nobody choosing; a penalty there would push a
song down for a reason nobody can see.

What this changes in the earlier designs, which stay as they are and point here (§7.4):

- [host-reel.md](host-reel.md) §1, decision 2 — *the phone's own reel stays local and is not
  changed*. It stays local: the winner is still drawn on the phone (§2.1). What changes is
  the draw on *Wishlist (weighted)*, which takes the server's weights instead of one ticket
  per wish.
- host-reel.md §2.2 and §6 — *candidates sorted, then `random.choice`*, and *a respin may
  land on the same song … nothing is excluded*. The candidates are still sorted and nothing
  is still excluded, so a respin may still land on the same song; the draw is
  `random.choices` with weights, and a host spin weighs the song it just passed over down
  (§5).
- [background-music.md](background-music.md) §3.2 — the `pick_song` signature gains
  `rest_at`, which the music never passes; *the wishlist weighted* is §3's weighting there
  too.
- [player-selector.md](player-selector.md) — nothing contradicted. Its cancel button's
  skip (§6.2 there) is the music's pick above, ruled out of the rest rule.

### 2.1 The phone's own reel

The Random song page on *This screen* picks on the phone: `startSpin` draws the winner the
instant SPIN is pressed and hands the reel the same pool for the covers that fly past. Its
weighted pool is `wishes.flatMap(wish => Array(wish.count).fill(wish.song))` — the plain
count — and `WishRead` carries nothing else: no owner, no owner's total. Fair wishes needs
both.

Decided: **the phone keeps picking; the server sends the weight.** `WishRead` gains
`weight: float`, the song's weight as §3 works it out (or its `count` while the switch is
off), and the phone's weighted winner is a draw over the wished songs with those weights.

- The winner is decided at the press, with no round trip. The *Show it* hold
  (`SHOW_IT_DELAY_MS`) and the reduced-motion path, which lands the reel in the same breath,
  are both built on that.
- The formula lives on the server alone; the phone does a weighted draw over numbers it is
  given, so the two cannot drift.
- `useWishlist` already refetches the whole list on every `wishlist.updated`, which is what a
  weight needs: one person adding a wish moves the weight of every other song they wished for.
  A `setting.changed` for `karaoke.fair_wishes` refetches it too, and so does
  `songs.scan_finished`: a scan that loses or finds a wished song's file moves its wisher's
  `n` (§3.1) without touching a wish row, so no `wishlist.updated` goes out for it.
- Who wished for what never leaves the server. A weight below the count says that somebody
  behind the song holds many wishes, nothing more.

Rejected: a server pick for the local reel (a route answering one song). It puts a request
between the press and the reel's first frame, adds an empty-pool refusal to a page that has
none on *This screen*, and the phone still needs the wishlist for the pool caption and the
covers.

The covers flying past stay the count-duplicated list they are today: they are decoration,
and a song wished three times flying past three times as often is still true.

One difference stays and is accepted: the wishlist counts a hidden player's own wishes for
that player alone (`library.service._counted`), so on that one phone their wishes are in the
weighted pool and in its weights, while the TV, the selector and the music never see them.
That is the existing rule for `count`, and `weight` follows it.

## 3. Fair wishes

### 3.1 The formula

One wish whose owner holds `n` wishes weighs

```text
w(n) = (1 + ln n) / n            (n ≥ 1, ln the natural logarithm)
```

so all of one owner's wishes together weigh `1 + ln n`, and a song weighs the sum of
`w(n_owner)` over the wishes for it. A song three people wished for collects three weights.

**An owner** is an account (`Wish.user_id`) or, for a guest, the browser's cookie
(`Wish.guest_id`): a guest's wish counts as its own owner, as everywhere else in the
wishlist.

**`n`** is how many of the owner's wishes are *counted* (`_counted`, so a hidden player owns
none in the room's pool) **and whose song is in the library**. It does not depend on who
reads: a song a tag hides from one reader still counts towards its wisher's `n`, so a weight
is the same number on every phone — but a hidden player's own, which counts their own wishes
(§2.1). Nothing that only one caller leaves out (`hidden`,
`require_audio`, the music's `exclude`) changes `n`; those drop candidates after the weights
are known.

| Wishes held `n` | 1 | 2 | 3 | 5 | 10 | 20 | 50 |
|---|---|---|---|---|---|---|---|
| One wish weighs `w(n)` | 1.000 | 0.847 | 0.700 | 0.522 | 0.330 | 0.200 | 0.098 |
| All of them weigh `1 + ln n` | 1.00 | 1.69 | 2.10 | 2.61 | 3.30 | 4.00 | 4.91 |

The total only ever grows: one more wish never lowers what somebody's wishes weigh together,
it only spreads it thinner. Nobody is punished for wishing.

### 3.2 Three wishers

A holds 1 wish, B holds 3, C holds 20, no song shared: 24 wished songs. The chance that the
reel lands on one of each wisher's songs:

| Rule | A (1 wish) | B (3 wishes) | C (20 wishes) | One song of A · B · C |
|---|---|---|---|---|
| Today, the plain count (`n`, 1 per wish) | 4.2 % | 12.5 % | 83.3 % | 4.2 % · 4.2 % · 4.2 % |
| **Fair wishes** (`1 + ln n`) | **14.1 %** | **29.6 %** | **56.3 %** | **14.1 % · 9.9 % · 2.8 %** |
| Equal per player (`1/n` per wish, ruled out) | 33.3 % | 33.3 % | 33.3 % | 33.3 % · 11.1 % · 1.7 % |

And the case the user worried about, five guests with one wish each beside C:

| Rule | Each of the five | The five together | C (20 wishes) |
|---|---|---|---|
| Today | 4.0 % | 20.0 % | 80.0 % |
| **Fair wishes** | **11.1 %** | **55.6 %** | **44.4 %** |
| Equal per player | 16.7 % | 83.3 % | 16.7 % |

A song wished for by A and by C weighs `1 + 0.200 = 1.200` (today: 2).

A single wish weighs 1 against the 4.0 that twenty wishes weigh together, so one lone song is
a quarter of a long list and not its equal, and a handful of one-song guests share a little
over half of the spins rather than the five sixths an equal share per person would give them.
Three wishes already weigh 2.1, more than half of what twenty weigh, so 3 against 20 is 30 %
against 56 %: much closer than 12.5 % against 83 %, and still not equal. Whether that is
"similar" enough is the user's call (§6, open question 3).

### 3.3 Why this curve

The curves considered all give one owner a total of some `T(n)`:

- `T(n) = n` is today; `T(n) = 1` is the linear rule the user ruled out.
- `T(n) = √n` (14 % · 24 % · 62 % above) leaves 20 wishes 2.6 times 3 wishes: not similar.
- `T(n) = n^¼` (23 % · 30 % · 48 %) makes 20 songs together barely twice one lone song, and
  the five one-song guests take 70 % of the spins: the user's annoyance, nearly in full.
- `T(n) = 1 + ln n` counts the second and third wish almost fully (1.69, 2.10) and flattens
  after that, which is both of the user's sentences at once.

## 4. The settings

The user asked whether there should be a setting. Yes: two switches, because the two rules
answer two different complaints and a host may want one without the other.

| Key | Type | Default | Group | Label (`labelize`) |
|---|---|---|---|---|
| `karaoke.fair_wishes` | `bool` | `True` | Karaoke | *Fair wishes* |
| `karaoke.rest_skipped_songs` | `bool` | `True` | Karaoke | *Rest skipped songs* |

Descriptions, user-facing, as registered:

- *Fair wishes*: "Wishlist (weighted) gives everybody who wished a fair share: each further
  wish of the same person counts a little less, so a long wishlist does not drown out a short
  one. Off: every wish counts the same."
- *Rest skipped songs*: "When the reel on the host screen lands on a song and the room spins
  again instead of singing it, that song comes up less often for the next half hour. It is
  never left out."

Registered settings (`settings.register` in `settings.py`), so `settings.view` reads them,
`settings.manage` writes them and the Settings page draws them as two toggles under
**Karaoke**, after *Players*, with no field component of its own and no line in
`ui-guidelines.md`. Each is `value_type=bool` with **no `validate`** (the registry's type
check is the whole rule for a switch) and **not `advanced`**: a host who finds the wishlist
unfair reaches for these, they are not an override of something Wingman derives. `labelize` reads both keys right, so `settings.ts`' `KEY_LABELS` stays
as it is. The keys live in the new leaf `karaoke/weighting.py` and `settings.py` imports them
from there, the `sound.py` / `karaoke/slots.py` arrangement.

Why not a select over named strengths (*Off · Gentle · Fair · Equal*): a string setting is
drawn as a text box, so a select needs its own field component (the `VideoQualityField`
precedent) and a guideline line, to offer strengths nobody has asked for. *Off* is the one
choice the user named; a switch gives it. Why no switch for the per-pick floor or the 30
minutes: nobody can tune a number they cannot see the effect of, and the user named the 30.

## 5. Resting a skipped song

### 5.1 What counts as a spin

The reel **landing on a song in a host spin**: the pick that opens a spun selection (row 2
and row 4 of §2), and every respin (row 3), whoever pressed. The mark is made once the
selection carries the song (`reel.note_spun(song.id, now)`, after the `_Selection` is set or
updated), never inside `pick_song`: an `open_selection` that the slots refuse after the pick
opened nothing, and the TV never showed that song.

Not a spin: the phone's own reel, the background music — the selector's cancel button
skipping it included (§2) — `top_wish`, a selection opened with a song, and a press that only
lands a running reel (`_reveal_locked`).

**A respin passes the first song over.** When a respin replaces song X with song Y on the
same selection, X keeps the mark it got when the reel landed on it, and Y gets its own. The
respin itself is drawn with `rest_at` set, so X — marked seconds ago — stands at the floor in
that very draw (§5.7). It does not matter who pressed, the opener's phone or the selector's
start button, nor who opened the selection: every landing in a host spin is marked the same
way.

### 5.2 What clears it

**The song starting** — `karaoke.service.start_sing`, right where `_clear_wishes` runs, after
the launch succeeded: `reel.clear_spun(song.id)`. Every way a song is sung goes through there
(a selection's Play, a song modal's Sing, the selector's start, a forced start), and a song the
room sang is the opposite of one it passed over. Not the score import: a sing abandoned before
its scores is still a song the room chose.

A spun song that was picked (`/pick`) and then given up, expired or taken over keeps its mark:
it was not sung. So does a spun song the host then sings from Ultrastar Deluxe's own menus
after **Open Ultrastar Deluxe** (`open_usdx`): that sing never passes `start_sing`, and
Wingman does not know it happened. Accepted — the mark runs out within half an hour anyway.

### 5.3 The unit: minutes

`age` is wall-clock **minutes** since the reel last landed on the song. **This is the top
veto** (§6): the user wrote "an age up to 30" and named no unit.

- A party is one evening. Thirty minutes is a stretch of it: the song the room passed over at
  nine is back at full weight by half past.
- A spin a week ago must not matter, and with minutes it cannot. With *spins* as the unit, a
  quiet week leaves last Saturday's mark at full strength until thirty spins have happened,
  and a busy hour of respins wipes them in ten minutes. With *days*, a song skipped once would
  still be shy at the next party.

### 5.4 The curve

```text
rest(age) = 0.2 + 0.8 · min(max(age, 0), 30) / 30        (age in minutes)
```

A fifth of its weight the moment it was spun, back in a straight line to full weight at 30
minutes, and 1 from then on, which is the same as no mark (the entry is dropped then). The
floor is never 0, so a song is never out of the pool, and a pool of one still lands on it. A
negative age (a clock set back) counts as 0. The factor multiplies whatever the scope weighs
the song at: 1 for every scope but *Wishlist (weighted)*, the song's §3 weight there.

The constants are `REST_FLOOR = 0.2` and `REST_MINUTES = 30` in `karaoke/weighting.py`.

### 5.5 Where it is kept

**Module state in `karaoke/reel.py`**: `_spun_at: dict[str, datetime]`, song id to the last
landing. `note_spun(song_id, at)` writes it and drops every entry older than `REST_MINUTES`
before `at`, so it never holds more than half an hour of songs; `clear_spun(song_id)` removes
one; `forget_spins()` empties it for the tests. Callers hand in the time (the selection's own
`_now()`, so the tests' frozen clock holds).

Rejected: a `songs.last_spun_at` column (migration 0038). It would survive a restart — but a
restart loses at most thirty minutes of marks, after which a song is a little likelier for
the rest of that half hour, which nobody can notice. Against it: a write to the song row on
every spin, a row the scanner and the metadata editor rewrite and fingerprint (a column the
scan must be taught to leave alone, as `replay_gain_db` had to be); a schema change for a
mood that lasts half an hour; and one more migration on a live database that still has
others to apply. The selection itself is module state already, and so is the music's track.

### 5.6 Every scope, behind its own switch

Behind `karaoke.rest_skipped_songs` (§4), read by `pick_song` when the caller asks for the
rule. It applies to **every scope of a host spin** — all, favorites, wishlist, weighted,
playlist: "we did not want that one" is about the song, not about the pool it came from. On
*All songs* in a large library it changes almost nothing, and it matters most where it should,
a small playlist or a short wishlist, where a respin used to land on the song just passed over
one time in five.

### 5.7 Five songs

A pool of five songs that weigh 1 each (*All songs*, a playlist, the plain wishlist), song A
spun 5 minutes ago and song B 20 minutes ago:

| Song | Weight | Share | Without the rule |
|---|---|---|---|
| A, spun 5 min ago | 0.2 + 0.8 · 5/30 = 0.333 | 8.2 % | 20 % |
| B, spun 20 min ago | 0.2 + 0.8 · 20/30 = 0.733 | 18.0 % | 20 % |
| C, D, E | 1 each | 24.6 % each | 20 % each |
| Total | 4.067 | 100 % | |

A respin straight away, on the same five songs with only the song just passed over marked,
lands on it 0.2 / 4.2 = 4.8 % of the time instead of 20 %.

## 6. What is not done, and open questions

Deliberately not done:

- **Nothing leaves the pool.** Both rules only change weights; every candidate keeps a weight
  above zero.
- **Nothing for the phone's own reel or the background music** in the rest rule (§2).
- **Nothing retroactive.** The marks start empty at every start, and no past spin or sing is
  read to fill them.
- **No per-player cap** on wishes, and no limit on how often one person's song may win.
- **No change to `top_wish`**, which is not a draw (§2).
- **No chances on screen.** The pool caption on the Random song page keeps saying
  *N wished songs · M wishes*; neither the weight nor the rest is drawn anywhere.
- **No rest for a song that was sung.** A sung song leaves the wishlist anyway (its wishes
  clear); on *All songs* or a playlist the reel may land on a song sung ten minutes ago, as it
  does today.

Open for the user, each with the default this document builds:

1. **The unit of the 30** — minutes (§5.3). The alternatives were spins and days.
2. **The floor** — 0.2, a fifth of the weight right after a spin (§5.4).
3. **The curve** — `1 + ln n` per owner (§3.3): 3 wishes against 20 is 30 % against 56 %,
   closer than today's 12.5 % against 83 % but not equal. `√n` if it should lean harder
   towards the long list (24 % against 62 %), `n^¼` if softer (30 % against 48 %, at the
   cost of five one-wish guests taking 70 %).
4. **Both switches on by default** (§1, §4). *Fair wishes* changes what *Wishlist (weighted)*
   did until now on every party that updates; the user's "configurable" and "an option"
   could also be read as opt-in, which would be both defaults off.
5. **Every host-spin scope rests a skipped song**, not only the wishlist ones (§5.6).
6. **A restart forgets the marks** (§5.5).
7. **Should a song just sung rest too**, on *All songs* and playlists? Not done (§6).
8. **The weight goes to the phone** (§2.1): a weight below the count tells a reader that
   somebody behind the song holds many wishes, and a hidden player's own phone weighs their
   own wishes in, as its `count` already does.
9. **The selector's cancel button is not a host spin** (§2): its skip of the background music
   neither rests nor marks.

## 7. Implementation

One branch, backend first, then the regenerated client and the phone, then the docs. No
migration.

### 7.1 Backend

- **New leaf `karaoke/weighting.py`**, FastAPI-free and importing nothing of Wingman's
  (`settings.py` imports it): `FAIR_WISHES = "karaoke.fair_wishes"`,
  `REST_SKIPPED = "karaoke.rest_skipped_songs"`, `REST_FLOOR = 0.2`, `REST_MINUTES = 30`,
  `wish_weight(held: int) -> float` (`(1 + math.log(held)) / held`, `ValueError` below 1) and
  `rest_factor(age: timedelta) -> float` (§5.4).
- **`settings.py`**: `register` both as in §4, group `"Karaoke"`, after
  `karaoke.player_colors`.
- **`library/schema.py`**: `WishRead.weight: float`, commented as "what this song's wishes
  weigh on *Wishlist (weighted)*: the count while fair wishes is off".
- **`library/service.py`**: one helper, `_weights(session, caller_user_id) -> dict[str,
  float]`, which reads `karaoke.fair_wishes` (`SettingsService(session)`), selects
  `Wish.song_id, Wish.user_id, Wish.guest_id` under `_counted(caller_user_id)` joined to
  `songs` (a song gone from the library is no wish of anybody's `n`), counts `n` per owner
  (`("user", id)` / `("guest", id)`) and sums `wish_weight(n)` per song — or the count, with
  the switch off. `wishlist()` and `add_wish()` fill `weight` from it; their signatures do not
  change, so `reel.top_wish`, `reel._candidates` and the route are untouched there.
- **`karaoke/reel.py`**:
  - `_candidates` returns `dict[str, float]`, song id to weight: `1.0` for all, favorites,
    wishlist and playlist; `wish.weight` for weighted.
  - `pick_song(..., rest_at: datetime | None = None)`: given, and with
    `karaoke.rest_skipped_songs` on, every candidate in `_spun_at` is multiplied by
    `rest_factor(rest_at - _spun_at[id])`. Then `ids = sorted(weights)` and
    `random.choices(ids, weights=[weights[i] for i in ids], k=1)[0]` — module `random`, as
    today, so a test patches `reel.random.choices` the way it patched `choice`.
  - `_spun_at`, `note_spun`, `clear_spun`, `forget_spins` (§5.5); the module docstring gains
    a paragraph on both rules, and its *Two callers, one picker* becomes the three it has (the
    selection, the selector's start button through it, and the background music). The
    `pick_song` docstring's *`weighted` is the wishlist with every song in the running as many
    times as it was wished for* becomes the §3 weight.
- **`karaoke/selection.py`**: `open_selection`'s spin branch, `_respin_locked` and
  `_spin_without_selection_locked` (both of its calls) pass `rest_at=now`, with `now = _now()`
  taken *before* the pick (it is after it in the last two today), and call
  `reel.note_spun(song.id, now)` once the selection carries the song. `respin`'s docstring
  (*Nothing rules the song it just landed on out*) stays true and says so: the song just
  landed on is weighed down, never out.
- **`karaoke/service.py`**: `start_sing` calls `reel.clear_spun(song.id)` beside
  `_clear_wishes` (cycle-free: `reel` imports nothing of `service`).
- **`music/service.py`**: nothing. `_pick` passes no `rest_at`, and the weighted weights come
  with the wishlist.
- **`tests/conftest.py`**: the autouse fixture that resets `selection` also calls
  `reel.forget_spins()`.

### 7.2 Backend tests

- `tests/test_karaoke_weighting.py` (new): `wish_weight` at 1, 3, 20 (`1.0`, `0.69954`,
  `0.19979`, `pytest.approx`) and its `ValueError` at 0; `rest_factor` at 0, 5, 20, 30, 45
  minutes and at a negative age.
- `tests/test_wishlist_api.py`: `weight` in the listing with the switch on and off; a guest
  as its own owner; a song two owners wished for summing their weights; a hidden player's
  wishes counting towards nobody's `n`; a song gone from the library leaving its wisher's `n`.
  `test_no_spin_picks_from_a_hidden_player_s_wishes` patches `reel.random.choices` and asserts
  `(ids, weights)` pairs instead of a duplicated list.
- `tests/test_karaoke_selection.py`: `pick_last` patches `reel.random.choices`, records the
  **ids alone** (each id once, as `choices` sees them) and returns the last; its docstring
  loses *a song repeated where it counts more than once*. That keeps every test that only
  needs a predictable landing — `test_karaoke_selection.py` and `test_devices_api.py`, which
  open spins back to back with `force` and would otherwise see the rest rule (on by default)
  move the weights between their own spins — untouched beyond the expected id lists, where
  the weighted pool now names each wished song once. The weights are asserted only in the
  tests written for them, below, each of which sets the switch it does not test off first.
  New, each patching `choices` with a recorder of its own that keeps the weights: a weighted
  phone spin draws with §3's weights (`karaoke.rest_skipped_songs` off); a phone spin and a
  device spin mark their song; a respin — the phone's and the start button's — weighs the
  song just passed over at the floor (frozen clock) and at 1 after 30 minutes; a `start_sing`
  of it clears the mark; the rest switch off leaves every non-weighted weight at 1; the
  background music's pick, and the selector's cancel button skipping it, never see a mark and
  never make one.
- One distribution test under `random.seed(…)`: 10 000 weighted picks over §3.2's three
  wishers land within a percentage point of 14.1 / 29.6 / 56.3.
- `tests/test_settings_service.py`: both keys registered as booleans in **Karaoke**.

### 7.3 Frontend

- `npm run generate-api` (offline variant in recipes.md) for `WishRead.weight`, committed.
- `src/weightedPick.ts` (new, with `weightedPick.test.ts`): `weightedPick<T>(items: T[],
  weightOf: (item: T) => number, random = Math.random): T | undefined` — one cumulative draw,
  `undefined` for no items or no positive weight.
- `components/SongSpinner.tsx`: on *Wishlist (weighted)* the winner is
  `weightedPick(wishes, (wish) => wish.weight)?.song`; the fillers stay `pool()`'s
  count-duplicated list; every other scope keeps its uniform draw. The `pool()` comment says
  the tickets are the covers alone.
- `hooks/useWishlist.ts`: also invalidates on `setting.changed` whose key is
  `karaoke.fair_wishes`, and on `songs.scan_finished` (§2.1); a new
  `hooks/useWishlist.test.tsx` (the `useFavorites.test.tsx` pattern, `fakeSocket.ts`) covers
  both, and that a `setting.changed` for any other key refetches nothing.
- Every `WishRead` literal in the tests gains `weight` (`HomeStage`, `SongDetails`,
  `SongSpinner`, `Host` tests and the shared helpers); `SongSpinner.test.tsx` gains a weighted
  pick under a stubbed `Math.random`.

### 7.4 Documentation

- `docs/user/party/reel.md`: the *Wishlist (weighted)* row, and the paragraph under the table
  **rewritten** — its *three times the chance* is no longer true while **Fair wishes** is on
  (three wishers holding 20 wishes each give a song 0.6, less than one lone wish's 1). Say
  instead that every wish adds to a song's chance, and that each of one person's wishes
  counts a little less the more of them they hold, so a long list does not drown out a short
  one. Under *Spin on the host screen*, one paragraph on **Rest skipped songs**.
- `docs/user/party/wishlist.md` (line 55, *three times the chance*), `docs/user/party/music.md`
  (the *Wishlist (weighted)* row, *three times as often*) and `docs/user/selector/cards.md`:
  the same rewrite of their sentences on the weighted pool.
- `docs/user/settings/reference.md`: two rows in the **Karaoke** table.
- `docs/dev/host-reel.md` §2.2 and `docs/dev/background-music.md` §3.2: one line each
  pointing here for what *weighted* means now.
- `CLAUDE.md`: in the `karaoke/` row, the `reel.py` sentence gains the weighted draw, the
  rest marks (`note_spun` / `clear_spun`, module state, cleared by `start_sing`) and the leaf
  `weighting.py` with its two keys, linked as `[the design](docs/dev/reel-weighting.md)` the
  way the other rows link theirs; in the `library/` row, `WishRead.weight`; in the frontend
  map, `weightedPick.ts` among the plain helpers and the weighted draw in `SongSpinner`'s
  sentence.
