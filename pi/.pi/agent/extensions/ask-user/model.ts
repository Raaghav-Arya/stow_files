import { Type, type Static } from "typebox";

const ID = Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_-]+$" });
const Option = Type.Object({ id: ID, label: Type.String({ minLength: 1, maxLength: 200 }), description: Type.Optional(Type.String({ maxLength: 1000 })) }, { additionalProperties: false });
export const QuestionSchema = Type.Object({
  id: ID,
  prompt: Type.String({ minLength: 1, maxLength: 2000 }),
  kind: Type.Union([Type.Literal("single"), Type.Literal("multi"), Type.Literal("text")]),
  options: Type.Optional(Type.Array(Option, { maxItems: 30 })),
}, { additionalProperties: false });
export const ParamsSchema = Type.Object({ questions: Type.Array(QuestionSchema, { minItems: 1, maxItems: 12 }) }, { additionalProperties: false });
export type Question = Static<typeof QuestionSchema>;
export type Answer = { id: string; kind: "single" | "multi"; optionIds: string[] } | { id: string; kind: "text"; text: string };
export type QuestionResult = { status: "submitted"; answers: Answer[] } | { status: "cancelled" | "aborted" | "busy" | "needs-user-input"; answers: []; reason: string };
export const ResultSchema = Type.Object({
  status: Type.Union([Type.Literal("submitted"), Type.Literal("cancelled"), Type.Literal("aborted"), Type.Literal("busy"), Type.Literal("needs-user-input")]),
  answers: Type.Array(Type.Union([
    Type.Object({ id: ID, kind: Type.Literal("text"), text: Type.String() }),
    Type.Object({ id: ID, kind: Type.Union([Type.Literal("single"), Type.Literal("multi")]), optionIds: Type.Array(ID) }),
  ])), reason: Type.Optional(Type.String()),
});
export function validateQuestions(questions: Question[]): void {
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 12) throw new Error("Expected 1–12 questions");
  const ids = new Set<string>();
  for (const q of questions) {
    if (ids.has(q.id)) throw new Error(`Duplicate question ID: ${q.id}`);
    ids.add(q.id);
    if (q.kind === "text") {
      if (q.options?.length) throw new Error("Text questions cannot have options");
    } else {
      if (!q.options?.length) throw new Error("Choice questions require options");
      if (new Set(q.options.map(o => o.id)).size !== q.options.length) throw new Error(`Duplicate option ID: ${q.id}`);
    }
  }
}
export function unanswered(status: Exclude<QuestionResult["status"], "submitted">, reason: string): QuestionResult {
  return { status, answers: [], reason };
}
export class QuestionState {
  page = 0;
  cursor = 0;
  readonly answers = new Map<string, Answer>();
  readonly drafts = new Map<string, string>();
  constructor(readonly questions: Question[]) { validateQuestions(questions); }
  get question() { return this.questions[this.page]; }
  get review() { return this.page === this.questions.length; }
  get complete() { return this.questions.every(q => this.answers.has(q.id)); }
  jump(page: number) { this.page = Math.max(0, Math.min(this.questions.length, page)); this.cursor = 0; }
  choose() {
    const q = this.question, option = q?.options?.[this.cursor];
    if (!q || !option || q.kind === "text") return;
    const prior = this.answers.get(q.id);
    let ids = prior && prior.kind !== "text" ? prior.optionIds : [];
    ids = q.kind === "single" ? [option.id] : ids.includes(option.id) ? ids.filter(id => id !== option.id) : [...ids, option.id];
    if (!ids.length) this.answers.delete(q.id);
    else this.answers.set(q.id, { id: q.id, kind: q.kind, optionIds: ids });
    if (q.kind === "single") this.jump(this.page + 1);
  }
  text(value: string) {
    const q = this.question;
    if (!q || q.kind !== "text") return false;
    this.drafts.set(q.id, value);
    if (!value.trim() || value.length > 8000) return false;
    this.answers.set(q.id, { id: q.id, kind: "text", text: value });
    this.jump(this.page + 1); return true;
  }
  submit(): QuestionResult | undefined {
    if (!this.review || !this.complete) return;
    return { status: "submitted", answers: this.questions.map(q => this.answers.get(q.id)!) };
  }
}
// Never render model-controlled terminal escape sequences (including OSC links).
export function display(text: string): string { return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ""); }
export function answerLabel(q: Question, answer?: Answer): string {
  if (!answer) return "Not answered";
  if (answer.kind === "text") return answer.text;
  return answer.optionIds.map(id => q.options?.find(o => o.id === id)?.label ?? id).join(", ");
}
