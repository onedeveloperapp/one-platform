// Builds ONE's browser extension (apps/web/extension/) from the same code the app tests: `node apps/web/extension/build.mjs`
// writes apps/web/extension/dist/ (git-ignored), the folder Chrome loads ("Carregar sem compactação" in
// chrome://extensions, developer mode on) or that is zipped to send to a lawyer.
//
// The extension calls ONE at its production address; `--one <address>` (or ONE_URL) builds it for another, as a
// preview or a development machine (`--one http://localhost:3000`). The address goes into the manifest's hosts, so the
// extension may call it and nothing else of the web.
/* global console, process, URL */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "..");
const args = process.argv.slice(2);
// `--out <folder>`: another folder than dist/ (the smoke test builds its own, calling a stand-in of ONE).
const out = args.includes("--out") ? path.resolve(args[args.indexOf("--out") + 1]) : path.join(here, "dist");
const given = args.includes("--one") ? args[args.indexOf("--one") + 1] : process.env.ONE_URL;
const one = new URL(given || "https://one-platform-two.vercel.app");
if (one.protocol !== "https:" && one.hostname !== "localhost" && one.hostname !== "127.0.0.1") {
  throw new Error(`ONE's address must be https: ${one.href}`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: {
    content: path.join(here, "src", "content.ts"),
    background: path.join(here, "src", "background.ts"),
    panel: path.join(here, "src", "panel.ts"),
  },
  outdir: out,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  tsconfig: path.join(web, "tsconfig.json"),
  define: { __ONE_URL__: JSON.stringify(one.origin) },
  legalComments: "none",
  logLevel: "warning",
});

const manifest = JSON.parse(readFileSync(path.join(here, "manifest.json"), "utf8"));
manifest.host_permissions = [...manifest.host_permissions, `${one.origin}/*`];
writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
copyFileSync(path.join(here, "panel.html"), path.join(out, "panel.html"));
copyFileSync(path.join(web, "public", "brand", "one-mark.png"), path.join(out, "icon-128.png"));

console.log(`extension built in ${path.relative(process.cwd(), out) || out}, calling ${one.origin}`);
