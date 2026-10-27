import test from 'node:test';
import assert from 'node:assert/strict';
import { jiti, require, root } from './pi-runtime.mjs';
import { join } from 'node:path';
const { loadThemeFromPath } = await jiti.import(join(root, 'dist/modes/interactive/theme/theme.js'));
const { QuestionState, validateQuestions, display, ResultSchema } = await jiti.import('../.pi/agent/extensions/ask-user/model.ts');
const { Check } = require('typebox/value');
const { QuestionUI, askQuestions } = await jiti.import('../.pi/agent/extensions/ask-user/ui.ts');
const { default: extension } = await jiti.import('../.pi/agent/extensions/ask-user/index.ts');
const { visibleWidth, KeybindingsManager, TUI_KEYBINDINGS, TuiMainScreen, TuiAltScreen } = require('@earendil-works/pi-tui');
const { CustomEditor } = await jiti.import('@earendil-works/pi-coding-agent');
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
 assert.equal(s.text('answer\n界'),true); assert.equal(s.submit().status,'submitted'); assert.deepEqual(s.submit().skippedQuestionIds,[]);
});
test('Tab/Shift+Tab navigate every page without selecting or submitting', () => {
 const f=fixture(); const key=k=>f.ui.handleInput(k);
 key('\x1b[Z'); assert.equal(f.ui.state.page,0);
 key('\t'); assert.equal(f.ui.state.page,1); assert.equal(f.ui.state.answers.size,0);
 key('\t'); assert.equal(f.ui.state.page,2);
 f.ui.focused=true; assert.equal(f.ui.editor.focused,true);
 key('draft 界'); key('\t'); assert.equal(f.ui.state.page,3);
 assert.equal(f.ui.state.answers.has('text'),false);
 assert.match(f.ui.render(100).join('\n'),/Draft \(not saved\):[\s\S]*draft 界/);
 key('\t'); assert.equal(f.ui.state.page,3); assert.equal(f.result(),undefined);
 key('\r'); assert.equal(f.result().status,'submitted'); // explicitly submit all unanswered
 assert.deepEqual(f.result().answers,[]);
 assert.deepEqual(f.result().skippedQuestionIds,['one','many','text']);
 assert.equal(Check(ResultSchema,f.result()),true);
});

test('Ctrl+P and Ctrl+N move the selection up and down', () => {
 const f=fixture(); const key=k=>f.ui.handleInput(k);
 key('\x0e'); assert.equal(f.ui.state.cursor,1); // Ctrl+N down
 key('\x10'); assert.equal(f.ui.state.cursor,0); // Ctrl+P up
 key('\x10'); assert.equal(f.ui.state.cursor,0); // clamp at first option
 key('\r'); key('\t'); key('\t'); key('\t'); // review page
 key('\x0e'); assert.equal(f.ui.state.cursor,1);
 key('\x10'); assert.equal(f.ui.state.cursor,0);
});

test('notes can be added, revised, removed and reviewed independently of answers', () => {
 const f=fixture(); const key=k=>f.ui.handleInput(k);
 for (let page=0;page<questions.length;page++) {
  if (page === 2) key('\x1b');
  key('n'); key(`note ${page}: n/d literal`); key('\t');
  assert.equal(f.ui.state.notes.get(questions[page].id),`note ${page}: n/d literal`);
 }
 assert.match(f.ui.render(120).join('\n'),/Note:[\s\S]*note 0: n\/d literal/);
 key('\x1b[Z'); key('\x1b'); key('n');
 assert.doesNotMatch(f.ui.render(120).join('\n'),/Note: revised/);
 f.ui.editor.setText('revised\n界'); key('\r');
 assert.equal(f.ui.state.notes.get('text'),'revised\n界');
 key('n'); f.ui.editor.setText(''); key('\r'); assert.equal(f.ui.state.notes.has('text'),false);
 key('\x1b[Z'); key('\x1b[Z'); key('\r'); // first question advances to multi
 key(' '); key('\t'); key('answer'); key('\r'); key('\t'); key('\r');
 const result=f.result(); assert.equal(result.status,'submitted');
 assert.deepEqual(result.notes,[{id:'one',note:'note 0: n/d literal'},{id:'many',note:'note 1: n/d literal'}]);
 assert.equal(Check(ResultSchema,result),true);
});

