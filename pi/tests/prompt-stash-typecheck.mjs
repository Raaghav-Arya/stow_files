// Uses existing tsc and installed Pi declarations; installs nothing.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { root } from "./pi-runtime.mjs";
const tmp = mkdtempSync(join(tmpdir(), "pi-stash-types-"));
try {
  const config = {
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true,
      noEmit: true, skipLibCheck: true, types: ["node"],
      typeRoots: [join(root, "node_modules/@types")], baseUrl: root,
      paths: { "@earendil-works/pi-coding-agent": ["dist/index.d.ts"] },
    },
    files: [fileURLToPath(new URL("../.pi/agent/extensions/prompt-stash/index.ts", import.meta.url))],
  };
  const path = join(tmp, "tsconfig.json");
  writeFileSync(path, JSON.stringify(config));
  const result = spawnSync("tsc", ["-p", path], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(tmp, { recursive: true, force: true }); }
