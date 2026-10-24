import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { jiti, root } from "./pi-runtime.mjs";

const extension = (await jiti.import(new URL("../.pi/agent/extensions/clear-alias/index.ts", import.meta.url).pathname)).default;
const { AgentSessionRuntime } = await import(pathToFileURL(join(root, "dist/core/agent-session-runtime.js")));
const { SessionManager } = await import(pathToFileURL(join(root, "dist/core/session-manager.js")));
function command() {
  const commands = new Map();
  extension({ registerCommand(name, definition) { assert.ok(!commands.has(name)); commands.set(name, definition); } });
  assert.deepEqual([...commands.keys()], ["clear"]);
  return commands.get("clear");
}

test("discoverable command delegates exactly once with no options or post-replacement context access", async () => {
  const c = command();
  assert.match(c.description, /alias for \/new/);
  let calls = 0;
  const ctx = new Proxy({}, { get(_, key) {
    assert.equal(key, "newSession");
    assert.equal(calls, 0, "must not access stale context");
    return async (...args) => { assert.deepEqual(args, []); calls++; return { cancelled: false }; };
  } });
  await c.handler("", ctx);
  assert.equal(calls, 1);
});

test("cancellation and errors are not retried, hidden or followed by context/UI mutation", async () => {
  for (const result of [{ cancelled: true }, new Error("runtime replacement failed")]) {
    let calls = 0;
    const ctx = { async newSession() { calls++; if (result instanceof Error) throw result; return result; } };
    if (result instanceof Error) await assert.rejects(command().handler("", ctx), result);
    else await command().handler("", ctx);
    assert.equal(calls, 1);
  }
});

test("fresh registration on reload holds no old context or session state", async () => {
  let a = 0, b = 0;
  await command().handler("", { async newSession() { a++; return { cancelled: false }; } });
  await command().handler("ignored arguments", { async newSession() { b++; return { cancelled: false }; } });
  assert.deepEqual([a, b], [1, 1]);
});

// Exercise installed production replacement/SessionManager, not a reimplementation.
// Services/runner are fakes: no credentials, model requests or live UI are loaded.
for (const veto of [true, false]) test(`installed runtime: veto=${veto}, lifecycle and old persisted session preservation`, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-clear-test-"));
  try {
    const events = [];
    const manager = SessionManager.create(dir, dir);
    manager.appendMessage({ role: "user", content: "old conversation", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "saved" }], api: "anthropic-messages", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const oldFile = manager.getSessionFile();
    const oldBytes = readFileSync(oldFile, "utf8");
    const oldId = manager.getSessionId();
    const session = {
      sessionManager: manager, sessionFile: oldFile,
      extensionRunner: {
        hasHandlers: () => true,
        emit: async e => { events.push(e.type + ":" + e.reason); return e.type === "session_before_switch" ? { cancel: veto } : undefined; },
      },
      abort: async () => { events.push("abort"); },
      dispose: () => { events.push("dispose"); },
    };
    const runtime = new AgentSessionRuntime(session, { cwd: dir, agentDir: dir }, async options => {
      events.push(options.sessionStartEvent.type + ":" + options.sessionStartEvent.reason);
      assert.equal(options.sessionStartEvent.previousSessionFile, oldFile);
      assert.equal(options.cwd, dir);
      return { session: { sessionManager: options.sessionManager }, services: { cwd: dir, agentDir: dir }, diagnostics: [] };
    });
    runtime.setRebindSession(async () => { events.push("rebind"); });
    await command().handler("", { newSession: options => runtime.newSession(options) });
    assert.equal(readFileSync(oldFile, "utf8"), oldBytes);
    assert.equal(SessionManager.open(oldFile).getSessionId(), oldId);
    if (veto) {
      assert.equal(runtime.session, session);
      assert.deepEqual(events, ["session_before_switch:new"]);
    } else {
      assert.notEqual(runtime.session.sessionManager.getSessionId(), oldId);
      assert.deepEqual(runtime.session.sessionManager.getEntries(), []);
      assert.deepEqual(events, ["session_before_switch:new", "abort", "session_shutdown:new", "dispose", "session_start:new", "rebind"]);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
