import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Editor, isKeyRelease, matchesKey, Key, truncateToWidth, wrapTextWithAnsi, type TUI, type KeybindingsManager } from "@earendil-works/pi-tui";
import { QuestionState, answerLabel, display, unanswered, type Question, type QuestionResult } from "./model.ts";

/** Reusable interaction. Never reads or mutates the main prompt editor. */
export class QuestionUI {
  readonly state: QuestionState;
  readonly editor: Editor;
  private activeId?: string;
  private editing: "answer" | "note" | undefined;
  private focus = false;
  private scroll = 0;
  private revealNote = false;
  private finished = false;
  private error = "";
  constructor(questions: Question[], private tui: TUI, private theme: Theme, private kb: KeybindingsManager, private done: (r: QuestionResult) => void) {
    this.state = new QuestionState(questions);
    this.editor = new Editor(tui, {
      borderColor: s => theme.fg("accent", s),
      selectList: { selectedPrefix: s => theme.fg("accent", s), selectedText: s => theme.fg("accent", s), description: s => theme.fg("muted", s), scrollInfo: s => theme.fg("dim", s), noMatch: s => theme.fg("warning", s) },
    });
    this.editor.onSubmit = value => {
      if (!this.saveDraft(value)) { this.editor.setText(value); this.refresh(); return; }
      if (this.editing === "answer" && value.trim()) {
        this.state.answers.set(this.activeId!, { id: this.activeId!, kind: "text", text: value });
      }
      // Blank Enter exits the text editor as an explicit unanswered response.
      this.closeEditor();
      this.refresh();
    };
    this.sync();
  }
  get focused() { return this.focus; }
  set focused(value: boolean) { this.focus = value; this.editor.focused = value && Boolean(this.editing); }
  private sync() {
    this.activeId = this.state.question?.id;
    this.editing = undefined;
    this.editor.setText("");
    this.editor.focused = false;
    this.scroll = 0; this.error = ""; this.revealNote = false;
    if (this.state.question?.kind === "text") this.openEditor("answer");
  }
  private saveDraft(value = this.editor.getExpandedText()): boolean {
    if (!this.editing || !this.activeId) return true;
    // Invalidate a stale saved answer as soon as its editor differs, even if over limit.
    if (this.editing === "answer") {
      const saved = this.state.answers.get(this.activeId);
      if (saved?.kind === "text" && saved.text !== value) this.state.answers.delete(this.activeId);
    }
    if (value.length > 8000) {
      this.error = "Text is limited to 8000 characters; shorten it before leaving the editor.";
      return false;
    }
    if (this.editing === "answer") this.state.drafts.set(this.activeId, value);
    else if (value.trim()) this.state.notes.set(this.activeId, value);
    else this.state.notes.delete(this.activeId);
    this.error = "";
    return true;
  }
  private openEditor(kind: "answer" | "note") {
    if (!this.activeId) return;
    this.editing = kind;
    this.editor.setText((kind === "note" ? this.state.notes : this.state.drafts).get(this.activeId) ?? "");
    this.editor.focused = this.focus;
    this.error = "";
  }
  private closeEditor() {
    // Reveal the saved block even if choices or long descriptions filled the viewport.
    this.revealNote = this.editing === "note" && !!this.activeId && this.state.notes.has(this.activeId);
    this.editing = undefined; this.editor.focused = false; this.error = "";
  }
  private jump(page: number) {
    if (!this.saveDraft()) return;
    this.state.jump(page); this.sync();
  }
  private refresh() { this.tui.requestRender(); }
  invalidate() { this.editor.invalidate(); }
  finish(result: QuestionResult) { if (!this.finished) { this.finished = true; this.done(result); } }
  handleInput(data: string) {
    if (this.finished || isKeyRelease(data)) return;
    this.revealNote = false;
    if (matchesKey(data, Key.escape) && this.editing) {
      if (this.saveDraft()) this.closeEditor();
      this.refresh(); return;
    }
    if (matchesKey(data, Key.escape) || (!this.editing && this.kb.matches(data, "tui.select.cancel"))) {
      this.finish(unanswered("cancelled", "User cancelled; no answers submitted.")); return;
    }
    if (this.editing && (matchesKey(data, Key.tab) || matchesKey(data, "shift+tab"))) {
      this.jump(this.state.page + (matchesKey(data, Key.tab) ? 1 : -1));
      this.refresh(); return;
    }
    if (this.editing) {
      // All printable input, including n/d, belongs to the focused editor.
      this.editor.handleInput(data); this.saveDraft(); this.refresh(); return;
    }
    if (matchesKey(data, Key.tab)) this.jump(this.state.page + 1);
    else if (matchesKey(data, "shift+tab")) this.jump(this.state.page - 1);
    else if (data === "d" || matchesKey(data, "d")) { const selected = this.state.review ? this.state.questions[this.state.cursor] : this.state.question; if (selected) this.finish(this.state.discussion(selected)); }
    else if ((data === "n" || matchesKey(data, "n")) && this.state.question) this.openEditor("note");
    else if ((data === "e" || matchesKey(data, "e")) && this.state.question?.kind === "text") this.openEditor("answer");
    else if (matchesKey(data, "alt+left")) this.jump(this.state.page - 1);
    else if (matchesKey(data, "alt+right")) this.jump(this.state.page + 1);
    else if (this.kb.matches(data, "tui.select.pageDown")) this.scroll += 5;
    else if (this.kb.matches(data, "tui.select.pageUp")) this.scroll = Math.max(0, this.scroll - 5);
    else if (matchesKey(data, "ctrl+p") || matchesKey(data, "ctrl+n") || this.kb.matches(data, "tui.select.up") || this.kb.matches(data, "tui.select.down")) {
      const count = this.state.review ? this.state.questions.length : (this.state.question?.options?.length ?? 0);
      const delta = matchesKey(data, "ctrl+p") || this.kb.matches(data, "tui.select.up") ? -1 : 1;
      this.state.cursor = Math.max(0, Math.min(count - 1, this.state.cursor + delta)); this.scroll = -1;
    } else if (this.kb.matches(data, "tui.select.confirm") || matchesKey(data, "ctrl+y") || matchesKey(data, Key.space)) {
      if (this.state.review) {
        // Space edits selected question; only Enter/Ctrl+Y explicitly submit review.
        if (matchesKey(data, Key.space)) this.jump(this.state.cursor);
        else { const result = this.state.submit(); if (result) this.finish(result); }
      } else if (this.state.question?.kind === "text") {
        if (!matchesKey(data, Key.space)) this.openEditor("answer");
      } else {
        const page = this.state.page;
        this.state.choose();
        if (page !== this.state.page) this.sync();
      }
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
    let noteStart: number | undefined;
    const add = (text: string, color: "text" | "accent" | "mdHeading" | "muted" = "text") =>
      body.push(...wrapTextWithAnsi(display(text), width).map(line => this.theme.fg(color, line)));
    if (this.state.review) {
      this.state.questions.forEach((question, index) => {
        if (index === this.state.cursor) anchor = body.length;
        const heading = `${index === this.state.cursor ? "› " : "  "}Question ${index + 1}: ${display(question.prompt)}`;
        add(heading, "accent");
        const answer = this.state.answers.get(question.id);
        if (!answer) add("  Unanswered", "muted");
        else if (answer.kind === "text") {
          add("  Answer:");
          for (const line of display(answer.text).split("\n")) add(`    ${line}`);
        } else {
          const selected = answer.optionIds.map(id => question.options?.find(option => option.id === id)).filter(Boolean);
          add("  Answer:");
          for (const option of selected) {
            add(`    • ${display(option!.label)}`);
          }
        }
        if (!answer && question.kind === "text" && this.state.drafts.get(question.id)?.trim()) {
          add("  Draft (not saved):", "muted");
          for (const line of display(this.state.drafts.get(question.id)!).split("\n")) add(`    ${line}`, "muted");
        }
        if (this.state.notes.has(question.id)) {
          add("  Note:", "mdHeading");
          for (const line of display(this.state.notes.get(question.id)!).split("\n")) add(`    ${line}`, "mdHeading");
        }
        if (index < this.state.questions.length - 1) body.push("");
      });
    } else {
      add(q.prompt, "accent"); body.push("");
      if (q.kind === "text" && this.editing !== "answer") {
        add(`Answer: ${answerLabel(q, this.state.answers.get(q.id))} · e or Enter reopens editor`);
        if (!this.state.answers.has(q.id) && this.state.drafts.get(q.id)) add(`Draft (not saved): ${this.state.drafts.get(q.id)}`);
      }
      if (!this.editing && q.kind !== "text") q.options?.forEach((option, index) => {
        const answer = this.state.answers.get(q.id);
        const picked = answer && answer.kind !== "text" && answer.optionIds.includes(option.id);
        if (index === this.state.cursor) anchor = body.length;
        const label = `${index === this.state.cursor ? "›" : " "} ${picked ? "[✓]" : "[ ]"} ${display(option.label)}`;
        const wrapped = wrapTextWithAnsi(label, width);
        body.push(...wrapped.map(line => index === this.state.cursor ? this.theme.fg("accent", line) : picked ? this.theme.fg("success", line) : line));
        if (option.description) add(`    ${option.description}`);
      });
      if (this.state.notes.has(q.id) && this.editing !== "note") {
        body.push("");
        noteStart = body.length;
        add("Note:", "mdHeading");
        for (const line of this.state.notes.get(q.id)!.split("\n")) add(`  ${line}`, "mdHeading");
      }
    }
    const footer = this.editing
      ? "Esc actions (n note, d discuss) · Enter save · Tab next · Shift+Tab back · Shift+Enter newline · n/d are text while editing"
      : this.state.review
        ? "d discuss highlighted · Tab next · Shift+Tab back · ↑↓/Ctrl+P/N select · Space edit · Enter/Ctrl+Y submit (skips allowed) · Esc cancel"
        : "n note · d discuss · Tab next · Shift+Tab back · ↑↓/Ctrl+P/N move · Enter/Ctrl+Y/Space choose · Esc cancel";
    const help = wrapTextWithAnsi(footer, width).map(s => this.theme.fg("dim", s));
    // Pi 1.4 Editor word wrapping can recurse on wide glyphs at width <= 2.
    // Give its internal layout a safe width, then clip final output to the terminal.
    const editorLines = this.editing ? [this.theme.fg("accent", this.editing === "note" ? "Optional note (multiline):" : "Descriptive answer (multiline):"), ...this.editor.render(Math.max(8, width))] : [];
    const reserved = 2 + Math.min(3, help.length) + editorLines.length + (this.error ? 1 : 0);
    const room = Math.max(1, height - reserved);
    if (this.revealNote && noteStart !== undefined) {
      // Keep the note at the bottom when it fits; start at its label when it is longer.
      this.scroll = Math.max(0, Math.min(noteStart, body.length - room));
    } else if (this.scroll < 0) this.scroll = Math.max(0, anchor - Math.floor(room / 2));
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
