// Offline: node tests/prompt-stash.test.mjs; uses installed Pi, no model calls.
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jiti, root, require } from "./pi-runtime.mjs";
const { default: extension } = await jiti.import(fileURLToPath(new URL("../.pi/agent/extensions/prompt-stash/index.ts", import.meta.url)));
const { TranscriptNavigationEditor } = await jiti.import(fileURLToPath(new URL("../.pi/agent/extensions/transcript-navigation.ts", import.meta.url)));
const { TuiAltScreen, setKeybindings, matchesKey, visibleWidth } = await jiti.import(require.resolve("@earendil-works/pi-tui"));
const { KeybindingsManager } = await jiti.import(join(root, "dist/core/keybindings.js"));
const { createInteractiveTuiReference } = await jiti.import(join(root, "dist/modes/interactive/tui-renderer.js"));
function fixture(editor) {
  let text = "", handler, fail = false;
  const events = new Map(), notifications = [], statuses = new Map();
  extension({
    on(name, fn) { events.set(name, fn); },
    registerShortcut(key, opts) { assert.equal(key, "ctrl+s"); handler = opts.handler; },
  });
  const ctx = { mode: "tui", ui: {
    getEditorText: () => editor ? editor.getExpandedText() : text,
    setEditorText(value) { if (fail) throw new Error("not persisted"); if (editor) editor.setText(value); else text = value; },
    notify: (...args) => notifications.push(args),
    setStatus: (key, value) => statuses.set(key, value),
  } };
  return { ctx, events, notifications, statuses, press: () => handler(ctx),
    set: (s) => ctx.ui.setEditorText(s), get: () => ctx.ui.getEditorText(), fail: (v) => { fail = v; } };
}
const f = fixture();
f.events.get("session_start")({}, f.ctx);
f.press(); assert.match(f.notifications.at(-1)[0], /No stashed/);
for (const draft of ["line one\n\nline three\n", "中文 👩🏽‍💻 e\u0301\n", " \n\t", "x".repeat(200000)]) {
  f.set(draft); f.press(); assert.equal(f.get(), "");
  assert.match(f.statuses.get("prompt-stash"), /Stash: 1/);
  f.press(); assert.equal(f.get(), draft);
  f.press(); assert.equal(f.get(), "");
  const replacement = `new stash\n${draft}`;
  f.set(replacement); f.press(); assert.equal(f.get(), "");
  assert.equal(f.notifications.at(-1)[0], "Prompt stashed!");
  assert.equal(f.notifications.at(-1)[1], "info");
  f.press(); assert.equal(f.get(), replacement);
  assert.equal(f.statuses.get("prompt-stash"), undefined);
}
f.set("old recovery stash"); f.press();
f.set("recover me"); f.fail(true); f.press(); f.fail(false);
assert.equal(f.get(), "recover me"); // Save failure retains both copies.
f.set(""); f.fail(true); f.press(); f.fail(false);
assert.match(f.statuses.get("prompt-stash"), /Stash: 1/);
f.press(); assert.equal(f.get(), "recover me");
// User input restores exactly once, without altering the submitted message.
const onInput = f.events.get("input");
f.set("auto restored\n你好"); f.press();
for (const source of ["rpc", "extension"]) {
  onInput({ source, text: "not user submission" }, f.ctx);
  assert.equal(f.get(), ""); assert.match(f.statuses.get("prompt-stash"), /Stash: 1/);
}
onInput({ source: "interactive", text: "   " }, f.ctx); assert.equal(f.get(), "");
const submitted = { source: "interactive", text: "short question", streamingBehavior: "steer" };
assert.equal(onInput(submitted, f.ctx), undefined);
assert.equal(submitted.text, "short question");
assert.equal(f.get(), "auto restored\n你好"); assert.equal(f.statuses.get("prompt-stash"), undefined);
f.set(""); onInput(submitted, f.ctx); assert.equal(f.get(), ""); // Consumed.
f.set("keep stash"); f.press(); f.set("new draft typed before input event");
onInput(submitted, f.ctx); assert.equal(f.get(), "new draft typed before input event");
f.set(""); f.press(); assert.equal(f.get(), "keep stash"); // Retained, manual fallback.
f.press(); f.fail(true); onInput(submitted, f.ctx); f.fail(false);
assert.match(f.statuses.get("prompt-stash"), /Stash: 1/);
onInput({ source: "interactive", text: "", images: [{ type: "image", data: "test", mimeType: "image/png" }] }, f.ctx);
assert.equal(f.get(), "keep stash"); assert.equal(f.statuses.get("prompt-stash"), undefined);
for (const event of ["session_shutdown", "session_start"]) {
  f.set("session scoped"); f.press(); f.events.get(event)({}, f.ctx);
  f.press(); assert.equal(f.get(), ""); assert.match(f.notifications.at(-1)[0], /No stashed/);
}
for (const mode of ["rpc", "print", "json"]) {
  const ctx = { mode, ui: new Proxy({}, { get() { throw new Error("Non-TUI UI accessed"); } }) };
  // All mode guards must avoid touching the unavailable UI.
  f.events.get("session_start")({}, ctx); f.events.get("session_shutdown")({}, ctx);
  f.ctx.mode = mode; f.press();
}
f.ctx.mode = "tui";

