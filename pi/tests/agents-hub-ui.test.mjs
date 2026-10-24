// node pi/tests/agents-hub-ui.test.mjs — real Pi themes/TUI, no model calls.
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jiti } from "./pi-runtime.mjs";
import { makeFixture } from "./hub-fixture.mjs";
const { visibleWidth } = await jiti.import("@earendil-works/pi-tui");
const directory = fileURLToPath(new URL("../.pi/agent/extensions/agents-hub/", import.meta.url));
const { plain, hubOverlayOptions } = await jiti.import(join(directory, "view.ts"));
const { renderAgentReport } = await jiti.import(join(directory, "notifications.ts"));
const { toolPreview, resultPreview } = await jiti.import(join(directory, "activity.ts"));

for (const themeName of ["dark", "light"]) {
  for (const mode of ["fullscreen", "regular"]) {
    for (const width of [1, 5, 15, 16, 24, 48, 80, 100, 120, 180]) {
      for (const rows of [1, 7, 8, 12, 24, 40]) {
        for (const empty of [false, true]) {
          const fixture = makeFixture({ width, rows, mode, themeName, empty });
          try {
            const output = fixture.view.render(width);
            const height = mode === "regular" ? Math.max(1, Math.floor(rows * 0.8)) : rows;
            assert.ok(output.length <= height, `${width}x${rows} ${mode}: too many rows`);
            assert.ok(output.every((line) => visibleWidth(line) <= width), `${width}x${rows}: overflow`);
            assert.ok(output.every((line) => !line.includes("\n")), "embedded newline");
            assert.match(output.join(""), /\x1b\[/, "theme colors/styles must actually be emitted");
            if (width >= 16 && height >= 8) {
              assert.ok(plain(output.at(-1)).endsWith("╯"), "bottom border/action area must stay on screen");
            }
          } finally { fixture.view.dispose(); }
          assert.equal(fixture.listeners, 0);
        }
      }
    }
  }
}

const fixture = makeFixture();
try {
  const screen = fixture.view.render(120).map(plain).join("\n");
  for (const label of ["Agents Hub", "AGENTS", "auth-review", "RUNNING", "IDLE", "FAILED", "Activity", "LIVE", "gpt-example"]) assert.ok(screen.includes(label), label);
  assert.ok(!screen.includes('"content"'), "raw tool JSON should not be the conversation UI");
  assert.ok(!screen.includes("export function"), "tool results are collapsed by default");
  fixture.view.handleInput("o");
  assert.ok(fixture.view.render(120).map(plain).join("\n").includes("export function"));
  fixture.view.handleInput("\t");
  assert.ok(fixture.view.render(120).map(plain).join("\n").includes("Event log"));
  fixture.view.handleInput("\x1b[F"); // End reaches task at bottom of scrollable details.
  assert.ok(fixture.view.render(120).map(plain).join("\n").includes("Task"));
  fixture.view.handleInput("\t");
  fixture.agents[0].activity[2].text += "\n\n" + Array.from({ length: 30 }, (_, i) => `Paragraph ${i}.`).join("\n\n");
  fixture.view.render(120);
  fixture.view.handleInput("\x1b[5~");
  assert.ok(fixture.view.render(120).map(plain).join("\n").includes("PAUSED"));
  const frozen = fixture.view.render(120);
  fixture.agents[0].activity[2].text += "\nnew-streamed-chunk";
  assert.deepEqual(fixture.view.render(120), frozen);
  fixture.view.handleInput("\x1b[F");
  assert.ok(fixture.view.render(120).map(plain).join("\n").includes("new-streamed-chunk"));
  fixture.view.handleInput("\x0e"); // existing Ctrl+N selection
  fixture.view.handleInput("m");
  assert.equal(fixture.action.id, fixture.agents[1].id);
  fixture.view.handleInput("\x1b[110;1:3u"); // Kitty release for n must not launch
  assert.equal(fixture.action.type, "message");

  fixture.agents[1].name = "界\n\x1b]52;c;clipboard\x07";
  fixture.agents[1].task = "multi\nline\u2028task";
  const safe = fixture.view.render(120);
  assert.ok(!safe.join("").includes("\x1b]52"));
  assert.ok(safe.every((line) => !line.includes("\n") && visibleWidth(line) <= 120));

  const report = { customType: "agents-hub", content: 'raw tool trace: {"content":"do not dump by default"}', display: true,
    details: { agentId: "agent-1", agentName: "scout", kind: "settled" } };
  const compact = renderAgentReport(report, { expanded: false, outputPad: 0 }, fixture.theme).render(80).map(plain).join("\n");
  const expanded = renderAgentReport(report, { expanded: true, outputPad: 0 }, fixture.theme).render(80).map(plain).join("\n");
  assert.ok(compact.includes("Result available"));
  assert.ok(!compact.includes("raw tool trace"));
  assert.ok(expanded.includes("raw tool trace"));
} finally { fixture.view.dispose(); }

assert.deepEqual(hubOverlayOptions({ mode: "fullscreen" }), { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 });
assert.equal(hubOverlayOptions({ mode: "regular" }).maxHeight, "80%");
assert.equal(toolPreview("read", { path: "example.ts", offset: 3 }), "example.ts");
assert.equal(toolPreview("write", { path: "file", content: "very large source" }), "file");
assert.equal(resultPreview({ content: [{ type: "text", text: "ok" }, { type: "image" }] }), "ok\n[image]");
console.log("Agents Hub UI tests passed (themes, responsive layouts, activity, controls, compact reports)");
