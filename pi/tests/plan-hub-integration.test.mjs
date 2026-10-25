// Cooperative plan/hub integration with actual manager, no child/model requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jiti } from './pi-runtime.mjs';
const { createEventBus } = await jiti.import('@earendil-works/pi-coding-agent');
const plan = (await jiti.import('../.pi/agent/extensions/plan-mode/index.ts')).default;
const { ENTRY } = await jiti.import('../.pi/agent/extensions/plan-mode/state.ts');
const { installPlanPolicy } = await jiti.import('../.pi/agent/extensions/agents-hub/plan-policy.ts');
const { AgentManager, defaults } = await jiti.import('../.pi/agent/extensions/agents-hub/manager.ts');
async function fixture(reverse = false) {
  const tmp = mkdtempSync(join(tmpdir(), 'pi-plan-hub-'));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = tmp;
  const events = createEventBus(), hooks = {}, commands = {}, tools = {}, statuses = new Map();
  let entries = [], hub, planState;
  const connections = [];
  const pi = { events, on(n,f) { hooks[n]=f; }, registerCommand(n,c) { commands[n]=c; }, registerShortcut() {}, registerTool(t) { tools[t.name]=t; }, appendEntry(customType,data) { entries.push({type:'custom',customType,data}); }, sendMessage() {} };
  const ctx = { hasUI:true, isIdle:()=>true, sessionManager:{getBranch:()=>entries,getSessionId:()=> 'hub-test'}, ui:{setStatus:(k,v)=>statuses.set(k,v), notify(){}, confirm:async()=>true} };
  let policy;
  if (reverse) plan(pi);
  policy = installPlanPolicy(pi, ()=>hub);
  if (!reverse) plan(pi);
  events.on('plan-mode:state', s=>{planState=s;});
  hub = new AgentManager(defaults, { root:tmp, assertCanWork:()=>policy.assertCanWork(), parent(){}, connect(a,event) {
    const c = { event, calls:[], async request(type,args) { this.calls.push({type,args}); if(type==='get_state')return {model:{provider:'mock',id:'mock'},thinkingLevel:'low'}; event({type:'agent_start'}); return {}; }, async close() {} }; connections.push(c); return c;
  }});
  await hooks.session_start({},ctx);
  const launch = ()=>hub.launch({task:'task',provider:'mock',model:'mock',thinking:'low',cwd:tmp});
  return {pi,hub,ctx,hooks,tools,commands,connections,statuses,launch,get state(){return planState;},setEntries(e){entries=e;}, run:a=>commands.plan.handler(a,ctx),async dispose(){await hub.shutdown();rmSync(tmp,{recursive:true,force:true});if(previousAgentDir===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previousAgentDir;}};
}
for (const reverse of [false,true]) test(`entry veto and all child work guarded (reverse discovery=${reverse})`, async()=>{
  const f=await fixture(reverse);
  try {
    const a=await f.launch();
    await f.run('enter');assert.equal(f.state.mode,'normal');
    f.connections[0].event({type:'agent_settled'});
    await f.run('enter');assert.equal(f.state.mode,'normal','idle connections also veto');
    await f.hub.stop(a.id);await f.run('enter');assert.equal(f.state.mode,'plan');
    await assert.rejects(f.launch(),/Plan mode blocks/);
    await assert.rejects(f.hub.send(a.id,'message'),/Plan mode blocks/);
    assert.equal(f.hooks.tool_call({toolName:'ask_user'}),undefined);
    assert.equal(f.hooks.tool_call({toolName:'agents'}).block,true);
    await f.tools.plan_draft.execute('id',{markdown:'Scope, steps, validation'},undefined,undefined,f.ctx);
    await f.run('approve');assert.equal(f.state.mode,'execute');
    await f.launch();assert.equal(f.connections.length,2);
  } finally {await f.dispose();}
});
test('tree restoration stops children and gates all tools until actual cleanup',async()=>{
  const f=await fixture();
  try {
    const a=await f.launch();let finish;
    f.connections[0].close=()=>new Promise(r=>{finish=r;});
    f.setEntries([{type:'custom',customType:ENTRY,data:{version:1,mode:'execute',markdown:'Plan',revision:1}}]);
    const restoring=f.hooks.session_tree({},f.ctx);
    await Promise.resolve();
    assert.equal(f.state.mode,'plan');assert.equal(f.hooks.tool_call({toolName:'read'}).block,true);
    await assert.rejects(f.launch(),/Plan mode blocks/);
    assert.equal(a.state,'stopped');assert.notEqual(a.transportClosed,true);
    finish();await restoring;
    assert.equal(a.transportClosed,true);assert.equal(f.hooks.tool_call({toolName:'read'}),undefined);
    assert.equal(f.statuses.get('plan-mode'),'Plan: review r1');
    // Navigating to an unrestricted branch updates the guard, not a stale cache.
    f.setEntries([]);await f.hooks.session_tree({},f.ctx);await f.launch();
  } finally {await f.dispose();}
});
test('queued messages recheck policy at dispatch rather than admission only',async()=>{
  const f=await fixture();
  try {
    const a=await f.launch();let finish;
    a.serial=new Promise(r=>{finish=r;});
    const sending=f.hub.send(a.id,'must not reach child');
    f.pi.events.emit('plan-mode:state',{version:1,mode:'plan'});
    // assertCanWork requests the authoritative state, so use a real branch restore.
    f.setEntries([{type:'custom',customType:ENTRY,data:{version:1,mode:'plan',markdown:'Plan',revision:1}}]);
    const restoring=f.hooks.session_tree({},f.ctx);
    finish();await assert.rejects(sending,/Plan mode blocks/);await restoring;
    assert.equal(f.connections[0].calls.filter(c=>c.type==='prompt').length,1);
  } finally {await f.dispose();}
});
test('failed process cleanup remains fail-closed',async()=>{
  const f=await fixture();
  try {
    await f.launch();f.connections[0].close=async()=>{throw new Error('close failed');};
    f.setEntries([{type:'custom',customType:ENTRY,data:{version:1,mode:'plan',markdown:'Plan',revision:1}}]);
    await f.hooks.session_tree({},f.ctx);
    assert.equal(f.hooks.tool_call({toolName:'read'}).block,true);
    await f.run('leave');assert.equal(f.state.mode,'plan');
    await assert.rejects(f.launch(),/Plan mode blocks/);
  } finally {await f.dispose();}
});
