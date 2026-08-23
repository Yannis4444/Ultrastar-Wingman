import { useState } from "react";
import type { SongRead } from "../api";
import { useAuth } from "../auth";
import { timeAgo } from "../duration";
import { errorMessage } from "../errors";
import { useWishlist } from "../hooks/useWishlist";
import SongCover from "./SongCover";
import SongDetails from "./SongDetails";
import "./WishlistTile.css";

/** What the party wants to sing, most-wished-for first. */
export default function WishlistTile() {
  const auth = useAuth();
  const wishlist = useWishlist();
  const [selected, setSelected] = useState<SongRead | null>(null);

  if (!auth.can("wishlist.view")) return null;

  return (
    <>
      <section className="wishlist-tile" aria-label="Wishlist">
        <h2>Wishlist</h2>

        {wishlist.error !== null && (
          <p className="error-notice wishlist-notice" role="alert">
            {errorMessage(wishlist.error, "Could not change your wish.")}
          </p>
        )}

        {wishlist.wishes.length === 0 ? (
          <p className="wishlist-empty">
            {wishlist.isPending
              ? "Loading the wishlist…"
              : "Nobody wished for anything yet. Open a song and hit Wish — the more wishes a song has, the better its odds on the spinner."}
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
                      {wish.song.title}
                      {wish.mine && (
                        <span
                          className="wishlist-mine"
                          title="You wished for this"
                        >
                          {" ★"}
                        </span>
                      )}
                    </span>
                    <span className="wishlist-artist">{wish.song.artist}</span>
                  </span>
                  <span
                    className="wishlist-count"
                    aria-label={`${wish.count} wishes`}
                  >
                    {wish.count}×
                  </span>
                  <span className="wishlist-latest">
                    {timeAgo(wish.latest)}
                  </span>
                </button>
                {wish.mine && auth.can("wishlist.add") && (
                  <button
                    type="button"
                    className="wishlist-remove"
                    aria-label={`Take back your wish for ${wish.song.title}`}
                    onClick={() => wishlist.unwish(wish.song.id)}
                  >
                    ♥−
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
