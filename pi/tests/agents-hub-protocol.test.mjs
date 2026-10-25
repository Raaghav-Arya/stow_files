// Offline protocol validation and Node child-process IPC framing/correlation tests.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jiti, root } from "./pi-runtime.mjs";
const dir = fileURLToPath(new URL("../.pi/agent/extensions/agents-hub/", import.meta.url));
const { RpcTransport } = await jiti.import(join(dir, "rpc.ts"));
const { parseControlEnvelope, HUB_PROTOCOL, HUB_PROTOCOL_VERSION, MAX_CONTROL_FRAME_BYTES } = await jiti.import(join(dir, "protocol.ts"));
const tmp = mkdtempSync(join(tmpdir(), "hub-protocol-"));
const transports = [];
try {
  const envelope = { protocol: HUB_PROTOCOL, version: HUB_PROTOCOL_VERSION, kind: "request", id: "x_1", method: "agents.list", params: {} };
  assert.deepEqual(parseControlEnvelope(envelope), envelope);
  assert.throws(() => parseControlEnvelope({ ...envelope, version: 900 }), /version/);
  assert.throws(() => parseControlEnvelope({ ...envelope, kind: "mystery" }), /kind/);
  assert.throws(() => parseControlEnvelope({ ...envelope, id: "bad\nid" }), /correlation/);
  assert.throws(() => parseControlEnvelope({ ...envelope, params: "x".repeat(MAX_CONTROL_FRAME_BYTES) }), /256 KiB/);

  const fixture = join(tmp, "ipc-child.cjs");
  writeFileSync(fixture, `process.on('message', m => { if(m.kind==='request') process.send({protocol:m.protocol,version:m.version,kind:'response',id:m.id,ok:true,result:{echo:m.method,params:m.params}}); else if(m.kind==='configure') process.send({protocol:m.protocol,version:m.version,kind:'response',id:'config',ok:true,result:m.config}); });
    process.send({protocol:'pi.agents-hub',version:1,kind:'request',id:'child-1',method:'agents.list',params:{from:'spoofed-child'}});`);
  const calls = [];
  const rpc = new RpcTransport(process.execPath, [fixture], tmp, () => {}, () => {}, 1000, {}, {
    ipc: true, identity: { agentId: "trusted-agent", parentId: "root", depth: 1 },
    onControlRequest: (request, context) => { calls.push({ request, context }); return { ok: true }; },
  }); transports.push(rpc);
  const response = await rpc.requestBridge("test.echo", { text: "界\u2028value" });
  assert.deepEqual(response, { echo: "test.echo", params: { text: "界\u2028value" } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls[0].request.method, "agents.list");
  assert.deepEqual(calls[0].context.caller, { agentId: "trusted-agent", parentId: "root", depth: 1 });
  assert.equal(calls[0].request.params.from, "spoofed-child"); // untrusted data remains params only
  assert.equal((await rpc.requestBridge("test.echo", { n: 2 })).params.n, 2);
  await rpc.close();
  await assert.rejects(rpc.requestBridge("x", {}), /closed/);

  const noIpc = new RpcTransport(process.execPath, ["-e", "setInterval(()=>{},1000)"], tmp, () => {}, () => {}, 500);
  transports.push(noIpc);
  await assert.rejects(noIpc.requestBridge("agents.list", {}), /without Hub IPC/);
  await noIpc.close();
  const malformed = new RpcTransport(process.execPath, ["-e", `process.send({protocol:'nope',version:1,kind:'response',id:'x',ok:true,result:{}}); setInterval(()=>{},1000)`], tmp, () => {}, () => {}, 500, {}, { ipc: true });
  transports.push(malformed);
  await assert.rejects(malformed.requestBridge("x", {}), /version/);
  await malformed.close();

  // Prove the installed Pi CLI can coexist with a real Node IPC fd without model calls.
  const real = new RpcTransport(process.execPath, [join(root, "dist/cli.js"), "--mode", "rpc", "--offline", "--no-session", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-approve"], tmp, () => {}, () => {}, 10_000, {}, { ipc: true, identity: { agentId: "offline-child", depth: 1 }, onControlRequest: () => ({}) });
  transports.push(real);
  assert.equal((await real.request("get_state")).isStreaming, false);
  await real.close();
  console.log("Agents Hub protocol tests passed (versioning, size checks, IPC correlation/identity/disconnect, installed Pi coexistence)");
} finally { await Promise.allSettled(transports.map((t) => t.close())); rmSync(tmp, { recursive: true, force: true }); }
