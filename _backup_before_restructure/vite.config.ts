import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: path.resolve(__dirname, "src/dashboard/client"),
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/dashboard/client/src")
    }
  },
  build: {
    outDir: path.resolve(__dirname, "src/dashboard/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000"
    }
  }
});
