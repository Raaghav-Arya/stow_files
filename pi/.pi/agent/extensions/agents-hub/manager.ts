import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RecordEvent, Transport } from "./rpc.ts";
import { defaultTools, validateTools } from "./tools.ts";
import { resultPreview, toolPreview, type ActivityEntry } from "./activity.ts";

export type AgentState = "starting" | "running" | "idle" | "failed" | "stopped";
export interface Launch {
  task: string;
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
  log: string; sessionFile?: string; error?: string;
  output: string; streamedText: string; turns: number; tokens: number; cost: number;
  activity: ActivityEntry[]; assistantActivity?: ActivityEntry; lastAssistant?: string;
  mails: Mail[]; logBytes: number; transport?: Transport;
  serial: Promise<unknown>; timer?: ReturnType<typeof setTimeout>;
  closing?: Promise<void>; transportClosed?: boolean;
}
export interface HubConfig { maxConcurrent: number; maxAgents: number; maxTurns: number; timeoutMinutes: number }
export const defaults: HubConfig = { maxConcurrent: 4, maxAgents: 12, maxTurns: 40, timeoutMinutes: 30 };
export function configFrom(value: unknown): HubConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("agents-hub.json must be an object");
  const config = { ...defaults };
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown agents-hub setting: ${key}`);
    const number = (value as Record<string, unknown>)[key];
    const max = key === "timeoutMinutes" ? 240 : key === "maxTurns" ? 200 : 32;
    if (!Number.isInteger(number) || (number as number) < 1 || (number as number) > max) throw new Error(`Invalid ${key}: expected integer 1..${max}`);
    (config as any)[key] = number;
  }
  return config;
}
export interface Dependencies {
  root: string;
  connect: (agent: AgentRecord, event: (event: RecordEvent) => void, exit: (error: Error) => void) => Transport;
  parent: (agent: AgentRecord, text: string, kind: "mail" | "settled" | "error") => void;
}

/** Runtime/transport independent registry. No automatic delegation or scheduling. */
export class AgentManager {
  readonly agents = new Map<string, AgentRecord>();
  readonly listeners = new Set<() => void>();
  private closed = false;
  constructor(readonly config: HubConfig, private deps: Dependencies) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed(agent: AgentRecord) {
    // Metadata is recovery information, never a claim that a child survives reload.
    const { transport, serial, timer, closing, output, streamedText, activity, assistantActivity, lastAssistant, ...metadata } = agent;
    writeFileSync(join(agent.directory, "agent.json"), JSON.stringify(metadata, null, 2), { mode: 0o600 });
    this.emit();
  }
  private emit() {
    // Observers own their failures; a UI/integration error must not kill a child.
    for (const listener of this.listeners) { try { listener(); } catch { /* isolated observer */ } }
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
    const line = JSON.stringify({ time: new Date().toISOString(), ...event }) + "\n";
    if (agent.logBytes + Buffer.byteLength(line) > 10 * 1024 * 1024) throw new Error("Agent event log reached 10 MiB limit");
    appendFileSync(agent.log, line, { mode: 0o600 });
    agent.logBytes += Buffer.byteLength(line);
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
    return { id: agent.id, name: agent.name, state: agent.state, task: agent.task,
      definition: agent.definition, tools: agent.tools, provider: agent.provider, model: agent.model, thinking: agent.thinking,
      workspace: agent.workspace, sessionFile: agent.sessionFile, log: agent.log,
      turns: agent.turns, tokens: agent.tokens, estimatedCost: agent.cost, error: agent.error };
  }
  async launch(input: Launch, signal?: AbortSignal): Promise<AgentRecord> {
    if (signal?.aborted) throw new Error("Launch cancelled");
    if (this.closed) throw new Error("Agents Hub is shutting down");
    if (!input.task.trim() || input.task.length > 16_000) throw new Error("Task must be 1..16000 characters");
    if (this.agents.size >= this.config.maxAgents) throw new Error("Session agent budget exhausted");
    if ([...this.agents.values()].filter((a) => this.live(a) || (a.transport && !a.transportClosed)).length >= this.config.maxConcurrent) throw new Error("Agent connection limit reached; stop an existing agent first");
    const cwd = realpathSync(input.cwd);
    if (!statSync(cwd).isDirectory()) throw new Error("Workspace must be an existing directory");
    const tools = validateTools(input.tools === undefined ? defaultTools : input.tools);
    const id = randomUUID();
    const directory = join(this.deps.root, id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    let ready!: () => void;
    let rejectReady!: (error: unknown) => void;
    const startup = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
    const agent: AgentRecord = { ...input, cwd, tools, name: input.name?.slice(0, 80) || id.slice(0, 8),
      id, directory, workspace: cwd, state: "starting", log: join(directory, "events.jsonl"),
      output: "", streamedText: "", activity: [], turns: 0, tokens: 0, cost: 0, mails: [], logBytes: 0, serial: startup };
    // Reserve capacity before async child startup. Workspace ownership is external.
    this.agents.set(id, agent);
    const cancel = () => { void this.stop(id).catch(() => {}); };
    signal?.addEventListener("abort", cancel, { once: true });
    // Reserve the initial task before publishing state to observers. Later sends
    // queue after it, and all prompts wait for the startup handshake.
    const initialPrompt = this.send(id, input.task, "main");
    void initialPrompt.catch(() => {});
    try {
      this.log(agent, { type: "launch", task: input.task, cwd, tools });
      this.changed(agent);
      if (this.closed || !this.live(agent)) throw new Error("Launch cancelled");
      agent.transport = this.deps.connect(agent, (e) => this.event(agent, e), (e) => this.fail(agent, e));
      if (!this.live(agent) || this.closed) { await this.closeAgent(agent); throw new Error("Launch cancelled"); }
      agent.timer = setTimeout(() => this.fail(agent, new Error("Agent lifetime timeout reached")), this.config.timeoutMinutes * 60_000);
      const state = await agent.transport.request("get_state");
      if (!this.live(agent) || this.closed) throw new Error("Launch cancelled");
      if (state.model?.provider !== input.provider || state.model?.id !== input.model) throw new Error("Child model differs from requested model");
      agent.sessionFile = state.sessionFile;
      agent.thinking = state.thinkingLevel;
      this.changed(agent);
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
  private fail(agent: AgentRecord, error: unknown) {
    if (!this.live(agent)) return;
    agent.state = "failed";
    agent.error = String(error instanceof Error ? error.message : error);
    clearTimeout(agent.timer);
    for (const mail of agent.mails) if (mail.state === "queued" || mail.state === "sending") mail.state = "unknown";
    this.text(agent, `\n[FAILED] ${agent.error}\n`);
    this.activity(agent, { kind: "error", text: agent.error });
    void this.closeAgent(agent).catch(() => {});
    try { this.log(agent, { type: "failure", error: agent.error }); this.changed(agent); } catch { /* disk errors must not leave child running */ }
    this.notify(agent, agent.error, "error");
  }
  private event(agent: AgentRecord, event: RecordEvent) {
    if (!this.live(agent) || this.closed) return;
    try {
      this.log(agent, event);
      if (event.type === "agent_start") { agent.state = "running"; agent.lastAssistant = undefined; }
      if (event.type === "turn_start" && ++agent.turns > this.config.maxTurns) throw new Error("Agent turn limit reached");
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
        if (agent.mails.filter((m) => m.to === "main").length >= 100) throw new Error("Parent mailbox limit reached");
        const text = event.result?.details?.parentMessage;
        if (typeof text !== "string" || !text.trim() || text.length > 8000) throw new Error("Invalid child message");
        agent.mails.push({ id: randomUUID(), from: agent.id, to: "main", text, state: "delivered" });
        this.text(agent, `\n[to main] ${text}\n`);
        this.activity(agent, { kind: "mail", label: "To main", text });
        this.notify(agent, text, "mail");
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
          if (message.stopReason === "error" || message.stopReason === "aborted") throw new Error(message.errorMessage || message.stopReason);
        }
      }
      if (event.type === "agent_settled") {
        agent.state = "idle";
        this.text(agent, "\n[idle — ready for another message]\n");
        this.activity(agent, { kind: "status", text: "Idle — ready for another message" });
        this.notify(agent, agent.lastAssistant || "Agent is idle; inspect its activity in Agents Hub.", "settled");
      }
      // Streaming notifications don't rewrite metadata on every token.
      if (event.type !== "message_update") this.changed(agent);
      else this.emit();
    } catch (error) { this.fail(agent, error); }
  }
  async send(id: string, text: string, from: "main" | "user" = "user", delivery: "steer" | "followUp" = "steer"): Promise<Mail> {
    const agent = this.get(id);
    if (!text.trim() || text.length > 16_000) throw new Error("Message must be 1..16000 characters");
    if (agent.mails.length >= 200) throw new Error("Agent mailbox budget exhausted");
    const mail: Mail = { id: randomUUID(), from, to: id, text, state: "sending" };
    agent.mails.push(mail);
    let submitted = false;
    const operation = agent.serial.then(async () => {
      if (!this.live(agent) || !agent.transport || this.closed) throw new Error("Agent is not connected");
      this.text(agent, `\n[from ${from}] ${text}\n`);
      this.activity(agent, { kind: "message", label: from === "user" ? "You" : "Main session", text });
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
      if (mail.state !== "delivered") mail.state = submitted ? "unknown" : "failed";
      mail.error = String(error);
      this.fail(agent, error); // Never retry a possibly accepted prompt automatically.
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
  async stop(id: string) {
    const agent = this.get(id);
    if (!this.live(agent)) { await this.closeAgent(agent); return; }
    agent.state = "stopped";
    this.activity(agent, { kind: "status", text: "Stopped — working directory left untouched" });
    clearTimeout(agent.timer);
    for (const mail of agent.mails) if (mail.state === "queued" || mail.state === "sending") mail.state = "unknown";
    try { this.changed(agent); } finally { await this.closeAgent(agent); }
  }
  async shutdown() {
    this.closed = true;
    await Promise.allSettled([...this.agents.keys()].map((id) => this.stop(id)));
    this.listeners.clear();
  }
}
