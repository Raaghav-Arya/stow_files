// Render a deterministic design preview without starting agents or model calls.
// node pi/tests/preview-agents-hub.mjs [--plain] [--light] [--empty] [--width=120] [--rows=30]
import { stripVTControlCharacters } from "node:util";
import { makeFixture } from "./hub-fixture.mjs";
const number = (name, fallback) => Number(process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1] || fallback);
const width = number("width", 120), rows = number("rows", 30);
if (!Number.isInteger(width) || width < 1 || width > 300 || !Number.isInteger(rows) || rows < 1 || rows > 100) throw new Error("Invalid preview dimensions");
const fixture = makeFixture({ width, rows, themeName: process.argv.includes("--light") ? "light" : "dark", empty: process.argv.includes("--empty") });
try {
  const lines = fixture.view.render(width);
  if (process.argv.includes("--plain")) {
    process.stdout.write(lines.map(stripVTControlCharacters).join("\n") + "\n");
  } else process.stdout.write(lines.join("\n") + "\n");
} finally { fixture.view.dispose(); }
