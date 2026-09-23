import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite proxies /api to the api service: one origin, so no CORS and the auth
// cookie just works (ARCHITECTURE §2 #9). API_URL differs in compose vs host.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: { "/api": process.env.API_URL ?? "http://localhost:3000" },
  },
});