for (const page of [0,1,2,3]) test(`discussion is available on page ${page}, with partial context not answers`, () => {
 const f=fixture(); const key=k=>f.ui.handleInput(k);
 key('n'); key('context n/d'); key('\r'); key('\r'); // first choice -> multi
 key(' '); key('\x1b[B'); key(' '); key('\t');
 key('descriptive draft'); key('\x1b');
 if(page===3) { key('\t'); key('\x1b[B'); } // discuss highlighted multi from review
 else { while(f.ui.state.page>page) key('\x1b[Z'); }
 key('d'); const result=f.result(); assert.equal(result.status,'discussion-requested');
 assert.equal(result.question.id,questions[page===3 ? 1 : page].id);
 assert.equal(Object.hasOwn(result,'answers'),false);
 assert.deepEqual(result.partial[1].selectedOptionIds,['a','b']);
 assert.equal(result.partial[0].note,'context n/d');
 assert.equal(result.partial[2].textDraft,'descriptive draft');
 assert.equal(Check(ResultSchema,result),true);
 key('\r'); assert.equal(f.result(),result); // completion is idempotent
});

test('text opens automatically, n/d are literal, blank Enter exits unanswered and drafts are omitted', () => {
 const f=fixture([questions[2]]); const key=k=>f.ui.handleInput(k);
 assert.equal(f.ui.editor.focused,false); // screen starts active; TUI focus is assigned by its owner
 key('n/d draft'); assert.equal(f.ui.editor.getText(),'n/d draft');
 f.ui.editor.setText(''); key('\r');
 assert.equal(f.ui.state.page,0);
 assert.equal(f.ui.state.answers.has('text'),false);
 key('\t'); key('\r');
 assert.deepEqual(f.result(),{status:'submitted',answers:[],skippedQuestionIds:['text'],notes:[]});
});

test('notes on skipped questions are submitted separately; descriptive drafts are omitted', () => {
 const f=fixture([questions[2]]); const key=k=>f.ui.handleInput(k);
 key('unsaved draft'); key('\x1b'); key('n'); key('context only'); key('\r');
 key('\t'); key('\r');
 assert.deepEqual(f.result(),{status:'submitted',answers:[],skippedQuestionIds:['text'],notes:[{id:'text',note:'context only'}]});
});

