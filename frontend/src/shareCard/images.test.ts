import { loadCardImages, type ImageCache } from "./images";

/** URLs whose picture "will not decode", and every URL ever asked for. */
let failing = new Set<string>();
let asked: string[] = [];

class FakeImage {
  decoding = "auto";
  naturalWidth = 0;
  private url = "";

  set src(url: string) {
    this.url = url;
    asked.push(url);
  }

  get src(): string {
    return this.url;
  }

  decode(): Promise<void> {
    if (failing.has(this.url)) return Promise.reject(new Error("broken"));
    this.naturalWidth = 1;
    return Promise.resolve();
  }
}

beforeEach(() => {
  failing = new Set();
  asked = [];
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => vi.unstubAllGlobals());

test("every picture that decodes is in the map; a broken one is left out", async () => {
  failing.add("/b");
  const images = await loadCardImages(["/a", "/b", "/c"], new Map());
  expect([...images.keys()]).toEqual(["/a", "/c"]);
});

test("a URL the cache has seen is never asked for again, failed or not", async () => {
  failing.add("/b");
  const cache: ImageCache = new Map();
  await loadCardImages(["/a", "/b"], cache);
  const images = await loadCardImages(["/a", "/b", "/c"], cache);
  expect(asked).toEqual(["/a", "/b", "/c"]);
  expect([...images.keys()]).toEqual(["/a", "/c"]);
});

test("two loads at once share one request per picture", async () => {
  const cache: ImageCache = new Map();
  await Promise.all([
    loadCardImages(["/a"], cache),
    loadCardImages(["/a"], cache),
  ]);
  expect(asked).toEqual(["/a"]);
});
