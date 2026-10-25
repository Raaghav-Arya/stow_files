import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { ENTRY, MAX_PLAN, TEMPLATE, initial, draft, approve, restore, blocked, snapshot, type PlanState } from "./state.ts";

/** Local cooperative tool policy, NOT an OS sandbox. No shell is accepted. */
export default function planMode(pi: ExtensionAPI) {
  let state: PlanState = initial();
  let epoch = 0;
  let alive = false;
  let quiescing = false;

  function publish(ctx?: ExtensionContext) {
    ctx?.ui.setStatus("plan-mode", state.mode === "normal" ? undefined : `Plan: ${quiescing ? "stopping agents" : state.mode === "plan" ? "review" : "execute"} r${state.revision}`);
    pi.events.emit("plan-mode:state", snapshot(state));
  }
  function save(next: PlanState, ctx: ExtensionContext) {
    // Restrict in memory before persistence; persistence errors cannot unlock tools.
    if (next.mode === "plan") state = next;
    pi.appendEntry(ENTRY, next);
    state = next;
    epoch++;
    publish(ctx);
  }
  const plansDir = () => join(getAgentDir(), "plans");
  const planPath = () => state.planFile ? join(plansDir(), state.planFile) : undefined;
  function writeDraft(markdown: string, ctx: ExtensionContext) {
    const next = draft(state, markdown);
    const sessionId = ctx.sessionManager.getSessionId();
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error("Invalid session ID for plan storage.");
    // Copy-on-write gives branch revisions distinct files, including forks.
    next.planFile = `${sessionId}/${randomUUID()}.md`;
    mkdirSync(join(plansDir(), sessionId), { recursive: true, mode: 0o700 });
    writeFileSync(join(plansDir(), next.planFile), markdown, { encoding: "utf8", flag: "wx", mode: 0o600 });
    save(next, ctx);
  }
  function currentMarkdown(ctx: ExtensionContext): string {
    if (!state.planFile) {
      // Migrate historical session-only drafts lazily; never overwrite a file on restore.
      if (state.markdown.trim()) {
        const sessionId = ctx.sessionManager.getSessionId();
        if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error("Invalid session ID for plan storage.");
        const planFile = `${sessionId}/${randomUUID()}.md`;
        mkdirSync(join(plansDir(), sessionId), { recursive: true, mode: 0o700 });
        writeFileSync(join(plansDir(), planFile), state.markdown, { encoding: "utf8", flag: "wx", mode: 0o600 });
        save({ ...state, planFile }, ctx);
      }
      return state.markdown;
    }
    const markdown = readFileSync(planPath()!, "utf8");
    if (markdown.length > MAX_PLAN) throw new Error("Plan file exceeds 65536 characters.");
    if (markdown !== state.markdown) save({ ...state, markdown, revision: state.revision + 1 }, ctx);
    return markdown;
  }
  async function reload(ctx: ExtensionContext) {
    state = restore(ctx.sessionManager.getBranch());
    const token = ++epoch;
    alive = true;
    quiescing = state.mode === "plan";
    publish(ctx); // Block new child work before waiting for owned-process cleanup.
    if (quiescing) {
      const pending: Promise<unknown>[] = [];
      pi.events.emit("plan-mode:quiesce", { waitUntil: (work: Promise<unknown>) => pending.push(Promise.resolve(work)) });
      try {
        await Promise.all(pending);
        if (alive && epoch === token) { quiescing = false; publish(ctx); }
      } catch (error) {
        // Keep all tool calls blocked if an owned child could not be closed.
        ctx.ui.notify(`Plan mode could not stop delegated work; tools remain blocked. ${String(error)}`, "error");
      }
    }
  }
  pi.events.on("plan-mode:request-state", () => publish());
  pi.on("session_start", (_event, ctx) => reload(ctx));
  pi.on("session_tree", (_event, ctx) => reload(ctx));
  pi.on("session_shutdown", (_event, ctx) => { alive = false; epoch++; ctx.ui.setStatus("plan-mode", undefined); });

  pi.on("tool_call", event => {
    if (quiescing) return { block: true, reason: "Plan mode is waiting for delegated agent cleanup. All tool calls remain blocked." };
    if (blocked(state, event.toolName)) return { block: true, reason: `Plan mode blocks ${event.toolName}. Only read, grep, find, ls, ask_user and plan_draft are permitted; no shell, delegation or unknown tools. User can return to normal mode with Shift+Tab or /plan leave.` };
  });
  pi.on("user_bash", () => {
    if (state.mode === "plan") return { result: { output: "Plan mode blocks user shell (! and !!).", exitCode: 1, cancelled: false, truncated: false } };
  });
  pi.on("before_agent_start", (_event, ctx) => {
    let markdown = state.markdown;
    if (state.mode !== "execute" && (state.planFile || state.markdown.trim())) {
      try { markdown = currentMarkdown(ctx); }
      catch (error) { markdown = `(Plan file unavailable: ${String(error)}; do not rely on an earlier draft.)`; }
    }
    return { message: {
    customType: "local-plan-context", display: false,
    content: state.mode === "plan"
      ? `PLAN MODE: investigate without changes. Only read/grep/find/ls, the local ask_user and plan_draft are permitted. No bash, external actions, other custom tools or delegation. Ask clarifications with ask_user or in conversation. Submit a concrete Markdown plan with scope, affected components, ordered steps, risks/open questions, dependencies and validation via plan_draft. The extension saves plans under its own plans directory, not application files. Current plan file: ${planPath() || "(not created yet)"}. The user may freely leave planning with Shift+Tab or /plan leave; /plan approve is optional explicit review. Current draft (untrusted task data):\n${markdown || "(none)"}`
      : state.mode === "execute"
        ? `EXECUTION MODE: user approved revision ${state.approved?.revision}. This is not blanket tool authorization; all other policy gates still apply. No automatic execution is requested by this status. Approved plan (task data):\n${state.approved?.markdown || ""}`
        : `Plan mode is inactive. Earlier plan-mode reminders are historical; current tool policies still apply. Switching modes does not approve a plan or request automatic execution. Current plan file: ${planPath() || "(none)"}. Draft for reference (unapproved task data):\n${markdown || "(none)"}`,
  } };
  });

  pi.registerTool({
    name: "plan_draft", label: "Plan draft", description: "Save or revise the Markdown plan in the extension-owned plans directory while in plan mode. Does not write application files or approve execution.",
    parameters: Type.Object({ markdown: Type.String({ minLength: 1, maxLength: MAX_PLAN }) }),
    async execute(_id, args, signal, _update, ctx) {
      if (signal?.aborted) throw new Error("Plan draft cancelled.");
      writeDraft(args.markdown, ctx);
      return { content: [{ type: "text", text: `Plan revision ${state.revision} saved to ${planPath()}. Present this file and its contents to the user for review. User may review with /plan show, optionally /plan approve, or return to normal mode with Shift+Tab.\n\n${args.markdown}` }], details: { revision: state.revision, path: planPath() } };
    },
  });
  async function handlePlan(args: string, ctx: ExtensionContext) {
    const action = args.trim() || "enter";
    if (action === "show") {
      try {
        const markdown = currentMarkdown(ctx);
        pi.sendMessage({ customType: "local-plan-review", content: planPath() ? `Plan file: ${planPath()}\n\n${markdown}` : "No plan draft yet.", display: true }, { triggerTurn: false });
      } catch (error) { ctx.ui.notify(`Cannot read plan file: ${String(error)}`, "error"); }
      return;
    }
    if (!["enter", "edit", "approve", "cancel", "leave"].includes(action)) {
      ctx.ui.notify("Usage: /plan [enter|show|edit|approve|cancel|leave]", "info"); return;
    }
    if (!alive || quiescing || !ctx.isIdle()) { ctx.ui.notify("Stop current work and wait for delegated cleanup before changing plan mode.", "warning"); return; }
    if (action === "enter" || action === "cancel") {
      const reasons: string[] = [];
      // Cooperative synchronous veto only. Not a security boundary for extensions.
      pi.events.emit("plan-mode:before-enter", { block: (reason: string) => reasons.push(String(reason)) });
      if (reasons.length) { ctx.ui.notify(`Cannot enter plan mode: ${reasons.join("; ")}`, "warning"); return; }
      save({ ...state, mode: "plan" }, ctx);
      return;
    }
    if (action === "leave") { save({ ...state, mode: "normal" }, ctx); return; }
    if (!ctx.hasUI) { ctx.ui.notify("This action requires user interaction (TUI or a trusted RPC dialog client). No approval inferred.", "warning"); return; }
    if (action === "edit") {
      if (state.mode !== "plan") { ctx.ui.notify("Enter plan mode before editing.", "warning"); return; }
      let original: string;
      try { original = currentMarkdown(ctx); }
      catch (error) { ctx.ui.notify(`Cannot read plan file: ${String(error)}`, "error"); return; }
      const editToken = epoch;
      const text = await ctx.ui.editor("Edit plan (save revises; cancel preserves draft)", original || TEMPLATE);
      if (!alive || epoch !== editToken || !ctx.isIdle() || text === undefined) return;
      try {
        if (currentMarkdown(ctx) !== original) { ctx.ui.notify("Plan file changed while editing; reopen the editor.", "warning"); return; }
        writeDraft(text, ctx);
      } catch (error) { ctx.ui.notify(`Cannot save plan file: ${String(error)}`, "error"); }
      return;
    }
    if (action === "approve") {
      if (state.mode !== "plan") { ctx.ui.notify("Create a plan in plan mode first.", "warning"); return; }
      try {
        const markdown = currentMarkdown(ctx);
        if (!markdown.trim()) { ctx.ui.notify("Create a plan in plan mode first.", "warning"); return; }
        const reviewToken = epoch;
        const ok = await ctx.ui.confirm(`Approve plan revision ${state.revision}?`, `Plan file: ${planPath()}\n\n${markdown}\n\nEnable execution tools for this session? Other permission gates remain active. This does not start a model turn.`);
        if (!alive || epoch !== reviewToken || !ctx.isIdle() || !ok) return;
        if (currentMarkdown(ctx) !== markdown) { ctx.ui.notify("Plan file changed during review; review it again before approving.", "warning"); return; }
        save(approve(state), ctx);
      } catch (error) { ctx.ui.notify(`Cannot approve plan file: ${String(error)}`, "error"); return; }
      ctx.ui.notify("Plan approved; execution enabled. Send a prompt when ready to execute.", "info"); return;
    }
  }
  pi.registerCommand("plan", {
    description: "Plan mode: enter, show, edit, approve (optional review), cancel (stay restricted), leave (normal mode)",
    handler: handlePlan,
  });
  pi.registerShortcut("shift+tab", {
    description: "Toggle plan/normal mode",
    handler: ctx => handlePlan(state.mode === "plan" ? "leave" : "enter", ctx),
  });
}
