import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { missingPermission } from "./errors";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A capability the role does not hold will not appear on a retry, so a
      // guest opening a page with privileged queries must not hammer them.
      retry: (failures, error) =>
        missingPermission(error) === null && failures < 3,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
