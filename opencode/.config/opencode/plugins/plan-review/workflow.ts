import type { OpenCodeClient, SessionInfo, SessionMessageInfo, ModelRef } from "@opencode/client"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export const READY = "<!-- opencode-plan-ready -->"
type Review = {
  sessionID: string
  messageID: string
  boundary: string
  path: string
  text: string
  hash: string
  formID: string
  status: "pending" | "cancelled" | "stale" | "applying" | "sent" | "uncertain"
}
export type ReviewState = { reviews: Record<string, Review> }
type Dependencies = {
  client: OpenCodeClient
  state: ReviewState
  update: (mutation: (state: ReviewState) => void) => Promise<void>
  idle: (sessionID: string) => boolean
  notify: (message: string) => void
  directory?: string
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const actionable = (messages: readonly SessionMessageInfo[]) => messages.filter((m) =>
  ["user", "assistant", "synthetic", "shell", "location-switched", "compaction"].includes(m.type))
const boundary = (messages: readonly SessionMessageInfo[]) => actionable(messages).at(-1)?.id ?? ""

export function candidate(messages: readonly SessionMessageInfo[]) {
  const last = messages.at(-1)
  if (last?.type !== "idle" || last.outcome !== "succeeded") return
  const message = actionable(messages).at(-1)
  if (message?.type !== "assistant" || message.agent !== "plan" || message.error
    || !message.time.completed || message.finish !== "stop") return
  const raw = message.content.filter((p) => p.type === "text").map((p) => p.text).join("\n\n").trim()
  if (!raw.endsWith(READY)) return
  const text = raw.slice(0, -READY.length).trim()
  if (!/^\s*- \[ \] \S/m.test(text) || !/^#{1,3} .*\b(test|verif|validation|acceptance)/im.test(text)) return
  return { messageID: message.id, boundary: boundary(messages), text }
}

export function createReviewController(deps: Dependencies) {
  const { client, state } = deps
  const directory = deps.directory ?? join(homedir(), ".opencode", "plan", "review")
  const seen = new Map<string, number>()
  let stopped = false
  let lastError = ""
  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (!stopped && message !== lastError) deps.notify(message)
    lastError = message
  }
  const same = (a: Review | undefined, b: Review | undefined) =>
    a?.messageID === b?.messageID && a?.formID === b?.formID && a?.status === b?.status
  const current = (review: Review) => same(state.reviews[review.sessionID], review)
  const save = async (review: Review, expected: Review | undefined, terminal = false) => {
    if (stopped && !terminal) return false
    let changed = false
    await deps.update((draft) => {
      if (!same(draft.reviews[review.sessionID], expected)) return
      draft.reviews[review.sessionID] = { ...review }
      changed = true
    })
    return changed
  }
  const active = () => { if (stopped) throw new Error("Plugin unloaded during handoff; no further actions will be started") }
  const fresh = async (review: Review) => {
    if (stopped || !deps.idle(review.sessionID)) return false
    const session = await client.session.get({ sessionID: review.sessionID })
    if (session.agent !== "plan" || session.outcome !== "succeeded") return false
    const pending = await client.session.inbox.list({ sessionID: review.sessionID })
    if (pending.length) return false
    const messages = await client.session.context({ sessionID: review.sessionID })
    return boundary(messages) === review.boundary && candidate(messages)?.text === review.text
  }
  const createForm = async (review: Review) => {
    if (stopped) return
    // A deterministic ID deduplicates creation across clients and reloads.
    try {
      await client.session.form.get({ sessionID: review.sessionID, formID: review.formID })
      return
    } catch (error) {
      if (!error || typeof error !== "object" || !("_tag" in error) || error._tag !== "FormNotFoundError") throw error
    }
    const payload = {
      sessionID: review.sessionID,
      id: review.formID,
      title: "Review saved implementation plan",
      metadata: { plugin: "raaghav.plan-review", path: review.path, revision: review.messageID, hash: review.hash },
      fields: [{
        key: "decision", type: "string", required: true, custom: false,
        title: "Approve this plan or request changes?",
        description: `Saved: ${review.path}\nFull plan is in the conversation above; choose below.`,
        options: [
          { value: "approve", label: "Approve and build", description: "Switch to Build and its configured model; implement this revision" },
          { value: "revise", label: "Request changes", description: "Stay in Plan and send feedback" },
        ],
      }, {
        key: "feedback", type: "string", required: true, minLength: 1,
        title: "What should change?", when: [{ key: "decision", op: "eq", value: "revise" }],
      }],
    } as const
    try {
      if (stopped || !current(review)) return
      await client.session.form.create(payload)
    } catch (error) {
      if (!error || typeof error !== "object" || !("_tag" in error) || error._tag !== "ConflictError") throw error
      const existing = await client.session.form.get({ sessionID: review.sessionID, formID: review.formID })
      if (existing.metadata?.plugin !== "raaghav.plan-review" || existing.metadata.hash !== review.hash
        || existing.metadata.revision !== review.messageID) throw new Error("Conflicting native form does not match this plan revision")
    }
  }
  const invalidate = async (review: Review) => {
    try {
      const form = await client.session.form.get({ sessionID: review.sessionID, formID: review.formID })
      if (form.state.status === "pending") await client.session.form.cancel({ sessionID: review.sessionID, formID: review.formID })
    } catch (error) {
      if (!error || typeof error !== "object" || !("_tag" in error) || error._tag !== "FormNotFoundError") throw error
    }
    await save({ ...review, status: "stale" }, review)
  }
  const discover = async (sessionID: string) => {
    if (stopped || !deps.idle(sessionID)) return
    try {
      const session = await client.session.get({ sessionID })
      if (session.parentID || session.agent !== "plan" || session.outcome !== "succeeded") return
      const stored = state.reviews[sessionID]
      const previous = stored ? { ...stored } : undefined
      const plan = candidate(await client.session.context({ sessionID }))
      if (!plan) { seen.set(sessionID, session.time.updated); return }
      if (previous?.messageID === plan.messageID) { seen.set(sessionID, session.time.updated); return }
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const digest = hash(plan.text)
      const revision = hash(`${sessionID}:${plan.messageID}`).slice(0, 32)
      const path = join(directory, `${revision}.md`)
      try {
        await writeFile(path, `${plan.text}\n`, { flag: "wx", mode: 0o600 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        if (await readFile(path, "utf8") !== `${plan.text}\n`) throw new Error("Saved plan revision was modified; refusing to overwrite it")
      }
      const review: Review = { ...plan, sessionID, path, hash: digest, formID: `frm_plan_${revision}`, status: "pending" }
      if (!await fresh(review)) return
      if (!await save(review, previous)) return
      // Only retire the old form after the fresh candidate has committed successfully.
      // invalidate's conditional state write cannot replace the newly committed revision.
      if (previous?.status === "pending") await invalidate(previous)
      await createForm(review)
      seen.set(sessionID, session.time.updated)
    } catch (error) { report(error) }
  }
  const apply = async (review: Review, answer: Record<string, unknown>) => {
    if (!current(review)) return
    if (!await fresh(review)) { await invalidate(review); return }
    const decision = answer.decision
    const feedback = typeof answer.feedback === "string" ? answer.feedback.trim() : ""
    if (decision !== "approve" && decision !== "revise") throw new Error("Invalid plan review decision")
    if (decision === "revise" && !feedback) throw new Error("Please provide nonempty feedback; reopen plan review")
    if (await readFile(review.path, "utf8") !== `${review.text}\n`) throw new Error("Saved plan differs from the reviewed revision; approval blocked")
    const agentID = decision === "approve" ? "build" : "plan"
    const session = await client.session.get({ sessionID: review.sessionID })
    const { data: agent } = await client.agent.get({ agentID, location: session.location })
    const model: ModelRef | undefined = agent.model
    if (!model) throw new Error(`Configure agents.${agentID}.model before continuing`)
    const { data: available } = await client.model.list({ location: session.location })
    const selected = available.find((m) => m.id === model.id && m.providerID === model.providerID && m.enabled)
    if (!selected || (model.variant && !selected.variants.some((v) => v.id === model.variant))) {
      throw new Error(`Configured ${agentID} model/variant is unavailable`)
    }
    if (!await fresh(review)) { await invalidate(review); return }
    if (stopped || !current(review)) return
    const applying: Review = { ...review, status: "applying" }
    if (!await save(applying, review)) return
    // Cross-process claim: only one TUI may perform the state-changing handoff.
    const claimPath = `${review.path}.claim`
    try { await writeFile(claimPath, "handoff", { flag: "wx", mode: 0o600 }) }
    catch (error) {
      await save({ ...review, status: "uncertain" }, applying, true)
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("An existing handoff claim makes this approval uncertain. Inspect session history and request a new plan; implementation was not replayed.")
      }
      throw error
    }
    let admitted = false
    try {
      active()
      await client.session.switchAgent({ sessionID: review.sessionID, agent: agentID })
      active()
      await client.session.switchModel({ sessionID: review.sessionID, model })
      active()
      const messages = await client.session.context({ sessionID: review.sessionID })
      active()
      if (boundary(messages) !== review.boundary || !deps.idle(review.sessionID)) {
        throw new Error("Session changed during handoff; implementation was not started")
      }
      const text = decision === "approve"
        ? `Implement the approved plan below in TODO order. Run its verification steps and report results. The saved revision is ${review.path}; the exact approved contents follow (do not substitute another revision).\n\n${review.text}`
        : `Revise this complete plan using the feedback. Preserve clear ordered checkbox TODOs and verification criteria. Return the entire updated Markdown plan, ending with ${READY}.\n\nFeedback:\n${feedback}\n\nCurrent plan:\n${review.text}`
      active()
      await client.session.prompt({ sessionID: review.sessionID, id: `msg_plan_${review.hash.slice(0, 24)}_${review.messageID.replace(/[^a-zA-Z0-9]/g, "")}`, text, delivery: "queue" })
      admitted = true
      await save({ ...review, status: "sent" }, applying, true)
    } catch (error) {
      // Never silently replay a potentially admitted implementation prompt after a transport failure.
      await save({ ...review, status: admitted ? "sent" : "uncertain" }, applying, true)
      throw error
    }
  }
  const reconcile = async () => {
    for (const stored of Object.values(state.reviews)) {
      if (stopped) break
      const review = { ...stored }
      if (review.status !== "pending") continue
      try {
        if (!deps.idle(review.sessionID)) continue
        if (!await fresh(review)) { await invalidate(review); continue }
        await createForm(review)
        const form = await client.session.form.get({ sessionID: review.sessionID, formID: review.formID })
        if (form.state.status === "cancelled") await save({ ...review, status: "cancelled" }, review)
        if (form.state.status === "answered") await apply(review, form.state.answer)
      } catch (error) {
        // Validation failures are recoverable via the palette without retry loops.
        if (current(review)) await save({ ...review, status: "cancelled" }, review)
        report(error)
      }
    }
  }
  const reopen = async (sessionID: string) => {
    const value = state.reviews[sessionID]
    const stored = value ? { ...value } : undefined
    if (!stored) { await discover(sessionID); return }
    if (stored.status === "uncertain" || stored.status === "applying") {
      throw new Error("Handoff state is uncertain. Inspect session history before retrying; no automatic implementation replay was performed.")
    }
    if (!await fresh(stored)) throw new Error("This saved plan is no longer current; prepare a new plan in Plan mode")
    if (stored.status === "pending") { await createForm(stored); return }
    const review = { ...stored, formID: `frm_plan_${hash(stored.formID + Date.now()).slice(0, 32)}`, status: "pending" as const }
    // A completed handoff cannot reach this path because the active agent/context no longer match.
    if (!await save(review, stored)) return
    await createForm(review)
  }
  return {
    discover, reconcile, reopen, report,
    needsDiscovery: (s: SessionInfo) => deps.idle(s.id) && seen.get(s.id) !== s.time.updated,
    dispose: () => { stopped = true },
  }
}
