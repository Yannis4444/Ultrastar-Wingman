import { fireEvent, render, screen } from "@testing-library/react";
import {
  achievementRead,
  maskedAchievementRead,
  playerAchievementRead,
} from "../test/achievements";
import { cardDate } from "../duration";
import { iconNames } from "../test/icons";
import AchievementModal from "./AchievementModal";
import type { PlayerAchievementRead } from "../api";

/** The modal over one record row, with a spy on what closes it. */
function renderModal(row: PlayerAchievementRead) {
  const onClose = vi.fn();
  const { container } = render(
    <AchievementModal row={row} onClose={onClose} />,
  );
  return { onClose, container };
}

/** A press is a mousedown and a click on the same element (see Modal.tsx). */
function press(target: Element) {
  fireEvent.mouseDown(target);
  fireEvent.click(target);
}

it("shows the picture large, the name, the sentence and the day", () => {
  const { container } = renderModal(
    playerAchievementRead({
      achievement: achievementRead({ has_image: true, icon_version: 3 }),
      earned_at: "2026-08-12T20:15:00Z",
    }),
  );

  // The full-resolution file, which nothing else in the app asks for: this is
  // the one view that fills a phone with a single badge.
  expect(
    container.querySelector(".achievement-modal-badge img"),
  ).toHaveAttribute("src", "/api/v1/achievements/a-golden/icon?size=full&v=3");
  expect(screen.getByText("Golden Voice")).toBeInTheDocument();
  expect(
    screen.getByText("Score 9,000 or more in a song."),
  ).toBeInTheDocument();
  // Day, month and year, always (ui-guidelines §5): the modal is read on its
  // own. Through the app's own date helper, so no locale is assumed.
  const earned = screen.getByText(`Earned ${cardDate("2026-08-12T20:15:00Z")}`);
  expect(earned).toHaveTextContent("2026");
  // Earned, so there is nothing left to progress towards.
  expect(container.querySelector(".achievement-progress")).toBeNull();
});

it("bares the panel so the page behind it is only darkened and blurred", () => {
  const { container } = renderModal(playerAchievementRead());

  // The song modal's own mechanism, not a second copy of it (ui-guidelines §5).
  expect(container.querySelector(".modal-backdrop-blur")).not.toBeNull();
  expect(container.querySelector(".modal-bare")).not.toBeNull();
  // The name is still the dialog's accessible name, even unwritten in a header.
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Golden Voice");
});

it("draws the glyph plate at the same size when there is no picture", () => {
  const { container } = renderModal(
    playerAchievementRead({
      achievement: achievementRead({ icon: "crown", color: "gold" }),
    }),
  );

  const badge = container.querySelector(".achievement-modal-badge");
  // A glyph badge across half the screen is still the badge: the same plate,
  // sized by the modal's own `font-size` rather than by a second component.
  expect(iconNames(badge as HTMLElement)).toEqual(["crown"]);
  expect(badge).toHaveClass("achievement-badge-earned");
  expect(container.querySelector("img")).toBeNull();
});

it("shows the bar over its numbers while it is still out of reach", () => {
  const { container } = renderModal(
    playerAchievementRead({
      achievement: achievementRead({ name: "Ten songs" }),
      earned_at: null,
      progress_current: 7,
      progress_target: 10,
    }),
  );

  expect(screen.getByText("7 / 10")).toBeInTheDocument();
  expect(
    container.querySelector<HTMLElement>(".achievement-progress-bar > span")
      ?.style.width,
  ).toBe("70%");
  expect(screen.queryByText(/^Earned/)).not.toBeInTheDocument();
  // The unearned badge, drained like the row's own.
  expect(container.querySelector(".achievement-modal-badge")).toHaveClass(
    "achievement-badge-off",
  );
});

it("says the same nothing about a hidden one, at a bigger size", () => {
  const { container } = renderModal(
    playerAchievementRead({
      achievement: maskedAchievementRead(),
      earned_at: null,
      progress_current: null,
      progress_target: null,
    }),
  );

  expect(screen.getByText("Hidden achievement")).toBeInTheDocument();
  expect(
    screen.getByText("Earn it to find out what this is."),
  ).toBeInTheDocument();
  expect(
    iconNames(
      container.querySelector(".achievement-modal-badge") as HTMLElement,
    ),
  ).toEqual(["lock"]);
  // No bar, whatever numbers reach it: a modal is not a way around the masking.
  expect(container.querySelector(".achievement-progress")).toBeNull();
});

it("keeps the bar off a masked row even if the numbers arrive anyway", () => {
  // The API nulls both on a masked row; this is the belt to that braces.
  const { container } = renderModal(
    playerAchievementRead({
      achievement: maskedAchievementRead(),
      earned_at: null,
      progress_current: 7,
      progress_target: 10,
    }),
  );

  expect(container.querySelector(".achievement-progress")).toBeNull();
  expect(screen.queryByText("7 / 10")).not.toBeInTheDocument();
});

it.each([
  [3, "Earned by 3 players"],
  [1, "Earned by 1 player"],
  [0, "Nobody has earned this yet"],
])("says how many players hold it: %i", (count, line) => {
  const { container } = renderModal(
    playerAchievementRead({
      achievement: achievementRead({ holder_count: count }),
    }),
  );

  // Under the sentence, and before the row's own line.
  const holders = container.querySelector(".achievement-modal-holders");
  expect(holders).toHaveTextContent(line);
  expect(holders?.previousElementSibling).toHaveClass(
    "achievement-modal-description",
  );
});

it("says nothing about the holders when there is no count", () => {
  const { container } = renderModal(playerAchievementRead());

  // No count is not "Nobody": the line is simply not there.
  expect(container.querySelector(".achievement-modal-holders")).toBeNull();
  expect(screen.queryByText(/Nobody has earned/)).not.toBeInTheDocument();
});

it("keeps the holders line off a masked row even if a count arrives", () => {
  // The API nulls the count on a masked row; this is the belt to that braces.
  const { container } = renderModal(
    playerAchievementRead({
      achievement: maskedAchievementRead({ holder_count: 4 }),
      earned_at: null,
    }),
  );

  expect(container.querySelector(".achievement-modal-holders")).toBeNull();
  expect(screen.queryByText(/Earned by/)).not.toBeInTheDocument();
});

it("closes on Escape", () => {
  const { onClose } = renderModal(playerAchievementRead());

  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

it("closes on the backdrop", () => {
  const { onClose, container } = renderModal(playerAchievementRead());

  press(container.querySelector(".modal-backdrop")!);
  expect(onClose).toHaveBeenCalled();
});

it("closes on its own close button", () => {
  const { onClose } = renderModal(playerAchievementRead());

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalled();
});
