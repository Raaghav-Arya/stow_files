/** Versioned private Node IPC protocol for the root-owned Agents Hub child bridge. */
export const HUB_PROTOCOL = "pi.agents-hub" as const;
export const HUB_PROTOCOL_VERSION = 1 as const;
export const MAX_CONTROL_FRAME_BYTES = 256 * 1024;
export const MAX_CONTROL_PENDING = 32;
export const MAX_CONTROL_TEXT = 16_000;

export type MessageKind = "progress" | "needs_input" | "result";
export interface ParentMessage { message: string; kind?: MessageKind; requestId?: string }
export interface ChildIdentity { agentId: string; parentId?: string; depth: number }
export interface ChildConfiguration extends ChildIdentity {
  taskId: string;
  maxTurns: number;
  usedTurns: number;
  rootPolicy: { allowNested: boolean; maxDepth: number; maxAgents: number; maxConcurrent: number };
}
export type ControlMethod = "agents.launch" | "agents.list" | "agents.read" | "agents.send" |
  "agents.result" | "agents.reply" | "agents.interrupt" | "agents.close" | "agents.resume" | "message_parent";
export interface ControlRequest { method: ControlMethod; params: Record<string, unknown> }
export type ControlEnvelope =
  | { protocol: typeof HUB_PROTOCOL; version: typeof HUB_PROTOCOL_VERSION; kind: "request"; id: string; method: string; params: unknown }
  | { protocol: typeof HUB_PROTOCOL; version: typeof HUB_PROTOCOL_VERSION; kind: "response"; id: string; ok: true; result: unknown }
  | { protocol: typeof HUB_PROTOCOL; version: typeof HUB_PROTOCOL_VERSION; kind: "response"; id: string; ok: false; error: string }
  | { protocol: typeof HUB_PROTOCOL; version: typeof HUB_PROTOCOL_VERSION; kind: "configure"; config: ChildConfiguration }
  | { protocol: typeof HUB_PROTOCOL; version: typeof HUB_PROTOCOL_VERSION; kind: "deliver"; message: { from: string; text: string; kind: MessageKind; requestId?: string; taskId: string } };

export function parseControlEnvelope(value: unknown): ControlEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed Hub IPC envelope");
  const e = value as Record<string, unknown>;
  if (e.protocol !== HUB_PROTOCOL || e.version !== HUB_PROTOCOL_VERSION) throw new Error("Unsupported Hub IPC protocol version");
  if (typeof e.kind !== "string" || !["request", "response", "configure", "deliver"].includes(e.kind)) throw new Error("Unknown Hub IPC message kind");
  if (e.kind === "request" || e.kind === "response") {
    if (typeof e.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(e.id)) throw new Error("Invalid Hub IPC correlation id");
    if (e.kind === "request" && (typeof e.method !== "string" || e.method.length < 1 || e.method.length > 80 ||
        !Object.hasOwn(e, "params"))) throw new Error("Invalid Hub IPC method or request payload");
    if (e.kind === "response" && (typeof e.ok !== "boolean" || (e.ok && !Object.hasOwn(e, "result")) || (!e.ok && typeof e.error !== "string"))) throw new Error("Invalid Hub IPC response");
  } else if (e.kind === "configure") {
    const c = e.config as Record<string, unknown> | undefined;
    if (!c || typeof c !== "object" || typeof c.agentId !== "string" || !c.agentId || typeof c.taskId !== "string" ||
        !Number.isInteger(c.depth) || (c.depth as number) < 0 || !Number.isInteger(c.maxTurns) || (c.maxTurns as number) < 1 ||
        !Number.isInteger(c.usedTurns) || (c.usedTurns as number) < 0 || !c.rootPolicy || typeof c.rootPolicy !== "object") throw new Error("Invalid Hub IPC configuration");
  } else if (e.kind === "deliver") {
    const m = e.message as Record<string, unknown> | undefined;
    if (!m || typeof m !== "object" || typeof m.from !== "string" || typeof m.taskId !== "string" ||
        typeof m.text !== "string" || m.text.length > MAX_CONTROL_TEXT || !["progress", "needs_input", "result"].includes(String(m.kind)) ||
        (m.requestId !== undefined && (typeof m.requestId !== "string" || m.requestId.length > 128))) throw new Error("Invalid Hub IPC delivery payload");
  }
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > MAX_CONTROL_FRAME_BYTES) throw new Error("Hub IPC frame exceeds 256 KiB");
  return value as ControlEnvelope;
}
