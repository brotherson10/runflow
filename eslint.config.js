import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";
import { securityRules } from "./eslint.security.js";

export default defineConfig([
  globalIgnores(["**/dist/", "**/coverage/", "**/node_modules/", ".e2e/", "test-results/", "playwright-report/"]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...securityRules,
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },

  // Ficheiros JS e de configuração: sem regras que exigem tipos.
  {
    files: ["**/*.js", "**/*.mjs", "**/vite.config.ts", "**/vitest.config.ts", "vitest.db.config.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Código Node (API, scripts, configs, testes).
  {
    files: ["apps/api/**", "scripts/**", "tests/**", "e2e/**", "**/*.config.{js,ts}", "eslint.*.js"],
    languageOptions: { globals: globals.node },
  },

  // Código do browser (React).
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  },
]);
