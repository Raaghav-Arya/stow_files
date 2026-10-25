export const ENTRY = "local-plan-mode-v1";
export const MAX_PLAN = 64 * 1024;
export type Mode = "normal" | "plan" | "execute";
export interface PlanState {
  version: 1;
  mode: Mode;
  markdown: string;
  revision: number;
  /** Relative to the extension-owned plans directory; retained across forks. */
  planFile?: string;
  approved?: { markdown: string; revision: number };
}
export const initial = (): PlanState => ({ version: 1, mode: "normal", markdown: "", revision: 0 });
export const TEMPLATE = `# Implementation plan

## Scope

## Affected components

## Ordered steps
1.

## Risks and open questions

## Dependencies

## Validation criteria
`;
export function draft(state: PlanState, markdown: string): PlanState {
  if (state.mode !== "plan") throw new Error("Enter plan mode before revising a plan.");
  if (!markdown.trim() || markdown.length > MAX_PLAN) throw new Error("Plan must be nonempty and at most 65536 characters.");
  return { ...state, markdown, revision: state.revision + 1 };
}
export function approve(state: PlanState): PlanState {
  if (state.mode !== "plan" || !state.markdown.trim()) throw new Error("A nonempty plan in plan mode is required.");
  return { ...state, mode: "execute", approved: { markdown: state.markdown, revision: state.revision } };
}
export function restore(branch: readonly any[]): PlanState {
  const entry = [...branch].reverse().find(e => e.type === "custom" && e.customType === ENTRY);
  if (!entry) return initial();
  const data = entry.data;
  // Malformed history never restores unrestricted execution.
  if (!data || data.version !== 1 || !["normal", "plan", "execute"].includes(data.mode) ||
      typeof data.markdown !== "string" || data.markdown.length > MAX_PLAN ||
      !Number.isSafeInteger(data.revision) || data.revision < 0) return { ...initial(), mode: "plan" };
  const state: PlanState = { version: 1, mode: data.mode === "normal" ? "normal" : "plan", markdown: data.markdown, revision: data.revision };
  if (typeof data.planFile === "string" && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.md$/.test(data.planFile)) state.planFile = data.planFile;
  else if (data.planFile !== undefined) return { ...initial(), mode: "plan" };
  if (data.approved && typeof data.approved.markdown === "string" && data.approved.markdown.length <= MAX_PLAN &&
      Number.isSafeInteger(data.approved.revision) && data.approved.revision >= 0) state.approved = { ...data.approved };
  return state;
}
export const PLAN_TOOLS = new Set(["read", "grep", "find", "ls", "ask_user", "plan_draft"]);
export function blocked(state: PlanState, toolName: string): boolean {
  return state.mode === "plan" && !PLAN_TOOLS.has(toolName);
}
export function snapshot(state: PlanState) {
  return Object.freeze({ version: 1 as const, mode: state.mode, hasPlan: !!state.markdown.trim(), revision: state.revision });
}
