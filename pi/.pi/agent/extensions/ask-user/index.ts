import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { ParamsSchema, ResultSchema, validateQuestions, unanswered, display, type QuestionResult } from "./model.ts";
import { askQuestions } from "./ui.ts";

export default function askUser(pi: ExtensionAPI) {
  let active: AbortController | undefined;
  pi.on("session_shutdown", async () => { active?.abort(); });
  pi.registerTool({
    name: "ask_user", label: "Ask user", exposure: "model-only",
    description: "Ask the user 1–12 questions with stable IDs: single choice, multi-select, or free text. Choices need stable option IDs and may have descriptions. All questions require an explicit answer and final review/submit. Cancellation, needs-user-input or abort never means approval. Do not retry automatically when UI is unavailable; relay questions to the user instead. This is a local schema, not Claude AskUserQuestion compatibility.",
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
      const summary = data.status === "submitted" ? `Submitted ${data.answers.length} answer(s)` : `${data.status}: ${data.reason}`;
      const detail = options.expanded && data.status === "submitted" ? "\n" + JSON.stringify(data.answers) : "";
      return new Text(theme.fg(data.status === "submitted" ? "success" : "warning", display(summary + detail)), 0, 0);
    },
  });
}
