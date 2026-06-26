import { mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultTargets = [
  {
    entryPoint: resolve(rootDir, "src/cli.ts"),
    outfile: resolve(rootDir, ".agents/skills/imagemon/scripts/imagemon.mjs"),
  },
  {
    entryPoint: resolve(rootDir, "src/cli.ts"),
    outfile: resolve(rootDir, ".agents/skills/imagemon-promptdex/scripts/imagemon.mjs"),
  },
  {
    entryPoint: resolve(rootDir, "src/promptdex-runtime.ts"),
    outfile: resolve(rootDir, ".agents/skills/imagemon-promptdex/scripts/promptdex.mjs"),
  },
];

const targets = process.argv[2] ? [targetForOutfile(resolve(rootDir, process.argv[2]))] : defaultTargets;

for (const { entryPoint, outfile } of targets) {
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    legalComments: "none",
    plugins: [workspaceCorePlugin()],
  });

  console.log(`已生成 ${outfile}`);
}

function targetForOutfile(outfile) {
  return {
    entryPoint: resolve(rootDir, basename(outfile) === "promptdex.mjs" ? "src/promptdex-runtime.ts" : "src/cli.ts"),
    outfile,
  };
}

function workspaceCorePlugin() {
  return {
    name: "workspace-core",
    setup(buildContext) {
      buildContext.onResolve({ filter: /^@imagemon\/core$/ }, () => ({
        path: resolve(rootDir, "packages/core/src/index.ts"),
      }));
      buildContext.onResolve({ filter: /^@imagemon\/core\/promptdex$/ }, () => ({
        path: resolve(rootDir, "packages/core/src/promptdex.ts"),
      }));
    },
  };
}
