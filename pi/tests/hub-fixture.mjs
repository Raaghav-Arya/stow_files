// Deterministic UI fixture. No processes, credentials, model requests or timers.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jiti, root } from "./pi-runtime.mjs";
const extensionDir = fileURLToPath(new URL("../.pi/agent/extensions/agents-hub/", import.meta.url));
const { HubView } = await jiti.import(join(extensionDir, "view.ts"));
const { KeybindingsManager } = await jiti.import(join(root, "dist/core/keybindings.js"));
const { loadThemeFromPath } = await jiti.import(join(root, "dist/modes/interactive/theme/theme.js"));
export function makeFixture({ width = 120, rows = 30, mode = "fullscreen", themeName = "dark", empty = false } = {}) {
  const theme = loadThemeFromPath(join(root, `dist/modes/interactive/theme/${themeName}.json`), "truecolor");
  const states = ["running", "idle", "failed", "starting", "stopped"];
  const names = ["auth-review", "ui-scout", "test-runner", "docs-review", "old-scout"];
  const agents = states.map((state, i) => ({
    id: `agent-${i}-123456789`, name: names[i], state,
    task: ["Review the authentication flow and report concrete risks.", "Inspect existing UI conventions.", "Run the focused test suite.", "Review public API documentation.", "Previous investigation."][i],
    provider: "openai", model: "gpt-example", thinking: "medium",
    workspace: "/home/user/projects/example", tools: ["read", "grep", "find", "ls"],
    sessionFile: `/home/user/.pi/agent/agents-hub/run/agent-${i}/session.jsonl`,
    log: `/home/user/.pi/agent/agents-hub/run/agent-${i}/events.jsonl`,
    tokens: 14200 + i * 3000, turns: 4 + i, cost: 0.0124 + i * 0.003,
    mails: [], output: "", error: state === "failed" ? "Test command exited with status 1" : undefined,
    activity: [
      { kind: "message", label: "Main session", text: "Inspect authentication. Return findings, not changes." },
      { kind: "tool", label: "read", text: "src/auth/session.ts", state: "done", result: "export function session() { /* implementation */ }" },
      { kind: "assistant", text: "### Authentication review\n\nThe session flow is easy to follow. I verified **token expiry** and the refresh path.\n\n- Expiry is checked before access.\n- Refresh errors are surfaced to the caller.\n\nOne edge case needs a closer look: concurrent refresh requests." },
      { kind: "tool", label: "grep", text: "refreshToken in src/auth", state: "running" },
    ],
  }));
  let listeners = 0, lastAction;
  const manager = { agents: new Map(empty ? [] : agents.map((agent) => [agent.id, agent])),
    subscribe() { listeners++; return () => listeners--; } };
  const tui = { mode, terminal: { columns: width, rows }, requestRender() {} };
  const keys = new KeybindingsManager({ "tui.select.up": ["up", "ctrl+p"], "tui.select.down": ["down", "ctrl+n"] });
  const view = new HubView(manager, tui, theme, keys, (action) => { lastAction = action; });
  return { view, manager, agents, tui, theme, get listeners() { return listeners; }, get action() { return lastAction; } };
}
