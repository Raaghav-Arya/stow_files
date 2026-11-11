import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { candidate, createReviewController, READY } from "./workflow.ts"
import { loadPlan, savePlan } from "./plan.ts"

const plan = "# Goal\nImplement safely.\n\n## TODOs\n- [ ] Make the change.\n- [ ] Add tests.\n\n## Verification\nRun the test suite."
const receipt = (record) => `Plan saved for review. Revision: ${record.revision}; digest: ${record.digest}\n${READY}`

function messages(record, finalText = receipt(record)) {
  return [
    { id: "msg_user", type: "user", text: "Make a plan", time: { created: 1 } },
    { id: "msg_origin", type: "assistant", agent: "plan", time: { created: 2 }, content: [] },
    { id: "msg_plan", type: "assistant", agent: "plan", time: { created: 3, completed: 4 },
      finish: "stop", content: [{ type: "text", text: finalText }] },
    { id: "msg_idle", type: "idle", outcome: "succeeded", time: { created: 5 } },
  ]
}

async function fixture(t) {
  const directory = await mkdtemp("/tmp/opencode/plan-review-test-")
  t.after(() => rm(directory, { recursive: true, force: true }))
  const record = await savePlan("ses_test", plan, directory, { originMessageID: "msg_origin", userMessageID: "msg_user" })
  const state = { reviews: {} }
  const session = { id: "ses_test", agent: "plan", outcome: "succeeded", location: { directory: "/repo" }, time: { updated: 5 } }
  let context = messages(record)
  let idle = true
  let inbox = []
  const calls = []
  const notices = []
  const models = {
    plan: { id: "sol", providerID: "openai", variant: "medium" },
    build: { id: "luna", providerID: "openai", variant: "high" },
  }
  const client = {
    session: {
      get: async () => structuredClone(session),
      context: async () => structuredClone(context),
      inbox: { list: async () => inbox },
      switchAgent: async ({ agent }) => { calls.push(["agent", agent]); session.agent = agent },
      switchModel: async ({ model }) => { calls.push(["model", structuredClone(model)]); session.model = model },
      prompt: async (input) => { calls.push(["prompt", input]); context.push({ id: input.id, type: "user", text: input.text }) },
    },
    agent: { get: async ({ agentID, location }) => {
      assert.deepEqual(location, session.location)
      return { location, data: { id: agentID, model: models[agentID] } }
    } },
    model: { list: async () => ({ data: Object.values(models).filter(Boolean).map((model) => ({
      ...model, enabled: true, variants: [{ id: model.variant }],
    })) }) },
  }
  const deps = {
    directory, state, client,
    update: async (fn) => fn(state),
    idle: () => idle,
    notify: (message) => notices.push(message),
    getPlan: (sessionID, revision, digest) => loadPlan(sessionID, revision, digest, directory),
  }
  const controller = createReviewController(deps)
  t.after(() => controller.dispose())
  return {
    controller, client, deps, state, session, calls, notices, directory, record,
    setContext: (value) => { context = value }, setIdle: (value) => { idle = value }, setInbox: (value) => { inbox = value },
  }
}

test("only a successful Plan turn with a compact revision receipt qualifies", () => {
  const record = { revision: "a".repeat(32), digest: "b".repeat(64) }
  assert.equal(candidate(messages(record)).revision, record.revision)
  for (const text of [plan, "Clarifying question?", `${READY}`, `Plan saved. Revision: forged; digest: ${record.digest}\n${READY}`]) {
    assert.equal(candidate(messages(record, text)), undefined)
  }
  for (const mutate of [
    (m) => { m.at(-1).outcome = "interrupted" },
    (m) => { m[2].error = { message: "failure" } },
    (m) => { m[2].agent = "build" },
    (m) => { m[2].finish = "length" },
    (m) => { delete m[2].time.completed },
    (m) => { m.push({ id: "new_user", type: "user" }) },
  ]) { const m = messages(record); mutate(m); assert.equal(candidate(m), undefined) }
})

test("submission validates, saves privately, and binds the receipt to session and turn", async (t) => {
  const f = await fixture(t)
  const saved = await loadPlan("ses_test", f.record.revision, f.record.digest, f.directory)
  assert.equal(saved.text, plan)
  assert.equal(await readFile(saved.path, "utf8"), `${plan}\n`)
  assert.equal((await readFile(saved.path)).length < 1000, true)
  await assert.rejects(loadPlan("another-session", f.record.revision, f.record.digest, f.directory), /does not match/)
  await assert.rejects(savePlan("ses_test", "No checklist", f.directory), /unchecked/)
})

test("missing or tampered revision cannot be discovered or approved", async (t) => {
  const f = await fixture(t)
  await writeFile(f.record.path, "tampered\n")
  await f.controller.discover("ses_test")
  assert.equal(f.state.reviews.ses_test, undefined)
  assert.match(f.notices[0], /integrity/)
})

test("malformed saved metadata fails closed", async (t) => {
  const f = await fixture(t)
  const metadata = `${f.directory}/${f.record.revision}.json`
  const original = JSON.parse(await readFile(metadata, "utf8"))
  await writeFile(metadata, JSON.stringify({ ...original, userMessageID: null }))
  await assert.rejects(loadPlan("ses_test", f.record.revision, f.record.digest, f.directory), /metadata is incomplete/)
})

