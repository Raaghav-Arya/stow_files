// Requires an existing `tsc` on PATH; installs nothing.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { root } from "./pi-runtime.mjs";
const tmp = mkdtempSync(join(tmpdir(), "pi-hub-types-"));
try {
  const config = {
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true,
      noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true,
      types: ["node"], typeRoots: [join(root, "node_modules/@types")], baseUrl: root,
      paths: {
        "@earendil-works/pi-coding-agent": ["dist/index.d.ts"],
        "@earendil-works/pi-tui": ["node_modules/@earendil-works/pi-tui/dist/index.d.ts"],
        typebox: ["node_modules/typebox/build/index.d.mts"],
      },
    },
    include: [join(dirname(fileURLToPath(import.meta.url)), "../.pi/agent/extensions/agents-hub/*.ts")],
  };
  const path = join(tmp, "tsconfig.json");
  writeFileSync(path, JSON.stringify(config));
  const result = spawnSync("tsc", ["-p", path], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(tmp, { recursive: true, force: true }); }
