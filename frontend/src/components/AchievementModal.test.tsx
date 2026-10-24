import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  achievementRead,
  maskedAchievementRead,
  playerAchievementRead,
} from "../test/achievements";
import { cardDate } from "../duration";
import { iconNames } from "../test/icons";
import { player } from "../test/shareCard";
import AchievementModal, { type AchievementSharer } from "./AchievementModal";
import type { ShareTarget } from "./ShareCardPanel";
import type { PlayerAchievementRead } from "../api";

// The panel is tested on its own; here it is a dialog that says what it was
// handed, so opening it over the modal and closing it again are real.
vi.mock("./ShareCardPanel", async () => {
  const { default: Modal } = await import("./Modal");
  return {
    default: ({
      target,
      onClose,
    }: {
      target: ShareTarget;
      onClose: () => void;
    }) => (
      <Modal title="Share this achievement" onClose={onClose}>
        <div
          data-testid="share-panel"
          data-kind={target.kind}
          data-achievement={
            target.kind === "achievement" ? target.row.achievement_id : ""
          }
          data-name={target.kind === "achievement" ? target.name : ""}
          data-player={
            target.kind === "achievement" ? (target.player?.id ?? "none") : ""
          }
        />
      </Modal>
    ),
  };
});

/** The modal over one record row, with a spy on what closes it. */
function renderModal(row: PlayerAchievementRead, sharer?: AchievementSharer) {
  const onClose = vi.fn();
  const { container } = render(
    <AchievementModal row={row} sharer={sharer} onClose={onClose} />,
  );
  return { onClose, container };
}

/** Chiara on her own record, her player row in hand. */
const OWN: AchievementSharer = {
  player: player("chiara", "Chiara"),
  name: "Chiara",
};

function shareButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Share" });
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

  // The first of the facts, in their own group under the sentence.
  const holders = container.querySelector(".achievement-modal-holders");
  expect(holders).toHaveTextContent(line);
  expect(holders?.previousElementSibling).toBeNull();
  const meta = holders?.parentElement;
  expect(meta).toHaveClass("achievement-modal-meta");
  expect(meta?.previousElementSibling).toHaveClass(
    "achievement-modal-description",
  );
});

it("sets the holders, then the day, apart from the sentence", () => {
  const { container } = renderModal(
    playerAchievementRead({
      achievement: achievementRead({ holder_count: 3 }),
      earned_at: "2026-08-12T20:15:00Z",
    }),
  );

  // One group under the description, holders first and the day after it —
  // never the description's own line (ui-guidelines §5).
  const meta = container.querySelector(".achievement-modal-meta");
  expect(meta?.previousElementSibling).toHaveClass(
    "achievement-modal-description",
  );
  expect([...(meta?.children ?? [])].map((line) => line.textContent)).toEqual([
    "Earned by 3 players",
    `Earned ${cardDate("2026-08-12T20:15:00Z")}`,
  ]);
});

it("puts the bar in the same group, after the holders", () => {
  const { container } = renderModal(
    playerAchievementRead({
      achievement: achievementRead({ holder_count: 2 }),
      earned_at: null,
      progress_current: 7,
      progress_target: 10,
    }),
  );

  const meta = container.querySelector(".achievement-modal-meta");
  expect([...(meta?.children ?? [])].map((child) => child.className)).toEqual([
    "achievement-modal-holders",
    "achievement-progress",
  ]);
});

it("draws no empty group under a masked sentence", () => {
  const { container } = renderModal(
    playerAchievementRead({
      achievement: maskedAchievementRead(),
      earned_at: null,
      progress_current: null,
      progress_target: null,
    }),
  );

  // Nothing to say, so not even the gap that would set it apart.
  expect(container.querySelector(".achievement-modal-meta")).toBeNull();
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

// ------------------------------------------------------------------ sharing

it("offers Share on an earned achievement of the reader's own, under the facts", () => {
  const { container } = renderModal(
    playerAchievementRead({
      achievement: achievementRead({ holder_count: 3 }),
    }),
    OWN,
  );

  const share = shareButton();
  expect(share).not.toBeNull();
  // A plain button, the modal's one control (ui-guidelines §5) — not the
  // sing view's primary.
  expect(share).toHaveClass("button", "achievement-modal-share");
  expect(share).not.toHaveClass("button-primary");
  expect(iconNames(share!)).toEqual(["share"]);
  // Last in the column, after the meta group.
  const column = container.querySelector(".achievement-modal")!;
  expect(column.lastElementChild).toBe(share);
  expect(share!.previousElementSibling).toHaveClass("achievement-modal-meta");
});

it("offers no Share on one not earned yet, a masked one, a switched-off one, or a record that is not the reader's", () => {
  renderModal(
    playerAchievementRead({
      earned_at: null,
      progress_current: 3,
      progress_target: 10,
    }),
    OWN,
  );
  expect(shareButton()).toBeNull();
  cleanup();

  renderModal(
    playerAchievementRead({
      achievement: maskedAchievementRead(),
      earned_at: null,
    }),
    OWN,
  );
  expect(shareButton()).toBeNull();
  cleanup();

  // Switched off since: the record still carries the row until the pass
  // drops it, and a badge nobody is evaluated against is nothing to send.
  renderModal(
    playerAchievementRead({
      achievement: achievementRead({ enabled: false }),
    }),
    OWN,
  );
  expect(screen.getByText(/^Earned /)).toBeInTheDocument();
  expect(shareButton()).toBeNull();
  cleanup();

  // No sharer: whatever opens the modal for a record that is not the
  // reader's own — or for the catalogue — offers nothing to send.
  renderModal(playerAchievementRead());
  expect(screen.getByText(/^Earned /)).toBeInTheDocument();
  expect(shareButton()).toBeNull();
});

it("opens the share panel over the modal on this achievement and the sharer", () => {
  renderModal(playerAchievementRead({ player_id: "chiara" }), OWN);

  fireEvent.click(shareButton()!);
  const panel = screen.getByTestId("share-panel");
  expect(panel).toHaveAttribute("data-kind", "achievement");
  expect(panel).toHaveAttribute("data-achievement", "a-golden");
  expect(panel).toHaveAttribute("data-name", "Chiara");
  expect(panel).toHaveAttribute("data-player", "chiara");
  // Over it, not instead of it.
  expect(
    screen.getByRole("dialog", { name: "Golden Voice" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "Share this achievement" }),
  ).toBeInTheDocument();
});

it("comes back to the modal and onto Share when the panel closes", async () => {
  const { onClose } = renderModal(playerAchievementRead(), OWN);

  const share = shareButton()!;
  share.focus();
  fireEvent.click(share);
  expect(screen.getByTestId("share-panel")).toBeInTheDocument();

  // Escape closes the panel on top and only that.
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId("share-panel")).toBeNull());
  expect(onClose).not.toHaveBeenCalled();
  expect(
    screen.getByRole("dialog", { name: "Golden Voice" }),
  ).toBeInTheDocument();
  expect(document.activeElement).toBe(share);
});

it("hands the panel no player row where the page has none: the card draws the initial", () => {
  renderModal(playerAchievementRead(), { player: null, name: "Chiara" });

  fireEvent.click(shareButton()!);
  expect(screen.getByTestId("share-panel")).toHaveAttribute(
    "data-player",
    "none",
  );
});
