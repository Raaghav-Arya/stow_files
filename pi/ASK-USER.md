# Ask user — PI-008

Local model-callable `ask_user` tool; reusable question UI in
`.pi/agent/extensions/ask-user/ui.ts`. Uses installed Pi APIs only, no packages
installed and no second main editor. Local schema, **not** a drop-in Claude
`AskUserQuestion` wire-format implementation.

## Enable / disable

The source directory's `index.ts` is auto-discovered when it is under the live
`~/.pi/agent/extensions/ask-user/` directory (live symlink now integrated).
For a separate test invocation, load the absolute `index.ts` path using `pi -e`.
Do not load the same extension twice. Restart or explicitly `/reload` after
user-approved integration; this implementation task does not reload a live session.

Disable with `pi config`, or exclude its exact live extension path from settings:
`"extensions": ["-/absolute/path/to/extensions/ask-user/index.ts"]`, then restart
or `/reload`. Remove only the live link if managed through stow; keep source.
`--no-extensions` disables all extensions for one invocation. No persistent custom
state/files, shortcuts, settings or background processes need cleanup.

## Tool shape

```json
{
  "questions": [
    {"id":"target", "kind":"single", "prompt":"Where should this run?",
     "options":[{"id":"local", "label":"Local", "description":"No remote service"},
                {"id":"remote", "label":"Remote"}]},
    {"id":"checks", "kind":"multi", "prompt":"Which checks?",
     "options":[{"id":"unit", "label":"Unit tests"},{"id":"types", "label":"Type checking"}]},
    {"id":"notes", "kind":"text", "prompt":"Any additional constraints?"}
  ]
}
```

1–12 questions; unique stable question IDs, unique option IDs within each question.
IDs are 1–64 ASCII letters/digits/underscore/hyphen; up to 30 options each. Prompts
up to 2000 characters, labels 200, descriptions 1000. Text answers must contain
non-whitespace and are capped at 8000 characters on save. All questions require
an answer; multi-select requires at least one explicit selection. No defaults.
To support both choices and arbitrary text, ask a separate text question; this
first schema does not have an implicit Other option or optional questions.

Submitted data:

```json
{"status":"submitted","answers":[
  {"id":"target","kind":"single","optionIds":["local"]},
  {"id":"checks","kind":"multi","optionIds":["unit","types"]},
  {"id":"notes","kind":"text","text":"Preserve existing changes"}
]}
```

Non-submit statuses `cancelled`, `aborted`, `busy`, `needs-user-input` always carry
`answers: []` and a reason. Content, details and structuredContent agree. Nothing
about an answer grants blanket permission to execute actions.

## Keyboard / behavior

- Choices: configured select up/down (including local Ctrl+P/N); Enter, Ctrl+Y,
  Tab or Space selects. Single choice advances; multi toggles without advancing.
- Alt+Right advances to next question/review; Alt+Left goes back. Missing answers
  never become defaults. Review identifies unanswered questions and blocks submit.
- Review: up/down highlights questions, Space edits; Enter/Ctrl+Y/Tab explicitly
  submits **only if all questions have answers**. Every request has a review page.
- PgUp/PgDn scroll long prompts, option descriptions and review. Navigation keeps
  the highlighted option visible. Narrow widths wrap text and clip help to three
  rows; resize wider to see full help. Extremely short terminals should be resized.
- Text: native multiline Editor, Enter saves, Shift+Enter/Ctrl+J adds newline,
  **Ctrl+Y remains native yank**, Alt+Left/Right preserves unfinished local drafts.
  Native paste expansion, focus and cursor markers are preserved for IME support.
- Escape cancels the entire interaction without submitting partial answers.
  Ctrl+C retains the native text-editor copy behavior; outside text it cancels.

This is an inline custom screen, not an overlay or competing editor replacement.
The main prompt editor is never read/set/replaced, preserving its draft and any
attachments by leaving them alone. Drafts within the question screen survive back
navigation only; cancellation, abort/reload/exit discard them. Submitted answers
enter ordinary Pi session/model history: **do not enter passwords or secrets**.
The tool transcript collapses to status/count; expand to inspect submitted IDs/data.

## Other modes / reuse

TUI gets the full custom component; RPC explicitly returns `needs-user-input`
because this multi-question custom screen is unsupported by the RPC UI protocol.
Print/JSON also return `needs-user-input`, never fabricated approval or a hung
terminal promise. RPC clients/Agents Hub parents must relay questions to the user
and convey the user's response explicitly; this extension does not create an
automatic child-to-parent question broker. Do not retry unavailable UI in a loop.

Commands/extensions may import `askQuestions(ctx, questions, signal)` and typed
`Question`/`QuestionResult`; they own any concurrent-modal scheduling and lifecycle
signal. The tool adds sequential execution, a busy guard and shutdown abort. Two
copies of this extension or other unrelated custom dialogs are not globally
serialized. No persisted request resumes after a crash or session replacement.

## Validation

```sh
node --test tests/ask-user.test.mjs
node tests/ask-user-typecheck.mjs
```

`node tests/feature-integration.test.mjs` also checks live-link discovery and
that `ask_user` is actually registered alongside plan mode and prompt stashing.
The plan gate explicitly allows this local tool for clarification. Key-release
events are ignored so releasing Ctrl+Y cannot select a second answer.
Offline tests make no model calls. Live visual/IME/WezTerm→tmux→Neovim forwarding,
regular/fullscreen, and dark/light-theme user acceptance remain manual; tests do
not prove terminal forwarding. Research/security review:
`research/PI-008-references.md`; pre-implementation plan:
`research/PI-008-plan.md`.
