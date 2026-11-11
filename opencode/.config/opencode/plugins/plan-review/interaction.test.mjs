import test from "node:test"
import assert from "node:assert/strict"
import { insertFeedbackBackslashNewline, insertFeedbackNewline, normalizedFeedback, reviewNavigationAction } from "./interaction.ts"

test("Ctrl+Q toggles review navigation; plain j/k remain typing keys outside navigation", () => {
  assert.deepEqual(reviewNavigationAction({ name: "q", ctrl: true }, false), { type: "toggle" })
  assert.deepEqual(reviewNavigationAction({ name: "q", ctrl: true }, true), { type: "toggle" })
  assert.equal(reviewNavigationAction({ name: "j" }, false), undefined)
  assert.equal(reviewNavigationAction({ name: "k" }, false), undefined)
  assert.deepEqual(reviewNavigationAction({ name: "j" }, true), { type: "line", amount: 1 })
  assert.deepEqual(reviewNavigationAction({ name: "k" }, true), { type: "line", amount: -1 })
})

test("review navigation maps paging, edges, actions and close only while active", () => {
  assert.deepEqual(reviewNavigationAction({ name: "pagedown" }, true), { type: "page", amount: 1 })
  assert.deepEqual(reviewNavigationAction({ name: "pageup" }, true), { type: "page", amount: -1 })
  assert.deepEqual(reviewNavigationAction({ name: "home" }, true), { type: "edge", edge: "start" })
  assert.deepEqual(reviewNavigationAction({ name: "end" }, true), { type: "edge", edge: "end" })
  assert.deepEqual(reviewNavigationAction({ name: "a", ctrl: true }, true), { type: "approve" })
  assert.deepEqual(reviewNavigationAction({ name: "r", ctrl: true }, true), { type: "revise" })
  assert.deepEqual(reviewNavigationAction({ name: "escape" }, true), { type: "close" })
  assert.equal(reviewNavigationAction({ name: "escape" }, false), undefined)
})

test("feedback normalization keeps nonempty trimmed text and rejects whitespace", () => {
  assert.equal(normalizedFeedback("  fix the example  "), "fix the example")
  assert.equal(normalizedFeedback(" \n\t "), undefined)
})

test("backslash plus Enter inserts a newline and removes only the preceding slash", () => {
  let text = "change\\"
  const editor = {
    get cursorOffset() { return text.length },
    getTextRange(start, end) { return text.slice(start, end) },
    deleteCharBackward() { text = text.slice(0, -1) },
    newLine() { text += "\n" },
  }
  assert.equal(insertFeedbackBackslashNewline(editor), true)
  assert.equal(text, "change\n")
  assert.equal(insertFeedbackBackslashNewline(editor), false)
  assert.equal(text, "change\n")
})

test("Alt+Enter/Ctrl+Enter newline action inserts a newline without changing existing text", () => {
  let text = "first line"
  insertFeedbackNewline({ newLine() { text += "\n" } })
  assert.equal(text, "first line\n")
})
