import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port 3000 is often taken locally. API calls go to /v1 on the same origin and are proxied to the
// Leash server, so the browser never makes cross-origin requests (no CORS setup, cookies just work).
const API = process.env.LEASH_SERVER ?? "http://localhost:4000";
const proxy = { "/v1": { target: API, changeOrigin: true }, "/socket.io": { target: API, ws: true, changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, strictPort: true, proxy },
  preview: { port: 5180, strictPort: true, proxy },
});
