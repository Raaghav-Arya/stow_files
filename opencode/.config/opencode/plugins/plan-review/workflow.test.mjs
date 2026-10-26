import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { candidate, createReviewController, READY } from "./workflow.ts"

const plan = "# Goal\nMake the change safely.\n\n## TODOs\n- [ ] Update the implementation.\n- [ ] Add regression tests.\n\n## Verification\nRun the tests and check the acceptance criteria."
function messages(text = `${plan}\n${READY}`) {
  return [{ id: "msg_user", type: "user", text: "Make a plan", time: { created: 1 } }, {
    id: "msg_plan", type: "assistant", agent: "plan", time: { created: 2, completed: 3 },
    finish: "stop", content: [{ type: "text", text }],
  }, { id: "msg_idle", type: "idle", outcome: "succeeded", time: { created: 4 } }]
}
async function fixture(t) {
  const directory = await mkdtemp("/tmp/opencode/plan-review-test-")
  t.after(() => rm(directory, { recursive: true, force: true }))
  const state = { reviews: {} }
  const session = { id: "ses_test", agent: "plan", outcome: "succeeded", location: { directory: "/repo" }, time: { updated: 4 } }
  let context = messages()
  let idle = true
  let inbox = []
  const forms = new Map()
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
      form: {
        get: async ({ formID }) => {
          if (!forms.has(formID)) throw { _tag: "FormNotFoundError" }
          return structuredClone(forms.get(formID))
        },
        create: async (form) => {
          if (forms.has(form.id)) throw new Error("Duplicate form")
          assert.equal(form.fields[0].type, "string")
          forms.set(form.id, { ...structuredClone(form), state: { status: "pending" } })
          calls.push(["form", form.id])
          return form
        },
        cancel: async ({ formID }) => { forms.get(formID).state = { status: "cancelled" } },
      },
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
  const deps = { directory, state, client, update: async (fn) => fn(state), idle: () => idle, notify: (m) => notices.push(m) }
  const controller = createReviewController(deps)
  t.after(() => controller.dispose())
  const answer = (decision = "approve", feedback) => {
    forms.get(state.reviews.ses_test.formID).state = { status: "answered", answer: { decision, feedback } }
  }
  return { controller, client, deps, state, session, forms, models, calls, notices, directory, answer,
    setContext: (value) => { context = value }, setIdle: (value) => { idle = value }, setInbox: (value) => { inbox = value } }
}

test("only explicit, complete successful plans qualify", () => {
  assert.equal(candidate(messages()).text, plan)
  for (const text of ["Clarifying question?", plan, `${READY}`, `# Plan\n- [ ] TODO\n${READY}`]) {
    assert.equal(candidate(messages(text)), undefined)
  }
  for (const mutate of [
    (m) => { m.at(-1).outcome = "interrupted" },
    (m) => { m[1].error = { message: "failure" } },
    (m) => { m[1].agent = "build" },
    (m) => { m[1].finish = "length" },
    (m) => { delete m[1].time.completed },
    (m) => { m.push({ id: "msg_new", type: "user" }) },
  ]) { const m = messages(); mutate(m); assert.equal(candidate(m), undefined) }
})

test("saves exact private immutable revision and displays full text in native form", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  const review = f.state.reviews.ses_test
  assert.equal(await readFile(review.path, "utf8"), `${plan}\n`)
  const form = f.forms.get(review.formID)
  assert.ok(form.fields[0].description.includes("Full plan is in the conversation above"))
  assert.ok(form.fields[0].description.includes(review.path))
  assert.deepEqual(form.fields[0].options.map(({ label }) => label), ["Approve and build", "Request changes"])
  assert.ok(form.fields[0].description.length < 140)
  assert.equal(form.fields[1].when[0].value, "revise")
  await f.controller.discover("ses_test")
  assert.equal(f.forms.size, 1)
})

test("approval explicitly switches agent then freshly resolved model then submits V2 text", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.models.build = { id: "new-luna", providerID: "custom", variant: "low" }
  f.answer()
  await f.controller.reconcile()
  const actions = f.calls.filter(([name]) => name !== "form")
  assert.deepEqual(actions.map(([name]) => name), ["agent", "model", "prompt"])
  assert.deepEqual(actions[1][1], f.models.build)
  const prompt = actions[2][1]
  assert.ok(prompt.text.includes(plan))
  assert.match(prompt.id, /^msg_/)
  assert.equal(prompt.parts, undefined)
  assert.equal(f.state.reviews.ses_test.status, "sent")
  await f.controller.reconcile()
  assert.equal(f.calls.filter(([name]) => name === "prompt").length, 1)
})

