import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Editor, isKeyRelease, matchesKey, Key, truncateToWidth, wrapTextWithAnsi, type TUI, type KeybindingsManager } from "@earendil-works/pi-tui";
import { QuestionState, answerLabel, display, unanswered, type Question, type QuestionResult } from "./model.ts";

/** Reusable interaction. Never reads or mutates the main prompt editor. */
export class QuestionUI {
  readonly state: QuestionState;
  readonly editor: Editor;
  private activeId?: string;
  private editing = false;
  private focus = false;
  private scroll = 0;
  private finished = false;
  private error = "";
  constructor(questions: Question[], private tui: TUI, private theme: Theme, private kb: KeybindingsManager, private done: (r: QuestionResult) => void) {
    this.state = new QuestionState(questions);
    this.editor = new Editor(tui, {
      borderColor: s => theme.fg("accent", s),
      selectList: { selectedPrefix: s => theme.fg("accent", s), selectedText: s => theme.fg("accent", s), description: s => theme.fg("muted", s), scrollInfo: s => theme.fg("dim", s), noMatch: s => theme.fg("warning", s) },
    });
    this.editor.onSubmit = value => {
      if (!this.state.text(value)) { this.error = "Enter 1–8000 characters (not only whitespace)."; this.editor.setText(value); }
      else this.sync();
      this.refresh();
    };
    this.sync();
  }
  get focused() { return this.focus; }
  set focused(value: boolean) { this.focus = value; this.editor.focused = value && this.editing; }
  private sync() {
    this.activeId = this.state.question?.id;
    this.editing = this.state.question?.kind === "text";
    this.editor.setText(this.activeId ? this.state.drafts.get(this.activeId) ?? "" : "");
    this.editor.focused = this.focus && this.editing;
    this.scroll = 0; this.error = "";
  }
  private saveDraft() { if (this.editing && this.activeId) this.state.drafts.set(this.activeId, this.editor.getExpandedText()); }
  private jump(page: number) { this.saveDraft(); this.state.jump(page); this.sync(); }
  private refresh() { this.tui.requestRender(); }
  invalidate() { this.editor.invalidate(); }
  finish(result: QuestionResult) { if (!this.finished) { this.finished = true; this.done(result); } }
  handleInput(data: string) {
    if (this.finished || isKeyRelease(data)) return;
    if (matchesKey(data, Key.escape) || (!this.editing && this.kb.matches(data, "tui.select.cancel"))) {
      this.finish(unanswered("cancelled", "User cancelled; no answers submitted.")); return;
    }
    if (matchesKey(data, "alt+left")) this.jump(this.state.page - 1);
    else if (matchesKey(data, "alt+right")) this.jump(this.state.page + 1);
    else if (this.editing) {
      // Includes Ctrl+Y yank, paste protocols, newlines and IME input.
      this.editor.handleInput(data); this.saveDraft();
    } else if (this.kb.matches(data, "tui.select.pageDown")) this.scroll += 5;
    else if (this.kb.matches(data, "tui.select.pageUp")) this.scroll = Math.max(0, this.scroll - 5);
    else if (this.kb.matches(data, "tui.select.up") || this.kb.matches(data, "tui.select.down")) {
      const count = this.state.review ? this.state.questions.length : (this.state.question?.options?.length ?? 0);
      const delta = this.kb.matches(data, "tui.select.up") ? -1 : 1;
      this.state.cursor = Math.max(0, Math.min(count - 1, this.state.cursor + delta)); this.scroll = -1;
    } else if (this.kb.matches(data, "tui.select.confirm") || matchesKey(data, "ctrl+y") || matchesKey(data, Key.tab) || matchesKey(data, Key.space)) {
      if (this.state.review) {
        // Space edits selected question; Enter/Ctrl+Y/Tab explicitly submit review.
        if (matchesKey(data, Key.space)) this.jump(this.state.cursor);
        else { const result = this.state.submit(); if (result) this.finish(result); else this.error = "Answer every question before submitting; Space edits highlighted question."; }
      } else { const page = this.state.page; this.state.choose(); if (page !== this.state.page) this.sync(); }
    }
    this.refresh();
  }
  render(width: number): string[] {
    width = Math.max(1, width);
    const height = Math.max(6, this.tui.terminal.rows - 6);
    const q = this.state.question;
    const title = this.state.review ? "Review answers" : `Question ${this.state.page + 1}/${this.state.questions.length} · ${q.kind}`;
    const header = this.theme.fg("accent", `── Ask user · ${title} `);
    const body: string[] = [];
    let anchor = 0;
    const add = (text: string) => body.push(...wrapTextWithAnsi(display(text), width));
    if (this.state.review) {
      this.state.questions.forEach((question, index) => {
        if (index === this.state.cursor) anchor = body.length;
        const label = `${index === this.state.cursor ? "›" : " "} ${question.id}: ${display(question.prompt)}`;
        add(label);
        add(`  ${answerLabel(question, this.state.answers.get(question.id))}`);
      });
    } else {
      add(q.prompt); body.push("");
      if (!this.editing) q.options?.forEach((option, index) => {
        const answer = this.state.answers.get(q.id);
        const picked = answer && answer.kind !== "text" && answer.optionIds.includes(option.id);
        if (index === this.state.cursor) anchor = body.length;
        const label = `${index === this.state.cursor ? "›" : " "} ${picked ? "[✓]" : "[ ]"} ${display(option.label)}`;
        const wrapped = wrapTextWithAnsi(label, width);
        body.push(...wrapped.map(line => index === this.state.cursor ? this.theme.fg("accent", line) : picked ? this.theme.fg("success", line) : line));
        if (option.description) add(`    ${option.description}`);
      });
    }
    const footer = this.editing
      ? "Enter save · Shift+Enter newline · Alt+← back · Alt+→ next · Esc cancel"
      : this.state.review
        ? "↑↓ select · Space edit · Enter/Ctrl+Y/Tab submit · Alt+← back · Esc cancel · PgUp/Dn scroll"
        : "↑↓ move · Enter/Ctrl+Y/Tab/Space choose · Alt+← back · Alt+→ next/review · Esc cancel · PgUp/Dn scroll";
    const help = wrapTextWithAnsi(footer, width).map(s => this.theme.fg("dim", s));
    // Pi 1.4 Editor word wrapping can recurse on wide glyphs at width <= 2.
    // Give its internal layout a safe width, then clip final output to the terminal.
    const editorLines = this.editing ? this.editor.render(Math.max(8, width)) : [];
    const reserved = 2 + Math.min(3, help.length) + editorLines.length + (this.error ? 1 : 0);
    const room = Math.max(1, height - reserved);
    if (this.scroll < 0) this.scroll = Math.max(0, anchor - Math.floor(room / 2));
    this.scroll = Math.min(this.scroll, Math.max(0, body.length - room));
    return [header, ...body.slice(this.scroll, this.scroll + room), ...editorLines,
      this.theme.fg("muted", `${this.state.answers.size}/${this.state.questions.length} answered · lines ${this.scroll + 1}–${Math.min(body.length, this.scroll + room)}/${body.length}`),
      ...(this.error ? [this.theme.fg("warning", this.error)] : []), ...help.slice(0, 3)]
      .map(line => truncateToWidth(line, width));
  }
}

/** Lifecycle owner: abort closes custom UI rather than merely racing its promise. */
export async function askQuestions(ctx: ExtensionContext, questions: Question[], signal?: AbortSignal): Promise<QuestionResult> {
  if (signal?.aborted) return unanswered("aborted", "Question request aborted.");
  if (ctx.mode !== "tui") return unanswered("needs-user-input", ctx.mode === "rpc" ? "RPC custom question UI unsupported; relay these questions to the user in the parent/client." : "Interactive user input required.");
  let listener: (() => void) | undefined;
  try {
    return await ctx.ui.custom<QuestionResult>((tui, theme, kb, done) => {
      const component = new QuestionUI(questions, tui, theme, kb, done);
      listener = () => component.finish(unanswered("aborted", "Question request aborted or session closed."));
      signal?.addEventListener("abort", listener, { once: true });
      if (signal?.aborted) queueMicrotask(listener);
      return component;
    }) ?? unanswered("cancelled", "Question UI closed without submission.");
  } finally { if (listener) signal?.removeEventListener("abort", listener); }
}
