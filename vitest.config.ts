import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@imagemon\/core\/promptdex$/,
        replacement: fileURLToPath(new URL("./packages/core/src/promptdex.ts", import.meta.url)),
      },
      {
        find: /^@imagemon\/core$/,
        replacement: fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "packages/core/src/**/*.ts"],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 85,
        lines: 80,
      },
    },
  },
});
