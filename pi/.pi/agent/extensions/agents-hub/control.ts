/** Shared validated control plane for root tools, commands, UI actions and child IPC. */
import type { AgentManager, Launch } from "./manager.ts";
import type { ControlRequest, ControlMethod } from "./protocol.ts";

export interface ControlCaller { kind: "root" | "agent"; agentId?: string; actor?: "ui" | "model" | "agent" }
export interface ControlContext { caller: ControlCaller; signal?: AbortSignal }
export interface ControlDependencies {
  manager: AgentManager;
  launch(input: Launch & { definitionName?: string }, signal?: AbortSignal): Promise<unknown>;
  result?(id: string, revision?: number, caller?: ControlCaller): unknown | Promise<unknown>;
  reply?(id: string, requestId: string, text: string, caller: ControlCaller): unknown | Promise<unknown>;
  resume?(id: string, caller: ControlCaller): unknown | Promise<unknown>;
  report?(id: string, parentId: string | undefined, input: { message: string; kind: string; requestId?: string }, caller: ControlCaller): unknown | Promise<unknown>;
  close?(id: string, caller: ControlCaller): unknown | Promise<unknown>;
}
const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const ALLOWED: Record<ControlMethod, string[]> = {
  "agents.launch": ["task", "parentId", "name", "cwd", "provider", "model", "thinking", "tools", "definitionName"],
  "agents.list": [], "agents.read": ["id"], "agents.send": ["id", "message", "delivery", "newTask"],
  "agents.result": ["id", "revision"], "agents.reply": ["id", "requestId", "message"],
  "agents.interrupt": ["id"], "agents.close": ["id"], "agents.resume": ["id"],
  message_parent: ["message", "kind", "requestId"],
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Control parameters must be an object");
  return value as Record<string, unknown>;
};

