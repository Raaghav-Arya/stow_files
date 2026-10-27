/** Bounded JSONL Pi RPC plus an optional, versioned, private Node IPC control channel. */
import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";
import { HUB_PROTOCOL, HUB_PROTOCOL_VERSION, MAX_CONTROL_FRAME_BYTES, MAX_CONTROL_PENDING, parseControlEnvelope, type ChildConfiguration, type ControlEnvelope } from "./protocol.ts";

export class RpcCommandError extends Error {
  constructor(message: string) { super(message); this.name = "RpcCommandError"; }
}
export type RecordEvent = Record<string, any>;
export interface Transport { request(type: string, fields?: RecordEvent): Promise<any>; close(): Promise<void>; requestBridge?(method: string, params: unknown): Promise<unknown> }
export interface ControlRequestContext { /** Always supplied from the spawn configuration; never read from child data. */ caller: { agentId: string; parentId?: string; depth: number } }
export interface RpcTransportOptions {
  /** Enable a dedicated Node IPC channel in addition to Pi's JSONL stdio protocol. */
  ipc?: boolean;
  /** Requests are authenticated by this transport's child process identity. */
  identity?: ControlRequestContext["caller"];
  /** Handle child-to-root bridge requests; omitted requests fail closed. */
  onControlRequest?: (request: { method: string; params: unknown }, context: ControlRequestContext) => unknown | Promise<unknown>;
  deadline?: number;
}
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type UnsignedControlEnvelope = ControlEnvelope extends infer E ? E extends { protocol: unknown; version: unknown } ? Omit<E, "protocol" | "version"> : never : never;

export class RpcTransport implements Transport {
  private child: ChildProcess;
  private pending = new Map<string, Pending>();
  private controlPending = new Map<string, Pending>();
  private sequence = 0;
  private ended = false;
  private closing = false;
  private stopping?: Promise<void>;
  private stderr = "";
  private deadline: number;
  private ipc: boolean;
  private identity?: RpcTransportOptions["identity"];
  private onControlRequest?: RpcTransportOptions["onControlRequest"];

