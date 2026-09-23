import { defineConfig } from "vite";

// In development, `npm run server` provides the API on :8787.
export default defineConfig({
  server: { proxy: { "/api": "http://localhost:8787" } },
});
