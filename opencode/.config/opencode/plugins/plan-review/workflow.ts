import type { OpenCodeClient, SessionInfo, SessionMessageInfo, ModelRef } from "@opencode/client"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { loadPlan, type PlanRecord } from "./plan.ts"

export const READY = "<!-- opencode-plan-ready -->"
type Review = {
  sessionID: string
  messageID: string
  revision: string
  boundary: string
  path: string
  text: string
  hash: string
  status: "pending" | "cancelled" | "stale" | "applying" | "sent" | "uncertain"
}
export type ReviewState = { reviews: Record<string, Review> }
type Dependencies = {
  client: OpenCodeClient
  state: ReviewState
  update: (mutation: (state: ReviewState) => void) => Promise<void>
  idle: (sessionID: string) => boolean
  notify: (message: string) => void
  getPlan?: (sessionID: string, revision: string, digest: string) => Promise<Pick<PlanRecord, "text" | "path" | "originMessageID" | "userMessageID">>
  directory?: string
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const actionable = (messages: readonly SessionMessageInfo[]) => messages.filter((m) =>
  ["user", "assistant", "synthetic", "shell", "location-switched", "compaction"].includes(m.type))
const boundary = (messages: readonly SessionMessageInfo[]) => actionable(messages).at(-1)?.id ?? ""
const userBefore = (messages: readonly SessionMessageInfo[], messageID: string) => {
  const end = messages.findIndex((message) => message.id === messageID)
  if (end < 0) return undefined
  return [...messages.slice(0, end + 1)].reverse().find((message) => message.type === "user")?.id
}

export function candidate(messages: readonly SessionMessageInfo[]) {
  const last = messages.at(-1)
  if (last?.type !== "idle" || last.outcome !== "succeeded") return
  const message = actionable(messages).at(-1)
  if (message?.type !== "assistant" || message.agent !== "plan" || message.error
    || !message.time.completed || message.finish !== "stop") return
  const raw = message.content.filter((p) => p.type === "text").map((p) => p.text).join("\n\n").trim()
  if (!raw.endsWith(READY)) return
  const receipt = raw.slice(0, -READY.length).trim().match(/Revision: ([a-f0-9]{32}); digest: ([a-f0-9]{64})$/)
  if (!receipt) return
  return { messageID: message.id, boundary: boundary(messages), revision: receipt[1], digest: receipt[2] }
}

export function createReviewController(deps: Dependencies) {
  const { client, state } = deps
  const directory = deps.directory ?? join(homedir(), ".opencode", "plan", "review")
  const seen = new Map<string, number>()
  const inFlight = new Set<string>()
  let stopped = false
  let lastError = ""
  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (!stopped && message !== lastError) deps.notify(message)
    lastError = message
  }
  const same = (a: Review | undefined, b: Review | undefined) =>
    a?.messageID === b?.messageID && a?.revision === b?.revision && a?.status === b?.status
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
  const getPlan = deps.getPlan ?? ((sessionID, revision, digest) => loadPlan(sessionID, revision, digest, directory))
  const fresh = async (review: Review) => {
    if (stopped || !deps.idle(review.sessionID)) return false
    const session = await client.session.get({ sessionID: review.sessionID })
    if (session.agent !== "plan" || session.outcome !== "succeeded") return false
    const pending = await client.session.inbox.list({ sessionID: review.sessionID })
    if (pending.length) return false
    const messages = await client.session.context({ sessionID: review.sessionID })
    const proposed = candidate(messages)
    if (boundary(messages) !== review.boundary || proposed?.revision !== review.revision || proposed.digest !== review.hash) return false
    const saved = await getPlan(review.sessionID, review.revision, review.hash)
    return saved.text === review.text && saved.path === review.path
  }
  const invalidate = async (review: Review) => save({ ...review, status: "stale" }, review)
  const discover = async (sessionID: string) => {
    if (stopped || !deps.idle(sessionID)) return
    try {
      const session = await client.session.get({ sessionID })
      if (session.parentID || session.agent !== "plan" || session.outcome !== "succeeded") return
      const stored = state.reviews[sessionID]
      const previous = stored ? { ...stored } : undefined
      const proposal = candidate(await client.session.context({ sessionID }))
      if (!proposal) { seen.set(sessionID, session.time.updated); return }
      if (previous?.revision === proposal.revision) { seen.set(sessionID, session.time.updated); return }
      const messages = await client.session.context({ sessionID })
      const saved = await getPlan(sessionID, proposal.revision, proposal.digest)
      const originIndex = messages.findIndex((message) => message.id === saved.originMessageID)
      const finalIndex = messages.findIndex((message) => message.id === proposal.messageID)
      const origin = messages[originIndex]
      if (originIndex < 0 || finalIndex < originIndex || origin?.type !== "assistant" || origin.agent !== "plan"
        || userBefore(messages, saved.originMessageID) !== saved.userMessageID) {
        throw new Error("Plan receipt is not bound to this Plan turn and user request")
      }
      const plan = { ...proposal, text: saved.text, path: saved.path }
      const review: Review = { ...plan, sessionID, revision: proposal.revision, hash: proposal.digest, status: "pending" }
      if (!await fresh(review)) return
      if (!await save(review, previous)) return
      // Retire an older pending revision only after the new one is committed.
      // invalidate's conditional state write cannot replace the newly committed revision.
      if (previous?.status === "pending") await invalidate(previous)
      seen.set(sessionID, session.time.updated)
    } catch (error) { report(error) }
  }
  const apply = async (review: Review, decision: "approve" | "revise", feedback = "") => {
    if (!current(review)) return
    if (!await fresh(review)) { await invalidate(review); return }
    feedback = feedback.trim()
    if (decision === "revise" && !feedback) throw new Error("Please provide nonempty feedback")
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
    if (!stored) {
      await discover(sessionID)
      if (!state.reviews[sessionID]) throw new Error("There is no plan to display for this session")
      return
    }
    if (stored.status === "uncertain" || stored.status === "applying") {
      throw new Error("Handoff state is uncertain. Inspect session history before retrying; no automatic implementation replay was performed.")
    }
    if (stored.status === "sent" || stored.status === "stale") {
      throw new Error("This plan review is no longer reopenable; create a new plan revision")
    }
    if (!await fresh(stored)) throw new Error("This saved plan is no longer current; prepare a new plan in Plan mode")
    if (stored.status === "pending") return
    const review = { ...stored, status: "pending" as const }
    // A completed handoff cannot reach this path because the active agent/context no longer match.
    if (!await save(review, stored)) return
  }
  const decide = async (sessionID: string, decision: "approve" | "revise", feedback = "") => {
    const review = state.reviews[sessionID]
    if (!review || review.status !== "pending") throw new Error("No pending plan review for this session")
    if (inFlight.has(sessionID)) throw new Error("A plan review decision is already in progress")
    inFlight.add(sessionID)
    try {
      await apply({ ...review }, decision, feedback)
    } finally {
      inFlight.delete(sessionID)
    }
  }
  const cancel = async (sessionID: string) => {
    const review = state.reviews[sessionID]
    if (review?.status === "pending") await save({ ...review, status: "cancelled" }, review)
  }
  return {
    discover, reconcile, reopen, decide, cancel, report,
    get: (sessionID: string) => state.reviews[sessionID],
    needsDiscovery: (s: SessionInfo) => deps.idle(s.id) && seen.get(s.id) !== s.time.updated,
    dispose: () => { stopped = true },
  }
}
