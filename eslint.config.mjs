// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
  { ignores: ["main.js", "node_modules/**", "*.config.mjs", "*.config.js"] },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      globals: {
        ...globals.browser
      },
    },

    // You can add your own configuration to override or add rules
    rules: {
      // example: turn off a rule from the recommended set
      "obsidianmd/sample-names": "off",
      // example: add a rule not in the recommended set and set its severity
      "obsidianmd/prefer-file-manager-trash-file": "error",
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: ["gtd", "GTD"], //["GTD Tasks", "gtd", "Dataview-compatible", "To Review", "Getting Things Done"],
          acronyms: ["ID"],
          ignoreWords: ["bucket-id"],
          enforceCamelCaseLower: true
        },
      ],
    },
  },
]);