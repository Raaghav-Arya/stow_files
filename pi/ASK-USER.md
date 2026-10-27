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
up to 2000 characters, labels 200, descriptions 1000. Saved text answers must
contain non-whitespace and are capped at 8000 characters. Users may leave any
question unanswered and explicitly submit the selected answers at review;
`skippedQuestionIds` names every omission, including when all questions are
skipped. Multi-select answers require at least one explicit selection. No
defaults. Every question supports an optional note alongside its answer, so the
user can qualify choices or add context even when the question is skipped. A note
never counts as an answer. Use a text question for a descriptive answer rather
than a choice. There is no implicit Other option.

Submitted data (optional notes are separate from answers):

```json
{"status":"submitted","answers":[
  {"id":"target","kind":"single","optionIds":["local"]},
  {"id":"checks","kind":"multi","optionIds":["unit","types"]},
  {"id":"notes","kind":"text","text":"Preserve existing changes"}
],"skippedQuestionIds":[],"notes":[{"id":"checks","note":"Include integration tests"}]}
```

Discussion uses `status: "discussion-requested"`, selected question metadata,
and partial selections/text drafts/notes. It deliberately has no `answers` field:

```json
{"status":"discussion-requested","question":{"id":"checks","prompt":"Which checks?"},
 "partial":[{"id":"checks","prompt":"Which checks?","selectedOptionIds":["unit"],
             "note":"Let's discuss the integration coverage"}]}
```

All `partial` entries are unfinished context, not a completed questionnaire or
approval. Submitted answers include only answered questions; `skippedQuestionIds`
is the separate ID list of unanswered questions. `answers` may be empty when every
question is skipped, while every unanswered ID remains listed. Unsaved descriptive
drafts are never submitted. Notes are returned separately in an ID-keyed `notes`
array, including notes for skipped questions; questions with no note have no entry.

Non-submit statuses `cancelled`, `aborted`, `busy`, `needs-user-input` always carry
`answers: []` and a reason. Content, details and structuredContent agree. Nothing
about an answer grants blanket permission to execute actions.

## Keyboard / behavior

- Choices: configured select up/down (including local Ctrl+P/N); Enter/Ctrl+Y
  selects and Space toggles multi-select (or selects a single choice). Single
  selection advances; multi-select stays so several choices can be toggled.
  Tab advances; Shift+Tab goes back, including inside answer/note editors.
  Navigation clamps at the first question/review boundary, never selects or
  submits, and preserves drafts/selections. Alt+Left/Right also navigate outside
  editors; inside them native editor controls remain in effect.
- Review: spaced numbered question blocks show selected option labels as bullets,
  saved answers, unanswered items, unsaved drafts and indented multiline notes;
  internal IDs are not shown. Every question heading uses the theme's `accent`,
  saved answers use normal `text` (light text in dark mode), notes use `mdHeading`,
  and unanswered/unsaved items use `muted`. The cursor marker identifies the
  highlighted question without removing color from other headings. Up/down highlights questions, Space edits, and
  Enter/Ctrl+Y explicitly submits the answered subset with skipped IDs. Tab
  navigates to a boundary, never submits.
- PgUp/PgDn scroll long prompts, option descriptions and review. Navigation keeps
  the highlighted option visible. Narrow widths wrap text and clip help to three
  rows; resize wider to see full help. Extremely short terminals should be resized.
- `n` opens an optional multiline note editor; Enter saves and blank removes it.
  While editing, the duplicate note preview is hidden. After saving/returning,
  `Note:` appears in its own colored block below the choices (or text answer).
  The viewport scrolls to reveal it even if long choices/descriptions previously
  filled the screen. Long notes remain scrollable with PgUp/PgDn and available
  in full via `n` or review. The note stays in view through resize until the next
  input, after which normal option navigation/scrolling resumes. Descriptive-answer previews are likewise hidden while their
  editor is active.
  Text questions automatically open their dedicated multiline descriptive-answer
  editor (including when navigating back); Escape returns to question actions, and
  `e` or Enter can reopen it. Shift+Enter/Ctrl+J inserts newlines; n/d are literal
  text while an editor is active. Blank Enter exits the text editor unanswered.
  Notes are retained when navigating or returning to actions; descriptive drafts
  require nonblank Enter to become answers. Unsaved descriptive drafts are labelled
  on review and omitted from submission; editing a saved answer invalidates its old
  value until explicitly saved. Opening/closing an unchanged saved answer keeps it.
  Notes and drafts are shown on review. Ctrl+Y retains native yank inside editors.
- `d` requests discussion for the current question (or highlighted review question).
  It exits with `discussion-requested` and clearly partial context, never answers or
  approval. Discuss conversationally, reassess uncertainty, then make a fresh request
  only for still-relevant questions; there is no automatic replay.
- Editors preserve paste/focus/IME. Tab/Shift+Tab navigate while editing only when
  text fits the 8000-character limit; otherwise navigation is blocked until shortened.
  Escape outside editors cancels without submitting answers or notes.

This is an inline custom screen, not an overlay or competing editor replacement.
The main prompt editor is never read/set/replaced, preserving its draft and any
attachments by leaving them alone. Drafts within the question screen survive navigation; cancellation,
abort/reload/exit discard them without returning partial data. An explicit discussion
request intentionally returns partial context. Submitted answers/notes and discussion
drafts enter ordinary Pi session/model history: **do not enter passwords or secrets**.
The tool transcript collapses to status/count; expand to inspect submitted IDs/data.
Cancellation rendering stays status-only even when expanded, and model-facing
instructions explicitly forbid recapping cancelled questionnaire contents or
inferring permission. This does not erase original tool-call arguments or earlier
session history.

## Other modes / reuse

TUI gets the full custom component; RPC explicitly returns `needs-user-input`
because this multi-question custom screen is unsupported by the RPC UI protocol.
Print/JSON also return `needs-user-input`, never fabricated approval or a hung
terminal promise. RPC clients and parent agents must relay questions to the user
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
Offline tests make no model calls. They cover notes, multi-select, discussion for
each question kind and review, strict result schemas, oversized drafts, explicit
saving and real TUI focus routing that isolates Shift+Tab from the main editor's
extension shortcut. The user live-tested submission, choices, text, multiline
notes, discussion and cancellation; after reload they also exercised automatic
text entry, skipped submission, saved-note placement and the colored review,
and confirmed that everything looks fine. This records acceptance in their
current terminal setup, not an exhaustive matrix of IME, forwarding stacks,
regular/fullscreen modes or themes. Automated tests do not prove physical
terminal forwarding. Research/security review:
`research/PI-008-references.md`; pre-implementation plan:
`research/PI-008-plan.md`.
