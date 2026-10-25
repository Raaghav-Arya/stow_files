// Offline installed-Pi regression tests. No subprocess/model/network requests.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jiti, root, require } from "./pi-runtime.mjs";
const { TranscriptNavigationEditor } = await jiti.import(fileURLToPath(new URL("../.pi/agent/extensions/transcript-navigation.ts", import.meta.url)));
const { setKeybindings, SelectList, visibleWidth } = await jiti.import(require.resolve("@earendil-works/pi-tui"));
const { KeybindingsManager } = await jiti.import(join(root, "dist/core/keybindings.js"));
const { PickerAcceptanceInput, isPickerAcceptance } = await jiti.import(fileURLToPath(new URL("../.pi/agent/extensions/picker-accept/input.ts", import.meta.url)));
const config = JSON.parse(readFileSync(new URL("../.pi/agent/keybindings.json", import.meta.url), "utf8"));
assert.deepEqual(config["tui.select.confirm"], ["enter", "ctrl+y"]);
const kb = new KeybindingsManager(config);
setKeybindings(kb);
const TestEditor = TranscriptNavigationEditor;
const listTheme = Object.fromEntries(["selectedPrefix", "selectedText", "description", "scrollInfo", "noMatch"].map(k => [k, s => s]));
const theme = { borderColor: s => s, selectList: listTheme };
async function make(mode = "regular", prefix = "/") {
  const editor = new TestEditor({ mode, requestRender() {} }, theme, kb);
  let submits = 0;
  editor.onSubmit = () => submits++;
  editor.setAutocompleteProvider({
    getSuggestions: async () => ({ items: [{value:"alpha",label:"αlpha"},{value:"beta",label:"你好"}], prefix }),
    applyCompletion: (_lines, _line, _col, item) => ({ lines: [prefix + item.value], cursorLine: 0, cursorCol: prefix.length + item.value.length }),
  });
  editor.setText(prefix);
  editor.handleInput("\t");
  for (let i = 0; i < 100 && !editor.isShowingAutocomplete(); i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(editor.isShowingAutocomplete(), true);
  return { editor, submits: () => submits };
}
for (const mode of ["regular", "fullscreen"]) {
  for (const prefix of ["/", "@", "./"]) {
    for (const key of ["\x19", "\t", "\x1b[121;5u"]) {
      const { editor, submits } = await make(mode, prefix);
      editor.handleInput("\x1b[B");
      editor.handleInput(key);
      assert.equal(editor.getText(), prefix + "beta");
      assert.equal(editor.isShowingAutocomplete(), false);
      assert.equal(submits(), 0, "acceptance must not submit slash command");
    }
  }
}
// Existing yank outside completion is unchanged.
const yank = new TestEditor({mode:"regular",requestRender(){}}, theme, kb);
yank.setText("keep 你好"); yank.handleInput("\x15"); assert.equal(yank.getText(), "");
yank.handleInput("\x19"); assert.equal(yank.getText(), "keep 你好");
// Empty suggestions do not create a selection or accidentally submit.
const empty = new TestEditor({mode:"regular",requestRender(){}}, theme, kb);
let emptySubmits = 0;
empty.onSubmit = () => emptySubmits++;
empty.setAutocompleteProvider({
  getSuggestions: async () => ({items:[],prefix:"/"}),
  applyCompletion: () => { throw new Error("No item may be applied"); },
});
empty.setText("/"); empty.handleInput("\t");
await new Promise(r => setTimeout(r, 25));
assert.equal(empty.isShowingAutocomplete(), false);
empty.handleInput("\x19"); assert.equal(emptySubmits,0);
// Cancellation stays intact; afterwards Ctrl+Y must not become Tab.
const cancelled = await make(); cancelled.editor.handleInput("\x1b");
assert.equal(cancelled.editor.isShowingAutocomplete(), false);
assert.equal(new PickerAcceptanceInput().transform("\x19", cancelled.editor), "\x19");
const state = { isShowingAutocomplete: () => true };
const mapping = new PickerAcceptanceInput();
assert.equal(mapping.transform("\x1b[121;5:3u", state), undefined); // key release
assert.equal(mapping.transform("\x1b[200~", state), "\x1b[200~");
assert.equal(mapping.transform("\x19", state), "\x19"); // split paste: do not accept
assert.equal(mapping.transform("\x1b[201~", state), "\x1b[201~");
assert.equal(mapping.transform("\x19", state), "\t");
assert.equal(mapping.transform("\x1b[200~\x19\x1b[201~", state), "\x1b[200~\x19\x1b[201~");
setKeybindings(new KeybindingsManager({"tui.input.tab": []}));
assert.equal(mapping.transform("\x19", state), undefined, "disabled Tab must fail inert");
setKeybindings(kb);
// Opt-in custom picker acceptance uses its selected-item guard, not a global remap.
const list = new SelectList([{value:"alpha",label:"α"},{value:"beta",label:"你好"}], 5, listTheme);
let selected; let cancelledList = false;
list.onSelect = item => selected = item.value;
list.onCancel = () => cancelledList = true;
const input = data => {
  if (isPickerAcceptance(data, kb)) {
    const item = list.getSelectedItem();
    if (item) list.onSelect(item);
  } else list.handleInput(data);
};
input("\x1b[B"); input("\x19"); assert.equal(selected, "beta");
selected = undefined; list.setFilter("al"); input("\x19"); assert.equal(selected,"alpha");
selected = undefined; list.setFilter("zzz"); input("\x19"); assert.equal(selected,undefined);
list.setFilter(""); input("\t"); assert.equal(selected,undefined); // stock list Tab remains inert
input("\r"); assert.equal(selected,"alpha"); input("\x1b"); assert.equal(cancelledList,true);
for (const width of [5,12,40,80]) for (const line of list.render(width)) assert.ok(visibleWidth(line) <= width);
assert.equal(isPickerAcceptance("\x1b[121;5:3u",kb), false);
// User explicitly approved confirm in text dialogs in preference to yank.
const { initTheme } = await jiti.import(join(root,"dist/modes/interactive/theme/theme.js"));
initTheme("dark");
const { ExtensionInputComponent } = await jiti.import(join(root,"dist/modes/interactive/components/extension-input.js"));
let dialogSubmits = 0;
const dialog = new ExtensionInputComponent("Text", "", () => dialogSubmits++, () => {});
dialog.handleInput("\x19"); assert.equal(dialogSubmits,1,"Ctrl+Y confirms text dialogs by explicit user choice");
dialog.dispose();
// Built-in ctx.ui.select honors the shared confirmation binding.
const { ExtensionSelectorComponent } = await jiti.import(join(root,"dist/modes/interactive/components/extension-selector.js"));
let builtinSelected;
const selector = new ExtensionSelectorComponent("Choose",["one","two"], value => builtinSelected=value, () => {});
selector.handleInput("\x19"); assert.equal(builtinSelected,"one");
selector.handleInput("\x1b[B"); selector.handleInput("\r"); assert.equal(builtinSelected,"two");
selector.dispose();
console.log("Picker acceptance tests passed (integrated editor + configured picker/text confirmation)");
