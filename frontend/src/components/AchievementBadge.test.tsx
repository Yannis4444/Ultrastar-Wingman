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
  expect(image).toHaveAttribute("src", "/api/v1/achievements/a-golden/icon");
  expect(iconNames(badge(container))).toEqual([]);
});

it("asks for the new bytes when the caller knows the picture moved", () => {
  const { container } = render(
    <AchievementBadge
      achievement={achievementRead({ has_image: true })}
      iconVersion={7}
    />,
  );

  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    "/api/v1/achievements/a-golden/icon?v=7",
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
