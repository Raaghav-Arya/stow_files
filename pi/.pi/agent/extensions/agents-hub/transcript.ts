import { readFile } from "node:fs/promises";

export interface TranscriptEntry {
  id: string;
  parentId: string | null;
  type: string;
  timestamp?: string;
  message?: Record<string, any>;
  summary?: string;
  firstKeptEntryId?: string;
  [key: string]: unknown;
}
export interface TranscriptItem {
  id: string;
  role: "user" | "assistant" | "tool" | "system" | "note";
  text: string;
  toolName?: string;
  toolCallId?: string;
  error?: boolean;
  timestamp?: string;
  source: "session" | "live";
}
export interface TranscriptPage { items: TranscriptItem[]; nextBefore?: string; truncated: boolean; artifactPath?: string }

const textContent = (content: unknown): string => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((part: any) => {
    if (part?.type === "text") return String(part.text ?? "");
    if (part?.type === "toolCall") return `Tool call: ${String(part.name ?? "tool")}`;
    if (part?.type === "thinking") return "[thinking omitted]";
    if (part?.type === "image") return "[image omitted]";
    return "";
  }).filter(Boolean).join("\n") : "";

export function parseSessionJsonl(jsonl: string, options: { leafId?: string; limit?: number; before?: string; artifactPath?: string } = {}): TranscriptPage {
  const entries: TranscriptEntry[] = [];
  const lines = jsonl.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    try { const entry = JSON.parse(line); if (entry && typeof entry.id === "string" && typeof entry.parentId !== "undefined") entries.push(entry); }
    catch (error) {
      // Only a non-newline-terminated final append can be incomplete. Any other
      // malformed line is durable corruption and must be surfaced.
      if (i === lines.length - 1 && !jsonl.endsWith("\n") && !jsonl.endsWith("\r")) break;
      throw new Error(`Malformed session JSONL at line ${i + 1}: ${String(error)}`);
    }
  }
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const parents = new Set(entries.map((entry) => entry.parentId).filter((id): id is string => id !== null));
  const leaves = entries.filter((entry) => !parents.has(entry.id));
  if (options.leafId && !byId.has(options.leafId)) throw new Error(`Invalid or stale transcript leaf cursor: ${options.leafId}`);
  let leaf = options.leafId ? byId.get(options.leafId) : undefined;
  if (!leaf) leaf = leaves.at(-1);
  const path: TranscriptEntry[] = [];
  const seen = new Set<string>();
  for (let entry = leaf; entry && !seen.has(entry.id); entry = entry.parentId ? byId.get(entry.parentId) : undefined) {
    path.push(entry); seen.add(entry.id);
  }
  path.reverse();
  // A compaction intentionally replaces the omitted prefix in the rendered transcript.
  let projected = path;
  const compactionIndex = path.map((e) => e.type).lastIndexOf("compaction");
  if (compactionIndex >= 0) {
    const compact = path[compactionIndex];
    const keptId = compact.firstKeptEntryId;
    const keptIndex = keptId ? path.findIndex((e) => e.id === keptId) : -1;
    projected = [compact, ...(keptIndex >= 0 ? path.slice(keptIndex, compactionIndex) : []), ...path.slice(compactionIndex + 1)];
  }
  const items: TranscriptItem[] = [];
  for (const entry of projected) {
    if (entry.type === "message") {
      const message = entry.message ?? {};
      const role = message.role;
      if (role === "user") items.push({ id: entry.id, role: "user", text: textContent(message.content), timestamp: entry.timestamp, source: "session" });
      else if (role === "assistant") {
        const blocks = Array.isArray(message.content) ? message.content : [];
        const text = blocks.filter((block: any) => block?.type === "text").map((block: any) => String(block.text ?? "")).join("\n");
        const calls = blocks.filter((block: any) => block?.type === "toolCall").map((block: any) => `Tool call: ${String(block.name ?? "tool")}`);
        if (text || calls.length) items.push({ id: entry.id, role: "assistant", text: [text, ...calls].filter(Boolean).join("\n"), timestamp: entry.timestamp, source: "session" });
      } else if (role === "toolResult") items.push({ id: entry.id, role: "tool", toolName: message.toolName, toolCallId: message.toolCallId, text: textContent(message.content), error: !!message.isError, timestamp: entry.timestamp, source: "session" });
      else if (role === "bashExecution") items.push({ id: entry.id, role: "tool", toolName: "bash", text: `${message.command ?? ""}\n${message.output ?? ""}`, error: message.exitCode !== 0, timestamp: entry.timestamp, source: "session" });
    } else if (entry.type === "compaction") items.push({ id: entry.id, role: "note", text: `[Earlier conversation compacted]\n${String(entry.summary ?? "")}`, timestamp: entry.timestamp, source: "session" });
    else if (entry.type === "branch_summary") items.push({ id: entry.id, role: "note", text: `[Branch summary]\n${String(entry.summary ?? "")}`, timestamp: entry.timestamp, source: "session" });
    else if (entry.type === "custom_message" && entry.content) items.push({ id: entry.id, role: "note", text: textContent(entry.content), timestamp: entry.timestamp, source: "session" });
  }
  const live = options.before ? [] : [];
  void live;
  const beforeIndex = options.before ? items.findIndex((item) => item.id === options.before) : -1;
  const end = beforeIndex >= 0 ? beforeIndex : items.length;
  const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
  const start = Math.max(0, end - limit);
  return { items: items.slice(start, end), nextBefore: start > 0 ? items[start].id : undefined, truncated: start > 0, artifactPath: options.artifactPath };
}

/** Read the active persisted branch. Live runtime message IDs are not assumed to be session entry IDs. */
export async function loadTranscript(options: { sessionFile: string; leafId?: string; limit?: number; live?: readonly TranscriptItem[] }): Promise<TranscriptPage> {
  const jsonl = await readFile(options.sessionFile, "utf8");
  const page = parseSessionJsonl(jsonl, { leafId: options.leafId, limit: options.limit, artifactPath: options.sessionFile });
  // Do not merge provisional live events here: RPC message_end may precede
  // persistence and does not carry the session entry ID/branch identity. The
  // adapter should refresh from authoritative entries at open/settlement.
  void options.live;
  return page;
}

export function appendLiveTranscript(current: readonly TranscriptItem[], event: TranscriptItem, limit = 500): TranscriptItem[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  merged.set(event.id, event);
  return [...merged.values()].slice(-Math.max(1, limit));
}
