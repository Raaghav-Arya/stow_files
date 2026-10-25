import test, { after } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const testDir = mkdtempSync(join(tmpdir(), 'pi-plan-files-'));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = testDir;
after(() => {
  rmSync(testDir, { recursive: true, force: true });
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});
import assert from 'node:assert/strict';
import { jiti } from './pi-runtime.mjs';
const S = await jiti.import('../.pi/agent/extensions/plan-mode/state.ts');
const extension = (await jiti.import('../.pi/agent/extensions/plan-mode/index.ts')).default;
function fixture(entries = [], hasUI = true) {
  const hooks = {}, commands = {}, shortcuts = {}, tools = {}, saved = [], statuses = [], messages = [], bus = new Map();
  let idle = true;
  const pi = {
    on(name, fn) { hooks[name] = fn; },
    registerCommand(name, value) { commands[name] = value; },
    registerShortcut(name, value) { shortcuts[name] = value; },
    registerTool(value) { tools[value.name] = value; },
    appendEntry(customType, data) { saved.push({ type: 'custom', customType, data: structuredClone(data) }); },
    sendMessage(value, options) { messages.push({ value, options }); },
    events: { on(name, fn) { bus.set(name, fn); }, emit(name, data) { bus.get(name)?.(data); } },
  };
  const ctx = { hasUI, isIdle: () => idle, sessionManager: { getBranch: () => entries, getSessionId: () => 'test-session' }, ui: {
    setStatus: (...x) => statuses.push(x), notify() {}, editor: async () => undefined, confirm: async () => true,
  } };
  extension(pi);
  const ready = hooks.session_start({}, ctx);
  return { pi, hooks, ctx, commands, shortcuts, tools, saved, statuses, messages, bus, ready, setIdle: x => { idle = x; }, run: async args => { await ready; return commands.plan.handler(args, ctx); } };
}
test('Shift+Tab freely toggles an empty plan without warnings or dialogs', async () => {
  const f = fixture(); await f.ready;
  const toggle = () => f.shortcuts['shift+tab'].handler(f.ctx);
  await toggle(); assert.equal(f.saved.at(-1).data.mode, 'plan');
  f.ctx.ui.confirm = async () => assert.fail('Mode switching must not confirm');
  f.ctx.ui.notify = () => assert.fail('Mode switching must not warn');
  await toggle(); assert.equal(f.saved.at(-1).data.mode, 'normal');
  await toggle(); assert.equal(f.saved.at(-1).data.mode, 'plan');
});
test('Shift+Tab preserves the draft without approval and respects admission guards', async () => {
  const f = fixture(); await f.ready;
  const toggle = () => f.shortcuts['shift+tab'].handler(f.ctx);
  f.setIdle(false); await toggle(); assert.equal(f.saved.length, 0);
  f.setIdle(true);
  f.bus.set('plan-mode:before-enter', ({ block }) => block('child running'));
  await toggle(); assert.equal(f.saved.length, 0);
  f.bus.delete('plan-mode:before-enter'); await toggle();
  await f.tools.plan_draft.execute('id', { markdown: 'Reviewed draft' }, undefined, undefined, f.ctx);
  f.ctx.ui.confirm = async () => assert.fail('Mode switching must not confirm');
  f.ctx.ui.notify = () => assert.fail('Mode switching must not warn');
  await toggle(); assert.equal(f.saved.at(-1).data.mode, 'normal');
  assert.equal(f.saved.at(-1).data.approved, undefined);
  assert.equal(f.saved.at(-1).data.markdown, 'Reviewed draft');
  assert.match(f.hooks.before_agent_start({}, f.ctx).message.content, /Reviewed draft/);
  await toggle(); assert.equal(f.saved.at(-1).data.mode, 'plan');
  assert.equal(f.messages.length, 0);
});
test('dedicated Markdown files are presented, read back and preserved across revisions', async () => {
  const f = fixture(); await f.run('enter');
  const result = await f.tools.plan_draft.execute('id', { markdown: '# First plan' }, undefined, undefined, f.ctx);
  const path = result.details.path;
  assert.ok(path.startsWith(join(testDir, 'plans', 'test-session')));
  assert.equal(readFileSync(path, 'utf8'), '# First plan');
  await f.run('show');
  assert.ok(f.messages.at(-1).value.content.includes(path));
  assert.match(f.messages.at(-1).value.content, /# First plan/);
  writeFileSync(path, '# User edited');
  await f.run('show'); assert.match(f.messages.at(-1).value.content, /# User edited/);
  assert.equal(f.saved.at(-1).data.revision, 2);
  f.ctx.ui.confirm = async (_title, text) => { assert.match(text, /# User edited/); return true; };
  await f.run('approve'); assert.equal(f.saved.at(-1).data.approved.markdown, '# User edited');
  await f.run('enter');
  await f.tools.plan_draft.execute('id2', { markdown: '# Second plan' }, undefined, undefined, f.ctx);
  assert.notEqual(join(testDir, 'plans', f.saved.at(-1).data.planFile), path);
  assert.equal(readFileSync(path, 'utf8'), '# User edited');
  const branch = fixture(f.saved); await branch.ready; await branch.run('show');
  assert.match(branch.messages.at(-1).value.content, /# Second plan/);
});
test('external edits during approval invalidate confirmation and missing files cannot approve', async () => {
  const f = fixture(); await f.run('enter');
  const result = await f.tools.plan_draft.execute('id', { markdown: 'Original' }, undefined, undefined, f.ctx);
  f.ctx.ui.confirm = async () => { writeFileSync(result.details.path, 'Changed'); return true; };
  await f.run('approve'); assert.equal(f.saved.at(-1).data.mode, 'plan');
  assert.equal(f.saved.at(-1).data.markdown, 'Changed');
  rmSync(result.details.path);
  await f.run('approve'); assert.equal(f.saved.at(-1).data.mode, 'plan');
  await f.run('leave'); assert.equal(f.saved.at(-1).data.mode, 'normal');
});
test('historical session-only drafts migrate lazily without changing revision or mode', async () => {
  const old = { ...S.initial(), mode: 'normal', markdown: 'Legacy plan', revision: 3 };
  const f = fixture([{ type: 'custom', customType: S.ENTRY, data: old }]);
  await f.ready; await f.run('show');
  const saved = f.saved.at(-1).data;
  assert.equal(saved.mode, 'normal'); assert.equal(saved.revision, 3);
  assert.ok(existsSync(join(testDir, 'plans', saved.planFile)));
  assert.match(f.messages.at(-1).value.content, /Legacy plan/);
});
test('state draft/approval validation and preservation', () => {
  assert.throws(() => S.draft(S.initial(), 'x'));
  const a = S.draft({ ...S.initial(), mode: 'plan' }, '# Scope\n1. Test');
  const approved = S.approve(a);
  assert.deepEqual(approved.approved, { markdown: a.markdown, revision: 1 });
  const revised = S.draft({ ...approved, mode: 'plan' }, 'Revised');
  assert.equal(revised.approved.markdown, a.markdown);
  assert.throws(() => S.draft(revised, ''));
  assert.throws(() => S.draft(revised, 'a'.repeat(S.MAX_PLAN + 1)));
});
test('strict gate covers bash, custom/MCP, delegation and nested calls', async () => {
  const f = fixture(); await f.run('');
  for (const name of ['bash', 'edit', 'write', 'agents_hub', 'subagent', 'mcp__read', 'questionnaire', 'codemode', 'tool_search', 'unknown']) {
    for (const parentToolCallId of [undefined, 'parent']) assert.equal(f.hooks.tool_call({ toolName: name, input: { command: 'ls; curl x' }, parentToolCallId }).block, true);
  }
  for (const name of S.PLAN_TOOLS) assert.equal(f.hooks.tool_call({ toolName: name }), undefined);
  assert.equal(f.hooks.user_bash({ command: 'pwd' }).result.exitCode, 1);
});
test('explicit approve requires draft and confirmation; no automatic model turn', async () => {
  const f = fixture(); await f.run('enter'); await f.run('approve');
  assert.equal(f.saved.at(-1).data.mode, 'plan');
  await f.tools.plan_draft.execute('id', { markdown: 'Scope\nSteps\nValidation' }, undefined, undefined, f.ctx);
  f.ctx.ui.confirm = async () => false; await f.run('approve');
  assert.equal(f.saved.at(-1).data.mode, 'plan');
  f.ctx.ui.confirm = async () => true; await f.run('approve');
  assert.equal(f.saved.at(-1).data.mode, 'execute');
  assert.equal(f.hooks.tool_call({ toolName: 'write' }), undefined);
  assert.equal(f.messages.length, 0);
  await f.run('cancel'); assert.equal(f.saved.at(-1).data.mode, 'plan');
  assert.equal(f.saved.at(-1).data.approved.markdown, 'Scope\nSteps\nValidation');
});
test('reload and tree restore branch state, including malformed history fail closed', async () => {
  const f = fixture(); await f.run('enter');
  await f.tools.plan_draft.execute('id', { markdown: 'plan' }, undefined, undefined, f.ctx);
  await f.run('approve');
  const restored = fixture(f.saved);
  await restored.ready;
  assert.equal(restored.hooks.tool_call({ toolName: 'bash' }).block, true);
  assert.equal(restored.statuses.at(-1)[1], 'Plan: review r1');
  restored.ctx.sessionManager.getBranch = () => [];
  await restored.hooks.session_tree({}, restored.ctx);
  assert.equal(restored.hooks.tool_call({ toolName: 'bash' }), undefined);
  assert.equal(S.restore([{ type: 'custom', customType: S.ENTRY, data: {} }]).mode, 'plan');
});
test('headless approval is not inferred but explicit leave works; edits cancel', async () => {
  const f = fixture([], false); await f.run('enter');
  await f.tools.plan_draft.execute('id', { markdown: 'Plan' }, undefined, undefined, f.ctx);
  await f.run('approve'); assert.equal(f.saved.at(-1).data.mode, 'plan');
  await f.run('leave'); assert.equal(f.saved.at(-1).data.mode, 'normal');
  await f.run('enter'); f.ctx.hasUI = true; await f.run('edit'); assert.equal(f.saved.at(-1).data.markdown, 'Plan');
});
test('busy transitions refused and asynchronous approval cannot cross shutdown/revision', async () => {
  const f = fixture(); f.setIdle(false); await f.run('enter'); assert.equal(f.saved.length, 0);
  f.setIdle(true); await f.run('enter');
  await f.tools.plan_draft.execute('id', { markdown: 'Plan' }, undefined, undefined, f.ctx);
  let finish; f.ctx.ui.confirm = () => new Promise(r => { finish = r; });
  const pending = f.run('approve');
  await Promise.resolve(); // Command has entered its asynchronous dialog.
  f.hooks.session_shutdown({}, f.ctx); finish(true); await pending;
  assert.equal(f.saved.at(-1).data.mode, 'plan');
});
test('state event payload is immutable and synchronous entry veto supported', async () => {
  const f = fixture(); let state;
  f.bus.set('plan-mode:state', value => { state = value; });
  f.bus.get('plan-mode:request-state')(); assert.equal(state.mode, 'normal'); assert.ok(Object.isFrozen(state));
  f.bus.set('plan-mode:before-enter', ({ block }) => block('Stop active child first'));
  await f.run('enter'); assert.equal(f.saved.length, 0);
  f.bus.delete('plan-mode:before-enter'); await f.run('enter'); assert.equal(state.mode, 'plan');
});
test('revision during approval invalidates old confirmation', async () => {
  const f = fixture(); await f.run('enter');
  await f.tools.plan_draft.execute('id', { markdown: 'Old' }, undefined, undefined, f.ctx);
  let finish; f.ctx.ui.confirm = () => new Promise(r => { finish = r; });
  const pending = f.run('approve');
  await Promise.resolve(); // Capture approval revision before the draft changes.
  await f.tools.plan_draft.execute('id2', { markdown: 'New' }, undefined, undefined, f.ctx);
  finish(true); await pending;
  assert.equal(f.saved.at(-1).data.mode, 'plan'); assert.equal(f.saved.at(-1).data.markdown, 'New');
});
test('persistence failures and cancelled draft cannot silently unlock', async () => {
  const f = fixture();
  f.pi.appendEntry = () => { throw new Error('disk failure'); };
  await assert.rejects(f.run('enter'), /disk failure/);
  assert.equal(f.hooks.tool_call({ toolName: 'write' }).block, true);
  const signal = AbortSignal.abort();
  await assert.rejects(f.tools.plan_draft.execute('id', { markdown: 'Plan' }, signal, undefined, f.ctx), /cancelled/);
});
test('leave is immediate and retains plan history', async () => {
  const f = fixture(); await f.run('enter');
  await f.tools.plan_draft.execute('id', { markdown: 'Keep' }, undefined, undefined, f.ctx);
  f.ctx.ui.confirm = async () => assert.fail('Leave must not confirm');
  f.ctx.ui.notify = () => assert.fail('Leave must not warn');
  await f.run('leave');
  assert.equal(f.saved.at(-1).data.mode, 'normal'); assert.equal(f.saved.at(-1).data.markdown, 'Keep');
});
test('show preserves plan with triggerTurn false and no editor replacement', async () => {
  const f = fixture(); await f.run('enter'); await f.run('show');
  assert.equal(f.messages[0].options.triggerTurn, false);
  // No editor, loadout or footer replacement API is provided by the fixture.
});
