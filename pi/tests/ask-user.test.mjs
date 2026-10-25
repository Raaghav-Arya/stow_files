import test from 'node:test';
import assert from 'node:assert/strict';
import { jiti, require, root } from './pi-runtime.mjs';
import { join } from 'node:path';
const { loadThemeFromPath } = await jiti.import(join(root, 'dist/modes/interactive/theme/theme.js'));
const { QuestionState, validateQuestions, display } = await jiti.import('../.pi/agent/extensions/ask-user/model.ts');
const { QuestionUI, askQuestions } = await jiti.import('../.pi/agent/extensions/ask-user/ui.ts');
const { default: extension } = await jiti.import('../.pi/agent/extensions/ask-user/index.ts');
const { visibleWidth, KeybindingsManager, TUI_KEYBINDINGS } = require('@earendil-works/pi-tui');
const questions = [
 { id: 'one', kind: 'single', prompt: 'Choose 界 é', options: [{id:'a',label:'Alpha',description:'Detailed description '.repeat(10)},{id:'b',label:'Beta'}] },
 { id: 'many', kind: 'multi', prompt: 'Pick several', options: [{id:'a',label:'A'},{id:'b',label:'B'}] },
 { id: 'text', kind: 'text', prompt: 'Explain' },
];
const theme = { fg: (_c, s) => s };
const kb = new KeybindingsManager(TUI_KEYBINDINGS);
function fixture(q = questions, colors = theme) {
 let result;
 const tui = { requestRender(){}, terminal:{rows:30}, getScreenWidth:()=>80 };
 const ui = new QuestionUI(q, tui, colors, kb, r => { result = r; });
 return { ui, tui, result:()=>result };
}
test('strict semantic validation and stable IDs', () => {
 assert.throws(()=>validateQuestions([]));
 assert.throws(()=>validateQuestions([questions[0],questions[0]]), /Duplicate/);
 assert.throws(()=>validateQuestions([{...questions[0],options:[]}]), /require/);
 assert.throws(()=>validateQuestions([{...questions[0],options:[questions[0].options[0],questions[0].options[0]]}]), /Duplicate/);
 assert.throws(()=>validateQuestions([{...questions[2],options:questions[0].options}]), /cannot/);
 const s = new QuestionState(questions); assert.equal(s.complete,false); assert.equal(s.submit(),undefined);
 s.choose(); assert.deepEqual(s.answers.get('one').optionIds,['a']);
 s.choose(); s.cursor=1; s.choose(); assert.deepEqual(s.answers.get('many').optionIds,['a','b']);
 s.jump(2); assert.equal(s.text('  '),false); assert.equal(s.text('x'.repeat(8001)),false);
 assert.equal(s.text('answer\n界'),true); assert.equal(s.submit().status,'submitted');
});
test('review, back navigation, explicit submission and draft preservation', () => {
 const f=fixture(); f.ui.handleInput('\x19'); assert.equal(f.ui.state.page,1);
 f.ui.handleInput('\r'); f.ui.handleInput('\x1b[C'); // irrelevant right key
 f.ui.state.jump(2); // sync via navigation
 f.ui.handleInput('\x1b[1;3D'); f.ui.handleInput('\x1b[1;3C');
 f.ui.focused=true; assert.equal(f.ui.editor.focused,true);
 f.ui.handleInput('draft 界');
 f.ui.handleInput('\x1b[1;3D'); f.ui.handleInput('\x1b[1;3C');
 assert.equal(f.ui.editor.getText(),'draft 界');
 let forwarded=false; const base=f.ui.editor.handleInput.bind(f.ui.editor);
 f.ui.editor.handleInput=data=>{ if(data==='\x19') forwarded=true; base(data); };
 f.ui.handleInput('\x19'); assert.equal(forwarded,true); assert.equal(f.result(),undefined);
 f.ui.handleInput('\r'); assert.equal(f.ui.state.review,true); assert.equal(f.result(),undefined);
 f.ui.handleInput('\r'); assert.equal(f.result().status,'submitted');
});
test('key releases never choose, advance or submit', () => {
 const f=fixture();
 f.ui.handleInput('\x1b[121;5:3u');
 assert.equal(f.ui.state.page,0); assert.equal(f.ui.state.answers.size,0);
 f.ui.handleInput('\x1b[121;5u'); assert.equal(f.ui.state.page,1);
 f.ui.handleInput('\x1b[121;5:3u'); assert.equal(f.ui.state.answers.has('many'),false);
});
test('cancel discards partial answers and completion is idempotent', () => {
 const f=fixture(); f.ui.handleInput('\r'); f.ui.handleInput('\x1b');
 assert.deepEqual(f.result().answers,[]); assert.equal(f.result().status,'cancelled');
 f.ui.handleInput('\r'); assert.equal(f.result().status,'cancelled');
});
test('responsive width, scrolling, Unicode and sanitized model text', () => {
 const f=fixture();
 for (const width of [1,2,10,24,80,120]) {
  for (const line of f.ui.render(width)) assert.ok(visibleWidth(line)<=width, `${width}: ${line}`);
 }
 f.tui.terminal.rows=15; f.ui.handleInput('\x1b[6~'); assert.ok(f.ui.render(24).length <= 12);
 assert.equal(display('\x1b]52;c;evil\x07'),']52;c;evil');
});
test('actual dark/light themes, text cursor focus, resize and multiline paste drafts', () => {
 for (const name of ['dark','light']) {
  const colors=loadThemeFromPath(join(root,`dist/modes/interactive/theme/${name}.json`),'truecolor');
  const f=fixture(questions,colors);
  assert.match(f.ui.render(80).join(''), /\x1b\[/);
  f.ui.handleInput('\x1b[1;3C'); f.ui.handleInput('\x1b[1;3C'); f.ui.focused=true;
  f.ui.handleInput('\x1b[200~first\nsecond 界\x1b[201~');
  f.ui.handleInput('\x1b[1;3D'); f.ui.handleInput('\x1b[1;3C');
  assert.equal(f.ui.editor.getExpandedText(),'first\nsecond 界');
  for(const width of [2,12,40,80]) {
   const lines=f.ui.render(width); assert.ok(lines.every(line=>visibleWidth(line)<=width && !line.includes('\n')));
  }
  f.ui.focused=false; assert.equal(f.ui.editor.focused,false);
 }
});
test('headless/RPC return explicit unanswered without custom UI', async () => {
 for (const mode of ['rpc','json','print']) {
  const result=await askQuestions({mode,ui:{custom(){throw Error('must not open');}}},questions);
  assert.equal(result.status,'needs-user-input'); assert.deepEqual(result.answers,[]);
 }
});
test('abort closes actual custom component and removes listener', async () => {
 const ac=new AbortController(); let component;
 const promise=askQuestions({mode:'tui',ui:{custom(factory){return new Promise(done=>{component=factory({terminal:{rows:30},requestRender(){}},theme,kb,done);});}}},questions,ac.signal);
 ac.abort(); const result=await promise;
 assert.equal(result.status,'aborted'); component.handleInput('\r'); assert.equal(result.answers.length,0);
 assert.equal((await askQuestions({mode:'tui'},questions,ac.signal)).status,'aborted');
});
test('adapter busy guard, shutdown cancellation, structured results and no draft API', async () => {
 let tool; const handlers={}; extension({on:(event,fn)=>handlers[event]=fn,registerTool:t=>tool=t});
 let component;
 const ctx={mode:'tui',ui:{custom(factory){return new Promise(done=>{component=factory({terminal:{rows:30},requestRender(){}},theme,kb,done);});}}};
 const first=tool.execute('1',{questions},undefined,undefined,ctx);
 assert.equal((await tool.execute('2',{questions},undefined,undefined,ctx)).details.status,'busy');
 await handlers.session_shutdown();
 const result=await first; assert.equal(result.details.status,'aborted'); assert.deepEqual(result.structuredContent,result.details);
 assert.equal(tool.exposure,'model-only');
 component.handleInput('\r');
});
