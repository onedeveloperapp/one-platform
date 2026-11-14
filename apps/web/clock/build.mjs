// Bundles the clock (clock/main.ts) into one file for ONE's server, from the same code and commit the app runs:
// `node apps/web/clock/build.mjs` writes apps/web/clock/dist/ (git-ignored) with relogio.mjs and the package.json of
// what stays outside the bundle (native modules, installed on the server's image), and the compose file that runs it.
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

// Native modules are not bundled: the image installs them, at the version the app has.
const EXTERNAL = ["sharp"];

// Outside the app's server, `server-only` has nothing to fence, and `after` of next/server throws (no request), which
// `soon` already reads as "the sweeps take it".
const stubs = {
  "server-only": "export {};",
  "next/server":
    "export function after() { throw new Error('outside a request'); }\n" +
    "export class NextResponse extends Response {}\nexport class NextRequest extends Request {}\n",
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const result = await build({
  entryPoints: [path.join(here, "main.ts")],
  outfile: path.join(out, "relogio.mjs"),
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
  plugins: [
    {
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
    },
  ],
});

const dependencies = Object.fromEntries(
  EXTERNAL.map((name) => [name, JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")).version]),
);
writeFileSync(
  path.join(out, "package.json"),
  JSON.stringify({ name: "one-relogio", private: true, type: "module", dependencies }, null, 2) + "\n",
);
// The service that runs it travels with it: each version is brought up from its own folder (receber.sh).
copyFileSync(path.join(here, "compose.yml"), path.join(out, "compose.yml"));
const bytes = Object.values(result.metafile.outputs).reduce((sum, output) => sum + output.bytes, 0);
console.log(`clock bundled: ${(bytes / 1e6).toFixed(1)} MB, external ${JSON.stringify(dependencies)}`);