  constructor(command: string, args: string[], cwd: string,
    onEvent: (event: RecordEvent) => void, onExit: (error: Error) => void,
    private legacyDeadline = 30_000, env: Record<string, string> = {}, options: RpcTransportOptions = {}) {
    this.deadline = options.deadline ?? legacyDeadline;
    this.ipc = options.ipc === true;
    this.identity = options.identity;
    this.onControlRequest = options.onControlRequest;
    this.child = spawn(command, args, {
      cwd, stdio: this.ipc ? ["pipe", "pipe", "pipe", "ipc"] : "pipe", detached: process.platform !== "win32",
      env: { ...process.env, PI_AGENTS_HUB_CHILD: "1", ...env },
    });
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    const fail = (error: Error) => {
      if (this.ended) return;
      this.ended = true;
      for (const map of [this.pending, this.controlPending]) {
        for (const request of map.values()) { clearTimeout(request.timer); request.reject(error); }
        map.clear();
      }
      if (!this.closing) onExit(error);
      void this.close();
    };
    this.child.stdout!.on("data", (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, ""); buffer = buffer.slice(end + 1);
        if (Buffer.byteLength(line) > 4 * 1024 * 1024) return fail(new Error("RPC record exceeds 4 MiB"));
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (!event || typeof event.type !== "string") throw new Error("Invalid RPC record");
          if (event.type === "response") {
            const request = this.pending.get(event.id);
            if (!request) continue;
            clearTimeout(request.timer); this.pending.delete(event.id);
            event.success ? request.resolve(event.data) : request.reject(new RpcCommandError(event.error || "RPC request rejected"));
          } else onEvent(event);
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); return; }
      }
      if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) fail(new Error("Unterminated RPC record exceeds 4 MiB"));
    });
    this.child.stderr!.on("data", (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString()).slice(-8192); });
    if (this.ipc) {
      this.child.on("message", (raw: unknown) => {
        void this.receiveControl(raw).catch((error) => fail(error instanceof Error ? error : new Error(String(error))));
      });
      this.child.on("disconnect", () => {
        if (!this.closing && !this.ended) fail(new Error("Hub IPC channel disconnected"));
      });
    }
    this.child.on("error", fail);
    this.child.stdin!.on("error", fail);
    this.child.on("exit", (code, signal) => fail(new Error(`Agent process exited (${code ?? signal}). ${this.stderr}`)));
  }

  private envelope(fields: UnsignedControlEnvelope): ControlEnvelope {
    return parseControlEnvelope({ protocol: HUB_PROTOCOL, version: HUB_PROTOCOL_VERSION, ...fields });
  }
  private sendControl(message: ControlEnvelope): Promise<void> {
    if (!this.ipc || !this.child.connected || this.ended || this.closing) return Promise.reject(new Error("Agent has no available Hub IPC channel"));
    if (Buffer.byteLength(JSON.stringify(message)) > MAX_CONTROL_FRAME_BYTES) return Promise.reject(new Error("Hub IPC frame exceeds 256 KiB"));
    return new Promise((resolve, reject) => {
      try {
        this.child.send!(message, (error) => error ? reject(error) : resolve());
      } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  private async receiveControl(raw: unknown): Promise<void> {
    const message = parseControlEnvelope(raw);
    if (message.kind === "response") {
      const pending = this.controlPending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.controlPending.delete(message.id);
      message.ok ? pending.resolve(message.result) : pending.reject(new Error(message.error));
      return;
    }
    if (message.kind !== "request") throw new Error(`Unexpected child Hub IPC message: ${message.kind}`);
    if (!this.onControlRequest || !this.identity) {
      await this.sendControl(this.envelope({ kind: "response", id: message.id, ok: false, error: "No root supervisor is configured for child requests" }));
      return;
    }
    try {
      const result = await this.onControlRequest({ method: message.method, params: message.params }, { caller: this.identity });
      await this.sendControl(this.envelope({ kind: "response", id: message.id, ok: true, result }));
    } catch (error) {
      await this.sendControl(this.envelope({ kind: "response", id: message.id, ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 4000) }));
    }
  }
  /** Root-initiated, correlated request to this child's bridge (configure/delivery/control). */
  requestBridge(method: string, params: unknown): Promise<unknown> {
    if (!this.ipc) return Promise.reject(new Error("Nested bridge unavailable: this child was launched without Hub IPC"));
    if (this.ended || this.closing) return Promise.reject(new Error("Agent connection is closed"));
    if (this.controlPending.size >= MAX_CONTROL_PENDING) return Promise.reject(new Error("Too many pending Hub IPC requests"));
    const id = `root-${++this.sequence}`;
    const message = this.envelope({ kind: "request", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.controlPending.delete(id); reject(new Error(`Hub IPC ${method} timed out; delivery unknown`)); }, this.deadline);
      this.controlPending.set(id, { resolve, reject, timer });
      void this.sendControl(message).catch((error) => {
        const request = this.controlPending.get(id);
        if (request) { clearTimeout(timer); this.controlPending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
      });
    });
  }
  configure(config: ChildConfiguration): Promise<unknown> { return this.requestBridge("hub.configure", config); }
  deliver(message: { from: string; text: string; kind: "progress" | "needs_input" | "result"; requestId?: string; taskId: string }): Promise<unknown> {
    return this.requestBridge("hub.deliver", { message });
  }
  request(type: string, fields: RecordEvent = {}): Promise<any> {
    if (this.ended || this.closing) return Promise.reject(new Error("Agent connection is closed"));
    if (this.pending.size >= 32) return Promise.reject(new Error("Too many pending RPC requests"));
    const id = `hub-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`RPC ${type} timed out; delivery unknown`)); }, this.deadline);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin!.write(JSON.stringify({ ...fields, type, id }) + "\n", (error) => {
        if (!error) return;
        const request = this.pending.get(id);
        if (request) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  close(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.closing = true;
    for (const map of [this.pending, this.controlPending]) {
      for (const request of map.values()) { clearTimeout(request.timer); request.reject(new Error("Agent stopped")); }
      map.clear();
    }
    this.stopping = new Promise((resolve) => {
      const signal = (name: NodeJS.Signals) => {
        try { if (this.child.pid && process.platform !== "win32") process.kill(-this.child.pid, name); else this.child.kill(name); } catch { /* already exited */ }
      };
      this.child.stdin?.end(); signal("SIGTERM");
      const timer = setTimeout(() => { signal("SIGKILL"); resolve(); }, 750); timer.unref();
      this.child.once("close", () => { clearTimeout(timer); signal("SIGKILL"); resolve(); });
      if (this.child.exitCode !== null || this.child.signalCode !== null) { clearTimeout(timer); signal("SIGKILL"); resolve(); }
    });
    return this.stopping;
  }
}