/** Identity is supplied by trusted adapters; child payloads can never name their caller. */
export class HubControl {
  constructor(private readonly deps: ControlDependencies) {}
  private owned(id: string, caller: ControlCaller): void {
    const target = this.deps.manager.get(id);
    if (caller.kind === "root") return;
    if (!caller.agentId || !this.deps.manager.agents.has(caller.agentId)) throw new Error("Authenticated connected child identity is required");
    if (id === caller.agentId) return;
    let parent = target.parentId;
    const seen = new Set<string>([id]);
    while (parent) {
      if (seen.has(parent)) throw new Error("Corrupt ownership cycle in agent registry");
      seen.add(parent);
      if (parent === caller.agentId) return;
      const ancestor = this.deps.manager.agents.get(parent);
      if (!ancestor) break;
      parent = ancestor.parentId;
    }
    throw new Error("Agent control is limited to the caller's own descendant subtree");
  }
  async handle(request: ControlRequest, context: ControlContext): Promise<unknown> {
    const method = request.method as ControlMethod;
    const params = record(request.params);
    const caller = context.caller;
    if (context.signal?.aborted) throw new Error("Control request cancelled");
    if (!Object.hasOwn(ALLOWED, method)) throw new Error(`Unsupported control method: ${request.method}`);
    for (const key of Object.keys(params)) if (!ALLOWED[method].includes(key)) throw new Error(`Unknown ${method} parameter: ${key}`);
    const id = params.id;
    if (method !== "agents.launch" && method !== "agents.list" && method !== "message_parent") {
      if (typeof id !== "string" || !VALID_ID.test(id)) throw new Error("A valid agent id is required");
      this.owned(id, caller);
    }
    switch (method) {
      case "agents.launch": {
        const payload = { ...params };
        const parentId = caller.kind === "agent" ? caller.agentId : params.parentId;
        if (caller.kind === "agent" && params.parentId !== undefined && params.parentId !== caller.agentId) throw new Error("Child cannot impersonate another parent");
        if (typeof payload.task !== "string" || !payload.task.trim() || payload.task.length > 16_000) throw new Error("Launch requires task (1..16000 characters)");
        if (parentId !== undefined && (typeof parentId !== "string" || !VALID_ID.test(parentId))) throw new Error("Invalid parent identity");
        if (caller.kind === "agent") this.owned(parentId as string, caller);
        return this.deps.launch({ ...payload, parentId } as unknown as Launch & { definitionName?: string }, context.signal);
      }
      case "agents.list": {
        const all = [...this.deps.manager.agents.values()];
        if (caller.kind === "root") return all.map(a => this.deps.manager.summary(a));
        if (!caller.agentId || !this.deps.manager.agents.has(caller.agentId)) throw new Error("Authenticated connected child identity is required");
        const visible = all.filter(a => {
          if (a.id === caller.agentId) return true;
          let parent = a.parentId; const seen = new Set<string>([a.id]);
          while (parent && !seen.has(parent)) { if (parent === caller.agentId) return true; seen.add(parent); parent = this.deps.manager.agents.get(parent)?.parentId; }
          return false;
        });
        return visible.map(a => this.deps.manager.summary(a));
      }
      case "agents.read": return this.deps.manager.summary(this.deps.manager.get(id as string));
      case "agents.send": {
        if (typeof params.message !== "string" || !params.message.trim() || params.message.length > 16_000) throw new Error("Message must be 1..16000 characters");
        if (params.delivery !== undefined && params.delivery !== "steer" && params.delivery !== "followUp") throw new Error("delivery must be steer or followUp");
        if (params.newTask !== undefined && typeof params.newTask !== "boolean") throw new Error("newTask must be boolean");
        return this.deps.manager.send(id as string, params.message, caller.kind === "root" ? (caller.actor === "ui" ? "user" : "main") : caller.agentId!, params.delivery as "steer" | "followUp" | undefined, params.newTask === true);
      }
      case "agents.result":
        if (!this.deps.result) throw new Error("Result retrieval is not available yet");
        if (params.revision !== undefined && (!Number.isSafeInteger(params.revision) || (params.revision as number) < 0)) throw new Error("Invalid result revision");
        return this.deps.result(id as string, params.revision as number | undefined, caller);
      case "agents.reply":
        if (!this.deps.reply || typeof params.requestId !== "string" || !VALID_ID.test(params.requestId) || typeof params.message !== "string") throw new Error("A correlated input request reply is required");
        return this.deps.reply(id as string, params.requestId, params.message, caller);
      case "agents.interrupt": return { recoveredMessages: await this.deps.manager.interrupt(id as string) };
      case "agents.close":
        if (this.deps.close) return this.deps.close(id as string, caller);
        await this.deps.manager.stop(id as string); return this.deps.manager.summary(this.deps.manager.get(id as string));
      case "agents.resume":
        if (!this.deps.resume) throw new Error("Explicit session resume is not available yet");
        return this.deps.resume(id as string, caller);
      case "message_parent": {
        if (caller.kind !== "agent" || !caller.agentId || !this.deps.manager.agents.has(caller.agentId)) throw new Error("message_parent requires authenticated connected child identity");
        const child = this.deps.manager.get(caller.agentId);
        if (!this.deps.report || typeof params.message !== "string" || !params.message.trim() || params.message.length > 8000) throw new Error("message_parent requires message (1..8000 characters)");
        const kind = params.kind === undefined ? "progress" : params.kind;
        if (!(["progress", "needs_input", "result"] as unknown[]).includes(kind)) throw new Error("Invalid message kind");
        if (kind === "needs_input" && (typeof params.requestId !== "string" || !VALID_ID.test(params.requestId))) throw new Error("needs_input requires requestId");
        if (params.requestId !== undefined && (typeof params.requestId !== "string" || !VALID_ID.test(params.requestId))) throw new Error("Invalid requestId");
        return this.deps.report(child.id, child.parentId, { message: params.message, kind: kind as string, ...(params.requestId ? { requestId: params.requestId as string } : {}) }, caller);
      }
      default: throw new Error(`Unsupported control method: ${request.method}`);
    }
  }
}
