// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
  { ignores: ["main.js", "node_modules/**", "*.config.mjs", "*.config.js", "e2e/.output/**"] },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      // One per group of files: the plugin, the unit tests, the end-to-end tests. Without its
      // own, a file outside src/ shows a parsing error in the editor.
      parserOptions: { project: ["./tsconfig.json", "./tsconfig.test.json", "./e2e/tsconfig.json"] },
      globals: {
        ...globals.browser
      },
    },

    // You can add your own configuration to override or add rules
    rules: {
      // example: turn off a rule from the recommended set
      "obsidianmd/sample-names": "off",
      // The obsidianmd preset passes only { args: "none" }, which resets
      // ignoreRestSiblings back to the rule default (false). Re-enable it so
      // `const { dropMe, ...rest } = obj` — the standard omit-a-key idiom —
      // isn't flagged, and honour the `_name` convention for deliberate
      // discards.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { args: "none", ignoreRestSiblings: true, varsIgnorePattern: "^_" },
      ],
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
  {
    // Test code runs in Node, and the end-to-end tests drive Obsidian from outside it. The rules
    // that keep plugin code safe inside Obsidian (no Node modules, no console, popout-safe
    // globals, no fixed config folder) have nothing to protect here.
    files: ["tests/**/*.ts", "e2e/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      // TypeScript already rejects an undefined name, and knows the type-only globals ESLint does not.
      "no-undef": "off",
      "import/no-nodejs-modules": "off",
      "import/no-extraneous-dependencies": "off",
      "obsidianmd/rule-custom-message": "off",
      "obsidianmd/prefer-window-timers": "off",
      "obsidianmd/prefer-active-doc": "off",
      "obsidianmd/hardcoded-config-path": "off",
      "obsidianmd/no-global-this": "off",
    },
  },
]);