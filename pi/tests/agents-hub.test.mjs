// node pi/tests/agents-hub.test.mjs — no model requests or extra dependencies.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jiti, root } from "./pi-runtime.mjs";
const extensionDir = fileURLToPath(new URL("../.pi/agent/extensions/agents-hub/", import.meta.url));
const { AgentManager, configFrom, defaults } = await jiti.import(join(extensionDir, "manager.ts"));
const { RpcTransport } = await jiti.import(join(extensionDir, "rpc.ts"));
const { parseDefinition, discoverDefinitions } = await jiti.import(join(extensionDir, "definitions.ts"));
const { HubView, plain } = await jiti.import(join(extensionDir, "view.ts"));
const { visibleWidth, matchesKey } = await jiti.import("@earendil-works/pi-tui");
const tmp = mkdtempSync(join(tmpdir(), "pi-hub-test-"));
const managers = [], transports = [];
const launch = { task: "inspect", provider: "mock", model: "mock-model", thinking: "low", cwd: tmp };
function fixture(config = defaults, overrides = {}) {
  const connections = [], reports = [];
  const hub = new AgentManager(config, {
    root: join(tmp, String(managers.length)),
    parent: (...args) => reports.push(args),
    connect(agent, event, exit) {
      const connection = { event, exit, calls: [], closed: false, async request(type, args) {
        this.calls.push({ type, args });
        if (type === "get_state") return { model: { provider: launch.provider, id: launch.model }, thinkingLevel: "low", sessionFile: "fake.jsonl" };
        // Exercise events arriving before the prompt acknowledgement.
        event({ type: "agent_start" });
        return { disposition: "started" };
      }, async close() { this.closed = true; } };
      connections.push(connection); return connection;
    }, ...overrides,
  });
  managers.push(hub); return { hub, connections, reports };
}
try {
  assert.deepEqual(configFrom({}), defaults);
  assert.throws(() => configFrom({ maxConcurrent: 0 }));
  assert.throws(() => configFrom({ unknown: true }));
  assert.throws(() => configFrom({ toString: 1 }));

  const { hub, connections, reports } = fixture({ ...defaults, maxConcurrent: 2 });
  const a = await hub.launch(launch), b = await hub.launch({ ...launch, task: "second" });
  await assert.rejects(hub.launch(launch), /limit/);
  assert.equal(a.state, "running");
  assert.notEqual(a.id, b.id);
  assert.equal(a.mails[0].state, "queued"); // acceptance is not delivery
  connections[0].event({ type: "message_end", message: { role: "user", content: connections[0].calls[1].args.message } });
  assert.equal(a.mails[0].state, "delivered");
  connections[0].event({ type: "agent_end" });
  assert.equal(a.state, "running"); // agent_end is not settlement
  connections[0].event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello 界\u2028world" } });
  connections[0].event({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "## Verified summary\nNo raw tool payloads." }], usage: { totalTokens: 20, cost: { total: 0.02 } } } });
  const waiting = hub.wait(a.id, 1000);
  connections[0].event({ type: "tool_execution_end", toolName: "message_parent", result: { details: { parentMessage: "question?" } }, isError: false });
  assert.equal((await waiting).id, a.id); // child question unblocks parent wait
  assert.equal(reports.at(-1)[1], "question?");
  assert.equal(a.mails.at(-1).from, a.id);
  connections[0].event({ type: "agent_settled" });
  assert.equal(a.state, "idle");
  assert.equal(reports.at(-1)[1], "## Verified summary\nNo raw tool payloads.");
  assert.ok(a.activity.some((entry) => entry.kind === "assistant" && entry.text.includes("Verified summary")));
  assert.ok(a.activity.some((entry) => entry.kind === "mail" && entry.text === "question?"));
  assert.equal(a.tokens, 20);
  assert.equal(a.cost, 0.02);
  assert.match(readFileSync(a.log, "utf8"), /question/);
  await Promise.all([hub.send(a.id, "one"), hub.send(a.id, "two", "main", "followUp")]);
  assert.equal(a.lastAssistant, undefined); // no stale result copied into a later run
  assert.equal(connections[0].calls.at(-1).args.streamingBehavior, "followUp");
  assert.match(connections[0].calls.at(-2).args.message, /From user/);
  const cancelWait = new AbortController();
  const cancelledWait = hub.wait(a.id, 1000, cancelWait.signal);
  cancelWait.abort();
  await assert.rejects(cancelledWait, /Wait cancelled/);
  assert.equal(a.state, "running"); // aborting wait does not stop child
  const count = reports.length;
  await hub.stop(a.id);
  connections[0].event({ type: "agent_settled" });
  assert.equal(reports.length, count);
  assert.equal(connections[0].closed, true);
  await assert.rejects(hub.send(a.id, "too late"), /connected/);
  assert.equal(a.state, "stopped");
  connections[1].exit(new Error("crash"));
  assert.equal(b.state, "failed");
  await hub.stop(b.id);
  assert.equal(connections[1].closed, true);

  const turns = fixture({ ...defaults, maxTurns: 1 });
  const t = await turns.hub.launch(launch);
  turns.connections[0].event({ type: "turn_start" });
  turns.connections[0].event({ type: "turn_start" });
  assert.equal(t.state, "failed");
  assert.match(t.error, /turn limit/);
  const failure = fixture();
  await assert.rejects(failure.hub.launch({ ...launch, cwd: join(tmp, "missing-directory") }), /ENOENT/);
  await assert.rejects(failure.hub.launch({ ...launch, tools: ["unknown-tool"] }), /tools must/);
  assert.equal(failure.connections.length, 0);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(turns.hub.launch(launch, aborted.signal), /cancelled/);
  let ready;
  let startupClosed = false;
  const starting = fixture(defaults, { connect: () => ({
    request: () => new Promise((resolve) => { ready = resolve; }),
    async close() { startupClosed = true; },
  }) });
  const pending = starting.hub.launch(launch);
  await starting.hub.shutdown();
  assert.equal(startupClosed, true);
  ready({ model: { provider: launch.provider, id: launch.model } });
  await assert.rejects(pending, /cancelled/);
  await turns.hub.shutdown();
  await assert.rejects(turns.hub.launch(launch), /shutting down/);

  const definition = "---\nname: scout\ndescription: Find relevant code\ntools: read, grep, find, ls\nthinking: low\n---\nInspect before recommending changes.";
  assert.deepEqual(parseDefinition(definition, "scout.md", "user").tools, ["read", "grep", "find", "ls"]);
  assert.deepEqual(parseDefinition(definition.replace("read, grep, find, ls", "read, bash, edit"), "writer.md", "user").tools, ["read", "bash", "edit"]);
  assert.throws(() => parseDefinition(definition.replace("thinking: low", "hooks: true"), "bad.md", "user"), /Unsupported agent field/);
  assert.throws(() => parseDefinition(definition.replace("thinking: low", "mode: research").replace("read, grep, find, ls", "bash"), "bad.md", "user"), /Unsupported agent field: mode/);
  const user = join(tmp, "user"), project = join(tmp, "project");
  mkdirSync(user); mkdirSync(project);
  writeFileSync(join(user, "scout.md"), definition);
  writeFileSync(join(project, "scout.md"), definition.replace("Find relevant code", "Project scout"));
  assert.equal(discoverDefinitions(user, project, false).agents[0].description, "Find relevant code");
  assert.match(discoverDefinitions(user, project, false).diagnostics[0], /not trusted/);
  assert.equal(discoverDefinitions(user, project, true).agents[0].description, "Project scout");
  const samples = discoverDefinitions(join(extensionDir, "../../agents"), join(tmp, "no-project-agents"), false);
  assert.equal(samples.diagnostics.length, 0);
  assert.ok(samples.agents.find((a) => a.name === "worker").tools.includes("write"));

  // Cwd/tool independence: no Git repo, snapshots, copying, or cleanup required.
  const workspace = join(tmp, "prepared-by-user"); mkdirSync(workspace);
  writeFileSync(join(workspace, "uncommitted.txt"), "user work\n");
  const external = fixture();
  const writer = await external.hub.launch({ ...launch, cwd: workspace, tools: ["read", "bash", "edit", "write"] });
  const reader = await external.hub.launch({ ...launch, cwd: workspace });
  assert.equal(writer.workspace, workspace);
  assert.equal(reader.workspace, workspace);
  assert.deepEqual(writer.tools, ["read", "bash", "edit", "write"]);
  assert.deepEqual(reader.tools, ["read", "grep", "find", "ls"]);
  const noBuiltins = await external.hub.launch({ ...launch, cwd: workspace, tools: [] });
  assert.deepEqual(noBuiltins.tools, []);
  assert.equal(readFileSync(join(writer.workspace, "uncommitted.txt"), "utf8"), "user work\n");
  external.hub.subscribe(() => { throw new Error("bad observer"); });
  external.connections[0].event({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "still alive" } });
  assert.equal(writer.state, "running");
  await external.hub.stop(writer.id);
  assert.equal(readFileSync(join(workspace, "uncommitted.txt"), "utf8"), "user work\n");

  // Admission counts terminating processes until transport close resolves.
  const closing = fixture({ ...defaults, maxConcurrent: 1 });
  const closingAgent = await closing.hub.launch(launch);
  let releaseClose;
  closing.connections[0].close = () => new Promise((resolve) => { releaseClose = resolve; });
  const stopped = closing.hub.stop(closingAgent.id);
  await assert.rejects(closing.hub.launch(launch), /connection limit/);
  releaseClose(); await stopped;
  const afterClose = await closing.hub.launch(launch);
  assert.equal(afterClose.state, "running");

  // A prompt acknowledgement after stop cannot change unknown back to queued.
  const late = fixture();
  const lateAgent = await late.hub.launch(launch);
  let acknowledge;
  late.connections[0].request = () => new Promise((resolve) => { acknowledge = resolve; });
  const pendingMail = late.hub.send(lateAgent.id, "message in flight");
  await Promise.resolve();
  await late.hub.stop(lateAgent.id);
  acknowledge({ disposition: "queued" });
  assert.equal((await pendingMail).state, "unknown");

  // Transcript-observed delivery survives a lost RPC acknowledgement.
  const confirmed = fixture();
  const confirmedAgent = await confirmed.hub.launch(launch);
  confirmed.connections[0].request = async (_type, args) => {
    confirmed.connections[0].event({ type: "message_end", message: { role: "user", content: args.message } });
    throw new Error("ack lost after delivery");
  };
  await assert.rejects(confirmed.hub.send(confirmedAgent.id, "already delivered"), /ack lost/);
  assert.equal(confirmedAgent.mails.at(-1).state, "delivered");

  // Later messages cannot overtake the initial task during a delayed handshake.
  let finishHandshake;
  const prompts = [];
  const ordered = fixture(defaults, { connect: () => ({
    request(type, args) {
      if (type === "get_state") return new Promise((resolve) => { finishHandshake = resolve; });
      prompts.push(args.message);
      return Promise.resolve({ disposition: "started" });
    },
    async close() {},
  }) });
  const initialLaunch = ordered.hub.launch(launch);
  const startingId = [...ordered.hub.agents.keys()][0];
  const later = ordered.hub.send(startingId, "later instruction");
  await Promise.resolve();
  assert.deepEqual(prompts, []);
  finishHandshake({ model: { provider: launch.provider, id: launch.model }, thinkingLevel: "low" });
  await Promise.all([initialLaunch, later]);
  assert.match(prompts[0], /\ninspect$/);
  assert.match(prompts[1], /\nlater instruction$/);

  // UI: bounded widths, safe output, key actions, listener cleanup.
  b.activity = []; b.state = "idle";
  b.output = "\x1b]52;c;malicious\x07界\n" + "long line ".repeat(100);
  let action;
  const ui = new HubView(hub, { terminal: { rows: 24 }, requestRender() {} }, { fg: (_c, s) => s, bg: (_c, s) => s, bold: (s) => s, italic: (s) => s, underline: (s) => s, strikethrough: (s) => s }, {
    matches: (data, key) => matchesKey(data, ({ "tui.select.cancel": "escape", "tui.select.up": "up", "tui.select.down": "down", "tui.select.confirm": "enter", "tui.select.pageUp": "pageUp", "tui.select.pageDown": "pageDown" })[key]),
  }, (value) => { action = value; }, b.id);
  for (const width of [1, 5, 20, 80]) assert.ok(ui.render(width).every((line) => visibleWidth(line) <= width));
  assert.ok(!plain(b.output).includes("\x1b"));
  b.name = "name\nwith newline"; b.task = "task\nwith newline";
  assert.ok(ui.render(80).every((line) => !line.includes("\n")));
  b.output = Array.from({ length: 60 }, (_, i) => `output-${i}`).join("\n");
  ui.render(80);
  ui.handleInput("\x1b[5~"); // PageUp freezes a snapshot, not distance from live tail.
  const paused = ui.render(80);
  b.output += "\nnew-live-output";
  assert.deepEqual(ui.render(80), paused);
  for (let i = 0; i < 100; i++) ui.handleInput("\x1b[5~");
  assert.ok(ui.render(80).some((line) => line.includes("output-0"))); // clamped, no blank overscroll
  ui.handleInput("\x1b[F"); // End resumes following.
  assert.ok(ui.render(80).some((line) => line.includes("new-live-output")));
  ui.handleInput("n"); assert.equal(action.type, "new");
  ui.handleInput("m"); assert.equal(action.type, "message"); assert.equal(action.id, b.id);
  ui.handleInput("\x1ba"); assert.equal(action.type, "close");
  ui.dispose();

  // Exercise a real OS pipe: fragmented UTF-8, U+2028, correlation and timeout.
  const fake = join(tmp, "fake.cjs");
  writeFileSync(fake, `process.stdin.on('data', b => { for (const l of b.toString().trim().split('\\n')) { const r=JSON.parse(l); if(r.type==='hang') continue; const v=Buffer.from(JSON.stringify({type:'response',id:r.id,success:true,data:{text:'界\\u2028ok'}})+'\\n'); process.stdout.write(v.subarray(0,3)); setTimeout(()=>process.stdout.write(v.subarray(3)),5); } });`);
  const rpc = new RpcTransport(process.execPath, [fake], tmp, () => {}, () => {}, 500);
  transports.push(rpc);
  assert.deepEqual(await rpc.request("get_state"), { text: "界\u2028ok" });
  await assert.rejects(rpc.request("hang"), /timed out/);
  await rpc.close(); await rpc.close();
  await assert.rejects(rpc.request("get_state"), /closed/);

  // Real installed Pi RPC smoke check: no prompt/model request, offline startup.
  const real = new RpcTransport(process.execPath, [join(root, "dist/cli.js"), "--mode", "rpc", "--offline", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-approve", "--extension", join(extensionDir, "bridge.ts"), "--tools", "read,message_parent"], tmp, () => {}, () => {});
  transports.push(real);
  const state = await real.request("get_state");
  assert.equal(state.isStreaming, false);
  const { commands } = await real.request("get_commands");
  assert.ok(!commands.some((c) => c.name === "agents")); // no recursive hub
  await real.close();
  const parent = new RpcTransport(process.execPath, [join(root, "dist/cli.js"), "--mode", "rpc", "--offline", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-approve", "--extension", extensionDir], tmp, () => {}, () => {}, 30_000, { PI_AGENTS_HUB_CHILD: "0" });
  transports.push(parent);
  const parentCommands = await parent.request("get_commands");
  assert.ok(parentCommands.commands.some((c) => c.name === "agents"));
  assert.ok(parentCommands.commands.some((c) => c.name === "agent"));
  await parent.close();
  // Startup failure/abrupt exit rejects pending work instead of hanging.
  const crash = new RpcTransport(process.execPath, ["-e", "process.exit(7)"], tmp, () => {}, () => {});
  transports.push(crash);
  await assert.rejects(crash.request("get_state"), /exited/);

  const { default: extension } = await jiti.import(join(extensionDir, "index.ts"));
  const registrations = { tools: [], commands: [], shortcuts: [] };
  extension({ registerMessageRenderer() {}, registerTool: (v) => registrations.tools.push(v), registerCommand: (name) => registrations.commands.push(name), registerShortcut: (name) => registrations.shortcuts.push(name), on() {} });
  assert.equal(registrations.tools[0].name, "agents");
  assert.deepEqual(registrations.shortcuts, ["alt+a"]);
  assert.deepEqual(registrations.commands, ["agents", "agent"]);
  assert.equal(registrations.tools[0].parameters.properties.mode, undefined);
  assert.ok(registrations.tools[0].parameters.properties.tools);
  assert.equal(registrations.tools[0].parameters.additionalProperties, false);

  // Shutdown during an awaited send must not reopen a stale custom UI.
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  const oldGet = AgentManager.prototype.get, oldSend = AgentManager.prototype.send;
  process.env.PI_CODING_AGENT_DIR = join(tmp, "isolated-parent-config");
  try {
    let sendReady, finishSend, customCalls = 0;
    const sending = new Promise((resolve) => { sendReady = resolve; });
    AgentManager.prototype.get = () => ({ name: "test-agent" });
    AgentManager.prototype.send = () => new Promise((resolve) => { finishSend = resolve; sendReady(); });
    const commands = new Map(), handlers = new Map();
    extension({ registerMessageRenderer() {}, registerTool() {}, registerShortcut() {}, registerCommand: (name, options) => commands.set(name, options),
      on: (name, handler) => handlers.set(name, handler), events: { emit() {} } });
    const ctx = { mode: "tui", cwd: tmp, sessionManager: { getSessionId: () => "test-session" }, ui: {
      async custom() { if (++customCalls > 1) throw new Error("stale UI reopened"); return { type: "message", id: "test-agent" }; },
      async editor() { return "hello"; }, notify() {},
    } };
    const opened = commands.get("agents").handler("", ctx);
    await sending;
    await handlers.get("session_shutdown")();
    finishSend({});
    await opened;
    assert.equal(customCalls, 1);
  } finally {
    AgentManager.prototype.get = oldGet; AgentManager.prototype.send = oldSend;
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  }
  const { default: bridge } = await jiti.import(join(extensionDir, "bridge.ts"));
  const previous = process.env.PI_AGENTS_HUB_CHILD;
  try {
    process.env.PI_AGENTS_HUB_CHILD = "1";
    let bridgeTool;
    bridge({ registerTool: (tool) => { bridgeTool = tool; } });
    assert.equal(bridgeTool.name, "message_parent");
    assert.equal((await bridgeTool.execute("id", { message: "Need clarification" })).details.parentMessage, "Need clarification");
  } finally {
    if (previous === undefined) delete process.env.PI_AGENTS_HUB_CHILD;
    else process.env.PI_AGENTS_HUB_CHILD = previous;
  }
  console.log("Agents Hub tests passed (manager, definitions, TUI, transport, installed Pi RPC smoke)");
} finally {
  await Promise.allSettled(managers.map((m) => m.shutdown()));
  await Promise.allSettled(transports.map((t) => t.close()));
  rmSync(tmp, { recursive: true, force: true });
}
