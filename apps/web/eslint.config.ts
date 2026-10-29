import prettierConfig from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";

import { LEGACY_MODULE_IMPORTS } from "./src/lib/modules/boundary";

/** MUI X's paid tiers, refused everywhere (the owner's decision of 2026-10-21). */
const PAID_MUI = [
  {
    regex: "^@mui/x-[a-z-]+-(pro|premium)(/.*)?$",
    message: "Pacote pago do MUI X: use o pacote comunitário (MIT) ou um componente próprio do projeto.",
  },
  {
    regex: "^@mui/x-license(/.*)?$",
    message: "O ONE não registra licença do MUI X: nenhum componente pago é usado.",
  },
];

/** A path as a glob that matches it literally: the brackets of a dynamic route are not a class of characters. */
const literalGlob = (file: string) => file.replace(/\[/g, "[[]");

export default [
  // Base JS & environment settings
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
        project: "./tsconfig.json",
      },
      globals: globals.browser,
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    settings: {
      react: { version: "detect" },
      next: { rootDir: ["./src"] },
    },
    ignores: [
      ".cache",
      ".next",
      "bun.lock",
      "next-env.d.ts",
      "next-eslint-plugin-next.d.ts",
      "next.config.ts",
      "node_modules",
      "package-lock.json",
      "public",
      "scripts",
      "yarn.lock",
    ],
  },
  // Recommended rules
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  // Plugins and custom rules
  {
    plugins: {
      prettier: prettierPlugin,
      "simple-import-sort": simpleImportSort,
      "@next/next": nextPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      "prefer-const": "warn",
      "no-var": "error",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          caughtErrors: "none",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "object-shorthand": "warn",
      "quote-props": ["warn", "as-needed"],
      "@typescript-eslint/array-type": [
        "warn",
        {
          default: "array",
        },
      ],
      "@typescript-eslint/consistent-type-assertions": [
        "warn",
        {
          assertionStyle: "as",
          objectLiteralTypeAssertions: "allow",
        },
      ],
      "react/jsx-fragments": ["warn", "syntax"],
      "react/jsx-filename-extension": [
        "warn",
        {
          extensions: ["ts", "tsx"],
        },
      ],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "no-html-link-for-pages": "off",
      "simple-import-sort/imports": [
        "warn",
        {
          groups: [["^\\u0000"], ["^"], ["^@mui"], ["^@/*"]],
        },
      ],
      "prettier/prettier": "warn",
      "@next/next/google-font-display": "error",
      // No component that needs a paid licence: MUI X's community packages (MIT) only. What only a paid tier
      // gives is built in the project's own code (the owner's decision of 2026-10-21).
      "no-restricted-imports": ["error", { patterns: PAID_MUI }],
    },
  },
  // A product module's code is its own (lib/modules/types.ts, migration 0068): the core reaches a module only
  // through the registry (lib/modules/registry.ts) and the list of jobs (lib/modules/jobs.ts), and a module's
  // routes live in a route group named after it. The files of LEGACY_MODULE_IMPORTS still reach into the passenger
  // module directly, from before the module had a folder of its own: each is a seam to move into the module or
  // behind the registry, and the list only shrinks.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/modules/**",
      "src/**/(direito-do-passageiro)/**",
      "src/lib/modules/registry.ts",
      "src/lib/modules/jobs.ts",
      "src/**/*.test.ts",
      ...LEGACY_MODULE_IMPORTS.map(literalGlob),
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...PAID_MUI,
            {
              regex: "^@/modules/",
              message:
                "O core não importa um módulo: pergunte ao registro (lib/modules/registry.ts) ou ponha o código no módulo.",
            },
          ],
        },
      ],
    },
  },
];
