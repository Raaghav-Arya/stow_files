/** Bounded presentation projection; the JSONL log remains the authoritative event record. */
export interface ActivityEntry {
  kind: "message" | "assistant" | "tool" | "mail" | "status" | "error";
  label?: string;
  text: string;
  toolCallId?: string;
  state?: "running" | "done" | "error";
  result?: string;
}

export function toolPreview(name: string, args: Record<string, unknown> = {}): string {
  const path = String(args.path ?? args.file_path ?? "");
  if (name === "bash" || name === "powershell") return String(args.command ?? "").slice(0, 800);
  if (name === "read" || name === "write" || name === "edit") return path;
  if (name === "grep" || name === "find") return [args.pattern, path].filter(Boolean).join(" in ");
  if (name === "ls") return path || ".";
  if (name === "message_parent") return String(args.message ?? "").slice(0, 200);
  return JSON.stringify(args).slice(0, 400);
}

export function resultPreview(result: { content?: Array<{ type: string; text?: string }> } | undefined): string {
  return (result?.content || []).map((part) => part.type === "text" ? part.text || "" : `[${part.type}]`).join("\n").slice(0, 2000);
}
