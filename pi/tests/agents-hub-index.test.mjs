// Public Agents Hub adapter integration with fake Pi callbacks; no provider/model requests.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { jiti } from "./pi-runtime.mjs";
const dir = fileURLToPath(new URL("../.pi/agent/extensions/agents-hub/", import.meta.url));
const { default: extension, sendRosterMessage } = await jiti.import(join(dir, "index.ts"));
const { HubControl } = await jiti.import(join(dir, "control.ts"));
const tmp = mkdtempSync(join(tmpdir(), "hub-index-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(tmp, "agent-config");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "agents-hub.json"), JSON.stringify({ notifications: { mode: "active" } }));
const tools = new Map(), handlers = new Map(), connections = [], sent = [];
// Exercise the production roster adapter: only accepted deliberate work
// releases the provider-failure hold, never a correlated input hold.
const rosterHolds = new Set(["work-failed", "waiting-input"]);
const rosterRecord = { id: "roster-target", parentId: undefined, state: "work-failed" };
let rosterSendOutcome = "queued";
const rosterManager = { agents: new Map([[rosterRecord.id, rosterRecord]]), get(id) { if (id !== rosterRecord.id) throw new Error("Unknown"); return rosterRecord; },
  async send() { if (rosterSendOutcome instanceof Error) throw rosterSendOutcome; return { state: rosterSendOutcome }; } };
const rosterControl = new HubControl({ manager: rosterManager, launch: async () => {}, afterSend(_id, result) {
  if (result?.state === "queued" || result?.state === "delivered") rosterHolds.delete("work-failed");
} });
const pi = {
  registerMessageRenderer() {}, registerShortcut() {}, registerCommand() {}, registerTool(tool) { tools.set(tool.name, tool); },
  on(name, handler) { handlers.set(name, handler); }, getThinkingLevel() { return "high"; },
  sendMessage(message, options) { sent.push({ message, options }); },
  events: { listeners: new Map(), on(name, listener) { this.listeners.set(name, listener); }, emit(name, value) { if (name === "plan-mode:request-state") this.listeners.get("plan-mode:state")?.({ version: 1, mode: "normal" }); else if (name === "plan-mode:quiesce") value?.waitUntil?.(Promise.resolve()); } },
};
extension(pi, { connect(agent, onEvent, onExit, onControlRequest) {
  const connection = { agent, onEvent, onExit, onControlRequest, calls: [], closed: false,
    async request(type, args) {
      this.calls.push({ type, args });
      if (type === "get_state") return { model: { provider: agent.provider, id: agent.model }, thinkingLevel: agent.thinking, sessionFile: join(agent.directory, "fake-session.jsonl") };
      if (type === "prompt") { onEvent({ type: "agent_start" }); return { disposition: "started" }; }
      if (type === "clear_queue") return { steering: [], followUp: [] };
      return {};
    }, async configure() { return {}; }, async requestBridge(method, params) { this.calls.push({ method, params }); return {}; }, async close() { this.closed = true; },
  };
  connections.push(connection); return connection;
} });
const ctx = { mode: "rpc", cwd: tmp, model: { provider: "fake", id: "offline" }, sessionManager: { getSessionId: () => "index-fixture" }, isProjectTrusted: () => false,
  ui: { notify() {}, setStatus() {}, confirm: async () => true } };
const tool = tools.get("agents");
assert.ok(tool, "registered public tool exists");
const execute = async (params) => tool.execute("call", params, undefined, undefined, ctx);
try {
  await sendRosterMessage(rosterControl, rosterRecord.id, "continue", "steer");
  assert.deepEqual([...rosterHolds], ["waiting-input"], "accepted roster send releases only work-failed, never correlated input gate");
  rosterHolds.add("work-failed"); rosterSendOutcome = new Error("RPC rejected before acceptance");
  await assert.rejects(sendRosterMessage(rosterControl, rosterRecord.id, "rejected", "steer"), /rejected/);
  assert.ok(rosterHolds.has("work-failed"), "rejected roster send preserves work-failed hold");
  rosterSendOutcome = new Error("acknowledgement timed out; delivery unknown");
  await assert.rejects(sendRosterMessage(rosterControl, rosterRecord.id, "unknown", "steer"), /unknown/);
  assert.ok(rosterHolds.has("work-failed"), "uncertain roster send preserves work-failed hold");
  rosterRecord.state = "waiting-input"; rosterSendOutcome = "queued";
  await sendRosterMessage(rosterControl, rosterRecord.id, "uncorrelated", "steer");
  assert.ok(rosterHolds.has("waiting-input"), "ordinary roster send does not clear correlated input gate");

  const launched = JSON.parse((await execute({ action: "launch", task: "parent task" })).content[0].text);
  const parent = connections[0];
  assert.equal(launched.state, "running");
  const childResult = await parent.onControlRequest({ method: "agents.launch", params: { task: "child task" } }, { caller: { agentId: launched.id } });
  const child = connections[1];
  assert.equal(childResult.parentId, launched.id);
  assert.equal(childResult.provider, "fake");
  assert.equal(childResult.model, "offline");
  assert.equal(child.calls.find(call => call.type === "prompt").args.message.includes(`From ${launched.id}`), true, "initial nested task preserves parent provenance");
  parent.onEvent({ type: "agent_settled", aborted: false });
  // Child's authenticated IPC callback is the same control plane as root tools.
  await child.onControlRequest({ method: "agents.send", params: { id: childResult.id, message: "parent directs child" } }, { caller: { agentId: launched.id } });
  assert.equal(child.calls.at(-1).type, "prompt");
  assert.match(child.calls.at(-1).args.message, new RegExp(`From ${launched.id}`));
  await assert.rejects(child.onControlRequest({ method: "agents.send", params: { id: launched.id, message: "forged" } }, { caller: { agentId: childResult.id } }), /subtree/);

  // Input-needed event is delivered to the parent while this child's inbound auto-wake is held.
  await child.onControlRequest({ method: "message_parent", params: { message: "Need a decision", kind: "needs_input", requestId: "request-1" } }, { caller: { agentId: childResult.id } });
  child.onEvent({ type: "agent_settled", aborted: false });
  await new Promise(resolve => setTimeout(resolve, 260));
  assert.ok(sent.some(item => item.options?.triggerTurn === true), "idle parent notification wakes via triggerTurn");
  assert.ok(sent.some(item => item.options?.deliverAs === "steer"), "idle parent notification is steering, not queue-only follow-up");
  const statuses = JSON.parse((await execute({ action: "notifications", id: "main" })).content[0].text);
  assert.ok(statuses.snapshots.some(snapshot => snapshot.state === "injected"));
  const childStatus = JSON.parse((await execute({ action: "notifications", id: childResult.id })).content[0].text);
  assert.ok(childStatus.holds.includes("waiting-input"), "recipient agent is held pending deliberate reply");
  await assert.rejects(execute({ action: "notifications", id: childResult.id, message: "drain" }), /held|busy|in-flight/);
  const reply = await execute({ action: "reply", id: childResult.id, requestId: "request-1", message: "Proceed" });
  assert.ok(reply);
  const replyPrompt = child.calls.filter(call => call.type === "prompt").at(-1);
  assert.match(replyPrompt.args.message, /From main to agent/, "model-facing root reply provenance is preserved");
  const resumedChildStatus = JSON.parse((await execute({ action: "notifications", id: childResult.id })).content[0].text);
  assert.ok(!resumedChildStatus.holds.includes("waiting-input"));

  // The registered root adapter keeps a provider-failed child connected and
  // holds its inbound events until a deliberate accepted continuation.
  const failedWorkSummary = JSON.parse((await execute({ action: "launch", task: "provider failure fixture" })).content[0].text);
  const failedWorkConnection = connections[2];
  failedWorkConnection.onEvent({ type: "turn_start" });
  failedWorkConnection.onEvent({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "fixture provider failure", content: [{ type: "text", text: "partial result" }] } });
  failedWorkConnection.onEvent({ type: "agent_end", willRetry: false });
  failedWorkConnection.onEvent({ type: "agent_settled", aborted: false });
  assert.equal(failedWorkSummary.id, failedWorkConnection.agent.id);
  assert.equal(failedWorkConnection.agent.state, "work-failed");
  assert.equal(failedWorkConnection.closed, false);
  const failedWorkNotifications = JSON.parse((await execute({ action: "notifications", id: failedWorkSummary.id })).content[0].text);
  assert.ok(failedWorkNotifications.holds.includes("work-failed"));
  const immutableResult = JSON.parse((await execute({ action: "result", id: failedWorkSummary.id, taskId: failedWorkConnection.agent.taskId, revision: 1 })).content[0].text);
  assert.equal(immutableResult.status, "failed");
  assert.equal(immutableResult.artifact.includes("partial result"), true);
  const consumedNotice = JSON.parse((await execute({ action: "notifications", id: "main" })).content[0].text);
  const failedNotice = consumedNotice.pending.find(event => event.sourceAgentId === failedWorkSummary.id);
  assert.equal(failedNotice, undefined, "matching model-facing result reads consume the addressed lifecycle event");
  await assert.rejects(execute({ action: "result", id: failedWorkSummary.id, taskId: "stale-task", revision: 1 }), /not found/);
  const continuation = await execute({ action: "send", id: failedWorkSummary.id, message: "deliberate continuation" });
  assert.ok(continuation);
  assert.equal(failedWorkConnection.agent.state, "running");
  const resumedWorkNotifications = JSON.parse((await execute({ action: "notifications", id: failedWorkSummary.id })).content[0].text);
  assert.ok(!resumedWorkNotifications.holds.includes("work-failed"));

  // Correct Pi event contracts: abort is on agent_settled.aborted; handled slash commands don't latch busy.
  handlers.get("agent_settled")({ aborted: true }, ctx);
  const interrupted = JSON.parse((await execute({ action: "notifications", id: "main" })).content[0].text);
  assert.ok(interrupted.holds.includes("explicit-interrupt"));
  handlers.get("input")({ source: "interactive", text: "/agents" }, ctx);
  assert.ok(!JSON.parse((await execute({ action: "notifications", id: "main" })).content[0].text).holds.includes("human-input"));
  handlers.get("input")({ source: "interactive", text: "Continue" }, ctx);
  assert.ok(JSON.parse((await execute({ action: "notifications", id: "main" })).content[0].text).holds.includes("human-input"));
  handlers.get("agent_start")({}, ctx);
  assert.ok(!JSON.parse((await execute({ action: "notifications", id: "main" })).content[0].text).holds.includes("human-input"));
  handlers.get("agent_settled")({ aborted: false }, ctx);
  assert.ok(!JSON.parse((await execute({ action: "notifications", id: "main" })).content[0].text).holds.includes("human-input"));

  // Strict recipient-scoped reconciliation, not arbitrary paths or injected recipient identity.
  const deliveryId = statuses.snapshots.find(snapshot => snapshot.state === "injected").id;
  const eventIds = statuses.snapshots.find(snapshot => snapshot.id === deliveryId).eventIds;
  await execute({ action: "notifications", id: "main", deliveryId, eventIds, observedStatus: "observed" });
  await assert.rejects(execute({ action: "notifications", id: "/tmp/not-a-recipient" }), /Unknown agent/);
  await handlers.get("session_shutdown")({}, ctx);
  assert.equal(connections.every(connection => connection.closed), true);
  console.log("Agents Hub index tests passed (registered tool, nested IPC, notification wake/holds/reply, event contracts, shutdown)");
} finally {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  rmSync(tmp, { recursive: true, force: true });
}