test("revision requires feedback and keeps Plan with its configured model", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.answer("revise", "Add rollback details")
  await f.controller.reconcile()
  assert.deepEqual(f.calls.find(([name]) => name === "agent"), ["agent", "plan"])
  assert.ok(f.calls.find(([name]) => name === "prompt")[1].text.includes("Add rollback details"))
})

test("blank revision feedback fails closed and can be reopened", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.answer("revise", "  ")
  await f.controller.reconcile()
  assert.equal(f.state.reviews.ses_test.status, "cancelled")
  assert.equal(f.calls.filter(([name]) => name === "prompt").length, 0)
  await f.controller.reopen("ses_test")
  assert.equal(f.forms.size, 2)
})

test("cancelled native form never implements and can be reopened without a new Plan turn", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.forms.get(f.state.reviews.ses_test.formID).state = { status: "cancelled" }
  await f.controller.reconcile()
  assert.equal(f.state.reviews.ses_test.status, "cancelled")
  await f.controller.reopen("ses_test")
  assert.equal(f.state.reviews.ses_test.status, "pending")
  assert.equal(f.calls.filter(([name]) => name === "prompt").length, 0)
})

test("new user input invalidates answered plan instead of launching stale work", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.answer()
  f.setContext([...messages(), { id: "msg_changed", type: "user", text: "Stop" }])
  await f.controller.reconcile()
  assert.equal(f.state.reviews.ses_test.status, "stale")
  assert.equal(f.calls.filter(([name]) => name === "agent").length, 0)
})

test("queued prompts invalidate review", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.answer()
  f.setInbox([{ id: "queued" }])
  await f.controller.reconcile()
  assert.equal(f.calls.filter(([name]) => name === "prompt").length, 0)
})

test("modified saved plan blocks approval", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  await writeFile(f.state.reviews.ses_test.path, "unapproved content")
  f.answer()
  await f.controller.reconcile()
  assert.equal(f.state.reviews.ses_test.status, "cancelled")
  assert.equal(f.calls.filter(([name]) => name === "agent").length, 0)
})

test("unavailable model fails before switching agents", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.client.model.list = async () => ({ data: [] })
  f.answer()
  await f.controller.reconcile()
  assert.equal(f.calls.filter(([name]) => name === "agent").length, 0)
  assert.match(f.notices[0], /unavailable/)
})

test("reload resumes answered form once; two controllers cannot duplicate handoff", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.answer()
  const other = createReviewController(f.deps)
  t.after(() => other.dispose())
  await Promise.all([other.reconcile(), f.controller.reconcile()])
  assert.equal(f.calls.filter(([name]) => name === "prompt").length, 1)
})

test("transport failure at handoff is uncertain and never automatically replayed", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.client.session.prompt = async () => { throw new Error("Connection lost after admission") }
  f.answer()
  await f.controller.reconcile()
  assert.equal(f.state.reviews.ses_test.status, "uncertain")
  await f.controller.reconcile()
  await assert.rejects(f.controller.reopen("ses_test"), /uncertain/)
})

test("write failures remain retryable instead of marking plan discovered", async (t) => {
  const f = await fixture(t)
  const blocked = join(f.directory, "not-a-directory")
  await writeFile(blocked, "blocked")
  const controller = createReviewController({ ...f.deps, directory: blocked })
  t.after(() => controller.dispose())
  await controller.discover("ses_test")
  assert.equal(f.state.reviews.ses_test, undefined)
  assert.equal(controller.needsDiscovery(f.session), true)
})

test("new revisions preserve old files and cancel old pending forms", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  const old = { ...f.state.reviews.ses_test }
  const updated = messages(`${plan}\nExtra detail\n${READY}`)
  updated[1].id = "msg_revision"
  f.setContext(updated)
  await f.controller.discover("ses_test")
  assert.notEqual(f.state.reviews.ses_test.path, old.path)
  assert.equal(await readFile(old.path, "utf8"), `${plan}\n`)
  assert.equal(f.forms.get(old.formID).state.status, "cancelled")
})

test("disposal suppresses further work and notifications", async (t) => {
  const f = await fixture(t)
  f.controller.dispose()
  await f.controller.discover("ses_test")
  f.controller.report(new Error("after disposal"))
  assert.equal(f.calls.length, 0)
  assert.equal(f.notices.length, 0)
})

