// Durable typed mailbox and parent-delivery fixtures; no model/provider requests.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jiti } from "./pi-runtime.mjs";
const dir = fileURLToPath(new URL("../.pi/agent/extensions/agents-hub/", import.meta.url));
const { DurableMailbox } = await jiti.import(join(dir, "mailbox.ts"));
const { ParentDelivery } = await jiti.import(join(dir, "delivery.ts"));
const { ResultStore } = await jiti.import(join(dir, "results.ts"));
const root = mkdtempSync(join(tmpdir(), "pi-hub-mailbox-"));
const mailboxPath = join(root, "private", "mailbox.jsonl");
const deliveryPath = join(root, "private", "delivery.jsonl");
const eventInput = (overrides = {}) => ({ rootSessionId: "session-root", rootGeneration: 4, recipientId: "parent", sourceAgentId: "child", parentId: "parent", kind: "completed", taskId: "task-7", revision: 3, text: "Completed with provenance", provenance: { actor: "agent", label: "child tool result" }, ...overrides });
try {
  const mailbox = new DurableMailbox(mailboxPath);
  const first = mailbox.create(eventInput({ id: "event-1" }));
  const failed = mailbox.create(eventInput({ id: "event-fail", kind: "failed", revision: 4 }));
  const question = mailbox.create(eventInput({ id: "event-question", kind: "needs_input", requestId: "req-9" }));
  const progress = mailbox.create(eventInput({ id: "event-progress", kind: "progress" }));
  assert.equal(mailbox.state(first.id).state, "pending");
  assert.equal(mailbox.list({ recipientId: "parent" }).length, 3, "progress is filtered from normal pending notification listings");
  assert.equal(mailbox.list({ includeProgress: true }).length, 4);
  assert.throws(() => mailbox.create(eventInput({ id: "event-1" })), /Duplicate/);
  assert.throws(() => mailbox.create(eventInput({ kind: "invented" })), /Invalid typed/);
  assert.equal(readFileSync(mailboxPath, "utf8").includes("event-question"), true);

  // Busy parents receive a single full-provenance batch only at a safe boundary.
  let busy = true; const sent = [];
  const delivery = new ParentDelivery({ mailbox, journalPath: deliveryPath, recipientId: "parent", isBusy: () => busy,
    send: async notice => { sent.push(notice); } });
  delivery.enqueue(first); delivery.enqueue(failed); delivery.enqueue(question); delivery.enqueue(progress);
  await delivery.onSafeBoundary(undefined, false);
  assert.equal(sent.length, 0, "unverified busy state cannot dispatch");
  await delivery.onSafeBoundary("turn_end", true);
  assert.equal(sent.length, 1, "verified turn boundary flushes even before parent idle state updates");
  assert.equal(sent[0].events.length, 3);
  assert.match(sent[0].content, /event=event-1/);
  assert.match(sent[0].content, /provenance=child tool result/);
  assert.equal(mailbox.state(first.id).state, "injected");
  assert.equal(delivery.pendingEvents().length, 0);
  delivery.dispose();

  // UI observation doesn't consume. Only matching successful model-facing reads do.
  const reopened = new DurableMailbox(mailboxPath);
  const viewOnly = reopened.get(first.id);
  assert.ok(viewOnly);
  assert.equal(reopened.state(first.id).state, "injected");
  const recovered = new ParentDelivery({ mailbox: reopened, journalPath: deliveryPath, recipientId: "parent", isBusy: () => false, send: () => { throw new Error("not sent"); } });
  assert.throws(() => recovered.consume(first.id, "wrong-task", first.revision, true), /Stale/);
  assert.throws(() => recovered.consume(first.id, first.taskId, first.revision, false), /successful model-facing/);
  recovered.consume(first.id, first.taskId, first.revision, true);
  assert.equal(reopened.state(first.id).state, "consumed");
  assert.throws(() => reopened.setState(first.id, "pending"), /terminal/);
  recovered.dispose();

  const resultPath = join(root, "results.jsonl");
  const resultStore = new ResultStore(resultPath);
  const result = resultStore.put({ agentId: "child", taskId: "task-7", revision: 4, status: "completed", preview: "stable result", artifact: "full immutable result" });
  assert.equal(resultStore.get("child", "task-7", 4).artifact, "full immutable result");
  assert.equal(new ResultStore(resultPath).find("child", result.id).preview, "stable result");
  assert.notEqual(resultStore.put({ agentId: "child", taskId: "task-7", revision: 5, status: "completed", preview: "later", artifact: "later full result" }).id, result.id);

  // Idle timer coalesces; explicit holds suppress dispatch and remain inspectable.
  const held = reopened.create(eventInput({ id: "event-held", revision: 5 }));
  const idleSent = [];
  const idle = new ParentDelivery({ mailbox: reopened, journalPath: join(root, "idle.jsonl"), recipientId: "parent", isBusy: () => false, coalesceMs: 0, send: async n => idleSent.push(n) });
  idle.hold("user-interrupt"); idle.enqueue(held); idle.onIdle();
  assert.deepEqual(idle.holds(), ["user-interrupt"]);
  assert.equal(idleSent.length, 0);
  idle.resume("user-interrupt");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(idleSent.length, 1);
  idle.dispose();

  const passiveEvent = reopened.create(eventInput({ id: "passive-drain", revision: 12 }));
  let automaticCalls = 0, explicitCalls = 0;
  const passive = new ParentDelivery({ mailbox: reopened, journalPath: join(root, "passive.jsonl"), recipientId: "parent", isBusy: () => false,
    wakeupsEnabled: false, preflight: automatic => { if (automatic) automaticCalls++; },
    send: async (_notice, automatic) => { if (automatic) automaticCalls++; else explicitCalls++; } });
  passive.hold("wakeup-budget-exhausted"); passive.enqueue(passiveEvent);
  assert.equal(await passive.drain() instanceof Object, true, "explicit drain may bypass only the automatic-call budget hold");
  assert.equal(automaticCalls, 0, "explicit drain neither spends nor resets automatic allowance");
  assert.equal(explicitCalls, 1);
  assert.ok(passive.holds().includes("wakeup-budget-exhausted"), "manual drain leaves automatic allowance state intact");
  passive.dispose();

  // Failure after snapshot persistence is unknown and retained; restart never blindly retries it.
  const uncertain = reopened.create(eventInput({ id: "event-uncertain", revision: 6 }));
  const bad = new ParentDelivery({ mailbox: reopened, journalPath: join(root, "uncertain.jsonl"), recipientId: "parent", isBusy: () => false, send: () => { throw new Error("stale parent context"); } });
  bad.enqueue(uncertain);
  await assert.rejects(bad.drain(), /outcome unknown/);
  assert.equal(reopened.state(uncertain.id).state, "unknown");
  const unknownRestore = new ParentDelivery({ mailbox: new DurableMailbox(mailboxPath), journalPath: join(root, "uncertain.jsonl"), recipientId: "parent", isBusy: () => false, send: () => { throw new Error("must not auto-retry"); } });
  assert.equal(unknownRestore.pendingEvents().length, 0);
  const snap = unknownRestore.snapshots().find(s => s.eventIds.includes(uncertain.id));
  assert.equal(snap.state, "unknown");
  unknownRestore.reconcile(snap.id, [uncertain.id], "observed");
  assert.equal(new DurableMailbox(mailboxPath).state(uncertain.id).state, "observed");
  bad.dispose(); unknownRestore.dispose();

  // Concurrent boundary/timer triggers share one in-flight dispatch; unknowns are not queued for implicit retry.
  const raceMailbox = new DurableMailbox(join(root, "race-mailbox.jsonl"));
  const raceEvent = raceMailbox.create(eventInput({ id: "event-race", revision: 7 }));
  let release; let raceCalls = 0;
  const race = new ParentDelivery({ mailbox: raceMailbox, journalPath: join(root, "race.jsonl"), recipientId: "parent", isBusy: () => true,
    send: async () => { raceCalls++; await new Promise(resolve => { release = resolve; }); } });
  race.enqueue(raceEvent);
  race.resume("delivery-unknown"); // test explicitly releases the earlier reconciliation hold
  const a = race.onSafeBoundary("turn_end", true);
  const b = race.onSafeBoundary("turn_end", true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(raceCalls, 1, "only one dispatch may be in flight");
  release(); await Promise.all([a, b]);
  assert.equal(raceMailbox.state(raceEvent.id).state, "injected");
  race.dispose();

  // Crash after snapshot and dispatch marker but before acknowledgement restores as unknown, not pending.
  const crashMailbox = new DurableMailbox(join(root, "crash-mailbox.jsonl"));
  const crashEvent = crashMailbox.create(eventInput({ id: "event-crash", revision: 8 }));
  const crashPath = join(root, "crash.jsonl");
  const crash = new ParentDelivery({ mailbox: crashMailbox, journalPath: crashPath, recipientId: "parent", isBusy: () => false,
    send: async () => { throw new Error("simulate process death after send began"); } });
  crash.enqueue(crashEvent);
  await assert.rejects(crash.drain(), /outcome unknown/);
  const afterCrash = new ParentDelivery({ mailbox: new DurableMailbox(join(root, "crash-mailbox.jsonl")), journalPath: crashPath, recipientId: "parent", isBusy: () => false, send: () => { throw new Error("must reconcile"); } });
  assert.equal(afterCrash.pendingEvents().some(e => e.id === crashEvent.id), false);
  assert.ok(afterCrash.holds().includes("delivery-unknown"));
  crash.dispose(); afterCrash.dispose();

  // Bounded batches leave overflow scheduled; timer failures become visible holds without unhandled rejection.
  const overflowMailbox = new DurableMailbox(join(root, "overflow-mailbox.jsonl"));
  const overflowA = overflowMailbox.create(eventInput({ id: "overflow-a", revision: 9 }));
  const overflowB = overflowMailbox.create(eventInput({ id: "overflow-b", revision: 10 }));
  const overflowSent = [];
  const overflow = new ParentDelivery({ mailbox: overflowMailbox, journalPath: join(root, "overflow.jsonl"), recipientId: "parent", isBusy: () => false,
    maxEventsPerDelivery: 1, coalesceMs: 0, send: async n => overflowSent.push(n) });
  overflow.enqueue(overflowA); overflow.enqueue(overflowB);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(overflowSent.length, 2, "overflow is drained in bounded batches");
  overflow.dispose();
  const oversizedMailbox = new DurableMailbox(join(root, "oversized-mailbox.jsonl"));
  const oversized = oversizedMailbox.create(eventInput({ id: "oversized", text: "x".repeat(5000) }));
  const oversizedDelivery = new ParentDelivery({ mailbox: oversizedMailbox, journalPath: join(root, "oversized.jsonl"), recipientId: "parent", isBusy: () => false, maxContentChars: 256, coalesceMs: 0, send: () => { throw new Error("must not send oversized event"); } });
  oversizedDelivery.enqueue(oversized); await oversizedDelivery.drain();
  assert.equal(oversizedMailbox.state(oversized.id).state, "failed", "oversized deliveries are held visibly and do not spin timers");
  assert.ok(oversizedDelivery.holds().includes("oversized-event"));
  oversizedDelivery.dispose();
  const timerFailureMailbox = new DurableMailbox(join(root, "timer-failure-mailbox.jsonl"));
  const timerFailureEvent = timerFailureMailbox.create(eventInput({ id: "timer-fail", revision: 11 }));
  const timerFailure = new ParentDelivery({ mailbox: timerFailureMailbox, journalPath: join(root, "timer-failure.jsonl"), recipientId: "parent", isBusy: () => false,
    coalesceMs: 0, send: () => { throw new Error("timer send failed"); } });
  timerFailure.enqueue(timerFailureEvent);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(timerFailure.holds().includes("delivery-error"));
  assert.equal(timerFailureMailbox.state(timerFailureEvent.id).state, "unknown");
  timerFailure.dispose();

  // Disk errors are not converted into successful durable acknowledgements.
  const notDirectory = join(root, "file"); writeFileSync(notDirectory, "not a dir");
  const broken = new DurableMailbox(join(notDirectory, "mail.jsonl"));
  assert.throws(() => broken.create(eventInput({ id: "disk-fail" })), /EEXIST|ENOTDIR/);
  writeFileSync(join(root, "corrupt.jsonl"), "{bad json\n");
  assert.throws(() => new DurableMailbox(join(root, "corrupt.jsonl")), /Corrupt mailbox/);
  console.log("Agents Hub mailbox/delivery tests passed (typed durable snapshots, provenance, safe batching, holds, revision consumption, unknown reconciliation, storage errors)");
} finally { rmSync(root, { recursive: true, force: true }); }
