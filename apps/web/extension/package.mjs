// Packs ONE's browser extension for the lawyers to download from ONE itself: `node apps/web/extension/package.mjs`
// builds it (build.mjs, at ONE's production address) into a folder of its own and writes the zip a lawyer unpacks and
// loads in Chrome to apps/web/public/extensao/one-extensao.zip (git-ignored), which ONE serves at
// /extensao/one-extensao.zip to who is signed in. The app's build runs it first (apps/web package.json `build`), so
// every deploy serves the extension of its own commit, until it is in the Chrome Web Store.
/* global console, process */
import { zipSync } from "fflate";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "..");
const target = path.join(web, "public", "extensao", "one-extensao.zip");
const built = mkdtempSync(path.join(tmpdir(), "one-extensao-"));

try {
  // ONE's production address: an extension a lawyer installs talks to the ONE they use, never to a preview.
  execFileSync(process.execPath, [path.join(here, "build.mjs"), "--out", built], {
    stdio: "inherit",
    env: { ...process.env, ONE_URL: "" },
  });
  // Every file inside one folder named after the extension, so unpacking gives the folder Chrome loads.
  const files = {};
  for (const name of readdirSync(built).sort()) {
    files[`one-extensao/${name}`] = [new Uint8Array(readFileSync(path.join(built, name))), { level: 9 }];
  }
  const zipped = zipSync(files);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, zipped);
  const { version } = JSON.parse(readFileSync(path.join(built, "manifest.json"), "utf8"));
  console.log(`extension ${version} packed: ${path.relative(process.cwd(), target)} (${zipped.byteLength} bytes)`);
} finally {
  rmSync(built, { recursive: true, force: true });
}
