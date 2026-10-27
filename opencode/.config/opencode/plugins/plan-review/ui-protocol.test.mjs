import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = (name) => readFile(new URL(name, import.meta.url), "utf8")

test("TUI uses the session-panel review view and does not create native forms", async () => {
  const tui = await source("./tui.tsx")
  assert.match(tui, /append:\s*"session\.panel"/)
  assert.match(tui, /<scrollbox[\s\S]*?flexGrow=\{1\}/)
  assert.match(tui, /Approve and build/)
  assert.match(tui, /Request changes/)
  assert.match(tui, /bind: "escape"/)
  assert.match(tui, /run: \(\) => context\.ui\.panel\.close\(\)/)
  assert.match(tui, /bind:\s*"ctrl\+a"/)
  assert.match(tui, /bind:\s*"ctrl\+r"/)
  assert.doesNotMatch(tui, /session\.form\.create/)
  assert.match(tui, /"reviews-v3"/)
  assert.match(tui, /Reopen saved plan review/)
  assert.match(tui, /slash: \{ name: "plan-review-reopen" \}/)
  assert.match(tui, /mode: "global"/)
  assert.match(tui, /normalizedFeedback\(/)
  assert.match(tui, /height=\{8\}/)
  assert.match(tui, /bind: "return"/)
  assert.match(tui, /alt\+return/)
  assert.match(tui, /insertFeedbackBackslashNewline/)
  assert.match(tui, /context\.ui\.dialog\.show/)
  assert.match(tui, /feedbackOpen\(\)/)
  assert.match(tui, /keyInput\.prependListener\("keypress", onNavigationKey\)/)
  assert.match(tui, /reviewNavigationAction\(event, navigation\(\)\)/)
  assert.match(tui, /if \(!props\.panel\.focused \|\| props\.feedbackOpen\(\)\) return/)
  assert.match(tui, /tableOptions=\{\{ style: "grid"/)
  assert.match(tui, /fg=\{props\.context\.theme\.markdown\.text\}/)
})

test("remote revision retrieval requires session, revision, and digest and returns turn binding", async () => {
  const rpc = await source("./rpc.ts")
  const server = await source("./index.ts")
  const tui = await source("./tui.tsx")
  for (const field of ["sessionID", "revision", "digest"]) {
    assert.match(rpc, new RegExp(`${field}: \\{ type: "string" \\}`))
    assert.match(rpc, new RegExp(`"${field}"`))
  }
  assert.match(rpc, /originMessageID/)
  assert.match(rpc, /userMessageID/)
  assert.match(server, /ctx\.rpc\.register\(PlanReview/)
  assert.match(server, /context\.agent !== "plan"/)
  assert.match(tui, /context\.client\.rpc\(PlanReview\)\.get/)
})
