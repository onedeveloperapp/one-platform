// Builds ONE's browser extension (apps/web/extension/) from the same code the app tests: `node apps/web/extension/build.mjs`
// writes apps/web/extension/dist/ (git-ignored), the folder Chrome loads ("Carregar sem compactação" in
// chrome://extensions, developer mode on) or that is zipped to send to a lawyer.
/* global console, process */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "..");
const out = path.join(here, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: {
    content: path.join(here, "src", "content.ts"),
    background: path.join(here, "src", "background.ts"),
    popup: path.join(here, "src", "popup.ts"),
  },
  outdir: out,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  tsconfig: path.join(web, "tsconfig.json"),
  legalComments: "none",
  logLevel: "warning",
});

copyFileSync(path.join(here, "manifest.json"), path.join(out, "manifest.json"));
copyFileSync(path.join(here, "popup.html"), path.join(out, "popup.html"));
copyFileSync(path.join(web, "public", "brand", "one-mark.png"), path.join(out, "icon-128.png"));

console.log(`extension built in ${path.relative(process.cwd(), out) || out}`);
