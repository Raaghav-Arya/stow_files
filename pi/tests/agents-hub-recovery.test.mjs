// Offline owner-lock, conservative restore/resume, event observation, input-state, and large journal record checks.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jiti } from "./pi-runtime.mjs";
const dir = fileURLToPath(new URL("../.pi/agent/extensions/agents-hub/", import.meta.url));
const { AgentManager, defaults } = await jiti.import(join(dir, "manager.ts"));
const { RotatingJournal } = await jiti.import(join(dir, "storage.ts"));
const tmp = mkdtempSync(join(tmpdir(), "hub-recovery-"));
const root = join(tmp, "root-session");
const cwd = tmp;
let sessionFile;
let lastEvent;
const factory = () => new AgentManager(defaults, {
  root, parent() {}, connect(agent, event) {
    lastEvent = event;
    sessionFile = join(agent.directory, "sessions", "retained.jsonl");
    mkdirSync(join(agent.directory, "sessions"), { recursive: true });
    writeFileSync(sessionFile, '{"type":"session"}\n');
    return { async request(type) {
      if (type === "get_state") return { model: { provider: "mock", id: "model" }, thinkingLevel: "high", sessionFile };
      if (type === "prompt") { event({ type: "agent_start" }); return { disposition: "started" }; }
      return {};
    }, async close() {} };
  },
});
try {
  const manager = factory();
  const agent = await manager.launch({ task: "retain context", provider: "mock", model: "model", thinking: "high", cwd });
  let seen;
  const unsubscribe = manager.observe((record, event) => { if (event.type === "agent_settled") seen = { state: record.state, settled: record.settled }; });
  manager.setWaitingInput(agent.id, "request-1");
  assert.equal(agent.state, "waiting-input");
  assert.equal(agent.waitingRequestId, "request-1");
  assert.throws(() => manager.resolveInput(agent.id, "stale"), /mismatched/);
  manager.resolveInput(agent.id, "request-1");
  assert.equal(agent.state, "running");
  lastEvent({ type: "agent_settled" });
  assert.deepEqual(seen, { state: "idle", settled: true }, "observers see post-transition state");
  unsubscribe();
  await assert.rejects(async () => factory(), /already owned/);
  const id = agent.id;
  await manager.shutdown();

  const recoveredManager = factory();
  const recovered = recoveredManager.get(id);
  assert.equal(recovered.state, "stopped", "persisted running never asserts a live process");
  assert.equal(recovered.sessionFile, sessionFile);
  assert.equal(recovered.task, "retain context");
  assert.equal((await recoveredManager.resume(id)).state, "idle");
  await recoveredManager.shutdown();

  const largePath = join(tmp, "large.jsonl");
  const journal = new RotatingJournal(largePath, 1024, 2);
  journal.append({ text: "x".repeat(16 * 1024) });
  assert.equal(statSync(largePath).size > 16 * 1024, true);
  console.log("Agents Hub recovery tests passed (exclusive ownership, conservative restore/explicit resume, post-state observation, blocked input, oversized journal entry)");
} finally { rmSync(tmp, { recursive: true, force: true }); }
