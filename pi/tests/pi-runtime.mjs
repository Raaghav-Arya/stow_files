// Resolve the installed Pi and its dependencies, without npm install.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
export let root = process.env.PI_PACKAGE_ROOT || dirname(realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim()));
while (!existsSync(join(root, "package.json")) || JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name !== "@earendil-works/pi-coding-agent") {
  const parent = dirname(root);
  if (parent === root) throw new Error("Cannot locate Pi; set PI_PACKAGE_ROOT");
  root = parent;
}
export const require = createRequire(join(root, "package.json"));
const { createJiti } = require("jiti");
export const jiti = createJiti(import.meta.url, { alias: {
  "@earendil-works/pi-coding-agent": join(root, "dist/index.js"),
  "@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"),
  "typebox": require.resolve("typebox"),
} });
