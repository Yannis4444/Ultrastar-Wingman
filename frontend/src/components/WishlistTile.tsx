import { useState } from "react";
import type { SongRead } from "../api";
import { useAuth } from "../auth";
import { errorMessage } from "../errors";
import { useFavorites } from "../hooks/useFavorites";
import { useBuiltInTags } from "../hooks/useTags";
import { useWishlist } from "../hooks/useWishlist";
import { tagColorClass } from "../tags";
import { Icon } from "./icons";
import SongCover from "./SongCover";
import SongDetails from "./SongDetails";
// For the shared .song-mark row indicators.
import "./SongListItem.css";
import "./WishlistTile.css";

/** What the party wants to sing, most-wished-for first. */
export default function WishlistTile() {
  const auth = useAuth();
  // Taking a song off for everybody. Never offered where the only wish is the
  // reader's own — the take-back button beside it already does exactly that.
  const mayClear = auth.can("wishlist.manage");
  const wishlist = useWishlist();
  const favorites = useFavorites();
  // The heart here is the same passive mark the song list draws, so it follows
  // the same built-in: the party's colour, and gone when the mark is off. The
  // narrow hook on purpose — Home draws no tag, so it must not pull the
  // assignments listing down with it.
  const builtIns = useBuiltInTags();
  const [selected, setSelected] = useState<SongRead | null>(null);

  if (!auth.can("wishlist.view")) return null;

  return (
    <>
      <section className="wishlist-tile" aria-label="Wishlist">
        <h2>Wishlist</h2>

        {wishlist.error !== null && (
          <p className="error-notice wishlist-notice" role="alert">
            {errorMessage(wishlist.error, "Could not change the wishlist.")}
          </p>
        )}

        {wishlist.wishes.length === 0 ? (
          <p className="wishlist-empty">
            {wishlist.isPending
              ? "Loading the wishlist…"
              : "Nobody wished for anything yet. Open a song and hit Wish. The more wishes a song has, the better its odds on the reel."}
          </p>
        ) : (
          <ul className="wishlist-list">
            {wishlist.wishes.map((wish) => (
              <li key={wish.song.id}>
                <button
                  type="button"
                  className="wishlist-song"
                  onClick={() => setSelected(wish.song)}
                >
                  <SongCover song={wish.song} />
                  <span className="wishlist-text">
                    <span className="wishlist-title">
                      <span className="wishlist-title-text">
                        {wish.song.title}
                      </span>
                      {favorites.ids.has(wish.song.id) &&
                        builtIns.favorites.show_in_list && (
                          <span
                            className={`song-mark song-mark-favorite ${tagColorClass(builtIns.favorites.color)}`}
                            title="In your favorites"
                          >
                            <Icon name="heart" />
                          </span>
                        )}
                      {wish.mine && (
                        <span
                          className="song-mark song-mark-wished"
                          title="On your wishlist"
                        >
                          <Icon name="check" />
                        </span>
                      )}
                    </span>
                    <span className="wishlist-artist">
                      {wish.song.artist}
                      {wish.count > 1 && (
                        <span
                          className="wishlist-count"
                          aria-label={`${wish.count} wishes`}
                        >
                          {" "}
                          · {wish.count}×
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                {wish.mine && auth.can("wishlist.add") && (
                  <button
                    type="button"
                    className="icon-button icon-button-bordered wishlist-remove"
                    aria-label={`Take back your wish for ${wish.song.title}`}
                    onClick={() => wishlist.unwish(wish.song.id)}
                  >
                    <Icon name="close" />
                  </button>
                )}
                {mayClear && (!wish.mine || wish.count > 1) && (
                  <button
                    type="button"
                    className="icon-button icon-button-bordered wishlist-remove"
                    aria-label={`Take ${wish.song.title} off the wishlist for everybody`}
                    onClick={() => wishlist.clear(wish.song.id)}
                  >
                    <Icon name="trash" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && (
        <SongDetails song={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