// Real installed TUI focus routing and existing editor, not a second editor.
const terminal = { columns: 80, rows: 24, write() {}, hideCursor() {}, showCursor() {} };
const renderer = new TuiAltScreen(terminal);
const tui = createInteractiveTuiReference(() => renderer);
tui.requestRender = () => {};
const kb = new KeybindingsManager({}); setKeybindings(kb);
const editor = new TranscriptNavigationEditor(tui, { borderColor: (s) => s }, kb);
const e = fixture(editor);
editor.onExtensionShortcut = (data) => {
  if (!matchesKey(data, "ctrl+s")) return false;
  e.press(); return true;
};
tui.addChild(editor); tui.setFocus(editor);
const input = (data) => tui.handleTerminalInput(data);
for (const nav of [false, true]) {
  editor.setText("");
  const draft = "多行 pasted\n".repeat(30);
  input(`\x1b[200~${draft}\x1b[201~`);
  assert.equal(editor.getExpandedText(), draft);
  if (nav) input("\x11");
  for (const key of ["\x13", "\x1b[115;5u"]) {
    input(key); assert.equal(editor.getText(), "");
    input(key); assert.equal(editor.getExpandedText(), draft);
  }
  for (const width of [5, 12, 40, 80]) assert.ok(visibleWidth(editor.render(width).at(-1)) <= width);
  if (nav) input("i");
}
// Actual native submit clears first; restoration fills only the next draft.
editor.setText("next long prompt"); input("\x13");
editor.setText("send only this question");
const sent = [];
editor.onSubmit = (text) => { sent.push(text); e.events.get("input")({ source: "interactive", text }, e.ctx); };
input("\r");
assert.deepEqual(sent, ["send only this question"]);
assert.equal(editor.getExpandedText(), "next long prompt");
assert.equal(e.statuses.get("prompt-stash"), undefined);
// A focused picker/dialog owns Ctrl+S; extension handler must not see it.
// This reproduces the renderer focus boundary used by model/thinking/settings/session dialogs.
let dialogSaves = 0;
const dialog = { render: () => ["dialog"], handleInput(data) { if (matchesKey(data, "ctrl+s")) dialogSaves++; } };
tui.addChild(dialog); tui.setFocus(dialog);
const before = editor.getExpandedText();
input("\x13"); input("\x1b[115;5u");
assert.equal(dialogSaves, 2); assert.equal(editor.getExpandedText(), before);
assert.equal(e.statuses.get("prompt-stash"), undefined);
const { initTheme } = await jiti.import(join(root, "dist/modes/interactive/theme/theme.js"));
const { ThinkingSelectorComponent } = await jiti.import(join(root, "dist/modes/interactive/components/thinking-selector.js"));
const { SessionSelectorComponent } = await jiti.import(join(root, "dist/modes/interactive/components/session-selector.js"));
for (const theme of ["dark", "light"]) {
  initTheme(theme, false); // No watcher and no model/runtime refresh.
  let savedLevel;
  const thinking = new ThinkingSelectorComponent("medium", ["low", "medium", "high"], () => {}, () => {}, (level) => { savedLevel = level; });
  tui.addChild(thinking); tui.setFocus(thinking); input("\x13");
  assert.equal(savedLevel, "medium");
  assert.equal(editor.getExpandedText(), before);
  tui.removeChild(thinking);
  const sessions = new SessionSelectorComponent(async () => [], async () => [], () => {}, () => {}, () => {}, () => {}, { keybindings: kb });
  await new Promise((resolve) => setImmediate(resolve));
  tui.addChild(sessions); tui.setFocus(sessions);
  const initialSort = sessions.sortMode;
  input("\x13"); assert.notEqual(sessions.sortMode, initialSort);
  assert.equal(editor.getExpandedText(), before);
  tui.removeChild(sessions);
}
tui.setFocus(editor); input("\x13"); assert.equal(editor.getText(), "");
input("\x13"); assert.equal(editor.getExpandedText(), before);

// Regular-mode editor also forwards extension shortcuts without activating NAV.
const regular = new TranscriptNavigationEditor({ mode: "regular", requestRender() {} }, { borderColor: (s) => s }, kb);
const r = fixture(regular);
regular.onExtensionShortcut = (data) => { if (!matchesKey(data, "ctrl+s")) return false; r.press(); return true; };
regular.setText("regular\ntext"); regular.handleInput("\x13"); assert.equal(regular.getText(), "");
regular.handleInput("\x13"); assert.equal(regular.getText(), "regular\ntext");
console.log("Prompt stash: state, failures, lifecycle, expanded paste, INPUT/NAV, focus and regular mode passed");
