import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jiti, root } from "./pi-runtime.mjs";
import { makeFixture } from "./hub-fixture.mjs";
const dir=fileURLToPath(new URL("../.pi/agent/extensions/agents-hub/",import.meta.url));
const {ChatView}=await jiti.import(join(dir,"chat-view.ts"));
const {Editor}=await jiti.import("@earendil-works/pi-tui");
const {KeybindingsManager}=await jiti.import(join(root,"dist/core/keybindings.js"));
const fixture=makeFixture();
const sent=[], actions=[]; let transcriptChanged;
const items=[];
const store={get:()=>items,subscribe(_id,fn){transcriptChanged=fn;return()=>{transcriptChanged=undefined;}}};
const state={draft:"first line\nsecond line",history:[]};
const controller={state,send:(...args)=>sent.push(args),interrupt:id=>actions.push(["interrupt",id]),close:id=>actions.push(["close",id]),resume:id=>actions.push(["resume",id]),back:()=>actions.push(["back"])};
const agent={id:"a",name:"child",provider:"openai",model:"gpt",thinking:"high",cwd:"/tmp",state:"idle",turns:3,maxTurns:100};
const view=new ChatView({agent,tui:fixture.tui,theme:fixture.theme,keys:new KeybindingsManager(),transcript:store,controller});
try {
  assert.ok(view.editor instanceof Editor,"compose Pi's real Editor");
  view.setFocused(true); assert.equal(view.editor.focused,true,"focus is propagated for IME");
  view.editor.setText("edited draft"); assert.equal(state.draft,"edited draft","draft state is controller-owned");
  // Ctrl+U/D belong to the transcript even when the editor is focused.
  view.handleInput("\x15"); view.handleInput("\x04");
  // Bare letters are input, not chat commands; Ctrl+P/N reach Editor history.
  view.handleInput("x"); assert.equal(view.editor.getText(),"edited draftx");
  view.handleInput("\x10"); view.handleInput("\x0e");
  view.editor.setText("draft");
  view.handleInput("\x1b\r"); // Alt+Enter marks the next explicit send as follow-up.
  await view.editor.onSubmit?.("draft");
  assert.deepEqual(sent,[["a","draft",true]]);
  assert.deepEqual(state.history,["draft"]);
  assert.equal(state.draft,"");
  view.handleInput("\x1b"); assert.deepEqual(actions,[ ["back"] ],"Escape returns when idle");
  agent.state="running"; view.handleInput("\x1b"); assert.deepEqual(actions.at(-1),["interrupt","a"]);
  agent.state="stopped"; view.editor.setText("closed draft"); view.editor.onSubmit?.("closed draft"); assert.equal(sent.length,1,"closed agent remains read-only");
  view.resume(); assert.deepEqual(actions.at(-1),["resume","a"]);
  items.push({id:"m1",role:"assistant",text:"hello",source:"live"}); transcriptChanged?.();
  assert.equal(state.draft,"closed draft");
} finally { view.dispose(); fixture.view.dispose(); }
assert.equal(transcriptChanged,undefined);
console.log("Agents Hub chat tests passed (Editor focus, draft/history ownership, scoped keyboard, send/interrupt/resume)");
