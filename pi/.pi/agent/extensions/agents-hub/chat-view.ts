import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, type KeybindingsManager, isKeyRelease, matchesKey, Markdown, type MarkdownTheme, ScrollView, type TUI, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { TranscriptItem } from "./transcript.ts";

export interface ChatAgent { id: string; name: string; parentId?: string; depth?: number; provider: string; model: string; thinking?: string; cwd?: string; state: string; turns?: number; maxTurns?: number }
export interface ChatDraftState { draft: string; history: string[] }
export interface TranscriptStore { get(agentId: string): readonly TranscriptItem[]; subscribe?(agentId: string, listener: () => void): () => void }
export interface ChatViewController {
  state: ChatDraftState;
  send(agentId: string, message: string, followUp: boolean): void | Promise<void>;
  interrupt(agentId: string): void | Promise<void>;
  close(agentId: string): void | Promise<void>;
  resume(agentId: string): void | Promise<void>;
  back(destination?: "main" | "roster"): void;
  confirmClose?(agentId: string): boolean | Promise<boolean>;
}
export interface ChatViewOptions { agent: ChatAgent; tui: TUI; theme: Theme; keys: Pick<KeybindingsManager,"matches">; transcript: TranscriptStore; controller: ChatViewController; }
const safe = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").replace(/\t/g, "  ");
const editorTheme = (theme: Theme): EditorTheme => ({ borderColor: s => theme.fg("accent", s), selectList: { selectedPrefix: s => theme.fg("accent", s), selectedText: s => theme.fg("accent", s), description: s => theme.fg("muted", s), scrollInfo: s => theme.fg("dim", s), noMatch: s => theme.fg("warning", s) } });

