import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";
export default defineConfig({
  plugins: [
    react(),
    legacy({ targets: ["Chrome >= 53"], modernPolyfills: true }),
  ],
  server: { proxy: { "/api": "http://127.0.0.1:3210" } },
});