test("forged receipt and wrong originating user turn fail closed", async (t) => {
  const f = await fixture(t)
  f.setContext(messages(f.record, `Plan saved for review. Revision: ${f.record.revision}; digest: ${"0".repeat(64)}\n${READY}`))
  await f.controller.discover("ses_test")
  assert.equal(f.state.reviews.ses_test, undefined)
  f.setContext([
    { id: "other_user", type: "user" }, ...messages(f.record).slice(1),
  ])
  await f.controller.discover("ses_test")
  assert.equal(f.state.reviews.ses_test, undefined)
})

test("approval explicitly switches agent and configured model, then submits the exact saved revision", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  assert.equal(f.state.reviews.ses_test.text, plan)
  await f.controller.decide("ses_test", "approve")
  assert.deepEqual(f.calls.map(([name]) => name), ["agent", "model", "prompt"])
  assert.deepEqual(f.calls[1][1], f.models?.build ?? { id: "luna", providerID: "openai", variant: "high" })
  assert.ok(f.calls[2][1].text.includes(plan))
  assert.equal(f.state.reviews.ses_test.status, "sent")
  await f.controller.reconcile()
  assert.equal(f.calls.filter(([name]) => name === "prompt").length, 1)
})

test("requesting changes requires feedback and leaves implementation unstarted", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  await assert.rejects(f.controller.decide("ses_test", "revise", "  "), /nonempty feedback/)
  assert.equal(f.calls.length, 0)
  await f.controller.decide("ses_test", "revise", "Add rollback details")
  assert.deepEqual(f.calls.map(([name]) => name), ["agent", "model", "prompt"])
  assert.equal(f.calls[0][1], "plan")
  assert.ok(f.calls[2][1].text.includes("Add rollback details"))
})

test("cancel and reopen do not approve", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  await f.controller.cancel("ses_test")
  assert.equal(f.state.reviews.ses_test.status, "cancelled")
  assert.equal(f.calls.length, 0)
  await f.controller.reopen("ses_test")
  assert.equal(f.state.reviews.ses_test.status, "pending")
  assert.equal(f.calls.length, 0)
})

test("a handed-off revision cannot be reopened", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  await f.controller.decide("ses_test", "revise", "Add rollback details")
  assert.equal(f.state.reviews.ses_test.status, "sent")
  await assert.rejects(f.controller.reopen("ses_test"), /no longer reopenable/)
  assert.equal(f.state.reviews.ses_test.status, "sent")
  assert.equal(f.calls.filter(([name]) => name === "prompt").length, 1)
})

test("reopen fails with a clear message when no saved plan exists", async (t) => {
  const f = await fixture(t)
  f.setContext(messages(f.record, "No plan was produced"))
  await assert.rejects(f.controller.reopen("ses_test"), /There is no plan to display/)
  assert.equal(f.state.reviews.ses_test, undefined)
})

test("new input and queued prompts invalidate a pending approval", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.setContext([...messages(f.record), { id: "msg_new", type: "user" }])
  await f.controller.decide("ses_test", "approve")
  assert.equal(f.state.reviews.ses_test.status, "stale")
  assert.equal(f.calls.length, 0)

  const g = await fixture(t)
  await g.controller.discover("ses_test")
  g.setInbox([{ id: "queued" }])
  await g.controller.decide("ses_test", "approve")
  assert.equal(g.calls.length, 0)
})

test("unavailable Build model blocks switching agents", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.client.model.list = async () => ({ data: [] })
  await assert.rejects(f.controller.decide("ses_test", "approve"), /unavailable/)
  assert.equal(f.calls.length, 0)
})

test("handoff transport failure is uncertain and is never replayed", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.client.session.prompt = async () => { throw new Error("Connection lost after admission") }
  await assert.rejects(f.controller.decide("ses_test", "approve"))
  assert.equal(f.state.reviews.ses_test.status, "uncertain")
  await f.controller.reconcile()
  await assert.rejects(f.controller.reopen("ses_test"), /uncertain/)
})

test("duplicate controller handoffs are guarded by an exclusive claim", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  const second = createReviewController(f.deps)
  t.after(() => second.dispose())
  await Promise.all([
    f.controller.decide("ses_test", "approve").catch(() => {}),
    second.decide("ses_test", "approve").catch(() => {}),
  ])
  assert.equal(f.calls.filter(([name]) => name === "prompt").length, 1)
})

test("duplicate decisions in one controller are rejected while validation is pending", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const originalGet = f.client.session.get
  f.client.session.get = async (...args) => { await gate; return originalGet(...args) }
  const first = f.controller.decide("ses_test", "approve")
  await assert.rejects(f.controller.decide("ses_test", "revise", "Change it"), /already in progress/)
  release()
  await first
  assert.equal(f.calls.filter(([name]) => name === "prompt").length, 1)
})

test("saved revisions remain immutable and long plans are returned in full for panel rendering", async (t) => {
  const f = await fixture(t)
  const longPlan = `${plan}\n\n${"A detailed plan paragraph.\n".repeat(400).trimEnd()}`
  const record = await savePlan("ses_test", longPlan, f.directory, { originMessageID: "msg_origin", userMessageID: "msg_user" })
  const loaded = await loadPlan("ses_test", record.revision, record.digest, f.directory)
  assert.equal(loaded.text, longPlan)
  assert.ok(loaded.text.length > 10_000)
})
