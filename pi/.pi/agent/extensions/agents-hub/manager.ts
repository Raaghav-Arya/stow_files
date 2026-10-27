import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { RpcCommandError, type RecordEvent, type Transport } from "./rpc.ts";
import { defaultTools, validateTools } from "./tools.ts";
import { resultPreview, toolPreview, type ActivityEntry } from "./activity.ts";
import { acquireOwnerLock, RotatingJournal, writeJsonAtomic } from "./storage.ts";

export type AgentState = "starting" | "running" | "idle" | "interrupted" | "waiting-input" | "limited" | "work-failed" | "failed" | "stopped";
export interface Launch {
  task: string;
  parentId?: string;
  name?: string;
  provider: string;
  model: string;
  thinking: string;
  cwd: string;
  definition?: string;
  instructions?: string;
  tools?: string[];
}
export interface Mail {
  id: string; from: string; to: string; text: string;
  state: "sending" | "queued" | "delivered" | "failed" | "unknown";
  error?: string;
}
export interface AgentRecord extends Launch {
  id: string; state: AgentState; directory: string; workspace: string;
  rootSessionId?: string; depth?: number; taskId?: string; taskTurns?: number; settled?: boolean; recoverableQueue?: string[]; recoverableQueueDetails?: Array<{ text: string; delivery: "steer" | "followUp"; mailId?: string }>;
  /** Provider failure is provisional until Pi reports agent_settled. */
  pendingWorkError?: string;
  log: string; sessionFile?: string; error?: string;
  output: string; streamedText: string; turns: number; tokens: number; cost: number;
  activity: ActivityEntry[]; assistantActivity?: ActivityEntry; lastAssistant?: string;
  mails: Mail[]; logBytes: number; transport?: Transport;
  serial: Promise<unknown>; timer?: ReturnType<typeof setTimeout>;
  activeMs?: number; activeSince?: number; waitingRequestId?: string;
  closing?: Promise<void>; transportClosed?: boolean; journal?: RotatingJournal; interrupting?: boolean;
}
export interface NotificationConfig { mode: "passive" | "active"; coalesceMs: number; maxEventsPerDelivery: number; maxContentChars: number; automaticWakeupsPerRecipient: number; automaticWakeupsPerRoot: number }
export interface HubConfig { maxConcurrent: number; maxAgents: number; maxDepth: number; maxTurns: number; timeoutMinutes: number; notifications: NotificationConfig }
export const defaults: HubConfig = { maxConcurrent: 16, maxAgents: 128, maxDepth: 3, maxTurns: 1000, timeoutMinutes: 240,
  notifications: { mode: "passive", coalesceMs: 200, maxEventsPerDelivery: 32, maxContentChars: 16000, automaticWakeupsPerRecipient: 20, automaticWakeupsPerRoot: 100 } };
export function configFrom(value: unknown): HubConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("agents-hub.json must be an object");
  const config = { ...defaults, notifications: { ...defaults.notifications } };
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "notifications") {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("notifications must be an object");
      for (const [name, setting] of Object.entries(entry as Record<string, unknown>)) {
        if (!Object.hasOwn(defaults.notifications, name)) throw new Error(`Unknown notification setting: ${name}`);
        if (name === "mode") {
          if (setting !== "passive" && setting !== "active") throw new Error("notifications.mode must be passive or active");
          config.notifications.mode = setting;
        } else {
          const maximum = name === "coalesceMs" ? 10_000 : name === "maxEventsPerDelivery" ? 256 : name === "maxContentChars" ? 64_000 : 10_000;
          const minimum = name === "coalesceMs" ? 0 : name === "maxContentChars" ? 256 : 1;
          if (!Number.isInteger(setting) || (setting as number) < minimum || (setting as number) > maximum) throw new Error(`Invalid notifications.${name}: expected integer ${minimum}..${maximum}`);
          (config.notifications as any)[name] = setting;
        }
      }
    } else {
      if (!Object.hasOwn(defaults, key) || key === "notifications") throw new Error(`Unknown agents-hub setting: ${key}`);
      const number = entry;
      const max = key === "timeoutMinutes" ? 1440 : key === "maxTurns" ? 100_000 : key === "maxConcurrent" ? 64 : key === "maxAgents" ? 4096 : 8;
      if (!Number.isInteger(number) || (number as number) < 1 || (number as number) > max) throw new Error(`Invalid ${key}: expected integer 1..${max}`);
      (config as any)[key] = number;
    }
  }
  return config;
}
export interface Dependencies {
  root: string;
  /** Called at admission and queued dispatch, including UI/command callers. */
  assertCanWork?: () => void;
  connect: (agent: AgentRecord, event: (event: RecordEvent) => void, exit: (error: Error) => void) => Transport;
  parent: (agent: AgentRecord, text: string, kind: "mail" | "settled" | "error") => void;
  /** Required durable result persistence at the terminal work boundary. */
  persistResult?: (agent: AgentRecord, status: "completed" | "failed") => void;
}

