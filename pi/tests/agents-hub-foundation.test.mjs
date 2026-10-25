// Offline storage, admission, task-budget and interrupt contract tests. No model requests.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jiti } from "./pi-runtime.mjs";
const dir = fileURLToPath(new URL("../.pi/agent/extensions/agents-hub/", import.meta.url));
const { RotatingJournal, readJournal, writeJsonAtomic } = await jiti.import(join(dir, "storage.ts"));
const { AgentManager, configFrom, defaults } = await jiti.import(join(dir, "manager.ts"));
const tmp = mkdtempSync(join(tmpdir(), "pi-hub-foundation-"));
try {
  assert.deepEqual(defaults, { maxConcurrent: 16, maxAgents: 128, maxDepth: 3, maxTurns: 1000, timeoutMinutes: 240 });
  assert.equal(configFrom({}).maxConcurrent, 16);
  assert.equal(configFrom({}).maxAgents, 128);
  assert.equal(configFrom({}).maxDepth, 3);
  assert.equal(configFrom({}).maxTurns, 1000);
  assert.equal(configFrom({ maxConcurrent: 48, maxAgents: 512, maxDepth: 4, maxTurns: 10_000 }).maxDepth, 4);
  assert.throws(() => configFrom({ maxDepth: 0 }), /Invalid maxDepth/);

  const metadataPath = join(tmp, "nested", "agent.json");
  writeJsonAtomic(metadataPath, { version: 1, id: "stable", state: "idle" });
  assert.deepEqual(JSON.parse(readFileSync(metadataPath, "utf8")), { version: 1, id: "stable", state: "idle" });

  // Rotation is bounded and records are returned oldest-first, for 1/2/16 archives.
  for (const archives of [1, 2, 16]) {
    const path = join(tmp, `events-${archives}.jsonl`);
    const journal = new RotatingJournal(path, 1024, archives);
    for (let i = 0; i < archives * 3 + 2; i++) journal.append({ n: i, text: "x".repeat(280) });
    const names = readdirSync(tmp).filter((name) => name.startsWith(`events-${archives}.jsonl`));
    assert.ok(names.length <= archives + 1, `${archives}: ${names.length} segments`);
    const result = readJournal(path, archives);
    assert.deepEqual(result.errors, []);
    assert.ok(result.records.length >= archives);
    const values = result.records.map((record) => record.n);
    assert.deepEqual(values, [...values].sort((a, b) => a - b));
    assert.equal(values.at(-1), archives * 3 + 1);
    if (result.records.length < archives * 3 + 2) assert.ok(values[0] > 0, "rotation drops only older records");
  }

  const cwd = tmp;
  const connections = [];
  const manager = new AgentManager({ ...defaults, maxConcurrent: 1, maxTurns: 1 }, {
    root: join(tmp, "runtime"), parent() {}, connect(_agent, event) {
      const connection = { event, calls: [], closed: false, async request(type, fields) {
        this.calls.push({ type, fields });
        if (type === "get_state") return { model: { provider: "mock", id: "mock-model" }, thinkingLevel: "low", sessionFile: "session.jsonl" };
        if (type === "clear_queue") return { steering: ["queued steer"], followUp: ["queued follow up"] };
        if (type === "prompt") { event({ type: "agent_start" }); return { disposition: "started" }; }
        if (type === "abort") return {};
        return {};
      }, async close() { this.closed = true; } };
      connections.push(connection); return connection;
    },
  });
  const agent = await manager.launch({ task: "first task", provider: "mock", model: "mock-model", thinking: "low", cwd });
  assert.equal(agent.depth, 1);
  assert.equal(agent.parentId, undefined);
  assert.equal(agent.rootSessionId, "runtime");
  assert.ok(agent.taskId);
  assert.equal(agent.taskTurns, 0);
  assert.ok(!readFileSync(join(agent.directory, "agent.json"), "utf8").includes("journal"));
  connections[0].event({ type: "agent_settled" });
  const firstTaskId = agent.taskId;
  await manager.send(agent.id, "new explicit task", "user", "steer", true);
  assert.notEqual(agent.taskId, firstTaskId);
  assert.equal(agent.taskTurns, 0, "a prompt starts task budget; turns count at turn_start");
  assert.equal(agent.turns, 0);
  assert.equal(agent.state, "running");

  const recovered = await manager.interrupt(agent.id);
  assert.deepEqual(recovered, ["queued steer", "queued follow up"]);
  assert.deepEqual(connections[0].calls.slice(-2).map((call) => call.type), ["clear_queue", "abort"]);
  assert.equal(agent.state, "interrupted");
  assert.equal(connections[0].closed, false, "interrupt does not close the transport");
  assert.deepEqual(agent.recoverableQueue, recovered);
  await manager.stop(agent.id);
  assert.equal(agent.state, "stopped");
  await manager.shutdown();

  // A model-turn ceiling is tracked separately from lifetime turns and requests abort
  // while preserving the child connection and partial transcript.
  const budgetConnections = [];
  const budget = new AgentManager({ ...defaults, maxTurns: 1 }, {
    root: join(tmp, "budget"), parent() {}, connect(_agent, event) {
      const connection = { event, calls: [], closed: false, async request(type) {
        this.calls.push(type);
        if (type === "get_state") return { model: { provider: "mock", id: "mock-model" }, thinkingLevel: "low", sessionFile: "budget.jsonl" };
        return {};
      }, async close() { this.closed = true; } };
      budgetConnections.push(connection); return connection;
    },
  });
  const limited = await budget.launch({ task: "budget", provider: "mock", model: "mock-model", thinking: "low", cwd });
  const connection = budgetConnections[0];
  connection.event({ type: "turn_start" });
  assert.equal(limited.taskTurns, 1);
  connection.event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "partial result" } });
  connection.event({ type: "turn_start" });
  assert.equal(limited.state, "limited");
  assert.match(limited.error, /turn limit/);
  assert.equal(connection.calls.at(-1), "abort");
  assert.equal(connection.closed, false);
  assert.equal(limited.turns, 2, "lifetime and active-task counters remain distinct");
  assert.match(limited.output, /partial result/);
  connection.event({ type: "agent_settled" });
  assert.equal(limited.state, "limited");
  await budget.stop(limited.id);
  await budget.shutdown();

  // Root-wide limits count descendant allocations/connections and validate lineage.
  const tree = new AgentManager({ ...defaults, maxConcurrent: 2, maxAgents: 4, maxDepth: 2 }, {
    root: join(tmp, "tree"), parent() {}, connect(_agent) {
      const c = { async request(type) { if (type === "get_state") return { model: { provider: "mock", id: "mock-model" }, thinkingLevel: "low", sessionFile: "tree.jsonl" }; return { disposition: "started" }; }, async close() {} };
      return c;
    },
  });
  const root = await tree.launch({ task: "root", provider: "mock", model: "mock-model", thinking: "low", cwd });
  const child = await tree.launch({ task: "child", parentId: root.id, provider: "mock", model: "mock-model", thinking: "low", cwd });
  assert.equal(child.depth, 2);
  assert.equal(child.rootSessionId, "tree");
  await assert.rejects(tree.launch({ task: "too deep", parentId: child.id, provider: "mock", model: "mock-model", thinking: "low", cwd }), /depth/);
  await assert.rejects(tree.launch({ task: "unknown parent", parentId: "missing", provider: "mock", model: "mock-model", thinking: "low", cwd }), /Unknown agent/);
  await tree.shutdown();
  console.log("Agents Hub foundation tests passed (atomic metadata, 1/2/16 archive rotation, root lineage/limits, task budgets, interrupt ordering)");
} finally { rmSync(tmp, { recursive: true, force: true }); }
