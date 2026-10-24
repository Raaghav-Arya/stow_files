/** Tool selection is independent of workspace selection. No role/workflow inference. */
export const defaultTools = ["read", "grep", "find", "ls"];
export const builtinTools = [...defaultTools, "bash", "powershell", "edit", "write"];
export function validateTools(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((t) => typeof t !== "string" || !builtinTools.includes(t))) {
    throw new Error(`tools must be a list of: ${builtinTools.join(", ")}`);
  }
  return [...new Set(value as string[])];
}
