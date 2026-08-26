import { useState } from "react";
import "./SongCover.css";

interface CoverImageProps {
  /** Where the artwork comes from. A 404 there is normal, not an error. */
  src: string;
  /** The letter the fallback tile carries — the artist's initial. */
  initial: string;
  className?: string;
  /**
   * `lazy` (the default) for covers in lists, where most are off screen. The
   * spinner reel needs `eager`: its covers sit inside an overflow-hidden frame
   * and a lazy image only starts loading once it scrolls into view — too late
   * when it flies past in a fraction of a second.
   */
  loading?: "lazy" | "eager";
}

/**
 * A cover image with the initial tile that stands in for the ones that do not
 * exist. Neither the library nor USDB says up front whether a song has a cover,
 * so the `<img>` error event is the only signal there is.
 */
export default function CoverImage({
  src,
  initial,
  className,
  loading = "lazy",
}: CoverImageProps) {
  // The failed *url*, not a flag: a row that swaps to another song must try
  // again instead of inheriting the previous one's missing cover.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const classes = `song-cover${className ? ` ${className}` : ""}`;

  if (failedSrc === src) {
    return (
      <span className={`${classes} song-cover-fallback`} aria-hidden="true">
        {initial}
      </span>
    );
  }
  return (
    <img
      className={classes}
      src={src}
      alt=""
      loading={loading}
      onError={() => setFailedSrc(src)}
    />
  );
}
