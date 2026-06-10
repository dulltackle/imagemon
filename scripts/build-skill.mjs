import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfiles = process.argv[2]
  ? [resolve(rootDir, process.argv[2])]
  : [
      resolve(rootDir, "skills/imagemon/scripts/imagemon.mjs"),
      resolve(rootDir, "skills/imagemon-promptdex/scripts/imagemon.mjs"),
    ];

for (const outfile of outfiles) {
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [resolve(rootDir, "src/cli.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    legalComments: "none",
  });

  console.log(`已生成 ${outfile}`);
}