test("obsolete reconciliation cannot replace a newer saved revision", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  let release
  let entered
  const paused = new Promise((r) => { entered = r })
  const original = f.client.session.context
  let first = true
  f.client.session.context = async (...args) => {
    if (first) {
      first = false
      entered()
      await new Promise((r) => { release = r })
    }
    return original(...args)
  }
  const oldRun = f.controller.reconcile()
  await paused
  const newMessages = messages(`${plan}\nNew revision details\n${READY}`)
  newMessages[1].id = "msg_new_revision"
  f.setContext(newMessages)
  const other = createReviewController(f.deps)
  t.after(() => other.dispose())
  await other.discover("ses_test")
  release()
  await oldRun
  assert.equal(f.state.reviews.ses_test.messageID, "msg_new_revision")
  assert.equal(f.state.reviews.ses_test.status, "pending")
})

test("unloading during agent switch blocks subsequent model switch and admission", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.answer()
  const original = f.client.session.switchAgent
  f.client.session.switchAgent = async (input) => {
    await original(input)
    f.controller.dispose()
  }
  await f.controller.reconcile()
  assert.deepEqual(f.calls.filter(([name]) => name !== "form").map(([name]) => name), ["agent"])
  assert.equal(f.state.reviews.ses_test.status, "uncertain")
})

test("unloading during model switch blocks admission", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.answer()
  const original = f.client.session.switchModel
  f.client.session.switchModel = async (input) => {
    await original(input)
    f.controller.dispose()
  }
  await f.controller.reconcile()
  assert.equal(f.calls.filter(([name]) => name === "prompt").length, 0)
  assert.equal(f.state.reviews.ses_test.status, "uncertain")
})

test("unloading after prompt admission still records sent without replay", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  f.answer()
  const original = f.client.session.prompt
  f.client.session.prompt = async (input) => {
    await original(input)
    f.controller.dispose()
  }
  await f.controller.reconcile()
  assert.equal(f.state.reviews.ses_test.status, "sent")
})

test("reopening pending review reuses its native form", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  const formID = f.state.reviews.ses_test.formID
  await f.controller.reopen("ses_test")
  await f.controller.reopen("ses_test")
  assert.equal(f.state.reviews.ses_test.formID, formID)
  assert.equal(f.forms.size, 1)
})

test("existing claim surfaces uncertain state instead of silently wedging review", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  await writeFile(`${f.state.reviews.ses_test.path}.claim`, "old claim")
  f.answer()
  await f.controller.reconcile()
  assert.equal(f.state.reviews.ses_test.status, "uncertain")
  assert.match(f.notices[0], /existing handoff claim/)
  assert.equal(f.calls.filter(([name]) => name === "prompt").length, 0)
})

test("concurrent native form creation conflict reuses valid winning form", async (t) => {
  const f = await fixture(t)
  const original = f.client.session.form.create
  f.client.session.form.create = async (input) => {
    await original(input)
    throw { _tag: "ConflictError" }
  }
  await f.controller.discover("ses_test")
  await f.controller.reconcile()
  assert.equal(f.state.reviews.ses_test.status, "pending")
  assert.equal(f.notices.length, 0)
  assert.equal(f.forms.size, 1)
})

test("obsolete discovery cannot cancel a newer committed form", async (t) => {
  const f = await fixture(t)
  await f.controller.discover("ses_test")
  let entered
  let release
  const paused = new Promise((r) => { entered = r })
  const original = f.client.session.context
  let first = true
  f.client.session.context = async (...args) => {
    if (first) {
      first = false
      const oldSnapshot = await original(...args)
      entered()
      await new Promise((r) => { release = r })
      return oldSnapshot
    }
    return original(...args)
  }
  const delayed = f.controller.discover("ses_test")
  await paused
  const updated = messages(`${plan}\nNew candidate\n${READY}`)
  updated[1].id = "msg_new_discovery"
  f.setContext(updated)
  const other = createReviewController(f.deps)
  t.after(() => other.dispose())
  await other.discover("ses_test")
  release()
  await delayed
  assert.equal(f.state.reviews.ses_test.messageID, "msg_new_discovery")
  assert.equal(f.state.reviews.ses_test.status, "pending")
  assert.equal(f.forms.get(f.state.reviews.ses_test.formID).state.status, "pending")
})