/** Runtime/transport independent registry. No automatic delegation or scheduling. */
export class AgentManager {
  readonly agents = new Map<string, AgentRecord>();
  readonly listeners = new Set<() => void>();
  readonly observers = new Set<(agent: AgentRecord, event: RecordEvent) => void>();
  private closed = false;
  private releaseOwnerLock: () => void;
  constructor(readonly config: HubConfig, private deps: Dependencies) {
    mkdirSync(deps.root, { recursive: true, mode: 0o700 });
    this.releaseOwnerLock = acquireOwnerLock(join(deps.root, ".owner.lock"));
    this.restoreRetained();
  }
  private restoreRetained() {
    const root = realpathSync(this.deps.root);
    const rootSessionId = basename(root);
    const candidates: AgentRecord[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
      const directory = join(root, entry.name);
      try {
        const canonical = realpathSync(directory);
        const raw = JSON.parse(readFileSync(join(canonical, "agent.json"), "utf8"));
        if (raw.version !== 1 || raw.id !== entry.name || raw.rootSessionId !== rootSessionId ||
            raw.directory !== directory || typeof raw.sessionFile !== "string" || !raw.sessionFile ||
            realpathSync(raw.sessionFile) !== raw.sessionFile || !raw.sessionFile.startsWith(`${canonical}/`) ||
            realpathSync(raw.workspace) !== raw.workspace || !statSync(raw.workspace).isDirectory() ||
            !Array.isArray(raw.tools) || typeof raw.task !== "string" || typeof raw.provider !== "string" || typeof raw.model !== "string") continue;
        const record = { ...raw, state: "stopped" as AgentState, error: undefined, transport: undefined, transportClosed: true,
          serial: Promise.resolve(), activeSince: undefined, timer: undefined, closing: undefined,
          activity: [], mails: Array.isArray(raw.mails) ? raw.mails : [], output: "", streamedText: "", logBytes: 0 } as AgentRecord;
        candidates.push(record);
      } catch { /* corrupt, incomplete, or unsafe records are not automatically resumed */ }
    }
    const ids = new Set(candidates.map((record) => record.id));
    for (const record of candidates) {
      if (record.parentId && (!ids.has(record.parentId) || record.depth !== (candidates.find((parent) => parent.id === record.parentId)?.depth || 0) + 1)) continue;
      this.agents.set(record.id, record);
    }
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  observe(listener: (agent: AgentRecord, event: RecordEvent) => void): () => void { this.observers.add(listener); return () => this.observers.delete(listener); }
  private changed(agent: AgentRecord) {
    // Metadata is recovery information, never a claim that a child survives reload.
    const { transport, serial, timer, closing, journal, output, streamedText, activity, assistantActivity, lastAssistant, ...metadata } = agent;
    try { writeJsonAtomic(join(agent.directory, "agent.json"), { version: 1, ...metadata }); }
    catch (error) {
      // Metadata is a mandatory recovery record. Never leave an apparently healthy
      // live child after the durable state transition failed to persist.
      agent.state = "failed";
      agent.error = `Required agent metadata persistence failed: ${String(error)}`;
      this.pauseTimer(agent);
      void this.closeDescendants(agent.id);
      void this.closeAgent(agent).catch(() => {});
      throw error;
    }
    this.emit();
  }
  private emit() {
    // Observers own their failures; a UI/integration error must not kill a child.
    for (const listener of this.listeners) { try { listener(); } catch { /* isolated observer */ } }
  }
  private observed(agent: AgentRecord, event: RecordEvent) {
    for (const listener of this.observers) { try { listener(agent, event); } catch { /* isolated observer */ } }
  }
  private pauseTimer(agent: AgentRecord) {
    if (agent.timer) clearTimeout(agent.timer);
    agent.timer = undefined;
    if (agent.activeSince !== undefined) agent.activeMs = (agent.activeMs || 0) + Math.max(0, Date.now() - agent.activeSince);
    agent.activeSince = undefined;
  }
  private resumeTimer(agent: AgentRecord) {
    if (agent.timer || agent.state === "waiting-input" || agent.state === "interrupted") return;
    const remaining = this.config.timeoutMinutes * 60_000 - (agent.activeMs || 0);
    if (remaining <= 0) { this.fail(agent, new Error("Active task timeout reached")); return; }
    agent.activeSince = Date.now();
    agent.timer = setTimeout(() => { this.pauseTimer(agent); this.fail(agent, new Error("Active task timeout reached")); }, remaining);
  }
  private async configure(agent: AgentRecord) {
    const transport = agent.transport as (Transport & { configure?: (config: any) => Promise<unknown> }) | undefined;
    if (!transport?.configure) return;
    await transport.configure({ agentId: agent.id, parentId: agent.parentId, depth: agent.depth ?? 0,
      taskId: agent.taskId || "", maxTurns: this.config.maxTurns, usedTurns: agent.taskTurns || 0,
      rootPolicy: { allowNested: (agent.depth || 0) < this.config.maxDepth, maxDepth: this.config.maxDepth,
        maxAgents: this.config.maxAgents, maxConcurrent: this.config.maxConcurrent } });
  }
  private closeAgent(agent: AgentRecord): Promise<void> {
    if (agent.closing) return agent.closing;
    agent.closing = Promise.resolve().then(() => agent.transport?.close()).then(() => {
      agent.transportClosed = true;
      this.emit();
    });
    return agent.closing;
  }
  private log(agent: AgentRecord, event: RecordEvent) {
    agent.journal ??= new RotatingJournal(agent.log);
    const line = JSON.stringify({ time: new Date().toISOString(), ...event }) + "\n";
    agent.journal.append({ time: new Date().toISOString(), ...event });
    agent.logBytes += Buffer.byteLength(line);
    if (agent.logBytes > 2 * 1024 * 1024) agent.logBytes = 0;
  }
  private text(agent: AgentRecord, text: string) { agent.output = (agent.output + text).slice(-64 * 1024); }
  private activity(agent: AgentRecord, entry: ActivityEntry) {
    entry.text = entry.text.slice(-16_000);
    agent.activity.push(entry);
    if (agent.activity.length > 80) agent.activity.shift();
    return entry;
  }
  private live(agent: AgentRecord) { return agent.state !== "failed" && agent.state !== "stopped"; }
  private notify(agent: AgentRecord, text: string, kind: "mail" | "settled" | "error") {
    if (!this.closed) this.deps.parent(agent, text.slice(-12_000), kind);
  }
  get(id: string): AgentRecord {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Unknown agent: ${id}`);
    return agent;
  }
  summary(agent: AgentRecord) {
    return { id: agent.id, name: agent.name, parentId: agent.parentId, depth: agent.depth ?? 0,
      taskId: agent.taskId, taskTurns: agent.taskTurns ?? 0, taskTurnLimit: this.config.maxTurns,
      state: agent.state, task: agent.task, definition: agent.definition, tools: agent.tools,
      provider: agent.provider, model: agent.model, thinking: agent.thinking, workspace: agent.workspace,
      sessionFile: agent.sessionFile, log: agent.log, turns: agent.turns,
      tokens: agent.tokens, estimatedCost: agent.cost, error: agent.error,
      recoverableQueue: agent.recoverableQueue || [], recoverableQueueDetails: agent.recoverableQueueDetails || [] };
  }
  async launch(input: Launch, signal?: AbortSignal): Promise<AgentRecord> {
    this.deps.assertCanWork?.();
    if (signal?.aborted) throw new Error("Launch cancelled");
    if (this.closed) throw new Error("Agents Hub is shutting down");
    if (!input.task.trim() || input.task.length > 16_000) throw new Error("Task must be 1..16000 characters");
    const parentId = (input as Launch & { parentId?: string }).parentId;
    const parent = parentId ? this.get(parentId) : undefined;
    if (parent && (!this.live(parent) || !parent.transport || parent.closing)) throw new Error("Delegating parent is not connected");
    const depth = parent ? (parent.depth ?? 0) + 1 : 1;
    if (depth > this.config.maxDepth) throw new Error(`Maximum delegation depth ${this.config.maxDepth} reached`);
    if (this.agents.size >= this.config.maxAgents) throw new Error("Root-session allocated-agent budget exhausted");
    if ([...this.agents.values()].filter((a) => this.live(a) || (a.transport && !a.transportClosed)).length >= this.config.maxConcurrent) throw new Error("Agent connection limit reached; stop an existing agent first");
    const cwd = realpathSync(input.cwd);
    if (!statSync(cwd).isDirectory()) throw new Error("Workspace must be an existing directory");
    const tools = validateTools(input.tools === undefined ? parent?.tools ?? defaultTools : input.tools);
    if (parent && tools.some((tool) => !parent.tools?.includes(tool))) throw new Error("Nested agent tools exceed its immediate parent's effective tool grant");
    const id = randomUUID();
    const directory = join(this.deps.root, id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    let ready!: () => void;
    let rejectReady!: (error: unknown) => void;
    const startup = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
    const agent: AgentRecord = { ...input, cwd, tools, name: input.name?.slice(0, 80) || id.slice(0, 8),
      id, directory, workspace: cwd, rootSessionId: parent?.rootSessionId || basename(this.deps.root), parentId, depth,
      taskId: randomUUID(), taskTurns: 0, settled: false, state: "starting", log: join(directory, "events.jsonl"),
      output: "", streamedText: "", activity: [], turns: 0, tokens: 0, cost: 0, mails: [], logBytes: 0, serial: startup };
    // Reserve capacity before async child startup. Workspace ownership is external.
    this.agents.set(id, agent);
    const cancel = () => { void this.stop(id).catch(() => {}); };
    signal?.addEventListener("abort", cancel, { once: true });
    // Reserve the initial task before publishing state to observers. Later sends
    // queue after it, and all prompts wait for the startup handshake.
    const initialPrompt = this.send(id, input.task, parentId || "main");
    void initialPrompt.catch(() => {});
    try {
      this.log(agent, { type: "launch", task: input.task, cwd, tools });
      this.changed(agent);
      if (this.closed || !this.live(agent)) throw new Error("Launch cancelled");
      this.deps.assertCanWork?.();
      agent.transport = this.deps.connect(agent, (e) => this.event(agent, e), (e) => this.fail(agent, e));
      if (!this.live(agent) || this.closed) { await this.closeAgent(agent); throw new Error("Launch cancelled"); }
      const state = await agent.transport.request("get_state");
      if (!this.live(agent) || this.closed) throw new Error("Launch cancelled");
      if (state.model?.provider !== input.provider || state.model?.id !== input.model) throw new Error("Child model differs from requested model");
      agent.sessionFile = state.sessionFile;
      agent.thinking = state.thinkingLevel;
      this.changed(agent);
      await this.configure(agent);
      ready();
      await initialPrompt;
      if (signal?.aborted || this.closed || !this.live(agent)) throw new Error("Launch cancelled");
      return agent;
    } catch (error) {
      rejectReady(error);
      this.fail(agent, error);
      await initialPrompt.catch(() => {});
      throw error;
    } finally { signal?.removeEventListener("abort", cancel); }
  }
  fail(agent: AgentRecord, error: unknown) {
    if (!this.live(agent)) return;
    agent.state = "failed";
    agent.error = String(error instanceof Error ? error.message : error);
    this.pauseTimer(agent);
    void this.closeDescendants(agent.id);
    for (const mail of agent.mails) if (mail.state === "queued" || mail.state === "sending") mail.state = "unknown";
    this.text(agent, `\n[FAILED] ${agent.error}\n`);
    this.activity(agent, { kind: "error", text: agent.error });
    void this.closeAgent(agent).catch(() => {});
    try { this.log(agent, { type: "failure", error: agent.error }); this.changed(agent); } catch { /* disk errors must not leave child running */ }
    this.notify(agent, agent.error, "error");
  }
  private async closeDescendants(parentId: string) {
    const children = [...this.agents.values()].filter((child) => child.parentId === parentId && this.live(child));
    await Promise.allSettled(children.map((child) => this.stop(child.id)));
  }
  private event(agent: AgentRecord, event: RecordEvent) {
    if (!this.live(agent) || this.closed) return;
    try {
      this.log(agent, event);
      if (event.type === "agent_start") {
        // Only a successful assistant response or a deliberate new task clears
        // a provisional error; agent_start also occurs during retry recovery.
        if (agent.state !== "limited" && agent.state !== "waiting-input") agent.state = "running";
        agent.settled = false; agent.lastAssistant = undefined;
        this.resumeTimer(agent);
      }
      if (event.type === "turn_start") {
        agent.turns++;
        agent.taskTurns = (agent.taskTurns || 0) + 1;
        if (agent.taskTurns > this.config.maxTurns) {
          agent.state = "limited";
          agent.error = `Active task turn limit reached (${this.config.maxTurns}); partial context preserved`;
          this.pauseTimer(agent);
          this.activity(agent, { kind: "status", text: agent.error });
          this.notify(agent, agent.error, "error");
          void agent.transport?.request("abort").catch(() => {});
          this.changed(agent);
          this.observed(agent, event);
          return;
        }
      }
      if (event.type === "message_start" && event.message?.role === "assistant") {
        agent.streamedText = "";
        agent.assistantActivity = this.activity(agent, { kind: "assistant", text: "" });
      }
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        const delta = event.assistantMessageEvent.delta;
        this.text(agent, delta);
        agent.streamedText = (agent.streamedText + delta).slice(-64 * 1024);
        agent.assistantActivity ??= this.activity(agent, { kind: "assistant", text: "" });
        agent.assistantActivity.text = (agent.assistantActivity.text + delta).slice(-16_000);
      }
      if (event.type === "tool_execution_start") {
        this.text(agent, `\n[tool ${event.toolName}] ${JSON.stringify(event.args).slice(0, 1500)}\n`);
        this.activity(agent, { kind: "tool", label: event.toolName, text: toolPreview(event.toolName, event.args), toolCallId: event.toolCallId, state: "running" });
      }
      if (event.type === "tool_execution_end") {
        this.text(agent, `\n[${event.isError ? "tool error" : "tool result"}] ${JSON.stringify(event.result).slice(0, 3000)}\n`);
        const call = [...agent.activity].reverse().find((entry) => entry.kind === "tool" && entry.state === "running" && entry.toolCallId === event.toolCallId);
        const entry = call || this.activity(agent, { kind: "tool", label: event.toolName, text: "" });
        entry.state = event.isError ? "error" : "done";
        entry.result = resultPreview(event.result);
      }
      if (event.type === "tool_execution_end" && event.toolName === "message_parent" && !event.isError) {
        const details = event.result?.details;
        // Configured children report through correlated supervisor IPC. Only the
        // no-IPC legacy result includes parentMessage and uses this adapter.
        const text = details?.parentMessage;
        if (typeof text === "string" && text.trim() && text.length <= 8000) {
          agent.mails.push({ id: randomUUID(), from: agent.id, to: "main", text, state: "delivered" });
          this.text(agent, `\n[to main] ${text}\n`);
          this.activity(agent, { kind: "mail", label: "To main", text });
          this.notify(agent, text, "mail");
        }
      }
      if (event.type === "message_end") {
        const message = event.message;
        if (message?.role === "user") {
          const content = typeof message.content === "string" ? message.content : (message.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
          for (const mail of agent.mails) if (content.includes(`[hub-mail:${mail.id}]`)) mail.state = "delivered";
        }
        if (message?.role === "assistant") {
          // Final messages are authoritative, including providers with no deltas.
          const finalText = (message.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
          if (finalText) {
            if (agent.streamedText && agent.output.endsWith(agent.streamedText)) agent.output = agent.output.slice(0, -agent.streamedText.length);
            this.text(agent, finalText);
            agent.assistantActivity ??= this.activity(agent, { kind: "assistant", text: "" });
            agent.assistantActivity.text = finalText.slice(-16_000);
            agent.lastAssistant = finalText.slice(-8000);
          }
          agent.assistantActivity = undefined;
          agent.streamedText = "";
          const usage = message.usage;
          agent.tokens += usage?.totalTokens || 0;
          agent.cost += usage?.cost?.total || 0;
          if (message.stopReason === "error") {
            // Pi may retry this assistant response or recover from overflow.
            // Preserve a provisional error; never tear down a healthy transport
            // until its session-level agent_settled boundary.
            agent.pendingWorkError = message.errorMessage || "Agent request failed";
          } else if (message.stopReason !== "aborted") {
            agent.pendingWorkError = undefined;
          }
          if (message.stopReason === "aborted" && agent.state !== "limited") agent.state = "interrupted";
        }
      }
      if (event.type === "agent_settled") {
        if (event.aborted === true && agent.state !== "limited" && agent.state !== "waiting-input") agent.state = "interrupted";
        if (agent.state === "interrupted" || agent.state === "waiting-input" || agent.state === "limited") {
          // Explicit safety gates outrank a provisional provider error. Keep the
          // diagnostic, but never relabel an interrupted/input-blocked run as an
          // ordinary recoverable provider failure.
          if (agent.pendingWorkError) agent.error = agent.pendingWorkError;
          else agent.error = undefined;
          agent.pendingWorkError = undefined;
        } else if (agent.pendingWorkError) {
          agent.state = "work-failed";
          agent.error = agent.pendingWorkError;
          agent.pendingWorkError = undefined;
          this.activity(agent, { kind: "error", text: agent.error });
        } else {
          agent.state = "idle";
          agent.error = undefined;
        }
        agent.settled = true;
        this.pauseTimer(agent);
        if (agent.state === "idle" || agent.state === "work-failed") this.deps.persistResult?.(agent, agent.state === "idle" ? "completed" : "failed");
        this.text(agent, `\n[${agent.state} — ready for deliberate continuation]\n`);
        this.activity(agent, { kind: "status", text: agent.state === "work-failed" ? agent.error || "Provider work failed; deliberate continuation required" : `${agent.state} — ready for another message` });
        this.notify(agent, agent.error || agent.lastAssistant || "Agent is idle; inspect its activity in Agents Hub.", agent.state === "work-failed" ? "error" : "settled");
      }
      // Streaming notifications don't rewrite metadata on every token.
      if (event.type !== "message_update") this.changed(agent);
      else this.emit();
      this.observed(agent, event);
    } catch (error) { this.fail(agent, error); this.observed(agent, event); }
  }
  async send(id: string, text: string, from: string = "user", delivery: "steer" | "followUp" = "steer", newTask = false): Promise<Mail> {
    this.deps.assertCanWork?.();
    const agent = this.get(id);
    if (agent.interrupting) throw new Error("Agent interruption is in progress; message was not submitted");
    if (!text.trim() || text.length > 16_000) throw new Error("Message must be 1..16000 characters");
    const mail: Mail = { id: randomUUID(), from, to: id, text, state: "sending" };
    if (!from || from.length > 128) throw new Error("Invalid sender identity");
    if (from !== "main" && from !== "user") {
      const sender = this.get(from);
      if (agent.parentId !== sender.id) throw new Error("Only the immediate parent may send as an agent identity");
    }
    agent.mails.push(mail);
    let submitted = false;
    let stateBeforeDispatch: AgentState | undefined;
    let settledBeforeDispatch: boolean | undefined;
    let errorBeforeDispatch: string | undefined;
    const operation = agent.serial.then(async () => {
      this.deps.assertCanWork?.();
      if (agent.interrupting) throw new Error("Agent interruption is in progress; message was not submitted");
      if (!this.live(agent) || !agent.transport || this.closed) throw new Error("Agent is not connected");
      if (newTask && !(agent.state === "idle" || (agent.state === "limited" && agent.settled) || (agent.state === "work-failed" && agent.settled))) {
        throw new Error("A new task can start only after the prior task has settled; replies and resumes continue its budget");
      }
      if (agent.state === "limited" && !newTask) throw new Error("Task turn budget exhausted; explicitly start a new task after settlement");
      if (agent.state === "waiting-input" && from !== agent.parentId && from !== "main") throw new Error("Agent is waiting for its parent to answer the input request");
      // Capture restoration state only after this send reaches its serialized
      // dispatch slot; concurrent queued sends must not restore stale snapshots.
      stateBeforeDispatch = agent.state;
      settledBeforeDispatch = agent.settled;
      errorBeforeDispatch = agent.error;
      if (newTask) { agent.taskId = randomUUID(); agent.taskTurns = 0; agent.activeMs = 0; agent.error = undefined; await this.configure(agent); }
      if (agent.state === "interrupted" || agent.state === "work-failed") { agent.state = "running"; agent.error = undefined; }
      agent.settled = false;
      const senderLabel = from === "user" ? "You" : from === "main" ? "Main session" : from;
      this.text(agent, `\n[from ${senderLabel}] ${text}\n`);
      this.activity(agent, { kind: "message", label: senderLabel, text });
      this.log(agent, { type: "mail", ...mail });
      if (agent.state === "idle") agent.state = "running";
      submitted = true;
      const response = await agent.transport.request("prompt", {
        message: `[hub-mail:${mail.id}] From ${from} to agent ${id}:\n${text}`,
        streamingBehavior: delivery,
      });
      // A late RPC acknowledgement must not resurrect mail abandoned by stop.
      if (!this.live(agent) || this.closed) {
        if (mail.state !== "delivered") mail.state = "unknown";
        if (agent.state === "failed") throw new Error(agent.error || "Agent failed during prompt dispatch");
        return mail;
      }
      if (mail.state !== "delivered") mail.state = response.disposition === "handled" ? "failed" : "queued";
      if (response.disposition === "handled") mail.error = "Prompt consumed without starting a run";
      this.changed(agent);
      return mail;
    });
    agent.serial = operation.catch(() => {});
    try { return await operation; }
    catch (error) {
      const rejected = error instanceof RpcCommandError;
      if (mail.state !== "delivered") mail.state = submitted && !rejected ? "unknown" : "failed";
      mail.error = String(error);
      // Explicit command rejection proves non-acceptance. A lost acknowledgement
      // is unknown; neither establishes transport failure. Fatal process/protocol
      // errors arrive through the transport exit callback. Never replay.
      if (rejected && agent.state === "running" && stateBeforeDispatch !== undefined && stateBeforeDispatch !== "running") {
        agent.state = stateBeforeDispatch;
        agent.error = errorBeforeDispatch;
        agent.settled = settledBeforeDispatch;
      }
      try { this.changed(agent); }
      catch (persistenceError) { this.fail(agent, persistenceError); }
      throw error;
    }
  }
  async wait(id: string, timeoutMs = 30_000, signal?: AbortSignal): Promise<AgentRecord> {
    const agent = this.get(id);
    if (signal?.aborted) throw new Error("Wait cancelled; agent still running");
    if (agent.state !== "running" && agent.state !== "starting") return agent;
    const priorMail = agent.mails.filter((m) => m.to === "main").length;
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer); unsubscribe(); signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve(agent);
      };
      const abort = () => finish(new Error("Wait cancelled; agent still running"));
      const unsubscribe = this.subscribe(() => {
        if ((agent.state !== "running" && agent.state !== "starting") || agent.mails.filter((m) => m.to === "main").length > priorMail) finish();
      });
      const timer = setTimeout(() => finish(), Math.min(30_000, Math.max(1, timeoutMs)));
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  async interrupt(id: string): Promise<string[]> {
    this.deps.assertCanWork?.();
    const agent = this.get(id);
    if (!agent.transport || (agent.state !== "running" && agent.state !== "starting")) throw new Error("Agent has no active work to interrupt");
    if (agent.interrupting) throw new Error("Agent interruption is already in progress");
    // Gate new sends immediately, then serialize queue capture/abort behind any
    // already-dispatched prompt. Captured messages are retained, never replayed.
    agent.interrupting = true;
    const operation = agent.serial.then(async () => {
      if (!this.live(agent) || !agent.transport) throw new Error("Agent is no longer connected");
      const queued = await agent.transport.request("clear_queue");
      if (!this.live(agent) || this.closed) throw new Error("Agent closed during interruption");
      const steering = Array.isArray(queued?.steering) ? queued.steering : [];
      const followUp = Array.isArray(queued?.followUp) ? queued.followUp : [];
      const collect = (items: unknown[], delivery: "steer" | "followUp") => items.filter((text): text is string => typeof text === "string").map(text => ({
        text, delivery, mailId: text.match(/\[hub-mail:([a-f0-9-]{36})\]/i)?.[1],
      }));
      agent.recoverableQueueDetails = [...collect(steering, "steer"), ...collect(followUp, "followUp")];
      agent.recoverableQueue = agent.recoverableQueueDetails.map(item => item.text);
      for (const item of agent.recoverableQueueDetails) {
        const mail = item.mailId ? agent.mails.find(candidate => candidate.id === item.mailId) : undefined;
        if (mail && mail.state !== "delivered") { mail.state = "unknown"; mail.error = `Cleared during interrupt; retained as ${item.delivery}, never automatically replayed`; }
      }
      await agent.transport.request("abort");
      if (!this.live(agent) || this.closed) return [...agent.recoverableQueue];
      this.pauseTimer(agent);
      if (this.live(agent)) { agent.state = "interrupted"; this.changed(agent); }
      return [...agent.recoverableQueue];
    });
    agent.serial = operation.catch(() => {});
    try { return await operation; } finally { agent.interrupting = false; }
  }
  setWaitingInput(id: string, requestId: string): void {
    const agent = this.get(id);
    if (!requestId || requestId.length > 128) throw new Error("Invalid input request id");
    if (agent.waitingRequestId && agent.waitingRequestId !== requestId) throw new Error("Agent already has a different pending input request");
    agent.waitingRequestId = requestId;
    agent.state = "waiting-input";
    this.pauseTimer(agent);
    this.changed(agent);
  }
  resolveInput(id: string, requestId: string): void {
    const agent = this.get(id);
    if (!agent.waitingRequestId || agent.waitingRequestId !== requestId) throw new Error("Stale or mismatched input reply");
    agent.waitingRequestId = undefined;
    agent.state = "running";
    this.resumeTimer(agent);
    this.changed(agent);
  }
  async resume(id: string): Promise<AgentRecord> {
    this.deps.assertCanWork?.();
    const agent = this.get(id);
    if (agent.transport && !agent.transportClosed && this.live(agent)) return agent;
    if (this.closed) throw new Error("Agents Hub is shutting down");
    if (!agent.sessionFile) throw new Error("Cannot resume: retained child session path is missing");
    if ([...this.agents.values()].filter((a) => this.live(a) || (a.transport && !a.transportClosed)).length >= this.config.maxConcurrent)
      throw new Error("Agent connection limit reached; stop an existing agent first");
    const previous = agent.state;
    agent.state = "starting"; agent.transportClosed = false; agent.closing = undefined;
    try {
      this.deps.assertCanWork?.();
      agent.transport = this.deps.connect(agent, (e) => this.event(agent, e), (e) => this.fail(agent, e));
      const state = await agent.transport.request("get_state");
      if (state.sessionFile && state.sessionFile !== agent.sessionFile) throw new Error("Resumed child session ownership mismatch");
      if (state.model?.provider !== agent.provider || state.model?.id !== agent.model) throw new Error("Resumed child model differs from retained metadata");
      agent.state = previous === "waiting-input" ? "waiting-input" : previous === "interrupted" ? "interrupted" : "idle";
      await this.configure(agent);
      this.changed(agent);
      return agent;
    } catch (error) {
      await this.closeAgent(agent);
      agent.state = previous;
      throw error;
    }
  }
  async stop(id: string) {
    const agent = this.get(id);
    if (!this.live(agent)) { await this.closeAgent(agent); return; }
    agent.state = "stopped";
    this.activity(agent, { kind: "status", text: "Stopped — working directory left untouched" });
    this.pauseTimer(agent);
    await this.closeDescendants(agent.id);
    for (const mail of agent.mails) if (mail.state === "queued" || mail.state === "sending") mail.state = "unknown";
    try { this.changed(agent); } finally { await this.closeAgent(agent); }
  }
  async shutdown() {
    this.closed = true;
    await Promise.allSettled([...this.agents.keys()].map((id) => this.stop(id)));
    this.listeners.clear();
    this.observers.clear();
    this.releaseOwnerLock();
  }
}
