/** Bounded JSONL subprocess transport; launches argv directly, never via a shell. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export type RecordEvent = Record<string, any>;
export interface Transport {
  request(type: string, fields?: RecordEvent): Promise<any>;
  close(): Promise<void>;
}

export class RpcTransport implements Transport {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private sequence = 0;
  private ended = false;
  private closing = false;
  private stopping?: Promise<void>;
  private stderr = "";

  constructor(command: string, args: string[], cwd: string,
    onEvent: (event: RecordEvent) => void, onExit: (error: Error) => void,
    private deadline = 30_000, env: Record<string, string> = {}) {
    this.child = spawn(command, args, {
      cwd, stdio: "pipe", detached: process.platform !== "win32",
      env: { ...process.env, PI_AGENTS_HUB_CHILD: "1", ...env },
    });
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    this.child.stdout.on("data", (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      // Split only on LF, NOT readline's Unicode line separators.
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (Buffer.byteLength(line) > 4 * 1024 * 1024) return fail(new Error("RPC record exceeds 4 MiB"));
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (!event || typeof event.type !== "string") throw new Error("Invalid RPC record");
          if (event.type === "response") {
            const request = this.pending.get(event.id);
            if (!request) continue;
            clearTimeout(request.timer);
            this.pending.delete(event.id);
            event.success ? request.resolve(event.data) : request.reject(new Error(event.error || "RPC request failed"));
          } else onEvent(event);
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); return; }
      }
      if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) fail(new Error("Unterminated RPC record exceeds 4 MiB"));
    });
    this.child.stderr.on("data", (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString()).slice(-8192); });
    const fail = (error: Error) => {
      if (this.ended) return;
      this.ended = true;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear();
      if (!this.closing) onExit(error);
      void this.close();
    };
    this.child.on("error", fail);
    this.child.stdin.on("error", fail);
    this.child.on("exit", (code, signal) => fail(new Error(`Agent process exited (${code ?? signal}). ${this.stderr}`)));
  }

  request(type: string, fields: RecordEvent = {}): Promise<any> {
    if (this.ended || this.closing) return Promise.reject(new Error("Agent connection is closed"));
    if (this.pending.size >= 32) return Promise.reject(new Error("Too many pending RPC requests"));
    const id = `hub-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC ${type} timed out; delivery unknown`));
      }, this.deadline);
      this.pending.set(id, { resolve, reject, timer });
      // One write per record. Node's stream queues writes in order and handles
      // pipe backpressure; the request count and message size are bounded above.
      this.child.stdin.write(JSON.stringify({ ...fields, type, id }) + "\n", (error) => {
        if (!error) return;
        const request = this.pending.get(id);
        if (request) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }

  close(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.closing = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error("Agent stopped")); }
    this.pending.clear();
    this.stopping = new Promise((resolve) => {
      const signal = (name: NodeJS.Signals) => {
        try {
          if (this.child.pid && process.platform !== "win32") process.kill(-this.child.pid, name);
          else this.child.kill(name);
        } catch { /* already exited */ }
      };
      // Always signal the owned process group, even if the leader already exited.
      this.child.stdin.end();
      signal("SIGTERM");
      const timer = setTimeout(() => { signal("SIGKILL"); resolve(); }, 750);
      timer.unref();
      this.child.once("close", () => { clearTimeout(timer); signal("SIGKILL"); resolve(); });
      if (this.child.exitCode !== null || this.child.signalCode !== null) { clearTimeout(timer); signal("SIGKILL"); resolve(); }
    });
    return this.stopping;
  }
}
