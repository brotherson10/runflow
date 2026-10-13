import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/*",
      {
        test: {
          name: "tooling",
          include: ["tests/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
