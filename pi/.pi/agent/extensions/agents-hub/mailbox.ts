import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type HubEventKind = "completed" | "failed" | "needs_input" | "progress";
export type HubEventState = "pending" | "injected" | "observed" | "consumed" | "failed" | "unknown";

/** Immutable notification snapshot; the revision identifies exactly which result it describes. */
export interface HubEvent {
  version: 1;
  id: string;
  rootSessionId: string;
  rootGeneration: number;
  recipientId: string;
  sourceAgentId: string;
  parentId?: string;
  kind: HubEventKind;
  taskId: string;
  revision: number;
  createdAt: string;
  text: string;
  requestId?: string;
  provenance: { actor: "agent" | "user" | "system"; label: string };
}

export interface EventStateRecord {
  version: 1;
  type: "state";
  eventId: string;
  state: HubEventState;
  at: string;
  detail?: string;
  deliveryId?: string;
}

type JournalRecord = HubEvent | EventStateRecord;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_EVENTS = 100_000;

function ensurePrivateDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
}
function appendDurable(path: string, record: JournalRecord): void {
  ensurePrivateDirectory(path);
  const line = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(line) > MAX_EVENT_BYTES) throw new Error(`Mailbox record exceeds ${MAX_EVENT_BYTES} bytes`);
  const fd = openSync(path, "a", 0o600);
  try { appendFileSync(fd, line, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
}
function validEvent(value: unknown): value is HubEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<HubEvent>;
  return e.version === 1 && typeof e.id === "string" && typeof e.rootSessionId === "string" &&
    Number.isSafeInteger(e.rootGeneration) && typeof e.recipientId === "string" &&
    typeof e.sourceAgentId === "string" && typeof e.taskId === "string" &&
    Number.isSafeInteger(e.revision) && e.revision! >= 0 && typeof e.text === "string" &&
    ["completed", "failed", "needs_input", "progress"].includes(String(e.kind)) &&
    !!e.provenance && ["agent", "user", "system"].includes(e.provenance.actor);
}

/** Append-only private event journal. Read/inspection never consumes an event. */
export class DurableMailbox {
  private eventsById = new Map<string, HubEvent>();
  private latestState = new Map<string, EventStateRecord>();
  private readonly journalPath: string;
  constructor(path: string) {
    this.journalPath = path;
    if (!existsSync(path)) return;
    const lines = readFileSync(path, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]) continue;
      let record: unknown;
      try { record = JSON.parse(lines[i]); } catch { throw new Error(`Corrupt mailbox journal at ${path}:${i + 1}`); }
      if (validEvent(record)) {
        if (!this.eventsById.has(record.id)) this.eventsById.set(record.id, record);
        continue;
      }
      if (record && typeof record === "object" && (record as EventStateRecord).type === "state") {
        const state = record as EventStateRecord;
        if (state.version !== 1 || !this.eventsById.has(state.eventId) || typeof state.state !== "string") {
          throw new Error(`Invalid mailbox state record at ${path}:${i + 1}`);
        }
        this.latestState.set(state.eventId, state);
        continue;
      }
      throw new Error(`Invalid mailbox record at ${path}:${i + 1}`);
    }
    if (this.eventsById.size > MAX_EVENTS) throw new Error(`Mailbox has ${this.eventsById.size} events; archive or configure retention before adding more`);
  }

  create(input: Omit<HubEvent, "version" | "id" | "createdAt"> & { id?: string; createdAt?: string }): HubEvent {
    const event: HubEvent = { ...input, version: 1, id: input.id || randomUUID(), createdAt: input.createdAt || new Date().toISOString() };
    if (!validEvent(event)) throw new Error("Invalid typed mailbox event");
    if (Buffer.byteLength(JSON.stringify(event)) > MAX_EVENT_BYTES) throw new Error(`Mailbox event exceeds ${MAX_EVENT_BYTES} bytes`);
    if (this.eventsById.has(event.id)) throw new Error(`Duplicate mailbox event id: ${event.id}`);
    if (this.eventsById.size >= MAX_EVENTS) throw new Error(`Mailbox capacity (${MAX_EVENTS}) reached; pending events are preserved`);
    appendDurable(this.journalPath, event); // persistence failure is intentionally propagated
    this.eventsById.set(event.id, event);
    this.setState(event.id, "pending");
    return event;
  }

  get(id: string): HubEvent | undefined { return this.eventsById.get(id); }
  state(id: string): EventStateRecord { return this.latestState.get(id) || { version: 1, type: "state", eventId: id, state: "pending", at: "" }; }
  list(filter: { recipientId?: string; state?: HubEventState; includeProgress?: boolean } = {}): HubEvent[] {
    return [...this.eventsById.values()].filter(e =>
      (!filter.recipientId || e.recipientId === filter.recipientId) &&
      (filter.includeProgress || e.kind !== "progress") &&
      (!filter.state || this.state(e.id).state === filter.state),
    );
  }
  setState(eventId: string, state: HubEventState, detail?: string, deliveryId?: string): EventStateRecord {
    if (!this.eventsById.has(eventId)) throw new Error(`Unknown mailbox event: ${eventId}`);
    const record: EventStateRecord = { version: 1, type: "state", eventId, state, at: new Date().toISOString(), ...(detail ? { detail: detail.slice(0, 2000) } : {}), ...(deliveryId ? { deliveryId } : {}) };
    appendDurable(this.journalPath, record);
    this.latestState.set(eventId, record);
    return record;
  }
  all(): HubEvent[] { return [...this.eventsById.values()]; }
}
