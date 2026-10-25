// Real discovery of live extension links + combined offline Pi RPC startup.
// No credentials, provider/model requests, live-session reload or dependency install.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { jiti, root } from './pi-runtime.mjs';
const { DefaultResourceLoader, SettingsManager, SessionManager } = await jiti.import('@earendil-works/pi-coding-agent');
const { ExtensionRunner } = await jiti.import(join(root,'dist/core/extensions/runner.js'));
const { KeybindingsManager } = await jiti.import(join(root,'dist/core/keybindings.js'));
const { RpcTransport } = await jiti.import('../.pi/agent/extensions/agents-hub/rpc.ts');
const agentDir = process.env.PI_TEST_LIVE_AGENT_DIR || join(homedir(),'.pi/agent');
const tmp=mkdtempSync(join(tmpdir(),'pi-features-'));
let rpc;
try {
  const loader=new DefaultResourceLoader({cwd:tmp,agentDir,settingsManager:SettingsManager.inMemory(),noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});
  await loader.reload();
  const result=loader.getExtensions();
  assert.deepEqual(result.errors,[],'all live extensions must load without errors');
  const runner=new ExtensionRunner(result.extensions,result.runtime,tmp,SessionManager.inMemory(tmp),{});
  const commands=runner.getRegisteredCommands().map(c=>c.name);
  for(const name of ['plan','clear','agent','agents']) assert.ok(commands.includes(name),`missing /${name}`);
  const tools=runner.getAllRegisteredTools().map(t=>t.definition.name);
  for(const name of ['ask_user','plan_draft','agents']) assert.ok(tools.includes(name),`missing ${name}`);
  const config=JSON.parse(readFileSync(join(agentDir,'keybindings.json'),'utf8'));
  const shortcuts=runner.getShortcuts(new KeybindingsManager(config).getEffectiveConfig());
  const diagnostics=runner.getShortcutDiagnostics();
  assert.equal(diagnostics.length,1);
  assert.match(diagnostics[0].message,/ctrl\+s.*app.models.save.*Using .*prompt-stash/); // Expected contextual overlap, not a reserved-key rejection.
  assert.ok(shortcuts.has('ctrl+s'),'Ctrl+S must survive real reserved-shortcut filtering');
  assert.ok(shortcuts.has('alt+a'));
  let text='real registered stash draft';const statuses=new Map();
  const errors=[];runner.onError(e=>errors.push(e));let footer;
  runner.setUIContext({getEditorText:()=>text,setEditorText:v=>{text=v;},setStatus:(k,v)=>{if(v===undefined)statuses.delete(k);else statuses.set(k,v);},
    setFooter(factory){footer=factory({requestRender(){}},{fg:(_c,s)=>s},{onBranchChange:()=>()=>{},getAvailableProviderCount:()=>1,getGitBranch:()=>undefined,getExtensionStatuses:()=>statuses});},
    setEditorComponent(){},notify(){}},'tui');
  await runner.emit({type:'session_start',reason:'new'});
  const ctx=runner.createContext();
  await shortcuts.get('ctrl+s').handler(ctx);assert.equal(text,'');assert.match(statuses.get('prompt-stash'),/Stash: 1/);
  assert.match(footer.render(120).join('\n'),/Stash: 1/);
  statuses.set('plan-mode','Plan: review r1');assert.match(footer.render(120).join('\n'),/Plan: review r1/);statuses.delete('plan-mode');
  await shortcuts.get('ctrl+s').handler(ctx);assert.equal(text,'real registered stash draft');
  await shortcuts.get('ctrl+s').handler(ctx);assert.equal(text,'');
  const input=await runner.emitInput('short user message',undefined,'interactive');
  assert.equal(input.action,'continue');assert.equal(text,'real registered stash draft');
  assert.equal(statuses.has('prompt-stash'),false);
  await runner.emit({type:'session_shutdown',reason:'exit'});
  assert.deepEqual(errors,[],'combined lifecycle must not emit extension errors');

  // Explicit paths are the actual live symlinks, but all mutable CLI storage is isolated.
  const paths=['agents-hub','ask-user','clear-alias','plan-mode','prompt-stash','transcript-navigation.ts','absolute-context-footer.ts'];
  for(const name of paths) realpathSync(join(agentDir,'extensions',name));
  const args=[join(root,'dist/cli.js'),'--mode','rpc','--offline','--no-session','--no-extensions','--no-mcp','--no-skills','--no-prompt-templates','--no-approve'];
  for(const name of paths) args.push('--extension',join(agentDir,'extensions',name));
  rpc=new RpcTransport(process.execPath,args,tmp,()=>{},()=>{},30_000,{PI_CODING_AGENT_DIR:tmp,PI_AGENTS_HUB_CHILD:'0'});
  const registered=await rpc.request('get_commands');
  for(const name of ['plan','clear','agent','agents']) assert.ok(registered.commands.some(c=>c.name===name));
  await rpc.request('prompt',{message:'/plan enter'}); // Extension command only, no model turn.
  let entries=(await rpc.request('get_entries')).entries;
  assert.ok(entries.some(e=>e.customType==='local-plan-mode-v1'&&e.data.mode==='plan'));
  const bash=await rpc.request('bash',{command:'echo should-not-run'});
  assert.match(bash.output,/Plan mode blocks/);assert.equal(bash.exitCode,1);
  await rpc.request('prompt',{message:'/clear'}); // Real replacement, ephemeral test session only.
  entries=(await rpc.request('get_entries')).entries;
  assert.ok(!entries.some(e=>e.customType==='local-plan-mode-v1'));
  const after=await rpc.request('get_commands');assert.ok(after.commands.some(c=>c.name==='plan'));
  console.log('Live discovery, real Ctrl+S registration/dispatch, combined RPC /plan gate and /clear replacement passed');
} finally {await rpc?.close();rmSync(tmp,{recursive:true,force:true});}
