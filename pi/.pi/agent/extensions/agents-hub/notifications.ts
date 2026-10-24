import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { plain } from "./view.ts";

export interface ReportDetails { agentId: string; agentName?: string; kind: "mail" | "settled" | "error" }

/** Compact transcript presentation; the model-facing report is not rewritten. */
export const renderAgentReport: MessageRenderer<ReportDetails> = (message, options, theme) => {
  const details = message.details;
  const name = plain(details?.agentName || `Agent ${details?.agentId?.slice(0, 8) || "report"}`).replace(/\n/g, " ");
  const kind = details?.kind;
  const color = kind === "error" ? "error" : kind === "settled" ? "success" : "accent";
  const title = kind === "settled" ? "Result available" : kind === "error" ? "Failed" : "New message";
  const header = theme.fg(color, "● ") + theme.bold(name) + theme.fg("muted", ` · ${title}`);
  const content = typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  if (options.expanded) return new Text(header + "\n" + plain(content), 0, 0);
  const preview = kind === "settled" ? "Alt+A to inspect the result" : "Alt+A to read and reply";
  const body = plain(content).split("\n");
  const snippet = kind !== "settled" && body[0]?.startsWith("[Subagent report") && body[1]?.trim()
    ? "\n" + theme.fg("muted", truncateToWidth(body[1], 110)) : "";
  return new Text(header + snippet + "\n" + theme.fg("dim", truncateToWidth(preview + " · Ctrl+O expands report", 100)), 0, 0);
};
