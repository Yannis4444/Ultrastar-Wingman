import { render } from "@testing-library/react";
import { achievementRead, maskedAchievementRead } from "../test/achievements";
import { iconNames } from "../test/icons";
import AchievementBadge from "./AchievementBadge";

function badge(element: HTMLElement): HTMLElement {
  return element.querySelector<HTMLElement>(".achievement-badge")!;
}

it("draws an earned badge as a plate in the achievement's colour", () => {
  const { container } = render(
    <AchievementBadge achievement={achievementRead({ color: "gold" })} />,
  );

  const plate = badge(container);
  expect(plate).toHaveClass("achievement-badge-earned");
  // The tags' own class, not a second colour vocabulary (ui-guidelines §4).
  expect(plate).toHaveClass("tag-color-gold");
  expect(iconNames(plate)).toEqual(["trophy"]);
});

it("draws an unearned one without a colour at all", () => {
  const { container } = render(
    <AchievementBadge
      achievement={achievementRead({ color: "gold", icon: "crown" })}
      earned={false}
    />,
  );

  const plate = badge(container);
  expect(plate).toHaveClass("achievement-badge-off");
  expect(plate).not.toHaveClass("tag-color-gold");
  // The glyph is still the achievement's: what it is has not become a secret.
  expect(iconNames(plate)).toEqual(["crown"]);
});

it("locks a masked one, whatever the caller says about earning it", () => {
  const { container } = render(
    <AchievementBadge achievement={maskedAchievementRead()} />,
  );

  const plate = badge(container);
  expect(iconNames(plate)).toEqual(["lock"]);
  expect(plate).toHaveClass("achievement-badge-off");
});

it("falls back to the feature's glyph for an icon this build has not got", () => {
  const { container } = render(
    <AchievementBadge achievement={achievementRead({ icon: "unicorn" })} />,
  );

  expect(iconNames(badge(container))).toEqual(["trophy"]);
});

it("shows the uploaded picture in place of the glyph", () => {
  const { container } = render(
    <AchievementBadge achievement={achievementRead({ has_image: true })} />,
  );

  const image = container.querySelector("img");
  // At the row size: the badge is 40px here and 74px at most on the TV, and the
  // shipped pictures are over a megabyte each at full size.
  expect(image).toHaveAttribute(
    "src",
    "/api/v1/achievements/a-golden/icon?size=small",
  );
  expect(iconNames(badge(container))).toEqual([]);
});

it("asks for the full file when the caller says which resolution it needs", () => {
  // The achievement modal, and nothing else: one badge filling a phone wants
  // the original, and `resolution` is what it asks for — not a size, which
  // stays the parent's `font-size`.
  const { container } = render(
    <AchievementBadge
      achievement={achievementRead({ has_image: true, icon_version: 7 })}
      resolution="full"
    />,
  );

  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    "/api/v1/achievements/a-golden/icon?size=full&v=7",
  );
  // Still no inline size: the resolution moved, the square did not.
  expect(badge(container).getAttribute("style")).toBeNull();
});

it("asks for the picture at the version the row carries", () => {
  const { container } = render(
    <AchievementBadge
      achievement={achievementRead({ has_image: true, icon_version: 7 })}
    />,
  );

  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    "/api/v1/achievements/a-golden/icon?size=small&v=7",
  );
});

it("draws the replaced picture, not the browser's copy of the old one", () => {
  const achievement = achievementRead({ has_image: true, icon_version: 7 });
  const { container, rerender } = render(
    <AchievementBadge achievement={achievement} />,
  );

  // What a replacement looks like from here: same id, same `has_image`, a new
  // `icon_version` — and that is the whole of what moves the URL.
  rerender(
    <AchievementBadge achievement={{ ...achievement, icon_version: 9 }} />,
  );

  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    "/api/v1/achievements/a-golden/icon?size=small&v=9",
  );
});

it("is decorative: the name beside it is what a reader is told", () => {
  const { container } = render(
    <AchievementBadge achievement={achievementRead()} />,
  );

  expect(badge(container)).toHaveAttribute("aria-hidden", "true");
});

it("takes its size from the parent rather than from a prop", () => {
  const { container } = render(
    <div style={{ fontSize: "16px" }}>
      <AchievementBadge achievement={achievementRead()} />
    </div>,
  );

  // No inline width, no size modifier: 2.5em of whatever the row is set in.
  expect(badge(container).getAttribute("style")).toBeNull();
  expect(badge(container).className).not.toMatch(/small|large/);
});

it("paints no plate under a picture", () => {
  // The picture covers the square; a plate beneath it showed as a hairline of
  // the achievement's colour around the rounded corners.
  const { container } = render(
    <AchievementBadge
      achievement={achievementRead({ color: "gold", has_image: true })}
    />,
  );

  expect(badge(container)).toHaveClass("achievement-badge-picture");
  // Still the earned plate class and the colour: the off state and the masked
  // lock are decided the same way whether or not there is a picture.
  expect(badge(container)).toHaveClass("achievement-badge-earned");
});

it("keeps the plate for a glyph and for a masked badge", () => {
  const glyph = render(<AchievementBadge achievement={achievementRead()} />);
  expect(badge(glyph.container)).not.toHaveClass("achievement-badge-picture");

  const masked = render(
    <AchievementBadge
      achievement={maskedAchievementRead({ has_image: true })}
    />,
  );
  expect(badge(masked.container)).not.toHaveClass("achievement-badge-picture");
});
