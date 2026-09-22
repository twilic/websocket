import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "error",
  },
  env: {
    builtin: true,
  },
  ignorePatterns: ["dist/**", "node_modules/**"],
  plugins: ["typescript", "unicorn", "oxc"],
  rules: {},
});
