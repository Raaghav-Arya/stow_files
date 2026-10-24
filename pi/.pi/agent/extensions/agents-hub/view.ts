import { stripVTControlCharacters } from "node:util";
import type { KeybindingsManager, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, Markdown, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type MarkdownTheme, type OverlayOptions, type TUI } from "@earendil-works/pi-tui";
import type { ActivityEntry } from "./activity.ts";
import type { AgentManager, AgentRecord, AgentState } from "./manager.ts";

export type HubAction = { type: "close" | "new" | "message" | "follow-up" | "stop"; id?: string };
export type HubTheme = Pick<Theme, "fg" | "bg" | "bold" | "italic" | "underline" | "strikethrough">;
// Sanitize source before applying our own styles or parsing Markdown.
export const plain = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").replace(/\t/g, "  ");
const oneLine = (text: string) => plain(text).replace(/[\n\u2028\u2029]/g, " ");
const count = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const connected = (agent: AgentRecord) => agent.state !== "failed" && agent.state !== "stopped";
const states: Record<AgentState, { icon: string; label: string; color: ThemeColor }> = {
  starting: { icon: "◌", label: "STARTING", color: "warning" },
  running: { icon: "●", label: "RUNNING", color: "accent" },
  idle: { icon: "✓", label: "IDLE", color: "success" },
  failed: { icon: "×", label: "FAILED", color: "error" },
  stopped: { icon: "○", label: "STOPPED", color: "muted" },
};

export function hubOverlayOptions(tui: Pick<TUI, "mode">): OverlayOptions {
  return tui.mode === "fullscreen"
    ? { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 }
    : { anchor: "center", width: "95%", maxHeight: "80%", margin: 0 };
}

/** Presentation only: roster + activity inspector, no execution/workspace policy. */
export class HubView {
  private selected = 0;
  private offset = 0;
  private pausedEntries?: ActivityEntry[];
  private pausedRaw?: string;
  private lastContentWidth = 70;
  private outputHeight = 1;
  private details = false;
  private detailRows: string[] = [];
  private detailScroll = 0;
  private expandedTools = false;
  private unsubscribe: () => void;
  private markdown: MarkdownTheme;
  private markdownCache = new WeakMap<ActivityEntry, { text: string; width: number; lines: string[] }>();

