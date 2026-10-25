import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DurableMailbox, type HubEvent, type HubEventState } from "./mailbox.ts";

export const IDLE_COALESCE_MS = 200;
export interface DeliverySnapshot {
  version: 1;
  id: string;
  eventIds: string[];
  recipientId: string;
  createdAt: string;
  content: string;
  state: "pending" | "injected" | "failed" | "unknown";
  detail?: string;
}
interface DeliveryRecord { version: 1; type: "delivery"; snapshot: DeliverySnapshot; at: string }
export interface DeliveryNotice { id: string; eventIds: string[]; recipientId: string; content: string; events: HubEvent[] }
export interface DeliveryOptions {
  mailbox: DurableMailbox;
  journalPath: string;
  recipientId: string;
  isBusy: () => boolean;
  /** Runs before any attempt is journaled; refusal retains pending events. */
  preflight?: () => void;
  /** Must enqueue a custom message with triggerTurn at a supported safe boundary (steer/continuation), never inject into an in-flight model request. */
  send: (notice: DeliveryNotice) => void | Promise<void>;
  /** False means passive-only policy: retain pending events for explicit drain/result read. */
  wakeupsEnabled?: boolean;
  coalesceMs?: number;
  maxEventsPerDelivery?: number;
  maxContentChars?: number;
}

/**
 * Durable adaptation of tintinweb/pi-subagents completion-outbox.ts batching and
 * idle coalescing. Unlike the reference's volatile outbox, failures are journaled
 * as unknown and snapshots are retained for reconciliation; nothing is swallowed.
 */
export class ParentDelivery {
  private pending = new Set<string>();
  private holdReasons = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deliveries = new Map<string, DeliverySnapshot>();
  private busy: boolean;
  private disposed = false;
  private inFlight?: Promise<DeliverySnapshot | undefined>;
  private readonly coalesceMs: number;
  private readonly maxEvents: number;
  private readonly maxChars: number;

  constructor(private options: DeliveryOptions) {
    this.coalesceMs = options.coalesceMs ?? IDLE_COALESCE_MS;
    this.maxEvents = options.maxEventsPerDelivery ?? 32;
    this.maxChars = options.maxContentChars ?? 16_000;
    if (!Number.isInteger(this.coalesceMs) || this.coalesceMs < 0 || this.coalesceMs > 10_000) throw new Error("Invalid delivery coalescing interval");
    if (!Number.isInteger(this.maxEvents) || this.maxEvents < 1 || this.maxEvents > 256) throw new Error("Invalid delivery batch size");
    if (!Number.isInteger(this.maxChars) || this.maxChars < 256 || this.maxChars > 64_000) throw new Error("Invalid delivery context bound");
    this.busy = options.isBusy();
    this.restore();
  }

  /** Queue only lifecycle/input events; progress is durable but never wakes the parent. */
  enqueue(event: HubEvent): void {
    if (this.disposed) throw new Error("Delivery is disposed");
    if (event.recipientId !== this.options.recipientId) throw new Error("Event is addressed to another recipient");
    if (event.kind === "progress") return;
    if (this.options.mailbox.state(event.id).state !== "pending") return;
    this.pending.add(event.id);
    if (this.options.wakeupsEnabled !== false && this.holdReasons.size === 0 && !this.busy) this.arm();
  }

  /** Called after a complete safe turn/tool-batch boundary, not while tools are in flight. */
  onSafeBoundary(stopReason?: string, verifiedBoundary = false): Promise<DeliverySnapshot | undefined> | undefined {
    this.busy = this.options.isBusy();
    if (stopReason === "aborted" || stopReason === "error") { this.hold("interrupted-boundary"); return; }
    // A turn_end/tool-batch boundary is safe even if Pi still reports the parent
    // as busy until the next turn starts. Callers must explicitly attest it.
    if (this.busy && !verifiedBoundary) return;
    if (this.holdReasons.size === 0 && this.options.wakeupsEnabled !== false) return this.flush(false, verifiedBoundary);
  }
  onIdle(): void {
    this.busy = false;
    if (this.pending.size && this.holdReasons.size === 0 && this.options.wakeupsEnabled !== false) this.arm();
  }
  onBusy(): void { this.busy = true; this.cancelTimer(); }

