import { defineConfig } from "@hey-api/openapi-ts";

// The backend must be running for `npm run generate-api`.
export default defineConfig({
  input: "http://localhost:8080/api/v1/openapi.json",
  output: "src/api",
  plugins: [
    // baseUrl false: requests stay same-origin (dev goes through the vite proxy),
    // otherwise the generator bakes the localhost:8080 input URL into the bundle.
    { name: "@hey-api/client-fetch", baseUrl: false },
    "@tanstack/react-query",
  ],
});