test('partial submission keeps saved answers and notes but omits skipped drafts', () => {
 const f=fixture(); const key=k=>f.ui.handleInput(k);
 key('\r'); // save single choice and advance
 key('n'); key('note on skipped multi'); key('\r'); key('\t');
 assert.equal(f.ui.state.page,2); f.ui.focused=true; assert.equal(f.ui.editor.focused,true);
 key('unsaved descriptive draft'); key('\x1b[Z'); key('\t');
 assert.equal(f.ui.editor.getText(),'unsaved descriptive draft'); // auto editor on return
 key('\t'); key('\r');
 assert.deepEqual(f.result(),{
  status:'submitted',answers:[{id:'one',kind:'single',optionIds:['a']}],
  skippedQuestionIds:['many','text'],notes:[{id:'many',note:'note on skipped multi'}],
 });
 assert.equal(Check(ResultSchema,f.result()),true);
 assert.doesNotMatch(JSON.stringify(f.result()),/unsaved descriptive draft/);
});
test('active editors do not duplicate their note or descriptive text above the editor', () => {
 for(const kind of ['note','answer']) {
  const f=fixture([kind==='note'?questions[0]:questions[2]]); const key=k=>f.ui.handleInput(k);
  if(kind==='note') key('n');
  key('unique preview sentinel');
  const editing=f.ui.render(120).join('\n');
  assert.equal(editing.split('unique preview sentinel').length-1,1);
  key('\r');
  assert.match(f.ui.render(120).join('\n'),/unique preview sentinel/);
  if(kind==='note') { key('n'); assert.doesNotMatch(f.ui.render(120).join('\n'),/^Note:/m); }
 }
});
test('saved notes appear below the choices and remain hidden while being edited', () => {
 const f=fixture([questions[1]]); const key=k=>f.ui.handleInput(k);
 key('n'); key('first note line\nsecond note line');
 assert.doesNotMatch(f.ui.render(120).join('\n'),/^Note:/m);
 key('\r');
 const output=f.ui.render(120).join('\n');
 assert.ok(output.indexOf('[ ] B')<output.indexOf('Note:'));
 assert.match(output,/Note:\n  first note line\n  second note line/);
 key('n'); assert.doesNotMatch(f.ui.render(120).join('\n'),/^Note:/m);
 key('\x1b'); assert.match(f.ui.render(120).join('\n'),/Note:/);
});
test('saving a note scrolls its bottom block into view even with overflowing choices and resize', () => {
 const q={id:'long',kind:'multi',prompt:'Choose features',options:Array.from({length:30},(_,i)=>({id:`o${i}`,label:`Feature ${i}`,description:'Long description '.repeat(10)}))};
 const f=fixture([q]); const key=k=>f.ui.handleInput(k);
 f.tui.terminal.rows=14;
 key('n'); key('first 界\nsecond'); key('\r');
 for(const width of [24,80,40]) {
  const output=f.ui.render(width).join('\n');
  assert.match(output,/Note:/); assert.match(output,/first 界/); assert.match(output,/second/);
  assert.ok(f.ui.render(width).every(line=>visibleWidth(line)<=width));
 }
 key('\x1b[A'); // selection navigation resumes normal option visibility
 assert.match(f.ui.render(80).join('\n'),/Feature 0/);
 assert.equal(f.ui.state.notes.get('long'),'first 界\nsecond');
});
test('all review headings, answers and notes use distinct theme roles in dark and light', () => {
 for(const name of ['dark','light']) {
  const colors=loadThemeFromPath(join(root,`dist/modes/interactive/theme/${name}.json`),'truecolor');
  const f=fixture(questions,colors); f.tui.terminal.rows=60;
  f.ui.state.answers.set('one',{id:'one',kind:'single',optionIds:['a']});
  f.ui.state.answers.set('text',{id:'text',kind:'text',text:'Saved text'});
  f.ui.state.drafts.set('text','Saved text');
  f.ui.state.notes.set('one','Colored note');
  f.ui.handleInput('\t'); f.ui.handleInput('\t'); f.ui.handleInput('\t');
  const output=f.ui.render(120).join('\n');
  assert.ok(output.includes(colors.fg('accent','› Question 1: Choose 界 é')));
  assert.ok(output.includes(colors.fg('accent','  Question 2: Pick several')));
  assert.ok(output.includes(colors.fg('accent','  Question 3: Explain')));
  assert.ok(output.includes(colors.fg('text','    • Alpha')));
  assert.ok(output.includes(colors.fg('text','    Saved text')));
  assert.ok(output.includes(colors.fg('mdHeading','  Note:')));
  assert.ok(output.includes(colors.fg('mdHeading','    Colored note')));
  assert.notEqual(colors.fg('accent','sample'),colors.fg('text','sample'));
  assert.notEqual(colors.fg('mdHeading','sample'),colors.fg('accent','sample'));
  assert.notEqual(colors.fg('mdHeading','sample'),colors.fg('text','sample'));
 }
});
test('review formats numbered blocks, selected labels, multiline answer/note and hides IDs', () => {
 const f=fixture();
 f.ui.state.answers.set('one',{id:'one',kind:'single',optionIds:['a']});
 f.ui.state.answers.set('text',{id:'text',kind:'text',text:'first line\nsecond line'});
 f.ui.state.notes.set('one','note line 1\nnote line 2');
 f.ui.state.jump(questions.length);
 const output=f.ui.render(120).join('\n');
 assert.match(output,/Question 1: Choose/); assert.match(output,/• Alpha/);
 assert.match(output,/first line\n    second line/); assert.match(output,/note line 1\n    note line 2/);
 assert.doesNotMatch(output,/one:|many:|text:/);
});

