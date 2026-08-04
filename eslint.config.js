import js from "@eslint/js";
import globals from "globals";

// Deliberately narrow. This is not here to enforce style — it exists because a
// missing import is invisible to the bundler: it happily emits a reference to
// an identifier that does not exist, and the page only breaks when a customer
// opens it. `no-undef` is the rule that turns that into a build failure
// instead of a lost order.
//
// Adapted from the dashboard repo's config, minus the React rules — nothing
// here uses React.

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  {
    // Browser bundle.
    files: ["src/**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-undef": "error",
      // Catching an unused import is how you notice a half-finished refactor,
      // but an unused function argument is often just the shape of a callback.
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Serverless functions and one-off scripts.
    files: ["api/**/*.js", "scripts/**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["**/*.test.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
