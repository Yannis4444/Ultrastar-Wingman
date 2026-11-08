import { labelize } from "./settings";

test.each([
  ["usdb.base_url", "Base URL"],
  ["usdb.username", "Username"],
  ["songs.additional_directories", "Additional directories"],
  ["usdx.base_path", "Base path"],
  ["usdx.ultrastar_db", "Ultrastar DB"],
  ["usdx.avatars_dir", "Avatars directory"],
  ["downloads.ytdlp_path", "yt-dlp path"],
  ["downloads.ytdlp_arguments", "yt-dlp arguments"],
  ["downloads.ffmpeg", "ffmpeg"],
  ["downloads.parallel", "Parallel"],
  ["auth.oidc_client_id", "OIDC client ID"],
  ["auth.oidc_enabled", "OIDC enabled"],
])("labelize(%s) is %s", (key, label) => {
  expect(labelize(key)).toBe(label);
});

test("a key that outgrew its name keeps it and says what it does", () => {
  expect(labelize("sound.reel_preview")).toBe("Song preview");
  // Only that exact key: another one ending the same way is labelled as ever.
  expect(labelize("other.reel_preview")).toBe("Reel preview");
});

test("the sound effects switch says which effects", () => {
  expect(labelize("sound.effects")).toBe("Sound effects");
  // The volume beside it keeps its generic label.
  expect(labelize("sound.effects_volume")).toBe("Effects volume");
});

test("a key without a group prefix still gets a label", () => {
  expect(labelize("parallel_downloads")).toBe("Parallel downloads");
});