/** Inline agent chat surface. It owns only this overlay; it never replaces Pi's main editor. */
export class ChatView {
  private readonly editor: Editor;
  private readonly scroll: ScrollView;
  private focusedState = false;
  private navMode = false;
  private errorMessage?: string;
  private follow = true;
  private pendingFollowUp = false;
  private disposed = false;
  private unsubscribe?: () => void;
  private markdownTheme: MarkdownTheme;
  constructor(private options: ChatViewOptions) {
    const { tui, theme, agent, controller } = options;
    this.markdownTheme = { heading: s => theme.bold(theme.fg("mdHeading",s)), link: s => theme.fg("accent",s), linkUrl: s => theme.fg("muted",s), code: s => theme.fg("mdCode",s), codeBlock: s => theme.fg("toolOutput",s), codeBlockBorder: s => theme.fg("borderMuted",s), quote: s => theme.fg("muted",s), quoteBorder: s => theme.fg("borderMuted",s), hr: s => theme.fg("borderMuted",s), listBullet: s => theme.fg("accent",s), bold: s => theme.bold(s), italic: s => theme.italic(s), underline: s => theme.underline(s), strikethrough: s => theme.strikethrough(s) };
    this.editor = new Editor(tui, editorTheme(theme));
    this.editor.setText(controller.state.draft);
    for (const entry of controller.state.history) this.editor.addToHistory(entry);
    this.editor.disableSubmit = agent.state === "stopped" || agent.state === "failed";
    this.editor.onChange = text => { controller.state.draft = text; };
    this.editor.onSubmit = text => {
      if (agent.state === "stopped" || agent.state === "failed") return;
      const message = this.editor.getExpandedText().trim();
      if (!message) return;
      controller.state.history.push(message);
      this.editor.addToHistory(message);
      controller.state.draft = "";
      this.editor.setText("");
      this.errorMessage = undefined;
      const followUp = this.pendingFollowUp;
      this.pendingFollowUp = false;
      void Promise.resolve().then(() => controller.send(agent.id, message, followUp)).catch(error => {
        this.errorMessage = String(error instanceof Error ? error.message : error).slice(0, 500);
        if (!controller.state.draft) { controller.state.draft = message; this.editor.setText(message); }
        tui.requestRender();
      });
      tui.requestRender();
    };
    this.scroll = new ScrollView({ render: width => this.transcriptLines(width), invalidate: () => {} }, { follow: "end", scrollbar: tui.mode === "fullscreen" ? "auto" : "hidden" });
    this.unsubscribe = options.transcript.subscribe?.(agent.id, () => tui.requestRender());
  }
  private transcriptLines(width: number): string[] {
    const { theme, transcript, agent } = this.options;
    const items = transcript.get(agent.id);
    if (!items.length) return [theme.fg("dim", "Waiting for transcript…")];
    const output: string[] = [];
    for (const item of items) {
      const role = item.role === "user" ? "You" : item.role === "assistant" ? agent.name : item.role === "tool" ? `Tool · ${item.toolName ?? "output"}` : item.role === "note" ? "Session note" : item.role;
      const color = item.error ? "error" : item.role === "user" ? "customMessageLabel" : item.role === "assistant" ? "accent" : "muted";
      output.push(theme.bold(theme.fg(color, safe(role))));
      const text = safe(item.text);
      if (item.role === "assistant" && text) {
        try { output.push(...new Markdown(text,0,0,this.markdownTheme,undefined,{preserveOrderedListMarkers:true,preserveBackslashEscapes:true}).render(width)); }
        catch { output.push(...wrapTextWithAnsi(text,width)); }
      } else if (text) output.push(...wrapTextWithAnsi(text,width));
      output.push("");
    }
    return output.map(line => truncateToWidth(line,width));
  }
  handleInput(data: string): void {
    if (this.disposed || isKeyRelease(data)) return;
    const { agent, tui, controller, keys } = this.options;
    if (matchesKey(data,"alt+a")) { controller.back("main"); return; }
    if (matchesKey(data,"ctrl+q")) { this.navMode = !this.navMode; tui.requestRender(); return; }
    if (matchesKey(data,"ctrl+x")) { void this.requestClose().catch(error => { this.errorMessage=String(error); tui.requestRender(); }); return; }
    if (matchesKey(data,"ctrl+r") && (agent.state === "stopped" || agent.state === "failed")) { this.resume(); return; }
    if (this.navMode) {
      if (matchesKey(data,"up") || matchesKey(data,"ctrl+p")) { this.scroll.scrollBy(-1); tui.requestRender(); return; }
      if (matchesKey(data,"down") || matchesKey(data,"ctrl+n")) { this.scroll.scrollBy(1); tui.requestRender(); return; }
      if (matchesKey(data,"escape")) { controller.back(); return; }
      if (matchesKey(data,"enter")) { this.navMode=false; this.focused=true; tui.requestRender(); return; }
      return;
    }
    if (matchesKey(data,"ctrl+u")) { this.follow=false; this.scroll.scrollBy(-Math.max(1,this.scroll.viewportHeight)); tui.requestRender(); return; }
    if (matchesKey(data,"ctrl+d")) { this.scroll.scrollBy(Math.max(1,this.scroll.viewportHeight)); this.follow=this.scroll.isFollowingEnd; tui.requestRender(); return; }
    if (matchesKey(data,"ctrl+end")) { this.scroll.scrollToEnd(); this.follow=true; tui.requestRender(); return; }
    if (matchesKey(data,"escape")) {
      if (this.editor.isShowingAutocomplete()) { this.editor.handleInput(data); return; }
      if (agent.state === "running" || agent.state === "starting") {
        void Promise.resolve(controller.interrupt(agent.id)).catch(error => { this.errorMessage = String(error); tui.requestRender(); });
      } else controller.back();
      return;
    }
    if (keys.matches(data,"tui.input.newLine")) { this.editor.handleInput(data); tui.requestRender(); return; }
    if (keys.matches(data,"tui.input.submit")) { this.editor.handleInput(data); tui.requestRender(); return; }
    if (matchesKey(data,"alt+enter")) { this.pendingFollowUp=true; tui.requestRender(); return; }
    if (matchesKey(data,"ctrl+p") || matchesKey(data,"ctrl+n")) { this.editor.handleInput(data); tui.requestRender(); return; }
    // While typing, every other key belongs to the Pi Editor. No bare letters are chat commands.
    this.editor.handleInput(data); tui.requestRender();
  }
  render(width: number): string[] {
    const { tui, theme, agent, controller, transcript } = this.options;
    const safeWidth=Math.max(1,width); const rows=Math.max(1,tui.terminal.rows); const height=tui.mode==="regular"?Math.max(1,Math.floor(rows*.8)):rows;
    this.editor.focused=this.focusedState;
    this.editor.disableSubmit = agent.state === "stopped" || agent.state === "failed";
    const lines=[theme.bold(theme.fg("accent",`${safe(agent.name)} · ${safe(agent.state).toUpperCase()}`)), theme.fg("muted",`${agent.parentId?`parent ${agent.parentId} · `:""}${agent.provider}/${agent.model} · ${agent.thinking??"default"} · ${agent.cwd??"cwd unknown"} · ${agent.turns??0}/${agent.maxTurns??"?"} turns`)];
    const editorLines=this.editor.render(safeWidth);
    const closed=agent.state==="stopped"||agent.state==="failed";
    const footer=theme.fg("dim",`${this.navMode?"NAV · arrows scroll · Enter input · Ctrl+Q input":"INPUT · "}${this.pendingFollowUp?"FOLLOW-UP · ":"Enter send · Shift+Enter newline · "}Ctrl+P/N history · Ctrl+U/D scroll · ${closed?"Ctrl+R resume":"Ctrl+X close"} · Esc ${agent.state==="running"?"interrupt":"roster"} · Alt+A main`);
    const transcriptHeight=Math.max(1,height-2-editorLines.length-2-(this.errorMessage?1:0)-(closed?1:0));
    const body=this.scroll.render(safeWidth);
    this.scroll.updateLayout(body.length,transcriptHeight,()=>tui.requestRender());
    if(this.follow)this.scroll.scrollToEnd();
    lines.push(...body.slice(this.scroll.scrollTop,this.scroll.scrollTop+transcriptHeight));
    lines.push(theme.fg("borderMuted","─".repeat(Math.max(1,safeWidth))));
    lines.push(...editorLines);
    if(this.errorMessage) lines.push(theme.fg("error",safe(this.errorMessage)));
    lines.push(footer);
    if(closed) lines.push(theme.fg("warning","Read-only closed agent · Ctrl+R explicitly resumes"));
    return lines.slice(0,height).map(line=>truncateToWidth(line,safeWidth));
  }
  get focused(): boolean { return this.focusedState; }
  set focused(focused: boolean) { this.focusedState=focused; this.editor.focused=focused; }
  setFocused(focused: boolean): void { this.focused=focused; }
  invalidate(): void { this.editor.invalidate(); this.scroll.invalidate(); }
  async requestClose(): Promise<void> { const {agent,controller}=this.options; if(await controller.confirmClose?.(agent.id)) await controller.close(agent.id); }
  resume(): void {
    const {agent,controller,tui}=this.options;
    if(agent.state==="stopped"||agent.state==="failed") void Promise.resolve(controller.resume(agent.id)).catch(error => {
      this.errorMessage=String(error instanceof Error ? error.message : error).slice(0,500); tui.requestRender();
    });
  }
  dispose(): void { this.disposed=true; this.unsubscribe?.(); this.unsubscribe=undefined; this.scroll.setScrollbar("hidden"); this.options.controller.state.draft=this.editor.getText(); }
}