test('review blocks remain width-bounded and scrollable with multiline Unicode and themes', () => {
 for(const name of ['dark','light']) {
  const colors=loadThemeFromPath(join(root,`dist/modes/interactive/theme/${name}.json`),'truecolor');
  const f=fixture(questions,colors);
  f.ui.state.answers.set('one',{id:'one',kind:'single',optionIds:['a']});
  f.ui.state.notes.set('one','Multiline café 界\n'.repeat(15));
  f.ui.handleInput('\t'); f.ui.handleInput('\t'); f.ui.handleInput('\t');
  for(const width of [1,2,12,24,80,120]) {
   const lines=f.ui.render(width);
   assert.ok(lines.every(line=>visibleWidth(line)<=width && !line.includes('\n')));
  }
  f.ui.handleInput('\x1b[6~'); f.ui.render(40);
  f.ui.handleInput('\x1b[B'); f.ui.handleInput('\x1b[B');
  assert.match(f.ui.render(80).join('\n'),/Question 3: Explain/);
 }
});
test('result schema distinguishes discussion, submission and cancellation', () => {
 const f=fixture([questions[0]]); f.ui.handleInput('d');
 assert.equal(Check(ResultSchema,f.result()),true);
 assert.equal(Check(ResultSchema,{...f.result(),answers:[]}),false);
 assert.equal(Check(ResultSchema,{status:'discussion-requested',answers:[],reason:'bad'}),false);
 assert.equal(Check(ResultSchema,{status:'submitted',answers:[],notes:[]}),false);
 assert.equal(Check(ResultSchema,{status:'submitted',answers:[],skippedQuestionIds:['one'],notes:[]}),true);
 assert.equal(Check(ResultSchema,{status:'cancelled',answers:[],reason:'cancel'}),true);
 assert.equal(Check(ResultSchema,{status:'cancelled',answers:[{id:'one',kind:'single',optionIds:['a']}],reason:'cancel'}),false);
});

test('edited descriptive drafts cannot silently submit a stale saved answer', () => {
 const f=fixture([questions[2]]); const key=k=>f.ui.handleInput(k);
 key('old'); key('\r'); assert.equal(f.ui.state.answers.get('text').text,'old');
 key('e'); key('\x1b'); assert.equal(f.ui.state.answers.get('text').text,'old'); // unchanged
 key('e'); f.ui.editor.setText('new'); key('\t');
 assert.equal(f.ui.state.answers.has('text'),false);
 key('\r'); assert.equal(f.result().status,'submitted');
 assert.deepEqual(f.result().answers,[]);
 assert.deepEqual(f.result().skippedQuestionIds,['text']);
});