  constructor(private manager: AgentManager, private tui: TUI, private theme: HubTheme,
    private keys: Pick<KeybindingsManager, "matches">,
    private done: (action: HubAction) => void, initialId?: string) {
    const index = [...manager.agents.keys()].indexOf(initialId || "");
    if (index >= 0) this.selected = index;
    this.unsubscribe = manager.subscribe(() => tui.requestRender());
    const fg = (color: ThemeColor) => (text: string) => theme.fg(color, text);
    this.markdown = {
      heading: (text) => theme.bold(theme.fg("mdHeading", text)),
      link: fg("accent"), linkUrl: fg("muted"), code: fg("mdCode"),
      codeBlock: fg("toolOutput"), codeBlockBorder: fg("borderMuted"),
      quote: fg("muted"), quoteBorder: fg("borderMuted"), hr: fg("borderMuted"),
      listBullet: fg("accent"), bold: (text) => theme.bold(text),
      italic: (text) => theme.italic(text), underline: (text) => theme.underline(text),
      strikethrough: (text) => theme.strikethrough(text),
    };
  }
  dispose() { this.unsubscribe(); }
  invalidate() { this.markdownCache = new WeakMap(); }
  private resume() { this.offset = 0; this.detailScroll = 0; this.pausedEntries = undefined; this.pausedRaw = undefined; }
  handleInput(data: string) {
    if (isKeyRelease(data)) return;
    const agents = [...this.manager.agents.values()];
    const agent = agents[this.selected];
    if (matchesKey(data, "alt+a") || this.keys.matches(data, "tui.select.cancel")) this.done({ type: "close" });
    else if (data === "n") this.done({ type: "new" });
    else if (this.keys.matches(data, "tui.select.up") || data === "k") { this.selected = Math.max(0, this.selected - 1); this.resume(); }
    else if (this.keys.matches(data, "tui.select.down") || data === "j") { this.selected = Math.min(Math.max(0, agents.length - 1), this.selected + 1); this.resume(); }
    else if (matchesKey(data, "tab")) { this.details = !this.details; this.resume(); }
    else if (data === "o") { this.expandedTools = !this.expandedTools; this.resume(); }
    else if ((this.keys.matches(data, "tui.select.pageUp") || matchesKey(data, "pageUp")) && agent) {
      if (this.details) this.detailScroll = Math.max(0, this.detailScroll - Math.max(1, this.outputHeight - 1));
      else {
        if (this.pausedEntries === undefined) {
          this.pausedEntries = (agent.activity || []).map((entry) => ({ ...entry }));
          this.pausedRaw = agent.output;
        }
        const length = this.activityLines(agent, this.lastContentWidth).length;
        this.offset = Math.min(Math.max(0, length - this.outputHeight), this.offset + Math.max(1, this.outputHeight - 1));
        if (!this.offset) this.resume();
      }
    } else if (this.keys.matches(data, "tui.select.pageDown") || matchesKey(data, "pageDown")) {
      if (this.details) this.detailScroll = Math.min(Math.max(0, this.detailRows.length - this.outputHeight), this.detailScroll + Math.max(1, this.outputHeight - 1));
      else { this.offset = Math.max(0, this.offset - Math.max(1, this.outputHeight - 1)); if (!this.offset) this.resume(); }
    } else if (matchesKey(data, "end") || matchesKey(data, "ctrl+end")) {
      if (this.details) this.detailScroll = Math.max(0, this.detailRows.length - this.outputHeight);
      else this.resume();
    }
    else if (agent && connected(agent) && (data === "m" || this.keys.matches(data, "tui.select.confirm"))) this.done({ type: "message", id: agent.id });
    else if (agent && connected(agent) && data === "f") this.done({ type: "follow-up", id: agent.id });
    else if (agent && connected(agent) && data === "x") this.done({ type: "stop", id: agent.id });
    this.tui.requestRender();
  }
  private fit(text: string, width: number): string {
    const clipped = truncateToWidth(text, Math.max(0, width), "…");
    return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  }
  private spread(left: string, right: string, width: number): string {
    const rightWidth = visibleWidth(right);
    if (rightWidth + 2 >= width) return this.fit(left, width);
    return this.fit(left, width - rightWidth - 1) + " " + right;
  }
  private badge(agent: AgentRecord): string {
    const status = states[agent.state];
    const label = agent.state === "stopped" && agent.transport && !agent.transportClosed ? "STOPPING" : status.label;
    return this.theme.fg(status.color, `${status.icon} ${label}`);
  }
  private rawLines(text: string, width: number): string[] {
    return plain(text).split("\n").flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width)));
  }
  private assistantLines(entry: ActivityEntry, width: number): string[] {
    const text = plain(entry.text);
    const cached = this.markdownCache.get(entry);
    if (cached?.text === text && cached.width === width) return cached.lines;
    let lines: string[];
    try {
      lines = new Markdown(text, 0, 0, this.markdown, undefined,
        { preserveOrderedListMarkers: true, preserveBackslashEscapes: true }).render(width);
    } catch { lines = this.rawLines(text, width); }
    this.markdownCache.set(entry, { text, width, lines });
    return lines;
  }
  private activityLines(agent: AgentRecord, width: number): string[] {
    const entries = this.pausedEntries ?? agent.activity ?? [];
    if (!entries.length) return this.rawLines(this.pausedRaw ?? agent.output, width);
    const lines: string[] = [];
    const fg = (color: ThemeColor, text: string) => this.theme.fg(color, text);
    for (const entry of entries) {
      if (entry.kind === "assistant") {
        if (!entry.text) continue;
        lines.push(fg("accent", "Assistant"), ...this.assistantLines(entry, width), "");
      } else if (entry.kind === "tool") {
        const icon = entry.state === "running" ? "◌" : entry.state === "error" ? "×" : "✓";
        const color = entry.state === "error" ? "error" : entry.state === "running" ? "warning" : "muted";
        lines.push(fg(color, `${icon} ${oneLine(entry.label || "tool")}`) + " " + fg("dim", oneLine(entry.text)));
        if ((this.expandedTools || entry.state === "error") && entry.result) {
          const result = this.rawLines(entry.result, Math.max(1, width - 2));
          lines.push(...result.slice(0, 6).map((line) => "  " + fg(entry.state === "error" ? "error" : "dim", line)));
          if (result.length > 6) lines.push(fg("dim", "  … full result in event log"));
        }
      } else if (entry.kind === "message" || entry.kind === "mail") {
        lines.push(fg("customMessageLabel", entry.label || "Message"));
        lines.push(...this.rawLines(entry.text, width).map((line) => fg("muted", line)), "");
      } else lines.push(fg(entry.kind === "error" ? "error" : "dim", oneLine(entry.text)));
    }
    return lines.map((line) => truncateToWidth(line, width, "…"));
  }
  private roster(agents: AgentRecord[], width: number, height: number, compact: boolean): string[] {
    const lines = [this.theme.fg("muted", ` AGENTS  ${agents.length}`)];
    if (!agents.length) return [...lines, "", this.theme.fg("dim", " No agents yet")];
    const stride = compact ? 1 : 3;
    const slots = Math.max(1, Math.floor((height - 2) / stride));
    const start = Math.max(0, this.selected - slots + 1);
    for (let i = start; i < Math.min(agents.length, start + slots); i++) {
      const agent = agents[i];
      const selected = i === this.selected;
      const status = states[agent.state];
      const name = oneLine(agent.name || agent.id.slice(0, 8));
      const title = `${selected ? "▸" : " "} ${this.theme.fg(status.color, status.icon)} ${selected ? this.theme.bold(name) : this.theme.fg("text", name)}`;
      const rows = compact
        ? [this.spread(title, this.theme.fg(status.color, status.label), width)]
        : [this.spread(title, this.theme.fg(status.color, status.label), width),
          this.theme.fg("muted", `    ${oneLine(agent.task)}`),
          this.theme.fg("dim", `    ${count(agent.tokens)} · ${agent.turns}t · ${agent.id.slice(0, 8)}`)];
      lines.push(...rows.map((row) => selected ? this.theme.bg("selectedBg", this.fit(row, width)) : this.fit(row, width)));
    }
    const hidden = agents.length - Math.min(agents.length, start + slots);
    if (start || hidden) lines.push(this.theme.fg("dim", ` ${start ? `↑ ${start} earlier` : ""}${start && hidden ? " · " : ""}${hidden ? `↓ ${hidden} more` : ""}`));
    return lines.slice(0, height);
  }
  private inspector(agent: AgentRecord | undefined, width: number, height: number): string[] {
    const fg = (color: ThemeColor, text: string) => this.theme.fg(color, text);
    if (!agent) {
      const heading = this.theme.bold(fg("accent", "Your agents, in one place"));
      return ["", heading, "", ...this.rawLines("Launch an agent to inspect its conversation, follow tool activity and send messages without leaving your main session.", width).map((line) => fg("muted", line)), "", fg("accent", "Press n to launch"), fg("dim", "The caller chooses tools and working directory.")].slice(0, height);
    }
    const lines = [this.spread(this.theme.bold(oneLine(agent.name || agent.id.slice(0, 8))), this.badge(agent), width)];
    if (height > 3) lines.push(fg("accent", oneLine(`${agent.provider}/${agent.model}`)));
    if (this.details) {
      const fields: Array<[string, string]> = [
        ["ID", agent.id], ["Thinking", agent.thinking], ["Tools", [...(agent.tools || []), "message_parent"].join(", ") ],
        ["Directory", agent.workspace], ["Event log", agent.log], ["Session", agent.sessionFile || "not yet created"], ["Task", agent.task],
      ];
      this.detailRows = fields.flatMap(([label, value]) => [fg("muted", label), ...this.rawLines(value, width)]);
      if (agent.error) this.detailRows.push(fg("error", "Error"), ...this.rawLines(agent.error, width).map((line) => fg("error", line)));
      this.outputHeight = Math.max(1, height - lines.length);
      this.detailScroll = Math.min(this.detailScroll, Math.max(0, this.detailRows.length - this.outputHeight));
      lines.push(...this.detailRows.slice(this.detailScroll, this.detailScroll + this.outputHeight));
      return lines.slice(0, height);
    }
    if (height >= 9) {
      lines.push(fg("dim", `${agent.thinking} thinking · ${count(agent.tokens)} tokens · ${agent.turns} turns · ~$${agent.cost.toFixed(4)} est.`));
      lines.push(fg("muted", "Task  ") + oneLine(agent.task));
    }
    if (height >= 12) lines.push(fg("muted", "Cwd   ") + fg("dim", oneLine(agent.workspace)));
    if (agent.error && height >= 7) lines.push(fg("error", "Error  " + oneLine(agent.error)));
    const follow = this.pausedEntries !== undefined ? fg("warning", "PAUSED · End resumes") : fg("success", "LIVE");
    lines.push(this.spread(fg("muted", this.expandedTools ? "─ Activity · tools expanded" : "─ Activity (recent)"), follow, width));
    const available = Math.max(0, height - lines.length);
    this.outputHeight = Math.max(1, available);
    this.lastContentWidth = width;
    const output = this.activityLines(agent, width);
    this.offset = Math.min(this.offset, Math.max(0, output.length - available));
    const end = Math.max(0, output.length - this.offset);
    const visible = output.slice(Math.max(0, end - available), end);
    if (!visible.length && available) visible.push(fg("dim", agent.state === "starting" ? "Connecting to agent…" : "Waiting for activity…"));
    lines.push(...visible);
    return lines.slice(0, height);
  }
  render(width: number): string[] {
    width = Math.max(1, width);
    const rows = Math.max(1, this.tui.terminal.rows);
    const height = this.tui.mode === "regular" ? Math.max(1, Math.floor(rows * 0.8)) : rows;
    const agents = [...this.manager.agents.values()];
    this.selected = Math.min(this.selected, Math.max(0, agents.length - 1));
    const agent = agents[this.selected];
    if (width < 16 || height < 8) {
      return [this.theme.fg("accent", "Agents Hub"), ...(agent ? [oneLine(agent.name || agent.id), this.badge(agent)] : ["n: launch"]), "Esc: close"]
        .slice(0, height).map((line) => truncateToWidth(line, width, ""));
    }
    const inner = width - 2;
    const border = (text: string) => this.theme.fg("borderMuted", text);
    const row = (text: string) => border("│") + this.fit(text, inner) + border("│");
    const key = (binding: string, action: string) => this.theme.fg("accent", binding) + this.theme.fg("muted", " " + action);
    const active = agents.filter((a) => a.state === "running" || a.state === "starting").length;
    const idle = agents.filter((a) => a.state === "idle").length;
    const failed = agents.filter((a) => a.state === "failed").length;
    const summary = [this.theme.fg("accent", `${active} active`), this.theme.fg("success", `${idle} idle`), this.theme.fg(failed ? "error" : "dim", `${failed} failed`)].join(this.theme.fg("dim", "  ·  "));
    const lines = [border("╭" + "─".repeat(inner) + "╮"),
      row(this.spread(" " + this.theme.bold(this.theme.fg("accent", "Agents Hub")), this.theme.fg("dim", "Alt+A / Esc close "), inner)),
      row(" " + summary), border("├" + "─".repeat(inner) + "┤")];
    const bodyHeight = height - 7;
    if (width >= 100 && height >= 14) {
      const leftWidth = Math.min(38, Math.max(28, Math.floor(inner * 0.3)));
      const rightWidth = inner - leftWidth - 1;
      const roster = this.roster(agents, leftWidth - 2, bodyHeight, false);
      const detail = this.inspector(agent, rightWidth - 2, bodyHeight);
      for (let i = 0; i < bodyHeight; i++) lines.push(row(" " + this.fit(roster[i] || "", leftWidth - 2) + " " + border("│") + " " + this.fit(detail[i] || "", rightWidth - 2) + " "));
    } else {
      const listRows = Math.min(3, Math.max(1, bodyHeight - 7));
      const rosterHeight = agents.length && bodyHeight >= 5 ? Math.min(agents.length, listRows) + 1 : 0;
      const roster = rosterHeight ? this.roster(agents, inner - 2, rosterHeight + 1, true).slice(0, rosterHeight) : [];
      for (const line of roster) lines.push(row(" " + line));
      if (roster.length) lines.push(row(border("─".repeat(inner))));
      const detailHeight = Math.max(0, bodyHeight - roster.length - (roster.length ? 1 : 0));
      const detail = this.inspector(agent, inner - 2, detailHeight);
      for (let i = 0; i < detailHeight; i++) lines.push(row(" " + (detail[i] || "")));
    }
    lines.push(border("├" + "─".repeat(inner) + "┤"));
    const candidates = [key("n", "new"), key("↑↓", "select")];
    if (agent && connected(agent)) candidates.push(key("m", "send"), key("x", "stop"));
    if (agent) candidates.push(key("Tab", this.details ? "activity" : "info"));
    if (agent && connected(agent)) candidates.push(key("f", "follow"));
    if (agent) candidates.push(key("Pg", "scroll"), key("o", "tools"));
    const actions: string[] = [];
    for (const action of candidates) {
      if (visibleWidth([...actions, action].join(" · ")) <= inner - 2) actions.push(action);
    }
    lines.push(row(" " + actions.join(this.theme.fg("dim", " · "))));
    lines.push(border("╰" + "─".repeat(inner) + "╯"));
    return lines.slice(0, height).map((line) => truncateToWidth(line, width, ""));
  }
}
