import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { ParamsSchema, ResultSchema, validateQuestions, unanswered, display, type QuestionResult } from "./model.ts";
import { askQuestions } from "./ui.ts";

export default function askUser(pi: ExtensionAPI) {
  let active: AbortController | undefined;
  pi.on("session_shutdown", async () => { active?.abort(); });
  pi.registerTool({
    name: "ask_user", label: "Ask user", exposure: "model-only",
    description: "Ask the user 1–12 questions with stable IDs: single choice, multi-select, or free text. Choices need stable option IDs and may have descriptions. Users may leave any question unanswered, then explicitly submit at review; return only answered items in answers and list omissions in skippedQuestionIds. Notes are separate optional context and never count as answers. Unsaved descriptive drafts are omitted. The user may request discussion of any question, returning discussion-requested with clearly partial context, not submitted answers or approval. Discuss conversationally, then reassess and ask a fresh request with only still-relevant questions; never automatically replay the old questionnaire. Cancellation and abort return no answer context: report status only and do not recap the cancelled questionnaire or infer a response. Skipped questions, cancellation, abort and needs-user-input never imply approval. Do not retry automatically when UI is unavailable; relay questions to the user instead. This is a local schema, not Claude AskUserQuestion compatibility.",
    parameters: ParamsSchema, outputSchema: ResultSchema, executionMode: "sequential",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async execute(_id, params, signal, _update, ctx) {
      validateQuestions(params.questions);
      let result: QuestionResult;
      if (active) result = unanswered("busy", "Another question interaction is active; no answers submitted.");
      else {
        const controller = new AbortController(); active = controller;
        const abort = () => controller.abort();
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        try { result = await askQuestions(ctx, params.questions, controller.signal); }
        finally { signal?.removeEventListener("abort", abort); if (active === controller) active = undefined; }
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, structuredContent: result };
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", "Ask user ") + theme.fg("muted", `${Array.isArray(args.questions) ? args.questions.length : "…"} question(s)`), 0, 0);
    },
    renderResult(result, options, theme) {
      const data = result.details as QuestionResult | undefined;
      if (!data) return new Text(theme.fg("muted", "Waiting for user input…"), 0, 0);
      const summary = data.status === "submitted"
        ? `Submitted ${data.answers.length} answer(s); skipped ${data.skippedQuestionIds?.length ?? 0}`
        : data.status === "discussion-requested"
          ? `Discussion requested for ${data.question.id}; partial context only`
          : data.status;
      const detail = options.expanded && (data.status === "submitted" || data.status === "discussion-requested")
        ? "\n" + JSON.stringify(data.status === "submitted"
          ? { answers: data.answers, skippedQuestionIds: data.skippedQuestionIds ?? [], notes: data.notes ?? [] }
          : { question: data.question, partial: data.partial }) : "";
      const color = data.status === "submitted" ? "success" : data.status === "discussion-requested" ? "accent" : "warning";
      return new Text(theme.fg(color, display(summary + detail)), 0, 0);
    },
  });
}
