/** Explicitly loaded in Hub child RPC processes only. Never creates a second Hub manager. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import { HUB_PROTOCOL, HUB_PROTOCOL_VERSION, MAX_CONTROL_PENDING, MAX_CONTROL_TEXT, parseControlEnvelope, type ChildConfiguration, type ControlEnvelope, type MessageKind, type ParentMessage } from "./protocol.ts";

export default function (pi: ExtensionAPI) {
  if (process.env.PI_AGENTS_HUB_CHILD !== "1") return;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let configuration: ChildConfiguration | undefined;
  let usedTurns = 0;
  let blockedRequest: string | undefined;
  let closed = false;
  const send = (message: ControlEnvelope): Promise<void> => {
    const checked = parseControlEnvelope(message);
    if (typeof process.send !== "function" || !process.connected) return Promise.reject(new Error("No Agents Hub supervisor IPC channel is available"));
    return new Promise((resolve, reject) => process.send!(checked, (error) => error ? reject(error) : resolve()));
  };
  const requestRoot = (method: string, params: unknown): Promise<unknown> => {
    if (!configuration) return Promise.reject(new Error("Agents Hub supervisor is not configured; nested execution is unavailable"));
    if (pending.size >= MAX_CONTROL_PENDING) return Promise.reject(new Error("Too many pending Agents Hub requests"));
    const id = `child-${randomUUID()}`;
    const message = parseControlEnvelope({ protocol: HUB_PROTOCOL, version: HUB_PROTOCOL_VERSION, kind: "request", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Supervisor request ${method} timed out; result unknown`)); }, 30_000);
      pending.set(id, { resolve, reject, timer });
      void send(message).catch((error) => { const p = pending.get(id); if (p) { clearTimeout(timer); pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); } });
    });
  };
  const reply = async (id: string, ok: boolean, value: unknown) => send(parseControlEnvelope({ protocol: HUB_PROTOCOL, version: HUB_PROTOCOL_VERSION,
    kind: "response", id, ok, ...(ok ? { result: value } : { error: String(value).slice(0, 4000) }) }));
  const onMessage = (raw: unknown) => {
    void handleMessage(raw).catch((error) => console.error(`[agents-hub bridge] ${String(error)}`));
  };
  const handleMessage = async (raw: unknown) => {
    try {
      const message = parseControlEnvelope(raw);
      if (message.kind === "response") {
        const p = pending.get(message.id); if (!p) return;
        clearTimeout(p.timer); pending.delete(message.id);
        message.ok ? p.resolve(message.result) : p.reject(new Error(message.error));
      } else if (message.kind === "configure") {
        configuration = message.config; usedTurns = message.config.usedTurns;
        void reply("config", true, { configured: true }).catch(() => {});
      } else if (message.kind === "deliver") {
        if (!configuration) throw new Error("Received delivery before supervisor configuration");
        if (message.message.text.length > MAX_CONTROL_TEXT) throw new Error("Delivered message exceeds limit");
        // Custom messages preserve their Hub provenance and cannot impersonate user input.
        pi.sendMessage({ customType: "agents-hub-delivery", display: true,
          content: `[Agents Hub message from ${message.message.from}; kind=${message.message.kind}; task=${message.message.taskId}${message.message.requestId ? `; request=${message.message.requestId}` : ""}]\n${message.message.text}`,
          details: { ...message.message } }, { triggerTurn: message.message.kind !== "progress" });
      } else if (message.kind === "request") {
        if (message.method === "hub.configure") {
          const config = message.params as ChildConfiguration;
          if (!config || typeof config !== "object" || typeof config.agentId !== "string" || typeof config.taskId !== "string" ||
              !Number.isInteger(config.maxTurns) || config.maxTurns < 1 || !Number.isInteger(config.usedTurns) || config.usedTurns < 0 ||
              !config.rootPolicy || typeof config.rootPolicy.allowNested !== "boolean") throw new Error("Invalid child configuration");
          configuration = config; usedTurns = config.usedTurns;
          await reply(message.id, true, { configured: true, taskId: config.taskId });
        } else if (message.method === "hub.resolveInput") {
          const requestId = (message.params as { requestId?: unknown } | null)?.requestId;
          if (typeof requestId !== "string" || !blockedRequest || blockedRequest !== requestId) throw new Error("Stale or mismatched input reply");
          blockedRequest = undefined;
          await reply(message.id, true, { resolved: true, requestId });
        } else if (message.method === "hub.deliver") {
          const delivery = (message.params as { message?: unknown } | null)?.message;
          if (!delivery || typeof delivery !== "object") throw new Error("Invalid Hub delivery");
          const parsed = parseControlEnvelope({ protocol: HUB_PROTOCOL, version: HUB_PROTOCOL_VERSION, kind: "deliver", message: delivery });
          if (parsed.kind !== "deliver") throw new Error("Invalid delivery envelope");
          if (!configuration) throw new Error("Received delivery before supervisor configuration");
          pi.sendMessage({ customType: "agents-hub-delivery", display: true,
            content: `[Agents Hub message from ${parsed.message.from}; kind=${parsed.message.kind}; task=${parsed.message.taskId}${parsed.message.requestId ? `; request=${parsed.message.requestId}` : ""}]\\n${parsed.message.text}`,
            details: { ...parsed.message } }, { triggerTurn: parsed.message.kind !== "progress" });
          await reply(message.id, true, { accepted: true, requestId: parsed.message.requestId });
        } else await reply(message.id, false, `Unsupported root bridge method: ${message.method}`);
      }
    } catch (error) {
      // Malformed input is rejected locally and never forwarded as an ordinary prompt.
      if (raw && typeof raw === "object" && (raw as any).kind === "request" && typeof (raw as any).id === "string") {
        try { await reply((raw as any).id, false, error instanceof Error ? error.message : String(error)); } catch { /* disconnected */ }
      }
      else console.error(`[agents-hub bridge] ${String(error)}`);
    }
  };
  if (typeof process.on === "function") {
    process.on("message", onMessage);
    process.once("disconnect", () => {
      closed = true;
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("Agents Hub supervisor disconnected")); }
      pending.clear();
    });
  }
  pi.on("turn_start", (_event, ctx) => {
    if (!configuration) return;
    if (usedTurns >= configuration.maxTurns) { ctx.abort(); return; }
    usedTurns++;
  });
  pi.on("tool_call", () => {
    if (blockedRequest) return { block: true, terminate: true, reason: `Waiting for parent reply to input request ${blockedRequest}` };
  });
  pi.on("turn_end", () => {
    if (blockedRequest) return { continue: false };
  });
  pi.on("agent_before_settle", () => {
    if (blockedRequest) return { continue: false };
  });
  pi.on("agent_settled", () => { closed = false; });
  const report = async (args: ParentMessage) => {
    if (typeof args.message !== "string" || !args.message.trim() || args.message.length > 8000) throw new Error("message must be 1..8000 characters");
    const kind: MessageKind = args.kind ?? "progress";
    if (kind === "needs_input" && !args.requestId) throw new Error("needs_input messages require a requestId; use agents.reply when answering");
    const payload = { message: args.message, kind, ...(args.requestId ? { requestId: args.requestId } : {}) };
    if (configuration) {
      if (kind === "needs_input" && blockedRequest && blockedRequest !== args.requestId) throw new Error("Another input request is already pending");
      const previousRequest = blockedRequest;
      if (kind === "needs_input") blockedRequest = args.requestId;
      try { return await requestRoot("message_parent", payload); }
      catch (error) { if (kind === "needs_input" && blockedRequest === args.requestId) blockedRequest = previousRequest; throw error; }
    }
    if (typeof process.send === "function" && process.connected) throw new Error("Supervisor IPC exists but configuration has not arrived");
    // Legacy compatibility for existing root manager's tool-result event adapter.
    return { legacy: true, payload };
  };
  pi.registerTool({
    name: "message_parent", label: "Message parent", description: "Send progress, an explicit input request, or a result to your immediate parent. Does not wait for an answer. Legacy callers may provide only message.",
    parameters: Type.Object({ message: Type.String({ minLength: 1, maxLength: 8000 }), kind: Type.Optional(Type.Union([Type.Literal("progress"), Type.Literal("needs_input"), Type.Literal("result")])), requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })) }, { additionalProperties: false }),
    async execute(_id, args) {
      const outcome = await report(args as ParentMessage);
      return { content: [{ type: "text", text: outcome && typeof outcome === "object" && "legacy" in outcome
        ? "Message emitted to the parent transport. This is not an acknowledgement that the parent has read or acted on it."
        : "Message accepted by the parent supervisor; this is not proof it has been read or acted on." }],
        details: outcome && typeof outcome === "object" && "legacy" in outcome ? { parentMessage: args.message, parentKind: args.kind ?? "progress", requestId: args.requestId } : { acceptedBySupervisor: true } };
    },
  });
  pi.registerTool({
    name: "agents", label: "Delegate to owned agents", description: "Use the root-owned Agents Hub supervisor to launch or manage nested agents. Child permissions and resource limits are enforced by the root. If no supervisor is configured, requests fail immediately.",
    parameters: Type.Object({ method: Type.Union([Type.Literal("launch"), Type.Literal("list"), Type.Literal("read"), Type.Literal("send"), Type.Literal("result"), Type.Literal("reply"), Type.Literal("interrupt"), Type.Literal("close"), Type.Literal("resume")]), params: Type.Optional(Type.Any()) }, { additionalProperties: false }),
    async execute(_id, args) {
      const result = await requestRoot(`agents.${args.method}`, args.params ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result).slice(0, 24_000) }], details: result };
    },
  });
  void closed;
  void usedTurns;
}
