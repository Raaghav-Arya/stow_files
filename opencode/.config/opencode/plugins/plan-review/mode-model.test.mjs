import test from "node:test"
import assert from "node:assert/strict"
import { shouldApplyModeModel } from "./mode-model.ts"

test("configured model applies when switching into Plan or Build", () => {
  assert.equal(shouldApplyModeModel("build", "plan"), true)
  assert.equal(shouldApplyModeModel("plan", "build"), true)
  assert.equal(shouldApplyModeModel("explore", "build"), true)
})

test("model choice is preserved unless the agent changes into Plan or Build", () => {
  assert.equal(shouldApplyModeModel("build", "build"), false)
  assert.equal(shouldApplyModeModel("plan", "plan"), false)
  assert.equal(shouldApplyModeModel("build", "explore"), false)
  assert.equal(shouldApplyModeModel(undefined, "build"), false)
})