  hold(reason: string): void { if (!reason.trim()) throw new Error("Hold reason is required"); this.holdReasons.add(reason); this.cancelTimer(); }
  resume(reason?: string): void {
    if (reason) this.holdReasons.delete(reason); else this.holdReasons.clear();
    if (this.holdReasons.size === 0 && this.pending.size && this.options.wakeupsEnabled !== false) {
      if (this.busy) return;
      this.arm();
    }
  }
  holds(): string[] { return [...this.holdReasons]; }
  pendingEvents(): HubEvent[] { return [...this.pending].map(id => this.options.mailbox.get(id)).filter((e): e is HubEvent => !!e); }
  snapshots(): DeliverySnapshot[] { return [...this.deliveries.values()]; }
  dispose(): void { this.disposed = true; this.cancelTimer(); }

  /** Explicit user/model-facing drain. Passive mode still permits deliberate delivery. */
  async drain(): Promise<DeliverySnapshot | undefined> {
    if (this.busy) throw new Error("Cannot dispatch parent notification inside an in-flight turn");
    if (this.holdReasons.size) throw new Error(`Parent notifications held: ${[...this.holdReasons].join(", ")}`);
    return this.flush(true);
  }

  private arm(): void {
    if (this.timer || this.disposed || this.inFlight) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch((error) => {
        this.hold("delivery-error");
        // The failure is visible to callers through holds/snapshots; timer errors
        // must never become unhandled rejections in the host process.
        const detail = String(error instanceof Error ? error.message : error).slice(0, 2000);
        for (const snapshot of this.deliveries.values()) if (snapshot.state === "unknown") snapshot.detail ??= detail;
      });
    }, this.coalesceMs);
  }
  private cancelTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private async flush(explicit = false, verifiedBoundary = false): Promise<DeliverySnapshot | undefined> {
    this.cancelTimer();
    if (this.inFlight) return this.inFlight;
    if (this.disposed || (this.busy && !verifiedBoundary) || this.holdReasons.size || (!explicit && this.options.wakeupsEnabled === false)) return;
    try { this.options.preflight?.(); }
    catch (error) {
      this.hold(error instanceof Error && error.message.includes("budget") ? "wakeup-budget-exhausted" : "policy-restricted");
      return;
    }
    const operation = this.flushOne(explicit);
    this.inFlight = operation;
    try { return await operation; } finally {
      this.inFlight = undefined;
      if (this.pending.size && this.holdReasons.size === 0 && this.options.wakeupsEnabled !== false && !this.busy) this.arm();
    }
  }
  private async flushOne(_explicit: boolean): Promise<DeliverySnapshot | undefined> {
    const candidates = [...this.pending].slice(0, this.maxEvents);
    if (!candidates.length) return;
    const events = candidates.map(id => this.options.mailbox.get(id)).filter((e): e is HubEvent => !!e);
    if (!events.length) return;
    const id = randomUUID();
    const lines: string[] = [];
    let content = "";
    for (const e of events) {
      const line = `[${e.kind}] ${e.sourceAgentId} -> ${e.recipientId}; task=${e.taskId}; revision=${e.revision}; event=${e.id}; provenance=${e.provenance.label}\n${e.text}`;
      if (content.length + line.length + 2 > this.maxChars) break;
      content += `${content ? "\n\n" : ""}${line}`;
      lines.push(e.id);
    }
    if (!lines.length) {
      for (const e of events) this.options.mailbox.setState(e.id, "pending", `Held: event exceeds ${this.maxChars} character delivery context bound`);
      return;
    }
    const snapshot: DeliverySnapshot = { version: 1, id, eventIds: lines, recipientId: this.options.recipientId, createdAt: new Date().toISOString(), content, state: "pending" };
    this.persist(snapshot);
    this.deliveries.set(id, snapshot);
    // Mark dispatching as unknown durably before send. A crash at any point
    // cannot cause a restore to blindly replay an uncertain batch.
    for (const eventId of lines) { this.pending.delete(eventId); this.options.mailbox.setState(eventId, "unknown", "Dispatch in progress; reconcile before retry", id); }
    try {
      await this.options.send({ id, eventIds: [...lines], recipientId: snapshot.recipientId, content, events: events.filter(e => lines.includes(e.id)) });
      this.replace(snapshot, "injected");
      for (const eventId of lines) this.options.mailbox.setState(eventId, "injected", undefined, id);
      return this.deliveries.get(id);
    } catch (error) {
      const detail = String(error).slice(0, 2000);
      this.replace(snapshot, "unknown", detail);
      for (const eventId of lines) { this.pending.delete(eventId); this.options.mailbox.setState(eventId, "unknown", detail, id); }
      this.holdReasons.add("delivery-unknown");
      throw new Error(`Parent delivery ${id} outcome unknown; snapshot retained for reconciliation: ${detail}`);
    }
  }

  /** Reconcile a lost send acknowledgement using an adapter's persisted event IDs. */
  reconcile(deliveryId: string, observedEventIds: readonly string[], status: "observed" | "not_observed" | "unknown"): void {
    const snapshot = this.deliveries.get(deliveryId);
    if (!snapshot) throw new Error(`Unknown delivery snapshot: ${deliveryId}`);
    if (status === "unknown") return;
    if (status === "not_observed") {
      this.replace(snapshot, "pending", "No matching event IDs found; explicit retry required");
      this.holdReasons.delete("delivery-unknown");
      for (const id of snapshot.eventIds) { this.options.mailbox.setState(id, "pending", "Explicitly reconciled absent; deliberate retry required", deliveryId); this.pending.add(id); }
      return;
    }
    const observed = new Set(observedEventIds);
    const matches = snapshot.eventIds.filter(id => observed.has(id));
    if (matches.length !== snapshot.eventIds.length) throw new Error("Cannot mark delivery observed: event ID reconciliation is incomplete");
    this.replace(snapshot, "injected");
    for (const id of matches) this.options.mailbox.setState(id, "observed", "Matching event ID observed in parent session", deliveryId);
    for (const id of matches) this.pending.delete(id);
  }

  /** Viewing is intentionally not consumption; callers must prove a model-facing matching revision read. */
  consume(eventId: string, taskId: string, revision: number, successfulModelRead: boolean): void {
    const event = this.options.mailbox.get(eventId);
    if (!event || event.taskId !== taskId || event.revision !== revision) throw new Error("Stale or mismatched result consumption");
    if (!successfulModelRead) throw new Error("Only a successful model-facing result read can consume a notification");
    this.options.mailbox.setState(eventId, "consumed", "Matching revision read by model");
    this.pending.delete(eventId);
  }

  private restore(): void {
    const path = this.options.journalPath;
    if (existsSync(path)) for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
      if (!line) continue;
      let record: DeliveryRecord;
      try { record = JSON.parse(line) as DeliveryRecord; } catch { throw new Error(`Corrupt delivery journal at ${path}:${index + 1}`); }
      if (record.version !== 1 || record.type !== "delivery" || !record.snapshot?.id || !Array.isArray(record.snapshot.eventIds)) throw new Error(`Invalid delivery record at ${path}:${index + 1}`);
      this.deliveries.set(record.snapshot.id, record.snapshot);
    }
    const snapByEvent = new Map<string, DeliverySnapshot>();
    for (const snapshot of this.deliveries.values()) for (const id of snapshot.eventIds) snapByEvent.set(id, snapshot);
    for (const event of this.options.mailbox.list({ recipientId: this.options.recipientId })) {
      const state = this.options.mailbox.state(event.id).state;
      const snapshot = snapByEvent.get(event.id);
      // Snapshot persisted before dispatch but no terminal state means process
      // death could have occurred during send. Reconcile; never auto-replay.
      if (state === "pending" && snapshot?.state === "pending") {
        this.options.mailbox.setState(event.id, "unknown", "Recovered in-flight delivery; reconcile before retry", snapshot.id);
        snapshot.state = "unknown";
        snapshot.detail = "Recovered in-flight delivery; reconcile before retry";
        this.persist(snapshot);
      } else if (state === "pending") this.pending.add(event.id);
      else if (state === "unknown") this.holdReasons.add("delivery-unknown");
    }
  }
  private replace(previous: DeliverySnapshot, state: DeliverySnapshot["state"], detail?: string): void {
    const next = { ...previous, state, ...(detail ? { detail } : {}) };
    this.persist(next); this.deliveries.set(previous.id, next);
  }
  private persist(snapshot: DeliverySnapshot): void {
    mkdirSync(dirname(this.options.journalPath), { recursive: true, mode: 0o700 });
    const record: DeliveryRecord = { version: 1, type: "delivery", snapshot, at: new Date().toISOString() };
    const fd = openSync(this.options.journalPath, "a", 0o600);
    try { appendFileSync(fd, `${JSON.stringify(record)}\n`, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
  }
}
