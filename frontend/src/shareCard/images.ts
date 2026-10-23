/**
 * The pictures a share card draws, loaded the way `renderCard` wants them
 * (share-cards.md §6): from Wingman's own origin, so the canvas stays
 * exportable, and decoded before anything is drawn. A picture that will not
 * load or decode — a song without a cover answers 404 — is left out of the
 * map, which is what makes the card draw its letter instead and what
 * `possible.ts` reads to say a Cover or a Mosaic look cannot be drawn.
 */

/** Every URL asked for so far, and what it came to: the decoded picture, or
 * `null` for one that failed. Kept by the panel across redraws, so changing a
 * card's options never asks for a picture twice. */
export type ImageCache = Map<string, Promise<HTMLImageElement | null>>;

function loadOne(url: string): Promise<HTMLImageElement | null> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  return image.decode().then(
    () => (image.naturalWidth > 0 ? image : null),
    () => null,
  );
}

/**
 * The pictures of `urls` that arrived, as `renderCard` takes them, once every
 * one of them is settled. A URL the cache already holds — loaded, failed or
 * still on its way — is not asked for again.
 */
export async function loadCardImages(
  urls: readonly string[],
  cache: ImageCache,
): Promise<Map<string, HTMLImageElement>> {
  const settled = await Promise.all(
    urls.map(async (url) => {
      let pending = cache.get(url);
      if (pending === undefined) {
        pending = loadOne(url);
        cache.set(url, pending);
      }
      return [url, await pending] as const;
    }),
  );
  const images = new Map<string, HTMLImageElement>();
  for (const [url, image] of settled)
    if (image !== null) images.set(url, image);
  return images;
}
