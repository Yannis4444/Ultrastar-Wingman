import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChooseNameForm from "./ChooseNameForm";

const { completeOidcLogin, forgetOidcLogin } = vi.hoisted(() => ({
  completeOidcLogin: vi.fn(),
  forgetOidcLogin: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  completeOidcLogin,
  forgetOidcLogin,
}));

function renderForm(preset = "singer") {
  const onCancel = vi.fn();
  const onLost = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ChooseNameForm preset={preset} onCancel={onCancel} onLost={onLost} />
    </QueryClientProvider>,
  );
  return { onCancel, onLost };
}

beforeEach(() => {
  vi.resetAllMocks();
  completeOidcLogin.mockResolvedValue({
    data: { id: "u1", username: "singer", role: "user", player_id: "p1" },
  });
  forgetOidcLogin.mockResolvedValue({ data: undefined });
});

test("the field opens on the name the provider would have given", () => {
  renderForm("singer-2");

  expect(screen.getByLabelText("Your name")).toHaveValue("singer-2");
  // The one thing this step has to say about the name it is asking for.
  expect(screen.getByText(/cannot be changed later/)).toBeInTheDocument();
});

test("another name is what the account is created under", async () => {
  const { onLost } = renderForm();

  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "  Yannis  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  await waitFor(() =>
    expect(completeOidcLogin).toHaveBeenCalledWith(
      expect.objectContaining({ body: { username: "Yannis" } }),
    ),
  );
  expect(onLost).not.toHaveBeenCalled();
});

test("a taken name is said inline and the form stays open", async () => {
  completeOidcLogin.mockRejectedValueOnce({ detail: "duplicate_username" });
  const { onLost } = renderForm();

  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That name is taken",
  );
  // The round trip is not lost: the same pending login takes the next name.
  expect(onLost).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Your name")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "someone-else" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  await waitFor(() => expect(completeOidcLogin).toHaveBeenCalledTimes(2));
});

test("a name shorter than three characters never leaves the browser", () => {
  renderForm();

  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "ab" },
  });

  expect(screen.getByRole("alert")).toHaveTextContent("at least 3 characters");
  expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  expect(completeOidcLogin).not.toHaveBeenCalled();
});

test("a refusal nobody has a slug for keeps the sign-in alive", async () => {
  // A 500, a dropped connection: the pending login is still there, so the form
  // says so where it stands rather than sending the singer back to the start.
  completeOidcLogin.mockRejectedValueOnce({ detail: "Internal Server Error" });
  const { onLost } = renderForm();

  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not finish the sign-in.",
  );
  expect(onLost).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Your name")).toBeInTheDocument();
});

test("a pending login that is gone by now is reported to the page", async () => {
  completeOidcLogin.mockRejectedValueOnce({ detail: "no_pending_login" });
  const { onLost } = renderForm();

  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  await waitFor(() => expect(onLost).toHaveBeenCalledWith("no_pending_login"));
});

test("cancel gives the pending login up", async () => {
  const { onCancel } = renderForm();

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await waitFor(() => expect(onCancel).toHaveBeenCalled());
  expect(forgetOidcLogin).toHaveBeenCalled();
  expect(completeOidcLogin).not.toHaveBeenCalled();
});
