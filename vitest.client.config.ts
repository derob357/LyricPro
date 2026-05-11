import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  plugins: [react()],
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["client/src/test-setup.ts"],
    environmentOptions: {
      jsdom: {
        url: "http://localhost",
      },
    },
    include: [
      "client/src/**/*.test.ts",
      "client/src/**/*.test.tsx",
      "client/src/**/*.spec.ts",
      "client/src/**/*.spec.tsx",
    ],
  },
});
