import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

test("the app shell shows all four navigation tabs", () => {
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );

  for (const label of ["Home", "Songs", "Scores", "User"]) {
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  }
});