test('oversized editor input blocks navigation and saving rather than losing text', () => {
 for(const kind of ['answer','note']) {
  const f=fixture([questions[2]]); const key=k=>f.ui.handleInput(k);
  if (kind === 'note') key('\x1b');
  else { f.ui.focused=true; assert.equal(f.ui.editor.focused,true); }
  if (kind === 'note') key('n');
  f.ui.editor.setText('x'.repeat(8001));
  for(const input of ['\t','\x1b[Z','\r','\x1b']) {
   key(input); assert.equal(f.ui.state.page,0); assert.equal(f.ui.editor.getText().length,8001);
   assert.match(f.ui.render(100).join('\n'),/8000/); assert.equal(f.result(),undefined);
  }
  f.ui.editor.setText('shorter'); key('\x1b'); key('d');
  assert.equal(Check(ResultSchema,f.result()),true);
 }
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
  f.ui.handleInput('\t'); f.ui.handleInput('\t'); f.ui.focused=true;
  f.ui.handleInput('\x1b[200~first\nsecond 界\x1b[201~');
  f.ui.handleInput('\x1b[1;3D'); f.ui.handleInput('\x1b[1;3C');
  assert.equal(f.ui.editor.getExpandedText(),'first\nsecond 界');
  for(const width of [2,12,40,80]) {
   const lines=f.ui.render(width); assert.ok(lines.every(line=>visibleWidth(line)<=width && !line.includes('\n')));
  }
  f.ui.focused=false; assert.equal(f.ui.editor.focused,false);
 }
});
for (const Renderer of [TuiMainScreen,TuiAltScreen]) test(`real ${Renderer.name} focus isolates Shift+Tab from main-editor shortcuts`, () => {
 const tui=new Renderer({columns:100,rows:30,write(){}});
 tui.requestRender=()=>{}; tui.requestImmediateRender=()=>{};
 const plain=s=>s;
 const editorTheme={borderColor:plain,selectList:{selectedPrefix:plain,selectedText:plain,description:plain,scrollInfo:plain,noMatch:plain}};
 const main=new CustomEditor(tui,editorTheme,kb);
 main.setText('untouched main draft'); let toggles=0;
 main.onExtensionShortcut=data=>{if(data==='\x1b[Z'){toggles++;return true;}return false;};
 const ui=new QuestionUI(questions,tui,theme,kb,()=>{});
 tui.setFocus(main); tui.handleTerminalInput('\x1b[Z'); assert.equal(toggles,1);
 tui.setFocus(ui); tui.handleTerminalInput('\t'); tui.handleTerminalInput('\x1b[Z');
 assert.equal(ui.state.page,0); assert.equal(toggles,1); assert.equal(main.getText(),'untouched main draft');
 tui.handleTerminalInput('n'); assert.equal(ui.editor.focused,true);
 tui.handleTerminalInput('note'); tui.handleTerminalInput('\t');
 assert.equal(ui.state.page,1); assert.equal(ui.state.notes.get('one'),'note');
 tui.setFocus(main); assert.equal(ui.editor.focused,false);
});
test('discussion result flows through tool adapter and does not automatically reopen UI', async () => {
 let tool; extension({on(){},registerTool:t=>tool=t}); let component,opens=0;
 const ctx={mode:'tui',ui:{custom(factory){opens++;return new Promise(done=>{component=factory({terminal:{rows:30},requestRender(){}},theme,kb,done);});}}};
 const pending=tool.execute('discussion',{questions},undefined,undefined,ctx);
 component.handleInput('d'); const result=await pending;
 assert.equal(result.details.status,'discussion-requested'); assert.equal(opens,1);
 assert.equal(Check(tool.outputSchema,result.structuredContent),true);
 assert.deepEqual(JSON.parse(result.content[0].text),result.details);
 assert.match(tool.description,/Discuss conversationally/);
 const rendered=tool.renderResult(result,{expanded:true},theme).render(120).join('\n');
 assert.match(rendered,/partial context only/);
 assert.doesNotMatch(rendered,/Submitted/);
});
test('legacy submitted results still render after a reload', () => {
 let tool; extension({on(){},registerTool:t=>tool=t});
 const legacy={details:{status:'submitted',answers:[{id:'one',kind:'single',optionIds:['a']}]}};
 for(const expanded of [false,true]) {
  const output=tool.renderResult(legacy,{expanded},theme).render(120).join('\n');
  assert.match(output,/Submitted 1 answer\(s\); skipped 0/);
 }
});
for(const status of ['cancelled','aborted']) test(`${status} renderer is status-only, even if historical details contain context`, () => {
 let tool; extension({on(){},registerTool:t=>tool=t});
 const result={details:{status,answers:[],reason:'private question contents',notes:[{id:'one',note:'private note'}],partial:[{id:'one',textDraft:'private draft'}]}};
 for(const expanded of [false,true]) {
  const rendered=tool.renderResult(result,{expanded},theme).render(120).join('').trim();
  assert.equal(rendered,status);
  assert.doesNotMatch(rendered,/private|answers|questions|reason|note|draft/i);
 }
});

test('notes and drafts are not leaked by cancellation', () => {
 const f=fixture(); f.ui.handleInput('n'); f.ui.handleInput('private draft');
 f.ui.handleInput('\x1b'); f.ui.handleInput('\x1b');
 assert.deepEqual(f.result(),{status:'cancelled',answers:[],reason:'User cancelled; no answers submitted.'});
 assert.equal(Check(ResultSchema,f.result()),true);
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
 component.handleInput('n'); component.handleInput('private note');
 ac.abort(); const result=await promise;
 assert.equal(Object.hasOwn(result,'notes'),false);
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
