// Bundles the clock (clock/main.ts), ONE's own browser (clock/navegador.ts) and the converter of the firms' Word
// letterheads (clock/conversor.ts) for ONE's server, from the same code and commit the app runs: `node
// apps/web/clock/build.mjs` writes apps/web/clock/dist/ (git-ignored) with relogio.mjs, navegador.mjs, conversor.mjs,
// the script every page ONE's browser opens carries (pagina.js), the package.json of what stays outside the bundles
// (native modules and Playwright's core, installed on the server), and the compose file that runs them.
// The production deploy runs it and ships the folder to clock/receber.sh on ONE's server.
/* global console */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "..");
const out = path.join(here, "dist");
const require = createRequire(path.join(web, "package.json"));

// Native modules and Playwright's core are not bundled: the server installs them, at the versions the app has.
const EXTERNAL = ["sharp", "playwright-core"];

// Outside the app's server, `server-only` has nothing to fence, and `after` of next/server throws (no request), which
// `soon` already reads as "the sweeps take it".
const stubs = {
  "server-only": "export {};",
  "next/server":
    "export function after() { throw new Error('outside a request'); }\n" +
    "export class NextResponse extends Response {}\nexport class NextRequest extends Request {}\n",
};

const stubPlugin = {
  name: "stubs",
  setup(b) {
    const filter = new RegExp(
      `^(${Object.keys(stubs)
        .map((s) => s.replace("/", "\\/"))
        .join("|")})$`,
    );
    b.onResolve({ filter }, (args) => ({ path: args.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
  },
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/** One service for Node on the server: its entry bundled whole, but for what the server installs. */
const service = (entry, file) =>
  build({
    entryPoints: [path.join(here, entry)],
    outfile: path.join(out, file),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    tsconfig: path.join(web, "tsconfig.json"),
    external: EXTERNAL,
    // Bundled CommonJS that calls require() still finds node's own modules.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    define: { "process.env.NEXT_RUNTIME": '"nodejs"' },
    loader: { ".node": "copy" },
    logLevel: "warning",
    metafile: true,
    legalComments: "none",
    plugins: [stubPlugin],
  });

const results = await Promise.all([
  service("main.ts", "relogio.mjs"),
  service("navegador.ts", "navegador.mjs"),
  service("conversor.ts", "conversor.mjs"),
  // The script every frame of ONE's browser carries, run in the court's page.
  build({
    entryPoints: [path.join(web, "src/lib/court-browser/page-script.ts")],
    outfile: path.join(out, "pagina.js"),
    bundle: true,
    platform: "browser",
    target: "chrome120",
    format: "iife",
    tsconfig: path.join(web, "tsconfig.json"),
    logLevel: "warning",
    metafile: true,
    legalComments: "none",
  }),
]);

// Playwright's core at the version of the app's Playwright, whose browsers the server's image carries.
const playwright = JSON.parse(readFileSync(require.resolve("playwright/package.json"), "utf8"));
const versions = {
  sharp: JSON.parse(readFileSync(require.resolve("sharp/package.json"), "utf8")).version,
  "playwright-core": playwright.dependencies["playwright-core"],
};
const compose = readFileSync(path.join(here, "compose.yml"), "utf8");
const image = `mcr.microsoft.com/playwright:v${versions["playwright-core"]}-noble`;
if (!compose.includes(`image: ${image}`)) {
  throw new Error(`compose.yml must run ONE's browser in ${image}, the image of the app's Playwright`);
}
writeFileSync(
  path.join(out, "package.json"),
  JSON.stringify({ name: "one-relogio", private: true, type: "module", dependencies: versions }, null, 2) + "\n",
);
// The services that run them travel with them: each version is brought up from its own folder (receber.sh).
copyFileSync(path.join(here, "compose.yml"), path.join(out, "compose.yml"));
const bytes = results.map((result) =>
  (Object.values(result.metafile.outputs).reduce((sum, output) => sum + output.bytes, 0) / 1e6).toFixed(1),
);
console.log(
  `clock bundled: relogio ${bytes[0]} MB, navegador ${bytes[1]} MB, conversor ${bytes[2]} MB, pagina ${bytes[3]} MB, external ${JSON.stringify(versions)}`,
);
