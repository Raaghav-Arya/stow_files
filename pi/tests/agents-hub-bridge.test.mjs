// Offline child bridge behavior and installed-Pi IPC configuration/delivery smoke.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jiti, root } from "./pi-runtime.mjs";
const dir = fileURLToPath(new URL("../.pi/agent/extensions/agents-hub/", import.meta.url));
const { default: bridge } = await jiti.import(join(dir, "bridge.ts"));
const { RpcTransport } = await jiti.import(join(dir, "rpc.ts"));
const tmp = mkdtempSync(join(tmpdir(), "hub-bridge-"));
const transports = [];
const oldChild = process.env.PI_AGENTS_HUB_CHILD;
try {
  process.env.PI_AGENTS_HUB_CHILD = "1";
  const tools = new Map();
  const mockPi = { registerTool: (tool) => tools.set(tool.name, tool), on() {}, sendMessage() {} };
  bridge(mockPi);
  assert.deepEqual([...tools.keys()], ["message_parent", "agents"]);
  await assert.rejects(tools.get("agents").execute("id", { method: "launch", params: { task: "nested" } }), /not configured/);
  await assert.rejects(tools.get("message_parent").execute("id", { message: "question", kind: "needs_input" }), /requestId/);
  await assert.rejects(tools.get("message_parent").execute("id", { message: "" }), /1\.\.8000/);
  const legacy = await tools.get("message_parent").execute("id", { message: "old-compatible message" });
  assert.equal(legacy.details.parentMessage, "old-compatible message");
  assert.equal(legacy.details.parentKind, "progress");
  await assert.rejects(tools.get("agents").execute("id", { method: "launch", params: {} }), /not configured/);

  const identity = { agentId: "real-child", parentId: "root", depth: 1 };
  const received = [];
  const rpc = new RpcTransport(process.execPath, [join(root, "dist/cli.js"), "--mode", "rpc", "--offline", "--no-session", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-approve", "--extension", join(dir, "bridge.ts"), "--tools", "read,message_parent,agents"], tmp, (event) => received.push(event), () => {}, 10_000, {}, { ipc: true, identity, onControlRequest: (request, context) => ({ request, caller: context.caller }) });
  transports.push(rpc);
  assert.equal((await rpc.request("get_state")).isStreaming, false);
  const config = { ...identity, taskId: "task-1", maxTurns: 1000, usedTurns: 5,
    rootPolicy: { allowNested: true, maxDepth: 3, maxAgents: 128, maxConcurrent: 16 } };
  assert.deepEqual(await rpc.configure(config), { configured: true, taskId: "task-1" });
  await rpc.deliver({ from: "trusted-parent", text: "Non-waking progress", kind: "progress", taskId: "task-1" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  // An explicit request uses the same dedicated channel; no child-supplied identity is accepted.
  await assert.rejects(rpc.requestBridge("hub.not-supported", {}), /Unsupported root bridge method/);
  const commands = await rpc.request("get_commands");
  assert.ok(Array.isArray(commands.commands));
  await rpc.close();
  console.log("Agents Hub bridge tests passed (legacy message, no-supervisor refusal, typed input, installed Pi IPC configure/delivery)");
} finally {
  if (oldChild === undefined) delete process.env.PI_AGENTS_HUB_CHILD; else process.env.PI_AGENTS_HUB_CHILD = oldChild;
  await Promise.allSettled(transports.map((t) => t.close()));
  rmSync(tmp, { recursive: true, force: true });
}
